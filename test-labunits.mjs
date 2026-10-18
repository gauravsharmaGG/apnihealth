// public/labunits.mjs and the catalog v2 unit data (config/markers.default.json): unit spellings, identities,
// every declared conversion factor (source present, round trip, spot checks against well-known values), the
// plausible bounds and the alt pairs. No health data: the spot checks are textbook conversions.
import assert from 'node:assert/strict';
import * as U from './public/labunits.mjs';
import CAT from './config/markers.default.json' with {type:'json'};

// spellings: case, µ/μ/mc, spaces, superscripts, Indian and German count units
for(const [a,b] of [['µmol/l','umol/L'],['μmol/L','µmol/l'],['mcg/L','ng/mL'],['mg / dl','mg/dL'],['IU/L','U/l'],['µIU/mL','mIU/L'],['10^9/L','10³/µL'],['Tsd/µl','10^3/ul'],
 ['G/l','10³/µL'],['T/l','10⁶/µL'],['Mio/µl','10^12/L'],['mill/cumm','10⁶/µL'],['cells/cumm','/µL'],['/mm³','/µL'],['lakhs/cumm','lakh/µL'],['x10^3/µL','10^9/l'],['10e3/uL','10³/µL'],
 ['mL/min/1,73m²','mL/min/1.73 m²'],['pg/ml','ng/L'],['%','Prozent'],['fl','µm³'],['mm/hr','mm/h']])
 assert(U.sameUnit(a,b),a+' = '+b);
for(const [a,b] of [['g/l','G/l'],['mg/dl','mg/l'],['mmol/l','mEq/L'],['µmol/l','mmol/l'],['%','mmol/mol'],['10³/µL','/µL'],['',''],['pg','pg/mL']])
 assert(!U.sameUnit(a,b),a+' != '+b);
assert.equal(U.prettyUnit('umol/l'),'µmol/L');assert.equal(U.prettyUnit('10^9/l'),'10³/µL');assert.equal(U.prettyUnit('furlongs'),'furlongs');
assert(U.knownUnit('mg/dL')&&!U.knownUnit('mg/furlong')&&!U.knownUnit(''));

// conversions on a small fictional entry
const e={unit:'mg/dL',units:[{unit:'mmol/L',factor:18.016,src:'x'}]};
assert.deepEqual(U.toPreferred(e,5.5,'mmol/l'),{num:99.088,unit:'mg/dL',factor:18.016});
assert.deepEqual(U.toPreferred(e,99,'mg/100ml'),{num:99,unit:'mg/dL',factor:1});
assert.equal(U.toPreferred(e,5,'g/l'),null,'unknown unit: no conversion');assert.equal(U.toPreferred({},5,'mg/dl'),null,'no preferred unit');
assert.equal(U.toPreferred(e,NaN,'mmol/l'),null);assert.equal(U.fromPreferred(e,99.088,'mmol/L').num,5.5);
assert(U.accepts(e,'mmol/l')&&U.accepts(e,'mg/dl')&&!U.accepts(e,'g/l'));

