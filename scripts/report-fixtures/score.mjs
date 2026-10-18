// Field-level scoring of a reading (labmap.mapReport output) against a synthetic report's ground truth.
// A row is correct when marker, number and flag all match. Precision is measured on the rows the reader would save
// by default (ticked, i.e. high and medium buckets) and separately on the high bucket; recall on the expected
// mapped rows. Unmapped expectations (want.marker null) must not be ticked.
const close=(a,b)=>a===b||(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.abs(b)*1e-9);
export function score(rep,result){
 const truth=rep.pages.flat(),rows=result.rows,used=new Set(),detail=[];
 for(const t of truth){
  const i=rows.findIndex((r,k)=>!used.has(k)&&r.name&&norm(r.name)===norm(t.name));
  if(i<0){detail.push({name:t.name,found:false,want:t.want});continue}
  used.add(i);const r=rows[i];
  const ok=t.want.marker===null?r.marker===null||!r.include:r.marker===t.want.marker&&close(r.num,t.want.num)&&(r.flag||null)===(t.want.flag||null);
  detail.push({name:t.name,found:true,ok,ticked:r.include,bucket:r.bucket,got:{marker:r.marker,num:r.num,flag:r.flag},want:t.want});
 }
 const ticked=detail.filter(d=>d.found&&d.ticked),high=detail.filter(d=>d.found&&d.bucket==='high'),mapped=truth.filter(t=>t.want.marker);
 const extra=rows.filter((r,k)=>!used.has(k)&&r.include).length; // ticked rows that are not in the report at all
 const pct=(a,b)=>b?Math.round(a/b*1000)/1000:1;
 return {
  precisionTicked:pct(ticked.filter(d=>d.ok).length,ticked.length+extra),
  precisionHigh:pct(high.filter(d=>d.ok).length,high.length),
  recall:pct(detail.filter(d=>d.found&&d.ok&&d.ticked&&d.want.marker).length,mapped.length),
  wrongTicked:ticked.filter(d=>!d.ok).map(d=>({name:d.name,got:d.got,want:d.want})),extraTicked:extra,
  dateOk:result.date===rep.date,detail,
 };
}
const norm=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
