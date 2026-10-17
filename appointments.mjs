// Per-profile appointments: stored in private/profiles/<id>/appointments.json, with .ics export and reminder helpers.
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {listEpisodes} from './events.mjs';
import {instant} from './medicines.mjs';
import * as members from './members.mjs';
import {APP_NAME,APP_HOST} from './env.mjs';
const base=new URL('./private/profiles/',import.meta.url);
export const CATEGORIES=['Check-up','Vaccination','Test or scan','Specialist','Dentist','Therapy','Other'];
const STATUS=new Set(['scheduled','done','cancelled']);
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00Z').toISOString().slice(0,10)===s;
const timeOK=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const text=(v,label,max)=>{if(v===undefined||v===null||v==='')return '';if(typeof v!=='string')throw Error(label+' must be text');const t=v.trim();if(t.length>max)throw Error(label+' is too long');return t};
function file(p){if(!members.has(p))throw Error('Unknown profile');return new URL(p+'/appointments.json',base)}
export function list(p){try{const a=JSON.parse(readFileSync(file(p),'utf8'));return Array.isArray(a)?a:[]}catch(e){if(e.code==='ENOENT')return [];throw e}}
function save(p,a){const f=file(p);mkdirSync(new URL('./',f),{recursive:true,mode:0o700});const t=new URL(f.href+'.tmp');writeFileSync(t,JSON.stringify(a,null,2)+'\n',{mode:0o600});renameSync(t,f)}
export function validate(v,p){
 if(!v||typeof v!=='object')throw Error('Invalid appointment');
 const title=text(v.title,'Title',100);if(!title)throw Error('Add a title');
 if(!dateOK(v.date))throw Error('Choose a valid date');
 const time=v.time?String(v.time):null;if(time&&!timeOK(time))throw Error('Choose a valid time');
 let duration=null;if(v.durationMinutes!==undefined&&v.durationMinutes!==null&&v.durationMinutes!==''){duration=Number(v.durationMinutes);if(!Number.isInteger(duration)||duration<5||duration>1440)throw Error('Duration must be 5–1440 minutes')}
 const category=CATEGORIES.includes(v.category)?v.category:'Other';
 let episodeId=null;if(v.episodeId){if(!listEpisodes(p).some(e=>e.id===v.episodeId))throw Error('Episode not found');episodeId=v.episodeId}
 return {title,date:v.date,time,durationMinutes:time?duration:null,place:text(v.place,'Place',160),notes:text(v.notes,'Notes',1000),category,episodeId};
}
export function mutate(p,b,now=Date.now()){
 const a=list(p),old=a.find(x=>x.id===b.id);
 if(b.action==='save'){
  if(b.id&&!old)throw Error('Appointment not found');
  const v=validate(b.appointment,p),n={...v,id:old?.id||randomUUID(),status:old?.status||'scheduled',createdAt:old?.createdAt||now,updatedAt:now};
  if(old)a[a.indexOf(old)]=n;else a.push(n);
 }else if(b.action==='status'){
  if(!old)throw Error('Appointment not found');if(!STATUS.has(b.status))throw Error('Unknown status');old.status=b.status;old.updatedAt=now;
 }else if(b.action==='delete'){
  if(!old)throw Error('Appointment not found');a.splice(a.indexOf(old),1);
 }else throw Error('Unknown action');
 save(p,a);return a;
}
// ---- time helpers ----
export const startMs=a=>instant(a.date,a.time||'00:00');
export const endMs=a=>a.time?startMs(a)+(a.durationMinutes||60)*6e4:instant(new Date(Date.parse(a.date+'T12:00Z')+864e5).toISOString().slice(0,10),'00:00');
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*864e5).toISOString().slice(0,10);
// Reminder instants: evening before at 18:00, then 2 h before (all-day: 08:00 that morning).
export const reminders=a=>[{kind:'eve',at:instant(addDays(a.date,-1),'18:00')},{kind:'soon',at:a.time?startMs(a)-2*36e5:instant(a.date,'08:00')}];
// ---- .ics ----
const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/;/g,'\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
const utc=ms=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const fold=l=>{const out=[];let s=l;while(Buffer.byteLength(s)>74){let n=74;while(Buffer.byteLength(s.slice(0,n))>74)n--;out.push(s.slice(0,n));s=' '+s.slice(n)}out.push(s);return out.join('\r\n')};
export function ics(a,who,now=Date.now()){
 const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//'+esc(APP_NAME)+'//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:'+a.id+'@'+(APP_HOST||'apnihealth.local'),'DTSTAMP:'+utc(now)];
 if(a.time){L.push('DTSTART:'+utc(startMs(a)),'DTEND:'+utc(endMs(a)))}else{L.push('DTSTART;VALUE=DATE:'+a.date.replace(/-/g,''),'DTEND;VALUE=DATE:'+addDays(a.date,1).replace(/-/g,''))}
 L.push('SUMMARY:'+esc((who?who+': ':'')+a.title));if(a.place)L.push('LOCATION:'+esc(a.place));
 const d=[a.category,a.notes].filter(Boolean).join(' — ');if(d)L.push('DESCRIPTION:'+esc(d));
 L.push('STATUS:'+(a.status==='cancelled'?'CANCELLED':'CONFIRMED'));
 if(a.time)L.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+esc(a.title),'TRIGGER:-PT2H','END:VALARM');
 L.push('END:VEVENT','END:VCALENDAR');return L.map(fold).join('\r\n')+'\r\n';
}
