// A tiny PDF writer for synthetic test reports (no dependencies): A4 pages with Helvetica text at given positions,
// WinAnsi-encoded (Latin-1 letters such as ä ö ü ß µ, plus the en dash). Also returns the "ideal" text tokens
// (what a perfect extractor would report: word, box in top-down points, page), used as ground truth for layout.
const W=595,H=842;
// Helvetica advance widths (per 1000 em) for the characters used; others fall back to 556.
const AFM={' ':278,'!':278,'"':355,'#':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,
 A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,'[':278,']':278,'_':556,
 a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,'µ':556,'ä':556,'ö':556,'ü':556,'Ä':667,'Ö':778,'Ü':722,'ß':611,'–':556,'é':556};
export const textWidth=(s,size)=>[...s].reduce((a,c)=>a+(AFM[c]??(/\d/.test(c)?556:556)),0)*size/1000;
const WIN={'–':0x96,'—':0x97,'€':0x80,'’':0x92,'“':0x93,'”':0x94};
function encode(s){
 const out=[];for(const c of s){const code=WIN[c]??c.charCodeAt(0);if(code>255)throw Error('not WinAnsi: '+c);if(c==='('||c===')'||c==='\\')out.push(0x5c);out.push(code)}
 return Buffer.from(out).toString('latin1');
}
// pages: [[{x, y (top-down baseline), text, size?, bold?}]] -> {pdf: Buffer, tokens}
export function makePdf(pages){
 const objs=[],tokens=[];
 const add=s=>{objs.push(s);return objs.length};
 const catalog=add(null),pagesId=add(null),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const kids=[];
 pages.forEach((items,pi)=>{
  let content='';
  for(const it of items){
   const size=it.size||9;content+=`BT /${it.bold?'F2':'F1'} ${size} Tf ${it.x.toFixed(2)} ${(H-it.y).toFixed(2)} Td (${encode(it.text)}) Tj ET\n`;
   let x=it.x;for(const w of it.text.split(' ')){if(w)tokens.push({text:w,x0:+x.toFixed(2),x1:+(x+textWidth(w,size)).toFixed(2),y0:+(it.y-size*0.75).toFixed(2),y1:+(it.y+size*0.2).toFixed(2),page:pi+1,conf:1});x+=textWidth(w+' ',size)}
  }
  const c=Buffer.from(content,'latin1');
  const cs=add(`<< /Length ${c.length} >>\nstream\n${content}endstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${cs} 0 R >>`));
 });
 objs[catalog-1]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
 objs[pagesId-1]=`<< /Type /Pages /Kids [${kids.map(k=>k+' 0 R').join(' ')}] /Count ${kids.length} >>`;
 let out='%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';const offs=[];
 objs.forEach((o,i)=>{offs.push(Buffer.byteLength(out,'latin1'));out+=`${i+1} 0 obj\n${o}\nendobj\n`});
 const xref=Buffer.byteLength(out,'latin1');
 out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n${offs.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objs.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return {pdf:Buffer.from(out,'latin1'),tokens};
}
export const PAGE={W,H};
