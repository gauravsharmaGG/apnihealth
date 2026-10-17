// Household members from window.APP_CONFIG (served as /config.js from private/members.json).
// Chooses the member, builds its navigation from its kind and themes the page.
(()=>{
const I={
 home:'<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',trend:'<path d="M3 17l6-6 4 4 8-9"/>',list:'<path d="M4 6h16M4 12h16M4 18h16"/>',plus:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',doc:'<path d="M6 3h9l4 4v14H6zM14 3v5h5"/>',
 grow:'<path d="M12 21V8M12 8l-4 4M12 8l4 4M5 3h14"/>',therm:'<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
};
const TABS={
 labs:[['overview','Overview','home'],['trends','Trends','trend'],['measurements','Results','list'],['log','Log','plus'],['episodes','Episodes','therm'],['records','Reports','doc']],
 starter:[['s-overview','Overview','home'],['log','Log','plus'],['episodes','Episodes','therm'],['s-reports','Reports','doc']],
 child:[['c-overview','Overview','home'],['c-growth','Growth','grow'],['episodes','Episodes','therm'],['c-vaccines','Vaccines','shield'],['c-records','Records','doc']]
};
const CFG=window.APP_CONFIG||{members:[]},DEFAULT_COLOR='#157667';
const groupOf=m=>m.kind==='child'?'child':m.labs?'labs':'starter';
const PROFILES=Object.fromEntries(CFG.members.map(m=>[m.id,{name:m.name,initial:m.initial,kind:m.kind,labs:!!m.labs,color:m.color||DEFAULT_COLOR,sub:m.kind==='child'?'Child record':'Adult record',tabs:TABS[groupOf(m)]}]));
// Tags a view's data-for attribute is matched against (see route() in app.js).
window.memberTags=id=>{const m=CFG.members.find(x=>x.id===id);if(!m)return ['all'];return m.kind==='child'?['all','child']:['all','adult',m.labs?'labs':'starter']};
const ids=Object.keys(PROFILES);
const icon=d=>`<svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[d]}</svg>`;
const params=new URLSearchParams(location.search);
let cur=params.get('p');try{if(!PROFILES[cur])cur=localStorage.getItem('profile')}catch{}
if(!PROFILES[cur])cur=ids[0];
if(params.has('p')){params.delete('p');history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:'')+location.hash)}
window.PROFILE=cur;window.PROFILES=PROFILES;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function nav(){
 const n=document.querySelector('.topbar nav');if(!n||!PROFILES[cur])return;
 const tabs=PROFILES[cur].tabs;
 n.innerHTML=tabs.map(([id,l,i])=>`<a href="#${id}">${icon(i)}<span>${l}</span></a>`).join('');
 n.style.setProperty('--n',tabs.length);
}
function chrome(){
 const p=PROFILES[cur];document.body.dataset.profile=cur;
 if(!p)return;$('#profile-avatar').textContent=p.initial;$('#profile-avatar').className='avatar pc-'+cur;$('#profile-name').textContent=p.name;
 $('#profile-menu').innerHTML=Object.entries(PROFILES).map(([k,v])=>`<button role="menuitemradio" aria-checked="${k===cur}" data-profile="${k}"><span class="avatar pc-${k}">${esc(v.initial)}</span><span><strong>${esc(v.name)}</strong><small>${v.sub}</small></span>${k===cur?'<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>':''}</button>`).join('');
 const meta=document.querySelector('meta[name=theme-color]');if(meta)meta.content=p.color;
 document.title=`${p.name} · ${CFG.name||'ApniHealth'}`;
}
function open(v){const m=$('#profile-menu');m.hidden=!v;$('#profile-btn').setAttribute('aria-expanded',String(v))}
function setProfile(k){
 if(!PROFILES[k]||k===cur){open(false);return}
 cur=k;window.PROFILE=k;try{localStorage.setItem('profile',k)}catch{}
 history.replaceState(null,'',location.pathname+location.search);
 nav();chrome();open(false);
 dispatchEvent(new CustomEvent('profilechange',{detail:k}));
 window.__route?.(true);scrollTo(0,0);
}
nav();chrome();
$('#profile-btn').addEventListener('click',e=>{e.stopPropagation();open($('#profile-menu').hidden)});
$('#profile-menu').addEventListener('click',e=>{const b=e.target.closest('[data-profile]');if(b)setProfile(b.dataset.profile)});
document.addEventListener('click',e=>{if(!e.target.closest('.profile-switch'))open(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')open(false)});
window.setProfile=setProfile;
})();
