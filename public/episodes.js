// Health episodes for every profile: one illness or issue as a story (symptoms, temperatures, medicine, visits, tests) from start to recovery.
(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P=()=>window.PROFILE;
const MEM=()=>window.PROFILES?.[P()]||{},isLabs=()=>!!MEM().labs,isChild=()=>MEM().kind==='child';
const D=s=>new Date(s+'T12:00:00');
const fmt=(s,o)=>D(s).toLocaleDateString('en-GB',o||{day:'numeric',month:'short',year:'numeric'});
const fshort=s=>fmt(s,{day:'numeric',month:'short'});
const nf=(v,dp=0)=>Number(v).toLocaleString('en-GB',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const todayStr=()=>new Date().toLocaleDateString('en-CA');
const C=f=>(f-32)*5/9;
async function api(path,opt){const r=await fetch(path,{credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Request failed'),{status:r.status});return j}
const send=(path,body,method='POST')=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const q=(path)=>`${path}${path.includes('?')?'&':'?'}profile=${P()}`;
const tipAttr=lines=>` data-tip="${esc(lines.filter(Boolean).join('||'))}"`;
const KIND={temperature:'Temperature',medication:'Medicine',symptom:'Symptom',care:'Comfort care',visit:'Visit',test:'Test result',status:'Status update',note:'Note'};
let EP=[],EV=[],sel=null,filter='ongoing';
const tsOf=(d,t)=>new Date(`${d}T${t||'12:00'}:00`).getTime();
const byTime=(a,dir=1)=>a.slice().sort((x,y)=>dir*`${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
const entriesOf=id=>EV.filter(e=>e.episodeId===id);
const heading=e=>e.kind==='temperature'?`${nf(e.temperatureF,1)} °F (${nf(C(e.temperatureF),1)} °C)${e.note?' · '+e.note:''}`:e.kind==='medication'?`${e.medicine}${e.dose?' · '+e.dose:''}`:(e.note||KIND[e.kind]);
const when=e=>fmt(e.date,{weekday:'short',day:'numeric',month:'short',year:'numeric'})+(e.timeKnown===false?'':' · '+e.time);
const lastEntry=id=>{const l=byTime(entriesOf(id).filter(e=>e.date<=todayStr())).at(-1);return l};
const agoText=n=>n<=0?'today':n===1?'yesterday':n+' days ago';
const daysAgo=d=>Math.floor((Date.parse(todayStr()+'T12:00:00')-Date.parse(d+'T12:00:00'))/864e5);

// ---------- fever chart ----------
let tunit=null;
const unitPref=()=>{if(tunit)return tunit;try{tunit=localStorage.getItem('tunit-'+P())}catch{}return tunit||'C'};
function feverChart(group){
 const ord=byTime(group).filter(e=>e.kind==='temperature'||e.kind==='medication'),temps=ord.filter(e=>e.kind==='temperature'),meds=ord.filter(e=>e.kind==='medication');
 const U=unitPref()==='C',cv=v=>U?C(v):v,fx=U?1:1;
 const narrow=innerWidth<700,t0=tsOf(ord[0].date,ord[0].time)-36e5,t1=tsOf(ord.at(-1).date,ord.at(-1).time)+36e5,hours=(t1-t0)/36e5;
 const W=Math.max(narrow?340:640,Math.round(hours*(narrow?14:16)+90)),H=narrow?270:310,L=44,R=18,T=34,B=64;
 const vals=temps.map(e=>cv(e.temperatureF)),lo=U?Math.min(36,Math.floor(Math.min(...vals))):Math.min(97,Math.floor(Math.min(...vals))),hi=U?Math.max(39,Math.ceil(Math.max(...vals))):Math.max(103,Math.ceil(Math.max(...vals)));
 const bandLo=U?36:97,bandHi=U?37.5:99.5,ref=U?38:100.4,step=U?(hi-lo>6?2:1):(hi-lo>8?2:1);
 const x=ms=>L+(ms-t0)/(t1-t0)*(W-L-R),y=v=>H-B-(v-lo)/(hi-lo)*(H-T-B);
 let s=`<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Temperature readings and medicine times">`;
 const days=[...new Set(ord.map(e=>e.date))];
 days.forEach((d,i)=>{const a=Math.max(t0,tsOf(d,'00:00')),b=Math.min(t1,tsOf(d,'00:00')+864e5);if(b>a)s+=`<rect x="${x(a)}" y="${T}" width="${x(b)-x(a)}" height="${H-B-T}" class="${i%2?'dayband b':'dayband'}"/><text x="${(x(a)+x(b))/2}" y="${T-12}" text-anchor="middle" class="axis daylabel">${fshort(d)}</text>`});
 s+=`<rect x="${L}" y="${y(bandHi)}" width="${W-L-R}" height="${y(bandLo)-y(bandHi)}" class="normband"/>`;
 for(let v=lo;v<=hi;v+=step){s+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" class="gridline"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" class="axis">${v}</text>`}
 s+=`<line x1="${L}" y1="${y(ref)}" x2="${W-R}" y2="${y(ref)}" class="feverline"/><text x="${W-R-4}" y="${y(ref)-5}" text-anchor="end" class="axis feverlabel">${U?'38 °C · 100.4 °F':'100.4 °F · 38 °C'}</text>`;
 s+=`<polyline class="logline" points="${temps.map(e=>x(tsOf(e.date,e.time))+','+y(cv(e.temperatureF))).join(' ')}"/>`;
 temps.forEach((e,i)=>{const pr=temps[i-1],cx=x(tsOf(e.date,e.time)),cy=y(cv(e.temperatureF));const d=pr?cv(e.temperatureF)-cv(pr.temperatureF):0;const lines=[`${nf(e.temperatureF,1)} °F (${nf(C(e.temperatureF),1)} °C)`,when(e),e.note,pr?`${d>=0?'↑':'↓'} ${nf(Math.abs(d),1)} °${U?'C':'F'} since the last reading`:'First reading'];
  s+=`<circle cx="${cx}" cy="${cy}" r="16" class="hit"${tipAttr(lines)}/><circle cx="${cx}" cy="${cy}" r="${e.temperatureF>=100.4?6:5}" class="point ${e.temperatureF>=100.4?'hot':''}"${tipAttr(lines)} tabindex="0"/>`});
 const my=H-B+30;s+=`<line x1="${L}" y1="${my}" x2="${W-R}" y2="${my}" class="gridline"/><text x="${L-8}" y="${my+4}" text-anchor="end" class="axis">Rx</text>`;
 meds.forEach(e=>{const cx=x(tsOf(e.date,e.time)),lines=[e.medicine,e.dose,when(e),e.note];
  s+=`<circle cx="${cx}" cy="${my}" r="16" class="hit"${tipAttr(lines)}/><path d="M${cx} ${my-7}L${cx+7} ${my}L${cx} ${my+7}L${cx-7} ${my}Z" class="pill"${tipAttr(lines)} tabindex="0"/>`});
 return s+'</svg>';
}
function spark(temps){
 if(temps.length<2)return '';const v=temps.map(e=>e.temperatureF),lo=Math.min(...v),hi=Math.max(...v),W=96,H=26,n=v.length;
 const pts=v.map((t,i)=>`${(i/(n-1))*(W-6)+3},${H-3-((t-lo)/((hi-lo)||1))*(H-6)}`).join(' ');
 return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
// ---------- attachments ----------
const linkHref=l=>l.type==='record'?`/records/${encodeURIComponent(l.ref)}`:l.type==='upload'?`/api/inbox/${encodeURIComponent(l.ref)}/file?profile=${P()}`:l.ref;
const DOCI='<svg class="at-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/></svg>';
const linkChip=(l,date)=>`<a class="attach" href="${esc(linkHref(l))}" target="_blank" rel="noopener">${DOCI}<span class="at-t"><strong>${esc(l.title||'Report')}</strong><small>${/\.md$/i.test(l.ref||'')?'Supplied notes':l.type==='record'?'Report':l.type==='upload'?'Saved file':'Linked record'}${date?' · '+date:''}</small></span><span class="at-go">Open ↗</span></a>`;
function library(){
 if(isLabs())return (window.REPORTS||[]).map(r=>({value:'record:'+r.file,label:`${r.name} · ${r.date}`,link:{type:'record',ref:r.file,title:r.name}}));
 if(isChild())return (window.CHILD_RECORDS?.[P()]?.sourceRecords||[]).map(r=>({value:'url:'+r.url,label:r.title,link:{type:'url',ref:r.url,title:r.title}}));
 return [];
}
let attachMap={};
async function fillAttach(cur){
 attachMap={};let up=[];try{up=(await api(q('/api/inbox'))).items}catch{}
 const lib=library();let h='<option value="">No attachment</option>';
 if(up.length)h+='<optgroup label="Saved in this app">'+up.map(i=>{const v='upload:'+i.id;attachMap[v]={type:'upload',ref:i.id,title:i.title};return `<option value="${esc(v)}">${esc(i.title)}</option>`}).join('')+'</optgroup>';
 if(lib.length)h+='<optgroup label="Report library">'+lib.map(i=>{attachMap[i.value]=i.link;return `<option value="${esc(i.value)}">${esc(i.label)}</option>`}).join('')+'</optgroup>';
 h+='<option value="__upload">Upload a new file…</option>';
 const sel=$('#ev-attach');sel.innerHTML=h;
 const v=cur?`${cur.type}:${cur.ref}`:'';
 if(cur&&!attachMap[v]){attachMap[v]=cur;sel.insertAdjacentHTML('beforeend',`<option value="${esc(v)}">${esc(cur.title||'Report')}</option>`)}
 sel.value=v;$('#row-file').hidden=true;
}

// ---------- rendering ----------
const statusChip=e=>e.status==='ongoing'?'<span class="chip st-on">Ongoing</span>':'<span class="chip st-off">Resolved</span>';
const range=e=>e.status==='ongoing'?`Since ${fmt(e.startDate)}`:(e.endDate&&e.endDate!==e.startDate?`${fmt(e.startDate,{day:'numeric',month:'short'})} – ${fmt(e.endDate)}`:fmt(e.startDate));
function visibleEps(){return EP.filter(e=>filter==='all'||e.status===filter).sort((a,b)=>(a.status===b.status?0:a.status==='ongoing'?-1:1)||b.startDate.localeCompare(a.startDate))}
function renderList(){
 const on=EP.filter(e=>e.status==='ongoing').length,off=EP.length-on;
 $('#ep-filter').innerHTML=[['ongoing','Ongoing',on],['resolved','Resolved',off],['all','All',EP.length]].map(([k,l,n])=>`<button role="tab" aria-selected="${k===filter}" data-epfilter="${k}" class="${k===filter?'selected':''}">${l} <span class="count">${n}</span></button>`).join('');
 const list=visibleEps();
 $('#ep-list').innerHTML=list.length?list.map(e=>{const ents=entriesOf(e.id),n=ents.length,temps=byTime(ents).filter(x=>x.kind==='temperature'),docs=ents.filter(x=>x.link).length;return `<button class="ep-card ${e.id===sel?'sel':''}" data-ep="${esc(e.id)}"><span class="ep-top"><strong>${esc(e.title)}</strong>${statusChip(e)}</span><span class="ep-sub">${esc(e.category)} · ${range(e)}</span><span class="ep-sub ep-foot"><span>${n} ${n===1?'entry':'entries'}${docs?` · 📎 ${docs}`:''}</span>${spark(temps)}</span></button>`}).join(''):`<div class="empty-tiles"><strong>${EP.length?'Nothing in this view':'No episodes yet'}</strong><span>${EP.length?'Try another filter.':'Start one when something comes up: a fever, an infection, an injury or a long-running issue.'}</span></div>`;
}
function tile(l,v,u,sub){return `<div class="tile"><span class="tile-label">${l}</span><span class="tile-value"><b>${v}</b><small>${u||''}</small></span><span class="tile-sub">${sub||''}</span></div>`}
function summaryBlock(e,n){
 if(!e.summary)return '';
 const by=e.summaryBy==='ai',paras=e.summary.split(/\n+/).filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join('');
 const stale=by&&Number.isInteger(e.summaryCount)&&e.summaryCount!==n?`<p class="sum-stale">Entries changed since this summary was written (${e.summaryCount} then, ${n} now). It may be out of date.</p>`:'';
 return `<section class="ep-sum"><div class="sum-head"><span class="sum-tag ${by?'ai':''}">${by?'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6L22.5 18l-2.6.9L19 21.5l-.9-2.6L15.5 18l2.6-.9z"/></svg>AI-written summary':'Summary'}</span>${e.summaryAt?`<small>${fmt(e.summaryAt)}</small>`:''}</div><div class="sum-body">${paras}</div>${stale}<p class="sum-foot">${by?'Written from the entries below. Check it against the originals. It records what happened and is not medical advice.':'Your own notes.'}</p></section>`;
}
function reportsBlock(ents,ep){const seen=new Map();(ep?.links||[]).forEach(l=>seen.set(l.type+l.ref,{l,d:null}));byTime(ents,-1).forEach(x=>{if(x.link&&!seen.has(x.link.type+x.link.ref))seen.set(x.link.type+x.link.ref,{l:x.link,d:x.date})});if(!seen.size)return '';return `<div class="ep-reports"><strong>Reports in this episode <span class="count">${seen.size}</span></strong><div class="rep-list">${[...seen.values()].map(({l,d})=>linkChip(l,d?fshort(d):'')).join('')}</div></div>`}
function renderDetail(){
 const e=EP.find(x=>x.id===sel),box=$('#ep-detail');
 if(!e){box.innerHTML='';return}
 const ents=entriesOf(e.id),temps=byTime(ents).filter(x=>x.kind==='temperature'),meds=ents.filter(x=>x.kind==='medication'),le=lastEntry(e.id);
 let nudge='';
 if(e.status==='ongoing'){const ref=le?le.date:e.startDate,d=daysAgo(ref);if(d>=2)nudge=`<div class="nudge"><span>${le?`No update for ${d} days.`:'No entries yet.'} Still ongoing?</span><button class="text-button" data-resolve="${esc(e.id)}">Mark as resolved</button></div>`}
 let tiles='';
 if(temps.length){const pk=temps.reduce((a,b)=>b.temperatureF>a.temperatureF?b:a),lt=temps.at(-1);tiles=tile('Peak',nf(pk.temperatureF,1),'°F',`${nf(C(pk.temperatureF),1)} °C · ${fshort(pk.date)}`)+tile('Latest',nf(lt.temperatureF,1),'°F',`${nf(C(lt.temperatureF),1)} °C · ${fshort(lt.date)}`)+tile('Medicine',meds.length,meds.length===1?'dose':'doses','logged')+tile('Entries',ents.length,'',`${new Set(ents.map(x=>x.date)).size} days`)}
 else tiles=tile('Entries',ents.length,'',ents.length?`${new Set(ents.map(x=>x.date)).size} days`:'none yet')+tile('Started',fshort(e.startDate),'',fmt(e.startDate,{year:'numeric'}))+(e.status==='resolved'?tile('Resolved',fshort(e.endDate),'',fmt(e.endDate,{year:'numeric'})):tile('Last update',le?fshort(le.date):'–','',le?agoText(daysAgo(le.date)):''));
 const rows=byTime(ents,-1);
 box.innerHTML=`<article class="panel ep-detail"><div class="ep-head"><div><p class="eyebrow">${esc(e.category.toUpperCase())}</p><h2>${esc(e.title)}</h2><p class="muted">${statusChip(e)} ${range(e)}</p></div><div class="ep-actions">${e.status==='ongoing'?`<button class="ghost" data-resolve="${esc(e.id)}">Mark resolved</button>`:`<button class="ghost" data-reopen="${esc(e.id)}">Reopen</button>`}<button class="text-button" data-epedit="${esc(e.id)}">Edit</button><button class="text-button danger" data-epdel="${esc(e.id)}">Delete</button></div></div>${summaryBlock(e,ents.length)}${reportsBlock(ents,e)}${nudge}<div class="tiles">${tiles}</div>${temps.length>=2?`<div class="chart-head"><h3>Temperature</h3><div class="unit-toggle" role="group" aria-label="Temperature unit"><button data-tunit="C" class="${unitPref()==='C'?'on':''}">°C</button><button data-tunit="F" class="${unitPref()==='F'?'on':''}">°F</button></div></div><div class="chart fever-wrap">${feverChart(ents)}</div><p class="fever-legend"><span class="key"></span>Temperature <span class="key hot"></span>38 °C / 100.4 °F or higher <span class="diamond"></span>Medicine given</p>`:temps.length===1?'<p class="muted chart-hint">One temperature so far. Add another reading and a chart appears here.</p>':''}<div class="section-head"><h3>Timeline</h3><button class="primary add-inline" data-addto="${esc(e.id)}">+ Add entry</button></div>${rows.length?`<ul class="entry-list">${rows.map(x=>`<li><span class="e-main"><span class="chip k-${x.kind}">${KIND[x.kind]}</span>${x.date>todayStr()?'<span class="chip st-plan">Planned</span>':''}<strong>${esc(heading(x))}</strong></span><span class="e-meta">${when(x)}${x.kind==='medication'&&x.note?' · '+esc(x.note):''}</span>${x.link?`<span class="e-attach">${linkChip(x.link)}</span>`:''}<span class="row-actions"><button class="text-button" data-edit="${esc(x.id)}">Edit</button><button class="text-button danger" data-delev="${esc(x.id)}">Delete</button></span></li>`).join('')}</ul>`:'<p class="muted">No entries yet. Add the first one.</p>'}</article>`;
 const medbox=document.createElement('section');medbox.className='medicine-tracker';box.querySelector('.ep-sum')?.after(medbox);if(!medbox.isConnected)box.querySelector('.ep-head').after(medbox);window.mountMedicines?.(medbox,e.id,P());
 const sv=box.querySelector('.fever-wrap svg');if(sv){const w=Number(sv.getAttribute('width'));sv.style.width=w+'px';const wrap=sv.parentElement;if(w>wrap.clientWidth+4){const h=document.createElement('p');h.className='scroll-hint';h.textContent='Swipe the chart sideways to see the whole episode →';wrap.after(h)}}
}
function renderStrips(){
 const on=EP.filter(e=>e.status==='ongoing').sort((a,b)=>b.startDate.localeCompare(a.startDate)),last=EP.filter(e=>e.status==='resolved').sort((a,b)=>b.endDate.localeCompare(a.endDate))[0];
 const excerpt=t=>{const p=(t||'').split(/\n+/)[0]||'';if(p.length<=190)return p;const cut=p.slice(0,190),i=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('; '));return (i>80?cut.slice(0,i+1):cut.replace(/\s+\S*$/,'')+'…')};
 const card=(e,state)=>{const le=lastEntry(e.id),n=entriesOf(e.id).length;return `<a class="episode-card" href="#episodes" data-epgo="${esc(e.id)}"><span class="ep-ic ${state==='on'?'on':'off'}">${state==='on'?'':'✓'}</span><span><strong>${esc(e.title)} ${statusChip(e)}</strong>${e.summary?`<span class="ep-ex">${esc(excerpt(e.summary))}</span>`:''}<small>${state==='on'?`Since ${fmt(e.startDate)}`:`${fmt(e.startDate,{day:'numeric',month:'short'})} – ${fmt(e.endDate)}`} · ${n} ${n===1?'entry':'entries'}${state==='on'&&le?` · last update ${agoText(daysAgo(le.date))}`:''}</small></span><em>Open →</em></a>`};
 const html=on.length?on.map(e=>card(e,'on')).join(''):(last?card(last,'off'):'');
 document.querySelectorAll('.ep-strip').forEach(el=>{el.innerHTML=html?`<div class="section-head"><div><p class="eyebrow">HEALTH EPISODES</p><h2>${on.length?(on.length===1?'Ongoing episode':'Ongoing episodes'):'Latest episode'}</h2></div><a href="#episodes">All episodes →</a></div>${html}`:''});
 const v=$('#c-episode');if(v)v.innerHTML=isChild()?html:'';
}
function render(){
 if(!EP.some(e=>e.id===sel))sel=null;
 if(!sel){const v=visibleEps();sel=v[0]?.id||null}
 renderList();renderDetail();renderStrips();
}
async function load(){
 try{[EP,EV]=await Promise.all([api(q('/api/episodes')).then(j=>j.episodes),api(q('/api/events')).then(j=>j.events)])}catch{EP=[];EV=[]}
 if(!EP.some(e=>e.status==='ongoing')&&filter==='ongoing')filter='all';
 render();
}
async function reload(keepSel){const s=sel;await load();if(keepSel&&EP.some(e=>e.id===keepSel)){sel=keepSel;render()}else if(s&&EP.some(e=>e.id===s)){sel=s;render()}}

// ---------- entry sheet ----------
const edlg=()=>$('#event-dialog'),pdlg=()=>$('#episode-dialog');
function kindUi(){const k=$('#ev-kind').value;$('#row-temp').hidden=k!=='temperature';$('#row-med').hidden=k!=='medication';$('#ev-note-label').textContent=['temperature','medication'].includes(k)?'Notes (optional)':'Notes'}
function attachUi(){$('#row-file').hidden=$('#ev-attach').value!=='__upload'}
function episodeUi(){const v=$('#ev-episode').value;$('#row-newep').hidden=v!=='__new'}
function fillEpisodeSelect(pref){
 const opts=EP.slice().sort((a,b)=>(a.status===b.status?0:a.status==='ongoing'?-1:1)||b.startDate.localeCompare(a.startDate)).map(e=>`<option value="${esc(e.id)}">${esc(e.title)}${e.status==='resolved'?' (resolved)':''}</option>`).join('');
 $('#ev-episode').innerHTML=opts+'<option value="__new">＋ Start a new episode…</option><option value="">No episode</option>';
 $('#ev-episode').value=pref!==undefined?pref:(EP.find(e=>e.status==='ongoing')?.id||'__new');
}
function openEntry(ev,episodeId){
 edlg().querySelector('form').reset();$('#ev-id').value=ev?.id||'';$('#ev-title').textContent=ev?'Edit entry':'Add entry';$('#ev-msg').textContent='';
 const now=new Date();$('#ev-date').value=ev?.date||todayStr();$('#ev-time').value=ev&&ev.timeKnown!==false?ev.time:now.toTimeString().slice(0,5);$('#ev-kind').value=ev?.kind||'temperature';
 $('#ev-temp').value=ev?.temperatureF??'';$('#ev-unit').value=unitPref();
 if(ev?.temperatureF!==undefined&&unitPref()==='C'){$('#ev-temp').value=nf(C(ev.temperatureF),1).replace(',','.')}
 $('#ev-med').value=ev?.medicine||'';$('#ev-dose').value=ev?.dose||'';$('#ev-note').value=ev?.note||'';
 fillEpisodeSelect(ev?(ev.episodeId||''):(episodeId!==undefined?episodeId:(sel||undefined)));
 $('#ev-newtitle').value='';$('#ev-newcat').value='Illness';kindUi();episodeUi();fillAttach(ev?.link);edlg().showModal();
}
async function saveEntry(e){
 e.preventDefault();const k=$('#ev-kind').value,msg=$('#ev-msg'),bad=t=>{msg.className='form-msg bad';msg.textContent=t};
 const body={date:$('#ev-date').value,time:$('#ev-time').value,kind:k,note:$('#ev-note').value.trim()||undefined};
 if(!body.date||!body.time)return bad('Choose a date and time.');
 if(k==='temperature'){let t=Number($('#ev-temp').value.trim().replace(',','.'));if(!isFinite(t))return bad('Enter a temperature.');if($('#ev-unit').value==='C')t=t*9/5+32;body.temperatureF=Math.round(t*10)/10}
 if(k==='medication'){body.medicine=$('#ev-med').value.trim();body.dose=$('#ev-dose').value.trim()}
 const id=$('#ev-id').value,btn=e.target.querySelector('button.primary');btn.disabled=true;msg.className='form-msg';msg.textContent='Saving…';
 try{
  let ep=$('#ev-episode').value;
  if(ep==='__new'){const title=$('#ev-newtitle').value.trim();if(!title){btn.disabled=false;return bad('Give the new episode a name.')}ep=(await send(q('/api/episodes'),{title,category:$('#ev-newcat').value,startDate:body.date<=todayStr()?body.date:todayStr()})).episode.id}
  if(ep)body.episodeId=ep;
  const av=$('#ev-attach').value;
  if(av==='__upload'){const f=$('#ev-file').files[0];if(!f){btn.disabled=false;return bad('Choose a photo or PDF to upload.')}if(f.size>8*1024*1024){btn.disabled=false;return bad('That file is larger than 8 MB.')}
   msg.textContent='Uploading…';const dataBase64=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});
   const title=(body.note||f.name.replace(/\.[^.]+$/,'')).slice(0,100);
   const item=(await send(q('/api/inbox'),{category:k==='test'?'lab-report':'medical-document',date:body.date,title,fileName:f.name,mimeType:f.type||(/\.pdf$/i.test(f.name)?'application/pdf':''),episodeId:ep||undefined,dataBase64})).item;
   body.link={type:'upload',ref:item.id,title}}
  else if(av&&attachMap[av])body.link=attachMap[av];
  await send(id?q(`/api/events/${encodeURIComponent(id)}`):q('/api/events'),body,id?'PUT':'POST');
  edlg().close();await reload(ep||sel);
 }catch(err){bad(err.message)}
 btn.disabled=false;
}

// ---------- episode sheet ----------
function openEpisode(ep){
 const f=$('#episode-form');f.reset();$('#epf-id').value=ep?.id||'';$('#epf-heading').textContent=ep?'Edit episode':'New episode';$('#epf-msg').textContent='';
 $('#epf-title').value=ep?.title||'';$('#epf-cat').value=ep?.category||'Illness';$('#epf-start').value=ep?.startDate||todayStr();$('#epf-summary').value=ep?.summary||'';
 $('#epf-status').value=ep?.status||'ongoing';$('#epf-end').value=ep?.endDate||'';$('#row-epstatus').hidden=!ep;
 pdlg().showModal();
}
async function saveEpisode(e){
 e.preventDefault();const msg=$('#epf-msg'),id=$('#epf-id').value,btn=e.target.querySelector('button.primary');
 const body={title:$('#epf-title').value.trim(),category:$('#epf-cat').value,startDate:$('#epf-start').value,summary:$('#epf-summary').value.trim()||undefined};
 if(!body.title){msg.className='form-msg bad';msg.textContent='Give the episode a name.';return}
 if(id){body.status=$('#epf-status').value;body.endDate=body.status==='resolved'?($('#epf-end').value||todayStr()):null;body.summary=$('#epf-summary').value.trim()||undefined}
 btn.disabled=true;msg.className='form-msg';msg.textContent='Saving…';
 try{const r=await send(id?q(`/api/episodes/${encodeURIComponent(id)}`):q('/api/episodes'),body,id?'PUT':'POST');pdlg().close();filter='all';await reload(r.episode.id)}
 catch(err){msg.className='form-msg bad';msg.textContent=err.message}
 btn.disabled=false;
}
async function setStatus(id,status){try{await send(q(`/api/episodes/${encodeURIComponent(id)}`),{status,endDate:status==='resolved'?todayStr():null},'PUT');if(status==='resolved'&&filter==='ongoing'&&!EP.some(e=>e.id!==id&&e.status==='ongoing'))filter='all';await reload(id)}catch{alert('Could not update. Try again.')}}

// ---------- wiring ----------
$('#add-event')?.addEventListener('click',()=>openEntry(null));
$('#new-episode')?.addEventListener('click',()=>openEpisode(null));
$('#ev-kind')?.addEventListener('change',kindUi);$('#ev-attach')?.addEventListener('change',attachUi);$('#ev-episode')?.addEventListener('change',episodeUi);
$('#event-form')?.addEventListener('submit',saveEntry);$('#episode-form')?.addEventListener('submit',saveEpisode);
$('#ev-cancel')?.addEventListener('click',()=>edlg().close());$('#epf-cancel')?.addEventListener('click',()=>pdlg().close());
for(const d of [edlg,pdlg])d()?.addEventListener('click',e=>{if(e.target===d()){const r=d().getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d().close()}});
$('#epf-status')?.addEventListener('change',e=>{$('#epf-end').closest('label').hidden=e.target.value!=='resolved'});
document.addEventListener('click',async e=>{
 const t=e.target;let b;
 if(b=t.closest('[data-tunit]')){tunit=b.dataset.tunit;try{localStorage.setItem('tunit-'+P(),tunit)}catch{}renderDetail();return}
 if(b=t.closest('[data-epfilter]')){filter=b.dataset.epfilter;const v=visibleEps();if(!v.some(x=>x.id===sel))sel=v[0]?.id||null;renderList();renderDetail();return}
 if(b=t.closest('[data-ep]')){sel=b.dataset.ep;renderList();renderDetail();$('#ep-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});return}
 if(b=t.closest('[data-epgo]')){sel=b.dataset.epgo;filter='all';render();return}
 if(b=t.closest('[data-resolve]')){await setStatus(b.dataset.resolve,'resolved');return}
 if(b=t.closest('[data-reopen]')){await setStatus(b.dataset.reopen,'ongoing');return}
 if(b=t.closest('[data-epedit]')){openEpisode(EP.find(x=>x.id===b.dataset.epedit));return}
 if(b=t.closest('[data-epdel]')){const ep=EP.find(x=>x.id===b.dataset.epdel),n=entriesOf(ep.id).length;if(!confirm(`Delete “${ep.title}” and its ${n} ${n===1?'entry':'entries'}? This cannot be undone.`))return;try{await api(q(`/api/episodes/${encodeURIComponent(ep.id)}`),{method:'DELETE'});sel=null;await load()}catch{alert('Could not delete. Try again.')}return}
 if(b=t.closest('[data-addto]')){openEntry(null,b.dataset.addto);return}
 if(b=t.closest('[data-edit]')){openEntry(EV.find(x=>x.id===b.dataset.edit));return}
 if(b=t.closest('[data-delev]')){if(!confirm('Delete this entry?'))return;try{await api(q(`/api/events/${encodeURIComponent(b.dataset.delev)}`),{method:'DELETE'});await reload(sel)}catch{alert('Could not delete. Try again.')}}
});
addEventListener('profilechange',()=>{tunit=null;EP=[];EV=[];sel=null;filter='ongoing';render();load()});
let wasN=innerWidth<700;addEventListener('resize',()=>{const n=innerWidth<700;if(n!==wasN){wasN=n;renderDetail()}});
load();
})();
