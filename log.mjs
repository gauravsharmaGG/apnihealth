// Self-reported + Apple Health measurements. Stored privately, never served as a static file.
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as members from './members.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const dir=resolve(root,'private'),store=resolve(dir,'health-log.json'),tokenFile=resolve(dir,'ingest-token.txt');
export const profileOk=p=>members.has(p);
export const METRICS={
 weight:{label:'Weight',unit:'kg',min:20,max:300,dp:1},
 steps:{label:'Steps',unit:'steps',min:0,max:150000,dp:0},
 resting_hr:{label:'Resting heart rate',unit:'bpm',min:20,max:250,dp:0},
 bp_sys:{label:'Blood pressure (top)',unit:'mmHg',min:60,max:260,dp:0},
 bp_dia:{label:'Blood pressure (bottom)',unit:'mmHg',min:30,max:160,dp:0},
 sleep:{label:'Sleep',unit:'h',min:0,max:24,dp:1},
 body_fat:{label:'Body fat',unit:'%',min:2,max:70,dp:1}
};
let db;
function load(){if(db)return db;try{db=JSON.parse(readFileSync(store,'utf8'));if(!Array.isArray(db.entries))throw 0}catch{db={entries:[]}}return db}
function save(){mkdirSync(dir,{recursive:true});const t=store+'.tmp';writeFileSync(t,JSON.stringify(db),{mode:0o600});renameSync(t,store)}
export function token(){
 if(!existsSync(tokenFile)){writeFileSync(tokenFile,randomBytes(32).toString('base64url')+'\n',{mode:0o600})}
 return readFileSync(tokenFile,'utf8').trim();
}
export function tokenOk(candidate){
 if(typeof candidate!=='string')return false;const a=Buffer.from(candidate),b=Buffer.from(token());
 return a.length===b.length&&timingSafeEqual(a,b);
}
const dayRe=/^\d{4}-\d{2}-\d{2}$/;
function validDay(d){if(!dayRe.test(d))return false;const t=Date.parse(d+'T12:00:00Z');return Number.isFinite(t)&&t<=Date.now()+36e5*30&&t>=Date.parse('1990-01-01')}
export function clean(e){
 const m=METRICS[e?.metric];if(!m)return null;const v=Number(e.value);if(!Number.isFinite(v)||v<m.min||v>m.max)return null;
 if(!validDay(e.date))return null;
 return {metric:e.metric,date:e.date,value:Number(v.toFixed(m.dp))};
}
export function list(profile=members.defaultId()){const def=members.defaultId();return load().entries.filter(e=>(e.profile||def)===profile).sort((a,b)=>a.date===b.date?a.ts-b.ts:a.date<b.date?-1:1)}
// Manual entries append. Apple Health entries replace the same metric+day (steps keep growing through the day).
export function add(entries,source,profile=members.defaultId()){
 if(!members.has(profile))throw Error('Unknown profile');const def=members.defaultId();
 load();const fresh=[];
 for(const raw of entries){const e=clean(raw);if(e)fresh.push(e)}
 if(!fresh.length)return 0;
 // Apple Health values replace the same metric+day (one pass, so large imports stay fast).
 if(source==='apple-health'){const keys=new Set(fresh.map(e=>e.metric+'|'+e.date));db.entries=db.entries.filter(x=>!(x.source==='apple-health'&&(x.profile||def)===profile&&keys.has(x.metric+'|'+x.date)))}
 const ts=Date.now();for(const e of fresh)db.entries.push({id:randomUUID(),...e,profile,source,ts});
 if(db.entries.length>200000)db.entries=db.entries.slice(-200000);
 save();return fresh.length;
}
export function remove(id,profile){load();const def=members.defaultId(),b=db.entries.length;db.entries=db.entries.filter(e=>!(e.id===id&&(profile===undefined||(e.profile||def)===profile)));if(db.entries.length!==b){save();return true}return false}
const day=s=>{const m=/^(\d{4}-\d{2}-\d{2})/.exec(String(s||''));return m&&m[1]};
// Accepts {entries:[{date,metric,value}]} or the Health Auto Export app's {data:{metrics:[{name,units,data:[...]}]}}.
export function parseIngest(body){
 const out=[];
 if(Array.isArray(body?.entries)){for(const e of body.entries)out.push({metric:e.metric,date:day(e.date),value:e.value});return out}
 const metrics=body?.data?.metrics;if(!Array.isArray(metrics))return out;
 const sums={};const put=(metric,date,v,mode)=>{if(!date||!Number.isFinite(v))return;const k=metric+'|'+date;sums[k]=mode==='sum'?(sums[k]??{metric,date,value:0,v:0}):{metric,date,value:0};if(mode==='sum')sums[k].value+=v;else sums[k].value=v};
 for(const m of metrics){const name=String(m.name||'').toLowerCase();const lbs=/lb/i.test(m.units||'');
  for(const p of m.data||[]){const date=day(p.date||p.startDate);
   if(name==='step_count')put('steps',date,Number(p.qty),'sum');
   else if(name==='weight_body_mass'){const q=Number(p.qty);put('weight',date,lbs?q*0.45359237:q,'last')}
   else if(name==='resting_heart_rate')put('resting_hr',date,Number(p.qty),'last');
   else if(name==='body_fat_percentage')put('body_fat',date,Number(p.qty),'last');
   else if(name==='sleep_analysis'){const h=Number(p.asleep??p.totalSleep??p.qty);put('sleep',date,h,'last')}
   else if(name==='blood_pressure'){put('bp_sys',date,Number(p.systolic),'last');put('bp_dia',date,Number(p.diastolic),'last')}
  }}
 return Object.values(sums);
}
