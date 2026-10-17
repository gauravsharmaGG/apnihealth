// Accounts in a real browser (fictional preview data, AUTH_MODE=builtin on http://localhost), 390x844: sign in with
// an email link, add a passkey in Settings using Chrome's virtual authenticator (CDP WebAuthn domain), sign out,
// sign back in with the passkey; then the Household card: add a child profile, create a viewer invite, and open it
// in a second, separate browser context where a new person joins as viewer and sees no write controls.
// Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser accounts: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser accounts: needs Node 22+');process.exit(0)}
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
 await until(()=>ev("location.pathname==='/welcome/passkey'&&!document.getElementById('pk-prompt-add').hidden"),8000,'passkey prompt');
 await ev("document.getElementById('pk-prompt-skip').click()");
 await until(async()=>await ev("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'signed in');
 // 2. add a passkey in Settings
 await go(base+'/#settings');
 await until(()=>ev("!!document.getElementById('pk-add')"),5000,'add passkey button');await noScroll('settings');
 await ev("document.getElementById('pk-add').click()");
 await until(()=>ev("document.querySelectorAll('#pk-keys li').length===1"),8000,'passkey listed');
 assert.match(await ev("document.querySelector('#account-body .set-msg').textContent"),/Passkey added/);
 assert.equal((await send('WebAuthn.getCredentials',{authenticatorId})).credentials.length,1,'credential stored on the authenticator');
 // 3. sign out, sign back in with the passkey
 await ev("document.querySelector('#account-body form[action=\"/logout\"]').requestSubmit()");
 await until(()=>ev("location.pathname==='/login'"),5000,'signed out');
 assert.equal((await fetch(base+'/api/me',{headers:{Host:`localhost:${port}`}})).status,401);
 await ev("document.getElementById('passkey-login').click()");
 await until(async()=>await ev("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'signed in with passkey');
 assert.equal(await ev('APP_CONFIG.user.email'),'preview@example.com');
 // 4. household card: add a child profile, create a viewer invite
 await go(base+'/#settings');
 await until(()=>ev("!!document.querySelector('#hh-card form[data-form=member]')"),5000,'household card');await noScroll('household settings');
 await ev("const f=document.querySelector('form[data-form=member]');f.name.value='Example Child';f.kind.value='child';f.requestSubmit()");
 await sleep(1500);await until(()=>ev("!!window.APP_CONFIG&&APP_CONFIG.members.some(m=>m.name==='Example Child'&&m.kind==='child')"),5000,'new profile after reload');
 assert(await ev("[...document.querySelectorAll('#profile-menu [data-profile]')].some(b=>b.textContent.includes('Example Child'))"),'profile menu lists the child');
 await go(base+'/#settings');await until(()=>ev("!!document.querySelector('form[data-form=invite]')"),5000,'invite form');
 await ev("const f=document.querySelector('form[data-form=invite]');f.role.value='viewer';f.requestSubmit()");
 const invite=await until(()=>ev("document.getElementById('hh-link')?.value"),5000,'invite link');assert.match(invite,/\/invite\?token=[A-Za-z0-9_-]{43}$/);
 assert.equal(await ev("document.querySelectorAll('#hh-invites li').length"),1);await noScroll('invite created');
 // Apple Health keys for the current profile: the migrated shared key, plus a new one shown once
 await go(base+'/#log');await until(()=>ev("!!document.getElementById('sync')&&!document.getElementById('log').hidden"),5000,'log view');
 await ev("document.getElementById('sync').open=true;document.getElementById('sync-reveal').click()");
 await until(()=>ev("document.querySelectorAll('#sync-keys li [data-revoke-key]').length===1"),5000,'shared key listed');
 await ev("document.getElementById('sync-label').value='Test phone';document.getElementById('sync-new').click()");
 await until(()=>ev("/^Bearer [A-Za-z0-9_-]{43}$/.test(document.getElementById('sync-token').value)"),5000,'new key shown');
 await until(()=>ev("document.querySelectorAll('#sync-keys li [data-revoke-key]').length===2"),5000,'two keys');await noScroll('sync keys');
 assert.deepEqual(errors,[],'no script errors (owner)');
 // 5. a new person opens the invite in a separate browser context and joins as viewer
 const bws=new WebSocket((await(await fetch(`http://127.0.0.1:${dbg}/json/version`)).json()).webSocketDebuggerUrl);await new Promise(r=>bws.onopen=r);
 let bid=0;const bwait={};bws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&bwait[m.id]){bwait[m.id](m);delete bwait[m.id]}};
 const bsend=(method,params={})=>new Promise((r,no)=>{bwait[++bid]=m=>m.error?no(Error(method+': '+m.error.message)):r(m.result);bws.send(JSON.stringify({id:bid,method,params}))});
 const {browserContextId}=await bsend('Target.createBrowserContext');
 const {targetId}=await bsend('Target.createTarget',{url:'about:blank',browserContextId});
 const t2=(await(await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x=>x.id===targetId);
 const ws2=new WebSocket(t2.webSocketDebuggerUrl);await new Promise(r=>ws2.onopen=r);
 let id2=0;const wait2={},errors2=[];
 ws2.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait2[m.id]){wait2[m.id](m);delete wait2[m.id]}else if(m.method==='Runtime.exceptionThrown')errors2.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)};
 const send2=(method,params={})=>new Promise((r,no)=>{wait2[++id2]=m=>m.error?no(Error(method+': '+m.error.message)):r(m.result);ws2.send(JSON.stringify({id:id2,method,params}))});
 const ev2=async x=>(await send2('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result.value;
 const go2=async url=>{await send2('Page.navigate',{url});await sleep(800)};
 await send2('Runtime.enable');await send2('Page.enable');await send2('Network.enable');await send2('Network.setBypassServiceWorker',{bypass:true});
 await send2('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await go2(invite);assert.match(await ev2('document.body.textContent'),/invited as viewer/);
 await ev2("const f=document.querySelector('form.auth-form');f.email.value='new-viewer@example.com';f.requestSubmit()");
 const vl=await until(()=>(log.match(/sign-in link for new-viewer@example\.com: (\S+)/)||[])[1],5000,'viewer sign-in link');
 await go2(vl.replace(/^https?:\/\/[^/]+/,base));await ev2("document.querySelector('form.auth-form').requestSubmit()");
 await until(()=>ev2("location.pathname==='/welcome/passkey'"),8000,'viewer passkey prompt');await ev2("document.getElementById('pk-prompt-skip').click()");
 // the health data notice comes before anything else
 await until(()=>ev2("location.pathname==='/consent'&&!!document.querySelector('input[name=consent]')"),8000,'consent page');
 assert(await ev2('document.documentElement.scrollWidth<=innerWidth'),'consent page: no horizontal scroll');
 assert.match(await ev2('document.body.textContent'),/not a medical device/);
 await ev2("document.querySelector('input[name=disclaimer]').click();document.querySelector('input[name=consent]').click();document.querySelector('form[action=\"/consent\"]').requestSubmit()");
 await until(async()=>await ev2("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'viewer signed in');
 assert.equal(await ev2('APP_CONFIG.user.role'),'viewer');
 for(const sel of ['#add-event','#new-episode','#lab-add','#log-form'])assert.equal(await ev2(`getComputedStyle(document.querySelector('${sel}')).display`),'none',sel+' hidden for viewers');
 // the small per-item controls (delete, edit, mark taken, ...) are hidden too; the server refuses them anyway
 await go2(base+'/#log');await sleep(1200);
 const small=await ev2("(()=>{const els=[...document.querySelectorAll('[data-del],[data-lab-del],[data-epedit],[data-epdel],[data-edit],[data-delev],[data-addto],[data-ap-new],[data-ap-edit],[data-dose],[data-newmed],.mt-take,.mt-more,#ah-import')];return {n:els.length,shown:els.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.outerHTML.slice(0,60))}})()");
 assert(small.n>0,'per-item controls rendered');assert.deepEqual(small.shown,[],'no write controls shown to viewers');
 await go2(base+'/#settings');await until(()=>ev2("!!document.getElementById('hh-card')"),5000,'viewer household card');
 assert.equal(await ev2("!!document.querySelector('form[data-form=invite]')"),false,'viewers cannot invite');
 assert(await ev2("document.getElementById('hh-people').textContent.includes('new-viewer@example.com')"));
 assert(await ev2('document.documentElement.scrollWidth<=innerWidth'),'viewer settings: no horizontal scroll');
 assert.deepEqual(errors2,[],'no script errors (viewer)');ws2.close();bws.close();
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser accounts: email-link sign-in, add passkey (virtual authenticator), sign out, passkey sign-in; add child profile, Apple Health key created, viewer invite joined in a second context with write controls hidden; 390x844.');
}finally{try{br?.kill()}catch{};try{srv?.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
