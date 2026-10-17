// New person, start to finish, in a real browser at 390x844 (fictional data, AUTH_MODE=builtin, open sign-up):
// sign up with an email link, skip the passkey offer, accept the health data notice, set up a household
// (own profile, a child, measurements, time zone, pounds and °F, an Apple Health key), then log a first weight.
// Skips if Chrome is missing.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP browser onboarding: Chrome not found (set CHROME_BIN)');process.exit(0)}
if(typeof WebSocket==='undefined'){console.log('SKIP browser onboarding: needs Node 22+');process.exit(0)}
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-bob-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms,what)=>{const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timed out: '+what);await sleep(100)}};
let srv,br;
try{
 assert.equal(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env}).status,0);spawnSync('git',['init','-q'],{cwd:dir});
 assert.equal(spawnSync('python3',['build.py'],{cwd:dir,env}).status,0);
 const port=5700+Math.floor(Math.random()*400),dbg=9950+Math.floor(Math.random()*40),base=`http://localhost:${port}`;
 let log='';
 srv=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{PATH:env.PATH,NO_PUSH:'1',AUTH_MODE:'builtin',PORT:String(port),APP_TIME_ZONE:'UTC'},stdio:['ignore','pipe','pipe']});
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
 const noScroll=async what=>assert(await ev('document.documentElement.scrollWidth<=innerWidth'),what+': no horizontal scroll');
 const shot=async name=>{if(process.env.SHOTS)(await import('node:fs')).writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))};
 const step=n=>until(()=>ev(`document.getElementById('ob-progress')?.textContent.startsWith('Step ${n} of 5')`),8000,'onboarding step '+n);
 // sign up
 await go(base+'/');assert.equal(await ev('location.pathname'),'/login');assert.match(await ev('document.body.textContent'),/New here\?/);await shot('login');
 await ev("document.querySelector('input[name=email]').value='first-time@example.com';document.querySelector('form.auth-form').requestSubmit()");
 const link=await until(()=>(log.match(/sign-in link for first-time@example\.com: (\S+)/)||[])[1],5000,'sign-up link');
 await go(link.replace(/^https?:\/\/[^/]+/,base));await ev("document.querySelector('form.auth-form').requestSubmit()");
 await until(()=>ev("location.pathname==='/welcome/passkey'"),8000,'passkey offer');await noScroll('passkey offer');await shot('passkey-offer');
 await ev("document.getElementById('pk-prompt-skip').click()");
 // notice and consent
 await until(()=>ev("location.pathname==='/consent'&&!!document.querySelector('input[name=consent]')"),8000,'consent page');await noScroll('consent');await shot('consent');
 await ev("document.querySelector('input[name=disclaimer]').click();document.querySelector('input[name=consent]').click();document.querySelector('form[action=\"/consent\"]').requestSubmit()");
 // onboarding
 await until(()=>ev("location.pathname==='/welcome'"),8000,'welcome');await step(1);await noScroll('step 1');await shot('ob1');
 await ev("(()=>{const f=document.getElementById('ob-household');f.name.value='Example Family';f.memberName.value='Alex Example';f.requestSubmit()})()");
 await step(2);await noScroll('step 2');assert.match(await ev("document.getElementById('ob-member-list').textContent"),/Alex Example/);
 await ev("(()=>{const f=document.getElementById('ob-member');f.name.value='Sam Example';f.kind.value='child';f.requestSubmit()})()");
 await until(()=>ev("document.querySelectorAll('#ob-member-list li').length===2"),5000,'child added');
 await ev("document.getElementById('ob-next').click()");
 await step(3);await noScroll('step 3');await shot('ob3');
 assert.equal(await ev("document.querySelectorAll('input[name=metric]').length"),9);
 assert.match(await ev("document.querySelector('.ob-core').textContent"),/Medicines/);
 await ev("for(const i of document.querySelectorAll('input[name=metric]'))i.checked=['weight','temperature','sleep'].includes(i.value);document.getElementById('ob-next').click()");
 await step(4);await noScroll('step 4');await shot('ob4');
 assert(await ev("document.querySelectorAll('#ob-zone option').length>50"),'time zone list');
 await ev("document.getElementById('ob-zone').value='America/Chicago';document.querySelector('input[name=weight][value=lb]').click();document.querySelector('input[name=temperature][value=F]').click();document.getElementById('ob-next').click()");
 await step(5);await noScroll('step 5');await shot('ob5');
 await ev("document.getElementById('ob-key-create').click()");
 await until(()=>ev("/^Bearer [A-Za-z0-9_-]{43}$/.test(document.getElementById('ob-key').value)"),5000,'Apple Health key');await noScroll('key shown');await shot('ob5');
 await ev("document.getElementById('ob-next').click()");
 await until(async()=>await ev("location.pathname==='/'&&!!window.APP_CONFIG"),8000,'app opens');
 assert.equal(await ev('APP_CONFIG.timeZone'),'America/Chicago');assert.equal(await ev("fetch('/api/household').then(r=>r.json()).then(j=>j.household.name)"),'Example Family');assert.equal(await ev('APP_CONFIG.members.length'),2);
 // first log entry, in pounds; only the chosen measurements are offered
 await go(base+'/#log');await until(()=>ev("!document.getElementById('log').hidden&&!!document.getElementById('f-weight')"),8000,'log view');await noScroll('log');
 assert.equal(await ev("document.getElementById('u-weight').textContent"),'lb');assert.equal(await ev("document.getElementById('u-temperature').textContent"),'°F');
 assert.equal(await ev("document.getElementById('f-steps').closest('label').hidden"),true,'steps not tracked');
 assert.equal(await ev("document.getElementById('f-spo2').closest('label').hidden"),true);
 assert.equal(await ev("document.getElementById('f-weight').closest('label').hidden"),false);
 assert.deepEqual(await ev("[...document.querySelectorAll('#log-tabs [data-tab]')].map(b=>b.dataset.tab)"),['weight','sleep','temperature']);
 await ev("document.getElementById('f-weight').value='154.3';document.getElementById('log-form').requestSubmit()");
 await until(()=>ev("/Saved 1 measurement/.test(document.getElementById('log-msg').textContent)"),5000,'saved');
 await until(()=>ev("document.querySelectorAll('#log-entries li').length===1"),5000,'entry listed');
 assert.match(await ev("document.querySelector('#log-entries li').textContent"),/154\.3 lb/);await shot('log');
 const me=await ev("fetch('/api/log').then(r=>r.json()).then(j=>j.entries.map(e=>[e.metric,e.value]))");
 assert.deepEqual(me,[['weight',70]],'stored in kilograms');
 // Settings → Your data: export is offered; deleting the account (sole owner) removes the household and signs out
 await go(base+'/#settings');await until(()=>ev("!!document.getElementById('del-open')"),8000,'your data card');await noScroll('your data');
 assert.equal(await ev("document.getElementById('data-export').getAttribute('href')"),'/api/export');
 const zipHead=await ev("fetch('/api/export').then(r=>r.arrayBuffer()).then(b=>[...new Uint8Array(b.slice(0,4))])");assert.deepEqual(zipHead,[0x50,0x4b,3,4],'a ZIP download');
 await ev("document.getElementById('del-open').click()");
 await until(()=>ev("!!document.getElementById('del-confirm')"),3000,'delete form');
 assert.match(await ev("document.getElementById('data-card').textContent"),/only owner of “Example Family”/);await noScroll('delete form');
 await ev("document.getElementById('del-confirm').value='first-time@example.com';document.getElementById('del-go').click()");
 await until(()=>ev("location.pathname==='/login'"),8000,'signed out after deletion');
 assert.equal((await fetch(base+'/api/me',{headers:{Host:`localhost:${port}`}})).status,401);
 assert.deepEqual(errors,[],'no script errors');
 console.log('PASS browser onboarding: sign up, passkey offer skipped, health data notice accepted, household + child + measurements + time zone + lb/°F + Apple Health key, first weight logged in lb (stored in kg), export download, account deletion from Settings; 390x844, no horizontal scroll.');
}finally{try{br?.kill()}catch{};try{srv?.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
