// Writes the synthetic lab-report fixtures (scripts/report-fixtures/reports.mjs; fictional data only) to a folder:
//   <id>.pdf               text PDF (not for Devanagari reports)
//   <id>.tokens.json       ideal text tokens of the PDF (exact positions)
//   <id>-p<n>-<variant>.png  photo-like renderings at 2x (plain, rotated, blurred, low contrast), with headless Chrome
//   <id>.truth.json        what a correct reading contains
// Usage: node scripts/make-report-fixtures.mjs [outDir] [--no-png]   (default outDir: <tmp>/apnihealth-report-fixtures)
// Nothing is written into the repo; fixtures are generated on demand by tests, never committed.
import {mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {REPORTS,PHOTO_VARIANTS} from './report-fixtures/reports.mjs';
import {makePdf} from './report-fixtures/pdf.mjs';
import {items,html} from './report-fixtures/layout.mjs';

export function writePdfs(out,reports=REPORTS){
 mkdirSync(out,{recursive:true});const files=[];
 for(const rep of reports){
  writeFileSync(join(out,rep.id+'.truth.json'),JSON.stringify({id:rep.id,date:rep.date,reported:rep.reported||null,rows:rep.pages.flat().map(r=>({name:r.name,...r.want}))},null,1));
  if(!rep.pdf)continue;
  const {pdf,tokens}=makePdf(items(rep));
  writeFileSync(join(out,rep.id+'.pdf'),pdf);writeFileSync(join(out,rep.id+'.tokens.json'),JSON.stringify(tokens));
  files.push({id:rep.id,pdf:join(out,rep.id+'.pdf'),tokens});
 }
 return files;
}
// Renders every page of every report in each variant with headless Chrome (CDP), 2x device scale.
export async function writePngs(out,{reports=REPORTS,variants=Object.keys(PHOTO_VARIANTS),chrome}={}){
 const {launchChrome}=await import('../testlib.mjs');
 const br=await launchChrome(chrome?{chrome}:{});
 const ws=new WebSocket(br.target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
 let id=0;const wait={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const files=[];
 try{
  await send('Page.enable');
  for(const rep of reports)for(let p=0;p<rep.pages.length;p++)for(const v of variants){
   await send('Emulation.setDeviceMetricsOverride',{width:595,height:842,deviceScaleFactor:2,mobile:false});
   const loaded=new Promise(r=>{const prev=ws.onmessage;ws.onmessage=e=>{prev(e);const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired'){ws.onmessage=prev;r()}}});
   await send('Page.navigate',{url:'data:text/html;base64,'+Buffer.from(html(rep,p,PHOTO_VARIANTS[v])).toString('base64')});await loaded;
   await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
   const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:595,height:842,scale:1}});
   const file=join(out,`${rep.id}-p${p+1}-${v}.png`);writeFileSync(file,Buffer.from(shot.result.data,'base64'));files.push({id:rep.id,page:p+1,variant:v,file});
  }
 }finally{ws.close();br.proc.kill()}
 return files;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const out=process.argv.slice(2).find(a=>!a.startsWith('--'))||join(tmpdir(),'apnihealth-report-fixtures');
 const pdfs=writePdfs(out);let pngs=[];
 if(!process.argv.includes('--no-png'))pngs=await writePngs(out);
 console.log(`Wrote ${pdfs.length} PDFs and ${pngs.length} PNGs to ${out} (fictional data only).`);
}
