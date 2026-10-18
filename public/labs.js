// Lab results entered in the app: loads the current member's results from /api/labs into the explorer
// (window.setLabData in app.js), lists their reports and handles the "Add results" form. "Import from a report"
// (reading a PDF or photo on the device) lives in report-review.mjs and is loaded only where the browser supports it.
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=()=>window.PROFILE,isAdult=()=>(window.PROFILES?.[P()]||{}).kind==='adult';
const day=s=>new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
async function api(path,opt){const r=await fetch(path+(path.includes('?')?'&':'?')+'profile='+encodeURIComponent(P()),{credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
let seq=0;
function show(j){
 window.setLabData?.(j.measurements||[]);
 const list=$('#lab-report-list');if(!list)return;
 const reps=(j.reports||[]).slice().reverse();
 list.innerHTML=reps.length?reps.map(r=>`<li><span><strong>${esc(r.title||r.source||'Lab report')}</strong><small>${day(r.date)} · ${r.count} result${r.count===1?'':'s'}${r.screening?' · screening':''}${r.preliminary?' · preliminary':''}</small></span>${r.uploadId?`<a class="text-button" href="/api/inbox/${encodeURIComponent(r.uploadId)}/file?profile=${encodeURIComponent(P())}" target="_blank" rel="noopener" aria-label="Open the original file of the report from ${day(r.date)}">Original</a>`:''}<button type="button" class="text-button" data-lab-del="${esc(r.id)}" aria-label="Delete report from ${day(r.date)}">Delete</button></li>`).join(''):'<li><span class="muted">No lab reports yet.</span></li>';
}
async function load(){
 const n=++seq;
 if(!isAdult()){window.setLabData?.([]);const b=$('#lab-import');if(b)b.hidden=true;return}
 import('/report-review.mjs').then(m=>m.labsEntry($('#lab-add'),P)).catch(()=>{}); // "Import from a report" where supported
 try{const j=await api('/api/labs');if(n===seq)show(j)}catch{if(n===seq){window.setLabData?.([]);const l=$('#lab-report-list');if(l)l.innerHTML='<li><span class="muted">Could not load lab results. Refresh to try again.</span></li>'}}
}
// ---- form ----
let catalogLoaded=false;
async function loadCatalog(){
 if(catalogLoaded)return;
 try{const r=await fetch('/api/labs/catalog',{credentials:'same-origin'});const j=await r.json();const names=new Set();for(const m of j.markers||[]){names.add(m.name);for(const a of m.aliases||[])names.add(a)}
  $('#lab-markers').innerHTML=[...names].sort((a,b)=>a.localeCompare(b)).map(n=>`<option value="${esc(n)}"></option>`).join('');catalogLoaded=true}catch{}
}
function addRow(){
 const rows=$('#lab-rows'),n=rows.children.length+1,f=document.createElement('fieldset');f.className='lab-row';
 f.innerHTML=`<legend>Result ${n}</legend><label class="field">Marker<input list="lab-markers" class="lab-name" maxlength="120" autocomplete="off" placeholder="Start typing, e.g. Ferritin"></label><div class="fields"><label class="field">Value<input class="lab-value" inputmode="decimal" maxlength="40" autocomplete="off" placeholder="e.g. 45"></label><label class="field">Unit<input class="lab-unit" maxlength="30" autocomplete="off" placeholder="e.g. ng/mL"></label></div><div class="fields"><label class="field">Report range<input class="lab-ref" maxlength="60" autocomplete="off" placeholder="e.g. 30-300"></label><label class="field">Flag<select class="lab-flag"><option value="">No flag</option><option value="high">Above range</option><option value="low">Below range</option></select></label></div><button type="button" class="text-button lab-row-del">Remove</button>`;
 rows.appendChild(f);return f;
}
function renumber(){[...$('#lab-rows').children].forEach((f,i)=>f.querySelector('legend').textContent='Result '+(i+1))}
function openForm(){
 $('#lab-form').reset();$('#lab-rows').innerHTML='';addRow();$('#lab-msg').textContent='';
 $('#lab-date').value=new Date().toLocaleDateString('en-CA');loadCatalog();$('#lab-dialog').showModal();
}
async function submit(e){
 e.preventDefault();const msg=$('#lab-msg'),btn=$('#lab-form button[type=submit]');
 const values=[...$('#lab-rows').children].map(f=>({name:f.querySelector('.lab-name').value.trim(),value:f.querySelector('.lab-value').value.trim(),unit:f.querySelector('.lab-unit').value.trim(),reference:f.querySelector('.lab-ref').value.trim(),flag:f.querySelector('.lab-flag').value})).filter(v=>v.name||v.value);
 if(!values.length){msg.textContent='Add at least one result.';return}
 const body={date:$('#lab-date').value,title:$('#lab-title').value.trim(),screening:$('#lab-screening').checked,preliminary:$('#lab-prelim').checked,values};
 btn.disabled=true;msg.textContent='Saving…';
 try{const j=await api('/api/labs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});seq++;show(j);$('#lab-dialog').close()}
 catch(err){msg.textContent=err.message}
 finally{btn.disabled=false}
}
document.addEventListener('click',async e=>{
 if(e.target.id==='lab-add')return openForm();
 if(e.target.id==='lab-cancel')return $('#lab-dialog').close();
 if(e.target.id==='lab-row-add'){addRow().querySelector('.lab-name').focus();return}
 const rd=e.target.closest('.lab-row-del');if(rd){if($('#lab-rows').children.length>1){rd.closest('.lab-row').remove();renumber()}return}
 const del=e.target.closest('[data-lab-del]');if(del){if(!confirm('Delete this lab report and its results?'))return;try{const j=await api('/api/labs/'+encodeURIComponent(del.dataset.labDel),{method:'DELETE'});seq++;show(j)}catch(err){alert(err.message)}}
});
$('#lab-form')?.addEventListener('submit',submit);
addEventListener('profilechange',load);
addEventListener('labschange',e=>{if(e.detail?.profile===P()){seq++;load()}});
load();
})();
