// One-time import of the JSON layout in private/ (members.json, health-log.json, profiles/<id>/*.json,
// push-subs.json, push-state.json) into the SQLite database. It never modifies or deletes the JSON files
// (uploaded files stay where they are), refuses to run into a database that already has a household, and
// reports counts only, never values. dryRun performs the whole import inside a transaction and rolls it back.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {db,transaction} from './db.mjs';
import {createHousehold,addMember,docs,households,system,runAs,SYSTEM} from './store.mjs';
import {validate} from './members.mjs';
import {addReport} from './labs.mjs';

const FILES={episodes:'episodes.json',episode_entries:'events.json',inbox_items:'inbox.json',medicine_plans:'medicines.json',appointments:'appointments.json'};
class Rollback extends Error{}
function readJson(file,fallback){
 if(!existsSync(file))return fallback;
 try{return JSON.parse(readFileSync(file,'utf8'))}catch{throw Error(`${file.split('/').slice(-2).join('/')} is not valid JSON`)}
}
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d);

export const importJson=opts=>runAs(SYSTEM,()=>importAll(opts));
function importAll({privateDir,householdName='Household',dryRun=false}){
 const d=db();
 if(households().length)throw Error('The database already has a household; import only runs into an empty database');
 const raw=readJson(join(privateDir,'members.json'),null);
 if(!Array.isArray(raw)||!raw.length)throw Error('members.json is missing or empty');
 const list=validate(raw);
 const known=new Set(list.map(m=>m.id)),def=list[0].id;
 const counts={members:list.length,log_entries:0,episodes:0,episode_entries:0,inbox_items:0,medicine_plans:0,appointments:0,push_subscriptions:0,push_topics:0,push_sent:0,lab_reports:0,lab_values:0,skipped:0,missing_upload_files:0,unknown_profile_dirs:0};
 try{
  transaction(d,()=>{
   const h=createHousehold(householdName);
   for(const m of list)addMember(h.id,m);
   // daily log
   const log=readJson(join(privateDir,'health-log.json'),{entries:[]});
   const ins=d.prepare('INSERT INTO log_entries(id,member_id,metric,date,value,source,ts) VALUES($id,$member,$metric,$date,$value,$source,$ts)');
   const seen=new Set();
   for(const e of Array.isArray(log?.entries)?log.entries:[]){
    const member=e?.profile??def,value=Number(e?.value);
    if(!known.has(member)||typeof e.id!=='string'||seen.has(e.id)||typeof e.metric!=='string'||!dayOk(e.date)||!Number.isFinite(value)){counts.skipped++;continue}
    seen.add(e.id);ins.run({id:e.id,member,metric:e.metric,date:e.date,value,source:typeof e.source==='string'?e.source:'manual',ts:Number.isFinite(e.ts)?e.ts:0});counts.log_entries++;
   }
   // per-member documents
   const dirs=existsSync(join(privateDir,'profiles'))?readdirSync(join(privateDir,'profiles'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name):[];
   for(const dir of dirs){
    if(!known.has(dir)){counts.unknown_profile_dirs++;continue}
    for(const [table,file] of Object.entries(FILES)){
     const arr=readJson(join(privateDir,'profiles',dir,file),[]);
     if(!Array.isArray(arr))throw Error(`profiles/<member>/${file} must be a list`);
     const ids=new Set(),ok=arr.filter(r=>{const good=r&&typeof r==='object'&&typeof r.id==='string'&&r.id&&!ids.has(r.id);if(good)ids.add(r.id);else counts.skipped++;return good});
     docs(table).replace(dir,ok);counts[table]+=ok.length;
     if(table==='inbox_items')for(const r of ok)if(!r.storedFileName||!existsSync(join(privateDir,'profiles',dir,'uploads',r.storedFileName)))counts.missing_upload_files++;
    }
   }
   // push subscriptions and sent-reminder state
   const subs=readJson(join(privateDir,'push-subs.json'),[]);
   const sIns=system().prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at,muted) VALUES($endpoint,$p256dh,$auth,$created,$muted)');
   const tIns=system().prepare('INSERT INTO push_topics(endpoint,member_id,topic,since) VALUES($endpoint,$member,$topic,$since)');
   const eps=new Set();
   for(const s of Array.isArray(subs)?subs:[]){
    if(!s||typeof s.endpoint!=='string'||eps.has(s.endpoint)||typeof s.keys?.p256dh!=='string'||typeof s.keys?.auth!=='string'){counts.skipped++;continue}
    eps.add(s.endpoint);
    sIns.run({endpoint:s.endpoint,p256dh:s.keys.p256dh,auth:s.keys.auth,created:Number.isFinite(s.createdAt)?s.createdAt:0,muted:JSON.stringify(Array.isArray(s.muted)?s.muted.filter(x=>typeof x==='string'):[])});counts.push_subscriptions++;
    for(const [topic,map] of [['medicine',s.profiles],['appointments',s.appt]])for(const [member,info] of Object.entries(map||{})){
     if(!known.has(member)){counts.skipped++;continue}
     tIns.run({endpoint:s.endpoint,member,topic,since:Number.isFinite(info?.since)?info.since:0});counts.push_topics++;
    }
   }
   const state=readJson(join(privateDir,'push-state.json'),{});
   const pIns=system().prepare('INSERT INTO push_sent(key,ts) VALUES(?,?)');
   for(const [k,ts] of Object.entries(state&&typeof state==='object'?state:{}))if(Number.isFinite(ts)){pIns.run(k,ts);counts.push_sent++}
   // lab results (private/lab-values.json, the old build input) go to the lab-results member, else the first adult
   const labs=readJson(join(privateDir,'lab-values.json'),[]);
   if(!Array.isArray(labs))throw Error('lab-values.json must be a list of reports');
   if(labs.length){
    const owner=(list.find(m=>m.labs)||list.find(m=>m.kind==='adult')||list[0]).id;
    labs.forEach((r,i)=>{
     let rep;try{rep=addReport(owner,{date:r?.iso,reported:r?.reported,source:r?.file,screening:r?.screening===true,preliminary:r?.preliminary===true,values:r?.values,pending:r?.pending},{privateDir})}
     catch(e){throw Error('lab-values.json entry '+i+': '+e.message)}
     counts.lab_reports++;counts.lab_values+=rep.values.length;
    });
   }
   if(dryRun)throw new Rollback();
  });
 }catch(e){if(!(e instanceof Rollback))throw e}
 return {dryRun,counts};
}
