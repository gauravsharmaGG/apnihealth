// Browser smoke test on fictional preview data: every member's tabs render at 390x844 without script errors.
// Needs Chrome/Chromium (CHROME_BIN, default google-chrome) and Node 22+ (global WebSocket). Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
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
 const token=randomBytes(16).toString('hex'),port=4800+Math.floor(Math.random()*400),dbg=9400+Math.floor(Math.random()*400);
 srv=spawn(process.execPath,['--import','./scripts/preview/loader.mjs','server.mjs'],{cwd:dir,env:{...env,PORT:String(port),PREVIEW_AUTH_TOKEN:token},stdio:'ignore'});
 br=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+dbg,'--user-data-dir='+mkdtempSync(join(tmpdir(),'apni-chrome-')),'about:blank'],{stdio:'ignore'});
 let t;for(let i=0;i<40&&!t;i++){await sleep(250);try{t=(await(await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x=>x.type==='page')}catch{}}
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={},errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error'&&!/favicon/.test(m.params.entry.url||'')&&!(m.params.entry.source==='network'||/fetching the script/.test(m.params.entry.text)))errors.push(m.params.entry.text.slice(0,60)+' @'+(m.params.entry.url||'')+':'+(m.params.entry.lineNumber??''))};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result.result.value;
 await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Page.enable');
 await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setExtraHTTPHeaders',{headers:{'X-Preview-Auth':token}});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 const base=`http://127.0.0.1:${port}/`;
 await send('Page.navigate',{url:base});await sleep(1500);
 for(const [member,expectTabs] of [['alex',6],['sam',4],['mia',5]]){
  await ev(`localStorage.setItem('profile','${member}')`);
  await send('Page.navigate',{url:base+'?p='+member});await sleep(1500);
  const tabs=await ev(`[...document.querySelectorAll('.topbar nav a')].map(a=>a.hash)`);
  assert.equal(tabs.length,expectTabs,member+' tabs');assert.equal(await ev('window.PROFILE'),member);
  for(const h of [...tabs,'#calendar','#settings']){
   await ev(`location.hash='${h}'`);await sleep(350);
   const vis=await ev(`[...document.querySelectorAll('.view')].filter(v=>!v.hidden).map(v=>v.id)`);
   assert.deepEqual(vis,[h.slice(1)],member+' '+h);
   assert(!(await ev('document.documentElement.scrollWidth>innerWidth+1')),member+' '+h+' scrolls horizontally');
   if(shots){const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,member+'-'+h.slice(1)+'.png'),Buffer.from(s.result.data,'base64'))}
  }
 }
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser smoke: every member\'s tabs render at 390x844, no horizontal scroll, no script errors.');
}finally{br?.kill();srv?.kill();await sleep(200);rmSync(dir,{recursive:true,force:true})}
