import assert from 'node:assert/strict';
process.env.APP_TIME_ZONE='Europe/Berlin'; // fixtures below use Berlin offsets
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';import {tmpdir} from 'node:os';
const root=mkdtempSync(tmpdir()+'/apni-med-test-');
try{
for(const f of ['medicines.mjs','events.mjs','members.mjs','env.mjs','db.mjs','migrations.mjs','store.mjs','accounts.mjs','consent.mjs'])cpSync(new URL(f,import.meta.url),root+'/'+f);
process.env.DB_FILE=root+'/private/test.db'; // fictional household from config/members.example.json, one episode for alex
{const S=await import(pathToFileURL(root+'/store.mjs'));S.enterAs(S.SYSTEM);const h=S.createHousehold('Example household');for(const m of JSON.parse(readFileSync(new URL('config/members.example.json',import.meta.url),'utf8')))S.addMember(h.id,m);S.docs('episodes').replace('alex',[{id:'test'}])}
const {validate,slots,mutate,list,zoneDate,effective,targetMs,slotMs}=await import(pathToFileURL(root+'/medicines.mjs'));
const p=validate({name:'Test',days:10,frequency:3,mode:'interval',interval:8,startDate:'2026-10-24',anchor:'2026-10-24T22:00:00+02:00',confirmed:true});
const ss=slots(p);assert.equal(ss.length,30);for(let i=1;i<ss.length;i++)assert.equal(Date.parse(ss[i].at)-Date.parse(ss[i-1].at),8*36e5);assert.equal(zoneDate(ss[1].at),'2026-10-25');assert.equal(new Date(ss[1].at).toLocaleTimeString('en-GB',{timeZone:'Europe/Berlin'}),'05:00:00');
assert.equal(slots({...p,anchor:null}).length,0);assert.equal(slots({...p,confirmed:false}).length,0);
assert.throws(()=>validate({...p,startDate:'2026-02-30'}));assert.throws(()=>validate({...p,interval:7}));assert.throws(()=>validate({...p,mode:'times',times:['08:00','08:00']}));
const times=validate({name:'Test',days:10,frequency:2,mode:'times',startDate:'2026-09-30',times:['08:00','19:00'],confirmed:true});assert.equal(slots(times).length,20);assert.equal(slots(times).at(-1).date,'2026-10-09');
const a=mutate('alex',{action:'plan',episodeId:'test',plan:times}),id=a[0].id;
mutate('alex',{action:'taken',id,key:'0:0',at:'2026-09-30T06:00:00Z'});mutate('alex',{action:'taken',id,key:'0:0',at:'2026-09-30T07:00:00Z'});assert.equal(list('alex')[0].logs['0:0'].at,'2026-09-30T06:00:00.000Z');
assert.throws(()=>mutate('sam',{action:'taken',id,key:'0:0',at:'2026-09-30T06:00Z'}));assert.throws(()=>mutate('alex',{action:'plan',id,plan:{...times,days:11}}));
mutate('alex',{action:'undo',id,key:'0:0'});assert.equal(Object.keys(list('alex')[0].logs).length,0);mutate('alex',{action:'skipped',id,key:'0:1'});assert.equal(list('alex')[0].logs['0:1'].status,'skipped');
assert.throws(()=>mutate('alex',{action:'taken',id,key:'0:0',at:'2099-01-01T00:00Z'}));assert.throws(()=>list('../alex'));

// ---- optional shift for every-N-hours plans ----
{const base={name:'Shifty',days:2,frequency:3,mode:'interval',interval:8,startDate:'2026-10-24',anchor:'2026-10-24T08:00:00+02:00',confirmed:true};
 assert.equal(validate({...base,shift:true}).shift,true);assert.equal(validate(base).shift,false);assert.equal(validate({...base,mode:'times',interval:null,frequency:1,times:['08:00'],anchor:undefined,shift:true}).shift,false,'shift only applies to interval plans');
 const h=n=>new Date(Date.parse('2026-10-24T08:00:00+02:00')+n*36e5).toISOString();
 const sh=validate({...base,shift:true});assert.deepEqual(effective({...sh,logs:{}}),Object.fromEntries(slots(sh).map(s=>[s.key,slotMs(s)])),'nothing logged: no change');
 assert.deepEqual(effective(validate(base)),{},'shift off => empty');
 // first dose taken 2.5 h late -> next ones keep the full 8 h gap
 let e=effective({...sh,logs:{0:{status:'taken',at:h(2.5)}}});assert.equal(e[1],Date.parse(h(10.5)),'next dose = taken + 8h');assert.equal(e[2],Date.parse(h(18.5)),'and it cascades while nothing else is logged');
 // taken early never pulls later doses earlier than planned
 e=effective({...sh,logs:{0:{status:'taken',at:h(-1)}}});assert.equal(e[1],Date.parse(h(8)));
 // a late dose followed by one taken at its ORIGINAL time (earlier than the shifted time) decays back to the plan
 e=effective({...sh,logs:{0:{status:'taken',at:h(2)},1:{status:'taken',at:h(8)}}});assert.equal(e[2],Date.parse(h(16)),'back on the original schedule');
 // skipped dose counts as on its own (shifted) time
 e=effective({...sh,logs:{0:{status:'taken',at:h(2)},1:{status:'skipped',at:null}}});assert.equal(e[2],Date.parse(h(18)));assert.equal(targetMs({...sh,logs:{}},slots(sh)[3]),slotMs(slots(sh)[3]));
 // toggling shift stays possible after doses are recorded; changing the schedule does not
 mkdirSync(root+'/private/profiles/alex',{recursive:true});
 const past={...base,startDate:'2026-10-01',anchor:'2026-10-01T08:00:00+02:00'};
 const a=mutate('alex',{action:'plan',episodeId:'test',plan:past}),pid=a.at(-1).id;
 mutate('alex',{action:'taken',id:pid,key:'0',at:'2026-10-01T07:00:00Z'});
 let L=mutate('alex',{action:'plan',id:pid,plan:{...past,shift:true}});assert.equal(L.find(x=>x.id===pid).shift,true,'shift editable with recorded doses');
 assert.equal(Object.keys(L.find(x=>x.id===pid).logs).length,1,'logs preserved');
 L=mutate('alex',{action:'plan',id:pid,plan:{...past,shift:false}});assert.equal(L.find(x=>x.id===pid).shift,false);
 assert.throws(()=>mutate('alex',{action:'plan',id:pid,plan:{...past,interval:6,frequency:4}}),/recorded doses/);
}
console.log('PASS shift: validation, late/early/skip/decay cascade, toggle allowed with logs, schedule still locked.');
console.log('PASS medication validation, midnight/DST 8h spacing, exact course counts, unset anchors, persistence, duplicate clicks, undo, skip, schedule lock, profile isolation.');
}finally{rmSync(root,{recursive:true,force:true})}
