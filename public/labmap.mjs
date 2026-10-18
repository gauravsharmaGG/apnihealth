// Mapping step for reading lab reports on the device: positioned text (pdf.js text items or OCR words) -> table
// rows -> catalog markers, with units, reference ranges, flags, a confidence score and in-report duplicate checks.
// Pure module (no DOM, no network): the browser runs it after extraction, and Node tests it on synthetic fixtures.
// Nothing here is ever saved by itself; the review screen shows the result and the person confirms each row.
//
// Token: {text, x0, y0, x1, y1, page, conf}. Coordinates are top-down (y grows downwards) in any consistent unit;
// conf is 0..1 (1 for PDF text).
import {normUnit,knownUnit,accepts,toPreferred,sameUnit,round} from './labunits.mjs';

// ---------- names ----------
// Words that say how or where something was measured, not what: dropped before matching (on both sides).
const DROP=new Set(['serum','plasma','s','i','im','edta','heparin','citrat','citrate','vollblut','whole','kapillar','capillary','venos','venous',
 'calculated','calc','berechnet','enzymatic','enzymatisch','photometric','photometrisch','photometrie','jaffe','immunoassay','eclia','clia','cmia','hplc',
 'turbidimetric','turbidimetrisch','nephelometric','nephelometrisch','method','methode','quantitative','quant','sample','probe','level','levels','test']);
// Tokens that tell paired markers apart: a fuzzy match must agree on all of them (ALT/ALP/AST, LDL/HDL, MCH/MCHC,
// T3/T4, Hb/HbA1c, CK/CK-MB, direct/total, share/count...).
const DISCRIM=new Set(['alt','ast','alp','ap','got','gpt','ggt','ldl','hdl','non','vldl','mch','mchc','mcv','t3','t4','ft3','ft4','tsh','hb','hba1c','a1c','ck','mb',
 'direct','direkt','indirect','indirekt','total','gesamt','absolute','absolut','abs','count','share','%','#','ifcc','ngsp','free','freies','frei','b12','b9','d','d3',
 'urea','harnstoff','bun','n','nitrogen','stickstoff','fasting','nuchtern','random','pp','postprandial','sodium','potassium','natrium','kalium']);
