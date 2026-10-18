// Lab results entered in the app (or imported): dated reports with marker values, per member, in lab_reports,
// lab_values and lab_pending. Marker names are resolved through the generic catalog (config/markers.default.json,
// merged with the optional private/markers.json): a value matches an entry by its name or any alias,
// case-insensitively, so a lab's own names (in any language) only need an alias.
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {forMember,canWriteMember,system} from './store.mjs';
import {knownUnit,sameUnit,toPreferred,prettyUnit,normUnit} from './public/labunits.mjs';
import * as ev from './events.mjs';
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

// ---- household markers: custom markers and learned aliases, per household (lab_markers; both runtimes) ----
// A row whose name is a catalog marker only adds aliases to it; any other name is a household custom marker.
export function householdMarkers(memberId){
 const m=forMember(memberId);
 return system().prepare('SELECT name,group_name,unit,aliases FROM lab_markers WHERE household_id=? ORDER BY name').all(m.household)
  .map(r=>({name:r.name,group:r.group_name,unit:r.unit||undefined,aliases:(()=>{try{return JSON.parse(r.aliases)}catch{return []}})()}));
}
// The catalog as seen by one member's household: defaults, private/markers.json, then the household's own rows.
export function catalogFor(memberId,{privateDir,extra=[]}={}){
 const base=catalog(privateDir),own=[...householdMarkers(memberId),...extra],entries=new Map(base.markers.map(e=>[e.name,e]));
 for(const h of own){
  const e=entries.get(h.name);
  if(e)entries.set(h.name,{...e,aliases:[...new Set([...e.aliases,...h.aliases])]});
  else entries.set(h.name,{name:h.name,group:h.group||'Other',meaning:'',aliases:h.aliases||[],...(h.unit&&knownUnit(h.unit)?{unit:h.unit}:{}),custom:true});
 }
 const index=new Map();for(const e of entries.values())for(const k of [e.name,...e.aliases])index.set(k.trim().toLowerCase(),e);
 return {markers:[...entries.values()],household:own,lookup:name=>typeof name==='string'?index.get(name.trim().toLowerCase()):undefined};
}
const nameText=(v,label)=>{if(typeof v!=='string')throw Error(label+' must be text');const t=v.trim().replace(/\s+/g,' ');if(!t||t.length>120)throw Error(label+' is invalid');return t};
// Validates {aliases:[{marker,alias}], custom:[{name,group,unit}]} against the member's catalog: a custom name may
// not be a catalog name or alias, and an alias may not already name a different marker.
function validateLearn(learn,cat){
 const out={aliases:[],custom:[]};if(!learn)return out;
 if(typeof learn!=='object'||Array.isArray(learn))throw Error('Learned names are invalid');
 const custom=Array.isArray(learn.custom)?learn.custom:[],aliases=Array.isArray(learn.aliases)?learn.aliases:[];
 if(custom.length>50||aliases.length>100)throw Error('Too many new marker names');
 const taken=new Map();for(const e of cat.markers)for(const k of [e.name,...e.aliases])taken.set(k.trim().toLowerCase(),e.name);
 for(const c of custom){
  const name=nameText(c?.name,'Custom marker name');if(taken.has(name.toLowerCase()))throw Error('"'+name+'" is already a marker name; choose it from the list instead');
  const unit=c.unit===undefined||c.unit===null||c.unit===''?null:text(c.unit,'Unit',30);
  const group=c.group===undefined||c.group===null||c.group===''?'Other':nameText(c.group,'Group');
  taken.set(name.toLowerCase(),name);out.custom.push({name,group,unit});
 }
 for(const a of aliases){
  const marker=nameText(a?.marker,'Marker'),alias=nameText(a?.alias,'Alias');
  if(!cat.markers.some(e=>e.name===marker)&&!out.custom.some(c=>c.name===marker))throw Error('Unknown marker: '+marker);
  const was=taken.get(alias.toLowerCase());if(was&&was!==marker)throw Error('"'+alias+'" already names '+was);
  if(!was){taken.set(alias.toLowerCase(),marker);out.aliases.push({marker,alias})}
 }
 return out;
}

