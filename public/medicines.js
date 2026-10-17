(()=>{
const TZ=window.APP_CONFIG?.timeZone||'UTC';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const hm=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
const dm=t=>new Date(t).toLocaleDateString('en-GB',{timeZone:TZ,day:'numeric',month:'short'});
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*864e5).toISOString().slice(0,10);
const longDay=d=>new Date(d+'T12:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',weekday:'long',day:'numeric',month:'short'});
function inst(date,t){const g=Date.parse(date+'T'+t+':00Z');const off=x=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(x)).map(z=>[z.type,z.value]));return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-x};return g-off(g-off(g))}
const slotMs=s=>s.at?Date.parse(s.at):inst(s.date,s.time);
const slotDay=s=>s.at?day(s.at):s.date;
const span=ms=>{const m=Math.round(Math.abs(ms)/6e4),h=Math.floor(m/60);return h?h+'h'+(m%60?' '+String(m%60).padStart(2,'0')+'m':''):m+'m'};
let box,episode,profile,plans=[],date=day(Date.now()),serial=0,openRow=null;
// ---- Reminders (Web Push) ----
const rem={state:'unknown',muted:[],busy:false,msg:''};
const iosBrowser=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!navigator.standalone;
async function papi(body){const r=await fetch('/api/push?profile='+profile,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
async function reg(){return navigator.serviceWorker.ready}
async function refreshRem(){const n=serial;
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))rem.state=iosBrowser?'ios-install':'unsupported';
  else if(Notification.permission==='denied')rem.state='denied';
  else{const s=await (await reg()).pushManager.getSubscription();if(!s)rem.state='off';else{const st=await papi({action:'status',endpoint:s.endpoint});rem.state=st.subscribed?'on':'off';rem.muted=st.muted||[]}}
 }catch{rem.state='unsupported'}
 if(n===serial)render()}
async function remAction(a,btn,extra={}){btn.disabled=true;try{const s=await (await reg()).pushManager.getSubscription();if(!s)throw Error('No subscription on this device');
  const r=await papi({action:a,endpoint:s.endpoint,...extra});
  if(a==='mute')rem.muted=r.muted}
 catch(e){rem.msg=e.message}finally{render()}}
function remBar(){
 const t={on:'🔔 Reminders on for this device · <a href="#settings">Settings</a>',off:'🔔 Reminders are off · <a href="#settings">Turn on in Settings</a>',denied:'🔕 Notifications are blocked · <a href="#settings">Settings</a>','ios-install':'🔔 Reminders: add the app to your Home Screen, then <a href="#settings">turn on in Settings</a>'}[rem.state];
 return t?'<p class="mt-rem-link">'+t+'</p>':''}
