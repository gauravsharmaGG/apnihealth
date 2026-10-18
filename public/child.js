// Child records (growth, check-ups, vaccinations, source library) from window.CHILD_RECORDS[memberId],
// and the per-member record inbox used by child and adult members.
(()=>{
const EMPTY={profile:{},uExams:[],vaccineProducts:{},vaccinations:[],recommendationReference:null,recommendations:[],sourceRecords:[]};
let V=EMPTY;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=()=>window.PROFILE;
const member=()=>window.PROFILES?.[P()]||{};
const record=p=>({...EMPTY,...(window.CHILD_RECORDS?.[p]||{})});
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const D=s=>new Date(s+'T12:00:00');
const fmt=(s,o)=>D(s).toLocaleDateString('en-GB',o||{day:'numeric',month:'short',year:'numeric'});
const fshort=s=>fmt(s,{day:'numeric',month:'short'});
const nf=(v,dp=0)=>Number(v).toLocaleString('en-GB',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const todayStr=()=>new Date().toLocaleDateString('en-CA');
async function api(path,opt){const r=await fetch(path,{credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Request failed'),{status:r.status});return j}
const post=(path,body,method='POST')=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const tipAttr=(lines,href,label)=>` data-tip="${esc(lines.filter(Boolean).join('||'))}"${href?` data-href="${esc(href)}" data-label="${esc(label||'Open ↗')}"`:''}`;

// ---------- growth ----------
const GROW=[['weight','Weight','kg',2],['length','Length','cm',1],['headCircumference','Head circumference','cm',1]];
function growthChart(key,unit,dp,compact){
 const pts=V.uExams.filter(e=>Number.isFinite(e.measurements?.[key]?.value)).map(e=>({l:e.id,d:e.date,v:e.measurements[key].value,url:e.sourceUrl,stage:e.stage}));
 if(!pts.length)return '<p class="muted">No measurements recorded yet.</p>';
 const narrow=innerWidth<700,W=narrow?360:640,H=compact?(narrow?190:215):(narrow?240:280),L=narrow?42:50,R=22,T=26,B=40;
 const t=pts.map(p=>Date.parse(p.d+'T12:00:00Z')),t0=t[0],t1=t.at(-1);let lo=Math.min(...pts.map(p=>p.v)),hi=Math.max(...pts.map(p=>p.v));const pad=(hi-lo)*.15||1;lo=Math.max(0,lo-pad);hi+=pad;
 const x=i=>L+(t[i]-t0)/(t1-t0||1)*(W-L-R),y=v=>H-B-(v-lo)/(hi-lo)*(H-T-B);
 let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} at each check-up">`;
 for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,yy=y(v);s+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="gridline"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="axis">${nf(v,hi-lo<12?1:0)}</text>`}
 s+=`<polyline class="logline" points="${pts.map((p,i)=>x(i)+','+y(p.v)).join(' ')}"/>`;
 pts.forEach((p,i)=>{const pr=pts[i-1],lines=[`${nf(p.v,dp)} ${unit}`,`${p.l} · ${p.stage} · ${fmt(p.d)}`,pr?`${p.v>=pr.v?'↑':'↓'} ${nf(Math.abs(p.v-pr.v),dp)} ${unit} since ${pr.l}`:'First measurement'];
  s+=`<circle cx="${x(i)}" cy="${y(p.v)}" r="16" class="hit"${tipAttr(lines,p.url,'Open check-up record ↗')}/><circle cx="${x(i)}" cy="${y(p.v)}" r="${compact?4.5:5.5}" class="point"${tipAttr(lines,p.url,'Open check-up record ↗')}/>`;
  if(!narrow||i%2===0||i===pts.length-1)s+=`<text x="${x(i)}" y="${H-14}" text-anchor="middle" class="axis">${p.l}</text>`});
 return s+'</svg>';
}
function renderGrowth(){
 $('#c-growth-charts').innerHTML=GROW.map(([k,l,u,dp])=>`<article class="panel"><div class="section-head"><h3>${l}</h3><span class="muted">${u}</span></div><div class="chart">${growthChart(k,u,dp)}</div></article>`).join('');
 $('#c-exams').innerHTML=V.uExams.slice().reverse().map(e=>`<article class="exam"><div class="exam-id">${esc(e.id)}</div><div class="exam-main"><h3>${esc(e.stage)}</h3><p class="muted">${fmt(e.date)}</p><div class="exam-meas"><span><b>${nf(e.measurements?.weight?.value??NaN,2)}</b> kg</span><span><b>${nf(e.measurements?.length?.value??NaN,1)}</b> cm length</span><span><b>${nf(e.measurements?.headCircumference?.value??NaN,1)}</b> cm head</span></div><p class="exam-note">${esc(e.note)}</p></div>${e.sourceUrl?`<a class="ghost-link" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">Open record ↗</a>`:''}</article>`).join('')||'<p class="muted">No check-ups recorded yet.</p>';
 $('#c-preview').innerHTML=GROW.slice(0,2).map(([k,l,u,dp])=>`<article class="panel preview"><div class="section-head"><h3>${l}</h3><a href="#c-growth">Explore →</a></div><div class="chart">${growthChart(k,u,dp,true)}</div></article>`).join('');
}

// ---------- vaccinations ----------
function renderVax(){
 const prod=V.vaccineProducts;
 $('#c-vax').innerHTML=V.vaccinations.slice().reverse().map(v=>`<article class="vax"><div class="vax-date"><b>${D(v.date).getDate()}</b><span>${fmt(v.date,{month:'short',year:'numeric'})}</span></div><div class="vax-main"><div class="chips">${v.products.map(p=>`<span class="chip prod">${esc(p)}</span>`).join('')}</div><p class="muted">${v.coverage.map(esc).join(' · ')}</p><details><summary>What these protect against</summary>${v.products.map(p=>`<p><strong>${esc(p)}.</strong> ${esc(prod[p]?.protectsAgainst||'')} ${prod[p]?`<a href="${esc(prod[p].informationUrl)}" target="_blank" rel="noopener">Product information ↗</a>`:''}</p>`).join('')}</details></div></article>`).join('')+(V.sourceRecords.some(r=>r.category==='Vaccination')?`<p class="footnote">Record photos: ${V.sourceRecords.filter(r=>r.category==='Vaccination').map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title.replace('Vaccination booklet · ',''))} ↗</a>`).join(' · ')}</p>`:'');
 if(!V.vaccinations.length)$('#c-vax').innerHTML='<p class="muted">No vaccinations recorded yet.</p>';
 const ref=V.recommendationReference;$('#c-guide').hidden=!ref;if(!ref)return;const _r=ref,groups=['Baby & toddler','Later childhood','Individual situations'];
 $('#c-guide-body').innerHTML=`<p class="muted">${esc(ref.title)} · ${esc(ref.jurisdiction)} · updated ${esc(ref.updated)}. <a href="${esc(ref.url)}" target="_blank" rel="noopener">Source ↗</a>. General guidance only. It does not say whether a series is complete. Ask the paediatrician about ${esc(member().name||'your child')}’s own schedule.</p>`+groups.map(g=>`<h3>${g}</h3><ul class="guide-list">${V.recommendations.filter(r=>r.group===g).map(r=>{const m=V.vaccinations.filter(v=>v.products.some(p=>r.matchingProducts.includes(p))).map(v=>fmt(v.date,{day:'numeric',month:'short',year:'2-digit'}));return `<li><strong>${esc(r.title)}</strong><span>${esc(r.timing)}</span><p>${esc(r.doseGuide)}${r.note?' '+esc(r.note):''}</p><small>${m.length?'Recorded here: '+m.join(', '):r.matchingProducts.length?'No matching entry recorded here.':'Not tracked in this record.'}</small></li>`}).join('')}</ul>`).join('');
}

// ---------- overview ----------
function ageText(){if(!V.profile.firstRecordDate)return '—';const b=new Date(V.profile.firstRecordDate+'T12:00:00'),n=new Date();let m=(n.getFullYear()-b.getFullYear())*12+n.getMonth()-b.getMonth();if(n.getDate()<b.getDate())m--;const y=Math.floor(m/12),r=m%12;return y?`${y} y ${r} mo`:`${m} months`}
function renderOverview(){
 const l=V.uExams.at(-1),pr=V.uExams.at(-2);
 if(!l){$('#c-tiles').innerHTML=`<div class="tile"><span class="tile-label">Age</span><span class="tile-value"><b>${ageText()}</b></span><span class="tile-sub">No check-ups recorded yet</span></div>`;$('#c-lastvax').innerHTML='';return}
 const d=(k,dp)=>pr?`${l.measurements[k].value>=pr.measurements[k].value?'+':'−'}${nf(Math.abs(l.measurements[k].value-pr.measurements[k].value),dp)} since ${pr.id}`:l.id;
 const tile=(lab,v,u,sub,dp)=>`<a class="tile" href="#c-growth"><span class="tile-label">${lab}</span><span class="tile-value"><b data-to="${v}" data-dp="${dp}">${nf(v,dp)}</b><small>${u}</small></span><span class="tile-sub">${sub}</span></a>`;
 $('#c-tiles').innerHTML=`<div class="tile"><span class="tile-label">Age</span><span class="tile-value"><b>${ageText()}</b></span><span class="tile-sub">${V.profile.firstRecordDate?'Born '+fmt(V.profile.firstRecordDate):''}</span></div>`+tile('Weight',l.measurements.weight.value,'kg',d('weight',2)+' · '+fmt(l.date,{day:'numeric',month:'short'}),2)+tile('Length',l.measurements.length.value,'cm',d('length',1),1)+tile('Head',l.measurements.headCircumference.value,'cm',d('headCircumference',1),1);
 $('#c-tiles').querySelectorAll('b[data-to]').forEach((b,i)=>{b.closest('.tile').style.setProperty('--i',i);if(reduce)return;const to=Number(b.dataset.to),dp=Number(b.dataset.dp),t0=performance.now();const st=t=>{const k=Math.min(1,(t-t0)/800);b.textContent=nf(to*(1-Math.pow(1-k,3)),dp);if(k<1)requestAnimationFrame(st)};requestAnimationFrame(st)});
 const lv=V.vaccinations.at(-1);$('#c-lastvax').innerHTML=!lv?'':`<a class="episode-card" href="#c-vaccines"><span class="ep-ic">🛡</span><span><strong>${lv.products.map(esc).join(', ')}</strong><small>${fmt(lv.date)} · ${lv.coverage.map(esc).join(' · ')} · ${V.vaccinations.length} visits recorded</small></span><em>Timeline →</em></a>`;
}

// ---------- record inbox (any profile) ----------
const CATS={'u-examination':'Check-up','vaccination':'Vaccination','growth-chart':'Growth chart','lab-report':'Lab report','medical-document':'Medical document','other':'Other'};
const CATS_FOR={child:['u-examination','vaccination','growth-chart','medical-document','other'],adult:['lab-report','medical-document','other']};
const kindOf=p=>window.PROFILES?.[p]?.kind==='child'?'child':'adult';
function inboxMarkup(p){return `<form class="inbox-form" data-p="${p}" novalidate><label class="field">Type<select name="category">${CATS_FOR[kindOf(p)].map(c=>`<option value="${c}">${CATS[c]}</option>`).join('')}</select></label><label class="field">Date of the record<input type="date" name="date" required></label><label class="field wide">Title<input name="title" maxlength="120" placeholder="e.g. Blood test results" autocomplete="off"></label><label class="field wide">Note (optional)<input name="note" maxlength="500" autocomplete="off"></label><label class="field wide">Photo or PDF, up to 8 MB<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"></label><button class="primary" type="submit">Save for review</button><p class="form-msg" role="status" aria-live="polite"></p></form><div class="inbox-list"></div>`}
const inboxItems=new Map();
async function loadInbox(p){
 const box=document.querySelector(`[data-inbox="${kindOf(p)}"]`);if(!box)return;
 if(box.dataset.ready!==p){box.innerHTML=inboxMarkup(p);box.dataset.ready=p;box.querySelector('input[type=date]').value=todayStr();box.querySelector('input[type=date]').max=todayStr()}
 try{const {items}=await api(`/api/inbox?profile=${p}`);inboxItems.set(p,items);box.querySelector('.inbox-list').innerHTML=items.length?`<h3>Saved records</h3><ul class="entry-list">${items.map(i=>`<li><span class="e-main"><span class="chip prod">${esc(CATS[i.category]||i.category)}</span><strong>${esc(i.title)}</strong></span><span class="e-meta">${fmt(i.date)} · ${nf(i.size/1024,0)} KB · ${i.status==='imported'?'Values saved':'Needs review'}${i.note?' · '+esc(i.note):''}</span><span class="row-actions">${i.category==='lab-report'&&i.status!=='imported'&&kindOf(p)==='adult'?`<button type="button" class="text-button" data-read-report="${esc(i.id)}" data-p="${p}" hidden>Read values</button>`:''}<a class="text-button" href="/api/inbox/${esc(i.id)}/file?profile=${p}" target="_blank" rel="noopener">Open</a><button class="text-button danger" data-delbox="${esc(i.id)}" data-p="${p}">Delete</button></span></li>`).join('')}</ul>`:'';
  if(items.some(i=>i.category==='lab-report'&&i.status!=='imported'))import('/report-review.mjs').then(m=>m.decorate(box)).catch(()=>{}); // "Read values" where supported
 }catch{}
}
async function submitInbox(form){
 const p=form.dataset.p,msg=form.querySelector('.form-msg'),f=form.file.files[0],bad=t=>{msg.className='form-msg bad';msg.textContent=t};
 if(!form.title.value.trim())return bad('Add a short title.');if(!form.date.value)return bad('Choose the date of the record.');if(!f)return bad('Choose a photo or PDF.');if(f.size>8*1024*1024)return bad('That file is larger than 8 MB.');
 const btn=form.querySelector('button.primary');btn.disabled=true;msg.className='form-msg';msg.textContent='Uploading…';
 try{const dataBase64=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});
  const mt=f.type||(/\.pdf$/i.test(f.name)?'application/pdf':'');
  await post(`/api/inbox?profile=${p}`,{category:form.category.value,date:form.date.value,title:form.title.value.trim(),note:form.note.value.trim()||undefined,fileName:f.name,mimeType:mt,dataBase64});
  form.title.value='';form.note.value='';form.file.value='';msg.className='form-msg good';msg.textContent='Saved. It is marked “needs review”.';await loadInbox(p)}
 catch(e){bad(e.message||'Could not upload.')}
 btn.disabled=false;
}

// ---------- sources ----------
function renderSources(){$('#c-sources').innerHTML=V.sourceRecords.map(r=>`<a class="record" href="${esc(r.url)}" target="_blank" rel="noopener"><span class="pdf">${r.category==='Vaccination'?'VAX':'DOC'}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.description)}</small></span><span aria-hidden="true">↗</span></a>`).join('')||'<p class="muted">No linked records yet.</p>'}

// ---------- wiring ----------
const isChild=()=>member().kind==='child';
let shown=null;
function activate(){
 const p=P();if(!p)return;
 if(isChild()&&shown!==p){shown=p;V=record(p);renderOverview();renderGrowth();renderVax();renderSources()}
 loadInbox(p);
}
document.addEventListener('click',async e=>{
 const db=e.target.closest('[data-delbox]');if(db){if(!confirm('Delete this record and its file?'))return;try{await api(`/api/inbox/${encodeURIComponent(db.dataset.delbox)}?profile=${db.dataset.p}`,{method:'DELETE'});await loadInbox(db.dataset.p)}catch(err){alert(err.status===400&&err.message?err.message:'Could not delete. Try again.')}}
 const rr=e.target.closest('[data-read-report]');if(rr){const it=(inboxItems.get(rr.dataset.p)||[]).find(i=>i.id===rr.dataset.readReport);if(it)import('/report-review.mjs').then(m=>m.readUpload(rr.dataset.p,it)).catch(()=>alert('Could not start the reader.'))}
});
document.addEventListener('submit',e=>{if(e.target.matches('.inbox-form')){e.preventDefault();submitInbox(e.target)}});
addEventListener('profilechange',activate);
addEventListener('inboxchange',e=>{if(e.detail?.profile===P())loadInbox(P())});
addEventListener('layoutchange',()=>{if(isChild())renderGrowth()});
let wasN=innerWidth<700;addEventListener('resize',()=>{const n=innerWidth<700;if(n!==wasN){wasN=n;if(isChild())renderGrowth()}});
activate();
})();
