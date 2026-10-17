(()=>{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const todayStr=()=>new Date().toLocaleDateString('en-CA');
const fmtDay=s=>new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const fmtDayY=s=>new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const nf=(v,dp)=>Number(v).toLocaleString('en-GB',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const TABS=[['weight','Weight'],['steps','Steps'],['resting_hr','Heart rate'],['bp','Blood pressure'],['sleep','Sleep']];
let M={},E=[],tab='weight',days=30;

const P=()=>window.PROFILE;
const MEM=()=>window.PROFILES?.[P()]||{},isLabs=()=>!!MEM().labs,isStarter=()=>MEM().kind==='adult'&&!MEM().labs;
const withP=u=>u+(u.includes('?')?'&':'?')+'profile='+P();
async function api(path,opt){const r=await fetch(path.startsWith('/api/log')||path.startsWith('/api/sync-info')?withP(path):path,{credentials:'same-origin',...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Request failed'),{status:r.status});return j}
async function refresh(){const j=await api('/api/log');M=j.metrics;E=j.entries;if(isLabs())window.mergeLog?.(E,M);renderAll()}

// Newest value per day for a metric (later entries on the same day win).
function series(metric){const byDay=new Map();for(const e of E)if(e.metric===metric)byDay.set(e.date,e);return [...byDay.values()].sort((a,b)=>a.date<b.date?-1:1)}
function countUp(el,to,dp){
  if(reduce||!isFinite(to)){el.textContent=nf(to,dp);return}
  const t0=performance.now(),d=700;const step=t=>{const k=Math.min(1,(t-t0)/d),e=1-Math.pow(1-k,3);el.textContent=nf(to*e,dp);if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step);
}
function tileData(){
  const w=series('weight'),st=series('steps'),hr=series('resting_hr'),sl=series('sleep'),sy=series('bp_sys'),di=series('bp_dia');
  const last=a=>a.at(-1);
  const out=[];
  if(w.length){const l=last(w),p=w.at(-2);out.push({k:'weight',label:'Weight',v:l.value,dp:1,unit:'kg',sub:p?`${l.value-p.value>=0?'+':'−'}${nf(Math.abs(l.value-p.value),1)} kg since ${fmtDay(p.date)}`:fmtDayY(l.date),tab:'weight'})}
  if(st.length){const l=last(st),w7=st.filter(x=>Date.parse(x.date)>Date.parse(l.date)-6*864e5),avg=w7.reduce((a,b)=>a+b.value,0)/w7.length;out.push({k:'steps',label:l.date===todayStr()?'Steps today':'Steps, latest',v:l.value,dp:0,unit:'steps',sub:`7-day average ${nf(avg,0)}`,tab:'steps'})}
  if(hr.length){const l=last(hr);out.push({k:'hr',label:'Resting heart rate',v:l.value,dp:0,unit:'bpm',sub:fmtDayY(l.date),tab:'resting_hr'})}
  if(sy.length&&di.length){const a=last(sy),b=di.find(x=>x.date===a.date)||last(di);out.push({k:'bp',label:'Blood pressure',text:`${nf(a.value,0)}/${nf(b.value,0)}`,unit:'mmHg',sub:fmtDayY(a.date),tab:'bp'})}
  if(sl.length){const l=last(sl);out.push({k:'sleep',label:'Sleep',v:l.value,dp:1,unit:'h',sub:fmtDayY(l.date),tab:'sleep'})}
  return out;
}
function tilesHtml(items,cls){return items.map(t=>`<a class="tile ${cls||''}" href="#log" data-tab="${t.tab}"><span class="tile-label">${esc(t.label)}</span><span class="tile-value"><b data-to="${t.v??''}" data-dp="${t.dp??0}">${esc(t.text??nf(t.v,t.dp))}</b><small>${esc(t.unit)}</small></span><span class="tile-sub">${esc(t.sub)}</span></a>`).join('')}
function animateTiles(root){root.querySelectorAll('b[data-to]').forEach(b=>{if(b.dataset.to!=='')countUp(b,Number(b.dataset.to),Number(b.dataset.dp))});root.querySelectorAll('.tile').forEach((t,i)=>t.style.setProperty('--i',i))}
function renderTiles(){
  const items=tileData();
  const big=$('#log-tiles'),strip=$('#today-strip');
  const empty='<div class="empty-tiles"><strong>No daily numbers yet</strong><span>Add your weight or steps below, or connect Apple Health.</span></div>';
  big.innerHTML=items.length?tilesHtml(items):empty;animateTiles(big);
  strip.innerHTML=items.length?`<div class="section-head"><div><p class="eyebrow">LATELY</p><h2>Your latest daily numbers</h2></div><a href="#log">Add or sync →</a></div><div class="tiles">${tilesHtml(items.slice(0,4),'compact')}</div>`:`<a class="cta" href="#log"><span><strong>Keep your record current</strong><small>Log weight, steps and blood pressure, or sync Apple Health</small></span><span aria-hidden="true">→</span></a>`;
  if(!isLabs())strip.innerHTML='';
  animateTiles(strip);
  const g=$('#s-tiles');if(g){g.innerHTML=isStarter()&&items.length?tilesHtml(items):'';animateTiles(g)}
}
function renderTabs(){$('#log-tabs').innerHTML=TABS.map(([k,l])=>`<button role="tab" aria-selected="${k===tab}" data-tab="${k}" class="${k===tab?'selected':''}">${l}</button>`).join('')}

const LABMAP={weight:'Weight',resting_hr:'Resting heart rate',body_fat:'Estimated body fat: percentage'};
function labPts(metric){if(!isLabs())return [];const m=(window.HEALTH_DATA||[]).find(x=>x.name===LABMAP[metric]);return m?m.points.filter(p=>!p.logged&&Number.isFinite(p.n)).map(p=>({date:p.date,value:p.n,lab:true})):[]}
function lineChart(sets,{bars=false,unit=''}){
  const narrow=innerWidth<700,W=narrow?360:640,H=narrow?250:300,L=narrow?44:52,R=18,T=24,B=40;
  const cutoff=Date.now()-days*864e5;
  const pts=sets.map(s=>s.pts.concat(s.lab||[]).filter(p=>days>=3650||Date.parse(p.date+'T12:00:00Z')>=cutoff).sort((a,b)=>a.date<b.date?-1:1));
  const all=pts.flat();
  if(!all.length)return `<div class="single"><strong>No data in this period</strong><p>Add a measurement or choose a longer range.</p></div>`;
  const tmax=Date.now();
  const t0=Math.min(days>=3650?Infinity:cutoff,...all.map(p=>Date.parse(p.date+'T12:00:00Z'))),span=tmax-t0||1;
  let lo=Math.min(...all.map(p=>p.value)),hi=Math.max(...all.map(p=>p.value));
  if(bars)lo=0;else{const pad=(hi-lo)*.3||Math.abs(hi)*.05||1;lo=Math.max(0,lo-pad);hi+=pad}
  if(hi===lo)hi=lo+1;
  const x=d=>L+(Date.parse(d+'T12:00:00Z')-t0)/span*(W-L-R),y=v=>H-B-(v-lo)/(hi-lo)*(H-T-B);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sets.map(z=>z.name).join(' and '))} over the last ${days} days">`;
  for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,yy=y(v);s+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="gridline"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="axis">${nf(v,hi-lo<10?1:0)}</text>`}
  const ticks=narrow?3:5;for(let i=0;i<ticks;i++){const t=t0+span*i/(ticks-1),d=new Date(t).toISOString().slice(0,10);s+=`<text x="${L+(W-L-R)*i/(ticks-1)}" y="${H-12}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}" class="axis">${fmtDay(d)}</text>`}
  const bw=Math.max(3,Math.min(18,(W-L-R)/Math.max(days,1)*.7));
  sets.forEach((set,si)=>{const p=pts[si];const col=si?'alt':'';
    if(bars){p.forEach((a,i)=>{const h=y(lo)-y(a.value);s+=`<rect class="bar" x="${x(a.date)-bw/2}" y="${y(a.value)}" width="${bw}" height="${Math.max(h,1)}" rx="2" data-tip="${esc([nf(a.value,0)+' '+unit,fmtDayY(a.date),i?(a.value>=p[i-1].value?'↑ ':'↓ ')+nf(Math.abs(a.value-p[i-1].value),0)+' vs '+fmtDay(p[i-1].date):'First entry in this period'].join('||'))}"></rect>`})}
    else{if(p.length>1)s+=`<polyline points="${p.map(a=>x(a.date)+','+y(a.value)).join(' ')}" class="logline ${col}"/>`;p.forEach((a,i)=>{const dp=M[set.metric]?.dp??0,pr=p[i-1],tip=[set.name+': '+nf(a.value,dp)+' '+unit,fmtDayY(a.date),a.lab?'From a lab or screening report':'From your daily log',pr?(a.value>=pr.value?'↑ ':'↓ ')+nf(Math.abs(a.value-pr.value),dp)+' '+unit+' since '+fmtDay(pr.date):'First entry in this period'].join('||');s+=`<circle cx="${x(a.date)}" cy="${y(a.value)}" r="16" class="hit" data-tip="${esc(tip)}"/><circle cx="${x(a.date)}" cy="${y(a.value)}" r="${p.length>40?3:5}" class="point ${col} ${a.lab?'inferred':''}" tabindex="0" data-tip="${esc(tip)}"/>`})}});
  return s+'</svg>'+(sets.some(z=>z.lab&&z.lab.length)?'<p class="legend"><span class="key"></span>Daily log <span class="key hollow"></span>Lab or screening report</p>':'')+(sets.length>1?`<p class="legend"><span class="key"></span>${esc(sets[0].name)} <span class="key alt"></span>${esc(sets[1].name)}</p>`:'');
}
function renderChart(){
  const box=$('#log-chart');
  if(tab==='bp'){box.innerHTML=lineChart([{metric:'bp_sys',name:'Top number',pts:series('bp_sys')},{metric:'bp_dia',name:'Bottom number',pts:series('bp_dia')}],{unit:'mmHg'})}
  else{const m=M[tab]||{};box.innerHTML=lineChart([{metric:tab,name:m.label||tab,pts:series(tab),lab:labPts(tab)}],{bars:tab==='steps',unit:m.unit||''})}
  box.querySelectorAll('circle.point').forEach((c,i)=>c.style.setProperty('--i',Math.min(i,30)));
  box.querySelectorAll('rect.bar').forEach((r,i)=>r.style.setProperty('--i',Math.min(i,40)));
}
function renderEntries(){
  const rows=E.slice().sort((a,b)=>a.date===b.date?b.ts-a.ts:a.date<b.date?1:-1).slice(0,40);
  $('#entry-count').textContent=E.length?`${E.length} saved · showing latest ${rows.length}`:'';
  $('#log-entries').innerHTML=rows.length?`<ul class="entry-list">${rows.map(e=>`<li><span class="e-main"><strong>${esc(M[e.metric]?.label||e.metric)}</strong><span>${nf(e.value,M[e.metric]?.dp??0)} ${esc(M[e.metric]?.unit||'')}</span></span><span class="e-meta">${fmtDayY(e.date)} · ${e.source==='apple-health'?'Apple Health':'Added by hand'}</span><button class="text-button danger" data-del="${esc(e.id)}" aria-label="Delete ${esc(M[e.metric]?.label||e.metric)} entry from ${fmtDayY(e.date)}">Delete</button></li>`).join('')}</ul>`:'<p class="muted">Nothing here yet. Your first entry will appear here.</p>';
}
function renderSyncStatus(){
  const a=E.filter(e=>e.source==='apple-health');
  const el=$('#sync-status');
  if(!a.length){el.textContent='Not connected yet. No Apple Health data has arrived.';el.className='muted';return}
  const t=new Date(Math.max(...a.map(e=>e.ts)));el.className='muted ok';el.textContent=`Connected. Last sync ${t.toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · ${a.length} values received.`;
}
function renderAll(){renderTiles();renderTabs();renderChart();renderEntries();renderSyncStatus()}

$('#f-date').value=todayStr();$('#f-date').max=todayStr();
$('#log-form').addEventListener('submit',async ev=>{
  ev.preventDefault();const msg=$('#log-msg'),btn=ev.target.querySelector('button.primary'),date=$('#f-date').value;
  const entries=[];for(const k of ['weight','steps','resting_hr','sleep','bp_sys','bp_dia','body_fat']){const raw=$('#f-'+k).value.trim().replace(',','.');if(raw==='')continue;const v=Number(raw);if(!isFinite(v)){msg.className='form-msg bad';msg.textContent=`“${raw}” is not a number.`;return}entries.push({metric:k,date,value:v})}
  if(!date){msg.className='form-msg bad';msg.textContent='Choose a date.';return}
  if(!entries.length){msg.className='form-msg bad';msg.textContent='Enter at least one measurement.';return}
  if(entries.some(e=>e.metric==='bp_sys')!==entries.some(e=>e.metric==='bp_dia')){msg.className='form-msg bad';msg.textContent='Enter both blood pressure numbers.';return}
  btn.disabled=true;msg.className='form-msg';msg.textContent='Saving…';
  try{const r=await api('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries,profile:P()})});
    if(r.saved<entries.length){msg.className='form-msg bad';msg.textContent=`${r.saved} of ${entries.length} saved. One value looked out of range. Please check it.`}
    else{msg.className='form-msg good';msg.textContent=`Saved ${r.saved} measurement${r.saved===1?'':'s'}.`;for(const e of entries)$('#f-'+e.metric).value=''}
    await refresh()}
  catch(e){msg.className='form-msg bad';msg.textContent=e.message||'Could not save. Try again.'}
  btn.disabled=false;
});
document.addEventListener('click',async ev=>{
  const tb=ev.target.closest('[data-tab]');if(tb&&TABS.some(t=>t[0]===tb.dataset.tab)){tab=tb.dataset.tab;if(location.hash!=='#log')location.hash='#log';renderTabs();renderChart();if(tb.classList.contains('tile'))setTimeout(()=>$('#log-chart').scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'}),60);return}
  const rg=ev.target.closest('#log-range button');if(rg){days=Number(rg.dataset.days);document.querySelectorAll('#log-range button').forEach(b=>b.classList.toggle('selected',b===rg));renderChart();return}
  const del=ev.target.closest('[data-del]');if(del){if(!confirm('Delete this entry?'))return;try{await api('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:del.dataset.del,profile:P()})});await refresh()}catch{alert('Could not delete. Try again.')}return}
  if(ev.target.id==='sync-reveal'){try{const j=await api('/api/sync-info');$('#sync-url').value=j.endpoint;$('#sync-token').value='Bearer '+j.token;$('#sync-details').hidden=false;ev.target.hidden=true}catch{alert('Could not load the sync key.')}return}
  if(ev.target.id==='sync-copy'){const v=$('#sync-token').value;try{await navigator.clipboard.writeText(v);ev.target.textContent='Copied ✓'}catch{$('#sync-token').select();ev.target.textContent='Select and copy manually'}setTimeout(()=>ev.target.textContent='Copy header value',2500)}
});
addEventListener('layoutchange',renderChart);
addEventListener('profilechange',()=>{E=[];renderAll();refresh().catch(()=>{})});
addEventListener('profilechange',()=>{if(!isLabs()&&window.mergeLog)window.mergeLog([],M)});
refresh().catch(()=>{$('#today-strip').innerHTML='';$('#log-tiles').innerHTML='<div class="empty-tiles"><strong>Could not load your daily numbers</strong><span>Refresh the page to try again.</span></div>'});
})();
