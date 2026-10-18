// Browser test of the Home dashboard on fictional preview data at 1280x800 and 390x844: greeting, body figure with callouts
// (values checked against the API, empty state for a metric without data), metric cards, timeline, insights, no horizontal scroll.
// Needs Chrome/Chromium (CHROME_BIN, default google-chrome) and Node 22+ (global WebSocket). Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {startServer,launchChrome} from './testlib.mjs';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser dashboard: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser dashboard: needs Node 22+ (or --experimental-websocket)');process.exit(0)}
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-dash-')),shots=process.env.SHOT_DIR;
const skip=new Set(['.git','private','node_modules']);
cpSync(src,dir,{recursive:true,filter:p=>!skip.has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let srv,br;
try{
 assert.equal(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env}).status,0);spawnSync('git',['init','-q'],{cwd:dir});
 assert.equal(spawnSync('python3',['build.py'],{cwd:dir,env}).status,0);
 const token=randomBytes(16).toString('hex');
 // a free port (retries if taken) and wait until the server listens before the browser loads anything
 const {p:proc,port}=await startServer({cwd:dir,env:{...env,PREVIEW_AUTH_TOKEN:token},args:['--import','./scripts/preview/loader.mjs','server.mjs']});srv=proc;
 // waits for DevTools and a page target (clear error with Chrome's output if it never gets there)
 const chromeRun=await launchChrome({chrome});br=chromeRun.proc;const t=chromeRun.target,dbg=chromeRun.port;
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={},errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error'&&!/favicon/.test(m.params.entry.url||'')&&!(m.params.entry.source==='network'||/fetching the script/.test(m.params.entry.text)))errors.push(m.params.entry.text.slice(0,60)+' @'+(m.params.entry.url||'')+':'+(m.params.entry.lineNumber??''))};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result.result.value;
 await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Page.enable');
 await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setExtraHTTPHeaders',{headers:{'X-Preview-Auth':token}});

 const base=`http://127.0.0.1:${port}/`;
 const load=async(member,vw,vh,mobile)=>{await send('Emulation.setDeviceMetricsOverride',{width:vw,height:vh,deviceScaleFactor:mobile?2:1,mobile});await ev(`localStorage.setItem('profile','${member}')`);await send('Page.navigate',{url:base+'?p='+member+'#home'});await sleep(1800)};
 for(const [vw,vh,mobile] of [[1280,800,false],[390,844,true]]){
  const at=` at ${vw}`;
  await load('alex',vw,vh,mobile);
  assert.equal(await ev(`document.querySelector('#home-greet').textContent`),'Hello, Alex.','greeting'+at);
  assert(await ev(`document.querySelector('#appbar-date').textContent.length>5&&!document.querySelector('#home-date')`),'one date, in the app bar'+at);
  assert(await ev(`(()=>{const f=document.querySelector('.fig-svg').getBoundingClientRect(),h=document.querySelector('#home-greet').getBoundingClientRect();return h.top<innerHeight&&f.top<innerHeight&&(innerWidth<600||document.querySelector('#home-cards .metric-card').getBoundingClientRect().bottom<innerHeight)})()`),'greeting, figure and first cards above the fold'+at);
  assert(await ev(`document.querySelectorAll('#home h1,#home h2').length>=4`),'semantic headings'+at);
  // figure: svg + a callout per tracked figure measurement; the numbers are the person's latest log values
  assert(await ev(`!!document.querySelector('#home-figure svg.fig-svg')&&document.querySelectorAll('#home-figure .fig-dot').length===4`),'figure with four dots'+at);
  const callouts=await ev(`[...document.querySelectorAll('#home-figure .fig-c')].map(c=>({label:c.querySelector('.fig-label').textContent,empty:c.classList.contains('is-empty'),value:c.querySelector('.fig-value').textContent,link:c.querySelector('a')?.getAttribute('href')||''}))`);
  assert.equal(callouts.length,4);
  const api=await ev(`fetch('/api/log?profile=alex',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.entries)`);
  const latest=m=>api.filter(e=>e.metric===m).sort((a,b)=>a.date<b.date?-1:1).at(-1)?.value;
  const expected={'Resting heart rate':latest('resting_hr'),'Weight':latest('weight'),'Blood oxygen':latest('spo2')};
  for(const c of callouts){
   if(c.label==="Body temperature"){assert(c.empty&&/No reading yet/.test(c.value)&&c.link==='#log'&&!/\d/.test(c.value),'empty callout for a metric without data'+at);continue}
   assert(!c.empty,c.label+' has a reading'+at);
   const shown=parseFloat(c.value.replace(/,/g,'')),raw=expected[c.label];assert(raw!=null,'API has '+c.label);
   const want=await ev(`(()=>{const k={'Resting heart rate':'resting_hr','Weight':'weight','Blood oxygen':'spo2'}['${c.label}'];return +AH.disp(k,${raw})})()`);
   assert(Math.abs(shown-want)<0.06,`${c.label}: callout ${shown} vs record ${want}`+at);
  }
  // nothing but the callout text may carry numbers in the figure (no invented values in the svg)
  assert(!(await ev(`/\\d/.test(document.querySelector('#home-figure .fig-svg').textContent)`)),'no text numbers in the figure svg'+at);
  assert(await ev(`document.querySelector('#home-figure .fig-svg').getAttribute('aria-hidden')==='true'&&document.querySelector('#home-figure .fig-callouts').tagName==='UL'`),'figure has a text alternative'+at);
  assert(await ev(`[...document.querySelectorAll('#home-figure .fig-add')].every(a=>a.getBoundingClientRect().height>=44)`),'44px add links'+at);
  assert(await ev(`getComputedStyle(document.querySelector('.fig-dot:not(.is-empty) .fig-pulse')).animationName!=='none'`),'dots pulse'+at);
  // layout of the callouts: label and value on one line each, at most three lines, no overlap with each other, the head or the viewport
  const layout=async()=>ev(`(()=>{const cs=[...document.querySelectorAll('#home-figure .fig-c')],R=e=>e.getBoundingClientRect(),
   one=e=>R(e).height<=parseFloat(getComputedStyle(e).fontSize)*1.6;
   const rs=cs.map(R),ov=[];rs.forEach((a,i)=>rs.forEach((b,j)=>{if(j>i&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)ov.push(i+'/'+j)}));
   const head=R(document.querySelector('#home-figure .fig-svg')),sv=document.querySelector('#home-figure .fig-svg');
   return {n:cs.length,oneLine:cs.every(c=>one(c.querySelector('.fig-label'))&&one(c.querySelector('.fig-value'))),text:cs.every(c=>c.querySelectorAll('small,.fig-add').length<=1),
    heights:cs.map(c=>Math.round(R(c).height)),overlap:ov,inView:rs.every(r=>r.left>=0&&r.right<=innerWidth&&r.width>0),
    meta:cs.every(c=>{const m=c.querySelector('small');return !m||one(m)}),
    hero:!!document.querySelector('img[src*="hero-figure"],picture source[srcset*="hero-figure"]')||!!document.querySelector('#home img'),
    dotsInSvg:[...document.querySelectorAll('#home-figure .fig-core')].every(d=>{const r=R(d),s=R(sv);return r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom})}})()`);
  const L=await layout();
  assert(!L.hero,'no hero-figure or other image on the dashboard'+at);
  assert(L.oneLine&&L.meta,'callout label, value and meta each on one line'+at);
  assert(L.text,'at most one meta line or add link per callout'+at);
  assert(L.heights.every(h=>h<=(L.n&&130)),'callout height '+L.heights+at);
  assert.deepEqual(L.overlap,[],'callouts overlap'+at);assert(L.inView,'callouts inside the viewport'+at);assert(L.dotsInSvg,'dots inside the figure'+at);
  assert(await ev(`(()=>{const h=document.querySelector('#home-figure .fig-body').getBoundingClientRect(),s=document.querySelector('#home-figure .fig-svg').getBoundingClientRect();return h.width>0&&getComputedStyle(document.querySelector('#home-figure .fig-body')).fill.startsWith('url')&&!document.querySelector('#home-figure .fig-body').getAttribute('stroke')})()`),'soft filled body form, no outline'+at);
  if(!mobile)assert(await ev(`(()=>{const sv=document.querySelector('#home-figure .fig-svg').getBoundingClientRect(),hx=sv.left+sv.width*.5,hy=sv.top+sv.height*.2;return [...document.querySelectorAll('#home-figure .fig-c')].every(c=>{const r=c.getBoundingClientRect();return !(r.left<hx+40&&r.right>hx-40&&r.top<hy+55&&r.bottom>hy-55)})})()`),'callouts clear of the head'+at);
  // cards, sparklines, timeline with now marker, insights
  assert.equal(await ev(`document.querySelectorAll('#home-cards .metric-card').length`),8,'cards'+at);
  assert(await ev(`document.querySelectorAll('#home-cards .mc-spark').length>=5`),'sparklines'+at);
  assert(await ev(`!!document.querySelector('#home-cards .metric-card.is-empty a[href="#log"]')`),'card empty state keeps its link'+at);
  assert(await ev(`document.querySelectorAll('#home-today .tl-row').length>=3&&!!document.querySelector('#home-today .tl-now .tl-now-label')&&/^\\d\\d:\\d\\d$/.test(document.querySelector('.tl-now-label').textContent)`),'timeline rows and now marker'+at);
  assert(await ev(`document.querySelectorAll('#home-today .tl-row .dose').length>=3`),'timeline statuses'+at);
  assert(await ev(`document.querySelectorAll('#home-insights .in-item').length>=2&&[...document.querySelectorAll('#home-insights .in-item')].every(i=>i.querySelector('.in-when')&&i.querySelector('.in-ico'))`),'insights with icons and dates'+at);
  assert(await ev(`[...document.querySelectorAll('#home-cards a,#home-figure a,#home-insights .in-go')].every(a=>a.getBoundingClientRect().height>=36)`),'touch targets'+at);
  assert(!(await ev('document.documentElement.scrollWidth>innerWidth+1')),'horizontal scroll'+at);
  if(mobile)assert(await ev(`(()=>{const f=document.querySelector('#home-figure .fig-svg').getBoundingClientRect(),c=document.querySelector('#home-cards').getBoundingClientRect();return f.height<=240&&c.top>f.bottom})()`),'compact figure above the cards on phones');
  else assert(await ev(`(()=>{const f=document.querySelector('#home-figure').getBoundingClientRect(),c=document.querySelector('#home-cards').getBoundingClientRect();return c.left>f.right-20})()`),'cards beside the figure on desktop');
  // reduced motion switches the pulse off
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert(await ev(`getComputedStyle(document.querySelector('.fig-dot:not(.is-empty) .fig-pulse')).animationName==='none'`),'pulse off under reduced motion'+at);
  await send('Emulation.setEmulatedMedia',{features:[]});
  if(shots){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,'dashboard-'+vw+'.png'),Buffer.from(s.result.data,'base64'))}
  // a profile without readings: every callout is an empty state, nothing invented
  await load('sam',vw,vh,mobile);
  assert.equal(await ev(`document.querySelector('#home-greet').textContent`),'Hello, Sam.');
  assert(await ev(`document.querySelectorAll('#home-figure .fig-c.is-empty').length===4&&![...document.querySelectorAll('#home-figure .fig-c')].some(c=>/\\d/.test(c.textContent))`),'empty callouts for a new profile'+at);
  {const E=await layout();assert(E.oneLine&&E.meta&&!E.overlap.length&&E.inView,'empty callouts: one-line text, no overlap, in the viewport'+at+' '+JSON.stringify(E))}
  assert(await ev(`!!document.querySelector('#home-cards .home-empty')&&!!document.querySelector('#home-today .tl-empty')`),'empty states'+at);
  assert(!(await ev('document.documentElement.scrollWidth>innerWidth+1')),'empty home scrolls horizontally'+at);
 }
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser dashboard: greeting, body figure callouts match the records (empty state without data), cards, timeline now marker and insights at 1280x800 and 390x844; no horizontal scroll, no script errors.');
}finally{br?.kill();srv?.kill();await sleep(200);rmSync(dir,{recursive:true,force:true})}
