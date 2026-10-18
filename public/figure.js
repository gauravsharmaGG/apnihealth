// Body figure on the home dashboard: an original, gender-neutral, misty body form (no face, no hair) with pulse points and
// callouts for the latest readings the household tracks. Every number comes from the person's own log (dashboard.js
// passes the entries and helpers); a missing reading shows "No reading yet" and a link to add it, never a sample value.
// The callout list is the text alternative for the picture. No advice, no medical judgement: the only status is the
// week-on-week trend.
(()=>{
const A=window.AH,$=s=>document.querySelector(s);
// key: tracked measurement; pos: callout slot (CSS class); dot: where the point sits on the body (viewBox 500x540, the
// same box as the stage, so points stay aligned at every width); line: elbow path from the point to the callout edge
const SPOTS=[
 {key:'temperature',label:'Body temperature',pos:'c-tp',dot:[250,82],line:'M250 82L214 64H136'},
 {key:'spo2',label:'Blood oxygen',pos:'c-ox',dot:[250,176],line:'M250 176L218 214H136'},
 {key:'heart_rate',label:'Resting heart rate',pos:'c-hr',dot:[288,292],line:'M288 292H364'},
 {key:'weight',label:'Weight',pos:'c-wt',dot:[250,436],line:'M250 436L278 444H364'}
];
const ARROW={up:'\u2191',down:'\u2193',flat:'\u2192'};
// head, neck, shoulders and upper torso: smooth, symmetric, neutral proportions
const BODY='M250 46c24 0 44 24 44 56 0 26-11 45-24 55v26c40 10 86 26 112 50 22 20 30 50 34 90l6 217H78l6-217c4-40 12-70 34-90 26-24 74-40 112-50v-26c-13-10-24-29-24-55 0-32 20-56 44-56z';
const DEFS=`<defs>
<radialGradient id="fig-halo" cx="50%" cy="40%" r="58%"><stop offset="0" stop-color="#bfe6da" stop-opacity=".8"/><stop offset=".55" stop-color="#d9e8fa" stop-opacity=".4"/><stop offset="1" stop-color="#ece7fb" stop-opacity="0"/></radialGradient>
<linearGradient id="fig-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9e9de"/><stop offset=".45" stop-color="#b8d4f0"/><stop offset="1" stop-color="#d3c8f2"/></linearGradient>
<radialGradient id="fig-lit" cx="42%" cy="22%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="fig-ribbon" gradientUnits="userSpaceOnUse" x1="0" y1="186" x2="0" y2="440"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="fig-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="540"><stop offset=".5" stop-color="#fff"/><stop offset=".97" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="fig-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="500" height="540"><rect width="500" height="540" fill="url(#fig-fade)"/></mask>
<filter id="fig-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
<filter id="fig-bloom" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
</defs>`;
// the body layers: wide bloom, soft filled form, light from above, and a few faint inner lines (spine, rib arcs, a ribbon)
const FORM=`<g mask="url(#fig-mask)"><path class="fig-bloom" filter="url(#fig-bloom)" d="${BODY}"/><path class="fig-body" filter="url(#fig-soft)" d="${BODY}"/><path class="fig-lit" d="${BODY}"/><g class="fig-inner"><path class="fig-ribbon" d="M250 186V440"/><path d="M196 270c28 16 80 16 108 0M190 312c32 20 88 20 120 0M188 354c34 22 90 22 124 0"/></g></g>`;
function callout(s,entries,today,H){
 const metrics=A.GROUPS[s.key]||[],main=metrics[0],map=H.daily(entries,main),last=[...map.keys()].sort().at(-1);
 if(!last)return {s,has:false,html:`<li class="fig-c ${s.pos} is-empty"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">No reading yet</strong><a class="fig-add" href="#log">Add one →</a></li>`};
 const m=H.META[s.key],t=H.trendText(s.key,main,H.weekTrend(map,today)),when=H.rel(last,today).toLowerCase(),known=!(t.cls==='flat'&&/Not enough/.test(t.text));
 const value=A.nf(A.disp(main,map.get(last)),m.dp),unit=A.unitOf(main),meta=known?`${ARROW[t.cls]} vs last week \u00b7 ${when}`:'Updated '+when;
 return {s,has:true,html:`<li class="fig-c ${s.pos}"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">${value}<span> ${A.esc(unit)}</span></strong><small>${A.esc(meta)}</small></li>`};
}
A.figure=function(entries,today,H){
 const el=$('#home-figure');if(!el)return;
 const tr=new Set(A.tracked()),list=SPOTS.filter(s=>tr.has(s.key)).map(s=>callout(s,entries,today,H));
 const lines=list.map(c=>`<path class="fig-line" d="${c.s.line}"/>`).join('');
 const dots=list.map(c=>`<g class="fig-dot${c.has?'':' is-empty'}"><circle class="fig-pulse" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="8"/><circle class="fig-core" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="5"/></g>`).join('');
 el.innerHTML=`<h2 id="fig-title" class="sr-only">Latest readings</h2><div class="fig-stage"><svg class="fig-svg" viewBox="0 0 500 540" aria-hidden="true" focusable="false">${DEFS}<ellipse class="fig-halo" cx="250" cy="250" rx="250" ry="270"/>${FORM}${lines}${dots}</svg><ul class="fig-callouts" aria-label="Latest readings">${list.map(c=>c.html).join('')}</ul></div>`;
};
})();
