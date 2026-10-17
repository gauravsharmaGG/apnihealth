// Household administration for the signed-in user: create/switch households, people and roles, invites, and the
// member profiles (people with records, including children without a login). Owners manage; everyone can read.
import * as A from './accounts.mjs';
import {createHousehold,addMember,addProfile,updateMember,removeMember,listMembers,newMemberId,ROLES,AccessError,transaction,system} from './store.mjs';
import {json,send,readForm,limited,requestOrigin} from './http.mjs';
import {sendMail,mailConfigured} from './mailer.mjs';
import {APP_NAME} from './env.mjs';
import * as settings from './settings.mjs';

const body=async req=>{try{const b=await readForm(req,16384);return b&&typeof b==='object'?b:{}}catch{return {}}};
const ownerOnly=hh=>{if(hh?.role!=='owner')throw new AccessError('Only an owner can do this',403)};
export const inviteLink=(req,t)=>requestOrigin(req)+'/invite?token='+t;

// Creates a household owned by the user, with a first profile for them, and switches to it.
// memberName: the owner's own (adult) profile; defaults to their account name or email.
export function createOwnHousehold(user,name,memberName){
 const d=system();
 const me=(typeof memberName==='string'&&memberName.trim()?memberName.trim():user.name||user.email.split('@')[0]).slice(0,40);
 return transaction(d,()=>{
  const h=createHousehold(typeof name==='string'&&name.trim()?name:'My household',{onboarded:false});
  A.setMembership(h.id,user.id,'owner');
  addMember(h.id,{id:newMemberId(me),name:me,kind:'adult'});
  A.setActiveHousehold(user.id,h.id);
  return h;
 });
}

// Routes that work without a household (create, switch). True when answered.
export async function handleAnywhere(req,res,path,user){
 if(path==='/api/households'&&req.method==='POST'){
  if(limited('households:'+user.id,10,36e5))return json(res,429,{error:'Too many requests'}),true;
  const b=await body(req),h=createOwnHousehold(user,b.name,b.memberName);
  if(/urlencoded/.test(req.headers['content-type']||''))return send(res,303,'',{Location:'/welcome'}),true; // a plain form
  return json(res,200,{household:{id:h.id,name:h.name}}),true;
 }
 // First-run setup (public/onboarding.js): where the signed-in person stands, and the choices on offer.
 if(path==='/api/onboarding'&&req.method==='GET'){
  const hh=A.activeHousehold(user);
  return json(res,200,{
   household:hh?{id:hh.id,name:hh.name,role:hh.role,...settings.get(hh.id)}:null,
   members:hh?listMembers(hh.id).map(m=>({id:m.id,name:m.name,kind:m.kind})):[],
   metricGroups:Object.entries(settings.METRIC_GROUPS).map(([id,g])=>({id,label:g.label})),core:settings.CORE.map(([id,label])=>({id,label})),
   defaults:settings.DEFAULT_METRICS
  }),true;
 }
 if(path==='/api/households/switch'&&req.method==='POST'){
  try{A.setActiveHousehold(user.id,String((await body(req)).id||''))}catch(e){return json(res,400,{error:e.message}),true}
  return json(res,200,{ok:true}),true;
 }
 return false;
}

// /api/household/* inside the active household (hh = {id,name,role}). True when answered.
export async function handle(req,res,path,user,hh){
 if(!path.startsWith('/api/household'))return false;
 if(path==='/api/household'&&req.method==='GET'){
  return json(res,200,{
   household:hh,settings:settings.get(hh.id),households:A.householdsOf(user.id),me:user.id,
   people:A.people(hh.id).map(p=>({id:p.id,email:p.email,name:p.name,role:p.role})),
   invites:hh.role==='owner'?A.pendingInvites(hh.id).map(i=>({id:i.id,role:i.role,email:i.email,expiresAt:new Date(i.expires_at).toISOString()})):[],
   members:listMembers(hh.id).map(m=>({id:m.id,name:m.name,kind:m.kind,color:m.color}))
  }),true;
 }
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'}),true;
 if(limited('household:'+user.id,60,6e5))return json(res,429,{error:'Too many requests'}),true;
 const b=await body(req);
 try{
  switch(path){
   case '/api/household/leave':A.removeMembership(hh.id,user.id);return json(res,200,{ok:true}),true;
   case '/api/household/rename':{ownerOnly(hh);const name=String(b.name||'').trim().slice(0,80);if(!name)throw Error('Give the household a name');
    system().prepare('UPDATE households SET name=? WHERE id=?').run(name,hh.id);return json(res,200,{ok:true}),true}
   case '/api/household/settings':ownerOnly(hh);return json(res,200,{settings:settings.save(hh.id,b)}),true;
   case '/api/household/onboarded':ownerOnly(hh);settings.markOnboarded(hh.id);return json(res,200,{ok:true}),true;
   case '/api/household/people/role':ownerOnly(hh);A.changeRole(hh.id,String(b.userId||''),String(b.role||''));return json(res,200,{ok:true}),true;
   case '/api/household/people/remove':ownerOnly(hh);A.removeMembership(hh.id,String(b.userId||''));return json(res,200,{ok:true}),true;
   case '/api/household/invites':{
    ownerOnly(hh);
    if(limited('invites:'+hh.id,30,36e5))return json(res,429,{error:'Too many invites; try again later'}),true;
    const role=ROLES.includes(b.role)?b.role:'viewer',email=b.email?A.cleanEmail(b.email):null;
    const link=inviteLink(req,A.createInvite(hh.id,role,{email,createdBy:user.id}));
    let emailed=false;
    if(email){
     const text=`${user.name||user.email} invited you to "${hh.name}" on ${APP_NAME} as ${role}.\n\nAccept the invite (valid ${A.INVITE_DAYS} days, works once):\n${link}\n\nIf you were not expecting this, you can ignore this email.\n`;
     if(mailConfigured()){sendMail({to:email,subject:`Invite to ${hh.name} on ${APP_NAME}`,text}).catch(e=>console.error('invite email could not be sent:',e.message));emailed=true}
     else console.log(`[auth] Email is not configured; invite link for ${email}: ${link}`);
    }
    return json(res,200,{link,emailed}),true;
   }
   case '/api/household/invites/revoke':ownerOnly(hh);return (A.revokeInvite(hh.id,b.id)?json(res,200,{ok:true}):json(res,404,{error:'Not found'})),true;
   case '/api/household/members':{const m=addProfile(hh.id,{name:b.name,kind:b.kind,color:b.color||undefined});return json(res,200,{member:{id:m.id,name:m.name,kind:m.kind,color:m.color}}),true}
   case '/api/household/members/update':{const m=updateMember(String(b.id||''),{name:b.name,kind:b.kind,color:b.color||null});return json(res,200,{member:{id:m.id,name:m.name,kind:m.kind,color:m.color}}),true}
   case '/api/household/members/remove':{
    const m=listMembers(hh.id).find(x=>x.id===b.id);
    if(m&&b.confirm!==m.name)throw Error('Type the profile name to confirm');
    removeMember(String(b.id||''));return json(res,200,{ok:true}),true;
   }
  }
 }catch(e){
  if(e instanceof AccessError)return json(res,e.status===403?403:400,{error:e.status===403?e.message:'Unknown profile'}),true;
  return json(res,400,{error:e.message}),true;
 }
 return json(res,404,{error:'Not found'}),true;
}
