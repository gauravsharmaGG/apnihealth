// Reading a lab report on the device (plan: docs/plans/report-ocr.md, PR 6): a PDF's own text with pdf.js, or OCR
// with tesseract.js for photos and scanned pages. Returns positioned word tokens for labmap.mjs; nothing leaves the
// device and nothing is saved here. The heavy work runs in the libraries' own workers (pdf.js worker, tesseract
// worker with WebAssembly), so this coordinator stays on the page: it only renders pages to a canvas and hands
// them over. Files come from public/vendor/ocr/<id>/ (scripts/vendor-ocr.mjs); the app page's CSP allows wasm.
import {OCR_BASE,PATHS} from './ocr-assets.mjs';

export const MAX_PAGES=10;            // per run; the review screen says when pages were skipped
export const DEFAULT_LANGS=['eng','deu'];
const MIN_TEXT_CHARS=40;              // a PDF page with less text than this is treated as a scan and OCR'd
const OCR_LONG_SIDE=[2000,3000];      // images are scaled so the long side lands in this range (memory vs accuracy)
const PSM='6';                        // one uniform block: best on the table fixtures (measured against 4 and 11)
// Measured on the fixtures: a long side of 2000-3000 px beats 1000-1400 clearly; 3000-3400 and other dpi hints
// changed nothing.

const url=p=>new URL(OCR_BASE+p,location.href).href;

// Whether this browser can run the reader: WebAssembly allowed by the page's CSP (a tiny module compiled
// synchronously), module workers, createImageBitmap and canvas. iOS below 16 can't (no 'wasm-unsafe-eval').
export function supported(){
 try{
  if(typeof WebAssembly!=='object'||typeof Worker!=='function'||typeof createImageBitmap!=='function')return false;
  new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0));
  const ios=/(?:iPhone|iPad|iPod).*? OS (\d+)_/.exec(navigator.userAgent);if(ios&&Number(ios[1])<16)return false;
  return !!document.createElement('canvas').getContext;
 }catch{return false}
}
// Whether the server has the files (an instance built without network may not).
export async function available(){
 try{const r=await fetch(url(PATHS.tesseractWorker),{method:'HEAD',credentials:'same-origin'});return r.ok}catch{return false}
}

let pdfjsP=null;
const pdfjs=()=>pdfjsP||(pdfjsP=import(url(PATHS.pdf)).then(m=>{m.GlobalWorkerOptions.workerSrc=url(PATHS.pdfWorker);return m}));

// One tesseract worker per run, created on first need and terminated at the end (frees the wasm memory).
function ocrEngine(langs,progress,psm=PSM,params={}){
 let w=null;
 return {
  async recognize(canvas){
   if(!w){
    const T=(await import(url(PATHS.tesseract))).default;
    w=await T.createWorker(langs,1,{workerPath:url(PATHS.tesseractWorker),corePath:url(PATHS.core),langPath:url(PATHS.lang).replace(/\/$/,''),
     workerBlobURL:false,gzip:true,cacheMethod:'none',logger:m=>progress?.({stage:m.status==='recognizing text'?'ocr':'loading',progress:m.progress||0})});
    await w.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1',user_defined_dpi:'300',...params});
   }
   return (await w.recognize(canvas,{},{blocks:true,text:false,hocr:false,tsv:false})).data;
  },
  async end(){if(w){const x=w;w=null;await x.terminate()}},
 };
}

// tesseract result -> word tokens. A photo is rarely straight: the median baseline slope of the long lines gives
// the skew, and word boxes are rotated back so that one table row has one y (labmap groups rows by y).
export function ocrTokens(data,page){
 const lines=(data.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines));
 const slopes=lines.map(l=>l.baseline).filter(b=>b&&b.x1-b.x0>100).map(b=>(b.y1-b.y0)/(b.x1-b.x0)).sort((a,b)=>a-b);
 const slope=slopes.length?slopes[slopes.length>>1]:0,a=-Math.atan(slope),cos=Math.cos(a),sin=Math.sin(a);
 const rot=(x,y)=>[x*cos-y*sin,x*sin+y*cos];
 const out=[];
 for(const l of lines)for(const w of l.words){
  const t=w.text.trim();if(!t)continue;
  const {x0,y0,x1,y1}=w.bbox,[cx,cy]=rot((x0+x1)/2,(y0+y1)/2),hw=(x1-x0)/2,hh=(y1-y0)/2;
  out.push({text:t,x0:cx-hw,x1:cx+hw,y0:cy-hh,y1:cy+hh,page,conf:Math.max(0,Math.min(1,(w.confidence??0)/100))});
 }
 return {tokens:out,skew:Math.round(Math.atan(slope)*1800/Math.PI)/10};
}

