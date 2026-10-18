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
 {key:'temperature',label:'Body temperature',pos:'c-tp',dot:[250,90],line:'M250 90L214 64H136'},
 {key:'spo2',label:'Blood oxygen',pos:'c-ox',dot:[250,176],line:'M250 176L218 214H136'},
 {key:'heart_rate',label:'Resting heart rate',pos:'c-hr',dot:[292,290],line:'M292 290H364'},
 {key:'weight',label:'Weight',pos:'c-wt',dot:[250,436],line:'M250 436L278 444H364'}
];
const ARROW={up:'\u2191',down:'\u2193',flat:'\u2192'};
// one smooth silhouette from cubic Béziers: rounded head, tapering jaw and neck, soft trapezius curves into sloping
// shoulders, upper arms merged with a gently narrowing torso. Only the right half is written; the left is its mirror image.
const HALF=[[276,38,298,62,298,98],[298,126,292,142,282,152],[274,160,272,168,272,180],[272,196,274,206,282,212],[302,222,336,226,362,238],[390,250,408,268,412,298],[416,330,414,372,408,414],[404,456,396,500,392,540]];
const BODY=(()=>{
 let p=[250,38],d='M250 38',pts=[];
 for(const s of HALF){pts.push([p,s]);p=[s[4],s[5]];d+=`C${s.join(' ')}`}
 d+=`L${500-p[0]} ${p[1]}`;
 for(const [q,s] of pts.reverse())d+=`C${500-s[2]} ${s[3]} ${500-s[0]} ${s[1]} ${500-q[0]} ${q[1]}`;
 return d+'z';
})();
const DEFS=`<defs>
<radialGradient id="fig-halo" cx="50%" cy="40%" r="58%"><stop offset="0" stop-color="#bfe6da" stop-opacity=".8"/><stop offset=".55" stop-color="#d9e8fa" stop-opacity=".4"/><stop offset="1" stop-color="#ece7fb" stop-opacity="0"/></radialGradient>
<radialGradient id="fig-mist" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#e4dcfa" stop-opacity=".7"/><stop offset="1" stop-color="#e4dcfa" stop-opacity="0"/></radialGradient>
<linearGradient id="fig-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe8dc" stop-opacity=".95"/><stop offset=".4" stop-color="#b4d6f2" stop-opacity=".85"/><stop offset=".75" stop-color="#cdc6f3" stop-opacity=".8"/><stop offset="1" stop-color="#d8cdf5" stop-opacity=".7"/></linearGradient>
<radialGradient id="fig-core" cx="50%" cy="40%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".6" stop-color="#e6f6f1" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="fig-lit" cx="40%" cy="16%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="fig-spec" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="fig-rim" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="400"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="fig-ribbon" gradientUnits="userSpaceOnUse" x1="0" y1="186" x2="0" y2="470"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="fig-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="540"><stop offset=".5" stop-color="#fff"/><stop offset=".97" stop-color="#fff" stop-opacity="0"/></linearGradient>
<mask id="fig-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="500" height="540"><rect width="500" height="540" fill="url(#fig-fade)"/></mask>
<clipPath id="fig-clip"><path d="${BODY}"/></clipPath>
<filter id="fig-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>
<filter id="fig-bloom" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="fig-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
</defs>`;
// layers: wide bloom, glassy form, inner glow (blurred inset edge + soft core), light from above, a thin rim light along
// the head and shoulders, specular spots, and a few faint flowing inner lines (spine, energy ribbons, rib arcs)
const FORM=`<g mask="url(#fig-mask)"><path class="fig-bloom" filter="url(#fig-bloom)" d="${BODY}"/><path class="fig-body" filter="url(#fig-soft)" d="${BODY}"/><g clip-path="url(#fig-clip)"><path class="fig-inset" filter="url(#fig-glow)" d="${BODY}"/><ellipse class="fig-glowcore" cx="250" cy="290" rx="120" ry="170"/><path class="fig-lit" d="${BODY}"/><g class="fig-inner"><path class="fig-ribbon" d="M250 190V470"/><path d="M250 222C214 270 286 334 250 396S222 452 250 484M250 222C286 270 214 334 250 396S278 452 250 484"/><path d="M196 276c28 16 80 16 108 0M190 318c32 20 88 20 120 0M188 360c34 22 90 22 124 0"/><path d="M152 262c-6 40-2 100 4 160M348 262c6 40 2 100-4 160"/></g></g><path class="fig-rim" d="${BODY}"/><ellipse class="fig-spec" cx="226" cy="70" rx="15" ry="26" transform="rotate(14 226 70)"/><ellipse class="fig-spec" cx="168" cy="262" rx="40" ry="11" transform="rotate(-16 168 262)"/></g>`;
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
 el.innerHTML=`<h2 id="fig-title" class="sr-only">Latest readings</h2><div class="fig-stage"><svg class="fig-svg" viewBox="0 0 500 540" aria-hidden="true" focusable="false">${DEFS}<ellipse class="fig-halo" cx="250" cy="250" rx="250" ry="270"/><ellipse class="fig-mist" cx="250" cy="330" rx="230" ry="200"/>${FORM}${lines}${list.some(c=>c.s.key==='heart_rate')?'<path class="fig-ecg" pathLength="1" d="M246 324h20l6-11 8 24 8-32 7 19h20"/>':''}${dots}</svg><ul class="fig-callouts" aria-label="Latest readings">${list.map(c=>c.html).join('')}</ul></div>`;
};
})();