export function normName(s){
 return String(s??'').normalize('NFKC').replace(/ß/g,'ss').normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC').toLowerCase()
  .replace(/ae/g,'a').replace(/oe/g,'o').replace(/ue/g,'u')
  .replace(/[*†‡¹²³⁰⁴-⁹]+/g,' ').replace(/[^\p{L}\p{N}%#]+/gu,' ').trim().split(/\s+/).filter(w=>w&&!DROP.has(w)).join(' ');
}
// Variants of a printed name to try, best first: as printed, without parenthesised parts, the parenthesised part alone.
function variants(name){
 const s=String(name??'').trim(),out=[s];
 const noParen=s.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\s+/g,' ').trim();if(noParen&&noParen!==s)out.push(noParen);
 for(const m of s.matchAll(/\(([^)]{2,40})\)/g))out.push(m[1]);
 return out;
}
// Damerau-Levenshtein (optimal string alignment) similarity in 0..1.
export function similarity(a,b){
 if(a===b)return 1;const n=a.length,m=b.length;if(!n||!m)return 0;
 const d=Array.from({length:n+1},(_,i)=>{const r=new Array(m+1).fill(0);r[0]=i;return r});for(let j=0;j<=m;j++)d[0][j]=j;
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
  const c=a[i-1]===b[j-1]?0:1;d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
  if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
 }
 return 1-d[n][m]/Math.max(n,m);
}
const discrim=k=>k.split(' ').filter(w=>DISCRIM.has(w)).sort().join(' ');
export const FUZZY_MIN_LENGTH=6,FUZZY_MIN_SCORE=0.85;
// markers: catalog entries ({name, aliases, unit, units, plausible, alt}). household: entries learned in this
// household ({name, aliases, unit?, custom?}); a name that is not in the catalog is a household custom marker.
export function makeMatcher(markers,{household=[]}={}){
 const byName=new Map(),exact=new Map(),norm=new Map(),hh=new Map();
 const put=(map,k,e)=>{if(!k)return;const was=map.get(k);map.set(k,was&&was!==e?null:e)}; // null = ambiguous, never used
 for(const e of markers||[]){byName.set(e.name,e);for(const a of [e.name,...(e.aliases||[])]){put(exact,String(a).trim().toLowerCase(),e);put(norm,normName(a),e)}}
 for(const h of household||[]){
  const e=byName.get(h.name)||{name:h.name,group:h.group||'Other',aliases:[],unit:h.unit||undefined,custom:true};if(!byName.has(h.name))byName.set(h.name,e);
  for(const a of [h.name,...(h.aliases||[])])put(hh,normName(a),e);
 }
 const fuzzyKeys=[...norm.keys()].filter(k=>k.length>=FUZZY_MIN_LENGTH&&norm.get(k));
 function find(name){
  for(const v of variants(name)){const e=exact.get(v.toLowerCase());if(e)return {marker:e,how:v===String(name).trim()&&e.name.toLowerCase()===v.toLowerCase()?'exact':'alias',score:v===String(name).trim()?1:0.95}}
  for(const v of variants(name)){const k=normName(v),e=norm.get(k);if(e)return {marker:e,how:'alias',score:0.95}}
  for(const v of variants(name)){const e=hh.get(normName(v));if(e)return {marker:e,how:'household',score:0.95}}
  const k=normName(name);if(k.length<FUZZY_MIN_LENGTH)return null;
  // Best score per marker; the winner must beat the runner-up (another marker) clearly.
  const per=new Map();
  for(const c of fuzzyKeys){if(discrim(c)!==discrim(k))continue;const s=similarity(k,c),e=norm.get(c);if(s>(per.get(e)||0))per.set(e,s)}
  const ranked=[...per].sort((a,b)=>b[1]-a[1]);
  if(ranked[0]&&ranked[0][1]>=FUZZY_MIN_SCORE&&ranked[0][1]-(ranked[1]?.[1]||0)>=0.04)return {marker:ranked[0][0],how:'fuzzy',score:round(ranked[0][1]*0.8)};
  return null;
 }
 return {
  byName,
  // The unit decides between paired markers (share vs count, HbA1c % vs mmol/mol).
  match(name,unit){
   const r=find(name);if(!r)return null;
   const alt=r.marker.alt&&byName.get(r.marker.alt);
   if(unit&&alt&&!accepts(r.marker,unit)&&accepts(alt,unit))return {...r,marker:alt,unitPicked:true};
   return r;
  },
 };
}

// ---------- tokens -> lines ----------
export function linesFrom(tokens){
 const ts=(tokens||[]).filter(t=>t&&String(t.text??'').trim()).map(t=>({...t,text:String(t.text).trim(),h:Math.max(1,(t.y1-t.y0)||1),cy:(t.y0+t.y1)/2}));
 ts.sort((a,b)=>(a.page||1)-(b.page||1)||a.cy-b.cy||a.x0-b.x0);
 const lines=[];
 for(const t of ts){
  const l=lines.at(-1);
  if(l&&l.page===(t.page||1)&&Math.abs(t.cy-l.cy)<=0.5*Math.min(l.h,t.h)){l.tokens.push(t);l.cy=(l.cy*(l.tokens.length-1)+t.cy)/l.tokens.length;l.h=Math.max(l.h,t.h)}
  else lines.push({page:t.page||1,cy:t.cy,h:t.h,tokens:[t]});
 }
 return lines.map(l=>{
  l.tokens.sort((a,b)=>a.x0-b.x0);const cells=[];
  for(const t of l.tokens){const c=cells.at(-1);if(c&&t.x0-c.x1<=1.1*l.h){c.text+=' '+t.text;c.x1=Math.max(c.x1,t.x1);c.conf=Math.min(c.conf,t.conf??1);c.words.push(t)}else cells.push({text:t.text,x0:t.x0,x1:t.x1,conf:t.conf??1,words:[t]})}
  return {page:l.page,y:round(l.cy),cells,text:cells.map(c=>c.text).join('  ')};
 });
}

