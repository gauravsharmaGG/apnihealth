// Settings page: push notifications for this device, and which topics/profiles it should notify about.
(()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Add a topic here (and send it from push.mjs) to list another kind of notification.
const TOPICS=[
 {id:'medicine',key:'profiles',title:'Medicine reminders',desc:'A notification when a dose is due, and one nudge 30 minutes later if it isn’t recorded.'},
 {id:'appointments',key:'appt',title:'Appointment reminders',desc:'The evening before at 18:00, and again 2 hours before. All-day appointments get a reminder at 08:00 that day.'}
];
const S={state:'unknown',profiles:{},appt:{},busy:false,msg:''};
const iosBrowser=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!navigator.standalone;
async function api(body,profile=window.PROFILE){const r=await fetch('/api/push?profile='+profile,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
const reg=()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,no)=>setTimeout(()=>no(Error('Service worker not ready')),4000))]);
const key64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function load(){
 render();
 try{
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))S.state=iosBrowser?'ios-install':'unsupported';
  else if(Notification.permission==='denied')S.state='denied';
  else{const sub=await (await reg()).pushManager.getSubscription();if(!sub)S.state='off';else{const sm=await api({action:'summary',endpoint:sub.endpoint});S.profiles=sm.profiles;S.appt=sm.appointments||{};S.state=sm.known?'on':'off'}}
 }catch{S.state='unsupported'}
 render();
}
async function turnOn(){
 S.msg='';S.busy=true;render();
 try{
  if(await Notification.requestPermission()!=='granted'){S.state=Notification.permission==='denied'?'denied':'off';return}
  const r=await reg(),{publicKey}=await api();let sub=await r.pushManager.getSubscription();
  if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key64(publicKey)});
  await api({action:'subscribe',subscription:sub.toJSON()});S.msg='Notifications are on. Tap “Send test” to check.';
 }catch(e){S.msg='Could not turn on notifications: '+e.message}
 S.busy=false;await load();
}
async function turnOff(){S.busy=true;render();try{const sub=await (await reg()).pushManager.getSubscription();if(sub){await api({action:'unsubscribe-all',endpoint:sub.endpoint});await sub.unsubscribe()}S.msg='';}catch(e){S.msg=e.message}S.busy=false;S.profiles={};await load()}
async function test(){S.busy=true;render();try{const sub=await (await reg()).pushManager.getSubscription();await api({action:'test',endpoint:sub.endpoint});S.msg='Test sent. It should arrive in a few seconds.'}catch(e){S.msg='Test failed: '+e.message}S.busy=false;render()}
async function toggle(profile,on,topic){
 S.busy=true;render();
 try{const sub=await (await reg()).pushManager.getSubscription();if(!sub)throw Error('Notifications are off on this device');
  await api(on?{action:'subscribe',topic,subscription:sub.toJSON()}:{action:'unsubscribe',topic,endpoint:sub.endpoint},profile)}
 catch(e){S.msg=e.message}
 S.busy=false;await load();
}
function device(){
 const dot=on=>'<span class="set-dot'+(on?' on':'')+'"></span>';
 return {
  unknown:'<p class="muted">Checking…</p>',
  unsupported:'<div class="set-state">'+dot(0)+'Not available in this browser</div><p class="set-hint">Notifications need a recent Safari (iOS 16.4+), Chrome or Edge.</p>',
  'ios-install':'<div class="set-state">'+dot(0)+'Add to Home Screen first</div><p class="set-hint">On iPhone, notifications only work in the installed app. Tap Share → Add to Home Screen, open the app from there, then come back to Settings.</p>',
  denied:'<div class="set-state">'+dot(0)+'Blocked</div><p class="set-hint">Notifications are blocked for this app. Allow them in Settings → Notifications (iPhone) or your browser’s site settings, then reopen this page.</p>',
  off:'<div class="set-state">'+dot(0)+'Off on this device</div><div class="set-actions"><button class="primary" data-act="on"'+(S.busy?' disabled':'')+'>Turn on notifications</button></div>',
  on:'<div class="set-state">'+dot(1)+'On for this device</div><div class="set-actions"><button data-act="test"'+(S.busy?' disabled':'')+'>Send test</button><button data-act="off"'+(S.busy?' disabled':'')+'>Turn off on this device</button></div>'
 }[S.state];
}
function render(){
 const el=$('#settings-body');if(!el||$('#settings').hidden)return;
 const P=window.PROFILES||{};
 el.innerHTML='<section class="set-card"><h2>This device</h2><p class="muted">Notifications are set up per device. Do this on each phone you want reminders on.</p>'+device()+(S.msg?'<p class="set-msg" role="status">'+esc(S.msg)+'</p>':'')+'</section>'
  +TOPICS.map(t=>'<section class="set-card set-topic"><h2>'+esc(t.title)+'</h2><p class="muted">'+esc(t.desc)+'</p>'
   +Object.entries(P).map(([k,v])=>'<div class="set-row"><span class="avatar pc-'+k+'">'+esc(v.initial)+'</span><span class="nm">'+esc(v.name)+'<small>'+esc(v.sub)+'</small></span><button type="button" class="sw" role="switch" aria-checked="'+(!!S[t.key][k])+'" aria-label="'+esc(t.title)+' for '+esc(v.name)+'" data-profile="'+k+'" data-topic="'+t.id+'"'+(S.busy||S.state!=='on'?' disabled':'')+'></button></div>').join('')
   +(S.state==='on'?(t.id==='medicine'?'<p class="set-hint">You can also mute a single medicine with the 🔔 next to it in the tracker.</p>':''):'<p class="set-hint">Turn on notifications for this device first.</p>')+'</section>').join('');
 el.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>({on:turnOn,off:turnOff,test})[b.dataset.act]());
 el.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>toggle(b.dataset.profile,b.getAttribute('aria-checked')!=='true',b.dataset.topic));
}
function sync(){if(location.hash==='#settings')load()}
addEventListener('hashchange',sync);addEventListener('profilechange',()=>{if(location.hash==='#settings')load()});
if(document.readyState!=='loading')sync();else addEventListener('DOMContentLoaded',sync);
setTimeout(sync,300);
})();
