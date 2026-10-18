// public/labmap.mjs on synthetic token fixtures (fake labs, fake people, dates in 2000): lines and cells from
// positions, the row grammar (decimal comma, flags, units, ranges), metadata without patient details, name
// matching (exact, alias, German/Hindi, household, fuzzy with the confusable guard), unit-picked pairs,
// plausibility, confidence buckets and in-report duplicates.
import assert from 'node:assert/strict';
import * as M from './public/labmap.mjs';
import CAT from './config/markers.default.json' with {type:'json'};
const markers=CAT.markers;
// Builds word tokens: rows of [x, 'cell text'] at line y (12 units high, 6 per character), optional OCR confidence.
function page(rows,{page=1,conf=1,confOf=()=>null}={}){
 const out=[];rows.forEach((cells,i)=>{const y=40+i*20;for(const [x,text] of cells){let cx=x;for(const w of String(text).split(' ')){if(!w){cx+=6;continue}out.push({text:w,x0:cx,x1:cx+w.length*6,y0:y,y1:y+12,page,conf:confOf(w)??conf});cx+=w.length*6+4}}});
 return out;
}
const C=[20,220,300,400]; // name, value, unit, range columns
const row=(name,value,unit,range,flagCol)=>[[C[0],name],[C[1],value],...(flagCol?[[C[1]+48,flagCol]]:[]),...(unit?[[C[2],unit]]:[]),...(range?[[C[3],range]]:[])];
const by=(rep,name)=>rep.rows.find(r=>r.name===name);

// --- normalisation and similarity
assert.equal(M.normName('Hämoglobin'),M.normName('Haemoglobin'));assert.equal(M.normName('Gesamteiweiß'),'gesamteiweiss');
assert.equal(M.normName('Kreatinin i.S. (enzymatisch)*'),'kreatinin');assert.equal(M.normName('S. Creatinine'),'creatinine');
assert(M.similarity('kreatinin','kreatinln')>0.85&&M.similarity('abc','xyz')<0.1);assert.equal(M.similarity('ab','ba'),0.5,'a transposition counts once');
// --- numbers and ranges
assert.equal(M.parseNum('6,8','de'),6.8);assert.equal(M.parseNum('1.234,5','de'),1234.5);assert.equal(M.parseNum('7,500','en'),7500);assert.equal(M.parseNum('7.5','en'),7.5);assert.equal(M.parseNum('1.2.3'),null);
assert.deepEqual(M.parseRange('3,9 - 10,2','de'),{text:'3,9 - 10,2',lo:3.9,hi:10.2});assert.deepEqual(M.parseRange('< 50','de'),{text:'< 50',hi:50});assert.deepEqual(M.parseRange('bis 5,0','de'),{text:'bis 5,0',hi:5});
assert.deepEqual(M.parseRange('13.0 - 17.0'),{text:'13.0 - 17.0',lo:13,hi:17});assert.equal(M.parseRange('high'),null);
// --- dates
assert.equal(M.parseDate('Abnahme: 12.01.2000 08:10'),'2000-01-12');assert.equal(M.parseDate('Collected on 12-Jan-2000'),'2000-01-12');assert.equal(M.parseDate('2000-02-30'),null);assert.equal(M.parseDate('5 Okt 2000'),'2000-10-05');assert.equal(M.parseDate('03/15/2000'),'2000-03-15','US month-first when only that fits');assert.equal(M.parseDate('03/04/2000'),'2000-04-03','ambiguous: day first');