// ---------- one line -> one row ----------
const FLAGS=new Map([['h','high'],['hoch','high'],['high','high'],['↑','high'],['+','high'],['h*','high'],['*h','high'],['l','low'],['niedrig','low'],['tief','low'],['low','low'],['↓','low'],['-','low'],['l*','low'],['*l','low']]);
const TEXTV=/^(neg(?:\.|ativ|ative)?|pos(?:\.|itiv|itive)?|nicht nachweisbar|not detected|detected|nachweisbar|negative|positive|reactive|non-reactive|nonreactive|normal)$/i;
const OCRFIX={O:'0',o:'0',Q:'0',D:'0',l:'1',I:'1',i:'1','|':'1',S:'5',s:'5',B:'8',Z:'2',z:'2',g:'9'};
// A number as printed -> its value, for the report's decimal style ('de': 1.234,5  'en': 1,234.5).
export function parseNum(s,locale='en'){
 let t=String(s).replace(/\s/g,'');
 if(locale==='de'){if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t))t=t.replace(/\./g,'');t=t.replace(',','.')}
 else{if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t))t=t.replace(/,/g,'');else t=t.replace(',','.')}
 const n=Number(t);return /^-?\d+(\.\d+)?$/.test(t)&&Number.isFinite(n)?n:null;
}
const NUMW=/^([<>≤≥]=?)?(-?\d[\d.,]*)([*↑↓+]|[HhLl]\*?)?$/;
function numWord(w,ocr){
 let m=NUMW.exec(w);
 if(!m&&ocr&&/\d/.test(w)&&w.length<=8){const fixed=w.replace(/[OoQDlIi|SsBZzg]/g,(c,i)=>i===0&&/[<>]/.test(w[0])?c:OCRFIX[c]);m=NUMW.exec(fixed);if(m)return {m,fixed:true}}
 return m?{m,fixed:false}:null;
}
const RANGE=[[/^(-?\d[\d.,]*)\s*(?:-|–|—|bis|to)\s*(-?\d[\d.,]*)$/i,(a,b)=>({lo:a,hi:b})],[/^(?:<|≤|<=|bis|up to|upto|below|unter)\s*(-?\d[\d.,]*)$/i,a=>({hi:a})],[/^(?:>|≥|>=|above|over|uber|über|ab)\s*(-?\d[\d.,]*)$/i,a=>({lo:a})]];
export function parseRange(s,locale,{ocr=false}={}){
 const t=String(s??'').trim().replace(/\s+/g,' ');if(!t)return null;
 for(const [re,f] of ocr?[...RANGE,[/^(\d[\d.,]*) (\d[\d.,]*)$/,(a,b)=>a!==null&&b!==null&&a<b?{lo:a,hi:b}:{lo:null}]]:RANGE){const m=re.exec(t);if(m){const r=f(...m.slice(1).map(x=>parseNum(x,locale)));if(Object.values(r).every(v=>v!==null))return {text:t,...r}}}
 return null;
}
function unitAt(words,i){
 for(let n=Math.min(4,words.length-i);n>=1;n--){const s=words.slice(i,i+n).map(w=>w.text).join(' ');if(knownUnit(s)||knownUnit(s.replace(/\s+/g,'')))return {unit:s,n}}
 return null;
}
// Parses one line into {name, value, num, cmp, flag, unit, reference, range, valueConf, ocrFixed, valueType} or null.
export function parseRow(line,{locale='en',ocr=false}={}){
 const words=[];line.cells.forEach((c,ci)=>c.words.forEach((t,wi)=>{for(const p of t.text.split(/\s+/).filter(Boolean))words.push({text:p,cell:ci,first:wi===0,conf:t.conf??1})}));
 if(words.length<2)return null;
 // The value: the first number-like word after a name, preferring one that starts a cell.
 let vi=-1,vm=null,textValue=null;
 const nameOk=i=>/[\p{L}\p{M}]{2,}/u.test(words.slice(0,i).map(w=>w.text).join(' '));
 const tryAt=(i,needCell)=>{
  if(i<1||!nameOk(i)||(needCell&&!words[i].first))return false;
  let w=words[i].text;if((w==='<'||w==='>'||w==='≤'||w==='≥')&&words[i+1]){const n=numWord(words[i+1].text,ocr);if(n&&!n.m[1]){vi=i;vm={m:[w+words[i+1].text,w,n.m[2],n.m[3]],fixed:n.fixed,span:2};return true}}
  const n=numWord(w,ocr);if(n){vi=i;vm={...n,span:1};return true}
  const two=words[i+1]?w+' '+words[i+1].text:'';if(TEXTV.test(w)||TEXTV.test(two)){vi=i;textValue=TEXTV.test(two)?two:w;vm={span:TEXTV.test(two)?2:1};return true}
  return false;
 };
 for(const needCell of [true,false]){for(let i=1;i<words.length;i++)if(tryAt(i,needCell))break;if(vi>=0)break}
 if(vi<0)return null;
 const name=words.slice(0,vi).map(w=>w.text).join(' ').replace(/[:\s]+$/,'').trim();
 // A flag printed before the value ("H 5.6") belongs to the value, not the name.
 let flag=null,flagWord=null;const lastName=words[vi-1].text.toLowerCase();
 let nameClean=name;if(vi>1&&FLAGS.has(lastName)&&lastName.length<=2){flag=FLAGS.get(lastName);nameClean=words.slice(0,vi-1).map(w=>w.text).join(' ').trim()}
 const out={name:nameClean,valueConf:words.slice(vi,vi+vm.span).reduce((a,w)=>Math.min(a,w.conf),1),ocrFixed:!!vm.fixed};
 if(textValue){out.value=textValue;out.num=null;out.valueType='text'}
 else{
  const [,cmp,digits,suffix]=vm.m;const num=parseNum(digits,locale);if(num===null)return null;
  out.value=(cmp||'')+digits;out.num=num;out.cmp=cmp||null;out.valueType='number';
  if(suffix){const f=FLAGS.get(suffix.toLowerCase())||(suffix==='↑'?'high':suffix==='↓'?'low':null);if(f){flag=f;flagWord=suffix}}
 }
 // After the value, in any order: a flag, a unit, a reference range.
 let i=vi+vm.span,unit=null,range=null;const rest=[];
 while(i<words.length){
  const w=words[i].text,lw=w.toLowerCase();
  if(!flag&&FLAGS.has(lw)&&!(lw==='-'&&words[i+1]&&/^\d/.test(words[i+1].text))){flag=FLAGS.get(lw);flagWord=w;i++;continue}
  if(!unit){const u=unitAt(words,i);if(u){unit=u.unit;i+=u.n;continue}}
  if(!range){for(let n=Math.min(5,words.length-i);n>=1;n--){const r=parseRange(words.slice(i,i+n).map(x=>x.text).join(' '),locale,{ocr});if(r){range=r;i+=n;break}}if(range)continue}
  rest.push(w);i++;
 }
 // An unknown word after the value is kept as the unit, so the review flags it (unit-unknown) instead of guessing.
 if(!unit&&rest.length&&/^[\p{L}µμ%][\p{L}\d/µμ%.^²³]{0,14}$/u.test(rest[0]))unit=rest.shift();
 out.flag=flag;out.flagSource=flag?'printed':null;out.unit=unit;out.reference=range?range.text:null;out.range=range;out.extra=rest.join(' ')||null;
 return out;
}