async function api(body){const p=profile;const r=await fetch('/api/medicines?profile='+p,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error||'Unable to save');return j.plans}
window.mountMedicines=async(el,ep,p)=>{box=el;episode=ep;profile=p;date=day(Date.now());openRow=null;rem.state='unknown';rem.msg='';const n=++serial;box.textContent='Loading medicines…';try{const a=await api();if(n!==serial)return;plans=a;render();refreshRem()}catch(e){if(n===serial)box.textContent=e.message}};
const ICON={taken:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'};
function stateOf(p,s,now){const l=p.logs[s.key],pl=slotMs(s),ms=p.effs?.[s.key]??pl;return l?{k:l.status,l,ms,pl}:{k:ms>now?'upcoming':'due',ms,pl}}
function dots(p,d,now){return (p.slots||[]).filter(s=>slotDay(s)===d).map(s=>'<i class="md '+stateOf(p,s,now).k+'"></i>').join('')}
function render(){if(!box?.isConnected)return;const now=Date.now(),own=plans.filter(p=>p.episodeId===episode),today=day(now);
 const rows=own.flatMap(p=>(p.slots||[]).filter(s=>slotDay(s)===date).map(s=>({p,s,...stateOf(p,s,now)}))).sort((a,b)=>a.ms-b.ms);
 const done=rows.filter(r=>r.k==='taken'||r.k==='skipped').length,skipped=rows.filter(r=>r.k==='skipped').length,left=rows.filter(r=>r.k==='upcoming'||r.k==='due').length,nextRow=rows.find(r=>r.k==='due')||rows.find(r=>r.k==='upcoming');
 let h='<div class="mt-head"><h3>Medicines</h3><button type="button" class="mt-add" data-newmed>+ Add</button></div>';
 h+=own.length?remBar():'';
 if(!own.length)h+='<p class="muted">No medicines in this episode yet. Add one to track each dose.</p>';
 else{
  h+='<div class="mt-nav"><button type="button" data-step="-1" aria-label="Previous day">‹</button><button type="button" class="mt-day" data-today>'+(date===today?'Today':esc(longDay(date)))+'<small>'+(date===today?esc(longDay(date)):'Tap for today')+'</small></button><button type="button" data-step="1" aria-label="Next day">›</button></div>';
  if(rows.length)h+='<div class="mt-sum"><span><b>'+done+'</b> of '+rows.length+' recorded'+(skipped?' · '+skipped+' skipped':'')+(left?' · '+left+' left':'')+'</span><span class="mt-bar"><i data-w="'+Math.round(done/rows.length*100)+'"></i></span></div>';
  if(nextRow&&date===today)h+='<p class="mt-next">'+(nextRow.k==='due'?'Due now: ':'Next: ')+'<b>'+esc(nextRow.p.name)+'</b> at '+hm(nextRow.ms)+(nextRow.k==='upcoming'?' · in '+span(nextRow.ms-now):' · '+span(now-nextRow.ms)+' ago')+'</p>';
  h+=rows.length?'<ul class="mt-list">'+rows.map(r=>row(r,now)).join('')+'</ul>':'<p class="muted mt-empty">Nothing scheduled this day.</p>';
  h+='<div class="mt-courses"><p class="mt-legend"><span><i class="md taken"></i>Taken</span><span><i class="md due"></i>Not recorded</span><span><i class="md skipped"></i>Skipped</span><span><i class="md upcoming"></i>Upcoming</span></p>'+own.map(p=>course(p,now,today)).join('')+'</div>';
  h+='<details class="mt-note"><summary>About this tracker</summary><p>It records what you took — it is not dosing advice. Tapping Taken saves the current time; use “⋯” if it was earlier. A late dose does not move the schedule unless you switch on “shift” for that medicine; for every-N-hours medicines a small hint shows the spacing after a late dose. That is only about spacing — never double up, and follow your prescription or ask a pharmacist. Times are in the '+esc(TZ)+' time zone; nothing is sent as a reminder.</p></details>';
 }
 h+='<p class="med-message" role="status"></p>';box.innerHTML=h;box.querySelectorAll('.mt-bar i[data-w]').forEach(i=>i.style.width=i.dataset.w+'%'); // CSSOM: the CSP blocks inline style attributes
 wire();quietNudge(own,today,now)}
// An episode with a running course, or a dose logged in the last 2 days, is clearly active: hide the "No update… Still ongoing?" nudge.
function quietNudge(own,today,now){const active=own.some(p=>{const sl=p.slots||[];if(!sl.length)return false;const last=slotDay(sl[sl.length-1]);const recent=Object.values(p.logs).some(l=>l.status==='taken'&&l.at&&now-Date.parse(l.at)<1728e5);return last>=today||recent});if(active)box.parentElement?.querySelectorAll('.nudge').forEach(n=>n.remove())}
// Spacing hint for every-N-hours medicines: how long after the previous dose the next one is "ideal" (not dosing advice).
function spacingHint(p,s,pl,ms){
 if(p.mode!=='interval')return '';const sl=p.slots||[],i=sl.findIndex(x=>x.key===s.key),prev=i>0?p.logs[sl[i-1].key]:null;
 if(!prev||prev.status!=='taken'||!prev.at)return '';
 const ideal=Date.parse(prev.at)+p.interval*36e5,hmd=t=>hm(t)+(day(t)>slotDay(s)?' +1d':'');
 if(p.shift)return ms-pl>=18e5?'Shifted from '+hmd(pl):'';
 const d=ideal-pl;
 if(d>=18e5)return 'Ideal '+hmd(ideal)+' · planned '+hm(pl);
 if(d<=-18e5)return 'Ideal '+hmd(ideal)+' · planned '+hm(pl)+' is fine';
 return '';
}
function row(r,now){const {p,s,k,l,ms,pl}=r,id=p.id+'|'+s.key,open=openRow===id;
 let sub,right;
 if(k==='taken'){const d=Date.parse(l.at)-ms,late=Math.abs(d)<=18e5?'on time':span(d)+(d>0?' late':' early');sub='<span class="mt-tick">'+ICON.taken+'</span>Taken '+hm(l.at)+' · '+late;right='<button type="button" class="mt-undo" data-dose="undo" data-plan="'+p.id+'" data-key="'+s.key+'">Undo</button>'}
 else if(k==='skipped'){sub='Skipped';right='<button type="button" class="mt-undo" data-dose="undo" data-plan="'+p.id+'" data-key="'+s.key+'">Undo</button>'}
 else{sub=k==='due'?span(now-ms)+' overdue':'In '+span(ms-now);const hint=spacingHint(p,s,pl,ms);if(hint)sub+='</small><small class="mt-hint">'+esc(hint);right='<button type="button" class="mt-take" data-dose="taken" data-plan="'+p.id+'" data-key="'+s.key+'">Taken</button><button type="button" class="mt-more" data-more="'+id+'" aria-label="More options" aria-expanded="'+open+'">⋯</button>'}
 return '<li class="mt-row '+k+(open?' open':'')+'"><span class="mt-time">'+hm(ms)+(day(ms)>slotDay(s)?'<small class="mt-plus">+1d</small>':'')+'</span><span class="mt-what"><b>'+esc(p.name)+'</b><small>'+(p.strength?esc(p.strength)+' · ':'')+sub+'</small></span><span class="mt-act">'+right+'</span>'+(open?'<div class="mt-panel"><button type="button" data-dose="skipped" data-plan="'+p.id+'" data-key="'+s.key+'">Skip this dose</button><label>Took it at<input type="time" value="'+hm(Math.min(ms,now))+'" data-at></label><button type="button" class="mt-take" data-dose="taken-at" data-plan="'+p.id+'" data-key="'+s.key+'">Save</button></div>':'')+'</li>'}
function course(p,now,today){const sl=p.slots||[];if(!sl.length)return '<div class="mt-course"><div class="mt-ch"><b>'+esc(p.name)+'</b><button type="button" data-mededit="'+p.id+'">Edit</button></div><p class="med-warning">Needs a start date and times before it can be tracked.</p></div>';
 const taken=Object.values(p.logs).filter(x=>x.status==='taken').length,n=p.days*p.frequency,cur=Math.min(p.days,Math.max(0,Math.floor((Date.parse(today+'T12:00Z')-Date.parse(p.startDate+'T12:00Z'))/864e5)+1));
 const cells=Array.from({length:p.days},(_,i)=>{const d=addDays(p.startDate,i);return '<button type="button" class="mt-cell'+(d===date?' sel':'')+(d===today?' today':'')+'" data-goto="'+d+'" aria-label="'+esc(longDay(d))+'"><span class="mt-dots">'+dots(p,d,now)+'</span><em>'+Number(d.slice(8))+'</em></button>'}).join('');
 const every=p.mode==='interval'?'every '+p.interval+' h'+(p.shift?' · shifts if late':''):p.frequency===1?'once a day':p.frequency+'× a day';
 return '<div class="mt-course"><div class="mt-ch"><div><b>'+esc(p.name)+'</b><small>'+every+' · '+(cur<1?'starts '+dm(p.startDate+'T12:00Z'):cur>=p.days&&today>addDays(p.startDate,p.days-1)?'course finished':'day '+cur+' of '+p.days)+' · '+taken+'/'+n+' taken</small></div>'+(rem.state==='on'?'<button type="button" class="mt-bell" data-bell="'+p.id+'" aria-label="'+(rem.muted.includes(p.id)?'Reminders off for '+esc(p.name)+'. Tap to turn on':'Reminders on for '+esc(p.name)+'. Tap to turn off')+'">'+(rem.muted.includes(p.id)?'🔕':'🔔')+'</button>':'')+'<button type="button" data-mededit="'+p.id+'">Edit</button></div><div class="mt-cells">'+cells+'</div></div>'}
function wire(){
 box.querySelector('[data-newmed]').onclick=()=>edit();
 box.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{date=addDays(date,+b.dataset.step);openRow=null;render()});
 const t=box.querySelector('[data-today]');if(t)t.onclick=()=>{date=day(Date.now());openRow=null;render()};
 box.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>{date=b.dataset.goto;openRow=null;render();box.querySelector('.mt-nav')?.scrollIntoView({block:'nearest',behavior:'smooth'})});
 box.querySelectorAll('[data-mededit]').forEach(b=>b.onclick=()=>edit(plans.find(p=>p.id===b.dataset.mededit)));
 box.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{openRow=openRow===b.dataset.more?null:b.dataset.more;render()});
 box.querySelectorAll('[data-dose]').forEach(b=>b.onclick=()=>dose(b));
 box.querySelectorAll('[data-bell]').forEach(b=>b.onclick=()=>remAction('mute',b,{planId:b.dataset.bell,muted:!rem.muted.includes(b.dataset.bell)}));
}
function dose(b){const {dose:a,plan:id,key}=b.dataset;
 if(a==='taken')return save({action:'taken',id,key,at:new Date().toISOString()},b);
 if(a==='taken-at'){const v=b.closest('.mt-panel').querySelector('[data-at]').value;if(!v)return;let ms=inst(date,v);if(ms>Date.now()+6e4)ms-=864e5;return save({action:'taken',id,key,at:new Date(ms).toISOString()},b)}
 if(a==='undo'&&!confirm('Remove this record? The dose goes back to “not recorded”.'))return;
 save({action:a,id,key},b)}
