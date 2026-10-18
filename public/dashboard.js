// Home dashboard for adults: greeting, one card per measurement the household tracks (latest value, a 14-day
// sparkline and this week against last week) and friendly empty states. Plain descriptions of the person's own
// records, never advice. Timeline and insights render into their own slots (timeline.js, insights.js).
(()=>{
const {esc,day,addDays,nf,disp,unitOf,GROUPS,tracked,spark,api,longDate}=window.AH;
const $=s=>document.querySelector(s);
const META={
 sleep:{label:'Sleep',tint:'lilac',dp:1,diffDp:1,flat:.25,agg:'last',icon:'<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>'},
 steps:{label:'Steps',tint:'green',dp:0,pct:true,agg:'last',icon:'<path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 15h4v2a2 2 0 01-4 0zM16 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM14 19h4v.5a2 2 0 01-4 0z"/>'},
 heart_rate:{label:'Resting heart rate',tint:'rose',dp:0,diffDp:0,agg:'last',icon:'<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>'},
 spo2:{label:'Blood oxygen',tint:'sky',dp:0,diffDp:1,flat:.5,agg:'last',icon:'<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>'},
 hrv:{label:'Heart rate variability',tint:'peach',dp:0,diffDp:0,agg:'last',icon:'<path d="M3 12h4l2-5 4 10 2-5h6"/>'},
 weight:{label:'Weight',tint:'sand',dp:1,diffDp:1,agg:'last',icon:'<path d="M5 8h14l-1.5 12h-11zM9 8a3 3 0 016 0"/>'},
 body_fat:{label:'Body fat',tint:'sand',dp:1,diffDp:1,agg:'last',icon:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z"/>'},
 blood_pressure:{label:'Blood pressure',tint:'rose',dp:0,diffDp:0,agg:'last',icon:'<path d="M4 13a8 8 0 0116 0M12 13l4-4"/><circle cx="12" cy="13" r="1.5"/>'},
 temperature:{label:'Body temperature',tint:'peach',dp:1,diffDp:1,agg:'last',icon:'<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z"/>'}
};
const ico=p=>`<svg class="mc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
// One value per day (the last entry of the day), for one metric.
function daily(entries,metric){const m=new Map();for(const e of entries)if(e.metric===metric)m.set(e.date,e.value);return m}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function windowVals(map,from,to){const out=[];for(const [d,v] of map)if(d>=from&&d<=to)out.push(v);return out}
// This week (last 7 days including today) against the 7 days before; null when either week has no data.
function weekTrend(map,today){const a=avg(windowVals(map,addDays(today,-6),today)),b=avg(windowVals(map,addDays(today,-13),addDays(today,-7)));return a==null||b==null?null:{now:a,before:b}}
function rel(d,today){return d===today?'Today':d===addDays(today,-1)?'Yesterday':new Date(d+'T12:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}
function trendText(key,metric,t){
 const m=META[key];if(!t)return {cls:'flat',text:'Not enough data for a weekly comparison'};
 const a=disp(metric,t.now),b=disp(metric,t.before);
 if(m.pct){const p=b?Math.round((a-b)/b*100):0;if(Math.abs(p)<3)return {cls:'flat',text:'About the same as last week'};return {cls:p>0?'up':'down',text:`${p>0?'↑':'↓'} ${Math.abs(p)}% vs last week`}}
 const d=a-b,lim=m.flat??(m.diffDp?0.05:0.5);if(Math.abs(d)<lim)return {cls:'flat',text:'About the same as last week'};
 const u=unitOf(metric)==='%'?'points':unitOf(metric);
 return {cls:d>0?'up':'down',text:`${d>0?'↑':'↓'} ${nf(Math.abs(d),m.diffDp)} ${esc(u)} vs last week`};
}
function card(key,entries,today){
 const m=META[key],metrics=GROUPS[key]||[];if(!m||!metrics.length)return '';
 const main=metrics[0],map=daily(entries,main),dates=[...map.keys()].sort(),last=dates.at(-1);
 if(!last)return `<article class="metric-card tint-${m.tint} is-empty"><header>${ico(m.icon)}<h3>${esc(m.label)}</h3></header><p class="mc-empty">No readings yet</p><a class="text-button" href="#log">Add a reading →</a></article>`;
 let value=nf(disp(main,map.get(last)),m.dp),unit=unitOf(main);
 if(key==='blood_pressure'){const dia=daily(entries,'bp_dia').get(last);if(dia!=null)value+='/'+nf(dia,0)}
 const series=[];for(let i=13;i>=0;i--){const v=map.get(addDays(today,-i));if(v!=null)series.push(disp(main,v))}
 const t=trendText(key,main,weekTrend(map,today));
 return `<article class="metric-card tint-${m.tint}"><header>${ico(m.icon)}<h3>${esc(m.label)}</h3><span class="mc-when">${esc(rel(last,today))}</span></header>
 <p class="mc-value"><strong>${value}</strong> <span>${esc(unit)}</span></p>${spark(series,{w:160,h:40,cls:'spark mc-spark'})}
 <p class="mc-trend ${t.cls}">${t.text}</p></article>`;
}
let entries=null,loading=null;
function render(){
 const root=$('#home-cards');if(!root||$('#home')?.hidden)return;
 const p=window.PROFILES?.[window.PROFILE],today=day(Date.now());
 $('#home-greet').textContent=`Hello, ${(p?.name||'').trim().split(/\s+/)[0]||'there'}.`;$('#home-date').textContent=longDate();
 if(!entries){root.innerHTML='<p class="muted">Loading your numbers…</p>';return}
 window.AH.figure?.(entries,today,{daily,weekTrend,trendText,rel,META});
 const keys=tracked().filter(k=>META[k]);
 if(!entries.length){root.innerHTML=`<div class="glass empty-state home-empty"><h3>Welcome. Your dashboard fills in as you add numbers.</h3><p class="muted">Type a reading in Vitals, or connect Apple Health so steps, sleep and heart rate arrive by themselves. Episodes, medicines and appointments show up below as soon as you add them.</p><div class="row-actions"><a class="button-link" href="#log">Add a reading</a><a class="text-button" href="#integrations">Connect Apple Health →</a></div></div>`;return}
 root.innerHTML=keys.length?`<div class="metric-grid">${keys.map(k=>card(k,entries,today)).join('')}</div>`:`<div class="glass empty-state"><h3>No measurements switched on</h3><p class="muted">Choose what to track in Settings.</p><a class="text-button" href="#settings">Open settings →</a></div>`;
}
async function load(){
 const pid=window.PROFILE;entries=null;render();
 const job=loading=api('/api/log?profile='+encodeURIComponent(pid)).then(j=>{if(loading===job){entries=j.entries||[];render()}}).catch(()=>{if(loading===job){entries=[];render()}});
}
document.addEventListener('logchange',e=>{if(e.detail?.profile===window.PROFILE&&Array.isArray(e.detail.entries)){entries=e.detail.entries;render()}});
addEventListener('profilechange',()=>{if(document.querySelector('#home'))load()});
window.addEventListener('hashchange',()=>{if(location.hash==='#home'||!location.hash)render()});
window.AH.homeEntries=()=>entries;
// the figure script loads after this one: draw again once it is there
addEventListener('load',()=>render());
load();
})();