// --- a German text PDF (decimal comma, flags, Tsd/µl, GOT/GPT, Befunddatum vs Abnahme)
const de=page([
 [[20,'Testlabor Musterstadt']],
 [[20,'Patient: Test Person'],[300,'Geb.: 01.01.1990']],
 [[20,'Abnahme: 12.01.2000'],[300,'Befunddatum: 14.01.2000']],
 [[C[0],'Untersuchung'],[C[1],'Ergebnis'],[C[2],'Einheit'],[C[3],'Referenzbereich']],
 row('Hämoglobin','14,2','g/dl','13,5 - 17,5'),
 row('Leukozyten','11,8','Tsd/µl','3,9 - 10,2','H'),
 row('Thrombozyten','250','Tsd/µl','150 - 370'),
 row('GPT (ALAT)','32','U/l','< 50'),
 row('GOT (ASAT)','28','U/l','< 50'),
 row('Glucose nüchtern','92','mg/dl','70 - 99'),
 row('LDL-Cholesterin','162','mg/dl','< 116','H'),
 row('Kreatinin i.S.','88','µmol/l','62 - 106'),
 row('HbA1c (IFCC)','38','mmol/mol','20 - 42'),
 row('Neutrophile','58','%','40 - 75'),
 row('Neutrophile absolut','4,1','Tsd/µl','1,8 - 7,7'),
 row('Exotischer Testwert','3,3','mg/l','< 5'),
 row('CRP','neg.',null,null),
]);
const rd=M.mapReport(de,markers);
assert.equal(rd.locale,'de');assert.equal(rd.date,'2000-01-12','sample date wins');assert.equal(rd.reported,'2000-01-14');assert.equal(rd.lab,'Testlabor Musterstadt');assert.match(rd.title,/Testlabor/);
assert(!JSON.stringify({d:rd.date,r:rd.reported,l:rd.lab,t:rd.title}).includes('Test Person')&&!JSON.stringify(rd.rows).includes('1990'),'no patient details in metadata or rows');
const hb=by(rd,'Hämoglobin');assert.deepEqual([hb.marker,hb.value,hb.num,hb.unit,hb.reference,hb.flag,hb.bucket,hb.include],['Hemoglobin: oxygen-carrying protein','14,2',14.2,'g/dl','13,5 - 17,5',null,'high',true]);
const wbc=by(rd,'Leukozyten');assert.deepEqual([wbc.marker,wbc.num,wbc.flag,wbc.flagSource],['White blood cell count',11.8,'high','printed']);
assert.equal(by(rd,'GPT (ALAT)').marker,'ALT: liver-related enzyme');assert.equal(by(rd,'GOT (ASAT)').marker,'AST: liver and muscle enzyme');
assert.equal(by(rd,'Glucose nüchtern').marker,'Fasting blood sugar');
const ldl=by(rd,'LDL-Cholesterin');assert.deepEqual([ldl.marker,ldl.flag,ldl.reference],['LDL cholesterol','high','< 116']);
const crea=by(rd,'Kreatinin i.S.');assert.equal(crea.marker,'Creatinine: kidney blood marker');assert.equal(crea.preferred.unit,'mg/dL');assert(Math.abs(crea.preferred.num-0.995)<0.01,'converted for display');
assert.equal(by(rd,'HbA1c (IFCC)').marker,'Average blood sugar: alternate units','mmol/mol picks the IFCC marker');
assert.equal(by(rd,'Neutrophile').marker,'Neutrophils: share of white cells');assert.equal(by(rd,'Neutrophile absolut').marker,'Neutrophils: actual count');
const ex=by(rd,'Exotischer Testwert');assert.deepEqual([ex.marker,ex.bucket,ex.include],[null,'unmapped',false],'unmapped rows are skipped by default');
const crp=by(rd,'CRP');assert.deepEqual([crp.valueType,crp.include],['text',false],'text results are shown but not saved');
assert(!rd.rows.some(r=>/Untersuchung|Abnahme|Patient/.test(r.name)),'headers and metadata are not rows');
assert(rd.rows.filter(r=>r.include).every(r=>r.bucket!=='low'));