async function save(body,b){const n=serial;try{b.disabled=true;const a=await api(body);if(n!==serial)return;plans=a;openRow=null;if(dlg.open)dlg.close();render()}catch(e){const m=dlg.open?dlg.querySelector('.med-error'):box.querySelector('.med-message');if(m)m.textContent=e.message}finally{b.disabled=false}}
const dlg=document.createElement('dialog');dlg.className='med-dialog';document.body.append(dlg);window.addEventListener('profilechange',()=>{serial++;if(dlg.open)dlg.close();box=null;plans=[]});
const FREQ=[{id:'1',label:'Once a day',f:1},{id:'2',label:'Twice a day',f:2},{id:'3',label:'3 times a day',f:3},{id:'i8',label:'Every 8 hours',f:3,i:8},{id:'i6',label:'Every 6 hours',f:4,i:6},{id:'i12',label:'Every 12 hours',f:2,i:12}];
const DEF={1:['08:00'],2:['08:00','20:00'],3:['08:00','14:00','20:00'],4:['06:00','12:00','18:00','00:00']};
function edit(p={}){const locked=Object.keys(p.logs||{}).length>0,isNew=!p.id;
 let sel=p.mode==='interval'?'i'+p.interval:String(p.frequency||1);if(!FREQ.some(x=>x.id===sel))sel=null;
 const first=p.anchor?hm(p.anchor):'08:00',times=p.times?.length?p.times:null;let shiftOn=!!p.shift;
 const shiftBox=()=>'<label class="set-check"><input type="checkbox" name="shift"'+(shiftOn?' checked':'')+'> Shift the next doses if one is taken late</label><p class="hint">On: after a late dose the following doses keep the full gap, and reminders follow. Off: times stay as planned and you only see a hint.</p>';
 const timesHtml=()=>{const f=FREQ.find(x=>x.id===sel);if(!f)return '';if(f.i)return '<label>First dose at<input type="time" name="first" value="'+first+'" required></label><p class="hint">Then every '+f.i+' hours, around the clock, from the start date.</p>'+shiftBox();
  const d=(times&&times.length===f.f?times:DEF[f.f]||DEF[3].slice(0,f.f));return '<div class="mt-times">'+d.map((t,i)=>'<label>Dose '+(i+1)+'<input type="time" name="t'+i+'" value="'+t+'" required></label>').join('')+'</div>'};
 const draw=()=>{dlg.querySelector('.mt-schedule').innerHTML=timesHtml();dlg.querySelectorAll('[data-freq]').forEach(c=>c.classList.toggle('on',c.dataset.freq===sel))};
 dlg.innerHTML='<form><div class="md-head"><h2>'+(isNew?'Add medicine':'Edit '+esc(p.name))+'</h2><button type="button" class="md-x" data-cancel aria-label="Close">×</button></div>'
  +'<label>Medicine<input name="name" value="'+esc(p.name||'')+'" required maxlength="80" placeholder="e.g. Medicine A" autocomplete="off"></label>'
  +'<label>Strength <span class="opt">optional</span><input name="strength" value="'+esc(p.strength||'')+'" maxlength="80" placeholder="e.g. 875/125 mg" autocomplete="off"></label>'
  +(locked?'<p class="hint lock">The schedule is locked because doses are already recorded. Add a new medicine to change it.</p>'+(p.mode==='interval'?shiftBox():''):'<div class="mt-field"><span class="lbl">How often</span><div class="mt-chips">'+FREQ.map(c=>'<button type="button" data-freq="'+c.id+'">'+c.label+'</button>').join('')+'</div></div><div class="mt-schedule"></div><div class="mt-two"><label>Starts<input type="date" name="startDate" value="'+(p.startDate||day(Date.now()))+'" required></label><label>For how many days<input type="number" name="days" inputmode="numeric" min="1" max="365" value="'+(p.days||10)+'" required></label></div>')
  +'<p class="med-error" role="alert"></p><div class="md-foot"><button type="button" data-cancel>Cancel</button><button type="submit" class="mt-take">'+(isNew?'Add medicine':'Save')+'</button></div></form>';
 dlg.showModal();dlg.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>dlg.close());
 if(!locked){draw();dlg.querySelectorAll('[data-freq]').forEach(c=>c.onclick=()=>{const cb=dlg.querySelector('[name=shift]');if(cb)shiftOn=cb.checked;sel=c.dataset.freq;draw()})}
 dlg.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),err=dlg.querySelector('.med-error');let v;
  if(locked)v={...p,name:f.get('name'),strength:f.get('strength'),shift:p.mode==='interval'&&f.has('shift')};
  else{const c=FREQ.find(x=>x.id===sel);if(!c){err.textContent='Choose how often.';return}const start=f.get('startDate');
   v={name:f.get('name'),strength:f.get('strength'),days:+f.get('days'),frequency:c.f,startDate:start,confirmed:true,mode:c.i?'interval':'times',interval:c.i||null,times:[],anchor:null,shift:!!c.i&&f.has('shift')};
   if(c.i)v.anchor=new Date(inst(start,f.get('first'))).toISOString();else v.times=Array.from({length:c.f},(_,i)=>f.get('t'+i));}
  await save({action:'plan',id:p.id,episodeId:episode,plan:v},e.submitter)};
}
})();
