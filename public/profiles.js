// Household members from window.APP_CONFIG (served as /config.js from the database).
// Chooses the member, builds its navigation from its kind and themes the page.
(()=>{
const I={
 home:'<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',pulse:'<path d="M3 12h4l2-5 4 10 2-5h6"/>',body:'<circle cx="12" cy="5" r="2.2"/><path d="M6 9h12M12 9v12M8.5 21l1.8-7M15.5 21l-1.8-7"/>',
 therm:'<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z"/>',pill:'<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.6 8.6l4.8 6.8"/>',
 cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',doc:'<path d="M6 3h9l4 4v14H6zM14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
 plug:'<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0zM12 16v5"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
 grow:'<path d="M12 21V8M12 8l-4 4M12 8l4 4M5 3h14"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
 more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
// Navigation per kind of profile: [view id, label, icon, on the phone tab bar?, other views that light this item up].
const NAV={
 labs:[['overview','Home','home',1],['log','Vitals','pulse',1],['trends','Body','body',0],['episodes','Episodes','therm',1],['medicines','Medicines','pill',0],['calendar','Appointments','cal',1],['measurements','Reports & labs','doc',0,'records'],['integrations','Integrations','plug',0],['settings','Settings','gear',0]],
 starter:[['s-overview','Home','home',1],['log','Vitals','pulse',1],['trends','Body','body',0],['episodes','Episodes','therm',1],['medicines','Medicines','pill',0],['calendar','Appointments','cal',1],['measurements','Reports & labs','doc',0,'s-reports'],['integrations','Integrations','plug',0],['settings','Settings','gear',0]],
 child:[['c-overview','Home','home',1],['c-growth','Growth','grow',1],['episodes','Episodes','therm',1],['medicines','Medicines','pill',0],['calendar','Appointments','cal',1],['c-records','Reports','doc',0],['c-vaccines','Vaccines','shield',0],['settings','Settings','gear',0]]
};
// Reports & labs has two pages: lab results and the report files.
const SUBNAV={labs:[['measurements','Lab results'],['records','Reports']],starter:[['measurements','Lab results'],['s-reports','Reports & files']]};
const CFG=window.APP_CONFIG||{members:[]},DEFAULT_COLOR='#157667';
const groupOf=m=>m.kind==='child'?'child':m.labs?'labs':'starter';
const PROFILES=Object.fromEntries(CFG.members.map(m=>[m.id,{name:m.name,initial:m.initial,kind:m.kind,labs:!!m.labs,color:m.color||DEFAULT_COLOR,sub:m.kind==='child'?'Child record':'Adult record',tabs:NAV[groupOf(m)],group:groupOf(m)}]));
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
const link=([id,l,i,,also],cls='')=>`<a href="#${id}" class="${cls}"${also?` data-also="${also}"`:''}>${icon(i)}<span>${esc(l)}</span></a>`;
function nav(){
 const p=PROFILES[cur];if(!p)return;
 $('#side-nav').innerHTML=p.tabs.map(t=>link(t)).join('');
 const prim=p.tabs.filter(t=>t[3]),rest=p.tabs.filter(t=>!t[3]);
 $('#tab-nav').innerHTML=prim.map(t=>link(t)).join('')+`<button type="button" class="tab-more" id="tab-more" aria-haspopup="dialog" data-also="${rest.map(t=>[t[0],t[4]].filter(Boolean).join(' ')).join(' ')}">${icon('more')}<span>More</span></button>`;
 $('#more-nav').innerHTML=rest.map(t=>link(t)).join('');
 document.querySelectorAll('[data-subnav]').forEach(el=>{const sn=SUBNAV[p.group];el.innerHTML=sn?sn.map(([id,l])=>`<a href="#${id}" class="subnav-link">${esc(l)}</a>`).join(''):'';el.hidden=!sn});
}
function chrome(){
 const p=PROFILES[cur];document.body.dataset.profile=cur;
 if(!p)return;$('#profile-avatar').textContent=p.initial;$('#profile-avatar').className='avatar pc-'+cur;$('#profile-name').textContent=p.name;
 $('#profile-menu').innerHTML=Object.entries(PROFILES).map(([k,v])=>`<button role="menuitemradio" aria-checked="${k===cur}" data-profile="${k}"><span class="avatar pc-${k}">${esc(v.initial)}</span><span><strong>${esc(v.name)}</strong><small>${v.sub}</small></span>${k===cur?'<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>':''}</button>`).join('');
 const meta=document.querySelector('meta[name=theme-color]');if(meta)meta.content=p.color;
 document.title=`${p.name} · ${CFG.name||'ApniHealth'}`;
 const d=$('#appbar-date');if(d)d.textContent=new Date().toLocaleDateString('en-GB',{timeZone:CFG.timeZone||undefined,weekday:'short',day:'numeric',month:'short',year:'numeric'});
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
// "More" on the phone tab bar opens a sheet with the remaining sections.
const sheet=$('#more-sheet');
document.addEventListener('click',e=>{if(e.target.closest('#tab-more')){sheet.showModal();return}if(e.target.closest('#more-close')||e.target.closest('#more-nav a')||e.target===sheet)sheet.close()});
$('#profile-btn').addEventListener('click',e=>{e.stopPropagation();open($('#profile-menu').hidden)});
$('#profile-menu').addEventListener('click',e=>{const b=e.target.closest('[data-profile]');if(b)setProfile(b.dataset.profile)});
document.addEventListener('click',e=>{if(!e.target.closest('.profile-switch'))open(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')open(false)});
window.setProfile=setProfile;
})();
