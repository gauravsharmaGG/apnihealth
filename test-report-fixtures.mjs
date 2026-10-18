// The synthetic report fixtures (scripts/make-report-fixtures.mjs; fictional data only) and the accuracy harness on
// their ideal text tokens (what a perfect PDF text extractor returns): valid PDFs, every mapped row read, nothing
// wrong ticked. test-browser-ocr.mjs runs the real extraction (pdf.js, OCR) on the same fixtures in Chrome.
// PNG renderings are checked when Chrome is available (CHROME_BIN), otherwise skipped.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {writePdfs,writePngs} from './scripts/make-report-fixtures.mjs';
import {REPORTS} from './scripts/report-fixtures/reports.mjs';
import {score} from './scripts/report-fixtures/score.mjs';
import {mapReport} from './public/labmap.mjs';
import CAT from './config/markers.default.json' with {type:'json'};
const dir=mkdtempSync(join(tmpdir(),'apni-fixtures-'));
try{
 // fixtures are fictional: the fake person and labs only, dates in 2000
 const all=JSON.stringify(REPORTS);assert(!/\b(19[0-8]\d|20[1-9]\d)\b/.test(all.replace(/01\.01\.1990|01\/01\/1990/g,'')),'dates stay in 2000');
 const pdfs=writePdfs(dir);assert.equal(pdfs.length,REPORTS.filter(r=>r.pdf).length);
 for(const f of pdfs){
  const b=readFileSync(f.pdf,'latin1');assert(b.startsWith('%PDF-1.4'));
  const sx=Number(/startxref\n(\d+)/.exec(b)[1]);assert.equal(b.slice(sx,sx+4),'xref','startxref points at the xref table');
  const offs=[...b.slice(sx).matchAll(/^(\d{10}) 00000 n $/gm)].map(m=>Number(m[1]));offs.forEach((o,i)=>assert(b.slice(o).startsWith(`${i+1} 0 obj`),`object ${i+1} offset`));
  if(spawnSync('pdftotext',['-v']).status===0){const t=spawnSync('pdftotext',['-layout',f.pdf,'-'],{encoding:'utf8'}).stdout;assert.match(t,/Synthetic test report/);assert(REPORTS.find(r=>r.id===f.id).pages[0].every(r=>t.includes(r.name)),'pdftotext reads every name')}
 }
 // accuracy on ideal tokens: the gate for text PDFs
 const results=[];
 for(const f of pdfs){
  const rep=REPORTS.find(r=>r.id===f.id),res=mapReport(f.tokens,CAT.markers,{method:'pdf-text'}),s=score(rep,res);results.push([f.id,s]);
  assert.deepEqual(s.wrongTicked,[],f.id+': no wrong value is ticked');assert.equal(s.extraTicked,0,f.id+': nothing ticked that is not in the report');
  assert(s.precisionTicked>=0.98,f.id+' precision '+s.precisionTicked);assert.equal(s.precisionHigh,1,f.id+' high-bucket precision');
  assert(s.recall>=0.9,f.id+' recall '+s.recall+' '+JSON.stringify(s.detail.filter(d=>!d.ok||!d.ticked)));
  assert(s.dateOk,f.id+' report date '+res.date);assert.equal(res.reported,rep.reported||null,f.id+' reported date');
  assert(!JSON.stringify([res.date,res.reported,res.title,res.rows.map(r=>[r.name,r.value,r.unit])]).match(/Test Person|1990/),f.id+': no patient details in the reading');
 }
 let pngNote='PNG skipped (no Chrome)';
 const chrome=process.env.CHROME_BIN||'google-chrome';
 if(spawnSync(chrome,['--version']).status===0&&typeof WebSocket!=='undefined'){
  const pngs=await writePngs(dir,{variants:['plain','rotated']});assert.equal(pngs.length,REPORTS.reduce((a,r)=>a+r.pages.length,0)*2);
  for(const p of pngs){const b=readFileSync(p.file);assert.equal(b.readUInt32BE(0),0x89504e47);assert.equal(b.readUInt32BE(16),1190,'2x width');assert.equal(b.readUInt32BE(20),1684,'2x height')}
  pngNote=`${pngs.length} PNGs rendered`;
 }
 console.log(`PASS report fixtures: ${pdfs.length} valid text PDFs (${results.map(([id,s])=>`${id} P=${s.precisionTicked} R=${s.recall}`).join(', ')}) on ideal tokens, no wrong value ticked, dates right, no patient details; ${pngNote}.`);
}finally{rmSync(dir,{recursive:true,force:true})}