// --- Indian-style English report (cells/cumm, lakhs/cumm, Bio. Ref. Interval, SGPT, thousands separator)
const ind=page([
 [[20,'Example Diagnostics Pvt. Ltd.']],
 [[20,'Name: Test Person'],[300,'Age/Sex: 30 Y / M']],
 [[20,'Collected on: 05-Feb-2000'],[300,'Reported on: 06-Feb-2000']],
 [[C[0],'Test Name'],[C[1],'Result'],[C[2],'Unit'],[C[3],'Bio. Ref. Interval']],
 row('Haemoglobin','13.5','g/dL','13.0 - 17.0'),
 row('Total Leucocyte Count (TLC)','7,500','cells/cumm','4000 - 11000'),
 row('Platelet Count','2.5','lakhs/cumm','1.5 - 4.5'),
 row('RBC Count','4.8','mill/cumm','4.5 - 5.5'),
 row('SGPT','45','U/L','0 - 40'),
 row('Fasting Blood Sugar','110','mg/dL','70 - 100'),
 row('Serum Creatinine','1.1','mg/dL','0.7 - 1.3'),
 row('Vitamin D (25-OH)','18','ng/mL','30 - 100','L'),
 row('Vitamin B12','800','pg/mL','200 - 900'),
]);
const ri=M.mapReport(ind,markers);
assert.equal(ri.locale,'en');assert.equal(ri.date,'2000-02-05');assert.equal(ri.reported,'2000-02-06');
const tlc=by(ri,'Total Leucocyte Count (TLC)');assert.deepEqual([tlc.marker,tlc.num,tlc.preferred],['White blood cell count',7500,{num:7.5,unit:'10³/µL'}]);
const plt=by(ri,'Platelet Count');assert.deepEqual([plt.marker,plt.preferred],['Platelet count',{num:250,unit:'10³/µL'}]);
assert.equal(by(ri,'RBC Count').marker,'Red blood cell count');
const sgpt=by(ri,'SGPT');assert.deepEqual([sgpt.marker,sgpt.flag,sgpt.flagSource],['ALT: liver-related enzyme','high','range'],'no printed flag: the printed range decides');
assert.equal(by(ri,'Fasting Blood Sugar').marker,'Fasting blood sugar');assert.equal(by(ri,'Serum Creatinine').marker,'Creatinine: kidney blood marker');
assert.equal(by(ri,'Vitamin D (25-OH)').marker,'Vitamin D');assert.equal(by(ri,'Vitamin B12').marker,'Vitamin B12');assert.equal(by(ri,'Vitamin D (25-OH)').flag,'low');
assert(ri.rows.every(r=>r.include===(r.bucket==='high'||r.bucket==='medium')),'every mapped row with a unit is ticked');

// --- Hindi names, household aliases and custom markers
const hi=M.mapReport(page([row('हीमोग्लोबिन','12.9','g/dL','12 - 15'),row('Hausname Ferritin','40','ng/mL','15 - 150'),row('Familienwert','7','mg/l','< 9')]),markers,
 {household:[{name:'Ferritin: iron stores',aliases:['Hausname Ferritin']},{name:'Familienwert',unit:'mg/L'}]});
assert.equal(by(hi,'हीमोग्लोबिन').marker,'Hemoglobin: oxygen-carrying protein');
assert.deepEqual([by(hi,'Hausname Ferritin').marker,by(hi,'Hausname Ferritin').how],['Ferritin: iron stores','household']);
assert.deepEqual([by(hi,'Familienwert').marker,by(hi,'Familienwert').custom],['Familienwert',true],'household custom marker');

