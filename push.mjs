// Web Push (RFC 8030 / 8291 aes128gcm / 8292 VAPID) with Node's built-in crypto only, plus the medicine-reminder scheduler.
// The VAPID key pair comes from VAPID_PRIVATE_JWK (a secret in the environment, e.g. on Workers) or else stays in
// private/vapid.json (generated on first use; a secret, not member data). Subscriptions and sent state are in the database.
// Delivery uses fetch (Node 22 and Workers alike).
import {generateKeyPairSync,createECDH,createCipheriv,randomBytes,hkdfSync,sign} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {listEpisodes} from './events.mjs';
import * as meds from './medicines.mjs';
import * as appts from './appointments.mjs';
import * as members from './members.mjs';
import {system,transaction,listMembers,runAs,SYSTEM} from './store.mjs';
import {zone,inZone,publicOrigin} from './env.mjs';
import {zoneOfMember} from './settings.mjs';
const dir=new URL('./private/',import.meta.url),b64=b=>Buffer.from(b).toString('base64url'),unb64=s=>Buffer.from(s,'base64url');
const rd=(n,d)=>{try{return JSON.parse(readFileSync(new URL(n,dir),'utf8'))}catch(e){if(e.code==='ENOENT')return d;throw e}};
const wr=(n,v)=>{mkdirSync(dir,{recursive:true,mode:0o700});const f=new URL(n,dir),t=new URL(n+'.tmp',dir);writeFileSync(t,JSON.stringify(v,null,2)+'\n',{mode:0o600});renameSync(t,f)};
// ---- VAPID keys (generated once, kept private) ----
// VAPID_PRIVATE_JWK: the private key as a JWK ({"kty":"EC","crv":"P-256","d":...,"x":...,"y":...}). Checked once:
// a malformed or mismatched key fails loudly instead of sending unverifiable pushes.
let envKey=null,envRaw=null;
function fromEnv(raw){
 if(raw===envRaw)return envKey;
 let j;try{j=JSON.parse(raw)}catch{throw Error('VAPID_PRIVATE_JWK is not valid JSON')}
 const b=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
 if(!j||(j.kty&&j.kty!=='EC')||(j.crv&&j.crv!=='P-256')||!b(j.d)||!b(j.x)||!b(j.y))throw Error('VAPID_PRIVATE_JWK must be a P-256 EC private key (JWK with d, x, y)');
 const k={d:j.d,x:j.x,y:j.y};
 try{const e=createECDH('prime256v1');e.setPrivateKey(unb64(k.d));if(!e.getPublicKey().equals(Buffer.concat([Buffer.from([4]),unb64(k.x),unb64(k.y)])))throw 0}catch{throw Error('VAPID_PRIVATE_JWK: d does not match x/y')}
 envRaw=raw;envKey=k;return k;
}
export function vapid(){if(process.env.VAPID_PRIVATE_JWK)return fromEnv(process.env.VAPID_PRIVATE_JWK);let k=rd('vapid.json',null);if(!k){const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const j=privateKey.export({format:'jwk'});k={d:j.d,x:j.x,y:j.y};wr('vapid.json',k)}return k}
export const publicKey=()=>{const k=vapid();return b64(Buffer.concat([Buffer.from([4]),unb64(k.x),unb64(k.y)]))};
export function jwt(audience,now=Date.now(),sub=process.env.VAPID_SUBJECT||publicOrigin()){
 const k=vapid(),h=b64(JSON.stringify({typ:'JWT',alg:'ES256'})),p=b64(JSON.stringify({aud:audience,exp:Math.floor(now/1000)+12*3600,sub}));
 // The key goes in as a JWK, not a KeyObject: Workers' nodejs_compat refuses a KeyObject inside the options object.
 return h+'.'+p+'.'+b64(sign('sha256',Buffer.from(h+'.'+p),{key:{kty:'EC',crv:'P-256',d:k.d,x:k.x,y:k.y},format:'jwk',dsaEncoding:'ieee-p1363'}));
}
// ---- Payload encryption (RFC 8291) ----
export function encrypt(sub,payload){
 const ua=unb64(sub.keys.p256dh),auth=unb64(sub.keys.auth);
 if(ua.length!==65||auth.length<16)throw Error('Bad subscription keys');
 const e=createECDH('prime256v1');e.generateKeys();const asPub=e.getPublicKey(),secret=e.computeSecret(ua);
 const prk=Buffer.from(hkdfSync('sha256',secret,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua,asPub]),32));
 const salt=randomBytes(16),cek=Buffer.from(hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const c=createCipheriv('aes-128-gcm',cek,nonce),ct=Buffer.concat([c.update(Buffer.concat([Buffer.from(payload),Buffer.from([2])])),c.final(),c.getAuthTag()]);
 const rs=Buffer.alloc(4);rs.writeUInt32BE(4096);
 return Buffer.concat([salt,rs,Buffer.from([65]),asPub,ct]);
}
// Sends one encrypted message. Resolves {status, gone} (gone: the push service says the device is gone), or
// {status:0, error} on network errors and timeouts; never rejects. Push services must be https; redirects are not followed.
// endpointOk lets tests allow a plain-http loopback push service.
export async function deliver(sub,payload,{ttl=3600,urgency='high',timeout=15000,endpointOk=u=>u.protocol==='https:'}={}){
 let u;try{u=new URL(sub.endpoint)}catch{return {status:0,gone:true}}
 if(!endpointOk(u))return {status:0,gone:true};
 let body;try{body=encrypt(sub,JSON.stringify(payload))}catch(e){return {status:0,error:e.message}}
 try{
  const res=await fetch(u,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(timeout),body,headers:{
   'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',TTL:String(ttl),Urgency:urgency,
   Authorization:'vapid t='+jwt(u.origin)+', k='+publicKey()}});
  await res.arrayBuffer().catch(()=>{});
  return {status:res.status,gone:res.status===404||res.status===410};
 }catch(e){return {status:0,error:e?.name==='TimeoutError'?'timeout':(e?.cause?.code||e?.message||'network error')}}
}
// ---- Subscriptions: one record per device (endpoint) with the profiles it wants reminders for ----
// Stored in push_subscriptions + push_topics. A device belongs to the user who subscribed from it (userId); devices
// from before accounts have none until someone subscribes from them again. A user only sees and changes their own
// devices, and reminders only go out for profiles the device's user can still access.
export function subs(){
 const d=system(),out=new Map();
 for(const r of d.prepare('SELECT endpoint,p256dh,auth,created_at,muted,user_id FROM push_subscriptions ORDER BY rowid').all())
  out.set(r.endpoint,{endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth},createdAt:r.created_at,profiles:{},appt:{},muted:JSON.parse(r.muted),userId:r.user_id||null});
 for(const t of d.prepare('SELECT endpoint,member_id,topic,since FROM push_topics ORDER BY rowid').all()){const s=out.get(t.endpoint);if(s)(t.topic==='appointments'?s.appt:s.profiles)[t.member_id]={since:t.since}}
 return [...out.values()];
}
function saveSubs(a){
 const d=system(),known=new Set(listMembers().map(m=>m.id)); // all households: this rewrites every device's topics
 transaction(d,()=>{
  d.exec('DELETE FROM push_subscriptions'); // topics cascade
  const s=d.prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,muted,user_id) VALUES(?,?,?,?,?,?)'),t=d.prepare('INSERT INTO push_topics(endpoint,member_id,topic,since) VALUES(?,?,?,?)');
  for(const r of a){s.run(r.endpoint,r.keys.p256dh,r.keys.auth,r.createdAt||0,JSON.stringify(r.muted||[]),r.userId||null);
   for(const [topic,map] of [['medicine',r.profiles],['appointments',r.appt]])for(const [m,info] of Object.entries(map||{}))if(known.has(m))t.run(r.endpoint,m,topic,info?.since||0)}
 });
}
// Sent-reminder keys (push_sent), so a reminder goes out once.
const readState=()=>Object.fromEntries(system().prepare('SELECT key,ts FROM push_sent').all().map(r=>[r.key,r.ts]));
function saveState(state){const d=system();transaction(d,()=>{d.exec('DELETE FROM push_sent');const i=d.prepare('INSERT INTO push_sent(key,ts) VALUES(?,?)');for(const [k,v] of Object.entries(state))i.run(k,v)})}
const valid=s=>s&&typeof s.endpoint==='string'&&s.endpoint.length<2000&&s.keys&&typeof s.keys.p256dh==='string'&&typeof s.keys.auth==='string';
const slot=(r,topic)=>topic==='appointments'?(r.appt??={}):r.profiles;
// A device record the user may see: theirs, or one from before accounts (no user). null otherwise.
const own=(a,endpoint,userId)=>{const r=a.find(x=>x.endpoint===endpoint);return r&&(!r.userId||!userId||r.userId===userId)?r:null};
export function subscribe(sub,profile,now=Date.now(),topic='medicine',userId=null){
 if(!valid(sub)||!members.has(profile)||!['medicine','appointments'].includes(topic))throw Error('Invalid subscription');
 if(new URL(sub.endpoint).protocol!=='https:')throw Error('Invalid endpoint');
 const a=subs();let r=a.find(x=>x.endpoint===sub.endpoint);
 // Someone else signed in on this device: it becomes theirs, starting with no topics.
 if(r&&userId&&r.userId&&r.userId!==userId){r.userId=userId;r.profiles={};r.appt={};r.muted=[]}
 if(!r){r={endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth},createdAt:now,profiles:{},appt:{},muted:[]};a.push(r)}
 if(userId)r.userId=userId;
 r.keys={p256dh:sub.keys.p256dh,auth:sub.keys.auth};const m=slot(r,topic);if(!m[profile])m[profile]={since:now};
 saveSubs(a);return status(sub.endpoint,profile,userId);
}
export function unsubscribe(endpoint,profile,topic='medicine',userId=null){
 let a=subs();const r=own(a,endpoint,userId);if(r){if(profile)delete slot(r,topic)[profile];else a=a.filter(x=>x!==r)}
 saveSubs(a);return status(endpoint,profile,userId);
}
export function mute(endpoint,planId,muted,userId=null){const a=subs(),r=own(a,endpoint,userId);if(!r)throw Error('Not subscribed');r.muted=(r.muted||[]).filter(x=>x!==planId);if(muted)r.muted.push(planId);saveSubs(a);return status(endpoint,undefined,userId)}
export const device=(endpoint,userId=null)=>own(subs(),endpoint,userId);
export function summary(endpoint,userId=null){const r=own(subs(),endpoint,userId);return {known:!!r,profiles:Object.fromEntries(members.ids().map(k=>[k,!!r?.profiles[k]])),appointments:Object.fromEntries(members.ids().map(k=>[k,!!r?.appt?.[k]])),muted:r?.muted||[]}}
export function status(endpoint,profile,userId=null){const r=own(subs(),endpoint,userId);return {subscribed:!!r&&(!profile||!!r.profiles[profile]),muted:r?.muted||[]}}
// ---- Scheduler ----
const LATE=30*6e4,WINDOW=3*36e5;
// Pure: which reminders are due now? state = {sentKey:timestamp}. Returns [{endpoint,profile,keys:[...],items:[{plan,slot,late}]}].
export function due(now,subscriptions,plansOf,state,zoneOf=()=>null){
 const out=[];
 for(const s of subscriptions)for(const [profile,info] of Object.entries(s.profiles||{})){
  const items=[];
  inZone(zoneOf(profile),()=>{for(const p of plansOf(profile)){if((s.muted||[]).includes(p.id))continue;const eff=meds.effective(p);
   for(const sl of meds.slots(p)){const ms=meds.targetMs(p,sl,eff);
    if(p.logs[sl.key]||ms<info.since-5*6e4||now<ms||now>ms+WINDOW)continue;
    const kind=now>=ms+LATE?'late':'due',key=[s.endpoint.slice(-24),p.id,sl.key,kind].join('|');
    if(state[key])continue;items.push({p,sl,ms,kind,key});}
  }});
  if(items.length)out.push({endpoint:s.endpoint,keys:s.keys,profile,items});
 }
 return out;
}
// Pure: appointment reminders due now. state keys: endpoint|appt id|kind
export function dueAppts(now,subscriptions,apptsOf,state,zoneOf=()=>null){
 const out=[];
 for(const s of subscriptions)for(const [profile,info] of Object.entries(s.appt||{})){
  const items=[];
  inZone(zoneOf(profile),()=>{for(const a of apptsOf(profile)){if(a.status!=='scheduled')continue;const start=appts.startMs(a);
   for(const r of appts.reminders(a)){
    if(now<r.at||now>r.at+WINDOW||now>=start+(a.time?0:864e5))continue;
    if(r.at<Math.max(info.since,a.createdAt||0)-5*6e4)continue;
    const key=[s.endpoint.slice(-24),'appt',a.id,r.kind].join('|');if(state[key])continue;items.push({a,kind:r.kind,key,start})}}});
  if(items.length)out.push({endpoint:s.endpoint,keys:s.keys,profile,items});
 }
 return out;
}
const dm=t=>new Date(t).toLocaleDateString('en-GB',{timeZone:zone(),weekday:'short',day:'numeric',month:'short'});
export function apptMessage(n){
 const who=whoPrefix(n.profile),i=n.items[0],more=n.items.length>1?' (+'+(n.items.length-1)+' more)':'';
 const when=i.a.time?hm(i.start):'all day',tomorrow=i.kind==='eve';
 return {title:tomorrow?'Appointment tomorrow':i.a.time?'Appointment in 2 hours':'Appointment today',body:who+i.a.title+more+' · '+(tomorrow?dm(i.start)+' · ':'')+when+(i.a.place?' · '+i.a.place:''),tag:'appt-'+n.profile,url:'/?p='+n.profile+'#calendar'};
}
const hm=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:zone(),hour:'2-digit',minute:'2-digit'});
// With several members, say whose reminder it is.
const whoPrefix=p=>members.list().length>1?members.name(p)+': ':'';
export function message(n){
 const late=n.items.every(i=>i.kind==='late'),names=[...new Set(n.items.map(i=>i.p.name))],times=[...new Set(n.items.map(i=>hm(i.ms)))];
 const who=whoPrefix(n.profile);
 return {title:late?'Medicine not recorded yet':'Time for your medicine',body:who+names.join(', ')+(times.length===1?' · '+times[0]:' · due '+times.join(', ')),tag:'meds-'+n.profile,url:'/?p='+n.profile+'#episodes'};
}
// Drops topics for profiles the device's user can no longer access (removed from the household, or it was deleted).
export function reachable(list){
 const d=system(),q=d.prepare('SELECT 1 FROM members m JOIN memberships s ON s.household_id=m.household_id WHERE m.id=? AND s.user_id=?');
 const keep=(map,u)=>Object.fromEntries(Object.entries(map||{}).filter(([m])=>q.get(m,u)));
 return list.map(s=>s.userId?{...s,profiles:keep(s.profiles,s.userId),appt:keep(s.appt,s.userId)}:s);
}
export async function tick(now=Date.now(),send=deliver){
 let state=readState();
 const live=new Map();const plansOf=pr=>{if(!live.has(pr)){const eps=listEpisodes(pr);live.set(pr,meds.list(pr).filter(p=>eps.some(e=>e.id===p.episodeId)))}return live.get(pr)};
 const current=reachable(subs());
 const list=due(now,current,plansOf,state,zoneOfMember);let changed=false,gone=[];
 const apptsLive=new Map();const apptsOf=pr=>{if(!apptsLive.has(pr))apptsLive.set(pr,appts.list(pr));return apptsLive.get(pr)};
 const alist=dueAppts(now,current,apptsOf,state,zoneOfMember);
 for(const n of list){
  const r=await send({endpoint:n.endpoint,keys:n.keys},inZone(zoneOfMember(n.profile),()=>message(n)),{ttl:n.items.every(i=>i.kind==='late')?900:1800});
  if(r.gone)gone.push(n.endpoint);
  else if(r.status>=200&&r.status<300||r.status===201){for(const i of n.items){state[i.key]=now;if(i.kind==='late')state[i.key.replace(/\|late$/,'|due')]??=now}changed=true}
  else console.error('push failed',r.status,r.error||'');
 }
 for(const n of alist){
  const r=await send({endpoint:n.endpoint,keys:n.keys},inZone(zoneOfMember(n.profile),()=>apptMessage(n)),{ttl:3600});
  if(r.gone)gone.push(n.endpoint);
  else if(r.status>=200&&r.status<300){for(const i of n.items)state[i.key]=now;changed=true}
  else console.error('push failed',r.status,r.error||'');
 }
 if(gone.length)saveSubs(subs().filter(s=>!gone.includes(s.endpoint)));
 for(const k of Object.keys(state))if(now-state[k]>3*864e5){delete state[k];changed=true}
 if(changed)saveState(state);
 return list.length+alist.length;
}
// The scheduler reads every member's plans and appointments, so it runs as the system actor.
export function start(){setInterval(()=>runAs(SYSTEM,()=>tick()).catch(e=>console.error('push tick',e.message)),30000).unref?.()}
