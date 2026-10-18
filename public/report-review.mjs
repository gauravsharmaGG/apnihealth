// "Read values" from a lab report (plan: docs/plans/report-ocr.md, PR 7): reads an uploaded PDF or photo on the
// device (report-extract.mjs), maps it to markers (labmap.mjs) and shows a review screen. Nothing is saved until
// the person taps Save, and only the ticked rows go to POST /api/labs (with the upload linked). Low-confidence and
// unrecognised rows start unticked; unrecognised names can be mapped (optionally remembered for the household),
// saved as a custom marker, or skipped (the default). Loaded lazily by labs.js and child.js.
import {supported,available,extract,DEFAULT_LANGS,MAX_PAGES} from './report-extract.mjs';
import {mapReport} from './labmap.mjs';
import {toPreferred,prettyUnit,round} from './labunits.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'';
const today=()=>new Date().toLocaleDateString('en-CA');
async function api(path,opt){const r=await fetch(path,{credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Request failed'),{status:r.status,body:j});return j}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const fileUrl=(p,id)=>`/api/inbox/${encodeURIComponent(id)}/file?profile=${encodeURIComponent(p)}`;

// Usable here? Sync part (browser, CSP, iOS 16+) first; the server check is cached per page load.
let availP=null;
export async function canRead(){if(!supported())return false;return availP||(availP=available())}

function css(){if(document.getElementById('rr-css'))return;const l=document.createElement('link');l.id='rr-css';l.rel='stylesheet';l.href='/report-review.css';document.head.appendChild(l)}

let dlg=null,state=null;
function dialog(){
 if(dlg)return dlg;css();
 dlg=document.createElement('dialog');dlg.id='rr-dialog';dlg.className='sheet rr';dlg.setAttribute('aria-labelledby','rr-title');
 dlg.innerHTML='<form novalidate><div class="rr-head"><h2 id="rr-title">Read values</h2><button type="button" class="rr-x" data-rr="close" aria-label="Close">×</button></div><div class="rr-body"></div><p class="form-msg" role="status" aria-live="polite"></p><div class="sheet-actions rr-actions"></div></form>';
 document.body.appendChild(dlg);
 dlg.addEventListener('click',onClick);dlg.addEventListener('change',onChange);dlg.addEventListener('input',onInput);
 dlg.querySelector('form').addEventListener('submit',e=>{e.preventDefault();save()});
 dlg.addEventListener('close',()=>{state?.abort?.abort();state=null});
 return dlg;
}
const $=s=>dlg.querySelector(s),msg=(t,cls='')=>{const m=$('.form-msg');m.className='form-msg '+cls;m.textContent=t||''};

// ---- entry points ----
// child.js: unhide "Read values" on lab-report inbox items when this browser can read them.
export async function decorate(box){
 const btns=[...box.querySelectorAll('[data-read-report]')];if(!btns.length)return;
 const ok=await canRead();for(const b of btns)b.hidden=!ok;
}
// labs.js: an "Import from a report" button next to "Add results" (the file is saved to Records first).
export async function labsEntry(addBtn,profile){
 if(!addBtn||!(await canRead()))return;
 css();
 let b=document.getElementById('lab-import');
 if(!b){b=document.createElement('button');b.type='button';b.id='lab-import';b.className='ghost';b.textContent='Import from a report';addBtn.after(b)}
 b.hidden=false;b.onclick=()=>pickAndImport(profile());
}
function pickAndImport(p){
 const inp=document.createElement('input');inp.type='file';inp.accept='application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
 inp.onchange=async()=>{const f=inp.files[0];if(!f)return;
  if(f.size>8*1024*1024){alert('That file is larger than 8 MB.');return}
  open(p,'Saving the file to Records…');
  try{
   const dataBase64=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});
   const mt=f.type||(/\.pdf$/i.test(f.name)?'application/pdf':'');
   const {item}=await post(`/api/inbox?profile=${encodeURIComponent(p)}`,{category:'lab-report',date:today(),title:(f.name.replace(/\.[^.]+$/,'')||'Lab report').slice(0,120),fileName:f.name,mimeType:mt,dataBase64});
   dispatchEvent(new CustomEvent('inboxchange',{detail:{profile:p}}));
   const same=(item.sameAs||[]).find(s=>s.labReportId);
   if(same){stage(`<p>This file was already imported on ${esc(day(same.date))}. A copy was saved to Records; delete it there if you don't need it.</p>`,[['ghost','close','Close']]);return}
   await readItem(p,item,f);
  }catch(e){stage(`<p>${esc(e.message||'Could not save the file.')}</p>`,[['ghost','close','Close']])}
 };
 inp.click();
}
// child.js: "Read values" on an inbox item.
export async function readUpload(p,item){
 open(p,'Opening the file…');
 if(item.labReportId){stage(`<p>Values from this file were already saved. Find them under Lab reports.</p>`,[['ghost','close','Close']]);return}
 try{const r=await fetch(fileUrl(p,item.id),{credentials:'same-origin'});if(!r.ok)throw Error('Could not open the file');
  const b=await r.blob();await readItem(p,item,new File([b],item.fileName||'report',{type:item.mimeType||b.type}))}
 catch(e){stage(`<p>${esc(e.message)}</p>`,[['ghost','close','Close']])}
}

// ---- stages ----
function open(p,text){dialog();state={p};stage(`<p class="rr-progress">${esc(text)}</p>`,[['ghost','close','Cancel']]);if(!dlg.open)dlg.showModal()}
function stage(html,actions){
 $('.rr-body').innerHTML=html;msg('');
 $('.rr-actions').innerHTML=actions.map(([cls,act,label])=>`<button type="${act==='save'?'submit':'button'}" class="${cls}" ${act==='save'?'':`data-rr="${act}"`}>${esc(label)}</button>`).join('');
}
async function readItem(p,item,file,langs=DEFAULT_LANGS){
 const abort=new AbortController();state={p,item,file,langs,abort};
 const progress=e=>{const el=$('.rr-progress');if(!el)return;
  el.textContent=e.stage==='page'?`Reading page ${e.page} of ${e.pages}…`:e.stage==='ocr'?`Recognising text… ${Math.round((e.progress||0)*100)}%`:'Loading the reader (first time can take a moment)…'};
 stage('<p class="rr-progress">Reading the report on this device…</p><p class="muted rr-small">The file is read on this device. Nothing is sent anywhere until you save.</p>',[['ghost','close','Cancel']]);
 try{
  const [cat,res]=await Promise.all([api(`/api/labs/catalog?profile=${encodeURIComponent(p)}`),extract(file,{langs,onProgress:progress,signal:abort.signal})]);
  if(state?.abort!==abort)return;
  const m=mapReport(res.tokens,cat.markers,{method:res.method});
  state={...state,cat:cat.markers,res,m,rows:m.rows.map((r,i)=>({...r,i,choice:r.marker?'map':'skip',markerName:r.marker||'',remember:false,customName:r.name,customUnit:r.unit||''}))};
  if(!m.rows.length){stage(`<p>No results could be read from this file.</p><p class="muted rr-small">${res.method==='ocr'?'Try a sharper, straight photo in good light, or enter the values by hand.':'Enter the values by hand with “Add results”.'}</p>`,[['ghost','close','Close']]);return}
  review();
 }catch(e){
  if(e?.name==='AbortError')return;
  stage(`<p>${esc(e.message||'Could not read this file.')}</p><p class="muted rr-small">You can still enter the values by hand with “Add results”.</p>`,[['ghost','close','Close']]);
 }
}

// ---- review ----
const BADGE={high:['ok','Looks right'],medium:['check','Check this'],low:['low','Low confidence'],unmapped:['new','Not recognised']};
const ISSUE={'no-unit':'No unit printed','unit-unknown':'Unit not known for this marker','implausible':'Value looks implausible','flag-mismatch':'Flag and range disagree',
 'text-value':'Text results can’t be saved yet','ocr-fixed':'Some characters were corrected','ocr-unit':'Unit corrected from the scan','range-ocr-fixed':'Range read with corrected decimals','value-ocr-fixed':'Decimal point restored from the scan',
 'range-unclear':'Range unclear','value-unclear':'Value may have lost its decimal point','duplicate':'Same marker earlier in this report','duplicate-other-unit':'Same marker earlier, other unit','saved':'Already saved for this date'};
function rowHtml(r){
 const [cls,label]=BADGE[r.bucket]||BADGE.low,text=r.valueType==='text',mapped=r.choice==='map'&&r.markerName;
 const hint=hintFor(r);
 const choice=r.marker?'':`<label class="field">What is this?<select data-k="choice"><option value="skip"${r.choice==='skip'?' selected':''}>Skip (don’t save)</option><option value="map"${r.choice==='map'?' selected':''}>It’s a marker in the list…</option><option value="custom"${r.choice==='custom'?' selected':''}>Save as a new marker</option></select></label>`;
 const mapField=r.marker||r.choice==='map'?`<label class="field">Marker<input data-k="markerName" list="rr-markers" value="${esc(r.markerName)}" maxlength="120" autocomplete="off" placeholder="Start typing, e.g. Ferritin"></label>${!r.marker?`<label class="lab-check"><input type="checkbox" data-k="remember"${r.remember?' checked':''}> Remember “${esc(r.name)}” for this household</label>`:''}`:'';
 const custom=r.choice==='custom'?`<div class="fields"><label class="field">New marker name<input data-k="customName" value="${esc(r.customName)}" maxlength="120"></label><label class="field">Its usual unit<input data-k="customUnit" value="${esc(r.customUnit)}" maxlength="30"></label></div>`:'';
 const issues=r.issues.filter(x=>ISSUE[x]).map(x=>ISSUE[x]);
 return `<li class="rr-row rr-${cls}${r.include?' on':''}" data-i="${r.i}">
<div class="rr-top"><label class="rr-inc"><input type="checkbox" data-k="include"${r.include?' checked':''}${text?' disabled':''} aria-label="Save ${esc(r.markerName||r.name)}"><span class="rr-name">${esc(r.marker||r.name)}</span></label><span class="rr-badge">${label}</span></div>
<p class="rr-line" title="As printed on page ${r.page}">${esc(r.line)}</p>
${choice}${mapField}${custom}
<div class="rr-vals"><label class="field">Value<input data-k="value" value="${esc(r.value)}" inputmode="decimal" maxlength="40"${text?' readonly':''}></label><label class="field">Unit<input data-k="unit" value="${esc(r.unit||'')}" maxlength="30"></label><label class="field">Range<input data-k="reference" value="${esc(r.reference||'')}" maxlength="60"></label><label class="field">Flag<select data-k="flag"><option value=""${!r.flag?' selected':''}>None</option><option value="high"${r.flag==='high'?' selected':''}>Above</option><option value="low"${r.flag==='low'?' selected':''}>Below</option></select></label></div>
${hint?`<p class="rr-hint">${esc(hint)}</p>`:''}${issues.length?`<p class="rr-issues">${issues.map(esc).join(' · ')}</p>`:''}</li>`;
}
function hintFor(r){
 const e=state.cat.find(m=>m.name===(r.choice==='map'?r.markerName:r.marker));if(!e||!e.unit||!r.unit)return '';
 const n=Number(String(r.value).replace(/^[<>≤≥]=?/,'').replace(',','.'));if(!Number.isFinite(n))return '';
 const p=toPreferred(e,n,r.unit);return p&&p.factor!==1?`≈ ${round(p.num)} ${prettyUnit(e.unit)}`:'';
}
function review(){
 const {m,res,item,p}=state,ocr=res.method==='ocr';
 const names=[...new Set(state.cat.flatMap(x=>[x.name]))].sort((a,b)=>a.localeCompare(b));
 const top=`<p class="rr-note ${ocr?'warn':''}">${ocr?'Read with text recognition. Check every value against the report before saving.':'Read from the PDF’s text. Check the values before saving.'} Nothing is saved until you tap Save. <a href="${esc(fileUrl(p,item.id))}" target="_blank" rel="noopener">Open the original ↗</a></p>`+
  (res.skippedPages?`<p class="rr-note warn">Only the first ${MAX_PAGES} of ${res.pages} pages were read.</p>`:'')+'<div class="rr-dups" hidden></div>';
 const meta=`<div class="fields"><label class="field">Report date<input type="date" data-meta="date" value="${esc(m.date||item.date||'')}" max="${today()}" required></label><label class="field">Title<input data-meta="title" value="${esc(m.title||item.title||'')}" maxlength="120"></label></div>
<label class="lab-check"><input type="checkbox" data-meta="screening"> Screening result (no lab reference ranges)</label><label class="lab-check"><input type="checkbox" data-meta="preliminary"> Preliminary result</label>`;
 const unread=m.unread.length?`<details class="rr-unread"><summary>Lines not read (${m.unread.length})</summary><ul>${m.unread.slice(0,80).map(u=>`<li>${esc(u.text)}</li>`).join('')}</ul></details>`:'';
 const hindi=ocr&&!state.langs.includes('hin')?'<button type="button" class="text-button" data-rr="hindi">Report in Hindi? Read again with Hindi</button>':'';
 stage(top+meta+`<h3 class="rr-h">Results</h3><ul class="rr-rows">${state.rows.map(rowHtml).join('')}</ul>${unread}${hindi}<datalist id="rr-markers">${names.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>`,[['ghost','close','Cancel'],['primary','save','Save']]);
 count();checkDups();
}
function count(){const n=state.rows.filter(r=>r.include).length,b=dlg.querySelector('.rr-actions .primary');if(b){b.textContent=n?`Save ${n} value${n===1?'':'s'}`:'Save';b.disabled=!n}}
let dupSeq=0;
async function checkDups(){
 const s=state,date=$('[data-meta=date]')?.value,n=++dupSeq;if(!date)return;
 const values=s.rows.filter(r=>r.marker&&r.num!==null).map(r=>({marker:r.marker,num:r.num,unit:r.unit||undefined}));if(!values.length)return;
 try{
  const d=await post(`/api/labs/check?profile=${encodeURIComponent(s.p)}`,{date,values});if(n!==dupSeq||state!==s)return;
  const box=$('.rr-dups'),dup=new Set(d.duplicates);
  for(const r of s.rows){const was=r.issues.includes('saved');if(dup.has(r.marker)&&!was)r.issues.push('saved');if(!dup.has(r.marker)&&was)r.issues=r.issues.filter(x=>x!=='saved')}
  box.hidden=!d.reports.length&&!dup.size;
  box.innerHTML=d.reports.length?`<p class="rr-note warn">A report from ${esc(day(date))} already has ${Math.round(d.reports[0].overlap*100)}% of these values${d.reports[0].title?' (“'+esc(d.reports[0].title)+'”)':''}. This may be the same report.</p><button type="button" class="text-button" data-rr="undup">Untick values already saved</button>`
   :dup.size?`<p class="rr-note">${dup.size} value${dup.size===1?' is':'s are'} already saved for this date.</p><button type="button" class="text-button" data-rr="undup">Untick them</button>`:'';
  for(const li of dlg.querySelectorAll('.rr-row')){const r=s.rows[li.dataset.i];const iss=li.querySelector('.rr-issues');const t=r.issues.filter(x=>ISSUE[x]).map(x=>ISSUE[x]).join(' · ');if(iss)iss.textContent=t;else if(t)li.insertAdjacentHTML('beforeend',`<p class="rr-issues">${esc(t)}</p>`)}
 }catch{}
}
function rerender(i){const li=dlg.querySelector(`.rr-row[data-i="${i}"]`);if(li){li.outerHTML=rowHtml(state.rows[i])}count()}
function onClick(e){
 const a=e.target.closest('[data-rr]')?.dataset.rr;if(!a)return;
 if(a==='close')return dlg.close();
 if(a==='hindi'){const {p,item,file}=state;return readItem(p,item,file,[...DEFAULT_LANGS,'hin'])}
 if(a==='undup'){for(const r of state.rows)if(r.issues.includes('saved')&&r.include){r.include=false;rerender(r.i)}return}
}
function field(e){const li=e.target.closest('.rr-row'),k=e.target.dataset.k;return li&&k?{r:state.rows[li.dataset.i],k,el:e.target}:null}
function onInput(e){
 const f=field(e);if(!f)return;const {r,k,el}=f;
 if(k==='value'||k==='unit'||k==='reference'||k==='markerName'||k==='customName'||k==='customUnit'){r[k]=el.value;
  if(k==='value')r.num=Number(String(el.value).replace(/^[<>≤≥]=?/,'').replace(',','.'));
  if(k==='value'||k==='unit'||k==='markerName'){const li=el.closest('.rr-row');let h=li.querySelector('.rr-hint');const t=hintFor(r);if(t){if(!h){li.querySelector('.rr-vals').insertAdjacentHTML('afterend','<p class="rr-hint"></p>');h=li.querySelector('.rr-hint')}h.textContent=t}else h?.remove()}}
}
function onChange(e){
 if(e.target.dataset.meta==='date')return checkDups();
 const f=field(e);if(!f)return;const {r,k,el}=f;
 if(k==='include'){r.include=el.checked;el.closest('.rr-row').classList.toggle('on',el.checked);count();return}
 if(k==='remember'){r.remember=el.checked;return}
 if(k==='flag'){r.flag=el.value||null;return}
 if(k==='choice'){r.choice=el.value;r.include=el.value!=='skip'&&r.valueType==='number';rerender(r.i);return}
 if(k==='markerName'&&!r.marker&&r.markerName&&r.choice==='map'&&r.valueType==='number'){r.include=true;rerender(r.i)}
}

// ---- save ----
async function save(){
 const s=state;if(!s?.rows)return;
 const date=$('[data-meta=date]').value;if(!date){msg('Choose the report date.','bad');return}
 const known=new Set(s.cat.map(x=>x.name)),values=[],learn={custom:[],aliases:[]},problems=[];
 for(const r of s.rows.filter(r=>r.include)){
  let name=r.marker;
  if(!name&&r.choice==='map'){name=r.markerName.trim();if(!known.has(name)){problems.push(`Choose “${r.name}” from the list, or save it as a new marker.`);continue}if(r.remember&&normalized(r.name)!==normalized(name))learn.aliases.push({marker:name,alias:r.name})}
  else if(!name&&r.choice==='custom'){name=r.customName.trim();if(!name){problems.push('Give the new marker a name.');continue}if(!learn.custom.some(c=>c.name===name))learn.custom.push({name,unit:r.customUnit.trim()||undefined})}
  else if(name&&r.markerName&&r.markerName!==name){name=r.markerName.trim();if(!known.has(name)){problems.push(`Choose a marker from the list for “${r.name}”.`);continue}}
  if(!name)continue;
  values.push({name,value:String(r.value).trim(),unit:String(r.unit||'').trim()||undefined,reference:String(r.reference||'').trim()||undefined,flag:r.flag||undefined,page:r.page||undefined,rawName:r.name,confidence:r.conf,method:s.res.method});
 }
 if(problems.length){msg(problems[0],'bad');return}
 if(!values.length){msg('Tick at least one value to save.','bad');return}
 const body={date,title:$('[data-meta=title]').value.trim()||undefined,screening:$('[data-meta=screening]').checked,preliminary:$('[data-meta=preliminary]').checked,
  uploadId:s.item.id,source:s.item.fileName&&/^[\w .()\-]{1,120}\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(s.item.fileName)?s.item.fileName:undefined,method:s.res.method,values,
  ...(learn.custom.length||learn.aliases.length?{learn}:{})};
 const btn=dlg.querySelector('.rr-actions .primary');btn.disabled=true;msg('Saving…');
 try{await post(`/api/labs?profile=${encodeURIComponent(s.p)}`,body);dlg.close();
  dispatchEvent(new CustomEvent('labschange',{detail:{profile:s.p}}));dispatchEvent(new CustomEvent('inboxchange',{detail:{profile:s.p}}))}
 catch(e){msg(e.message||'Could not save.','bad');btn.disabled=false}
}
const normalized=s=>String(s).trim().toLowerCase();
