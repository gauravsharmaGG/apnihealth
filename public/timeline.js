// "Today" on the home dashboard: medicine doses, appointments and ongoing episodes of the current profile in one
// place. A day bar (06:00-22:00, widened when needed) with a now marker, then the same items as a list.
(()=>{
const A=window.AH,$=s=>document.querySelector(s);let data=null,serial=0;
const ICON={dose:'<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.6 8.6l4.8 6.8"/>',appt:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',ep:'<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z"/>'};
const ico=k=>`<svg class="tl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[k]}</svg>`;
const APPT={scheduled:['upcoming','Scheduled'],done:['taken','Done'],cancelled:['skipped','Cancelled']};
function items(now){
 const today=A.day(now),out=[];
 for(const p of data.plans)for(const s of p.slots||[]){const ms=A.slotMs(s);if(A.day(ms)!==today)continue;const [k,t]=A.doseStatus(p,s,now);
  out.push({kind:'dose',ms,title:p.name,sub:p.strength||'',status:k,label:t,ep:p.episodeId})}
 for(const a of data.appts){if(a.date!==today)continue;const ms=a.time?A.inst(a.date,a.time):null;const [k,t]=APPT[a.status]||APPT.scheduled;
  const st=a.status==='scheduled'&&ms!=null&&ms<=now&&ms+(a.durationMinutes||30)*6e4>now?['due','Now']:[k,t];
  out.push({kind:'appt',ms,title:a.title,sub:[a.place,a.durationMinutes?a.durationMinutes+' min':''].filter(Boolean).join(' · '),status:st[0],label:st[1]})}
 return out.sort((a,b)=>(a.ms??-1)-(b.ms??-1));
}
function render(){
 const el=$('#home-today');if(!el||$('#home')?.hidden)return;
 const head=`<div class="panel-head"><h2 id="today-title">Today</h2><a class="text-button" href="#calendar">Appointments →</a></div>`;
 if(!data){el.innerHTML=head+'<p class="muted">Loading today…</p>';return}
 const now=Date.now(),today=A.day(now),list=items(now),eps=data.eps.filter(e=>e.status!=='resolved');
 const timed=list.filter(i=>i.ms!=null),hour=ms=>{const [h,m]=A.hm(ms).split(':').map(Number);return h+m/60};
 const nowH=hour(now);let from=Math.min(6,Math.floor(nowH)),to=Math.max(22,Math.ceil(nowH+.01));for(const i of timed){from=Math.min(from,Math.floor(hour(i.ms)));to=Math.max(to,Math.ceil(hour(i.ms)+.01))}
 const pos=h=>((h-from)/(to-from)*100).toFixed(2);
 const ticks=[];for(let h=Math.ceil(from/4)*4;h<=to;h+=4)ticks.push(`<span class="tl-tick" data-x="${pos(h)}">${String(h).padStart(2,'0')}:00</span>`);
 const bar=timed.length?`<div class="tl-bar" aria-hidden="true"><div class="tl-track">${timed.map(i=>`<span class="tl-dot k-${i.kind} s-${i.status}" data-x="${pos(hour(i.ms))}"></span>`).join('')}${nowH>=from&&nowH<=to?`<span class="tl-now" data-x="${pos(nowH)}"><span class="tl-now-label">${A.hm(now)}</span></span>`:''}</div><div class="tl-ticks">${ticks.join('')}</div></div>`:'';
 const epHtml=eps.length?`<div class="tl-eps">${eps.map(e=>{const d=Math.round((Date.parse(today)-Date.parse(e.startDate))/864e5)+1;return `<a class="tl-ep" href="#episodes" data-epgo="${A.esc(e.id)}">${ico('ep')}<span><strong>${A.esc(e.title)}</strong><small>Ongoing · day ${d}</small></span></a>`}).join('')}</div>`:'';
 const rows=list.length?`<ol class="tl-list">${list.map(i=>`<li class="tl-row k-${i.kind}"><span class="tl-time">${i.ms!=null?A.hm(i.ms):'All day'}</span>${ico(i.kind)}<span class="tl-text"><strong>${A.esc(i.title)}</strong>${i.sub?`<small>${A.esc(i.sub)}</small>`:''}</span><span class="dose ${i.status}">${A.esc(i.label)}</span></li>`).join('')}</ol>`
  :`<div class="tl-empty"><p>Nothing scheduled for today.</p><p class="muted">Medicine doses and appointments for today appear here.</p></div>`;
 el.innerHTML=head+epHtml+bar+rows;
 el.querySelectorAll('[data-x]').forEach(n=>n.style.setProperty('--x',n.dataset.x+'%'));
}
async function load(){
 const p=window.PROFILE,n=++serial;data=null;render();
 const get=(u,k)=>A.api(u+'?profile='+encodeURIComponent(p)).then(j=>j[k]||[]).catch(()=>[]);
 const [plans,appts,eps]=await Promise.all([get('/api/medicines','plans'),get('/api/appointments','appointments'),get('/api/episodes','episodes')]);
 if(n===serial){data={plans,appts,eps};render()}
}
addEventListener('profilechange',load);
addEventListener('hashchange',()=>{if(location.hash==='#home')load()});
setInterval(()=>{if(data&&document.visibilityState==='visible')render()},60000);
load();
})();