// ---------- report metadata (dates and lab name only; never patient details) ----------
const MONTHS={jan:1,feb:2,mar:3,mrz:3,mär:3,apr:4,may:5,mai:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,okt:10,nov:11,dec:12,dez:12};
export function parseDate(s){
 let m=/\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);if(m)return iso(+m[1],+m[2],+m[3]);
 m=/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(s);if(m){const y=m[3].length===2?2000+ +m[3]:+m[3],a=+m[1],b=+m[2];return b>12&&a<=12?iso(y,a,b):iso(y,b,a)} // day first, unless only month-first (US) fits
 m=/\b(\d{1,2})[\s./-]*([A-Za-zä]{3,9})\.?[\s,./-]*(\d{4})\b/.exec(s);if(m){const mo=MONTHS[m[2].toLowerCase().slice(0,m[2].toLowerCase().startsWith('sept')?4:3)];if(mo)return iso(+m[3],mo,+m[1])}
 return null;
}
function iso(y,mo,d){if(mo<1||mo>12||d<1||d>31||y<1900||y>2100)return null;const s=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;return new Date(s+'T12:00Z').toISOString().slice(0,10)===s?s:null}
const SAMPLE=/(abnahme|entnahme|probenentnahme|eingangsdatum|eingang|collected|collection|sample\s*(?:date|collected|drawn)|drawn|received|registered|sampling)/i;
const REPORTED=/(befunddatum|befund vom|ausgang|reported|report date|report generated|printed|validated|druckdatum)/i;
const NEVER=/(\bgeburt|\bgeb\.|\bdob\b|\bbirth|\bborn\b|\bpatient|\bname\b|\bpat\.|\bid\b|\bnr\.|\bno\.|\buhid\b|\bmrn\b|\bversicherte|\binsurance\b|\bkasse\b|\balter\b|\bage\b|\bsex\b|\bgender\b|\bgeschlecht\b|\bref\.?\s*by\b|\bdoctor\b|\barzt\b)/i;
const LAB=/(labor|laboratory|laboratories|lab\b|diagnostics|diagnostik|pathology|pathlab|medizinisches versorgungszentrum|mvz|praxis|clinic)/i;
export function reportMeta(lines){
 let date=null,reported=null,anyDate=null,lab=null;
 for(const l of lines)l.cells.forEach((c,i)=>{
  // A date and its label: in the same cell ("Abnahme: 12.01.2000") or the cell before it.
  const d=parseDate(c.text);if(!d)return;
  const label=(c.text.slice(0,c.text.search(/\d/))||'').trim()||l.cells[i-1]?.text||'';
  if(NEVER.test(label)&&!SAMPLE.test(label)&&!REPORTED.test(label))return;
  if(SAMPLE.test(label))date??=d;else if(REPORTED.test(label))reported??=d;else if(/(datum|date)/i.test(label))anyDate??=d;
 });
 for(const l of lines.filter(l=>l.page===1).slice(0,12))if(LAB.test(l.text)&&!NEVER.test(l.text)&&l.text.length<=80&&!/\d{3,}/.test(l.text)){lab=l.cells[0].text.trim();break}
 return {date:date||reported||anyDate,reported:date&&reported&&reported!==date?reported:null,lab};
}