// --- fuzzy only for long names, never across confusable pairs; OCR fixes only in the value
const mt=M.makeMatcher(markers);
assert.equal(mt.match('Kreatinln','mg/dl')?.how,'fuzzy');assert.equal(mt.match('Kreatinln','mg/dl').marker.name,'Creatinine: kidney blood marker');assert(mt.match('Kreatinln').score<0.9,'fuzzy never reaches the high bucket');
assert.deepEqual(mt.match('ALP'),mt.match('alp'));assert.equal(mt.match('ALX'),null,'short names are never fuzzy');assert.equal(mt.match('GTP'),null);
assert.notEqual(mt.match('Bilirubin direkx')?.marker.name,'Total bilirubin');assert.equal(mt.match('Bilirubim gesamt')?.marker.name,'Total bilirubin');assert.equal(mt.match('Bilirubin gesant'),null,'a misread telling word (gesamt) blocks fuzzy');
assert.equal(mt.match('Bilirubin indirekt'),null,'indirect bilirubin is not mapped to direct or total');
assert.equal(mt.match('HDL-Cholesterim')?.marker.name,'HDL cholesterol');assert.notEqual(mt.match('HDL-Cholesterim')?.marker.name,'LDL cholesterol');
assert.equal(mt.match('Neutrophils','10^9/l').marker.name,'Neutrophils: actual count','the unit picks share vs count');assert.equal(mt.match('Neutrophils','%').marker.name,'Neutrophils: share of white cells');
assert.equal(mt.match('HbA1c','mmol/mol').marker.name,'Average blood sugar: alternate units');assert.equal(mt.match('HbA1c','%').marker.name,'Average blood sugar (HbA1c)');
const ocr=M.mapReport(page([row('Hämoglobin','l4,O','g/dl','13,5 - 17,5'),row('Kalium','4,2','mmol/l','3,5 - 5,1'),row('Natrium','14O','mmol/l','135 - 145')],{conf:0.97,confOf:w=>w==='14O'?0.6:null}),markers,{method:'ocr'});
const ohb=by(ocr,'Hämoglobin');assert.deepEqual([ohb.num,ohb.issues.includes('ocr-fixed')],[14,true]);assert.notEqual(ohb.bucket,'high','an OCR-fixed value is never in the high bucket');
assert.equal(by(ocr,'Kalium').bucket,'high');const na=by(ocr,'Natrium');assert.equal(na.num,140);assert.equal(na.include,false,'low OCR confidence: not ticked');
assert.equal(M.mapReport(page([row('Kalium','4,2','mmol/l','3,5 - 5,1')]),markers,{method:'pdf-text'}).rows[0].conf,1,'exact alias + known unit on PDF text');

// --- plausibility, flag mismatch, unknown unit, missing unit, duplicates
const odd=M.mapReport(page([row('Hemoglobin','142','g/dL','13 - 17'),row('Ferritin','45','furlongs','30 - 300'),row('Potassium','4.1',null,'3.5 - 5.1'),
 row('Sodium','150','mmol/L','135 - 145','L'),row('Glucose nüchtern','92','mg/dL','70 - 99'),row('Nüchternglukose','5.1','mmol/L','3.9 - 5.5'),row('Kalium','4.1','mmol/L','3.5 - 5.1')]),markers);
const h142=by(odd,'Hemoglobin');assert(h142.issues.includes('implausible')&&!h142.include,'a lost decimal point is caught and not ticked');
assert(by(odd,'Ferritin').issues.includes('unit-unknown')&&by(odd,'Ferritin').bucket==='low');
assert(by(odd,'Potassium').issues.includes('no-unit')&&by(odd,'Potassium').bucket==='medium','no unit: ticked but highlighted');
const naL=by(odd,'Sodium');assert(naL.issues.includes('flag-mismatch'));assert.equal(naL.bucket,'medium');
const g2=by(odd,'Nüchternglukose');assert.equal(g2.include,false);assert(g2.issues.includes('duplicate-other-unit'));
const k2=by(odd,'Kalium');assert(k2.issues.includes('duplicate')&&!k2.include,'same marker twice: the first row wins');
// --- toValue: the POST /api/labs shape
assert.deepEqual(M.toValue(hb),{name:'Hemoglobin: oxygen-carrying protein',value:'14,2',unit:'g/dl',reference:'13,5 - 17,5',flag:undefined,page:1,rawName:'Hämoglobin',confidence:hb.conf});
// --- unread lines are kept for the review screen (never saved)
assert(rd.unread.some(u=>/Patient/.test(u.text)),'unparsed lines are listed');
console.log(`PASS labmap: lines/cells, row grammar (de/en/Indian), metadata without patient details, alias/German/Hindi/household matching, guarded fuzzy, unit-picked pairs, OCR value fixes, plausibility, buckets, duplicates (${rd.rows.length+ri.rows.length} fixture rows).`);
