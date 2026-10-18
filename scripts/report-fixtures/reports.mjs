// Synthetic lab reports for testing the report reader. Everything here is made up: fake labs ("Testlabor
// Musterstadt", "Example Diagnostics"), a fake person ("Test Person"), dates in 2000, and values chosen to exercise
// the parser (decimal comma, flags, unit styles, unmapped names, a text result). The layouts copy common report
// styles (German, Indian, US) without any real report's content.
//
// Each row: [name, value, unit, range, flag] as printed, plus `want`: the expected reading (marker name or null when
// the reader should leave it unmapped, the number, and the flag after reading the printed range).
export const PERSON={name:'Test Person',born:'01.01.1990'};
const r=(name,value,unit,range,flag,want)=>({name,value,unit,range,flag:flag||'',want});
export const REPORTS=[
 {id:'de-labor',lang:'de',pdf:true,locale:'de',
  lab:'Testlabor Musterstadt',header:['Untersuchung','Ergebnis','','Einheit','Referenzbereich'],
  meta:[['Patient: Test Person','Geb.: 01.01.1990'],['Abnahme: 12.01.2000','Befunddatum: 14.01.2000']],date:'2000-01-12',reported:'2000-01-14',
  pages:[[
   r('Hämoglobin','14,2','g/dl','13,5 - 17,5','',{marker:'Hemoglobin: oxygen-carrying protein',num:14.2,flag:null}),
   r('Leukozyten','11,8','Tsd/µl','3,9 - 10,2','H',{marker:'White blood cell count',num:11.8,flag:'high'}),
   r('Erythrozyten','4,9','Mio/µl','4,3 - 5,8','',{marker:'Red blood cell count',num:4.9,flag:null}),
   r('Thrombozyten','250','Tsd/µl','150 - 370','',{marker:'Platelet count',num:250,flag:null}),
   r('Hämatokrit','42','%','40 - 52','',{marker:'Blood volume occupied by red cells',num:42,flag:null}),
   r('MCV','88','fl','80 - 99','',{marker:'Red blood cell size (MCV)',num:88,flag:null}),
   r('Neutrophile','58','%','40 - 75','',{marker:'Neutrophils: share of white cells',num:58,flag:null}),
   r('Neutrophile absolut','6,8','Tsd/µl','1,8 - 7,7','',{marker:'Neutrophils: actual count',num:6.8,flag:null}),
   r('GPT (ALAT)','32','U/l','< 50','',{marker:'ALT: liver-related enzyme',num:32,flag:null}),
   r('GOT (ASAT)','28','U/l','< 50','',{marker:'AST: liver and muscle enzyme',num:28,flag:null}),
   r('Gamma-GT','61','U/l','< 60','H',{marker:'GGT: liver and bile-duct enzyme',num:61,flag:'high'}),
   r('Kreatinin','88','µmol/l','62 - 106','',{marker:'Creatinine: kidney blood marker',num:88,flag:null}),
  ],[
   r('Glucose nüchtern','92','mg/dl','70 - 99','',{marker:'Fasting blood sugar',num:92,flag:null}),
   r('HbA1c (IFCC)','38','mmol/mol','20 - 42','',{marker:'Average blood sugar: alternate units',num:38,flag:null}),
   r('Cholesterin gesamt','231','mg/dl','< 200','H',{marker:'Total cholesterol',num:231,flag:'high'}),
   r('LDL-Cholesterin','162','mg/dl','< 116','H',{marker:'LDL cholesterol',num:162,flag:'high'}),
   r('HDL-Cholesterin','48','mg/dl','> 40','',{marker:'HDL cholesterol',num:48,flag:null}),
   r('Triglyceride','1,9','mmol/l','< 1,7','H',{marker:'Triglycerides',num:1.9,flag:'high'}),
   r('Ferritin','45','ng/ml','30 - 400','',{marker:'Ferritin: iron stores',num:45,flag:null}),
   r('TSH basal','2,10','mU/l','0,27 - 4,20','',{marker:'Thyroid control signal (TSH)',num:2.1,flag:null}),
   r('Vitamin D (25-OH)','18','ng/ml','30 - 100','L',{marker:'Vitamin D',num:18,flag:'low'}),
   r('Exotischer Testwert','3,3','mg/l','< 5','',{marker:null}),
  ]]},
 {id:'in-path',lang:'en',pdf:true,locale:'en',
  lab:'Example Diagnostics Pvt. Ltd.',header:['Test Name','Result','','Unit','Bio. Ref. Interval'],
  meta:[['Name: Test Person','Age/Sex: 30 Y / M'],['Collected on: 05-Feb-2000','Reported on: 06-Feb-2000']],date:'2000-02-05',reported:'2000-02-06',
  pages:[[
   r('Haemoglobin','13.5','g/dL','13.0 - 17.0','',{marker:'Hemoglobin: oxygen-carrying protein',num:13.5,flag:null}),
   r('Total Leucocyte Count (TLC)','7,500','cells/cumm','4000 - 11000','',{marker:'White blood cell count',num:7500,flag:null}),
   r('Platelet Count','2.5','lakhs/cumm','1.5 - 4.5','',{marker:'Platelet count',num:2.5,flag:null}),
   r('RBC Count','4.8','mill/cumm','4.5 - 5.5','',{marker:'Red blood cell count',num:4.8,flag:null}),
   r('PCV','44.0','%','40 - 50','',{marker:'Blood volume occupied by red cells',num:44,flag:null}),
   r('SGPT','45','U/L','0 - 40','',{marker:'ALT: liver-related enzyme',num:45,flag:'high'}),
   r('SGOT','30','U/L','0 - 40','',{marker:'AST: liver and muscle enzyme',num:30,flag:null}),
   r('Fasting Blood Sugar','110','mg/dL','70 - 100','',{marker:'Fasting blood sugar',num:110,flag:'high'}),
   r('Glycated Haemoglobin (HbA1c)','6.1','%','4.0 - 5.6','',{marker:'Average blood sugar (HbA1c)',num:6.1,flag:'high'}),
   r('Serum Creatinine','1.1','mg/dL','0.7 - 1.3','',{marker:'Creatinine: kidney blood marker',num:1.1,flag:null}),
   r('Blood Urea','28','mg/dL','15 - 40','',{marker:'Urea: protein-breakdown waste',num:28,flag:null}),
   r('Serum Uric Acid','7.9','mg/dL','3.5 - 7.2','',{marker:'Uric acid',num:7.9,flag:'high'}),
   r('Vitamin B12','800','pg/mL','200 - 900','',{marker:'Vitamin B12',num:800,flag:null}),
   r('Vitamin D (25-OH)','18','ng/mL','30 - 100','',{marker:'Vitamin D',num:18,flag:'low'}),
   r('TSH (Ultrasensitive)','2.4','µIU/mL','0.35 - 5.50','',{marker:'Thyroid control signal (TSH)',num:2.4,flag:null}),
   r('Mean Platelet Volume','10.2','fL','7.5 - 11.5','',{marker:null}),
  ]]},
 {id:'en-us',lang:'en',pdf:true,locale:'en',
  lab:'Example Clinical Laboratory',header:['Test','Result','Flag','Units','Reference Range'],
  meta:[['Patient: Test Person','DOB: 01/01/1990'],['Collection date: 03/15/2000','Report date: 03/16/2000']],date:'2000-03-15',reported:'2000-03-16',usDates:true,
  pages:[[
   r('Glucose, Fasting','104','mg/dL','65 - 99','H',{marker:'Fasting blood sugar',num:104,flag:'high'}),
   r('Cholesterol, Total','214','mg/dL','< 200','H',{marker:'Total cholesterol',num:214,flag:'high'}),
   r('HDL Cholesterol','52','mg/dL','> 39','',{marker:'HDL cholesterol',num:52,flag:null}),
   r('LDL Cholesterol, Calculated','139','mg/dL','< 100','H',{marker:'LDL cholesterol',num:139,flag:'high'}),
   r('Triglycerides','115','mg/dL','< 150','',{marker:'Triglycerides',num:115,flag:null}),
   r('Sodium','140','mmol/L','135 - 146','',{marker:'Sodium',num:140,flag:null}),
   r('Potassium','4.3','mmol/L','3.5 - 5.3','',{marker:'Potassium',num:4.3,flag:null}),
   r('Calcium','9.6','mg/dL','8.6 - 10.3','',{marker:'Calcium',num:9.6,flag:null}),
   r('Albumin','4.5','g/dL','3.6 - 5.1','',{marker:'Albumin: main blood protein',num:4.5,flag:null}),
   r('Alkaline Phosphatase','72','U/L','35 - 115','',{marker:'ALP: bile-duct and bone enzyme',num:72,flag:null}),
   r('Bilirubin, Total','0.8','mg/dL','0.2 - 1.2','',{marker:'Total bilirubin',num:0.8,flag:null}),
   r('eGFR','92','mL/min/1.73m2','> 59','',{marker:'Estimated kidney filtering ability',num:92,flag:null}),
  ]]},
 // Devanagari names: PNG only (the PDF writer has no Devanagari font). Most printed Indian reports are English.
 {id:'hi-mixed',lang:'hin',pdf:false,locale:'en',
  lab:'Example Pathology Lab',header:['जाँच','परिणाम','','इकाई','संदर्भ'],
  meta:[['Name: Test Person',''],['Collected on: 10-Apr-2000','']],date:'2000-04-10',
  pages:[[
   r('हीमोग्लोबिन','12.9','g/dL','12.0 - 15.0','',{marker:'Hemoglobin: oxygen-carrying protein',num:12.9,flag:null}),
   r('कोलेस्ट्रॉल','190','mg/dL','< 200','',{marker:'Total cholesterol',num:190,flag:null}),
   r('प्लेटलेट्स','2.1','lakhs/cumm','1.5 - 4.5','',{marker:'Platelet count',num:2.1,flag:null}),
  ]]},
];
// Photo variants of the HTML rendering: CSS applied to the page before the screenshot.
export const PHOTO_VARIANTS={plain:'',rotated:'transform:rotate(1.2deg);transform-origin:50% 0',blurred:'filter:blur(0.7px)',lowcontrast:'filter:contrast(0.45) brightness(1.15)'};
