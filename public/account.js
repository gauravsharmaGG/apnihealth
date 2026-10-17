// Settings → Account: who is signed in, passkeys (built-in sign-in only) and signing out.
(()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buf=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const S={passkeys:null,msg:'',busy:false};
const cfg=()=>window.APP_CONFIG||{};
const supported=()=>!!(window.PublicKeyCredential&&navigator.credentials);
async function call(url,body){const r=await fetch(url,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
const ROLE={owner:'Owner: can change everything',editor:'Editor: can add and change records',viewer:'Viewer: can only look'};
async function load(){
 if(cfg().authMode==='builtin'){try{S.passkeys=(await call('/api/passkeys')).passkeys}catch(e){S.msg=e.message}}
 render();
}
async function add(){
 S.busy=true;S.msg='';render();
 try{
  const o=await call('/api/passkeys/options',{});
  const cred=await navigator.credentials.create({publicKey:{...o,challenge:buf(o.challenge),user:{...o.user,id:buf(o.user.id)},excludeCredentials:o.excludeCredentials.map(c=>({...c,id:buf(c.id)}))}});
  const r=cred.response;
  await call('/api/passkeys',{name:guessName(),credential:{id:cred.id,type:cred.type,response:{clientDataJSON:b64u(r.clientDataJSON),attestationObject:b64u(r.attestationObject),transports:r.getTransports?r.getTransports():[]}}});
  S.msg='Passkey added. You can now sign in with it.';
 }catch(e){S.msg=e.name==='NotAllowedError'?'Adding the passkey was cancelled.':e.name==='InvalidStateError'?'This device already has a passkey for your account.':e.message}
 S.busy=false;await load();
}
function guessName(){const u=navigator.userAgent;return /iPhone/.test(u)?'iPhone':/iPad/.test(u)?'iPad':/Android/.test(u)?'Android':/Mac/.test(u)?'Mac':/Windows/.test(u)?'Windows':'Passkey'}
async function remove(id){S.busy=true;render();try{await call('/api/passkeys/delete',{id});S.msg='Passkey removed.'}catch(e){S.msg=e.message}S.busy=false;await load()}
const day=s=>s?new Date(s).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'never';
function render(){
 const el=$('#account-body');if(!el)return;
 const u=cfg().user||{},dis=S.busy?' disabled':'';
 let h='<section class="set-card"><h2>Account</h2><p class="muted">Signed in as <strong>'+esc(u.email)+'</strong>'+(u.role?'<br>'+esc(ROLE[u.role]||u.role):'')+'</p>';
 if(cfg().authMode==='builtin'){
  h+='<h3>Passkeys</h3><p class="muted">Sign in with Face ID, Touch ID or your device PIN instead of an email link.</p>';
  if(S.passkeys)h+=S.passkeys.length?'<ul class="pk-list">'+S.passkeys.map(p=>'<li><span class="nm">'+esc(p.name)+'<small>Added '+esc(day(p.createdAt))+' · last used '+esc(day(p.lastUsedAt))+'</small></span><button type="button" class="ghost" data-remove="'+esc(p.id)+'"'+dis+'>Remove</button></li>').join('')+'</ul>':'<p class="set-hint">No passkeys yet.</p>';
  h+=supported()?'<div class="set-actions"><button type="button" id="pk-add"'+dis+'>Add a passkey on this device</button></div>':'<p class="set-hint">This browser does not support passkeys.</p>';
 }
 if(S.msg)h+='<p class="set-msg" role="status">'+esc(S.msg)+'</p>';
 h+='<form method="post" action="/logout" class="set-actions"><button type="submit" class="ghost">Sign out</button></form></section>';
 el.innerHTML=h;
 const a=$('#pk-add');if(a)a.onclick=add;
 el.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(confirm('Remove this passkey? You can still sign in with an email link.'))remove(b.dataset.remove)});
}
function sync(){if(location.hash==='#settings')load()}
addEventListener('hashchange',sync);
if(document.readyState!=='loading')sync();else addEventListener('DOMContentLoaded',sync);
})();
