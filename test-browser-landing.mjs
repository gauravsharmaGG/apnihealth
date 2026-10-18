// The public landing page in a real browser (AUTH_MODE=builtin, signed out, fictional): at 390x844 and 1280x800 it
// shows the hero, the figure with clearly labelled sample callouts, the feature cards and the CTAs to /login,
// has no horizontal scroll and no console/CSP errors; reduced motion turns the animations off. Also the
// invite-only variant. SHOT_DIR, when set, receives landing-*.png screenshots (not committed). Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startServer,launchChrome} from './testlib.mjs';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser landing: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser landing: needs Node 22+');process.exit(0)}
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-lp-')),shots=process.env.SHOT_DIR;
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const procs=[];let br;
try{
 assert.equal(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env:{PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1'}}).status,0); // fictional members, so the invite-only server starts
 const env={PATH:process.env.PATH,NO_PUSH:'1',AUTH_MODE:'builtin'};
 const open=await startServer({cwd:dir,env:{...env,SIGNUP_MODE:'open',DEMO_NOTICE:'Demo instance: fictional data only.'}});procs.push(open.p);
 const invite=await startServer({cwd:dir,env:{...env,SIGNUP_MODE:'invite'}});procs.push(invite.p);
 const run=await launchChrome({chrome});br=run.proc;
 const ws=new WebSocket(run.target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={},errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&m.params.entry.level!=='info'&&m.params.entry.level!=='verbose'&&!/favicon/.test(m.params.entry.url||''))errors.push(m.params.entry.level+': '+m.params.entry.text.slice(0,120))
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error')};
 const send=(method,params={})=>new Promise((r,no)=>{wait[++id]=m=>m.error?no(Error(method+': '+m.error.message)):r(m.result);ws.send(JSON.stringify({id,method,params}))});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result.value;
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 const load=async(url,w,h,motion)=>{
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:w<600?2:1,mobile:w<600});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion}]});
  await send('Page.navigate',{url});await sleep(1200);
 };
 const shot=async(name,full)=>{if(!shots)return;mkdirSync(shots,{recursive:true});await sleep(2500);
  const h=full?await ev('document.documentElement.scrollHeight'):0;
  const s=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:!!full,...(full?{clip:{x:0,y:0,width:390,height:h,scale:1}}:{})});
  writeFileSync(join(shots,name+'.png'),Buffer.from(s.data,'base64'))};
 for(const [w,h,name] of [[390,844,'phone'],[1280,800,'desktop']]){
  await load(`http://localhost:${open.port}/`,w,h,'no-preference');
  assert.equal(await ev('location.pathname'),'/','signed out: stays on the landing page, no redirect');
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,name+': no horizontal scroll');
  assert.equal(await ev('document.querySelectorAll("main h1").length'),1,'one h1');
  assert.match(await ev('document.querySelector("h1").textContent'),/health/i);
  assert.equal(await ev('!!document.querySelector("header")&&!!document.querySelector("main")&&!!document.querySelector("footer")'),true,'landmarks');
  assert.match(await ev('document.querySelector(".demo-notice").textContent'),/Demo instance/,'demo notice');
  assert.equal(await ev('document.querySelectorAll(".lp-stage svg path").length>3'),true,name+': figure');
  assert.match(await ev('document.querySelector(".lp-stage").getAttribute("aria-label")'),/not real data/,'aria says sample');
  assert.equal(await ev('document.querySelector(".lp-chip").textContent'),'Sample data');
  assert.deepEqual(await ev('[...document.querySelectorAll(".lp-call-label")].map(e=>e.textContent)'),['Heart','Body temp','Breathing','SpO₂']);
  assert.equal(await ev('[...document.querySelectorAll(".lp-call")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})'),true,name+': callouts inside the viewport');
  assert.equal(await ev('document.querySelectorAll(".lp-card").length'),9,name+': feature cards');
  assert.equal(await ev('[...document.querySelectorAll(".lp-card h3")].map(e=>e.textContent).join("|")'),'Episodes|Medicines & reminders|Appointments|Lab trends|Reports|Apple Health import|Households|Privacy & EU hosting|Open source');
  const links=await ev('[...document.querySelectorAll("a.lp-btn")].map(a=>[a.textContent,new URL(a.href).pathname])');
  assert(links.filter(l=>l[0]==='Create account').length>=2&&links.filter(l=>l[0]==='Sign in').length>=2&&links.every(l=>l[1]==='/login'),name+': CTAs go to /login');
  assert.equal(await ev('[...document.querySelectorAll("a.lp-btn")].every(a=>a.getBoundingClientRect().height>=44)'),true,'touch targets 44px');
  assert.match(await ev('document.querySelector("footer a").href'),/github\.com\/gauravsharmaGG\/apnihealth/);
  assert.equal(await ev('getComputedStyle(document.querySelector(".lp-breathe")).animationName!=="none"'),true,name+': animated by default');
  await shot('landing-'+name,false);if(name==='phone')await shot('landing-phone-full',true);
  // reduced motion
  await load(`http://localhost:${open.port}/`,w,h,'reduce');
  assert.equal(await ev('[...document.querySelectorAll(".lp-breathe,.lp-dot .ring,.lp-ecg,.lp-call,.lp-halo")].every(e=>getComputedStyle(e).animationName==="none")'),true,name+': reduced motion: no animation');
  assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,name+': no horizontal scroll (reduced motion)');
 }
 // headers: indexable landing, no CSP violations were logged
 const r=await fetch(`http://localhost:${open.port}/`);assert.equal(r.headers.get('x-robots-tag'),null);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
 assert.match(await r.text(),/<meta name="description"/);
 assert.equal((await fetch(`http://localhost:${open.port}/login`)).headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
 // invite-only: no "Create account", says so
 await load(`http://localhost:${invite.port}/`,390,844,'no-preference');
 assert.equal(await ev('[...document.querySelectorAll("a.lp-btn")].some(a=>/Create account/.test(a.textContent))'),false);
 assert.match(await ev('document.querySelector("main").textContent'),/by invitation only/);
 assert.deepEqual(errors,[],'no console or CSP errors');
 console.log('PASS browser landing: hero, sample-labelled figure and callouts, feature cards, CTAs to /login, no horizontal scroll or console errors at 390x844 and 1280x800; reduced motion; invite-only wording.');
}finally{try{br?.kill()}catch{};for(const p of procs)try{p.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