// ---------- the whole report ----------
const HEADER=/^(test|tests|parameter|untersuchung|analyse|analyt|investigation|test name|bezeichnung)\b/i;
function detectLocale(lines){
 let de=0,en=0;
 for(const l of lines){
  if(/(ergebnis|einheit|referenz|normbereich|befund|untersuchung|labor\b|nüchtern|harnstoff|leukozyten)/i.test(l.text))de+=3;
  if(/(result|units?\b|reference|interval|investigation|observed)/i.test(l.text))en+=3;
  for(const m of l.text.matchAll(/\b\d+([.,])\d{1,2}\b/g))m[1]===','?de++:en++;
 }
 return de>en?'de':'en';
}
// OCR often drops small decimal points in reference ranges ("3.5-5.3" read as "35-53", "0.7-1.3" as "07-13").
// A bound with a leading zero lost its point for sure; integer bounds far from a value that has decimals are read
// with the value's decimals when that puts the value near the range. Otherwise a range far off the value is unclear
// and gives no flag. Returns {range, issue} or null (range fine as read).
function ocrRange(range,value,locale){
 const bounds=String(range.text).match(/\d[\d.,]*/g)||[],decOf=b=>(/[.,](\d+)$/.exec(String(b))||[,''])[1].length,dec=decOf(value);
 const k=Object.keys(range).filter(x=>x==='lo'||x==='hi'),num=parseNum(String(value).replace(/^[<>≤≥]=?/,''),locale);
 if(num===null||!k.length||bounds.length<k.length)return null;
 const b=Object.fromEntries(k.map((x,i)=>[x,bounds[i]])),inside=r=>(r.lo===undefined||num>=r.lo)&&(r.hi===undefined||num<=r.hi);
 const near=(r,f)=>(r.lo===undefined||num>=r.lo/f)&&(r.hi===undefined||num<=r.hi*f);
 const fixed=fix=>({range:{...range,...fix},issue:'range-ocr-fixed'});
 // "07-13": a leading zero always had a point after it
 if(k.some(x=>/^0\d+$/.test(b[x])))return fixed(Object.fromEntries(k.map(x=>[x,/^0\d+$/.test(b[x])?Number('0.'+b[x].slice(1)):range[x]])));
 // "35-7.2": low above high, one bound lost its point; give it the other bound's decimals
 if(range.lo!==undefined&&range.hi!==undefined&&range.lo>range.hi){
  if(!decOf(b.lo)&&decOf(b.hi))return fixed({lo:range.lo/10**decOf(b.hi)});
  return {range,issue:'range-unclear'};
 }
 if(inside(range))return null;
 // "135-175" next to 14,2: integer bounds read with the value's decimals when that puts the value in or near the range
 if(dec>0&&k.every(x=>/^\d{2,}$/.test(b[x]))){const f=Object.fromEntries(k.map(x=>[x,range[x]/10**dec]));if(near(f,2))return fixed(f)}
 // a value without decimals far above a range printed with decimals ("24" for 2.4 next to 0.35-5.50) lost its point
 if(!dec&&k.some(x=>decOf(b[x]))&&!near(range,3))return {range,issue:'value-unclear'};
 return near(range,3)?null:{range,issue:'range-unclear'};
}
// OCR misreads in units: µ as p or u, a slash as l or I, a stray i. One edit, kept only if the marker accepts it.
const UNIT_EDITS=[[/p/g,'µ'],[/u/g,'µ'],[/\/(?=l$)/gi,'/µ'],[/[lI1|]/g,'/'],[/[fi](?=[lL]$)/g,'/'],[/i/g,'']];
function ocrUnit(marker,unit){
 for(const [re,to] of UNIT_EDITS)for(const m of unit.matchAll(re)){const u=unit.slice(0,m.index)+to+unit.slice(m.index+m[0].length);if(u&&accepts(marker,u))return u}
 return null;
}
// Score parts, and the buckets: high = ticked; medium = ticked and highlighted; low or unmapped = not ticked.
export const BUCKETS={high:0.9,medium:0.7};
export function mapReport(tokens,markers,{household=[],method='pdf-text'}={}){
 const lines=linesFrom(tokens),locale=detectLocale(lines),ocr=method==='ocr',matcher=makeMatcher(markers,{household});
 const meta=reportMeta(lines),rows=[],unread=[];
 for(const l of lines){
  if(HEADER.test(l.cells[0]?.text||'')&&l.cells.length>=2&&!l.cells.slice(1).some(c=>/^\d/.test(c.text))){continue}
  const r=parseRow(l,{locale,ocr});
  if(!r||!r.name||r.name.length>80||(r.valueType==='number'&&NEVER.test(r.name))||(r.valueType==='number'&&parseDate(l.text)&&/(datum|date|on\b)/i.test(l.text))){if(l.text.length>2)unread.push({page:l.page,text:l.text});continue}
  const issues=[];
  if(ocr&&r.range&&r.num!==null){const f=ocrRange(r.range,r.value,locale);if(f){r.range=f.range;issues.push(f.issue)}}
  let m=matcher.match(r.name,r.unit);
  if(!m&&ocr&&/ii/.test(r.name))m=matcher.match(r.name.replace(/ii/g,'ü'),r.unit); // OCR reads ü as ii
  if(ocr&&m&&r.unit&&!accepts(m.marker,r.unit)){const u=ocrUnit(m.marker,r.unit);if(u){r.unit=u;issues.push('ocr-unit');m=matcher.match(r.name,r.unit)||m}}
  const e=m?.marker||null;
  let unitScore=1,plausScore=1,flagScore=1,preferred=null;
  if(e){
   if(!r.unit){unitScore=e.unit?0.85:1;if(e.unit)issues.push('no-unit')}
   else if(e.unit&&!accepts(e,r.unit)){unitScore=0.6;issues.push('unit-unknown')}
   else if(!e.unit&&!e.custom&&!knownUnit(r.unit))unitScore=0.9;
   if(r.num!==null&&r.unit){preferred=toPreferred(e,r.num,r.unit);if(preferred&&e.plausible&&(preferred.num<e.plausible[0]||preferred.num>e.plausible[1])){plausScore=0.3;issues.push('implausible')}}
   else if(r.num!==null&&!r.unit&&e.plausible){const p={num:r.num};if(p.num<e.plausible[0]||p.num>e.plausible[1]){plausScore=0.5;issues.push('implausible')}}
  }
  // Flag vs printed range: a printed flag that disagrees lowers the score; with no flag printed, the range decides.
  let flag=r.flag,flagSource=r.flagSource;
  if(r.num!==null&&r.range){
   const above=r.range.hi!==undefined&&r.num>r.range.hi,below=r.range.lo!==undefined&&r.num<r.range.lo;
   if(flag==='high'&&below||flag==='low'&&above){flagScore=0.7;issues.push('flag-mismatch')}
   if(!flag&&(above||below)){flag=above?'high':'low';flagSource='range'}
  }
  if(r.valueType==='text')issues.push('text-value');
  if(r.ocrFixed)issues.push('ocr-fixed');
  const ocrPenalty=(r.ocrFixed?0.85:1)*(issues.includes('ocr-unit')?0.85:1)*(issues.includes('range-ocr-fixed')?0.9:1)*(issues.includes('value-unclear')?0.6:1);
  if(issues.includes('range-unclear')&&flagSource==='range'){flag=null;flagSource=null}
  const conf=e?round(m.score*Math.min(1,r.valueConf)*unitScore*plausScore*flagScore*ocrPenalty):0;
  const bucket=!e?'unmapped':conf>=BUCKETS.high?'high':conf>=BUCKETS.medium?'medium':'low';
  rows.push({line:l.text,page:l.page,y:l.y,name:r.name,marker:e?.name||null,custom:!!e?.custom,how:m?.how||null,unitPicked:!!m?.unitPicked,value:r.value,num:r.num,cmp:r.cmp||null,
   unit:r.unit,reference:r.reference,flag,flagSource,conf,bucket,include:!!e&&bucket!=='low'&&r.valueType==='number',issues,preferred:preferred&&preferred.factor!==1?{num:preferred.num,unit:preferred.unit}:null,valueType:r.valueType});
 }
 // In one report the same marker counts once: the first row wins; later ones are flagged and left unticked.
 const seen=new Map();
 for(const row of rows){if(!row.marker)continue;const k=row.marker;
  if(seen.has(k)){const first=seen.get(k);row.include=false;row.issues.push(first.unit&&row.unit&&!sameUnit(first.unit,row.unit)?'duplicate-other-unit':'duplicate');row.duplicateOf=first.line}else seen.set(k,row)}
 return {...meta,locale,method,rows,unread,title:meta.lab?('Lab report · '+meta.lab).slice(0,120):null};
}
// The value a row would save, in the shape POST /api/labs takes.
export const toValue=row=>({name:row.marker,value:row.value,unit:row.unit?String(row.unit).trim():undefined,reference:row.reference||undefined,flag:row.flag||undefined,page:row.page||undefined,rawName:row.name,confidence:row.conf});
export {normUnit};
