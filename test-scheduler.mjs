// scheduler.mjs: one entry point for the periodic jobs (Node timer or Workers Cron Trigger): hourly purge of
// expired sessions, reminders through push.tick with the given time and sender, NO_PUSH respected, no overlap,
// errors reported instead of thrown.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'apni-sched-'));
process.env.DB_FILE=join(dir,'test.db');delete process.env.NO_PUSH;process.env.APP_TIME_ZONE='Europe/Berlin';
try{
 const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs'),M=await import('./medicines.mjs'),ev=await import('./events.mjs'),P=await import('./push.mjs');
 const {runScheduled,startScheduler,resetScheduler,PURGE_EVERY}=await import('./scheduler.mjs');
 S.enterAs(S.SYSTEM);
 const h=S.createHousehold('Example household');S.addMember(h.id,{id:'alex',name:'Alex'});
 const u=A.createUser('owner@example.com');A.setMembership(h.id,u.id,'owner');C.recordConsent(u.id);
 const T0=Date.parse('2026-10-05T06:01:00Z'); // 08:01 in Berlin
 const sessions=()=>S.system().prepare('SELECT COUNT(*) n FROM sessions').get().n;
 A.createSession(u.id,T0-40*864e5);A.createSession(u.id,T0); // one long expired, one live
 assert.equal(sessions(),2);
 // purge runs on the first call, then at most once per hour; push skipped with push:false
 let r=await runScheduled(T0,{push:false});assert.deepEqual(r,{purged:true,pushed:0,errors:[]});assert.equal(sessions(),1,'expired session purged');
 A.createSession(u.id,T0-40*864e5);
 r=await runScheduled(T0+60e3,{push:false});assert.equal(r.purged,false,'not again within the hour');assert.equal(sessions(),2);
 r=await runScheduled(T0+PURGE_EVERY,{push:false});assert.equal(r.purged,true);assert.equal(sessions(),1);
 // reminders: tick runs with the scheduled time and the given sender (a medicine due at 08:00)
 const e=ev.addEpisode('alex',{title:'Example cold',category:'Illness',startDate:'2026-10-05'});
 M.mutate('alex',{action:'plan',episodeId:e.id,plan:M.validate({name:'Medicine A',days:3,frequency:2,mode:'times',startDate:'2026-10-05',times:['08:00','20:00'],confirmed:true})});
 const {createECDH,randomBytes}=await import('node:crypto');const ua=createECDH('prime256v1');ua.generateKeys();
 P.subscribe({endpoint:'https://push.example/device-1',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},'alex',T0-36e5,'medicine',u.id);
 const sent=[];const send=async(s,m)=>{sent.push({endpoint:s.endpoint,title:m.title});return {status:201}};
 r=await runScheduled(T0+60e3,{send});assert.equal(r.pushed,1);assert.deepEqual(r.errors,[]);
 assert.deepEqual(sent,[{endpoint:'https://push.example/device-1',title:'Time for your medicine'}]);
 r=await runScheduled(T0+120e3,{send});assert.equal(r.pushed,0,'not sent twice');assert.equal(sent.length,1);
 // NO_PUSH turns reminders off by default
 process.env.NO_PUSH='1';r=await runScheduled(Date.parse('2026-10-05T18:01:00Z'),{send});assert.equal(sent.length,1,'NO_PUSH: no reminders');delete process.env.NO_PUSH;
 // no overlap: a second call while a slow run is in progress is skipped
 let release;const slow=()=>new Promise(ok=>{release=()=>ok({status:201})});
 const first=runScheduled(Date.parse('2026-10-05T18:02:00Z'),{send:slow});
 assert.deepEqual(await runScheduled(Date.parse('2026-10-05T18:02:10Z'),{send}),{skipped:true});
 await new Promise(ok=>setTimeout(ok,50));release();r=await first;assert.equal(r.pushed,1,'the 20:00 dose');
 r=await runScheduled(Date.parse('2026-10-05T18:03:00Z'),{send});assert.notEqual(r.skipped,true,'runs again once the slow one finished');
 // errors are reported, not thrown, and do not stop the other job
 resetScheduler();const dbFile=process.env.DB_FILE;
 const db=await import('./db.mjs');db.close();process.env.DB_FILE=join(dir,'missing-dir','\0bad');
 r=await runScheduled(T0+3*PURGE_EVERY,{send});assert.equal(r.purged,false);assert.match(r.errors.join(' '),/^purge: .*push: /);
 process.env.DB_FILE=dbFile;db.close();
 // startScheduler returns an unref'd timer
 const t=startScheduler(1e9);assert.equal(t.hasRef(),false);clearInterval(t);
 console.log('PASS scheduler: hourly purge, reminders with the given time and sender, NO_PUSH, no overlapping runs, errors reported not thrown, unref timer.');
}finally{rmSync(dir,{recursive:true,force:true})}
