// Lab results entered in the app (or imported): dated reports with marker values, per member, in lab_reports,
// lab_values and lab_pending. Marker names are resolved through the generic catalog (config/markers.default.json,
// merged with the optional private/markers.json): a value matches an entry by its name or any alias,
// case-insensitively, so a lab's own names (in any language) only need an alias.
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {forMember} from './store.mjs';
import {knownUnit,sameUnit} from './public/labunits.mjs';
// The default catalog is bundled as a module (no file read at runtime, so it also works without a filesystem).
import DEFAULT_MARKERS from './config/markers.default.json' with {type:'json'};
const defaultPrivateDir=()=>import.meta.url?join(fileURLToPath(new URL('.',import.meta.url)),'private'):null;
const MAX_VALUES=200,MAX_PENDING=50;

// ---- catalog ----
const cache=new Map();
// The default privateDir (private/ next to the code) is resolved on use, so the module also loads where
// import.meta.url is undefined (Workers); without one only the bundled default catalog is used.
export function catalog(privateDir=defaultPrivateDir()){
 if(cache.has(privateDir))return cache.get(privateDir);
 const entries=new Map();
 // config/markers.default.json, then the instance's own private/markers.json when there is one (Node only).
 const own=privateDir&&join(privateDir,'markers.json');
 const sources=[['markers.default.json',()=>DEFAULT_MARKERS],['markers.json',()=>own&&existsSync(own)?JSON.parse(readFileSync(own,'utf8')):null]];
 for(const [name,load] of sources){
  let data;try{data=load()}catch{throw Error(name+' is not valid JSON')}
  if(!data)continue;
  for(const m of Array.isArray(data?.markers)?data.markers:[]){
   if(!m||typeof m.name!=='string'||!m.name.trim())throw Error(name+': every marker needs a "name"');
   const old=entries.get(m.name)||{};
   entries.set(m.name,{name:m.name,group:typeof m.group==='string'?m.group:old.group||'Other',meaning:typeof m.meaning==='string'?m.meaning:old.meaning||'',
    aliases:[...new Set([...(old.aliases||[]),...(Array.isArray(m.aliases)?m.aliases.filter(a=>typeof a==='string'&&a.trim()):[])])],
    ...unitFields(m,old,name)});
  }
 }
 for(const e of entries.values())if(e.alt&&!entries.has(e.alt))throw Error(e.name+': alt names an unknown marker ('+e.alt+')');
 const index=new Map();
 for(const e of entries.values())for(const k of [e.name,...e.aliases])index.set(k.trim().toLowerCase(),e);
 const c={markers:[...entries.values()],lookup:name=>typeof name==='string'?index.get(name.trim().toLowerCase()):undefined};
 cache.set(privateDir,c);return c;
}
export const resetCatalog=()=>cache.clear();
// Catalog v2 fields, validated so a typo cannot silently convert values: unit (preferred display unit), units
// (other accepted units, value in unit = value x factor, each with its source), plausible ([min,max] sanity
// bounds in the preferred unit, not reference ranges) and alt (the paired marker in other units).
function unitFields(m,old,file){
 const bad=what=>Error(file+': '+m.name+': '+what),out={};
 const unit=m.unit??old.unit;
 if(unit!==undefined){if(typeof unit!=='string'||!knownUnit(unit))throw bad('unknown unit "'+unit+'"');out.unit=unit}
 const units=m.units??old.units;
 if(units!==undefined){
  if(!Array.isArray(units))throw bad('units must be a list');if(!out.unit&&units.length)throw bad('units need a preferred unit');
  out.units=units.map(x=>{
   if(!x||typeof x.unit!=='string'||!knownUnit(x.unit))throw bad('unknown unit "'+x?.unit+'"');
   if(sameUnit(x.unit,out.unit))throw bad(x.unit+' is the preferred unit');
   if(typeof x.factor!=='number'||!Number.isFinite(x.factor)||x.factor<=0)throw bad('factor for '+x.unit+' must be a positive number');
   if(typeof x.src!=='string'||x.src.trim().length<10)throw bad('factor for '+x.unit+' needs a source (src)');
   return {unit:x.unit,factor:x.factor,src:x.src};
  });
  if(new Set(out.units.map(x=>x.unit.toLowerCase())).size!==out.units.length)throw bad('a unit is listed twice');
 }
 const pl=m.plausible??old.plausible;
 if(pl!==undefined){if(!Array.isArray(pl)||pl.length!==2||!pl.every(Number.isFinite)||!(pl[0]<pl[1]))throw bad('plausible must be [min, max]');out.plausible=[pl[0],pl[1]]}
 const alt=m.alt??old.alt;
 if(alt!==undefined){if(typeof alt!=='string'||!alt.trim()||alt===m.name)throw bad('alt must name another marker');out.alt=alt}
 return out;
}

