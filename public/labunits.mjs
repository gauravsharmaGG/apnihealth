// Lab units, shared by the server (labs.mjs) and the browser (labmap.mjs): one key per unit, so "µmol/l",
// "umol/L" and "μmol/l" are the same unit, the identities between equal units (ng/mL = µg/L, 10⁹/L = 10³/µL),
// and conversion of a value into a marker's preferred unit with the factors declared in the marker catalog
// (config/markers.default.json: `unit`, and `units:[{unit,factor,src}]` where value in `unit` = value × factor).
// Pure functions, no DOM and no Node APIs.

// Canonical key -> the other spellings that mean exactly the same unit (after clean(): lower case, no spaces,
// µ/μ/mc -> u, superscripts -> ^n, litre -> l, cumm/mm³ -> ul).
const SAME={
 'mg/dl':['mg/100ml','mg%'],
 'g/dl':['g/100ml'],
 'ug/dl':['ug/100ml','ug%'],
 'ng/dl':['ng/100ml'],
 'mg/l':['ug/ml'],
 'g/l':[],
 'ng/ml':['ug/l'],
 'pg/ml':['ng/l'],
 'mmol/l':[],
 'umol/l':['nmol/ml'],
 'nmol/l':['pmol/ml'],
 'pmol/l':[],
 'meq/l':[],
 'mmol/mol':[],
 'u/l':['iu/l','units/l','unit/l'],
 'ukat/l':[],
 'miu/l':['uiu/ml','mu/l','uu/ml','miu/ml/1000'],
 '%':['percent','prozent','%ofwbc'],
 'l/l':[],
 'fl':['um^3','femtoliter'],
 'pg':['picogram'],
 '/ul':['cells/ul','/ulcells'],
 '10^3/ul':['10^9/l','tsd/ul','thou/ul','thousand/ul','k/ul','/nl','giga/l'],
 '10^6/ul':['10^12/l','mio/ul','mill/ul','million/ul','millions/ul','m/ul','/pl','tera/l'],
 // Indian reports often print the count in lakhs without the per-volume part ("2.5 lakhs"); it is per µL (cumm).
 'lakh/ul':['lakhs/ul','lac/ul','lacs/ul','lakh','lakhs','lac','lacs'],
 'ml/min/1.73m^2':['ml/min/1.73m2','ml/min/1,73m^2','ml/min/1,73m2','ml/min/1.73qm','ml/min/1,73qm','ml/min/1.73m²'],
 'mm/h':['mm/hr','mm/1h','mm/1sth','mm/1sthr'],
};
const KEY=new Map();for(const [k,v] of Object.entries(SAME)){KEY.set(k,k);for(const s of v)KEY.set(s,k)}
const PRETTY={'mg/dl':'mg/dL','g/dl':'g/dL','ug/dl':'µg/dL','ng/dl':'ng/dL','mg/l':'mg/L','g/l':'g/L','ng/ml':'ng/mL','pg/ml':'pg/mL','mmol/l':'mmol/L','umol/l':'µmol/L',
 'nmol/l':'nmol/L','pmol/l':'pmol/L','meq/l':'mEq/L','mmol/mol':'mmol/mol','u/l':'U/L','ukat/l':'µkat/L','miu/l':'mIU/L','%':'%','l/l':'L/L','fl':'fL','pg':'pg','/ul':'/µL',
 '10^3/ul':'10³/µL','10^6/ul':'10⁶/µL','lakh/ul':'lakh/µL','ml/min/1.73m^2':'mL/min/1.73 m²','mm/h':'mm/h'};
const SUP={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};

function clean(s){
 // Superscripts first: NFKC would turn 10³ into 103.
 let u=String(s??'').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,m=>'^'+[...m].map(c=>SUP[c]).join('')).normalize('NFKC').trim();
 if(!u)return '';
 // German labs write G/l (giga) and T/l (tera) for cell counts; lower case would read them as grams.
 if(/^G\s*\/\s*[lL]$/.test(u))return '10^3/ul';
 if(/^T\s*\/\s*[lL]$/.test(u))return '10^6/ul';
 u=u.toLowerCase()
  .replace(/[µμ]/g,'u').replace(/mcg/g,'ug').replace(/mcmol/g,'umol').replace(/\s+/g,'')
  .replace(/litre|liter/g,'l').replace(/(cumm|cmm|mm\^?3)$/,'ul').replace(/^x(?=10)/,'').replace(/^[×*]/,'')
  .replace(/10(?:e|\*\*|\*|\^)?(\d+)(?=\/)/,(m,e)=>'10^'+e);
 return u;
}
// The canonical key of a unit, or the cleaned spelling when it is not a known unit ('' when empty).
export const normUnit=s=>{const c=clean(s);return KEY.get(c)||c};
export const knownUnit=s=>KEY.has(clean(s));
export const prettyUnit=s=>{const k=normUnit(s);return PRETTY[k]||String(s??'').trim()};
export const sameUnit=(a,b)=>!!normUnit(a)&&normUnit(a)===normUnit(b);
// Does this catalog entry accept the unit (its preferred unit, or one with a declared factor)?
export const accepts=(entry,unit)=>!!entry?.unit&&(sameUnit(entry.unit,unit)||(entry.units||[]).some(x=>sameUnit(x.unit,unit)));
// Converts num (in unit) into the entry's preferred unit: {num, unit, factor} or null when no conversion is declared.
export function toPreferred(entry,num,unit){
 if(!entry?.unit||typeof num!=='number'||!Number.isFinite(num))return null;
 if(sameUnit(entry.unit,unit))return {num,unit:entry.unit,factor:1};
 const f=(entry.units||[]).find(x=>sameUnit(x.unit,unit));
 return f?{num:round(num*f.factor),unit:entry.unit,factor:f.factor}:null;
}
// Converts a value in the entry's preferred unit back into unit (the inverse of toPreferred).
export function fromPreferred(entry,num,unit){
 if(!entry?.unit||!Number.isFinite(num))return null;
 if(sameUnit(entry.unit,unit))return {num,unit,factor:1};
 const f=(entry.units||[]).find(x=>sameUnit(x.unit,unit));
 return f?{num:round(num/f.factor),unit:f.unit,factor:1/f.factor}:null;
}
// 6 significant digits: enough for display and comparisons, without float noise like 99.08800000000001.
export const round=n=>Number.isFinite(n)?Number(n.toPrecision(6)):n;
