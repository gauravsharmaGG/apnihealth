// Lays out a synthetic report (reports.mjs) as positioned text items (for the PDF writer) and as HTML (for the
// photo-like PNGs rendered by headless Chrome). Columns: name, value, flag, unit, range.
import {PAGE} from './pdf.mjs';
export const COLS=[50,250,305,340,430];
export function items(rep){
 return rep.pages.map((rows,pi)=>{
  const out=[];let y=60;
  if(pi===0){
   out.push({x:50,y,text:rep.lab,size:14,bold:true});y+=28;
   for(const [a,b] of rep.meta){out.push({x:50,y,text:a});if(b)out.push({x:330,y,text:b});y+=14}
   y+=12;
  }else{out.push({x:50,y,text:rep.lab+' (page '+(pi+1)+')',size:9});y+=24}
  rep.header.forEach((h,i)=>{if(h)out.push({x:COLS[i],y,text:h,bold:true})});y+=18;
  for(const r of rows){
   out.push({x:COLS[0],y,text:r.name},{x:COLS[1],y,text:r.value});
   if(r.flag)out.push({x:COLS[2],y,text:r.flag,bold:true});
   if(r.unit)out.push({x:COLS[3],y,text:r.unit});
   if(r.range)out.push({x:COLS[4],y,text:r.range});
   y+=16;
  }
  out.push({x:50,y:PAGE.H-40,text:'Synthetic test report. Fictional data only.',size:7});
  return out;
 });
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// One HTML page per report page, same positions (1 pt = 1 CSS px), for a screenshot at 2x.
export function html(rep,pageIndex,style=''){
 const its=items(rep)[pageIndex];
 return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff;overflow:hidden}#p{position:relative;width:${PAGE.W}px;height:${PAGE.H}px;background:#fdfdfb;font-family:Helvetica,Arial,'Noto Sans Devanagari','Lohit Devanagari',sans-serif;color:#111;${style}}
span{position:absolute;white-space:pre;line-height:1}</style><div id="p">${its.map(it=>`<span style="left:${it.x}px;top:${it.y-(it.size||9)*0.8}px;font-size:${(it.size||9)+0.5}px;${it.bold?'font-weight:bold':''}">${esc(it.text)}</span>`).join('')}</div>`;
}