// pdf.js text items -> word tokens in top-down page points (items are runs of text; split them at spaces).
export function pdfTokens(items,viewport,page){
 const out=[];
 for(const it of items){
  const s=it.str;if(!s||!s.trim())continue;
  const [x,y]=viewport.convertToViewportPoint(it.transform[4],it.transform[5]);
  const h=Math.hypot(it.transform[2],it.transform[3])||it.height||10,cw=(it.width||0)/Math.max(1,s.length);
  let i=0;for(const part of s.split(/(\s+)/)){if(part.trim())out.push({text:part,x0:x+i*cw,x1:x+(i+part.length)*cw,y0:y-h*0.75,y1:y+h*0.2,page,conf:1});i+=part.length}
 }
 return out;
}

function canvasFor(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
const release=c=>{c.width=c.height=0};
const fit=(w,h,[lo,hi]=OCR_LONG_SIDE)=>{const long=Math.max(w,h);const s=long>hi?hi/long:long<lo?Math.min(2,lo/long):1;return s};

// file: a Blob/File (PDF, JPG, PNG, WebP; HEIC where the browser decodes it). psm, longSide and params (extra
// tesseract parameters) are for experiments (test-browser-ocr.mjs OCR_OPTS); the defaults are the measured best. Returns
// {tokens, method: 'pdf-text'|'ocr', pages, read, skippedPages, ocrPages, skew:[deg per OCR page]}.
export async function extract(file,{langs=DEFAULT_LANGS,onProgress,signal,maxPages=MAX_PAGES,psm=PSM,longSide=OCR_LONG_SIDE,params}={}){
 const check=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError')};
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
 const ocr=ocrEngine(langs,onProgress,psm,params);
 const tokens=[],ocrPages=[],skew=[];let pages=1,read=0;
 try{
  if(isPdf){
   const lib=await pdfjs();check();
   const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),wasmUrl:url(PATHS.pdfWasm),isEvalSupported:false,enableXfa:false,useWorkerFetch:false,disableFontFace:false}),doc=await task.promise;
   try{
    pages=doc.numPages;
    for(let n=1;n<=Math.min(pages,maxPages);n++){
     check();onProgress?.({stage:'page',page:n,pages:Math.min(pages,maxPages)});
     const page=await doc.getPage(n),vp=page.getViewport({scale:1});
     const text=pdfTokens((await page.getTextContent()).items,vp,n);
     if(text.reduce((a,t)=>a+t.text.length,0)>=MIN_TEXT_CHARS){tokens.push(...text);read++;page.cleanup();continue}
     // a scanned page: render it and OCR the image
     const base=3,s=base*fit(vp.width*base,vp.height*base,longSide),v=page.getViewport({scale:s}),c=canvasFor(v.width,v.height);
     const ctx=c.getContext('2d',{willReadFrequently:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
     await page.render({canvasContext:ctx,viewport:v}).promise;page.cleanup();check();
     const r=ocrTokens(await ocr.recognize(c),n);release(c);tokens.push(...r.tokens);ocrPages.push(n);skew.push(r.skew);read++;
    }
   }finally{await task.destroy()}
  }else{
   let bmp;
   try{bmp=await createImageBitmap(file)}catch{throw Error('This image format can\'t be read in this browser. Try a JPG or PNG.')}
   const s=fit(bmp.width,bmp.height,longSide),c=canvasFor(bmp.width*s,bmp.height*s),ctx=c.getContext('2d');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bmp,0,0,c.width,c.height);bmp.close?.();check();
   onProgress?.({stage:'page',page:1,pages:1});
   const r=ocrTokens(await ocr.recognize(c),1);release(c);tokens.push(...r.tokens);ocrPages.push(1);skew.push(r.skew);read=1;
  }
 }finally{await ocr.end()}
 return {tokens,method:ocrPages.length?'ocr':'pdf-text',pages,read,skippedPages:Math.max(0,pages-maxPages),ocrPages,skew};
}
