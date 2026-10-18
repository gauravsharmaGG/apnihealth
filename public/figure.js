// Body figure on the home dashboard: an original, abstract silhouette with callout dots for the latest readings the
// household tracks. Every number comes from the person's own log (dashboard.js passes the entries and helpers);
// a missing reading shows "No reading yet" and a link to add it, never a sample value. The callout list is the
// text alternative for the picture. No advice, no medical judgement: the only status is the week-on-week trend.
(()=>{
const A=window.AH,$=s=>document.querySelector(s);
// key: tracked measurement; pos: callout slot (CSS class, side of the figure); dot: where the dot sits on the body
const SPOTS=[
 {key:'heart_rate',label:'Resting heart rate',pos:'c-hr',side:'l',dot:[236,168],end:[150,150]},
 {key:'weight',label:'Weight',pos:'c-wt',side:'l',dot:[236,262],end:[150,256]},
 {key:'temperature',label:'Body temperature',pos:'c-tp',side:'r',dot:[262,100],end:[350,96]},
 {key:'spo2',label:'Blood oxygen',pos:'c-ox',side:'r',dot:[352,300],end:[350,300]}
];
const WORD={up:'Up on last week',down:'Down on last week',flat:'Steady'};
const BODY='M236 90V108C200 114 170 122 158 150C148 178 144 230 138 290C136 304 152 306 156 292C164 250 168 214 176 190L180 270C182 300 184 330 188 345L192 420C192 428 214 428 216 420L232 350L250 330L268 350L284 420C286 428 308 428 308 420L312 345C316 330 318 300 320 270L324 190C332 214 336 250 344 292C348 306 364 304 362 290C356 230 352 178 342 150C330 122 300 114 264 108V90Z';
function callout(s,entries,today,H){
 const metrics=A.GROUPS[s.key]||[],main=metrics[0],map=H.daily(entries,main),last=[...map.keys()].sort().at(-1);
 if(!last)return {s,has:false,html:`<li class="fig-c ${s.pos} is-empty"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">No reading yet</strong><a class="fig-add" href="#log">Add one →</a></li>`};
 const m=H.META[s.key],t=H.trendText(s.key,main,H.weekTrend(map,today)),word=t.cls==='flat'&&/Not enough/.test(t.text)?'':WORD[t.cls];
 const value=A.nf(A.disp(main,map.get(last)),m.dp),unit=A.unitOf(main);
 return {s,has:true,html:`<li class="fig-c ${s.pos}"><span class="fig-label">${A.esc(s.label)}</span><strong class="fig-value">${value}<span> ${A.esc(unit)}</span></strong><small>${[word,'Updated '+H.rel(last,today).toLowerCase()].filter(Boolean).join(' · ')}</small></li>`};
}
A.figure=function(entries,today,H){
 const el=$('#home-figure');if(!el)return;
 const tr=new Set(A.tracked()),list=SPOTS.filter(s=>tr.has(s.key)).map(s=>callout(s,entries,today,H));
 const lines=list.map(c=>`<path class="fig-line" d="M${c.s.dot[0]} ${c.s.dot[1]}L${c.s.end[0]} ${c.s.end[1]}"/>`).join('');
 const dots=list.map(c=>`<g class="fig-dot${c.has?'':' is-empty'}"><circle class="fig-pulse" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="9"/><circle class="fig-core" cx="${c.s.dot[0]}" cy="${c.s.dot[1]}" r="5"/></g>`).join('');
 el.innerHTML=`<h2 id="fig-title" class="sr-only">Latest readings</h2><div class="fig-stage"><svg class="fig-svg" viewBox="0 0 500 440" aria-hidden="true" focusable="false"><defs><linearGradient id="fig-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d3e8e3"/><stop offset="1" stop-color="#e4eef0"/></linearGradient><filter id="fig-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter></defs><g class="fig-glow" filter="url(#fig-blur)"><ellipse cx="250" cy="60" rx="30" ry="35"/><path d="${BODY}"/></g><g class="fig-body"><ellipse cx="250" cy="60" rx="28" ry="33"/><path d="${BODY}"/></g>${lines}${dots}</svg><ul class="fig-callouts" aria-label="Latest readings">${list.map(c=>c.html).join('')}</ul></div>`;
};
})();
