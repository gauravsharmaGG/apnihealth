// Reads an Apple Health "Export All Health Data" file (export.zip or export.xml) ON THE DEVICE and reduces it to daily values.
// Nothing but the small daily summary is ever uploaded. Streams the XML, so multi-gigabyte exports don't need much memory.
(function(root){
const HK={
 HKQuantityTypeIdentifierStepCount:'steps',HKQuantityTypeIdentifierBodyMass:'weight',HKQuantityTypeIdentifierRestingHeartRate:'resting_hr',
 HKQuantityTypeIdentifierBodyFatPercentage:'body_fat',HKQuantityTypeIdentifierBloodPressureSystolic:'bp_sys',HKQuantityTypeIdentifierBloodPressureDiastolic:'bp_dia',
 HKCategoryTypeIdentifierSleepAnalysis:'sleep',HKQuantityTypeIdentifierOxygenSaturation:'spo2',
 HKQuantityTypeIdentifierHeartRateVariabilitySDNN:'hrv',HKQuantityTypeIdentifierBodyTemperature:'temperature'};
const attr=(s,n)=>{const i=s.indexOf(' '+n+'="');if(i<0)return '';const a=i+n.length+3,b=s.indexOf('"',a);return b<0?'':s.slice(a,b)};
const toMs=s=>s.length>=25?Date.parse(s.slice(0,10)+'T'+s.slice(11,19)+s.slice(20,23)+':'+s.slice(23,25)):Date.parse(s.slice(0,10)+'T'+s.slice(11,19));
const r1=v=>Math.round(v*10)/10;
// ---- aggregation ----
function aggregator({since=''}={}){
 const steps=new Map(),weight=new Map(),rhr=new Map(),fat=new Map(),sys=new Map(),dia=new Map(),sleep=new Map(),spo2=new Map(),hrv=new Map(),temp=new Map();let seen=0;
 const avg=(m,d,v)=>{const a=m.get(d);if(a){a.s+=v;a.n++}else m.set(d,{s:v,n:1})};
 const latest=(m,d,t,v)=>{const a=m.get(d);if(!a||t>a.t)m.set(d,{t,v})};
 return {
  add(tag){
   const m=HK[attr(tag,'type')];if(!m)return;
   const start=attr(tag,'startDate'),end=attr(tag,'endDate')||start,val=attr(tag,'value');if(start.length<19)return;
   const day=m==='sleep'?end.slice(0,10):start.slice(0,10);if(since&&day<since)return;
   seen++;
   if(m==='sleep'){if(!val.includes('Asleep'))return;const s=toMs(start),e=toMs(end);if(!(e>s))return;let a=sleep.get(day);if(!a)sleep.set(day,a=[]);a.push([s,e]);return}
   const q=Number(val);if(!Number.isFinite(q))return;
   if(m==='steps'){const src=attr(tag,'sourceName'),h=Number(start.slice(11,13))||0;let d=steps.get(day);if(!d)steps.set(day,d=new Map());let a=d.get(src);if(!a)d.set(src,a=new Float64Array(24));a[h]+=q}
   else if(m==='weight'){const u=attr(tag,'unit');latest(weight,day,start,u==='lb'?q*0.45359237:u==='g'?q/1000:q)}
   else if(m==='resting_hr')avg(rhr,day,q);
   else if(m==='body_fat')latest(fat,day,start,q<=1?q*100:q);
   else if(m==='bp_sys')avg(sys,day,q);else if(m==='bp_dia')avg(dia,day,q);
   else if(m==='spo2')avg(spo2,day,q<=1?q*100:q);else if(m==='hrv')avg(hrv,day,q);
   else if(m==='temperature')latest(temp,day,start,attr(tag,'unit')==='degF'?(q-32)*5/9:q);
  },
  finish(){
   const out=[],push=(date,metric,value)=>{if(Number.isFinite(value))out.push({date,metric,value})};
   // Steps: iPhone and Watch both record them, so per hour take the larger source instead of adding them together.
   for(const [d,srcs] of steps){let t=0;for(let h=0;h<24;h++){let mx=0;for(const a of srcs.values())if(a[h]>mx)mx=a[h];t+=mx}if(t>0)push(d,'steps',Math.round(t))}
   for(const [d,a] of weight)push(d,'weight',r1(a.v));
   for(const [d,a] of rhr)push(d,'resting_hr',Math.round(a.s/a.n));
   for(const [d,a] of fat)push(d,'body_fat',r1(a.v));
   for(const [d,a] of sys)push(d,'bp_sys',Math.round(a.s/a.n));
   for(const [d,a] of dia)push(d,'bp_dia',Math.round(a.s/a.n));
   for(const [d,a] of spo2)push(d,'spo2',Math.round(a.s/a.n));
   for(const [d,a] of hrv)push(d,'hrv',Math.round(a.s/a.n));
   for(const [d,a] of temp)push(d,'temperature',r1(a.v));
   // Sleep: union of all "asleep" intervals for the night (several sources overlap), dated by the morning you woke.
   for(const [d,iv] of sleep){iv.sort((x,y)=>x[0]-y[0]);let tot=0,cs=iv[0][0],ce=iv[0][1];for(let i=1;i<iv.length;i++){if(iv[i][0]<=ce){if(iv[i][1]>ce)ce=iv[i][1]}else{tot+=ce-cs;cs=iv[i][0];ce=iv[i][1]}}tot+=ce-cs;const h=tot/36e5;if(h>=0.5&&h<=24)push(d,'sleep',r1(h))}
   out.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.metric<b.metric?-1:1);
   const by={};for(const e of out){const x=by[e.metric]||(by[e.metric]={n:0,from:e.date,to:e.date});x.n++;if(e.date<x.from)x.from=e.date;if(e.date>x.to)x.to=e.date}
   return {entries:out,summary:by,recordsRead:seen};
  }};
}
// ---- streaming XML scan ----
async function scanXml(stream,agg,{onChars,signal}={}){
 const dec=new TextDecoder('utf-8'),reader=stream.getReader(),re=/<Record\b[^>]*>/g;let buf='',total=0;
 for(;;){
  if(signal?.aborted)throw Object.assign(Error('Cancelled'),{cancelled:true});
  const {done,value}=await reader.read();
  buf+=dec.decode(value||new Uint8Array(),{stream:!done});total+=value?value.length:0;
  re.lastIndex=0;let end=0,m;
  while((m=re.exec(buf))){agg.add(m[0]);end=re.lastIndex}
  const k=buf.lastIndexOf('<Record');buf=k>=end?buf.slice(k):buf.slice(Math.max(end,buf.length-8));
  onChars?.(total);
  if(done)break;
 }
}
// ---- zip: locate export.xml and stream it (handles zip64 for multi-gigabyte exports) ----
async function exportXmlStream(file,onBytes){
 if(/\.xml$/i.test(file.name||'')){let n=0;return {total:file.size,stream:file.stream().pipeThrough(new TransformStream({transform(c,ctl){n+=c.byteLength;onBytes?.(n);ctl.enqueue(c)}}))}}
 const size=file.size,tailLen=Math.min(size,65535+22+20);
 const tail=new DataView(await file.slice(size-tailLen,size).arrayBuffer());let e=-1;
 for(let i=tailLen-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50){e=i;break}
 if(e<0)throw Error('This does not look like a zip file. Choose the export.zip from the Health app.');
 let n=tail.getUint16(e+10,true),cdSize=tail.getUint32(e+12,true),cdOff=tail.getUint32(e+16,true);
 if(cdOff===0xFFFFFFFF||cdSize===0xFFFFFFFF||n===0xFFFF){
  const l=e-20;if(l<0||tail.getUint32(l,true)!==0x07064b50)throw Error('Unsupported zip layout');
  const zo=Number(tail.getBigUint64(l+8,true)),z=new DataView(await file.slice(zo,zo+56).arrayBuffer());
  if(z.getUint32(0,true)!==0x06064b50)throw Error('Unsupported zip layout');n=Number(z.getBigUint64(32,true));cdSize=Number(z.getBigUint64(40,true));cdOff=Number(z.getBigUint64(48,true));
 }
 const cd=new DataView(await file.slice(cdOff,cdOff+cdSize).arrayBuffer()),td=new TextDecoder();let p=0,hit=null;
 while(p+46<=cd.byteLength&&cd.getUint32(p,true)===0x02014b50){
  const method=cd.getUint16(p+10,true);let comp=cd.getUint32(p+20,true),unc=cd.getUint32(p+24,true),off=cd.getUint32(p+42,true);
  const nl=cd.getUint16(p+28,true),xl=cd.getUint16(p+30,true),cl=cd.getUint16(p+32,true);
  const name=td.decode(new Uint8Array(cd.buffer,cd.byteOffset+p+46,nl));
  if(/(^|\/)export\.xml$/i.test(name)){
   let q=p+46+nl;const xe=q+xl;
   while(q+4<=xe){const id=cd.getUint16(q,true),len=cd.getUint16(q+2,true);if(id===1){let r=q+4;if(unc===0xFFFFFFFF){unc=Number(cd.getBigUint64(r,true));r+=8}if(comp===0xFFFFFFFF){comp=Number(cd.getBigUint64(r,true));r+=8}if(off===0xFFFFFFFF){off=Number(cd.getBigUint64(r,true))}}q+=4+len}
   hit={method,comp,off};break;
  }
  p+=46+nl+xl+cl;
 }
 if(!hit)throw Error('export.xml was not found in this zip. Choose the file produced by Health → Export All Health Data.');
 const lh=new DataView(await file.slice(hit.off,hit.off+30).arrayBuffer());
 if(lh.getUint32(0,true)!==0x04034b50)throw Error('Damaged zip file');
 const start=hit.off+30+lh.getUint16(26,true)+lh.getUint16(28,true);
 let seen=0,s=file.slice(start,start+hit.comp).stream().pipeThrough(new TransformStream({transform(c,ctl){seen+=c.byteLength;onBytes?.(seen);ctl.enqueue(c)}}));
 if(hit.method===8)s=s.pipeThrough(new DecompressionStream('deflate-raw'));else if(hit.method!==0)throw Error('Unsupported zip compression');
 return {stream:s,total:hit.comp};
}
async function importFile(file,{since='',onProgress,signal}={}){
 const agg=aggregator({since});
 const {stream,total}=await exportXmlStream(file,b=>onProgress?.(Math.min(1,b/Math.max(1,total||1))));
 await scanXml(stream,agg,{signal});
 onProgress?.(1);return agg.finish();
}
const api={aggregator,scanXml,exportXmlStream,importFile,attr,toMs};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AHParse=api;
})(typeof window!=='undefined'?window:globalThis);
