// Settings → Household and Account: households, people and roles, invites, profiles; who is signed in, passkeys
// (built-in sign-in only) and signing out. Owners manage the household; the server enforces every rule.
(()=>{
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const buf=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const S={passkeys:null,msg:'',busy:false,hh:null,hmsg:'',link:''};
const cfg=()=>window.APP_CONFIG||{};
const role=()=>(cfg().user||{}).role;
document.documentElement.dataset.role=role()||'';
const supported=()=>!!(window.PublicKeyCredential&&navigator.credentials);
async function call(url,body){const r=await fetch(url,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
const ROLE={owner:'Owner: can change everything',editor:'Editor: can add and change records',viewer:'Viewer: can only look'};
async function load(){
 try{S.hh=await call('/api/household')}catch(e){S.hmsg=e.message}
 if(cfg().authMode==='builtin'){try{S.passkeys=(await call('/api/passkeys')).passkeys}catch(e){S.msg=e.message}}
 render();
}
// Runs a household action; reload=true reloads the page (the profile list or household changed).
async function act(url,body,{done='',reload=false}={}){
 S.busy=true;S.hmsg='';render();
 try{const j=await call(url,body);if(reload){location.reload();return j}S.hmsg=done;S.busy=false;await load();return j}
 catch(e){S.hmsg=e.message;S.busy=false;render()}
}
const opt=(v,cur,label)=>'<option value="'+v+'"'+(v===cur?' selected':'')+'>'+esc(label||v)+'</option>';
const roleSel=(cur,attrs)=>'<select '+attrs+'>'+['owner','editor','viewer'].map(r=>opt(r,cur,r[0].toUpperCase()+r.slice(1))).join('')+'</select>';
function household(){
 const H=S.hh;if(!H)return S.hmsg?'<section class="set-card"><p class="set-msg">'+esc(S.hmsg)+'</p></section>':'';
 const own=H.household.role==='owner',dis=S.busy?' disabled':'';
 let h='<section class="set-card" id="hh-card"><h2>Household</h2>';
 h+=own?'<form class="hh-form" data-form="rename"><label class="field">Name<input name="name" maxlength="80" required value="'+esc(H.household.name)+'"></label><button type="submit"'+dis+'>Rename</button></form>':'<p><strong>'+esc(H.household.name)+'</strong></p>';
 if(H.households.length>1)h+='<label class="field">Switch household<select id="hh-switch"'+dis+'>'+H.households.map(x=>opt(x.id,H.household.id,x.name+' ('+x.role+')')).join('')+'</select></label>';
 h+='<div class="set-actions"><button type="button" class="ghost" id="hh-new"'+dis+'>Start another household</button>'+(own?'':'<button type="button" class="ghost" id="hh-leave"'+dis+'>Leave this household</button>')+'</div>';
 // people with a login
 h+='<h3>People with access</h3><ul class="pk-list" id="hh-people">'+H.people.map(p=>'<li><span class="nm">'+esc(p.name||p.email)+(p.id===H.me?' (you)':'')+'<small>'+esc(p.email)+'</small></span>'
  +(own?roleSel(p.role,'data-role-for="'+esc(p.id)+'" aria-label="Role for '+esc(p.email)+'"'+dis)+'<button type="button" class="ghost" data-remove-person="'+esc(p.id)+'"'+dis+'>Remove</button>':'<span class="muted">'+esc(p.role)+'</span>')+'</li>').join('')+'</ul>';
 if(own){
  h+='<h3>Invite someone</h3><form class="hh-form" data-form="invite"><label class="field">Role'+roleSel('viewer','name="role"')+'</label><label class="field">Email (optional)<input name="email" type="email" maxlength="254" placeholder="Leave empty for a link anyone can use once"></label><button type="submit"'+dis+'>Create invite</button></form>';
  if(S.link)h+='<div class="hh-link"><label class="field">Invite link (works once, 7 days)<input id="hh-link" readonly value="'+esc(S.link)+'"></label><button type="button" class="ghost" id="hh-copy">Copy link</button></div>';
  if(H.invites.length)h+='<ul class="pk-list" id="hh-invites">'+H.invites.map(i=>'<li><span class="nm">'+esc(i.email||'Link invite')+'<small>'+esc(i.role)+' · expires '+esc(day(i.expiresAt))+'</small></span><button type="button" class="ghost" data-revoke="'+esc(i.id)+'"'+dis+'>Revoke</button></li>').join('')+'</ul>';
 }
 // profiles (records), including children without a login
 h+='<h3>Profiles</h3><p class="muted">Each profile has its own records. Children and others without a login are profiles too.</p><ul class="pk-list" id="hh-members">'+H.members.map(m=>'<li><span class="nm">'+esc(m.name)+'<small>'+(m.kind==='child'?'Child':'Adult')+'</small></span>'+(own?'<button type="button" class="ghost" data-rename-member="'+esc(m.id)+'"'+dis+'>Rename</button><button type="button" class="ghost" data-remove-member="'+esc(m.id)+'"'+dis+'>Delete</button>':'')+'</li>').join('')+'</ul>';
 if(own)h+='<form class="hh-form" data-form="member"><label class="field">Name<input name="name" maxlength="40" required></label><label class="field">Kind<select name="kind">'+opt('adult','adult','Adult')+opt('child','','Child')+'</select></label><button type="submit"'+dis+'>Add profile</button></form>';
 if(S.hmsg)h+='<p class="set-msg" role="status">'+esc(S.hmsg)+'</p>';
 return h+'</section>';
}
function wireHousehold(el){
 const H=S.hh;if(!H)return;
 el.querySelectorAll('form.hh-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
  if(f.dataset.form==='rename')act('/api/household/rename',d,{reload:true});
  if(f.dataset.form==='member')act('/api/household/members',d,{reload:true});
  if(f.dataset.form==='invite'){const j=await act('/api/household/invites',{role:d.role,email:d.email||undefined},{done:d.email?'Invite created.':'Invite link created. Send it to the person you want to invite.'});if(j){S.link=j.link;S.hmsg=d.email?(j.emailed?'Invite emailed to '+d.email+'.':'Email is not set up on this server; send the link yourself.'):S.hmsg;render()}}
 });
 const sw=el.querySelector('#hh-switch');if(sw)sw.onchange=()=>act('/api/households/switch',{id:sw.value},{reload:true});
 const nw=el.querySelector('#hh-new');if(nw)nw.onclick=()=>{const name=prompt('Name of the new household','My household');if(name)act('/api/households',{name},{reload:true})};
 const lv=el.querySelector('#hh-leave');if(lv)lv.onclick=()=>{if(confirm('Leave "'+H.household.name+'"? You will need a new invite to come back.'))act('/api/household/leave',{},{reload:true})};
 const cp=el.querySelector('#hh-copy');if(cp)cp.onclick=()=>{const i=el.querySelector('#hh-link');i.select();navigator.clipboard?.writeText(i.value).then(()=>{S.hmsg='Link copied.';render()},()=>{})};
 el.querySelectorAll('[data-role-for]').forEach(s=>s.onchange=()=>act('/api/household/people/role',{userId:s.dataset.roleFor,role:s.value},{done:'Role changed.',reload:s.dataset.roleFor===H.me}));
 el.querySelectorAll('[data-remove-person]').forEach(b=>b.onclick=()=>{const p=H.people.find(x=>x.id===b.dataset.removePerson);if(confirm('Remove '+p.email+' from this household? Their records stay.'))act('/api/household/people/remove',{userId:p.id},{done:'Removed.',reload:p.id===H.me})});
 el.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>act('/api/household/invites/revoke',{id:b.dataset.revoke},{done:'Invite revoked.'}));
 el.querySelectorAll('[data-rename-member]').forEach(b=>b.onclick=()=>{const m=H.members.find(x=>x.id===b.dataset.renameMember),name=prompt('New name for '+m.name,m.name);if(name&&name!==m.name)act('/api/household/members/update',{id:m.id,name},{reload:true})});
 el.querySelectorAll('[data-remove-member]').forEach(b=>b.onclick=()=>{const m=H.members.find(x=>x.id===b.dataset.removeMember),c=prompt('This deletes '+m.name+'\'s profile and ALL of its records. This cannot be undone. Type the name to confirm:');if(c!==null)act('/api/household/members/remove',{id:m.id,confirm:c},{reload:true})});
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
  if(S.passkeys)h+=S.passkeys.length?'<ul class="pk-list" id="pk-keys">'+S.passkeys.map(p=>'<li><span class="nm">'+esc(p.name)+'<small>Added '+esc(day(p.createdAt))+' · last used '+esc(day(p.lastUsedAt))+'</small></span><button type="button" class="ghost" data-remove="'+esc(p.id)+'"'+dis+'>Remove</button></li>').join('')+'</ul>':'<p class="set-hint">No passkeys yet.</p>';
  h+=supported()?'<div class="set-actions"><button type="button" id="pk-add"'+dis+'>Add a passkey on this device</button></div>':'<p class="set-hint">This browser does not support passkeys.</p>';
 }
 if(S.msg)h+='<p class="set-msg" role="status">'+esc(S.msg)+'</p>';
 h+='<form method="post" action="/logout" class="set-actions"><button type="submit" class="ghost">Sign out</button></form></section>';
 el.innerHTML=household()+h;wireHousehold(el);
 const a=$('#pk-add');if(a)a.onclick=add;
 el.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{if(confirm('Remove this passkey? You can still sign in with an email link.'))remove(b.dataset.remove)});
}
function sync(){if(location.hash==='#settings')load()}
addEventListener('hashchange',sync);
if(document.readyState!=='loading')sync();else addEventListener('DOMContentLoaded',sync);
})();
