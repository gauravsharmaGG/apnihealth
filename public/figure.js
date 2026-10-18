// Body figure on the home dashboard: an original, abstract silhouette with callout dots for the latest readings the
// household tracks. Every number comes from the person's own log (dashboard.js passes the entries and helpers);
// a missing reading shows "No reading yet" and a link to add it, never a sample value. The callout list is the
// text alternative for the picture. No advice, no medical judgement: the only status is the week-on-week trend.
(()=>{
const A=window.AH,$=s=>document.querySelector(s);
// key: tracked measurement; pos: callout slot (CSS class); side: which side the callout sits on; dot: where the dot
// sits on the bust (viewBox 560x450); line: elbow path from the dot to the callout edge
const SPOTS=[
 {key:'temperature',label:'Body temperature',pos:'c-tp',dot:[280,58],line:'M280 58L262 70H146'},
 {key:'spo2',label:'Blood oxygen',pos:'c-ox',dot:[262,176],line:'M262 176L246 200H146'},
 {key:'heart_rate',label:'Resting heart rate',pos:'c-hr',dot:[322,256],line:'M322 256L342 262H414'},
 {key:'weight',label:'Weight',pos:'c-wt',dot:[286,372],line:'M286 372L310 386H414'}
];
const WORD={up:'Up on last week',down:'Down on last week',flat:'Steady'};
// an original bust: head, neck, shoulders and upper chest, fading out at the bottom
const BODY='M280 26c27 0 44 21 44 50 0 22-9 38-22 47v18c34 8 77 20 100 37 23 15 32 38 36 80l8 262H114l8-262c4-42 13-65 36-80 23-17 66-29 100-37v-18c-13-9-22-25-22-47 0-29 17-50 44-50z';
function callout(s,entries,today,H){
 const metrics=A.GROUPS[s.key]||[],main=metrics[0],map=H.daily(entries,main),last=[...map.keys()].sort().at(-1);
 if(!last)return {s,has:false,html:`<li class="fig-c ${s.pos} is-empty"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">No reading yet</strong><a class="fig-add" href="#log">Add one →</a></li>`};
 const m=H.META[s.key],t=H.trendText(s.key,main,H.weekTrend(map,today)),word=t.cls==='flat'&&/Not enough/.test(t.text)?'':WORD[t.cls];
 const value=A.nf(A.disp(main,map.get(last)),m.dp),unit=A.unitOf(main);
 return {s,has:true,html:`<li class="fig-c ${s.pos}"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">${value}<span> ${A.esc(unit)}</span></strong><small>${[word,'Updated '+H.rel(last,today).toLowerCase()].filter(Boolean).map(x=>`<span>${x}</span>`).join('')}</small></li>`};
}
A.figure=function(entries,today,H){
 const el=$('#home-figure');if(!el)return;
 const tr=new Set(A.tracked()),list=SPOTS.filter(s=>tr.has(s.key)).map(s=>callout(s,entries,today,H));
 const lines=list.map(c=>`<path class="fig-line" d="${c.s.line}"/>`).join('');
 const dots=list.map(c=>`<g class="fig-dot${c.has?'':' is-empty'}"><circle class="fig-pulse" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="8"/><circle class="fig-core" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="5"/></g>`).join('');
 el.innerHTML=`<h2 id="fig-title" class="sr-only">Latest readings</h2><div class="fig-stage"><svg class="fig-svg" viewBox="0 0 560 450" aria-hidden="true" focusable="false"><defs><radialGradient id="fig-halo" cx="50%" cy="42%" r="55%"><stop offset="0" stop-color="#bfe6da" stop-opacity=".85"/><stop offset=".6" stop-color="#d9e8fa" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><linearGradient id="fig-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f5f0"/><stop offset=".5" stop-color="#d5e6f4"/><stop offset=".86" stop-color="#d5e6f4" stop-opacity="0"/></linearGradient><linearGradient id="fig-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f6e60" stop-opacity=".5"/><stop offset=".8" stop-color="#2f5f96" stop-opacity="0"/></linearGradient></defs><circle class="fig-halo" cx="280" cy="220" r="240"/><path class="fig-body" d="${BODY}"/><path class="fig-collar" d="M232 150c14 14 31 21 48 21s34-7 48-21"/>${lines}${dots}</svg><ul class="fig-callouts" aria-label="Latest readings">${list.map(c=>c.html).join('')}</ul></div>`;
};
})();
