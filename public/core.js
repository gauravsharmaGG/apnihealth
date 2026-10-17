// Shared client helpers for the Phase 4 views (dashboard, timeline, insights, medicines list): escaping, the
// household's time zone, dates, measurement units and small SVG sparklines. Exposed as window.AH.
(()=>{
const CFG=window.APP_CONFIG||{},TZ=CFG.timeZone||'UTC';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const hm=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*864e5).toISOString().slice(0,10);
// Wall-clock date + time in the household zone -> epoch ms.
function inst(date,t){const g=Date.parse(date+'T'+t+':00Z');const off=x=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(x)).map(z=>[z.type,z.value]));return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-x};return g-off(g-off(g))}
const slotMs=s=>s.at?Date.parse(s.at):inst(s.date,s.time);
const longDate=(t=Date.now())=>new Date(t).toLocaleDateString('en-GB',{timeZone:TZ,weekday:'short',day:'numeric',month:'short',year:'numeric'});
const nf=(v,dp=0)=>Number(v).toLocaleString('en-GB',{minimumFractionDigits:dp,maximumFractionDigits:dp});
// Units: values are stored in kg and °C; households may show lb and °F.
const S=CFG.settings||{},LB=0.45359237;
const lb=()=>S.units?.weight==='lb',fahr=()=>S.units?.temperature==='F';
const disp=(metric,v)=>metric==='weight'&&lb()?v/LB:metric==='temperature'&&fahr()?v*9/5+32:v;
const UNIT={weight:'kg',steps:'steps',resting_hr:'bpm',sleep:'h',body_fat:'%',spo2:'%',hrv:'ms',temperature:'°C',bp_sys:'mmHg',bp_dia:'mmHg'};
const unitOf=m=>m==='weight'&&lb()?'lb':m==='temperature'&&fahr()?'°F':UNIT[m]||'';
const GROUPS={weight:['weight'],body_fat:['body_fat'],sleep:['sleep'],steps:['steps'],heart_rate:['resting_hr'],blood_pressure:['bp_sys','bp_dia'],spo2:['spo2'],hrv:['hrv'],temperature:['temperature']};
const tracked=()=>Array.isArray(S.metrics)?S.metrics:['weight','body_fat','sleep','steps','heart_rate','blood_pressure'];
// Sparkline: values -> SVG polyline (decorative; the numbers are in the text next to it).
function spark(vals,{w=120,h=36,cls='spark'}={}){
 const v=vals.filter(Number.isFinite);if(v.length<2)return '';
 const min=Math.min(...v),max=Math.max(...v),r=max-min||1,step=w/(v.length-1);
 const pts=v.map((x,i)=>(i*step).toFixed(1)+','+(h-3-(x-min)/r*(h-6)).toFixed(1)).join(' ');
 return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${pts}"/></svg>`;
}
async function api(path){const r=await fetch(path,{credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Request failed'),{status:r.status});return j}
window.AH={CFG,TZ,esc,day,hm,addDays,inst,slotMs,longDate,nf,disp,unitOf,GROUPS,tracked,spark,api};
})();
