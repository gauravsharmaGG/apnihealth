// "Recent insights" on the home dashboard: simple, rule-based descriptions of the person's own records (week-over-
// week changes, weight over a month, unmarked medicine doses, upcoming appointments, gaps in readings).
// Informational only: no scores, no "heart age" or "stress", no advice and no judgement of what is good or bad.
(()=>{
const A=window.AH,$=s=>document.querySelector(s);let serial=0,data=null;
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const ARROW={up:'<path d="M12 19V5M6 11l6-6 6 6"/>',down:'<path d="M12 5v14M6 13l6 6 6-6"/>',flat:'<path d="M5 12h14M14 7l5 5-5 5"/>',dose:'<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/>',cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/>',gap:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'};
const ico=k=>`<svg class="in-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ARROW[k]}</svg>`;
const daily=(E,m)=>{const r=new Map();for(const e of E)if(e.metric===m)r.set(e.date,e.value);return r};
const win=(map,a,b)=>[...map].filter(([d])=>d>=a&&d<=b).map(([,v])=>v);
const short=d=>new Date(d+'T12:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
// Week-over-week rule. min: smallest change worth mentioning (fraction), abs: the same in units (matches the
// dashboard card, so both say the same thing); always: report "about the same" too.
const WEEK=[
 {group:'steps',metric:'steps',label:'Steps',min:.10,dp:0,pct:true,say:(a,dir,ch)=>`You averaged ${A.nf(a)} steps a day this week, ${ch} ${dir==='up'?'more':'fewer'} than last week.`},
 {group:'sleep',metric:'sleep',label:'Sleep',abs:.25,dp:1,always:true,say:(a,dir,ch)=>dir==='flat'?`You slept ${A.nf(a,1)} h a night on average this week, about the same as last week.`:`You slept ${A.nf(a,1)} h a night on average this week, ${ch} ${dir==='up'?'more':'less'} than last week.`},
 {group:'heart_rate',metric:'resting_hr',label:'Resting heart rate',min:.05,dp:0,say:(a,dir,ch)=>`Your resting heart rate averaged ${A.nf(a)} bpm this week, ${ch} ${dir==='up'?'higher':'lower'} than last week.`},
 {group:'hrv',metric:'hrv',label:'Heart rate variability',min:.05,dp:0,say:(a,dir,ch)=>`Your heart rate variability averaged ${A.nf(a)} ms this week, ${ch} ${dir==='up'?'higher':'lower'} than last week.`}
];
function build(now){
 const out=[],today=A.day(now),tracked=new Set(A.tracked()),E=data.entries;
 for(const r of WEEK){if(!tracked.has(r.group))continue;const m=daily(E,r.metric);
  const a=avg(win(m,A.addDays(today,-6),today)),b=avg(win(m,A.addDays(today,-13),A.addDays(today,-7)));if(a==null||b==null||!b)continue;
  const f=(a-b)/b,small=r.abs?Math.abs(a-b)<r.abs:Math.abs(f)<r.min,dir=small?'flat':f>0?'up':'down';if(dir==='flat'&&!r.always)continue;
  const ch=r.pct?Math.round(Math.abs(f)*100)+'%':A.nf(Math.abs(a-b),r.dp)+' '+A.unitOf(r.metric);
  out.push({k:dir,title:r.label+(dir==='flat'?': steady':dir==='up'?': up on last week':': down on last week'),text:r.say(a,dir,ch),href:'#trends'})}
 if(tracked.has('weight')){const m=daily(E,'weight'),ds=[...m.keys()].sort(),last=ds.at(-1);
  const ref=ds.filter(d=>d<=A.addDays(last||today,-28)).at(-1);
  if(last&&ref&&last>=A.addDays(today,-14)){const d=A.disp('weight',m.get(last))-A.disp('weight',m.get(ref)),u=A.unitOf('weight');
   if(Math.abs(d)>=(u==='lb'?1:.5))out.push({k:d>0?'up':'down',title:'Weight over a month',text:`Your latest weight is ${A.nf(Math.abs(d),1)} ${u} ${d>0?'higher':'lower'} than on ${short(ref)}.`,href:'#trends'})}}
 // medicine doses in the last 7 days that were neither marked taken nor skipped
 let missed=0;const from=Date.parse(A.addDays(today,-6)+'T00:00Z')-864e5;
 for(const p of data.plans)for(const s of p.slots||[]){const ms=A.slotMs(s);if(ms<from||ms>now||A.day(ms)<A.addDays(today,-6))continue;if(A.doseStatus(p,s,now)[0]==='missed')missed++}
 if(missed)out.push({k:'dose',title:'Unmarked doses',text:`${missed} medicine dose${missed>1?'s':''} in the last 7 days ${missed>1?'were':'was'} not marked as taken or skipped.`,href:'#medicines'});
 const soon=data.appts.filter(a=>a.status==='scheduled'&&a.date>today&&a.date<=A.addDays(today,3)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
 if(soon){const n=Math.round((Date.parse(soon.date)-Date.parse(today))/864e5);out.push({k:'cal',title:'Coming up',text:`${soon.title} is ${n===1?'tomorrow':'in '+n+' days'}${soon.time?' at '+soon.time:''}.`,href:'#calendar'})}
 // gaps: a tracked measurement that has readings, but none for more than 10 days
 const LABEL={weight:'weight',sleep:'sleep',steps:'step',heart_rate:'resting heart rate',spo2:'blood oxygen',hrv:'heart rate variability',body_fat:'body fat',blood_pressure:'blood pressure',temperature:'temperature'};
 for(const g of tracked){const met=A.GROUPS[g]?.[0];if(!met||!LABEL[g])continue;const ds=E.filter(e=>e.metric===met).map(e=>e.date).sort(),last=ds.at(-1);
  if(last&&last<A.addDays(today,-10))out.push({k:'gap',title:'No recent readings',text:`No ${LABEL[g]} readings since ${short(last)}.`,href:'#log'})}
 return out.slice(0,6);
}
function render(){
 const el=$('#home-insights');if(!el||$('#home')?.hidden)return;el.hidden=false;
 const head='<div class="panel-head"><h2 id="insights-title">Recent insights</h2></div>',foot='<p class="in-note">Insights describe your own records with simple rules. They are not a diagnosis or medical advice.</p>';
 if(!data){el.innerHTML=head+'<p class="muted">Looking at your records…</p>';return}
 const list=build(Date.now());
 el.innerHTML=head+(list.length?`<ul class="in-list">${list.map(i=>`<li class="in-item in-${i.k}">${ico(i.k)}<div><strong>${A.esc(i.title)}</strong><p>${A.esc(i.text)}</p></div><a class="in-go" href="${i.href}" aria-label="Open: ${A.esc(i.title)}">→</a></li>`).join('')}</ul>`:'<p class="muted">Nothing to point out yet. Insights appear once there are about two weeks of readings, medicines or appointments.</p>')+foot;
}
async function load(){
 const p=window.PROFILE,n=++serial;data=null;render();
 const get=(u,k)=>A.api(u+'?profile='+encodeURIComponent(p)).then(j=>j[k]||[]).catch(()=>[]);
 const [entries,plans,appts]=await Promise.all([get('/api/log','entries'),get('/api/medicines','plans'),get('/api/appointments','appointments')]);
 if(n===serial){data={entries,plans,appts};render()}
}
document.addEventListener('logchange',e=>{if(data&&e.detail?.profile===window.PROFILE){data.entries=e.detail.entries;render()}});
addEventListener('profilechange',load);
addEventListener('hashchange',()=>{if(location.hash==='#home')load()});
load();
})();
