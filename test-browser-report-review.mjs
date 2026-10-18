// "Read values" end to end in Chrome on fictional preview data and synthetic report fixtures: the entry points
// appear only where the reader works (hidden for iOS below 16), a text PDF and a photo are read on the device,
// the review screen starts with the right rows ticked (unrecognised and low-confidence rows unticked), an
// unrecognised name is saved as a household marker, the report is linked to its upload, and the file can no
// longer be deleted while the report exists. 1280x800 and 390x844. Needs the OCR assets and Chrome.
// SHOT_DIR=dir writes ocr-desktop.png and ocr-390x844.png (synthetic data only).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import http from 'node:http';
import {startServer,launchChrome} from './testlib.mjs';
import {check} from './scripts/vendor-ocr.mjs';
import {OCR_ID} from './public/ocr-assets.mjs';
import {writePdfs,writePngs} from './scripts/make-report-fixtures.mjs';
import {REPORTS} from './scripts/report-fixtures/reports.mjs';
const chrome=process.env.CHROME_BIN||'google-chrome';
if(spawnSync(chrome,['--version']).status!==0){console.log('SKIP report review: Chrome not found (set CHROME_BIN)');process.exit(0)}
const src=new URL('.',import.meta.url).pathname;
if(check(join(src,'public/vendor/ocr',OCR_ID)).length){if(process.env.CI)throw Error('CI: OCR assets missing');console.log('SKIP report review: OCR assets not installed (node scripts/vendor-ocr.mjs)');process.exit(0)}
const dir=mkdtempSync(join(tmpdir(),'apni-review-')),fx=join(dir,'.fixtures'),shots=process.env.SHOT_DIR;
const skip=new Set(['.git','private','node_modules']);
cpSync(src,dir,{recursive:true,filter:p=>!skip.has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1',APNI_OCR_ASSETS:'skip'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let srv,br;const after=[];
try{
 assert.equal(spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env}).status,0);spawnSync('git',['init','-q'],{cwd:dir});
 assert.equal(spawnSync('python3',['build.py'],{cwd:dir,env}).status,0);
 writePdfs(fx);await writePngs(fx,{reports:REPORTS.filter(r=>r.id==='in-path'),variants:['plain']});
 const token=randomBytes(16).toString('hex');
 const {p:proc,port}=await startServer({cwd:dir,env:{...env,PREVIEW_AUTH_TOKEN:token},args:['--import','./scripts/preview/loader.mjs','server.mjs']});srv=proc;
 // The preview shim authorizes by header, which Chrome doesn't add to worker script requests (importScripts of
 // the OCR core), so the browser goes through a tiny proxy that adds it, as the preview's reverse proxy would.
 const proxy=http.createServer((req,res)=>{const up=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`,...(req.headers.origin?{origin:`http://127.0.0.1:${port}`}:{}),'x-preview-auth':token}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up)});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));after.push(()=>proxy.close());
 const base=`http://127.0.0.1:${proxy.address().port}`,H={};
 const api=async(path,opt={})=>{const r=await fetch(base+path,{...opt,headers:{...H,...(opt.body?{'Content-Type':'application/json',Origin:base}:{}),...opt.headers}});return {status:r.status,j:await r.json().catch(()=>({}))}};
 const upload=async(file,mimeType,title)=>(await api('/api/inbox?profile=alex',{method:'POST',body:JSON.stringify({category:'lab-report',date:'2000-01-20',title,fileName:file.split('/').pop(),mimeType,dataBase64:readFileSync(file).toString('base64')})})).j.item;
 const pdfItem=await upload(join(fx,'de-labor.pdf'),'application/pdf','Example lab PDF');assert(pdfItem?.id,'uploaded');
 const run=await launchChrome({chrome});br=run.proc;
 const ws=new WebSocket(run.target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const wait={},errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)
  else if(m.method==='Log.entryAdded'&&(m.params.entry.level==='error'&&m.params.entry.source!=='network'||/Content Security Policy/.test(m.params.entry.text)))errors.push(m.params.entry.text.slice(0,200))};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(x.slice(0,80)+': '+(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text));return r.result.result.value};
 const until=async(x,ms=60000,what=x)=>{const t=Date.now();for(;;){if(await ev(x))return;if(Date.now()-t>ms)throw Error('timed out: '+what+' | dialog: '+(await ev(`document.querySelector('#rr-dialog .rr-body')?.textContent.slice(0,300)||''`))+' | errors: '+errors.join(' / '));await sleep(150)}};
 const shot=async name=>{if(!shots)return;const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,name),Buffer.from(s.result.data,'base64'))};
 await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Page.enable');
 await send('Network.setBypassServiceWorker',{bypass:true});await send('Network.setExtraHTTPHeaders',{headers:H});
 const go=async(w,h,mobile,hash)=>{await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:mobile?2:1,mobile});await send('Page.navigate',{url:base+'/?p=alex'});await sleep(1200);await ev(`localStorage.setItem('profile','alex')`);await send('Page.navigate',{url:base+'/?p=alex'+hash});await sleep(1500)};

 // iOS 15: no WebAssembly under the CSP, so no entry points at all
 await send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'});
 await go(390,844,true,'#records');
 await until(`!!document.querySelector('[data-read-report]')`,10000,'inbox list');await sleep(500);
 assert(await ev(`document.querySelector('[data-read-report]').hidden`),'iOS 15: Read values hidden');
 await ev(`location.hash='#measurements'`);await sleep(800);assert(await ev(`!document.querySelector('#lab-import')||document.querySelector('#lab-import').hidden`),'iOS 15: no import button');
 await send('Emulation.setUserAgentOverride',{userAgent:''});

 // desktop: the text PDF from Records
 await go(1280,800,false,'#records');
 await until(`(b=>b&&!b.hidden)(document.querySelector('[data-read-report="${pdfItem.id}"]'))`,15000,'Read values button');
 await ev(`document.querySelector('[data-read-report="${pdfItem.id}"]').click()`);
 await until(`document.querySelectorAll('#rr-dialog .rr-row').length>0`,60000,'review rows');await sleep(400);
 const rows=await ev(`[...document.querySelectorAll('#rr-dialog .rr-row')].map(li=>({name:li.querySelector('.rr-name').textContent,on:li.querySelector('[data-k=include]').checked,cls:li.className}))`);
 const exotic=rows.find(r=>/Exotischer/.test(r.name));assert(exotic&&!exotic.on&&/rr-new/.test(exotic.cls),'unrecognised row starts unticked');
 assert(rows.filter(r=>r.on).length>=15,'recognised rows are ticked');
 assert.equal(await ev(`document.querySelector('#rr-dialog [data-meta=date]').value`),'2000-01-12','report date from the report');
 assert.match(await ev(`document.querySelector('#rr-dialog .rr-note').textContent`),/PDF’s text/);
 assert(await ev(`!!document.querySelector('#rr-dialog a[href*="/api/inbox/${pdfItem.id}/file"]')`),'link to the original');
 await shot('ocr-desktop.png');
 // the unrecognised name becomes a household marker; save
 const xi=await ev(`[...document.querySelectorAll('#rr-dialog .rr-row')].find(li=>/Exotischer/.test(li.textContent)).dataset.i`);
 await ev(`(s=>{s.value='custom';s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('#rr-dialog .rr-row[data-i="${xi}"] [data-k=choice]'))`);await sleep(200);
 assert(await ev(`document.querySelector('#rr-dialog .rr-row[data-i="${xi}"] [data-k=include]').checked`),'choosing "new marker" ticks the row');
 const n=await ev(`document.querySelectorAll('#rr-dialog [data-k=include]:checked').length`);
 assert.equal(await ev(`document.querySelector('#rr-dialog .rr-actions .primary').textContent`),`Save ${n} values`);
 await ev(`document.querySelector('#rr-dialog .rr-actions .primary').click()`);
 await until(`!document.querySelector('#rr-dialog').open`,15000,'dialog closes after saving');
 const labs=(await api('/api/labs?profile=alex')).j,rep=labs.reports.find(r=>r.uploadId===pdfItem.id);
 assert(rep,'report linked to the upload');assert.equal(rep.count,n);
 const inbox=(await api('/api/inbox?profile=alex')).j.items.find(i=>i.id===pdfItem.id);assert.equal(inbox.status,'imported');assert.equal(inbox.labReportId,rep.id);
 assert((await api('/api/labs/catalog?profile=alex')).j.markers.some(m=>m.name==='Exotischer Testwert'&&m.custom),'household marker saved');
 await until(`!document.querySelector('[data-read-report="${pdfItem.id}"]')`,5000,'Read values gone after import');
 // the file can't be deleted while the report exists: the server's reason is shown
 await ev(`window.__alerts=[];window.alert=m=>__alerts.push(m);window.confirm=()=>true`);
 await ev(`document.querySelector('[data-delbox="${pdfItem.id}"]').click()`);await until(`__alerts.length>0`,5000,'delete refused');
 assert.match(await ev('__alerts[0]'),/Delete that report first/);
 // reading the same file again says so
 await ev(`location.hash='#measurements'`);await until(`(b=>b&&!b.hidden)(document.querySelector('#lab-import'))`,10000,'Import from a report');
 assert(await ev(`!!document.querySelector('#lab-report-list a[href*="/api/inbox/${pdfItem.id}/file"]')`),'report list links the original');

 // phone: a photo (OCR) from Records
 const pngItem=await upload(join(fx,'in-path-p1-plain.png'),'image/png','Example lab photo');
 await go(390,844,true,'#records');
 await until(`(b=>b&&!b.hidden)(document.querySelector('[data-read-report="${pngItem.id}"]'))`,15000,'Read values on the photo');
 await ev(`document.querySelector('[data-read-report="${pngItem.id}"]').click()`);
 await until(`document.querySelectorAll('#rr-dialog .rr-row').length>0`,120000,'OCR review rows');await sleep(500);
 assert.match(await ev(`document.querySelector('#rr-dialog .rr-note').textContent`),/text recognition/);
 assert(await ev(`!!document.querySelector('#rr-dialog [data-rr=hindi]')`),'Hindi on request');
 assert(!(await ev(`(d=>d.scrollWidth>d.clientWidth+1)(document.querySelector('#rr-dialog'))`)),'no horizontal scroll at 390');
 assert(await ev(`document.querySelector('#rr-dialog').getBoundingClientRect().width<=390`));
 await shot('ocr-390x844.png');
 await ev(`document.querySelector('#rr-dialog .rr-rows').scrollIntoView()`);await sleep(200);await shot('ocr-390x844-rows.png');
 await ev(`document.querySelector('#rr-dialog [data-rr=close]').click()`);await sleep(300);
 assert.equal((await api('/api/labs?profile=alex')).j.reports.filter(r=>r.uploadId===pngItem.id).length,0,'cancel saves nothing');
 assert.deepEqual(errors,[],'no script or CSP errors');
 console.log('PASS report review: entry points hidden on iOS 15, text PDF read and saved with a household marker and the upload linked, delete refused with the reason, photo read by OCR at 390x844 with Hindi on request, cancel saves nothing.');
}finally{for(const f of after)try{f()}catch{};try{br?.kill()}catch{};try{srv?.kill()}catch{};rmSync(dir,{recursive:true,force:true})}