// the catalog: every unit known, every factor sourced and positive, round trips, plausible bounds
const by=new Map(CAT.markers.map(m=>[m.name,m]));let factors=0;
for(const m of CAT.markers){
 if(m.unit!==undefined)assert(U.knownUnit(m.unit),m.name+': unit '+m.unit);
 for(const x of m.units||[]){
  factors++;assert(U.knownUnit(x.unit),m.name+': '+x.unit);assert(x.factor>0&&Number.isFinite(x.factor),m.name+' factor');
  assert(typeof x.src==='string'&&x.src.length>=20,m.name+' '+x.unit+' needs a source');assert(!U.sameUnit(x.unit,m.unit),m.name+': preferred unit listed again');
  for(const v of [0.01,1,7.25,123.4]){const p=U.toPreferred(m,v,x.unit);assert.equal(p.unit,m.unit);const back=U.fromPreferred(m,p.num,x.unit);assert(Math.abs(back.num-v)/v<1e-5,`${m.name} ${x.unit} round trip ${v} -> ${back.num}`)}
 }
 if(m.plausible){assert(m.unit,m.name+': plausible needs a unit');assert(m.plausible[0]<m.plausible[1],m.name+' plausible')}
 if(m.alt){assert(by.has(m.alt),m.name+' alt');assert.equal(by.get(m.alt).alt,m.name,m.name+': alt pairs point at each other');assert(!U.sameUnit(m.unit,by.get(m.alt).unit),m.name+': alt pair differs in unit')}
}
assert(factors>=35,'catalog declares conversions ('+factors+')');
// spot checks: textbook equivalents (value in the report unit -> expected value in the preferred unit, 1% tolerance)
const spot=[['Fasting blood sugar',5.5,'mmol/L',99],['Total cholesterol',5.2,'mmol/L',201],['LDL cholesterol',3.0,'mmol/L',116],['Triglycerides',1.7,'mmol/L',150.5],
 ['Creatinine: kidney blood marker',88.4,'µmol/L',1.0],['Uric acid',357,'µmol/L',6.0],['Total bilirubin',17.1,'µmol/L',1.0],['Urea: protein-breakdown waste',5.0,'mmol/L',30.0],
 ['Blood urea nitrogen (BUN)',5.0,'mmol/L',14.0],['Calcium',2.5,'mmol/L',10.02],['Calcium',5,'mEq/L',10.02],['Magnesium',0.85,'mmol/L',2.07],['Phosphate',1.0,'mmol/L',3.1],
 ['Iron circulating in blood',17.9,'µmol/L',100],['Vitamin D',75,'nmol/L',30],['Vitamin B12',300,'pmol/L',406.6],['Folate (vitamin B9)',22.66,'nmol/L',10],
 ['Thyroid hormone supply (free T4)',12.87,'pmol/L',1.0],['Active thyroid hormone (free T3)',4.6,'pmol/L',3.0],['Hemoglobin: oxygen-carrying protein',8.7,'mmol/L',14.0],
 ['Hemoglobin: oxygen-carrying protein',140,'g/L',14.0],['Hemoglobin concentration in red cells',20.5,'mmol/L',33.0],['Blood volume occupied by red cells',0.42,'L/L',42],
 ['White blood cell count',7500,'cells/cumm',7.5],['White blood cell count',7.5,'G/l',7.5],['Platelet count',2.5,'lakhs/cumm',250],['Platelet count',250000,'/µL',250],
 ['Red blood cell count',4.8,'mill/cumm',4.8],['ALT: liver-related enzyme',0.5,'µkat/L',30],['CRP: inflammation marker',0.5,'mg/dL',5],['Ferritin: iron stores',45,'µg/L',45],
 ['Thyroid control signal (TSH)',2.1,'µIU/mL',2.1],['Total blood protein',72,'g/L',7.2],['Iron transport protein',2.5,'g/L',250],['Sodium',140,'mEq/L',140]];
for(const [name,v,unit,want] of spot){const m=by.get(name);assert(m,name);const p=U.toPreferred(m,v,unit);assert(p,`${name}: ${unit} accepted`);assert(Math.abs(p.num-want)/want<0.01,`${name}: ${v} ${unit} -> ${p.num} ${m.unit}, expected about ${want}`)}
// a share and a count are never converted into each other; the unit picks the marker (labmap uses alt)
assert.equal(U.toPreferred(by.get('Neutrophils: share of white cells'),4.2,'10³/µL'),null);assert(U.accepts(by.get('Neutrophils: actual count'),'10^9/l'));
assert.equal(U.toPreferred(by.get('Average blood sugar (HbA1c)'),42,'mmol/mol'),null,'HbA1c % and mmol/mol are separate markers');
console.log(`PASS labunits: unit spellings and identities, ${factors} sourced catalog factors with round trips, ${spot.length} textbook spot checks, plausible bounds, alt pairs.`);
