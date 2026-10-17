import assert from 'node:assert/strict';
process.env.APP_TIME_ZONE='Europe/Berlin'; // fixtures below use Berlin offsets
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const root=mkdtempSync(tmpdir()+'/apni-appt-');
try{
for(const f of ['medicines.mjs','events.mjs','push.mjs','appointments.mjs','members.mjs','env.mjs','db.mjs','migrations.mjs','store.mjs','accounts.mjs','consent.mjs','settings.mjs'])cpSync(new URL(f,import.meta.url),root+'/'+f);
process.env.DB_FILE=root+'/private/test.db'; // fictional household from config/members.example.json, one episode for alex
{const S=await import(pathToFileURL(root+'/store.mjs'));S.enterAs(S.SYSTEM);const h=S.createHousehold('Example household');for(const m of JSON.parse(readFileSync(new URL('config/members.example.json',import.meta.url),'utf8')))S.addMember(h.id,m);S.docs('episodes').replace('alex',[{id:'ep'}])}
const A=await import(pathToFileURL(root+'/appointments.mjs')),P=await import(pathToFileURL(root+'/push.mjs'));
const at=(d,t)=>Date.parse(d+'T'+t+':00+02:00'); // Berlin summer time
// validation
assert.throws(()=>A.validate({title:'',date:'2026-10-12'},'alex'));assert.throws(()=>A.validate({title:'x',date:'2026-02-30'},'alex'));assert.throws(()=>A.validate({title:'x',date:'2026-10-12',time:'25:00'},'alex'));assert.throws(()=>A.validate({title:'x',date:'2026-10-12',episodeId:'nope'},'alex'));assert.throws(()=>A.list('../x'));
const v=A.validate({title:' Check-up ',date:'2026-10-12',category:'Test or scan',episodeId:'ep',durationMinutes:'30'},'alex');assert.equal(v.title,'Check-up');assert.equal(v.time,null);assert.equal(v.durationMinutes,null,'all-day has no duration');
// mutate: add, edit, status, delete, isolation
let l=A.mutate('alex',{action:'save',appointment:{title:'Flu shot',date:'2026-10-12',time:'11:15',durationMinutes:60,place:'Example Clinic, 1 Example Street',category:'Vaccination'}},1000);assert.equal(l.length,1);const id=l[0].id;assert.equal(l[0].status,'scheduled');
l=A.mutate('alex',{action:'save',id,appointment:{title:'Flu shot (moved)',date:'2026-10-13',time:'09:00'}},2000);assert.equal(l[0].title,'Flu shot (moved)');assert.equal(l[0].createdAt,1000);
l=A.mutate('alex',{action:'status',id,status:'done'});assert.equal(l[0].status,'done');assert.throws(()=>A.mutate('alex',{action:'status',id,status:'weird'}));assert.throws(()=>A.mutate('sam',{action:'delete',id}));
// ics
const a={...l[0],status:'scheduled',notes:'Bring card; ask about, things',place:'Example Clinic, 1 Example Street'};const ic=A.ics(a,'Mia',Date.parse('2026-10-05T10:00:00Z'));
assert(ic.startsWith('BEGIN:VCALENDAR\r\n'));assert(ic.includes('DTSTART:20261013T070000Z'));assert(ic.includes('DTEND:20261013T080000Z'));assert(ic.includes('SUMMARY:Mia: Flu shot (moved)'));assert(ic.includes('LOCATION:Example Clinic\\, 1 Example Street'));assert(ic.includes('Bring card\; ask about\\, things'));assert(ic.trimEnd().endsWith('END:VCALENDAR'));assert(ic.split('\r\n').every(x=>Buffer.byteLength(x)<=75));
const ad=A.ics({id:'z',title:'Scan',date:'2026-10-12',time:null,status:'scheduled',category:'Other',notes:''},'');assert(ad.includes('DTSTART;VALUE=DATE:20261012')&&ad.includes('DTEND;VALUE=DATE:20261013')&&!ad.includes('VALARM'));
// reminders
const t1={id:'t1',title:'Flu shot',date:'2026-10-12',time:'11:15',durationMinutes:60,place:'Example Clinic',status:'scheduled',createdAt:0};
const u1={id:'u1',title:'Annual check-up',date:'2026-10-12',time:null,status:'scheduled',createdAt:0};
const r=A.reminders(t1);assert.equal(r[0].at,at('2026-10-11','18:00'));assert.equal(r[1].at,at('2026-10-12','09:15'));assert.equal(A.reminders(u1)[1].at,at('2026-10-12','08:00'));
const sub={endpoint:'https://push.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',keys:{},appt:{alex:{since:at('2026-10-05','10:00')}},profiles:{}};const of=()=>[t1,u1];let st={};
assert.equal(P.dueAppts(at('2026-10-11','17:59'),[sub],of,st).length,0);
let d=P.dueAppts(at('2026-10-11','18:01'),[sub],of,st);assert.equal(d.length,1);assert.equal(d[0].items.length,2);const m=P.apptMessage(d[0]);assert.equal(m.title,'Appointment tomorrow');assert(m.body.includes('Flu shot')&&m.body.includes('(+1 more)'),m.body);
for(const i of d[0].items)st[i.key]=1;assert.equal(P.dueAppts(at('2026-10-11','18:30'),[sub],of,st).length,0,'eve not repeated');
d=P.dueAppts(at('2026-10-12','09:16'),[sub],of,{...st,[sub.endpoint.slice(-24)+'|appt|u1|soon']:1});assert.equal(d[0].items.length,1);assert.equal(P.apptMessage(d[0]).title,'Appointment in 2 hours');
d=P.dueAppts(at('2026-10-12','08:01'),[sub],of,{...st});assert(d[0].items.some(i=>i.a.id==='u1'),'all-day morning reminder at 08:00');
assert.equal(P.dueAppts(at('2026-10-12','11:20'),[sub],of,st).length,0,'nothing once it has started');
assert.equal(P.dueAppts(at('2026-10-11','18:01'),[sub],()=>[{...t1,status:'cancelled'},{...u1,status:'done'}],{}).length,0,'cancelled/done are silent');
assert.equal(P.dueAppts(at('2026-10-11','18:31'),[{...sub,appt:{alex:{since:at('2026-10-11','18:30')}}}],()=>[t1],{}).length,0,'predates enabling');
assert.equal(P.dueAppts(at('2026-10-11','18:01'),[sub],()=>[{...t1,createdAt:at('2026-10-11','19:00')}],{}).length,0,'eve skipped when created after it');
assert.equal(P.dueAppts(at('2026-10-11','18:01'),[{...sub,appt:{}}],of,{}).length,0,'topic off');
// subscription topics are independent
const k={p256dh:'x',auth:'y'};P.subscribe({endpoint:'https://push.example/zzz',keys:k},'alex',1,'appointments');let s=P.summary('https://push.example/zzz');assert.equal(s.appointments.alex,true);assert.equal(s.profiles.alex,false);
P.subscribe({endpoint:'https://push.example/zzz',keys:k},'mia',1);P.unsubscribe('https://push.example/zzz','alex','appointments');s=P.summary('https://push.example/zzz');assert.equal(s.appointments.alex,false);assert.equal(s.profiles.mia,true);assert.equal(s.known,true);
// tick delivers appointment pushes once
P.subscribe({endpoint:'https://push.example/tick',keys:k},'alex',at('2026-10-05','10:00'),'appointments');A.mutate('alex',{action:'save',appointment:{title:'Check-up',date:'2026-10-20',time:'10:00',category:'Check-up'}},at('2026-10-05','10:00'));
const sent=[];assert.equal(await P.tick(at('2026-10-19','18:05'),async(s,m)=>{sent.push(m);return {status:201}}),1);assert.equal(sent[0].tag,'appt-alex');assert.equal(await P.tick(at('2026-10-19','18:10'),async()=>{throw Error('no resend')}),0);
console.log('PASS appointments: validation, CRUD, isolation, .ics (timed/all-day/escaping), reminder timing, dedupe, topics, tick.');
}finally{rmSync(root,{recursive:true,force:true})}
