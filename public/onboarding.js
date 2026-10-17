// First-run setup at /welcome: household and own profile, other profiles, what to track, time zone and units,
// then an Apple Health key. Every step uses the regular APIs, so it can be left and resumed at any time.
(()=>{
const $=s=>document.querySelector(s),box=$('#ob-step'),progress=$('#ob-progress');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){
 const r=await fetch(path,body===undefined?{credentials:'same-origin'}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Something went wrong. Try again.');return j;
}
let S,step=0;
const STEPS=['Your household','Who else','What to track','Time and units','Apple Health'];
const msg=(t,bad=true)=>{const m=$('#ob-msg');if(m){m.className='form-msg'+(t?bad?' bad':' good':'');m.textContent=t||''}};
const head=(n,title,lede)=>{progress.textContent=`Step ${n} of ${STEPS.length} · ${STEPS[n-1]}`;return `<h1>${esc(title)}</h1>${lede?`<p class="muted">${esc(lede)}</p>`:''}`};
const next=label=>`<button class="primary" type="button" id="ob-next">${esc(label||'Continue')}</button><p id="ob-msg" class="form-msg" role="status"></p>`;
async function load(){S=await api('/api/onboarding')}

function household(){
 box.innerHTML=head(1,'Set up your household','A household keeps the health records of the people you look after. You can invite others later.')+
 `<form id="ob-household" class="auth-form"><label class="field">Household name<input name="name" maxlength="80" required value="My household" autocomplete="off"></label>
 <label class="field">Your name<input name="memberName" maxlength="40" required autocomplete="name" placeholder="e.g. Alex"></label>
 <p class="muted">You will be the first adult profile and the owner of the household.</p>
 <button class="primary" type="submit">Create household</button><p id="ob-msg" class="form-msg" role="status"></p></form>
 <p class="muted">Joining someone else’s household? Open the invite link they sent you instead.</p>`;
 $('#ob-household').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;
  try{await api('/api/households',{name:f.name.value,memberName:f.memberName.value});await load();go(1)}catch(x){msg(x.message)}});
}
function people(){
 box.innerHTML=head(2,'Who else is in your household?','Add a profile for each person whose health you keep track of. Profiles do not need their own login. You can skip this and add people later in Settings.')+
 `<ul class="ob-list" id="ob-member-list">${S.members.map(m=>`<li><span>${esc(m.name)}</span><small>${m.kind==='child'?'Child':'Adult'}</small></li>`).join('')}</ul>
 <form id="ob-member" class="auth-form"><div class="fields"><label class="field">Name<input name="name" maxlength="40" required autocomplete="off" placeholder="e.g. Sam"></label>
 <label class="field">Adult or child<select name="kind"><option value="adult">Adult</option><option value="child">Child</option></select></label></div>
 <button class="ghost" type="submit">Add profile</button></form>`+next();
 $('#ob-member').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;
  try{await api('/api/household/members',{name:f.name.value,kind:f.kind.value});await load();people();msg('Profile added.',false)}catch(x){msg(x.message)}});
 $('#ob-next').addEventListener('click',()=>go(2));
}
function metrics(){
 const on=new Set(S.household.metrics);
 box.innerHTML=head(3,'What would you like to track?','Pick the daily measurements that matter to you. You can change this later.')+
 `<fieldset class="ob-checks">${S.metricGroups.map(g=>`<label class="check"><input type="checkbox" name="metric" value="${esc(g.id)}"${on.has(g.id)?' checked':''}> ${esc(g.label)}</label>`).join('')}</fieldset>
 <p class="muted">Always included:</p><ul class="ob-core">${S.core.map(c=>`<li>${esc(c.label)}</li>`).join('')}</ul>`+next();
 $('#ob-next').addEventListener('click',async()=>{
  try{const r=await api('/api/household/settings',{metrics:[...document.querySelectorAll('input[name=metric]:checked')].map(i=>i.value)});S.household={...S.household,...r.settings};go(3)}catch(x){msg(x.message)}});
}
function units(){
 const here=Intl.DateTimeFormat().resolvedOptions().timeZone,cur=S.household.onboarded?S.household.timeZone:(here||S.household.timeZone);
 let zones=[];try{zones=Intl.supportedValuesOf('timeZone')}catch{}if(!zones.includes(cur))zones.unshift(cur);
 const u=S.household.units,radio=(name,val,label,c)=>`<label class="check"><input type="radio" name="${name}" value="${val}"${c===val?' checked':''}> ${label}</label>`;
 box.innerHTML=head(4,'Time zone and units','Reminders and calendar times use the household’s time zone.')+
 `<label class="field">Time zone<select id="ob-zone">${zones.map(z=>`<option${z===cur?' selected':''}>${esc(z)}</option>`).join('')}</select></label>
 <fieldset class="ob-units"><legend>Weight</legend>${radio('weight','kg','Kilograms (kg)',u.weight)}${radio('weight','lb','Pounds (lb)',u.weight)}</fieldset>
 <fieldset class="ob-units"><legend>Temperature</legend>${radio('temperature','C','Celsius (°C)',u.temperature)}${radio('temperature','F','Fahrenheit (°F)',u.temperature)}</fieldset>`+next();
 $('#ob-next').addEventListener('click',async()=>{
  try{const r=await api('/api/household/settings',{timeZone:$('#ob-zone').value,units:{weight:$('input[name=weight]:checked').value,temperature:$('input[name=temperature]:checked').value}});S.household={...S.household,...r.settings};go(4)}catch(x){msg(x.message)}});
}
function apple(){
 box.innerHTML=head(5,'Sync from Apple Health (optional)','Each profile gets its own key, so a phone can only add numbers to that one profile. Create a key for every iPhone that should send data.')+
 `<label class="field">Profile<select id="ob-profile">${S.members.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
 <button class="ghost" type="button" id="ob-key-create">Create a key for this profile</button>
 <div id="ob-key-box" hidden><label class="field">Send data to<input id="ob-url" readonly></label><label class="field">Authorization header (shown once)<input id="ob-key" readonly></label>
 <p class="muted">In an app such as Health Auto Export, or an Apple Shortcut, add a REST API export to this address with this header. Keep the key private; you can revoke it under Log → Sync from Apple Health.</p></div>
 <p class="muted">No iPhone? Skip this. You can always add numbers by hand.</p>`+next('Finish setup');
 $('#ob-key-create').addEventListener('click',async()=>{
  try{const j=await api('/api/sync-info?profile='+encodeURIComponent($('#ob-profile').value),{action:'create',label:'Apple Health'});$('#ob-url').value=j.endpoint;$('#ob-key').value='Bearer '+j.token;$('#ob-key-box').hidden=false;msg('Key created. Copy it now; it will not be shown again.',false)}catch(x){msg(x.message)}});
 $('#ob-next').addEventListener('click',async()=>{try{await api('/api/household/onboarded',{});location.href='/'}catch(x){msg(x.message)}});
}
function notOwner(){progress.textContent='Getting started';box.innerHTML=`<h1>You are all set</h1><p class="muted">Your household “${esc(S.household.name)}” is already set up by its owner.</p><p><a class="button-link" href="/">Open the app</a></p>`}
const VIEWS=[household,people,metrics,units,apple];
function go(n){step=n;VIEWS[n]();scrollTo(0,0);box.querySelector('input:not([type=hidden]),select')?.focus({preventScroll:true})}
load().then(()=>!S.household?go(0):S.household.role!=='owner'?notOwner():go(1)).catch(e=>{box.innerHTML=`<p class="form-msg bad">${esc(e.message)}</p>`});
})();
