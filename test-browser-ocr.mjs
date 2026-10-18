// Reading reports in a real browser (headless Chrome) on the synthetic fixtures (fictional data only): pdf.js text,
// scanned PDFs and photo-like PNGs through tesseract.js, all from the vendored files under the app page's real CSP
// (http.mjs appHeaders / vendorHeaders), then labmap and the field-level scorer. Prints the measured accuracy per
// fixture and fails on any CSP violation, a text PDF below the ideal-token result, or OCR below the floors below.
// Needs the OCR assets (node scripts/vendor-ocr.mjs) and Chrome (CHROME_BIN). No OCR text is printed, only scores.
// Run: CHROME_BIN=google-chrome node test-browser-ocr.mjs [--all]   (--all: every photo variant, slower)
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,readFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,extname,resolve} from 'node:path';
import {headers,appHeaders,vendorHeaders,mime} from './http.mjs';
import {launchChrome} from './testlib.mjs';
import {check} from './scripts/vendor-ocr.mjs';
import {OCR_ID} from './public/ocr-assets.mjs';
import {writePdfs,writePngs,writeScans} from './scripts/make-report-fixtures.mjs';
import {REPORTS,PHOTO_VARIANTS} from './scripts/report-fixtures/reports.mjs';
import {score} from './scripts/report-fixtures/score.mjs';
import CAT from './config/markers.default.json' with {type:'json'};

