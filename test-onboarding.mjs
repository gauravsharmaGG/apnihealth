// First-run onboarding on fictional data: people without a household and owners of a new household land on
// /welcome; creating the household adds the owner as an adult profile; other profiles; tracked measurements,
// time zone and units (validated, owner-only, used by the client and the server); a per-profile Apple Health key
// that only adds to its profile (with unit conversion); finishing; existing households are never sent back.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-ob-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin',APP_TIME_ZONE:'UTC'};
const node=code=>{const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
const U=JSON.parse(node(`const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs');S.enterAs(S.SYSTEM);
const a=S.createHousehold('Household A');S.addMember(a.id,{id:'ann',name:'Ann'});
const b=S.createHousehold('Household B',{onboarded:false});S.addMember(b.id,{id:'bob',name:'Bob'});
const out={};for(const [e,h,r] of [['owner-a@example.com',a,'owner'],['new@example.com',null,null],['owner-b@example.com',b,'owner'],['editor-b@example.com',b,'editor']]){const u=A.createUser(e);if(h)A.setMembership(h.id,u.id,r);C.recordConsent(u.id);out[e]=A.createSession(u.id)}
console.log(JSON.stringify(out))`));
let p;
try{
 const s=await startServer({cwd:dir,env});p=s.p;const port=s.port,O=`http://localhost:${port}`;
 const req=({method='GET',path,who,json,bearer})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(who?{Cookie:'apni_session='+U[who]}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:O}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,headers:res.headers,body:b,json:j})})});q.on('error',no);q.end(json?JSON.stringify(json):undefined)});
 const N='new@example.com',post=(path,json,who=N)=>req({method:'POST',path,who,json});
 // no household yet: onboarding
 assert.equal((await req({path:'/',who:N})).headers.location,'/welcome');
 const w=await req({path:'/welcome',who:N});assert.equal(w.status,200);assert.match(w.body,/src="\/onboarding.js"/);
 assert.equal((await req({path:'/onboarding.js',who:N})).status,200);assert.equal((await req({path:'/style.css',who:N})).status,200);
 let o=(await req({path:'/api/onboarding',who:N})).json;assert.equal(o.household,null);
 assert.deepEqual(o.metricGroups.map(g=>g.id).sort(),['blood_pressure','body_fat','heart_rate','hrv','sleep','spo2','steps','temperature','weight']);
 assert.deepEqual(o.core.map(c=>c.id),['episodes','medicines','appointments','labs']);
 assert.equal((await req({path:'/welcome'})).headers.location,'/login','signed out: sign in first');
 // 1. household and own adult profile
 const h=await post('/api/households',{name:'Example Home',memberName:'Alex Example'});assert.equal(h.status,200);
 o=(await req({path:'/api/onboarding',who:N})).json;
 assert.equal(o.household.name,'Example Home');assert.equal(o.household.role,'owner');assert.equal(o.household.onboarded,false);
 assert.deepEqual(o.members.map(m=>[m.name,m.kind]),[['Alex Example','adult']]);
 assert.equal((await req({path:'/',who:N})).headers.location,'/welcome','owner of an unfinished household continues onboarding');
 // 2. other profiles
 const kid=(await post('/api/household/members',{name:'Sam Example',kind:'child'})).json.member;assert.equal(kid.kind,'child');
 assert.equal((await post('/api/household/members',{name:'Jo Example',kind:'adult'})).json.member.kind,'adult');
 // 3 + 4. measurements, time zone, units: validated
 for(const bad of [{metrics:['weight','blood_sugar']},{metrics:'weight'},{timeZone:'Mars/Olympus'},{units:{weight:'stone'}},{units:{temperature:'K'}}])
  assert.equal((await post('/api/household/settings',bad)).status,400,JSON.stringify(bad));
 let st=(await post('/api/household/settings',{metrics:['weight','spo2','temperature','sleep']})).json.settings;
 assert.deepEqual(st.metrics,['weight','spo2','temperature','sleep']);
 st=(await post('/api/household/settings',{timeZone:'America/New_York',units:{weight:'lb',temperature:'F'}})).json.settings;
 assert.equal(st.timeZone,'America/New_York');assert.deepEqual(st.units,{weight:'lb',temperature:'F'});assert.deepEqual(st.metrics,['weight','spo2','temperature','sleep'],'partial updates keep the rest');
 // 5. Apple Health key for the child's profile: only adds there, converts units to metric
 const key=(await post('/api/sync-info?profile='+kid.id,{action:'create',label:'Apple Health'})).json;assert.match(key.token,/^[A-Za-z0-9_-]{43}$/);assert.match(key.endpoint,/\/api\/ingest$/);
 const ing=await req({method:'POST',path:'/api/ingest',bearer:key.token,json:{data:{metrics:[{name:'oxygen_saturation',units:'%',data:[{date:'2026-01-02 08:00:00 +0000',qty:0.97}]},{name:'body_temperature',units:'degF',data:[{date:'2026-01-02',qty:98.6}]},{name:'heart_rate_variability',units:'ms',data:[{date:'2026-01-02',qty:45}]},{name:'weight_body_mass',units:'lb',data:[{date:'2026-01-02',qty:44.1}]}]}}});
 assert.equal(ing.json.saved,4);
 const vals=Object.fromEntries((await req({path:'/api/log?profile='+kid.id,who:N})).json.entries.map(e=>[e.metric,e.value]));
 assert.deepEqual(vals,{spo2:97,temperature:37,hrv:45,weight:20},'stored in metric units');
 assert.equal((await req({method:'POST',path:'/api/ingest?profile=ann',bearer:key.token,json:{entries:[{metric:'steps',date:'2026-01-02',value:1}]}})).status,403,'a key cannot write to another profile');
 // the app gets the settings; the server uses the household's zone
 const cfg=await req({path:'/config.js',who:N});assert.match(cfg.body,/"timeZone":"America\/New_York"/);assert.match(cfg.body,/"settings":\{"metrics":\["weight","spo2","temperature","sleep"\],"units":\{"weight":"lb","temperature":"F"\}\}/);
 const appt=(await post('/api/appointments?profile='+kid.id,{action:'save',appointment:{title:'Checkup',category:'checkup',date:'2026-03-02',time:'09:30'}})).json;
 assert(appt.appointments?.length===1,JSON.stringify(appt));
 const ics=(await req({path:`/api/appointments/ics?profile=${kid.id}&id=${appt.appointments[0].id}`,who:N})).body;assert.match(ics,/DTSTART:20260302T143000Z/,'09:30 in New York is 14:30 UTC');
 // finish
 assert.equal((await post('/api/household/onboarded',{})).status,200);
 assert.equal((await req({path:'/',who:N})).headers.location,undefined,'done: the app opens');
 assert.equal((await req({path:'/api/onboarding',who:N})).json.household.onboarded,true);
 // only owners change settings or finish; editors of an unfinished household are not sent to onboarding
 assert.equal((await post('/api/household/settings',{metrics:[]},'editor-b@example.com')).status,403);
 assert.equal((await post('/api/household/onboarded',{},'editor-b@example.com')).status,403);
 assert.equal((await req({path:'/',who:'editor-b@example.com'})).headers.location,undefined);
 assert.equal((await req({path:'/',who:'owner-b@example.com'})).headers.location,'/welcome');
 // households that already existed (or were imported) are never sent to onboarding, and keep every measurement
 assert.equal((await req({path:'/',who:'owner-a@example.com'})).headers.location,undefined);
 assert.deepEqual((await req({path:'/api/household',who:'owner-a@example.com'})).json.settings.metrics,['weight','body_fat','sleep','steps','heart_rate','blood_pressure']);
 assert.match((await req({path:'/config.js',who:'owner-a@example.com'})).body,/"timeZone":"UTC"/);
 // isolation: the new household sees nothing of the others, and the others nothing of it
 assert.equal((await req({path:'/api/log?profile=ann',who:N})).status,400);
 assert.equal((await req({path:'/api/log?profile='+kid.id,who:'owner-a@example.com'})).status,400);
 assert.equal((await post('/api/sync-info?profile=ann',{action:'create'})).status,400);
 // reminders outside requests use each profile's household zone
 assert.equal(node(`const S=await import('./settings.mjs'),E=await import('./env.mjs'),M=await import('./medicines.mjs');
const z=S.zoneOfMember(${JSON.stringify(kid.id)});console.log(z,S.zoneOfMember('ann'),E.inZone(z,()=>M.zoneDate(Date.parse('2026-01-01T03:00:00Z'))),M.zoneDate(Date.parse('2026-01-01T03:00:00Z')))`),'America/New_York UTC 2025-12-31 2026-01-01');
 // upgrading: households that exist before the onboarding migration count as set up
 assert.equal(node(`const {DatabaseSync}=await import('node:sqlite'),{MIGRATIONS}=await import('./migrations.mjs'),D=await import('./db.mjs');
const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
for(const m of MIGRATIONS.filter(m=>m.version<9)){d.exec(m.sql);d.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(m.version,m.name,'x')}
d.prepare("INSERT INTO households(id,name,created_at) VALUES('h1','Old','2020-01-01T00:00:00.000Z')").run();D.migrate(d);
console.log(d.prepare('SELECT onboarded_at FROM households').get().onboarded_at)`),'2020-01-01T00:00:00.000Z');
 console.log('PASS onboarding: /welcome for new people and unfinished households, own adult profile, more profiles, validated owner-only settings (measurements, time zone, units), per-profile Apple Health key with unit conversion, household zone in config/ics/reminders, finishing, existing households untouched, isolation.');
}finally{p?.kill();rmSync(dir,{recursive:true,force:true})}
