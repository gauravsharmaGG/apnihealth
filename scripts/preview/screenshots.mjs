#!/usr/bin/env node
// Screenshots of the app with fictional preview data, for reviews: node scripts/preview/screenshots.mjs <out dir>
// [name=hash@WIDTHxHEIGHT ...]. Copies the repo to a temp dir, seeds preview data there, runs the server with the
// preview auth shim and drives headless Chrome over CDP (CHROME_BIN). Never touches ./private.
import {spawn,spawnSync} from 'node:child_process';
import {launchChrome} from '../../testlib.mjs';
import {mkdtempSync,cpSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomBytes} from 'node:crypto';
const out=resolve(process.argv[2]||'shots');mkdirSync(out,{recursive:true});
const jobs=(process.argv.slice(3).length?process.argv.slice(3):['desktop=alex#home@1280x800','phone=alex#home@390x844']).map(j=>{const m=/^([\w-]+)=(\w+)(#[\w-]*)?@(\d+)x(\d+)(full)?$/.exec(j);if(!m)throw Error('bad job '+j);return {name:m[1],profile:m[2],hash:m[3]||'',w:+m[4],h:+m[5],full:!!m[6]}});
const chrome=process.env.CHROME_BIN||'google-chrome',src=resolve(new URL('../..',import.meta.url).pathname)+'/',dir=mkdtempSync(join(tmpdir(),'apni-shots-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1'},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let srv,br;
try{
 if(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env}).status!==0)throw Error('seed failed');spawnSync('git',['init','-q'],{cwd:dir});
 if(spawnSync('python3',['build.py'],{cwd:dir,env}).status!==0)throw Error('build failed');
 const token=randomBytes(16).toString('hex'),port=5200+Math.floor(Math.random()*300);
 srv=spawn(process.execPath,['--import','./scripts/preview/loader.mjs','server.mjs'],{cwd:dir,env:{...env,PORT:String(port),PREVIEW_AUTH_TOKEN:token},stdio:'ignore'});
 // waits for DevTools and a page target (clear error with Chrome's output if it never gets there)
 const chromeRun=await launchChrome({chrome,args:['--hide-scrollbars']});br=chromeRun.proc;const t=chromeRun.target,dbg=chromeRun.port;
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 await send('Page.enable');await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setExtraHTTPHeaders',{headers:{'X-Preview-Auth':token}});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const base=`http://127.0.0.1:${port}/`;
 for(const j of jobs){
  await send('Emulation.setDeviceMetricsOverride',{width:j.w,height:j.h,deviceScaleFactor:j.w<600?3:2,mobile:j.w<600});
  await send('Page.navigate',{url:base+'?p='+j.profile+j.hash});await sleep(2500);
  let clip;if(j.full){const r=(await send('Runtime.evaluate',{expression:'document.documentElement.scrollHeight',returnByValue:true})).result.result.value;clip={x:0,y:0,width:j.w,height:r,scale:1}}
  const s=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:!!j.full,...(clip?{clip}:{})});
  writeFileSync(join(out,j.name+'.png'),Buffer.from(s.result.data,'base64'));console.log('wrote',join(out,j.name+'.png'));
 }
}finally{try{br?.kill()}catch{};try{srv?.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