// ---- validation ----
const dayOk=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;
const text=(v,label,max)=>{if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'&&typeof v!=='number')throw Error(label+' must be text');const t=String(v).trim();if(t.length>max)throw Error(label+' is too long');return t||null};
const NUM=/-?\d+(?:[.,]\d+)?/;
export const METHODS=new Set(['manual','pdf-text','ocr']); // 'ai' is reserved in the schema for a later, opt-in phase
const UUID=/^[0-9a-f-]{36}$/i;
// cat: the catalog to resolve names with (catalogFor(member) in the app; the instance catalog by default).
export function validateReport(r,{privateDir,cat=catalog(privateDir)}={}){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Report must be an object');
 if(!dayOk(r.date))throw Error('Choose a valid report date');
 if(Date.parse(r.date+'T00:00Z')>Date.now()+2*864e5)throw Error('The report date cannot be in the future');
 const reported=r.reported?(dayOk(r.reported)?r.reported:(()=>{throw Error('Reported date is invalid')})()):null;
 let uploadId=null;if(r.uploadId!==undefined&&r.uploadId!==null&&r.uploadId!==''){if(typeof r.uploadId!=='string'||!UUID.test(r.uploadId))throw Error('Attached file is invalid');uploadId=r.uploadId}
 const source=text(r.source,'Source file',120);if(source&&(!(uploadId?/^[\w .()\-]{1,120}\.(pdf|md|jpe?g|png|webp|heic|heif)$/i:/^[\w .()\-]{1,120}\.(pdf|md)$/i).test(source)||source.startsWith('.')))throw Error('Source must be a report file name such as labs.pdf');
 const method=r.method===undefined||r.method===null?'manual':r.method;if(!METHODS.has(method))throw Error('Reading method is invalid');
 const unknown=new Set();
 const values=Array.isArray(r.values)?r.values:[];if(!values.length)throw Error('Add at least one result');if(values.length>MAX_VALUES)throw Error('At most '+MAX_VALUES+' results per report');
 const out=values.map((v,i)=>{
  if(!v||typeof v!=='object')throw Error('Result '+(i+1)+' is invalid');
  const name=text(v.name,'Marker name',120);if(!name)throw Error('Result '+(i+1)+' needs a marker name');const e=cat.lookup(name);if(!e)unknown.add(name);
  let value=text(v.value,'Value',40);if(!value)throw Error('Result '+(i+1)+' needs a value');
  let flag=v.flag==='high'||v.flag==='low'?v.flag:null;
  if(/\s*↑$/.test(value)){flag='high';value=value.replace(/\s*↑$/,'')}else if(/\s*↓$/.test(value)){flag='low';value=value.replace(/\s*↓$/,'')}
  const m=NUM.exec(value);if(!m)throw Error('Result '+(i+1)+': the value needs a number');
  const unit=text(v.unit,'Unit',30)??(value.slice(m.index+m[0].length).trim()||null);
  const page=v.page===undefined||v.page===null||v.page===''?null:Number(v.page);if(page!==null&&(!Number.isInteger(page)||page<1||page>999))throw Error('Result '+(i+1)+': page is invalid');
  const rawName=text(v.rawName,'Name on the report',120);
  const conf=v.confidence===undefined||v.confidence===null?null:Number(v.confidence);if(conf!==null&&!(conf>=0&&conf<=1))throw Error('Result '+(i+1)+': confidence is invalid');
  const vm=v.method===undefined||v.method===null?method:v.method;if(!METHODS.has(vm))throw Error('Result '+(i+1)+': reading method is invalid');
  return {name,marker:e?.name||null,value,num:Number(m[0].replace(',','.')),unit,reference:text(v.reference,'Reference range',60),flag,page,raw_name:rawName&&rawName!==name?rawName:null,method:vm,confidence:conf};
 });
 const pending=(Array.isArray(r.pending)?r.pending:[]).map((q,i)=>{const name=text(q?.name,'Pending marker name',120);if(!name)throw Error('Pending result '+(i+1)+' needs a name');if(!cat.lookup(name))unknown.add(name);return {name,note:text(q.note,'Note',300)}});
 if(pending.length>MAX_PENDING)throw Error('At most '+MAX_PENDING+' pending results per report');
 if(unknown.size)throw Object.assign(Error('Unknown marker name'+(unknown.size>1?'s':'')+': '+[...unknown].slice(0,5).join(', ')+'. Choose one from the list, or add it (or an alias) to private/markers.json.'),{unknown:[...unknown]});
 return {date:r.date,reported,title:text(r.title,'Title',120),source,uploadId,method,screening:r.screening===true,preliminary:r.preliminary===true,values:out,pending};
}

// ---- storage ----
// body.uploadId links the report to an uploaded file (inbox item) of the same member; the item is then marked
// imported. body.learn adds household custom markers and aliases in the same transaction.
export function addReport(memberId,body,opts={}){
 const m=forMember(memberId),base=catalogFor(memberId,opts),learn=validateLearn(body?.learn,base);
 const cat=learn.custom.length||learn.aliases.length?catalogFor(memberId,{...opts,extra:[...learn.custom.map(c=>({...c,aliases:[]})),...learn.aliases.map(a=>({name:a.marker,aliases:[a.alias]}))]}):base;
 const v=validateReport(body,{...opts,cat}),id=randomUUID();
 if(learn.custom.length||learn.aliases.length)canWriteMember(memberId);
 if(v.uploadId){const it=ev.inboxItem(memberId,v.uploadId);if(!it)throw Error('Attached file not found');if(it.labReportId&&m.get('SELECT 1 AS x FROM lab_reports WHERE member_id=$member AND id=$id',{id:it.labReportId}))throw Error('This file is already linked to a lab report')}
 m.tx(()=>{
  const d=system(),at=new Date().toISOString();
  for(const c of learn.custom)d.prepare('INSERT INTO lab_markers(household_id,name,group_name,unit,aliases,created_at) VALUES(?,?,?,?,?,?)').run(m.household,c.name,c.group,c.unit,'[]',at);
  for(const a of learn.aliases){
   const row=d.prepare('SELECT aliases FROM lab_markers WHERE household_id=? AND name=?').get(m.household,a.marker);
   if(row)d.prepare('UPDATE lab_markers SET aliases=? WHERE household_id=? AND name=?').run(JSON.stringify([...new Set([...JSON.parse(row.aliases||'[]'),a.alias])]),m.household,a.marker);
   else d.prepare('INSERT INTO lab_markers(household_id,name,group_name,unit,aliases,created_at) VALUES(?,?,?,?,?,?)').run(m.household,a.marker,cat.lookup(a.marker)?.group||'Other',null,JSON.stringify([a.alias]),at);
  }
  m.run('INSERT INTO lab_reports(member_id,id,date,reported,title,source,screening,preliminary,created_at,upload_id) VALUES($member,$id,$date,$reported,$title,$source,$screening,$preliminary,$at,$upload)',
   {id,date:v.date,reported:v.reported,title:v.title,source:v.source,screening:v.screening?1:0,preliminary:v.preliminary?1:0,at,upload:v.uploadId});
  v.values.forEach((x,pos)=>m.run('INSERT INTO lab_values(member_id,report_id,pos,name,value,num,unit,reference,flag,page,marker,raw_name,method,confidence) VALUES($member,$id,$pos,$name,$value,$num,$unit,$reference,$flag,$page,$marker,$raw_name,$method,$confidence)',{id,pos,...x}));
  v.pending.forEach((x,pos)=>m.run('INSERT INTO lab_pending(member_id,report_id,pos,name,note) VALUES($member,$id,$pos,$name,$note)',{id,pos,...x}));
  if(v.uploadId)ev.linkInbox(memberId,v.uploadId,id);
 });
 return {id,...v};
}
// Deleting a report keeps its file (the person's record); the file can be read again.
export function deleteReport(memberId,id){
 const m=forMember(memberId);
 return m.tx(()=>{
  const r=m.get('SELECT upload_id FROM lab_reports WHERE member_id=$member AND id=$id',{id:String(id)});if(!r)return false;
  m.run('DELETE FROM lab_reports WHERE member_id=$member AND id=$id',{id:String(id)});
  if(r.upload_id)ev.linkInbox(memberId,r.upload_id,null);
  return true;
 });
}
export function listReports(memberId){
 const m=forMember(memberId);
 const reports=m.all('SELECT id,date,reported,title,source,screening,preliminary,created_at,upload_id FROM lab_reports WHERE member_id=$member ORDER BY date,created_at,rowid').map(({upload_id,...r})=>({...r,uploadId:upload_id||null,screening:!!r.screening,preliminary:!!r.preliminary,values:[],pending:[]}));
 const by=new Map(reports.map(r=>[r.id,r]));
 for(const v of m.all('SELECT report_id,name,value,num,unit,reference,flag,page,marker,raw_name,method,confidence FROM lab_values WHERE member_id=$member ORDER BY report_id,pos'))
  by.get(v.report_id)?.values.push({name:v.name,value:v.value,num:v.num,unit:v.unit,reference:v.reference,flag:v.flag,page:v.page,marker:v.marker||null,rawName:v.raw_name||null,method:v.method||null,confidence:v.confidence??null});
 for(const q of m.all('SELECT report_id,name,note FROM lab_pending WHERE member_id=$member ORDER BY report_id,pos'))by.get(q.report_id)?.pending.push({name:q.name,note:q.note});
 return reports;
}
// Read-only duplicate check for the review screen: {date, values:[{marker,num,unit}]} -> reports of this member on
// that date where at least 80% of the given values already exist (same marker, equal after unit conversion), and
// the markers that already have an equal value on that date.
export function checkDuplicates(memberId,body,opts={}){
 if(!body||typeof body!=='object'||!dayOk(body.date))throw Error('Choose a valid report date');
 const vals=(Array.isArray(body.values)?body.values:[]).slice(0,MAX_VALUES).filter(v=>v&&typeof v.marker==='string'&&Number.isFinite(Number(v.num)));
 const cat=catalogFor(memberId,opts),norm=(marker,num,unit)=>{const e=cat.lookup(marker);if(!e)return null;const p=toPreferred(e,Number(num),unit);return {name:e.name,num:p?p.num:Number(num),unit:p?normUnit(e.unit):normUnit(unit)}};
 const eq=(a,b)=>a&&b&&a.name===b.name&&a.unit===b.unit&&Math.abs(a.num-b.num)<=Math.max(1e-9,Math.abs(b.num)*0.005);
 const want=vals.map(v=>norm(v.marker,v.num,v.unit)).filter(Boolean),reports=[],dup=new Set();
 for(const r of listReports(memberId).filter(r=>r.date===body.date)){
  const have=r.values.map(v=>norm(v.marker||v.name,v.num,v.unit));
  const hits=want.filter(w=>have.some(h=>eq(w,h)));hits.forEach(h=>dup.add(h.name));
  if(want.length&&hits.length/want.length>=0.8)reports.push({id:r.id,title:r.title,date:r.date,overlap:Math.round(hits.length/want.length*100)/100});
 }
 return {reports,duplicates:[...dup]};
}

// ---- explorer data: one series per catalog marker (the shape public/app.js renders) ----
export function series(memberId,{privateDir}={}){
 const cat=catalogFor(memberId,{privateDir}),items=new Map(),pending=[];
 for(const r of listReports(memberId)){
  const note=r.screening?'Screening result; methods and testing conditions can differ.':(r.preliminary?'Preliminary result; it may change when the final report is issued. ':'')+'Reference interval from this report. It is not a diagnosis or a personalized treatment target.';
  for(const v of r.values){
   const e=(v.marker&&cat.lookup(v.marker))||cat.lookup(v.name)||{name:v.name,group:'Other',meaning:''};
   if(!items.has(e.name))items.set(e.name,{id:'m'+items.size,name:e.name,group:e.group,meaning:e.meaning,aliases:[],points:[],entry:e});
   const s=items.get(e.name);for(const a of [v.name,v.rawName])if(a&&a!==e.name&&!s.aliases.includes(a))s.aliases.push(a);
   const unit=v.unit||'',display=/\p{L}|%/u.test(v.value)||!unit?v.value:v.value+' '+unit;
   s.points.push({date:r.date,value:v.value,n:v.num,unit,source:r.source,page:v.page||1,report:r.id,status:r.screening?'screening':v.flag||'range',range:r.screening?null:v.reference,inferred:false,note,display,
    ...(r.preliminary?{preliminary:true}:{}),...(r.reported?{reported:r.reported}:{}),...(r.uploadId?{upload:r.uploadId}:{}),...(v.method&&v.method!=='manual'?{method:v.method}:{})});
  }
  for(const q of r.pending){const e=cat.lookup(q.name)||{name:q.name,group:'Other',meaning:''};pending.push({name:e.name,group:e.group,meaning:e.meaning,alias:q.name,date:r.date,source:r.source,report:r.id,note:q.note||'Result pending.'})}
 }
 for(const s of items.values()){
  convertMixed(s);delete s.entry;
  s.points.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);s.latest=s.points.at(-1);
 }
 const iron=items.get('Iron circulating in blood');if(iron&&!items.has('Ferritin: iron stores'))iron.meaning+=' No ferritin result was supplied.';
 return {measurements:[...items.values()],pending};
}
// Values are stored as reported. A series whose points use different units is charted in the marker's preferred
// unit: each converted point keeps what the report said in `original` and in its display text. A series in one
// unit is left exactly as reported. Points without a declared conversion stay as they are.
const sig=n=>Number(Number(n).toPrecision(3));
function convertMixed(s){
 const e=s.entry,units=new Set(s.points.map(p=>normUnit(p.unit)));
 if(units.size<2||!e?.unit)return;
 for(const p of s.points){
  if(sameUnit(p.unit,e.unit)||/[<>]/.test(p.value))continue;
  const c=toPreferred(e,p.n,p.unit);if(!c)continue;
  const conv=x=>{const n=parseFloat(String(x).replace(',','.'));return Number.isFinite(n)?String(sig(n*c.factor)):x};
  const range=p.range?String(p.range).replace(/-?\d+(?:[.,]\d+)?/g,conv):p.range;
  Object.assign(p,{original:{value:p.value,unit:p.unit,range:p.range},n:c.num,unit:prettyUnit(e.unit),value:String(sig(c.num)),range,display:`${sig(c.num)} ${prettyUnit(e.unit)} (reported ${p.value} ${p.unit})`});
 }
}
