// Self-reported + Apple Health measurements, in the log_entries table (one row per value, per member).
import {randomUUID} from 'node:crypto';
import * as members from './members.mjs';
import {forMember} from './store.mjs';
export const profileOk=p=>members.has(p);
export const METRICS={
 weight:{label:'Weight',unit:'kg',min:20,max:300,dp:1},
 steps:{label:'Steps',unit:'steps',min:0,max:150000,dp:0},
 resting_hr:{label:'Resting heart rate',unit:'bpm',min:20,max:250,dp:0},
 bp_sys:{label:'Blood pressure (top)',unit:'mmHg',min:60,max:260,dp:0},
 bp_dia:{label:'Blood pressure (bottom)',unit:'mmHg',min:30,max:160,dp:0},
 sleep:{label:'Sleep',unit:'h',min:0,max:24,dp:1},
 body_fat:{label:'Body fat',unit:'%',min:2,max:70,dp:1},
 spo2:{label:'Blood oxygen',unit:'%',min:50,max:100,dp:0},
 hrv:{label:'Heart rate variability',unit:'ms',min:1,max:500,dp:0},
 temperature:{label:'Body temperature',unit:'°C',min:30,max:45,dp:1}
};
const dayRe=/^\d{4}-\d{2}-\d{2}$/;
function validDay(d){if(!dayRe.test(d))return false;const t=Date.parse(d+'T12:00:00Z');return Number.isFinite(t)&&t<=Date.now()+36e5*30&&t>=Date.parse('1990-01-01')}
export function clean(e){
 const m=METRICS[e?.metric];if(!m)return null;const v=Number(e.value);if(!Number.isFinite(v)||v<m.min||v>m.max)return null;
 if(!validDay(e.date))return null;
 return {metric:e.metric,date:e.date,value:Number(v.toFixed(m.dp))};
}
export function list(profile=members.defaultId()){
 return forMember(profile).all('SELECT id,metric,date,value,source,ts FROM log_entries WHERE member_id=$member ORDER BY date,ts,rowid').map(e=>({...e,profile}));
}
// Manual entries append. Apple Health entries replace the same metric+day (steps keep growing through the day).
export function add(entries,source,profile=members.defaultId()){
 const m=forMember(profile),fresh=[];
 for(const raw of entries){const e=clean(raw);if(e)fresh.push(e)}
 if(!fresh.length)return 0;
 const ts=Date.now();
 m.tx(()=>{
  if(source==='apple-health')for(const e of fresh)m.run("DELETE FROM log_entries WHERE member_id=$member AND source='apple-health' AND metric=$metric AND date=$date",{metric:e.metric,date:e.date});
  for(const e of fresh)m.run('INSERT INTO log_entries(id,member_id,metric,date,value,source,ts) VALUES($id,$member,$metric,$date,$value,$source,$ts)',{id:randomUUID(),...e,source,ts});
 });
 return fresh.length;
}
export function remove(id,profile){return forMember(profile).run('DELETE FROM log_entries WHERE member_id=$member AND id=$id',{id:String(id)}).changes>0}
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
   else if(name==='oxygen_saturation'||name==='blood_oxygen_saturation'){const q=Number(p.qty??p.Avg);put('spo2',date,q>0&&q<=1?q*100:q,'last')} // a fraction or a percentage
   else if(name==='heart_rate_variability'||name==='heart_rate_variability_sdnn')put('hrv',date,Number(p.qty??p.Avg),'last');
   else if(name==='body_temperature'){const q=Number(p.qty);put('temperature',date,/f/i.test(m.units||'')?(q-32)*5/9:q,'last')}
   else if(name==='blood_pressure'){put('bp_sys',date,Number(p.systolic),'last');put('bp_dia',date,Number(p.diastolic),'last')}
  }}
 return Object.values(sums);
}