// ---- validation ----
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;
const text=(v,label,max)=>{if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'&&typeof v!=='number')throw Error(label+' must be text');const t=String(v).trim();if(t.length>max)throw Error(label+' is too long');return t||null};
const NUM=/-?\d+(?:[.,]\d+)?/;
export function validateReport(r,{privateDir}={}){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Report must be an object');
 if(!dayOk(r.date))throw Error('Choose a valid report date');
 if(Date.parse(r.date+'T00:00Z')>Date.now()+2*864e5)throw Error('The report date cannot be in the future');
 const reported=r.reported?(dayOk(r.reported)?r.reported:(()=>{throw Error('Reported date is invalid')})()):null;
 const source=text(r.source,'Source file',120);if(source&&(!/^[\w .()\-]{1,120}\.(pdf|md)$/i.test(source)||source.startsWith('.')))throw Error('Source must be a report file name such as labs.pdf');
 const cat=catalog(privateDir),unknown=new Set();
 const values=Array.isArray(r.values)?r.values:[];if(!values.length)throw Error('Add at least one result');if(values.length>MAX_VALUES)throw Error('At most '+MAX_VALUES+' results per report');
 const out=values.map((v,i)=>{
  if(!v||typeof v!=='object')throw Error('Result '+(i+1)+' is invalid');
  const name=text(v.name,'Marker name',120);if(!name)throw Error('Result '+(i+1)+' needs a marker name');if(!cat.lookup(name))unknown.add(name);
  let value=text(v.value,'Value',40);if(!value)throw Error('Result '+(i+1)+' needs a value');
  let flag=v.flag==='high'||v.flag==='low'?v.flag:null;
  if(/\s*↑$/.test(value)){flag='high';value=value.replace(/\s*↑$/,'')}else if(/\s*↓$/.test(value)){flag='low';value=value.replace(/\s*↓$/,'')}
  const m=NUM.exec(value);if(!m)throw Error('Result '+(i+1)+': the value needs a number');
  const unit=text(v.unit,'Unit',30)??(value.slice(m.index+m[0].length).trim()||null);
  const page=v.page===undefined||v.page===null||v.page===''?null:Number(v.page);if(page!==null&&(!Number.isInteger(page)||page<1||page>999))throw Error('Result '+(i+1)+': page is invalid');
  return {name,value,num:Number(m[0].replace(',','.')),unit,reference:text(v.reference,'Reference range',60),flag,page};
 });
 const pending=(Array.isArray(r.pending)?r.pending:[]).map((q,i)=>{const name=text(q?.name,'Pending marker name',120);if(!name)throw Error('Pending result '+(i+1)+' needs a name');if(!cat.lookup(name))unknown.add(name);return {name,note:text(q.note,'Note',300)}});
 if(pending.length>MAX_PENDING)throw Error('At most '+MAX_PENDING+' pending results per report');
 if(unknown.size)throw Object.assign(Error('Unknown marker name'+(unknown.size>1?'s':'')+': '+[...unknown].slice(0,5).join(', ')+'. Choose one from the list, or add it (or an alias) to private/markers.json.'),{unknown:[...unknown]});
 return {date:r.date,reported,title:text(r.title,'Title',120),source,screening:r.screening===true,preliminary:r.preliminary===true,values:out,pending};
}

// ---- storage ----
export function addReport(memberId,body,opts){
 const v=validateReport(body,opts),m=forMember(memberId),id=randomUUID();
 m.tx(()=>{
  m.run('INSERT INTO lab_reports(member_id,id,date,reported,title,source,screening,preliminary,created_at) VALUES($member,$id,$date,$reported,$title,$source,$screening,$preliminary,$at)',
   {id,date:v.date,reported:v.reported,title:v.title,source:v.source,screening:v.screening?1:0,preliminary:v.preliminary?1:0,at:new Date().toISOString()});
  v.values.forEach((x,pos)=>m.run('INSERT INTO lab_values(member_id,report_id,pos,name,value,num,unit,reference,flag,page) VALUES($member,$id,$pos,$name,$value,$num,$unit,$reference,$flag,$page)',{id,pos,...x}));
  v.pending.forEach((x,pos)=>m.run('INSERT INTO lab_pending(member_id,report_id,pos,name,note) VALUES($member,$id,$pos,$name,$note)',{id,pos,...x}));
 });
 return {id,...v};
}
export function deleteReport(memberId,id){return forMember(memberId).run('DELETE FROM lab_reports WHERE member_id=$member AND id=$id',{id:String(id)}).changes>0}
export function listReports(memberId){
 const m=forMember(memberId);
 const reports=m.all('SELECT id,date,reported,title,source,screening,preliminary,created_at FROM lab_reports WHERE member_id=$member ORDER BY date,created_at,rowid').map(r=>({...r,screening:!!r.screening,preliminary:!!r.preliminary,values:[],pending:[]}));
 const by=new Map(reports.map(r=>[r.id,r]));
 for(const v of m.all('SELECT report_id,name,value,num,unit,reference,flag,page FROM lab_values WHERE member_id=$member ORDER BY report_id,pos'))by.get(v.report_id)?.values.push({name:v.name,value:v.value,num:v.num,unit:v.unit,reference:v.reference,flag:v.flag,page:v.page});
 for(const q of m.all('SELECT report_id,name,note FROM lab_pending WHERE member_id=$member ORDER BY report_id,pos'))by.get(q.report_id)?.pending.push({name:q.name,note:q.note});
 return reports;
}

// ---- explorer data: one series per catalog marker (the shape public/app.js renders) ----
export function series(memberId,{privateDir}={}){
 const cat=catalog(privateDir),items=new Map(),pending=[];
 for(const r of listReports(memberId)){
  const note=r.screening?'Screening result; methods and testing conditions can differ.':(r.preliminary?'Preliminary result; it may change when the final report is issued. ':'')+'Reference interval from this report. It is not a diagnosis or a personalized treatment target.';
  for(const v of r.values){
   const e=cat.lookup(v.name)||{name:v.name,group:'Other',meaning:''};
   if(!items.has(e.name))items.set(e.name,{id:'m'+items.size,name:e.name,group:e.group,meaning:e.meaning,aliases:[],points:[]});
   const s=items.get(e.name);if(v.name!==e.name&&!s.aliases.includes(v.name))s.aliases.push(v.name);
   const unit=v.unit||'',display=/\p{L}|%/u.test(v.value)||!unit?v.value:v.value+' '+unit;
   s.points.push({date:r.date,value:v.value,n:v.num,unit,source:r.source,page:v.page||1,report:r.id,status:r.screening?'screening':v.flag||'range',range:r.screening?null:v.reference,inferred:false,note,display,
    ...(r.preliminary?{preliminary:true}:{}),...(r.reported?{reported:r.reported}:{})});
  }
  for(const q of r.pending){const e=cat.lookup(q.name)||{name:q.name,group:'Other',meaning:''};pending.push({name:e.name,group:e.group,meaning:e.meaning,alias:q.name,date:r.date,source:r.source,report:r.id,note:q.note||'Result pending.'})}
 }
 for(const s of items.values()){s.points.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);s.latest=s.points.at(-1)}
 const iron=items.get('Iron circulating in blood');if(iron&&!items.has('Ferritin: iron stores'))iron.meaning+=' No ferritin result was supplied.';
 return {measurements:[...items.values()],pending};
}