const root=new URL('.',import.meta.url).pathname,pub=join(root,'public');
const missing=check(join(pub,'vendor/ocr',OCR_ID));
if(missing.length){
 if(process.env.CI)throw Error('CI: OCR assets missing: '+missing.join('; '));
 console.log('SKIP browser OCR: assets not installed (node scripts/vendor-ocr.mjs)');process.exit(0);
}
const all=process.argv.includes('--all'),OPTS=JSON.parse(process.env.OCR_OPTS||'{}'); // OCR_OPTS: experiments (psm, longSide)
// Floors for OCR, from the first measurements on the build box and on the CI runner. The photo-like PNGs are
// rendered with the machine's system fonts, so OCR results differ between machines (the CI runner has no
// Devanagari font, so hi-mixed renders as boxes there and its recall is reported, not gated). Gated per case:
// high-bucket precision and at most two wrong-but-ticked rows; recall only as the mean over the Latin-script
// cases. Known miss: "2.5 lakhs/cumm" with range "1.5 - 4.5" read as 25 and 15-45 (both lose the point, so
// nothing looks wrong); the review screen is where that gets caught.
const FLOORS={precisionHigh:0.85,wrongTicked:2,meanRecall:0.6};
const dir=mkdtempSync(join(tmpdir(),'apni-ocr-'));
const HTML='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OCR test</title><script type="module" src="/ocr-harness.mjs"></script></head><body><p>OCR test</p></body></html>';
const HARNESS=`import {extract,supported,available} from '/report-extract.mjs';
import {mapReport} from '/labmap.mjs';
const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective+' '+e.blockedURI));
let cat=null;
window.ocrEnv=async()=>({supported:supported(),available:await available(),violations});
window.ocrRun=async(name,langs,opts={})=>{
 cat??=(await (await fetch('/catalog')).json()).markers;
 const b=await (await fetch('/fixtures/'+name)).blob(),f=new File([b],name,{type:b.type});
 const t0=performance.now(),r=await extract(f,{langs,...opts}),ms=Math.round(performance.now()-t0);
 const m=mapReport(r.tokens,cat,{method:r.method});
 return {ms,method:r.method,read:r.read,pages:r.pages,ocrPages:r.ocrPages,skew:r.skew,date:m.date,reported:m.reported,
  rows:m.rows.map(x=>({name:x.name,marker:x.marker,num:x.num,flag:x.flag,include:x.include,bucket:x.bucket,line:x.line,issues:x.issues,conf:x.conf})),violations:[...violations]};
};
window.ocrReady=true;`;
const types={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
 const send=(code,h,body)=>{res.writeHead(code,h);res.end(body)};
 if(path==='/')return send(200,{...appHeaders,'Content-Type':mime['.html']},HTML);
 if(path==='/ocr-harness.mjs')return send(200,{...headers,'Content-Type':mime['.mjs']},HARNESS);
 if(path==='/catalog')return send(200,{...headers,'Content-Type':'application/json'},JSON.stringify(CAT));
 if(path.startsWith('/fixtures/')){const f=resolve(dir,path.slice(10));if(!f.startsWith(dir+'/')||!existsSync(f))return send(404,headers,'');return send(200,{...headers,'Content-Type':types[extname(f)]||'application/octet-stream'},readFileSync(f))}
 const f=resolve(pub,'.'+path),ext=extname(f);
 if(!f.startsWith(pub+'/')||!mime[ext]||!existsSync(f)||!statSync(f).isFile())return send(404,headers,'Not found');
 send(200,{...(path.startsWith('/vendor/ocr/')?vendorHeaders:headers),'Content-Type':mime[ext]},readFileSync(f));
});
let br,ws;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const pdfs=writePdfs(dir),scans=await writeScans(dir),pngs=[...await writePngs(dir,{variants:all?Object.keys(PHOTO_VARIANTS):['plain','rotated','lowcontrast']}),...await writePngs(dir,{variants:['plain'],scale:3})];
 br=await launchChrome();
 ws=new WebSocket(br.target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
 let id=0;const wait={},logs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}
  if(m.method==='Runtime.exceptionThrown')logs.push('exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).slice(0,300));
  if(m.method==='Log.entryAdded'&&/Content Security Policy|Refused/i.test(m.params.entry.text))logs.push('csp: '+m.params.entry.text.slice(0,300))};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:600000});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result.result.value};
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
 await send('Page.navigate',{url:base+'/'});
 for(let i=0;i<200&&!(await evaluate('!!window.ocrReady'));i++)await new Promise(r=>setTimeout(r,50));
 const env=await evaluate('ocrEnv()');assert(env.supported,'Chrome supports the reader under the CSP');assert(env.available,'assets are served');
 const cases=[
  ...pdfs.map(p=>({file:p.id+'.pdf',id:p.id,kind:'text PDF'})),
  ...scans.map(s=>({file:s.id+'-scan.pdf',id:s.id,kind:'scanned PDF'})),
  // photos: every page of a report is a separate image; scored per report over its pages
  ...[...new Set(pngs.map(p=>p.id+'|'+p.variant))].map(k=>{const [rid,v]=k.split('|');return {files:pngs.filter(p=>p.id===rid&&p.variant===v).sort((a,b)=>a.page-b.page).map(p=>p.file.split('/').pop()),id:rid,kind:'photo '+v}}),
 ];
 const results=[];
 for(const c of cases){
  const rep=REPORTS.find(r=>r.id===c.id),langs=rep.lang==='hin'?['eng','hin']:['eng','deu']; // Hindi only on request, as in the app
  let out;
  if(c.file)out=await evaluate(`ocrRun(${JSON.stringify(c.file)},${JSON.stringify(langs)},${JSON.stringify(OPTS)})`);
  else{ // one image per page: merge rows of all pages (dates from the first page)
   const parts=[];for(const f of c.files)parts.push(await evaluate(`ocrRun(${JSON.stringify(f)},${JSON.stringify(langs)},${JSON.stringify(OPTS)})`));
   out={...parts[0],ms:parts.reduce((a,p)=>a+p.ms,0),rows:parts.flatMap(p=>p.rows),skew:parts.flatMap(p=>p.skew),violations:parts.at(-1).violations};
  }
  const s=score(rep,out);
  results.push({...c,s,out});
  console.log(`${c.kind.padEnd(18)} ${c.id.padEnd(9)} ${out.method.padEnd(8)} P(ticked)=${s.precisionTicked} P(high)=${s.precisionHigh} R=${s.recall} wrongTicked=${s.wrongTicked.length} extra=${s.extraTicked} date=${s.dateOk?'ok':'no'} ${out.ms} ms${out.skew?.length?' skew='+out.skew.join('/'):''}`);
  if(process.argv.includes('--debug'))for(const d of s.detail.filter(d=>!d.ok||!d.ticked))console.log('   ',JSON.stringify(d),'|',JSON.stringify(out.rows.find(r=>r.name&&r.name.toLowerCase()===d.name.toLowerCase())?.line||null)); // fictional fixtures only
  if(process.argv.includes('--debug'))console.log('    rows:',JSON.stringify(out.rows.map(r=>[r.line,r.marker,r.bucket,r.issues.join(',')])));
  assert.deepEqual(out.violations,[],'no CSP violations');
 }
 assert.deepEqual(logs.filter(l=>l.startsWith('csp')),[],'no CSP errors in the console');
 // text PDFs through pdf.js: as good as the ideal tokens (test-report-fixtures.mjs)
 for(const r of results.filter(r=>r.kind==='text PDF')){
  assert.equal(r.out.method,'pdf-text');assert.deepEqual(r.s.wrongTicked,[],r.id);assert.equal(r.s.extraTicked,0,r.id);assert.equal(r.s.precisionHigh,1,r.id);assert(r.s.recall>=0.9,r.id+' recall');assert(r.s.dateOk,r.id+' date');
 }
 // OCR floors (measured on these fixtures, see the PR): high-bucket precision and recall per kind
 for(const r of results.filter(r=>r.kind!=='text PDF')){
  assert.equal(r.out.method,'ocr',r.id+' '+r.kind);
  const f=FLOORS;
  assert(r.s.precisionHigh>=f.precisionHigh,`${r.kind} ${r.id}: high-bucket precision ${r.s.precisionHigh} < ${f.precisionHigh} ${JSON.stringify(r.s.wrongTicked)}`);
  assert(r.s.wrongTicked.length<=f.wrongTicked,`${r.kind} ${r.id}: ${r.s.wrongTicked.length} wrong values ticked`);
 }
 const ocr=results.filter(r=>r.kind!=='text PDF'),tick=ocr.reduce((a,r)=>a+r.s.wrongTicked.length,0);
 const latin=ocr.filter(r=>REPORTS.find(x=>x.id===r.id).lang!=='hin'),meanRecall=Math.round(latin.reduce((a,r)=>a+r.s.recall,0)/latin.length*1000)/1000;
 console.log(`OCR mean recall (Latin-script cases): ${meanRecall}`);assert(meanRecall>=FLOORS.meanRecall,`OCR mean recall ${meanRecall} < ${FLOORS.meanRecall}`);
 console.log(`PASS browser OCR: ${results.length} cases under the app CSP, no violations; text PDFs as ideal; OCR wrong-but-ticked rows: ${tick} over ${ocr.length} cases.`);
}finally{try{ws?.close()}catch{};try{br?.proc.kill()}catch{};server.close();rmSync(dir,{recursive:true,force:true})}
