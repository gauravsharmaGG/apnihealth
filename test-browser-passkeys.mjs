// Passkeys in a real browser (fictional preview data, AUTH_MODE=builtin on http://localhost): sign in with an email
// link, add a passkey in Settings using Chrome's virtual authenticator (CDP WebAuthn domain), sign out, sign back
// in with the passkey. 390x844 viewport. Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser passkeys: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser passkeys: needs Node 22+');process.exit(0)}
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-bpk-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms,what)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timed out: '+what);await sleep(100)}};
let srv,br;
try{
 assert.equal(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env}).status,0);spawnSync('git',['init','-q'],{cwd:dir});
 assert.equal(spawnSync('python3',['build.py'],{cwd:dir,env}).status,0);
 const port=5300+Math.floor(Math.random()*400),dbg=9800+Math.floor(Math.random()*150),base=`http://localhost:${port}`;
 let log='';
 srv=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{PATH:env.PATH,NO_PUSH:'1',AUTH_MODE:'builtin',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 srv.stdout.on('data',d=>log+=d);srv.stderr.on('data',d=>log+=d);
 await until(()=>/listening/.test(log),8000,'server');
 br=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+dbg,'--user-data-dir='+mkdtempSync(join(tmpdir(),'apni-chrome-')),'about:blank'],{stdio:'ignore'});
 let t;for(let i=0;i<40&&!t;i++){await sleep(250);try{t=(await(await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x=>x.type==='page')}catch{}}
 const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={},errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error'&&m.params.entry.source!=='network'&&!/favicon/.test(m.params.entry.url||''))errors.push(m.params.entry.text.slice(0,80))};
 const send=(method,params={})=>new Promise((r,no)=>{wait[++id]=m=>m.error?no(Error(method+': '+m.error.message)):r(m.result);ws.send(JSON.stringify({id,method,params}))});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result.value;
 const go=async url=>{await send('Page.navigate',{url});await sleep(800)};
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await send('WebAuthn.enable');
 const {authenticatorId}=await send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 const noScroll=async what=>assert(await ev('document.documentElement.scrollWidth<=innerWidth'),what+': no horizontal scroll');
 // 1. email link sign-in
 await go(base+'/');assert.equal(await ev('location.pathname'),'/login');
 assert.equal(await ev("!document.getElementById('passkey-area').hidden"),true,'passkey button shown');await noScroll('sign-in page');
 await ev("document.querySelector('input[name=email]').value='preview@example.com';document.querySelector('form.auth-form').requestSubmit()");
 const link=await until(()=>(log.match(/sign-in link for preview@example\.com: (\S+)/)||[])[1],5000,'sign-in link');
 await go(link.replace(/^https?:\/\/[^/]+/,base));await ev("document.querySelector('form.auth-form').requestSubmit()");
 await until(async()=>await ev("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'signed in');
 // 2. add a passkey in Settings
 await go(base+'/#settings');
 await until(()=>ev("!!document.getElementById('pk-add')"),5000,'add passkey button');await noScroll('settings');
 await ev("document.getElementById('pk-add').click()");
 await until(()=>ev("document.querySelectorAll('.pk-list li').length===1"),8000,'passkey listed');
 assert.match(await ev("document.querySelector('#account-body .set-msg').textContent"),/Passkey added/);
 assert.equal((await send('WebAuthn.getCredentials',{authenticatorId})).credentials.length,1,'credential stored on the authenticator');
 // 3. sign out, sign back in with the passkey
 await ev("document.querySelector('#account-body form[action=\"/logout\"]').requestSubmit()");
 await until(()=>ev("location.pathname==='/login'"),5000,'signed out');
 assert.equal((await fetch(base+'/api/me',{headers:{Host:`localhost:${port}`}})).status,401);
 await ev("document.getElementById('passkey-login').click()");
 await until(async()=>await ev("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'signed in with passkey');
 assert.equal(await ev('APP_CONFIG.user.email'),'preview@example.com');
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser passkeys: email-link sign-in, add passkey (virtual authenticator), sign out, passkey sign-in at 390x844.');
}finally{try{br?.kill()}catch{};try{srv?.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
