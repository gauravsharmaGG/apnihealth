// "Import your Apple Health history": reads the export on this device (see ahparse.js) and uploads only daily totals.
(()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LABEL={steps:['Steps','days'],weight:['Weight','readings'],resting_hr:['Resting heart rate','days'],body_fat:['Body fat','readings'],bp_sys:['Blood pressure (top)','days'],bp_dia:['Blood pressure (bottom)','days'],sleep:['Sleep','nights']};
const fmtD=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
let result=null,abort=null,lock=null;
function build(){
 if($('#ah-import')||!$('#sync'))return;
 const el=document.createElement('details');el.className='panel sync';el.id='ah-import';
 el.innerHTML='<summary>Import Apple Health history</summary><div class="sync-body">'
  +'<p>Fill your charts with past steps, weight, heart rate, blood pressure and sleep. Use it once, or any time you want to catch up.</p>'
  +'<ol><li>On your iPhone open <strong>Health</strong>, tap your picture (top right), then <strong>Export All Health Data</strong> and <strong>Export</strong>.</li><li>Save the zip to <strong>Files</strong>. This can take a few minutes, and the file can be several hundred MB.</li><li>Choose it below.</li></ol>'
  +'<p class="ai-priv">🔒 The file is read on your phone. Only daily totals are sent to this page, never the raw export.</p>'
  +'<p class="muted">Importing into <b id="ai-who"></b>. Use that person’s own phone export.</p>'
  +'<label class="field">How far back<select id="ai-range"><option value="">Everything</option><option value="3">Last 3 years</option><option value="1">Last year</option></select></label>'
  +'<input type="file" id="ai-file" accept=".zip,.xml,application/zip,application/x-zip-compressed,text/xml" hidden>'
  +'<div class="set-actions"><button class="primary" id="ai-pick" type="button">Choose export file…</button><button class="ghost" id="ai-cancel" type="button" hidden>Cancel</button></div>'
  +'<progress id="ai-prog" hidden max="1" value="0" aria-label="Progress"></progress><p class="set-msg" id="ai-status" role="status"></p>'
  +'<div id="ai-result" hidden></div></div>';
 $('#sync').after(el);
 $('#ai-pick').onclick=()=>$('#ai-file').click();
 $('#ai-file').onchange=e=>{const f=e.target.files[0];if(f)run(f);e.target.value=''};
 $('#ai-cancel').onclick=()=>{abort?.abort();reset('Cancelled.')};
 who();
}
const who=()=>{const n=window.PROFILES?.[window.PROFILE]?.name||'this profile';const e=$('#ai-who');if(e)e.textContent=n};
function reset(msg=''){result=null;abort=null;release();$('#ai-prog').hidden=true;$('#ai-cancel').hidden=true;$('#ai-pick').disabled=false;$('#ai-result').hidden=true;$('#ai-result').innerHTML='';$('#ai-status').textContent=msg}
async function hold(){try{lock=await navigator.wakeLock?.request('screen')}catch{}}
function release(){try{lock?.release()}catch{}lock=null}
const sinceOf=()=>{const y=Number($('#ai-range').value);if(!y)return '';const d=new Date();d.setFullYear(d.getFullYear()-y);return d.toISOString().slice(0,10)};
async function run(file){
 reset();const prog=$('#ai-prog'),st=$('#ai-status');
 if(!('DecompressionStream' in window)&&!/\.xml$/i.test(file.name)){st.textContent='This browser can’t unzip files. Update iOS (16.4 or newer) or choose the unzipped export.xml.';return}
 abort=new AbortController();prog.hidden=false;prog.value=0;$('#ai-cancel').hidden=false;$('#ai-pick').disabled=true;st.textContent='Reading '+file.name+'… keep this screen open.';await hold();
 const t0=Date.now();
 try{
  result=await AHParse.importFile(file,{since:sinceOf(),signal:abort.signal,onProgress:p=>{prog.value=p;st.textContent='Reading… '+Math.round(p*100)+'%'}});
  release();prog.hidden=true;$('#ai-cancel').hidden=true;$('#ai-pick').disabled=false;
  const rows=Object.entries(result.summary).map(([m,x])=>'<tr><td>'+esc(LABEL[m]?.[0]||m)+'</td><td>'+x.n.toLocaleString('en-GB')+' '+(LABEL[m]?.[1]||'values')+'</td><td>'+fmtD(x.from)+' – '+fmtD(x.to)+'</td></tr>').join('');
  if(!result.entries.length){st.textContent='No steps, weight, heart rate, blood pressure or sleep were found'+(sinceOf()?' in that time range':'')+'.';return}
  st.textContent='Read in '+Math.max(1,Math.round((Date.now()-t0)/1000))+' s. Found:';
  const r=$('#ai-result');r.hidden=false;r.innerHTML='<table class="ai-table"><tbody>'+rows+'</tbody></table><p class="set-hint">Values for a day replace earlier imported or synced values for that day. Numbers you typed by hand are kept.</p><div class="set-actions"><button class="primary" id="ai-go" type="button">Import '+result.entries.length.toLocaleString('en-GB')+' values</button><button class="ghost" id="ai-drop" type="button">Discard</button></div>';
  $('#ai-go').onclick=upload;$('#ai-drop').onclick=()=>reset('Discarded.');
 }catch(e){reset(e.cancelled?'Cancelled.':'Could not read this file: '+(e.message||e))}
}
async function upload(){
 const go=$('#ai-go'),drop=$('#ai-drop'),st=$('#ai-status'),prog=$('#ai-prog'),all=result.entries,B=5000;let saved=0;
 go.disabled=true;drop.disabled=true;prog.hidden=false;prog.value=0;
 try{
  for(let i=0;i<all.length;i+=B){
   st.textContent='Importing… '+Math.min(all.length,i+B).toLocaleString('en-GB')+' of '+all.length.toLocaleString('en-GB');
   const r=await fetch('/api/import?profile='+encodeURIComponent(window.PROFILE||''),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:all.slice(i,i+B)})});
   const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Upload failed');saved+=j.saved||0;prog.value=Math.min(1,(i+B)/all.length);
  }
  prog.hidden=true;st.textContent='Done. '+saved.toLocaleString('en-GB')+' values imported. Updating your charts…';$('#ai-result').hidden=true;setTimeout(()=>location.reload(),1200);
 }catch(e){prog.hidden=true;go.disabled=false;drop.disabled=false;st.textContent='Import stopped: '+e.message+' (values already sent were saved; you can run it again safely).'}
}
addEventListener('profilechange',()=>{who();if($('#ai-import'))reset()});
if(document.readyState!=='loading')build();else addEventListener('DOMContentLoaded',build);
setTimeout(build,500);
})();
