// Appointments + calendar: month grid, upcoming list, add/edit sheet, .ics export, and the "Coming up" strips on each Overview.
(()=>{
const TZ=window.APP_CONFIG?.timeZone||'UTC',$=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*864e5).toISOString().slice(0,10);
const D=d=>new Date(d+'T12:00Z');
const fmt=(d,o)=>D(d).toLocaleDateString('en-GB',{timeZone:'UTC',...o});
const CATS=['Check-up','Vaccination','Test or scan','Specialist','Dentist','Therapy','Other'];
const IDS=(window.APP_CONFIG?.members||[]).map(m=>m.id);
let state={scope:'me',month:ymd(Date.now()).slice(0,7),sel:null,data:{},eps:{},loaded:false};
const cur=()=>window.PROFILE||IDS[0];
const nm=p=>window.PROFILES?.[p]?.name||p;
async function api(p,body){const r=await fetch('/api/appointments?profile='+p,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j.appointments}
async function load(){
 try{const r=await Promise.all(IDS.map(p=>api(p).catch(()=>[])));IDS.forEach((p,i)=>state.data[p]=r[i]);state.loaded=true}catch{}
 render();strips();
}
async function episodes(p){if(state.eps[p])return state.eps[p];try{const r=await fetch('/api/episodes?profile='+p,{credentials:'same-origin'});state.eps[p]=(await r.json()).episodes||[]}catch{state.eps[p]=[]}return state.eps[p]}
const scopeIds=()=>state.scope==='family'?IDS:[cur()];
const all=()=>scopeIds().flatMap(p=>(state.data[p]||[]).map(a=>({...a,profile:p})));
const byTime=(a,b)=>(a.date+(a.time||'00:00')).localeCompare(b.date+(b.time||'00:00'));
const when=a=>a.time?a.time+(a.durationMinutes?' · '+a.durationMinutes+' min':''):'All day';
// ---------- list rows ----------
function row(a,showWho,actions=true){
 const ep=a.episodeId&&(state.eps[a.profile]||[]).find(e=>e.id===a.episodeId);
 const st=a.status!=='scheduled'?'<span class="chip ap-'+a.status+'">'+(a.status==='done'?'Done':'Cancelled')+'</span>':'';
 const n=Math.round((D(a.date)-D(ymd(Date.now())))/864e5),cd=a.status==='scheduled'?'<span class="chip ap-cd">'+(n===0?'Today':n===1?'Tomorrow':n===-1?'Yesterday':n<0?(-n)+' days ago':'in '+n+' days')+'</span>':'';
 return '<li class="ap pc-'+a.profile+(a.status!=='scheduled'?' off':'')+'"><div class="ap-date"><b>'+D(a.date).getUTCDate()+'</b><span>'+fmt(a.date,{month:'short'})+'</span></div>'
  +'<div class="ap-main"><strong>'+esc(a.title)+'</strong><p class="muted">'+fmt(a.date,{weekday:'short'})+' · '+esc(when(a))+(a.place?' · '+esc(a.place):'')+'</p>'
  +'<div class="ap-tags">'+(showWho?'<span class="chip ap-who pc-'+a.profile+'">'+esc(nm(a.profile))+'</span>':'')+'<span class="chip">'+esc(a.category)+'</span>'+cd+st+(ep?'<a class="chip ap-ep" href="#episodes" data-epgo="'+esc(ep.id)+'" data-prof="'+a.profile+'">↪ '+esc(ep.title)+'</a>':'')+'</div>'
  +(a.notes?'<p class="ap-notes">'+esc(a.notes)+'</p>':'')
  +(actions?'<div class="ap-act">'+(a.place?'<a class="ap-btn ap-map" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a.place)+'">Open in Maps</a>':'')+'<a class="ap-btn" href="/api/appointments/ics?profile='+a.profile+'&id='+encodeURIComponent(a.id)+'">Add to calendar</a>'+(a.status==='scheduled'?'<button type="button" data-ap-done="'+a.id+'" data-prof="'+a.profile+'">Mark done</button>':'<button type="button" data-ap-reopen="'+a.id+'" data-prof="'+a.profile+'">Reopen</button>')+'<button type="button" data-ap-edit="'+a.id+'" data-prof="'+a.profile+'">Edit</button></div>':'')+'</div></li>';
}
// ---------- month grid ----------
function grid(){
 const [Y,M]=state.month.split('-').map(Number),first=new Date(Date.UTC(Y,M-1,1,12)),lead=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(Y,M,0,12)).getUTCDate(),today=ymd(Date.now());
 const items=all().filter(a=>a.status!=='cancelled'),by={};for(const a of items)(by[a.date]??=[]).push(a);
 let h='<div class="cal-wd">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="cal-grid" role="grid">';
 const rows=Math.ceil((lead+days)/7);
 for(let i=0;i<rows*7;i++){
  const dn=i-lead+1,d=addDays(state.month+'-01',dn-1),inM=dn>=1&&dn<=days,list=(by[d]||[]).sort(byTime);
  const dots=list.slice(0,3).map(a=>'<i class="cd pc-'+a.profile+(a.status==='done'?' done':'')+'"></i>').join('')+(list.length>3?'<small>+</small>':'');
  h+='<button type="button" role="gridcell" class="cal-cell'+(inM?'':' out')+(d===today?' today':'')+(d===state.sel?' sel':'')+'" data-day="'+d+'" aria-label="'+esc(fmt(d,{weekday:'long',day:'numeric',month:'long'}))+(list.length?', '+list.length+' appointment'+(list.length>1?'s':''):'')+'"><span>'+D(d).getUTCDate()+'</span><span class="cd-row">'+dots+'</span></button>';
 }
 return h+'</div>';
}
function render(){
 const el=$('#calendar-body');if(!el||$('#calendar').hidden)return;
 const today=ymd(Date.now()),mLabel=D(state.month+'-01').toLocaleDateString('en-GB',{timeZone:'UTC',month:'long',year:'numeric'});
 const fam=state.scope==='family';
 let list,title,more=0;
 if(state.sel){list=all().filter(a=>a.date===state.sel).sort(byTime);title=fmt(state.sel,{weekday:'long',day:'numeric',month:'long'})}
 else{const up=all().filter(a=>a.status==='scheduled'&&a.date>=today).sort(byTime);list=up.slice(0,12);title='Upcoming';more=Math.max(0,up.length-12)}
 el.innerHTML='<div class="cal-bar"><div class="seg" role="tablist"><button type="button" role="tab" aria-selected="'+!fam+'" data-scope="me">'+esc(nm(cur()))+'</button><button type="button" role="tab" aria-selected="'+fam+'" data-scope="family">Everyone</button></div><button type="button" class="mt-add" data-ap-new>+ Add</button></div>'
  +'<div class="cal-card"><div class="mt-nav"><button type="button" data-m="-1" aria-label="Previous month">‹</button><button type="button" class="mt-day" data-month-today>'+esc(mLabel)+'<small>'+(state.month===today.slice(0,7)?'This month':'Tap for this month')+'</small></button><button type="button" data-m="1" aria-label="Next month">›</button></div>'+grid()
  +(fam?'<p class="cal-legend">'+IDS.map(p=>'<span><i class="cd pc-'+p+'"></i>'+esc(nm(p))+'</span>').join('')+'</p>':'')+'</div>'
  +'<div class="cal-list"><div class="section-head"><h2>'+esc(title)+'</h2>'+(state.sel?'<button type="button" class="text-button" data-clear>Show upcoming</button>':'')+'</div>'
  +(list.length?'<ul class="ap-list">'+list.map(a=>row(a,fam)).join('')+'</ul>'+(state.sel||!more?'':'<p class="muted cal-more">+'+more+' more upcoming. Pick a day in the calendar to see them.</p>'):'<p class="muted">'+(state.sel?'Nothing on this day.':'No upcoming appointments.')+' <button type="button" class="text-button" data-ap-new>Add one</button></p>')+'</div><p class="med-message" role="status"></p>';
 wire(el);
}
function wire(el){
 el.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scope;state.sel=null;render()});
 el.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{const [Y,M]=state.month.split('-').map(Number),d=new Date(Date.UTC(Y,M-1+Number(b.dataset.m),1));state.month=d.toISOString().slice(0,7);state.sel=null;render()});
 el.querySelector('[data-month-today]').onclick=()=>{state.month=ymd(Date.now()).slice(0,7);state.sel=null;render()};
 el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{const d=b.dataset.day;state.sel=state.sel===d?null:d;if(!d.startsWith(state.month))state.month=d.slice(0,7);render();$('.cal-list')?.scrollIntoView({block:'nearest',behavior:'smooth'})});
 el.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{state.sel=null;render()});
 el.querySelectorAll('[data-ap-new]').forEach(b=>b.onclick=()=>edit());
 el.querySelectorAll('[data-ap-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.prof,(state.data[b.dataset.prof]||[]).find(a=>a.id===b.dataset.apEdit)));
 el.querySelectorAll('[data-ap-done]').forEach(b=>b.onclick=()=>setStatus(b,'done'));
 el.querySelectorAll('[data-ap-reopen]').forEach(b=>b.onclick=()=>setStatus(b,'scheduled'));
 el.querySelectorAll('[data-epgo]').forEach(a=>a.onclick=()=>{try{sessionStorage.setItem('openEpisode',a.dataset.epgo)}catch{}if(window.PROFILE!==a.dataset.prof)window.setProfile?.(a.dataset.prof)});
 for(const p of scopeIds())episodes(p).then(()=>{});
}
async function setStatus(b,status){const p=b.dataset.prof,id=b.dataset.apDone||b.dataset.apReopen;b.disabled=true;try{state.data[p]=await api(p,{action:'status',id,status});render();strips()}catch(e){const m=$('#calendar-body .med-message');if(m)m.textContent=e.message;b.disabled=false}}
// ---------- add / edit sheet (reuses the medicine bottom-sheet styling) ----------
const dlg=document.createElement('dialog');dlg.className='med-dialog ap-dialog';document.body.append(dlg);
async function edit(prof,a={}){
 const isNew=!a.id;let who=prof||cur();const eps=await episodes(who);
 const fld=(l,n,t,v,x='')=>'<label>'+l+'<input name="'+n+'" type="'+t+'" value="'+esc(v??'')+'" '+x+'></label>';
 const timed=isNew?true:!!a.time;
 dlg.innerHTML='<form><div class="md-head"><h2>'+(isNew?'Add appointment':'Edit appointment')+'</h2><button type="button" class="md-x" data-cancel aria-label="Close">×</button></div>'
  +(isNew?'<div class="mt-field"><span class="lbl">Who is it for?</span><div class="mt-chips">'+IDS.map(p=>'<button type="button" data-ap-who="'+p+'" class="'+(p===who?'on':'')+'">'+esc(nm(p))+'</button>').join('')+'</div></div>':'')
  +fld('What','title','text',a.title,'required maxlength="100" placeholder="e.g. Annual check-up" autocomplete="off"')
  +'<label>Type<select name="category">'+CATS.map(c=>'<option'+(c===(a.category||'Check-up')?' selected':'')+'>'+c+'</option>').join('')+'</select></label>'
  +'<div class="mt-two">'+fld('Date','date','date',a.date||state.sel||ymd(Date.now()),'required')+'<label class="ap-time"><span>Time</span><input name="time" type="time" value="'+esc(a.time||'09:00')+'" '+(timed?'':'disabled')+'></label></div>'
  +'<label class="set-check"><input type="checkbox" name="allday" '+(timed?'':'checked')+'> All day or time not known yet</label>'
  +'<div class="ap-dur" '+(timed?'':'hidden')+'>'+fld('Length in minutes <span class="opt">optional</span>','durationMinutes','number',a.durationMinutes||'','min="5" max="1440" inputmode="numeric" placeholder="60"')+'</div>'
  +fld('Place <span class="opt">optional</span>','place','text',a.place,'maxlength="160" placeholder="Practice, address…" autocomplete="off"')
  +'<label>Notes <span class="opt">optional</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Bring insurance card, fasting, questions…">'+esc(a.notes||'')+'</textarea></label>'
  +'<label class="ap-eps">Part of an episode <span class="opt">optional</span><select name="episodeId"><option value="">None</option>'+eps.map(e=>'<option value="'+esc(e.id)+'"'+(e.id===a.episodeId?' selected':'')+'>'+esc(e.title)+'</option>').join('')+'</select></label>'
  +'<p class="med-error" role="alert"></p><div class="md-foot">'+(isNew?'':'<button type="button" class="ap-del" data-ap-del>Delete</button>')+'<button type="button" data-cancel>Cancel</button><button type="submit" class="mt-take">'+(isNew?'Add':'Save')+'</button></div></form>';
 dlg.showModal();
 const f=dlg.querySelector('form'),err=dlg.querySelector('.med-error');
 dlg.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>dlg.close());
 f.allday.onchange=()=>{f.time.disabled=f.allday.checked;dlg.querySelector('.ap-dur').hidden=f.allday.checked};
 dlg.querySelectorAll('[data-ap-who]').forEach(b=>b.onclick=async()=>{who=b.dataset.apWho;dlg.querySelectorAll('[data-ap-who]').forEach(x=>x.classList.toggle('on',x===b));const e=await episodes(who);f.episodeId.innerHTML='<option value="">None</option>'+e.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join('')});
 const del=dlg.querySelector('[data-ap-del]');if(del)del.onclick=async()=>{if(!confirm('Delete this appointment?'))return;try{state.data[who]=await api(who,{action:'delete',id:a.id});dlg.close();render();strips()}catch(e){err.textContent=e.message}};
 f.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));const ap={title:v.title,category:v.category,date:v.date,time:f.allday.checked?null:v.time,durationMinutes:f.allday.checked?null:(v.durationMinutes||null),place:v.place,notes:v.notes,episodeId:v.episodeId||null};
  e.submitter.disabled=true;try{state.data[who]=await api(who,{action:'save',id:a.id,appointment:ap});dlg.close();state.sel=ap.date;state.month=ap.date.slice(0,7);render();strips()}catch(x){err.textContent=x.message}finally{e.submitter.disabled=false}};
}
// ---------- "Coming up" strips on each Overview ----------
function strips(){
 const p=cur(),today=ymd(Date.now()),up=(state.data[p]||[]).filter(a=>a.status==='scheduled'&&a.date>=today).sort(byTime).slice(0,3);
 const n=up.length?Math.round((D(up[0].date)-D(today))/864e5):0,rel=n===0?'Today':n===1?'Tomorrow':'In '+n+' days';
 document.querySelectorAll('[data-upcoming]').forEach(el=>{
  el.innerHTML=up.length?'<div class="section-head"><div><p class="eyebrow">COMING UP</p><h2>Appointments</h2><p class="muted">Next: '+esc(rel)+'</p></div><a class="text-button" href="#calendar">Calendar →</a></div><ul class="ap-list">'+up.map(a=>row({...a,profile:p},false,false)).join('')+'</ul>':''});
}
addEventListener('hashchange',()=>{if(location.hash==='#calendar'){state.scope='me';render()}});
addEventListener('profilechange',()=>{state.sel=null;state.scope='me';render();strips()});
load();
if(!state.loaded)setTimeout(load,1500);
})();
