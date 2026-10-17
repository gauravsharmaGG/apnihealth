import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {listEpisodes} from './events.mjs';
import * as members from './members.mjs';
import {TIME_ZONE} from './env.mjs';
const base=new URL('./private/profiles/',import.meta.url);
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00Z').toISOString().slice(0,10)===s;
const timeOK=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function validate(v){
 if(!v||typeof v!=='object')throw Error('Invalid plan');
 const name=String(v.name||'').trim(),strength=String(v.strength||'').trim();
 if(!name||name.length>80||strength.length>80)throw Error('Check medicine name / strength');
 const days=Number(v.days),frequency=Number(v.frequency);
 if(!Number.isInteger(days)||days<1||days>365||!Number.isInteger(frequency)||frequency<1||frequency>8)throw Error('Check duration and doses per day');
 if(v.startDate&&!dateOK(v.startDate))throw Error('Invalid start date');
 const mode=v.mode==='interval'?'interval':'times',interval=mode==='interval'?Number(v.interval):null;
 if(mode==='interval'&&(!Number.isFinite(interval)||interval<1||interval>48||24/interval!==frequency))throw Error('Interval must match daily frequency');
 const times=Array.isArray(v.times)?v.times:[];
 if(times.some(t=>!timeOK(t))||new Set(times).size!==times.length||times.length>frequency)throw Error('Invalid or duplicate times');
 const anchor=v.anchor||null;
 if(anchor&&(!Number.isFinite(Date.parse(anchor))||!/[Z]|[+-]\d{2}:\d{2}$/.test(anchor)))throw Error('Anchor needs timezone');
 if(anchor&&v.startDate&&zoneDate(anchor)!==v.startDate)throw Error('First scheduled dose must be on course start date');
 return {name,strength,days,frequency,startDate:v.startDate||null,mode,interval,times:times.sort(),anchor:anchor?new Date(anchor).toISOString():null,confirmed:v.confirmed===true,shift:mode==='interval'&&v.shift===true};
}
export const zoneDate=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function slots(p){
 if(!p.confirmed||!p.startDate)return [];
 if(p.mode==='interval')return p.anchor?Array.from({length:p.days*p.frequency},(_,i)=>({key:String(i),at:new Date(Date.parse(p.anchor)+i*p.interval*36e5).toISOString()})):[];
 if(p.times.length!==p.frequency)return [];
 return Array.from({length:p.days},(_,d)=>{const date=new Date(Date.parse(p.startDate+'T12:00Z')+d*864e5).toISOString().slice(0,10);return p.times.map((time,i)=>({key:d+':'+i,date,time}))}).flat();
}
function file(p){if(!members.has(p))throw Error('Unknown profile');return new URL(p+'/medicines.json',base)}
export function list(p){try{return JSON.parse(readFileSync(file(p),'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e}}
function save(p,a){const f=file(p);mkdirSync(new URL('./',f),{recursive:true,mode:0o700});const t=new URL(f.href+'.tmp');writeFileSync(t,JSON.stringify(a,null,2)+'\n',{mode:0o600});renameSync(t,f)}
export function mutate(p,b){
 const a=list(p),old=a.find(x=>x.id===b.id);
 if(b.action==='plan'){
  if(b.id&&!old)throw Error('Plan not found');
  const episodeId=old?.episodeId||b.episodeId;
  if(!listEpisodes(p).some(e=>e.id===episodeId))throw Error('Episode not found');
  const plan=validate(b.plan);
  if(old&&Object.keys(old.logs||{}).length&&JSON.stringify({...plan,name:old.name,strength:old.strength,shift:!!old.shift})!==JSON.stringify({...validate(old),name:old.name,strength:old.strength,shift:!!old.shift}))throw Error('Schedule has recorded doses. Create a new plan to preserve its history.');
  const n={...plan,id:old?.id||randomUUID(),episodeId,logs:old?.logs||{}};
  if(old)a[a.indexOf(old)]=n;else a.push(n);
 }else{
  if(!old||!listEpisodes(p).some(e=>e.id===old.episodeId))throw Error('Plan not found');
  if(!slots(old).some(s=>s.key===b.key))throw Error('Dose not found');
  if(b.action==='undo')delete old.logs[b.key];
  else if(b.action==='taken'||b.action==='skipped'){
   if(old.logs[b.key])return a;
   let at=null;if(b.action==='taken'){at=b.at;if(!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+60000)throw Error('Actual taken time cannot be in the future');at=new Date(at).toISOString()}
   old.logs[b.key]={status:b.action,at,recordedAt:new Date().toISOString()};
  }else throw Error('Unknown action');
 }
 save(p,a);return a;
}
export function instant(date,t){const g=Date.parse(date+'T'+t+':00Z');const off=x=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(x)).map(z=>[z.type,z.value]));return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-x};return g-off(g-off(g))}
export const slotMs=s=>s.at?Date.parse(s.at):instant(s.date,s.time);

// Optional "shift" for every-N-hours plans: after a late dose the following doses keep the full gap (never earlier than planned).
// Returns {slotKey: epochMs}; empty when the plan doesn't shift. A skipped or unrecorded dose counts as taken on its own (shifted) time.
export function effective(p){
 const out={};if(p.mode!=='interval'||!p.shift)return out;
 let prev=null;for(const s of slots(p)){const base=slotMs(s);const t=prev===null?base:Math.max(base,prev+p.interval*36e5);out[s.key]=t;const l=p.logs?.[s.key];prev=l&&l.status==='taken'&&l.at?Date.parse(l.at):t}
 return out;
}
export const targetMs=(p,s,eff=effective(p))=>eff[s.key]??slotMs(s);
