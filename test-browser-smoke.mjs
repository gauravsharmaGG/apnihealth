// Browser smoke test on fictional preview data: every member's sections render at 1280x800 and 390x844 without script errors.
// Needs Chrome/Chromium (CHROME_BIN, default google-chrome) and Node 22+ (global WebSocket). Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {startServer,launchChrome} from './testlib.mjs';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser smoke: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser smoke: needs Node 22+ (or --experimental-websocket)');process.exit(0)}
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-smoke-')),shots=process.env.SHOT_DIR;
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
 const nav={alex:9,sam:9,mia:8},extra={alex:['#records','#overview'],sam:['#s-reports','#s-overview'],mia:[]};
 for(const [vw,vh,mobile] of [[1280,800,false],[390,844,true]]){
 await send('Emulation.setDeviceMetricsOverride',{width:vw,height:vh,deviceScaleFactor:mobile?2:1,mobile});
 await send('Page.navigate',{url:base});await sleep(1500);
 for(const member of ['alex','sam','mia']){
  await ev(`localStorage.setItem('profile','${member}')`);
  await send('Page.navigate',{url:base+'?p='+member});await sleep(1500);
  const tabs=await ev(`[...document.querySelectorAll('#side-nav a')].map(a=>a.hash)`);
  assert.equal(tabs.length,nav[member],member+' nav items');assert.equal(await ev('window.PROFILE'),member);
  // desktop shows the sidebar; phones show the bottom tab bar (4 sections + More) and keep the rest in the More sheet
  assert.equal(await ev(`getComputedStyle(document.querySelector('.sidebar')).display!=='none'`),!mobile,member+' sidebar at '+vw);
  assert.equal(await ev(`getComputedStyle(document.querySelector('#tab-nav')).display!=='none'`),mobile,member+' tab bar at '+vw);
  assert.equal(await ev(`document.querySelectorAll('#tab-nav a').length+document.querySelectorAll('#more-nav a').length`),nav[member]);
  assert(await ev(`document.querySelector('#appbar-date').textContent.length>5`),'date in the app bar');
  if(mobile){
   await ev(`document.querySelector('#tab-more').click()`);await sleep(300);
   assert(await ev(`document.querySelector('#more-sheet').open`),member+' More opens');
   await ev(`document.querySelector('#more-nav a[href="#settings"]').click()`);await sleep(400);
   assert(!(await ev(`document.querySelector('#more-sheet').open`)),'More closes after picking');
   assert.equal(await ev('location.hash'),'#settings');assert(await ev(`document.querySelector('#tab-more').classList.contains('active')`),'More marks a section it holds');
  }
  for(const h of [...tabs,...extra[member]]){
   await ev(`location.hash='${h}'`);await sleep(350);
   const vis=await ev(`[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id)`);
   assert.deepEqual(vis,[h.slice(1)],member+' '+h);
   assert(!(await ev('document.documentElement.scrollWidth>innerWidth+1')),member+' '+h+' scrolls horizontally at '+vw);
   assert.equal(await ev(`document.querySelectorAll('nav a.active').length>0`),true,member+' '+h+' highlights a nav item');
   if(shots){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,member+'-'+h.slice(1)+'-'+vw+'.png'),Buffer.from(s.result.data,'base64'))}
  }
 }
 }
 // home dashboard: a card per tracked measurement for alex (fictional data), a welcome state for a new profile
 for(const [m,vw] of [['alex',1280],['alex',390],['sam',390]]){
  await send('Emulation.setDeviceMetricsOverride',{width:vw,height:vw>500?800:844,deviceScaleFactor:vw>500?1:2,mobile:vw<500});
  await ev(`localStorage.setItem('profile','${m}')`);await send('Page.navigate',{url:base+'?p='+m+'#home'});await sleep(1500);
  assert.equal(await ev(`document.querySelector('#home-greet').textContent`),m==='alex'?'Hello, Alex.':'Hello, Sam.');
  if(m==='alex'){assert.equal(await ev(`document.querySelectorAll('#home-cards .metric-card').length`),7,'one card per tracked measurement');assert(await ev(`document.querySelectorAll('#home-cards .mc-spark').length>=5`),'sparklines')
   assert(await ev(`document.querySelectorAll('#home-today .tl-row').length>=3`),'today lists doses and appointments');assert.equal(await ev(`document.querySelectorAll('#home-today .tl-ep').length`),1,'ongoing episode');assert(await ev(`document.querySelectorAll('#home-today .tl-dot').length>=3`),'day bar')
   assert(await ev(`document.querySelectorAll('#home-insights .in-item').length>=2`),'insights');assert(await ev(`/not a diagnosis or medical advice/.test(document.querySelector('#home-insights').textContent)`),'insights disclaimer');assert(!(await ev(`/heart age|stress/i.test(document.querySelector('#home').textContent)`)),'no heart age or stress')}
  else{assert(await ev(`!!document.querySelector('#home-cards .home-empty')`),'empty state for a new profile');assert(await ev(`!!document.querySelector('#home-today .tl-empty')`),'empty today')}
  assert(!(await ev('document.documentElement.scrollWidth>innerWidth+1')),m+' home scrolls horizontally at '+vw);
 }
 // lab results: the second adult sees their own results and can add a report with the form
 await ev(`localStorage.setItem('profile','sam')`);await send('Page.navigate',{url:base+'?p=sam#measurements'});await sleep(1500);
 const before=await ev(`document.querySelectorAll('#measurement-grid .measurement').length`);assert.equal(before,2,'sam has two lab series');
 await ev(`document.querySelector('#lab-add').click()`);await sleep(300);assert(await ev(`document.querySelector('#lab-dialog').open`));
 assert(!(await ev('document.querySelector("#lab-dialog").scrollWidth>document.querySelector("#lab-dialog").clientWidth+1')),'lab form fits 390px');
 if(shots){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,'sam-lab-form.png'),Buffer.from(s.result.data,'base64'))}
 await ev(`(()=>{const f=document.querySelector('.lab-row');f.querySelector('.lab-name').value='Ferritin';f.querySelector('.lab-value').value='50';f.querySelector('.lab-unit').value='ng/mL';document.querySelector('#lab-date').value='2000-01-01';document.querySelector('#lab-form').requestSubmit()})()`);
 await sleep(800);assert(!(await ev(`document.querySelector('#lab-dialog').open`)),await ev(`document.querySelector('#lab-msg').textContent`));
 assert.equal(await ev(`document.querySelectorAll('#measurement-grid .measurement').length`),3,'the new result appears');
 assert.equal(await ev(`document.querySelectorAll('#lab-report-list [data-lab-del]').length`),3);
 await ev(`localStorage.setItem('profile','alex')`);await send('Page.navigate',{url:base+'?p=alex#measurements'});await sleep(1500);
 assert((await ev(`document.querySelectorAll('#measurement-grid .measurement').length`))>10,'alex keeps their own results');
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser smoke: every member\'s sections render at 1280x800 and 390x844 (sidebar, tab bar, More sheet), no horizontal scroll, no script errors; the lab form adds a report for a second adult.');
}finally{br?.kill();srv?.kill();await sleep(200);rmSync(dir,{recursive:true,force:true})}
