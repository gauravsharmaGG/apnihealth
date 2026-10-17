// Per-profile Apple Health keys (with the legacy shared key migrated) and push subscriptions tied to users,
// end to end with AUTH_MODE=builtin on fictional data.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-ip-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const DB=join(dir,'private/test.db'),env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:DB,AUTH_MODE:'builtin'},LEGACY='legacy-example-key-0000000000';
mkdirSync(join(dir,'private'),{recursive:true});writeFileSync(join(dir,'private/ingest-token.txt'),LEGACY+'\n');
writeFileSync(join(dir,'setup.mjs'),`
const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs');S.enterAs(S.SYSTEM);
const a=S.createHousehold('Household A'),b=S.createHousehold('Household B');
S.addMember(a.id,{id:'ann',name:'Ann'});S.addMember(a.id,{id:'kid',name:'Kid',kind:'child'});S.addMember(b.id,{id:'bob',name:'Bob'});
const out={};
for(const [e,h,r] of [['owner-a@example.com',a,'owner'],['editor-a@example.com',a,'editor'],['viewer-a@example.com',a,'viewer'],['owner-b@example.com',b,'owner']]){const u=A.createUser(e);A.setMembership(h.id,u.id,r);C.recordConsent(u.id);out[e]={id:u.id,token:A.createSession(u.id)}}
const d=S.system();d.prepare("INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,muted) VALUES('https://push.example.com/old','k','a',0,'[]')").run();
d.prepare("INSERT INTO push_topics(endpoint,member_id,topic,since) VALUES('https://push.example.com/old','ann','medicine',0)").run();
console.log(JSON.stringify(out));`);
const r=spawnSync(process.execPath,['setup.mjs'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const U=JSON.parse(r.stdout.trim().split('\n').at(-1));
let p,log='',port;
async function start(){log='';({p,port}=await startServer({cwd:dir,env,onData:d=>log+=d}))}
const req=({method='GET',path,token,body,bearer})=>new Promise((ok,no)=>{const O=`http://localhost:${port}`;const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(token?{Cookie:'apni_session='+token}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(method!=='GET'?{'Content-Type':'application/json',...(bearer?{}:{Origin:O})}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,body:b,json:j})})});q.on('error',no);q.end(body?JSON.stringify(body):undefined)});
const T=e=>U[e].token,post=(e,path,body)=>req({method:'POST',path,token:T(e),body});
const ingest=(bearer,body,q='')=>req({method:'POST',path:'/api/ingest'+q,bearer,body});
const steps=v=>({entries:[{date:'2000-01-01',metric:'steps',value:v}]});
const logOf=async(e,prof)=>(await req({path:'/api/log?profile='+prof,token:T(e)})).json.entries.map(x=>x.value);
try{
 await start();
 assert.match(log,/Registered the existing Apple Health key/);
 // legacy shared key: still works for its household
 assert.equal((await ingest(LEGACY,{...steps(101),profile:'kid'})).json.saved,1);
 assert.deepEqual(await logOf('owner-a@example.com','kid'),[101]);
 assert.equal((await ingest(LEGACY,{...steps(102),profile:'bob'})).status,400);assert.deepEqual(await logOf('owner-b@example.com','bob'),[],'the shared key never reaches another household');
 // per-profile keys
 const keys0=(await req({path:'/api/sync-info?profile=kid',token:T('owner-a@example.com')})).json;
 assert.match(keys0.endpoint,/\/api\/ingest$/);assert.equal(keys0.keys.length,1);assert(keys0.keys[0].shared);
 assert.equal((await req({path:'/api/sync-info?profile=kid',token:T('viewer-a@example.com')})).status,403,'viewers do not see keys');
 assert.equal((await post('viewer-a@example.com','/api/sync-info?profile=kid',{action:'create'})).status,403,'viewers cannot create keys');
 assert.equal((await post('owner-b@example.com','/api/sync-info?profile=kid',{action:'create'})).status,400,'other households cannot create keys');
 const ck=await post('editor-a@example.com','/api/sync-info?profile=kid',{action:'create',label:'Test phone'});assert.equal(ck.status,200,ck.body);
 const kidKey=ck.json.token;assert.match(kidKey,/^[A-Za-z0-9_-]{43}$/);
 const keys1=(await req({path:'/api/sync-info?profile=kid',token:T('owner-a@example.com')})).json.keys;
 assert.deepEqual(keys1.map(k=>[k.label,k.shared]),[['Shared key (from before per-profile keys)',true],['Test phone',false]]);
 assert(!JSON.stringify(keys1).includes(kidKey),'keys are never shown again');
 assert.deepEqual((await req({path:'/api/sync-info?profile=ann',token:T('owner-a@example.com')})).json.keys.map(k=>k.label),['Shared key (from before per-profile keys)'],"kid's key is not listed for ann");
 assert.equal((await ingest(kidKey,steps(201))).json.saved,1,'a profile key needs no profile parameter');
 assert.deepEqual(await logOf('owner-a@example.com','kid'),[201],'Apple Health replaces the same day');
 assert.equal((await ingest(kidKey,{...steps(202),profile:'ann'})).status,403,'a profile key cannot write another profile');
 assert.equal((await ingest(kidKey,steps(203),'?profile=ann')).status,403);
 assert.equal((await ingest(kidKey,{...steps(204),profile:'bob'})).status,403);
 assert.equal((await ingest(kidKey,{...steps(205),profile:'kid'})).status,200);
 assert.equal((await ingest('made-up-key',steps(1))).status,401);
 assert.deepEqual(await logOf('owner-a@example.com','ann'),[]);assert.deepEqual(await logOf('owner-b@example.com','bob'),[]);
 // revoke
 const kidId=keys1.find(k=>!k.shared).id,sharedId=keys1.find(k=>k.shared).id;
 assert.equal((await post('viewer-a@example.com','/api/sync-info?profile=kid',{action:'revoke',id:kidId})).status,403);
 assert.equal((await post('owner-a@example.com','/api/sync-info?profile=ann',{action:'revoke',id:kidId})).status,404,"revoking needs the key's own profile");
 assert.equal((await post('owner-a@example.com','/api/sync-info?profile=kid',{action:'revoke',id:kidId})).status,200);
 assert.equal((await ingest(kidKey,steps(206))).status,401,'revoked');
 assert.equal((await post('owner-a@example.com','/api/sync-info?profile=ann',{action:'revoke',id:sharedId})).status,200);
 assert.equal((await ingest(LEGACY,steps(207))).status,401,'shared key revoked');
 // push: devices belong to users
 const sub=e=>({endpoint:'https://push.example.com/'+e,keys:{p256dh:'k',auth:'a'}}),pushApi=(e,prof,body)=>post(e,'/api/push?profile='+prof,body);
 assert.equal((await pushApi('owner-a@example.com','ann',{action:'subscribe',subscription:sub('a1')})).json.subscribed,true);
 assert.equal((await pushApi('owner-b@example.com','bob',{action:'status',endpoint:sub('a1').endpoint})).json.subscribed,false,"someone else's device looks unknown");
 assert.equal((await pushApi('owner-b@example.com','bob',{action:'summary',endpoint:sub('a1').endpoint})).json.known,false);
 assert.equal((await pushApi('owner-b@example.com','bob',{action:'mute',endpoint:sub('a1').endpoint,planId:'x',muted:true})).status,400);
 assert.equal((await pushApi('owner-b@example.com','bob',{action:'test',endpoint:sub('a1').endpoint})).status,400);
 await pushApi('owner-b@example.com','bob',{action:'unsubscribe-all',endpoint:sub('a1').endpoint});
 assert.equal((await pushApi('owner-a@example.com','ann',{action:'status',endpoint:sub('a1').endpoint})).json.subscribed,true,'others cannot unsubscribe my device');
 assert.equal((await pushApi('owner-b@example.com','bob',{action:'subscribe',subscription:sub('a1')})).json.subscribed,true,'a new login on the same device takes it over');
 assert.equal((await pushApi('owner-a@example.com','ann',{action:'status',endpoint:sub('a1').endpoint})).json.subscribed,false);
 assert.deepEqual(Object.entries((await pushApi('owner-b@example.com','bob',{action:'summary',endpoint:sub('a1').endpoint})).json.profiles),[['bob',true]],'starting with no topics from before');
 // a device from before accounts: visible, then claimed by the next subscriber
 assert.equal((await pushApi('owner-a@example.com','ann',{action:'status',endpoint:sub('old').endpoint})).json.subscribed,true);
 await pushApi('owner-a@example.com','kid',{action:'subscribe',subscription:sub('old'),topic:'appointments'});
 assert.equal((await pushApi('editor-a@example.com','ann',{action:'status',endpoint:sub('old').endpoint})).json.subscribed,false,'claimed by owner-a');
 assert.equal((await pushApi('owner-a@example.com','ann',{action:'status',endpoint:sub('old').endpoint})).json.subscribed,true,'its topics are kept');
 // the scheduler only notifies about profiles the device's user can still reach
 await pushApi('editor-a@example.com','kid',{action:'subscribe',subscription:sub('e1')});
 assert.equal((await post('owner-a@example.com','/api/household/people/remove',{userId:U['editor-a@example.com'].id})).status,200);
 p.kill();
 const unit=spawnSync(process.execPath,['--input-type=module','-e',`const S=await import('./store.mjs'),P=await import('./push.mjs');S.enterAs(S.SYSTEM);
const all=P.subs(),r=P.reachable(all),by=e=>r.find(s=>s.endpoint==='https://push.example.com/'+e);
const raw=S.system().prepare('SELECT COUNT(*) n FROM ingest_tokens WHERE token_hash=? OR label=?').get(process.env.KID_KEY,process.env.KID_KEY).n;
console.log(JSON.stringify({raw,e1:by('e1').profiles,a1:by('a1').profiles,old:[by('old').profiles,by('old').appt],users:all.map(s=>[s.endpoint.split('/').pop(),!!s.userId])}))`],{cwd:dir,env:{...env,KID_KEY:kidKey},encoding:'utf8'});
 assert.equal(unit.status,0,unit.stderr);const R=JSON.parse(unit.stdout.trim());assert.equal(R.raw,0,'raw keys are not stored');
 assert.deepEqual(R.e1,{},'removed from the household: no more reminders about its profiles');
 assert.deepEqual(Object.keys(R.a1),['bob']);assert.deepEqual([Object.keys(R.old[0]),Object.keys(R.old[1])],[['ann'],['kid']]);
 assert(R.users.every(([,u])=>u),'every subscribed device now has a user');
 // restart: the revoked legacy key is not registered again
 await start();assert.doesNotMatch(log,/Registered the existing/);assert.equal((await ingest(LEGACY,steps(208))).status,401);
 console.log('PASS ingest + push: legacy key migrated (household-scoped, revocable, not re-added), per-profile keys (create/list/revoke, editors only, hashed, cannot cross profiles or households), push devices per user (private, takeover, legacy claim), scheduler drops unreachable profiles.');
}finally{p?.kill();rmSync(dir,{recursive:true,force:true})}
