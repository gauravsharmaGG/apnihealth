#!/usr/bin/env node
// Preview-only dummy-data seed. Run from the repo root with PREVIEW_MODE=1. Every value below is fictional.
// Writes only into ./private; refuses if private/ exists without the .preview marker (could be real data).
import {existsSync,mkdirSync,writeFileSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.env.PREVIEW_MODE!=='1')throw Error('preview seed: PREVIEW_MODE=1 is required');
const wt=process.cwd(),P=p=>resolve(wt,p);
const ADULT='alex',CHILD='mia'; // ids from config/members.example.json; the data is fictional
if(!existsSync(P('server.mjs'))||!existsSync(P('medicines.mjs')))throw Error('not an apnihealth worktree');
if(existsSync(P('private'))&&!existsSync(P('private/.preview')))throw Error('private/ exists without .preview marker: refusing (could be real data)');
if(process.env.DB_FILE&&!resolve(process.env.DB_FILE).startsWith(P('private')+'/'))throw Error('preview seed: DB_FILE must be inside ./private (refusing to write a database elsewhere)');
if(existsSync(P('private/.preview')))rmSync(P('private'),{recursive:true,force:true}); // reseed from scratch (marker proves it is preview data)
mkdirSync(P('private/profiles'),{recursive:true,mode:0o700});writeFileSync(P('private/.preview'),'dummy data only\n');
let s=20261011;const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
const day=o=>new Date(Date.now()+o*864e5).toISOString().slice(0,10);
const J=(f,v)=>writeFileSync(P(f),JSON.stringify(v,null,2)+'\n');
// build inputs
copyFileSync(P('config/overview.example.json'),P('private/overview.json'));
J('private/reports.json',[['example-labs-c.pdf','Example follow-up labs','recent','2 pages'],['example-labs-b.pdf','Example blood tests','recent','2 pages'],['example-labs-a.pdf','Example general labs','spring','3 pages'],['example-checkup.pdf','Example health check','winter','10 pages']]);
const labs=[['Hemoglobin','g/dL','14.1','13.6','13-17'],['Platelets','/nL','240','255','150-400'],['CRP','mg/L','1.2','6.8 ↑','<5'],['Creatinine','mg/dL','0.9','0.95','0.7-1.2'],['Fasting glucose','mg/dL','92','101 ↑','70-99'],['HbA1c','%','5.3','5.4','<5.7'],['ALT','U/L','28','35','<50'],['AST','U/L','24','26','<50'],['LDL','mg/dL','128 ↑','118','<116'],['HDL','mg/dL','52','55','>40'],['Vitamin B12','pg/mL','310','290','200-900'],['25-OH vitamin D','ng/mL','18 ↓','27 ↓','30-100'],['TSH','mU/L','1.8','2.1','0.4-4.0'],['Iron','µg/dL','95','80','60-160']];
const report=(file,iso,col,page=1)=>({file,iso,values:labs.map(([name,unit,a,b,ref])=>({name,value:col?b:a,unit,reference:ref,page}))});
J('private/lab-values.json',[
 {file:'example-checkup.pdf',iso:day(-270),screening:true,values:[{name:'Resting heart rate',value:'62 bpm',page:2},{name:'Weight',value:'71 kg',page:2},{name:'Air blown out: % of expected (FVC)',value:'98 %',page:3}]},
 report('example-labs-a.pdf',day(-190),0),report('example-labs-b.pdf',day(-30),1),
 {file:'example-labs-c.pdf',iso:day(-5),reported:day(-3),preliminary:true,values:[{name:'Ferritin',value:'45 ng/mL',unit:'ng/mL',reference:'30-300',page:1},{name:'Potassium',value:'4.1 mmol/L',unit:'mmol/L',reference:'3.5-5.1',page:1},{name:'Sodium',value:'131 mmol/L ↓',unit:'mmol/L',reference:'135-145',page:2}],pending:[{name:'Soluble transferrin receptor (sTfR)',note:'Fictional pending result for previews.'}]}]);
mkdirSync(P('private/profiles/'+CHILD),{recursive:true,mode:0o700});copyFileSync(P('config/child-record.example.json'),P('private/profiles/'+CHILD+'/child-record.json'));
writeFileSync(P('private/ingest-token.txt'),'preview-not-a-real-token-000000000000\n',{mode:0o600});
// app data through the app's own modules (validation stays in sync with the code)
const imp=f=>import(pathToFileURL(P(f)).href);
const store=await imp('store.mjs'),house=store.createHousehold('Example household');
for(const m of JSON.parse(readFileSync(P('config/members.example.json'),'utf8')))store.addMember(house.id,m);
const ev=await imp('events.mjs'),meds=await imp('medicines.mjs'),appts=await imp('appointments.mjs'),hlog=await imp('log.mjs');
const ep=ev.addEpisode(ADULT,{title:'Example cold',category:'Illness',startDate:day(-3),summary:'Fictional episode for previews.'});
ev.addEpisode(ADULT,{title:'Example sprained ankle',category:'Injury',startDate:day(-60),status:'resolved',endDate:day(-45)});
const ep2=ev.addEpisode(CHILD,{title:'Example fever',category:'Illness',startDate:day(-1)});
for(const [p,e,name,strength,times] of [[ADULT,ep,'Example syrup','5 ml',['08:00','20:00']],[ADULT,ep,'Example tablet','400 mg',['08:00','14:00','20:00']],[CHILD,ep2,'Example drops','2 drops',['09:00','21:00']]])
 meds.mutate(p,{action:'plan',episodeId:e.id,plan:{name,strength,days:5,frequency:times.length,startDate:day(-1),mode:'times',times,confirmed:true}});
for(const [o,t,c,time,place] of [[-20,'Example dentist check','Dentist','09:30','Example Dental Practice'],[0,'Example blood test','Test or scan','08:15','Example Lab'],[3,'Example check-up','Check-up','16:00','Example Clinic'],[21,'Example vaccination','Vaccination','10:00','Example Paediatrics'],[45,'Example specialist','Specialist','11:30','Example Hospital']])
 appts.mutate(o===21?CHILD:ADULT,{action:'save',appointment:{title:t,date:day(o),time,durationMinutes:30,place,category:c}});
const a0=appts.list(ADULT)[0];if(a0)appts.mutate(ADULT,{action:'status',id:a0.id,status:'done'});
const entries=[];for(let d=-90;d<=0;d++){entries.push({metric:'steps',date:day(d),value:Math.round(4000+rnd()*8000)},{metric:'resting_hr',date:day(d),value:Math.round(58+rnd()*8)},{metric:'sleep',date:day(d),value:+(6+rnd()*2.5).toFixed(1)});if(d%7===0)entries.push({metric:'weight',date:day(d),value:+(72-d/60+rnd()).toFixed(1)})}
hlog.add(entries,'manual',ADULT);
console.log('seeded apnihealth preview data (fictional) in',wt);
