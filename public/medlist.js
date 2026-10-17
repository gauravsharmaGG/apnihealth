// Medicines view: every medicine course of the current profile (from all episodes) with today's doses.
// Recording doses stays in the episode, where the full schedule lives ("Open episode").
(()=>{
const A=window.AH,$=s=>document.querySelector(s);let serial=0;
const every=p=>p.mode==='interval'?'every '+p.interval+' h':p.frequency===1?'once a day':p.frequency+'× a day';
const status=(p,s,now)=>A.doseStatus(p,s,now);
async function render(){
 const el=$('#meds-list');if(!el||$('#medicines').hidden)return;const p=window.PROFILE,n=++serial;
 el.innerHTML='<p class="muted">Loading…</p>';
 let plans=[],eps=[];try{[plans,eps]=await Promise.all([A.api('/api/medicines?profile='+p).then(j=>j.plans),A.api('/api/episodes?profile='+p).then(j=>j.episodes)])}catch(e){if(n===serial)el.innerHTML='<p class="form-msg bad">'+A.esc(e.message)+'</p>';return}
 if(n!==serial)return;
 const now=Date.now(),today=A.day(now),epName=id=>eps.find(e=>e.id===id)?.title||'Episode';
 const active=plans.filter(x=>(x.slots||[]).some(s=>A.day(A.slotMs(s))>=today)),past=plans.filter(x=>!active.includes(x));
 const card=x=>{const sl=(x.slots||[]).filter(s=>A.day(A.slotMs(s))===today),taken=Object.values(x.logs||{}).filter(l=>l.status==='taken').length,total=(x.slots||[]).length;
  return `<article class="glass med-card"><div class="med-card-head"><div><h3>${A.esc(x.name)}</h3><p class="muted">${x.strength?A.esc(x.strength)+' · ':''}${every(x)}${x.startDate?' · from '+A.esc(x.startDate):''}</p></div><span class="chip">${taken}/${total} taken</span></div>
  ${sl.length?`<ul class="dose-list" aria-label="Today's doses">${sl.map(s=>{const [k,t]=status(x,s,now);return `<li class="dose ${k}"><span class="dose-time">${A.hm(A.slotMs(s))}</span><span>${t}</span></li>`}).join('')}</ul>`:'<p class="muted">No doses today.</p>'}
  <a class="text-button" href="#episodes" data-epgo="${A.esc(x.episodeId)}">Open “${A.esc(epName(x.episodeId))}” →</a></article>`};
 el.innerHTML=(active.length?`<div class="med-grid">${active.map(card).join('')}</div>`:`<div class="glass empty-state"><h3>No current medicines</h3><p class="muted">Medicines belong to an illness episode, so their doses and reminders stay together. Open an episode and choose “Add medicine”.</p><a class="button-link" href="#episodes">Go to episodes</a></div>`)
  +(past.length?`<h2 class="section-title">Finished courses</h2><div class="med-grid">${past.map(card).join('')}</div>`:'');
}
addEventListener('hashchange',()=>{if(location.hash==='#medicines')render()});
addEventListener('profilechange',render);
if(document.readyState!=='loading')render();else addEventListener('DOMContentLoaded',render);
})();
