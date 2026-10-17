// Households, people and roles, invites and profiles end to end (AUTH_MODE=builtin, fictional data).
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {until,startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-hh-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin',SIGNUP_MODE:'invite'};
writeFileSync(join(dir,'setup.mjs'),`
const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs'),log=await import('./log.mjs');S.enterAs(S.SYSTEM);
const a=S.createHousehold('Household A'),b=S.createHousehold('Household B');
S.addMember(a.id,{id:'ann',name:'Ann'});S.addMember(b.id,{id:'bob',name:'Bob'});
const out={a:a.id,b:b.id};
for(const [e,h,r] of [['owner-a@example.com',a,'owner'],['editor-a@example.com',a,'editor'],['viewer-a@example.com',a,'viewer'],['owner-b@example.com',b,'owner'],['lonely@example.com',null,null]]){
 const u=A.createUser(e);if(h)A.setMembership(h.id,u.id,r);C.recordConsent(u.id);out[e]={id:u.id,token:A.createSession(u.id)};
}
log.add([{metric:'steps',date:'2000-01-01',value:2222}],'manual','bob');
console.log(JSON.stringify(out));`);
const r=spawnSync(process.execPath,['setup.mjs'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const U=JSON.parse(r.stdout.trim().split('\n').at(-1));
let log='';const {p,port}=await startServer({cwd:dir,env,onData:d=>log+=d}),O=`http://localhost:${port}`;
const req=({method='GET',path,token,body,form})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(token?{Cookie:'apni_session='+token}:{}),...(method!=='GET'?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json',Origin:O}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,headers:res.headers,body:b,json:j})})});q.on('error',no);q.end(form?new URLSearchParams(form).toString():body?JSON.stringify(body):undefined)});
const T=e=>U[e].token,post=(e,path,body)=>req({method:'POST',path,token:T(e),body});
const cookieOf=res=>res.headers['set-cookie'][0].split(';')[0].split('=')[1];
// Server output reaches this process on a pipe, separately from the HTTP socket, so a line the server logged before
// answering can still be in transit when the response is read. Lines on one pipe keep their order, though:
// logged(text) waits for a line; flushLog() makes the server log a known line and waits for it, after which
// everything logged earlier has arrived (that is what makes the "was NOT logged" checks meaningful).
const logged=(text,what=text)=>until(()=>log.includes(text),5000,what);
const flushLog=async()=>{const mark='sign-in link for lonely@example.com: ',n=log.split(mark).length;
 assert.equal((await req({method:'POST',path:'/auth/email',form:{email:'lonely@example.com'}})).headers.location,'/login?sent=1');
 await until(()=>log.split(mark).length>n,5000,'log flush')};
const linkFor=async email=>{const l=await until(()=>log.split('\n').filter(x=>x.includes('sign-in link for '+email+': ')).at(-1),5000,'link for '+email);return new URL(l.split(': ').pop().trim())};
try{
 // overview
 const ov=(await req({path:'/api/household',token:T('owner-a@example.com')})).json;
 assert.equal(ov.household.name,'Household A');assert.equal(ov.people.length,3);assert.deepEqual(ov.members.map(m=>m.id),['ann']);assert.deepEqual(ov.invites,[]);
 assert(!JSON.stringify(ov).includes('bob')&&!JSON.stringify(ov).includes('owner-b'),'nothing from household B');
 assert.deepEqual((await req({path:'/api/household',token:T('viewer-a@example.com')})).json.invites,[],'only owners see invites');
 // only owners manage
 for(const e of ['editor-a@example.com','viewer-a@example.com']){
  for(const [path,body] of [['/api/household/rename',{name:'X'}],['/api/household/invites',{role:'owner'}],['/api/household/people/role',{userId:U['viewer-a@example.com'].id,role:'owner'}],['/api/household/people/remove',{userId:U['owner-a@example.com'].id}],['/api/household/members',{name:'X'}],['/api/household/members/update',{id:'ann',name:'X'}],['/api/household/members/remove',{id:'ann',confirm:'Ann'}]])
   assert.equal((await post(e,path,body)).status,403,e+' '+path);
 }
 assert.equal((await req({path:'/api/household',token:T('owner-a@example.com')})).json.household.name,'Household A');
 // last owner is protected
 assert.match((await post('owner-a@example.com','/api/household/people/role',{userId:U['owner-a@example.com'].id,role:'editor'})).json.error,/at least one owner/);
 assert.match((await post('owner-a@example.com','/api/household/leave',{})).json.error,/at least one owner/);
 assert.equal((await post('owner-a@example.com','/api/household/people/role',{userId:U['owner-b@example.com'].id,role:'viewer'})).status,400,'cannot change someone outside the household');
 // owner B cannot touch A's profiles
 assert.equal((await post('owner-b@example.com','/api/household/members/update',{id:'ann',name:'Hacked'})).status,400);
 assert.equal((await post('owner-b@example.com','/api/household/members/remove',{id:'ann',confirm:'Ann'})).status,400);
 // link invite -> brand-new person signs up through it
 const inv=await post('owner-a@example.com','/api/household/invites',{role:'viewer'});assert.equal(inv.status,200);
 const il=new URL(inv.json.link);assert.equal(il.pathname,'/invite');assert.equal(inv.json.emailed,false);
 const page=await req({path:il.pathname+il.search});assert.equal(page.status,200);assert.match(page.body,/Join Household A/);assert.match(page.body,/name="invite"/);
 assert.equal((await req({method:'POST',path:'/auth/email',form:{email:'newbie@example.com'}})).headers.location,'/login?sent=1');
 await flushLog();assert(!log.includes('link for newbie@example.com'),'no invite, no sign-up');
 await req({method:'POST',path:'/auth/email',form:{email:'newbie@example.com',invite:il.searchParams.get('token')}});
 const nl=await linkFor('newbie@example.com');assert.equal(nl.searchParams.get('invite'),il.searchParams.get('token'));
 const conf=await req({path:nl.pathname+nl.search});assert.match(conf.body,/name="invite" value="/);
 const v=await req({method:'POST',path:'/auth/verify',form:{token:nl.searchParams.get('token'),invite:nl.searchParams.get('invite')}});assert.equal(v.status,303,v.body);
 const newbie=cookieOf(v);
 assert.equal((await req({path:'/api/log?profile=ann',token:newbie})).json.consent,'required','new people accept the notice first');
 await req({method:'POST',path:'/consent',token:newbie,form:{disclaimer:'yes',consent:'yes',version:(await req({path:'/consent',token:newbie})).body.match(/name="version" value="([^"]+)"/)[1]}});
 const me=(await req({path:'/api/me',token:newbie})).json;
 assert.equal(me.email,'newbie@example.com');assert.equal(me.household.name,'Household A');assert.equal(me.household.role,'viewer');
 assert.equal((await req({path:'/api/log?profile=ann',token:newbie})).status,200);assert.equal((await req({path:'/api/log?profile=bob',token:newbie})).status,400,'new member sees only A');
 assert.equal((await req({path:il.pathname+il.search})).status,410,'an invite works once');
 // email-bound invite: only that address may use it
 const ei=new URL((await post('owner-a@example.com','/api/household/invites',{role:'editor',email:'owner-b@example.com'})).json.link);
 await logged('invite link for owner-b@example.com: ','without SMTP the invite link is logged');
 const wrong=await req({path:ei.pathname+ei.search,token:T('lonely@example.com')});assert.match(wrong.body,/different email address/);
 assert.equal((await req({method:'POST',path:'/invite/accept',token:T('lonely@example.com'),form:{token:ei.searchParams.get('token')}})).status,403);
 const n1=log.length;await req({method:'POST',path:'/auth/email',form:{email:'stranger@example.com',invite:ei.searchParams.get('token')}});
 await flushLog();assert(!log.slice(n1).includes('stranger@example.com'),'bound invite gives no link to other addresses');
 const acc=await req({method:'POST',path:'/invite/accept',token:T('owner-b@example.com'),form:{token:ei.searchParams.get('token')}});assert.equal(acc.status,303);
 const hb=(await req({path:'/api/household',token:T('owner-b@example.com')})).json;
 assert.equal(hb.household.name,'Household A','accepting switches to the new household');assert.equal(hb.household.role,'editor');assert.equal(hb.households.length,2);
 assert.equal((await post('owner-b@example.com','/api/household/rename',{name:'X'})).status,403,'editor in A even though owner in B');
 assert.equal((await post('owner-b@example.com','/api/households/switch',{id:U.a+'nope'})).status,400);
 assert.equal((await post('owner-b@example.com','/api/households/switch',{id:U.b})).status,200);
 assert.match((await req({path:'/config.js',token:T('owner-b@example.com')})).body,/"bob"/);
 assert.doesNotMatch((await req({path:'/config.js',token:T('owner-b@example.com')})).body,/"ann"/);
 // revoke
 const ri=new URL((await post('owner-a@example.com','/api/household/invites',{role:'owner'})).json.link);
 const pend=(await req({path:'/api/household',token:T('owner-a@example.com')})).json.invites;assert.equal(pend.length,1);assert.equal(pend[0].role,'owner');
 assert.equal((await post('owner-a@example.com','/api/household/invites/revoke',{id:pend[0].id})).status,200);
 assert.equal((await req({path:ri.pathname+ri.search})).status,410,'revoked');
 assert.equal((await req({path:'/invite?token=garbage'})).status,410);
 // roles: change and remove
 assert.equal((await post('owner-a@example.com','/api/household/people/role',{userId:U['viewer-a@example.com'].id,role:'editor'})).status,200);
 assert.equal((await post('viewer-a@example.com','/api/log?profile=ann',{entries:[{metric:'steps',date:'2000-01-03',value:3}]})).status,200,'promoted to editor: can write');
 assert.equal((await post('owner-a@example.com','/api/household/people/remove',{userId:U['viewer-a@example.com'].id})).status,200);
 assert.equal((await req({path:'/api/log?profile=ann',token:T('viewer-a@example.com')})).status,403,'removed: no household, no access');
 assert.equal((await post('editor-a@example.com','/api/household/leave',{})).status,200);
 assert.equal((await req({path:'/api/log?profile=ann',token:T('editor-a@example.com')})).status,403);
 // profiles: add a child (no login), editors can record for it, rename, delete with confirmation
 const kid=await post('owner-a@example.com','/api/household/members',{name:'Kiddo Example',kind:'child'});assert.equal(kid.status,200,kid.body);
 const kidId=kid.json.member.id;assert.match(kidId,/^kiddo-example-[0-9a-f]{4}$/);assert.equal(kid.json.member.kind,'child');
 assert.match((await req({path:'/config.js',token:T('owner-a@example.com')})).body,new RegExp('"'+kidId+'"'));
 assert.equal((await post('owner-b@example.com','/api/households/switch',{id:U.a})).status,200);
 assert.equal((await post('owner-b@example.com','/api/episodes?profile='+kidId,{title:'Example cold'})).status,201,'an editor records for the child');
 assert.equal((await post('owner-a@example.com','/api/household/members/update',{id:kidId,name:'Kiddo'})).json.member.name,'Kiddo');
 assert.match((await post('owner-a@example.com','/api/household/members/update',{id:kidId,kind:'pet'})).json.error,/kind/);
 assert.match((await post('owner-a@example.com','/api/household/members/remove',{id:kidId,confirm:'wrong'})).json.error,/confirm/);
 assert.equal((await post('owner-a@example.com','/api/household/members/remove',{id:kidId,confirm:'Kiddo'})).status,200);
 assert.equal((await req({path:'/api/episodes?profile='+kidId,token:T('owner-a@example.com')})).status,400,'deleted with its records');
 assert.match((await post('owner-a@example.com','/api/household/members/remove',{id:'ann',confirm:'Ann'})).json.error,/at least one profile/);
 // someone without a household starts one (from the no-household page form)
 assert.equal((await req({path:'/',token:T('lonely@example.com')})).headers.location,'/welcome','people without a household go to onboarding');
 const st=await req({method:'POST',path:'/api/households',token:T('lonely@example.com'),form:{name:'Example Home'}});assert.equal(st.status,303);
 const lh=(await req({path:'/api/household',token:T('lonely@example.com')})).json;assert.equal(lh.household.name,'Example Home');assert.equal(lh.household.role,'owner');assert.equal(lh.members.length,1);assert.match(lh.members[0].id,/^lonely-[0-9a-f]{4}$/);
 assert.equal((await req({path:'/api/log?profile=ann',token:T('lonely@example.com')})).status,400,'a new household sees nothing of the others');
 assert.equal((await req({path:'/api/log?profile=bob',token:T('lonely@example.com')})).status,400);
 // CSRF still applies
 assert.equal((await new Promise(ok=>{const q=http.request({host:'127.0.0.1',port,method:'POST',path:'/api/household/invites',headers:{Host:`localhost:${port}`,Cookie:'apni_session='+T('owner-a@example.com'),Origin:'https://evil.example','Content-Type':'application/json'}},ok);q.end('{}')})).statusCode,403);
 console.log('PASS households: owner-only management, last-owner and last-profile guards, link and email invites (single use, bound email, revoke, sign-up by invite), switching, roles change and removal, child profiles, new households, isolation, CSRF.');
}finally{p.kill();rmSync(dir,{recursive:true,force:true})}

// ---- units: invite expiry ----
{
 const d2=mkdtempSync(join(tmpdir(),'apni-hh-u-'));
 cpSync(src,d2,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
 writeFileSync(join(d2,'unit.mjs'),`import assert from 'node:assert/strict';
const S=await import('./store.mjs'),A=await import('./accounts.mjs');S.enterAs(S.SYSTEM);
const h=S.createHousehold('H'),u=A.createUser('x@example.com'),t0=Date.now(),t=A.createInvite(h.id,'viewer',{},t0);
assert.equal(A.inviteFor(t,t0+6*864e5).role,'viewer');assert.equal(A.inviteFor(t,t0+8*864e5),null,'invites expire after 7 days');
assert.throws(()=>A.acceptInvite(t,u,t0+8*864e5),/expired/);
const db=(await import('./db.mjs')).db();assert.equal(db.prepare('SELECT COUNT(*) n FROM invites WHERE token_hash=?').get(t).n,0,'raw invite tokens are never stored');
assert.equal(A.acceptInvite(t,u,t0).id,h.id);assert.equal(A.membership(h.id,u.id),'viewer');
const t2=A.createInvite(h.id,'owner',{},t0);A.acceptInvite(t2,u,t0);assert.equal(A.membership(h.id,u.id),'viewer','an existing member keeps their role');
assert.match(S.newMemberId('Zoë Example'),/^zoe-example-[0-9a-f]{4}$/);assert.match(S.newMemberId('123'),/^member-/);
console.log('PASS households units: invite expiry, hashed tokens, existing members keep roles, profile ids.');`);
 const u=spawnSync(process.execPath,['unit.mjs'],{cwd:d2,encoding:'utf8',env:{PATH:process.env.PATH,DB_FILE:join(d2,'private/u.db')}});
 rmSync(d2,{recursive:true,force:true});assert.equal(u.status,0,u.stderr+u.stdout);process.stdout.write(u.stdout);
}
