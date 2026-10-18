// Writes the synthetic lab-report fixtures (scripts/report-fixtures/reports.mjs; fictional data only) to a folder:
//   <id>.pdf               text PDF (not for Devanagari reports)
//   <id>.tokens.json       ideal text tokens of the PDF (exact positions)
//   <id>-p<n>-<variant>.png  photo-like renderings at 2x (plain, rotated, blurred, low contrast), with headless Chrome
//   <id>-scan.pdf          a scanned PDF (JPEG pages, no text) of the plain rendering
//   <id>.truth.json        what a correct reading contains
// Usage: node scripts/make-report-fixtures.mjs [outDir] [--no-png]   (default outDir: <tmp>/apnihealth-report-fixtures)
// Nothing is written into the repo; fixtures are generated on demand by tests, never committed.
import {mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {REPORTS,PHOTO_VARIANTS} from './report-fixtures/reports.mjs';
import {makePdf,makeImagePdf} from './report-fixtures/pdf.mjs';
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
// Renders every page of every report in each variant with headless Chrome (CDP), 2x device scale by default
// (1190x1684 px per A4 page, about 144 dpi: harder than a phone photo); scale 3 is closer to a phone camera.
export async function writePngs(out,{reports=REPORTS,variants=Object.keys(PHOTO_VARIANTS),chrome,format='png',scale=2}={}){
 const {launchChrome}=await import('../testlib.mjs');
 const br=await launchChrome(chrome?{chrome}:{});
 const ws=new WebSocket(br.target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
 let id=0;const wait={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait[m.id]){wait[m.id](m);delete wait[m.id]}};
 const send=(method,params={})=>new Promise(r=>{wait[++id]=r;ws.send(JSON.stringify({id,method,params}))});
 const files=[];
 try{
  await send('Page.enable');
  for(const rep of reports)for(let p=0;p<rep.pages.length;p++)for(const v of variants){
   await send('Emulation.setDeviceMetricsOverride',{width:595,height:842,deviceScaleFactor:scale,mobile:false});
   const loaded=new Promise(r=>{const prev=ws.onmessage;ws.onmessage=e=>{prev(e);const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired'){ws.onmessage=prev;r()}}});
   await send('Page.navigate',{url:'data:text/html;base64,'+Buffer.from(html(rep,p,PHOTO_VARIANTS[v])).toString('base64')});await loaded;
   await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
   const shot=await send('Page.captureScreenshot',{format,...(format==='jpeg'?{quality:85}:{}),clip:{x:0,y:0,width:595,height:842,scale:1}});
   const data=Buffer.from(shot.result.data,'base64'),file=join(out,`${rep.id}-p${p+1}-${v}${scale===2?'':'-'+scale+'x'}.${format==='jpeg'?'jpg':'png'}`);writeFileSync(file,data);files.push({id:rep.id,page:p+1,variant:v+(scale===2?'':' '+scale+'x'),file,data});
  }
 }finally{ws.close();br.proc.kill()}
 return files;
}
// Scanned PDFs (JPEG pages, 2x = 1190x1684 px per A4 page), one per report that has a text PDF.
export async function writeScans(out,{reports=REPORTS.filter(r=>r.pdf),variant='plain',chrome}={}){
 const jpgs=await writePngs(out,{reports,variants:[variant],chrome,format:'jpeg'}),files=[];
 for(const rep of reports){
  const pdf=makeImagePdf(jpgs.filter(j=>j.id===rep.id).sort((a,b)=>a.page-b.page).map(j=>({data:j.data,width:1190,height:1684})));
  const file=join(out,rep.id+'-scan.pdf');writeFileSync(file,pdf);files.push({id:rep.id,file});
 }
 return files;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const out=process.argv.slice(2).find(a=>!a.startsWith('--'))||join(tmpdir(),'apnihealth-report-fixtures');
 const pdfs=writePdfs(out);let pngs=[];
 let scans=[];if(!process.argv.includes('--no-png')){pngs=await writePngs(out);scans=await writeScans(out)}
 console.log(`Wrote ${pdfs.length} PDFs, ${scans.length} scanned PDFs and ${pngs.length} PNGs to ${out} (fictional data only).`);
}
