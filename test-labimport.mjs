// Saving values read from a report (data model of migration 10), on fictional data: the link to the uploaded file
// (inbox item imported, file kept when the report goes, file delete refused while linked), canonical marker,
// name as printed, method and confidence, household custom markers and learned aliases (scoped per household,
// collisions refused, viewers refused), the read-only duplicate check, file hashes, mixed-unit series in the
// preferred unit, export and household deletion. Runs on node:sqlite here; test-workers.mjs covers the Durable Object.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Readable} from 'node:stream';
const dir=mkdtempSync(join(tmpdir(),'apni-labimport-'));process.env.DB_FILE=join(dir,'t.db');process.env.NO_PUSH='1';
const B=await import('./blobs.mjs');
const mem=new Map();
B.setBlobs({kind:'memory',put:async(k,b)=>{if(mem.has(k))throw Error('exists');mem.set(k,Buffer.from(b))},stat:async k=>mem.has(k)?{size:mem.get(k).length}:null,read:async k=>mem.get(k)??null,
 stream:k=>Readable.from([mem.get(k)]),delete:async k=>mem.delete(k),list:async p=>[...mem.keys()].filter(k=>k.startsWith(p)).sort().map(key=>({key,size:mem.get(key).length})),deletePrefix:async p=>{for(const k of [...mem.keys()])if(k.startsWith(p))mem.delete(k)}});
const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs'),ev=await import('./events.mjs'),L=await import('./labs.mjs'),R=await import('./datarights.mjs'),D=await import('./db.mjs');
try{
 S.enterAs(S.SYSTEM);
 const cols=t=>D.db().prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);
 assert(cols('lab_reports').includes('upload_id'));for(const c of ['marker','raw_name','method','confidence'])assert(cols('lab_values').includes(c),c);assert(cols('lab_markers').includes('aliases'));
 const h=S.createHousehold('Household A'),h2=S.createHousehold('Household B');
 S.addMember(h.id,{id:'alex',name:'Alex'});S.addMember(h.id,{id:'sam',name:'Sam'});S.addMember(h2.id,{id:'mia',name:'Mia'});
 const owner=A.createUser('owner@example.com'),viewer=A.createUser('viewer@example.com'),other=A.createUser('other@example.com');
 A.setMembership(h.id,owner.id,'owner');A.setMembership(h.id,viewer.id,'viewer');A.setMembership(h2.id,other.id,'owner');for(const u of [owner,viewer,other])C.recordConsent(u.id);
 const asOwner=fn=>S.runAs({type:'user',userId:owner.id,household:h.id},fn),asViewer=fn=>S.runAs({type:'user',userId:viewer.id,household:h.id},fn),asOther=fn=>S.runAs({type:'user',userId:other.id,household:h2.id},fn);
 const pdf=Buffer.from('%PDF-1.4 fictional').toString('base64');
 // uploads carry a sha256; the same bytes again point at the earlier upload
 const up=await asOwner(()=>ev.addInbox('alex',{category:'lab-report',date:'2000-01-12',title:'Example labs',fileName:'example labs.pdf',mimeType:'application/pdf',dataBase64:pdf}));
 assert.match(up.sha256,/^[0-9a-f]{64}$/);assert.equal(up.status,'needs-review');assert.equal(up.sameAs,undefined);
 const again=await asOwner(()=>ev.addInbox('alex',{category:'lab-report',date:'2000-01-12',title:'Same file',fileName:'copy.pdf',mimeType:'application/pdf',dataBase64:pdf}));
 assert.deepEqual(again.sameAs.map(x=>x.id),[up.id]);
 // save values read from the upload: canonical marker, printed name, method, confidence; custom marker and alias learned
 const body={date:'2000-01-12',title:'Lab report · Testlabor Musterstadt',uploadId:up.id,method:'pdf-text',
  values:[{name:'Hemoglobin: oxygen-carrying protein',rawName:'Hämoglobin',value:'14,2',unit:'g/dl',reference:'13,5 - 17,5',confidence:1,page:1},
   {name:'Ferritin: iron stores',rawName:'Ferritin (Hauslabor)',value:'45',unit:'ng/ml',confidence:0.95},
   {name:'Example family marker',value:'3,3',unit:'mg/l',confidence:0.9,method:'manual'}],
  learn:{custom:[{name:'Example family marker',unit:'mg/L'}],aliases:[{marker:'Ferritin: iron stores',alias:'Ferritin (Hauslabor)'}]}};
 await assert.rejects(async()=>asViewer(()=>L.addReport('alex',body)),/Read-only/,'viewers cannot save or learn');
 const r=asOwner(()=>L.addReport('alex',body));
 const saved=asOwner(()=>L.listReports('alex'))[0];
 assert.equal(saved.uploadId,up.id);assert.deepEqual(saved.values.map(v=>[v.marker,v.rawName,v.method,v.confidence]),[['Hemoglobin: oxygen-carrying protein','Hämoglobin','pdf-text',1],['Ferritin: iron stores','Ferritin (Hauslabor)','pdf-text',0.95],['Example family marker',null,'manual',0.9]]);
 const item=asOwner(()=>ev.listInbox('alex')).find(x=>x.id===up.id);assert.deepEqual([item.status,item.labReportId],['imported',r.id]);
 assert.throws(()=>asOwner(()=>L.addReport('alex',{...body,learn:undefined})),/already linked/,'one report per file');
 // household markers: visible to the household, not to another household; learned alias resolves next time
 const cat=asOwner(()=>L.catalogFor('sam'));assert.equal(cat.lookup('Ferritin (Hauslabor)').name,'Ferritin: iron stores');assert.equal(cat.lookup('example family marker').custom,true);
 assert.throws(()=>asOther(()=>L.catalogFor('alex')),S.AccessError);assert.equal(asOther(()=>L.catalogFor('mia')).lookup('Example family marker'),undefined,'other households do not see them');
 assert.throws(()=>asOther(()=>L.addReport('mia',{date:'2000-01-12',values:[{name:'Example family marker',value:'1'}]})),/Unknown marker/);
 assert.throws(()=>asOwner(()=>L.addReport('sam',{date:'2000-01-12',values:[{name:'Ferritin',value:'1'}],learn:{custom:[{name:'ferritin'}]}})),/already a marker name/);
 assert.throws(()=>asOwner(()=>L.addReport('sam',{date:'2000-01-12',values:[{name:'Ferritin',value:'1'}],learn:{aliases:[{marker:'Ferritin: iron stores',alias:'HbA1c'}]}})),/already names/);
 assert.throws(()=>asOwner(()=>L.addReport('sam',{date:'2000-01-12',values:[{name:'Ferritin',value:'1'}],learn:{aliases:[{marker:'Not a marker',alias:'X1'}]}})),/Unknown marker/);
 assert.throws(()=>asOwner(()=>L.addReport('alex',{date:'2000-01-12',method:'magic',values:[{name:'Ferritin',value:'1'}]})),/method/);
 assert.throws(()=>asOwner(()=>L.addReport('alex',{date:'2000-01-12',values:[{name:'Ferritin',value:'1',confidence:2}]})),/confidence/);
 assert.throws(()=>asOwner(()=>L.addReport('alex',{date:'2000-01-12',uploadId:'not-a-uuid',values:[{name:'Ferritin',value:'1'}]})),/Attached file/);
 assert.throws(()=>asOwner(()=>L.addReport('sam',{date:'2000-01-12',uploadId:again.id,values:[{name:'Ferritin',value:'1'}]})),/Attached file not found/,'the file must belong to the same profile');
 assert.throws(()=>asOwner(()=>L.addReport('alex',{date:'2000-01-12',source:'photo.jpg',values:[{name:'Ferritin',value:'1'}]})),/Source/,'image names only with an upload');
 assert(asOwner(()=>L.addReport('alex',{date:'2000-01-13',source:'photo.jpg',uploadId:again.id,method:'ocr',values:[{name:'Ferritin',value:'50',unit:'µg/l'}]})).id);
 // duplicate check: same date, equal values after unit conversion
 const chk=asOwner(()=>L.checkDuplicates('alex',{date:'2000-01-12',values:[{marker:'Hemoglobin: oxygen-carrying protein',num:142,unit:'g/L'},{marker:'Ferritin: iron stores',num:45,unit:'µg/L'},{marker:'Example family marker',num:3.3,unit:'mg/l'}]}));
 assert.deepEqual(chk.reports.map(x=>[x.id,x.overlap]),[[r.id,1]]);assert.deepEqual(chk.duplicates.sort(),['Example family marker','Ferritin: iron stores','Hemoglobin: oxygen-carrying protein']);
 const chk2=asOwner(()=>L.checkDuplicates('alex',{date:'2000-01-12',values:[{marker:'Hemoglobin',num:15,unit:'g/dl'},{marker:'Ferritin',num:45,unit:'ng/ml'}]}));assert.deepEqual([chk2.reports.length,chk2.duplicates],[0,['Ferritin: iron stores']],'below 80% overlap: only the equal marker is reported');
 assert.deepEqual(asOwner(()=>L.checkDuplicates('alex',{date:'2000-02-01',values:[{marker:'Ferritin',num:45,unit:'ng/ml'}]})),{reports:[],duplicates:[]});
 assert.throws(()=>asOwner(()=>L.checkDuplicates('alex',{date:'nope'})),/date/);
 // deleting the linked file is refused; deleting the report keeps the file and makes it readable again
 await assert.rejects(asOwner(()=>ev.deleteInbox('alex',up.id)),/Delete that report first/);
 assert.equal(asOwner(()=>L.deleteReport('alex',r.id)),true);
 const back=asOwner(()=>ev.listInbox('alex')).find(x=>x.id===up.id);assert.deepEqual([back.status,back.labReportId],['needs-review',undefined]);assert(mem.size===2,'file kept');
 assert.equal(await asOwner(()=>ev.deleteInbox('alex',up.id)),true);
 // mixed units in one series: charted in the preferred unit, with what the report said; one unit: left as reported
 asOwner(()=>L.addReport('sam',{date:'2000-01-01',values:[{name:'Creatinine',value:'1.0',unit:'mg/dL',reference:'0.7 - 1.2'},{name:'Hemoglobin',value:'13.4',unit:'g/dL'}]}));
 asOwner(()=>L.addReport('sam',{date:'2000-03-01',values:[{name:'Kreatinin',value:'97',unit:'µmol/l',reference:'62 - 106'},{name:'Hemoglobin',value:'13.9',unit:'g/dL'}]}));
 const ss=asOwner(()=>L.series('sam')),cr=ss.measurements.find(m=>m.name==='Creatinine: kidney blood marker'),hb=ss.measurements.find(m=>m.name==='Hemoglobin: oxygen-carrying protein');
 assert.deepEqual(cr.points.map(p=>[p.unit,p.n]),[['mg/dL',1],['mg/dL',1.09707]]);assert.equal(cr.latest.display,'1.1 mg/dL (reported 97 µmol/l)');assert.equal(cr.latest.range,'0.701 - 1.2');assert.deepEqual(cr.latest.original,{value:'97',unit:'µmol/l',range:'62 - 106'});
 assert.deepEqual(hb.points.map(p=>[p.display,p.original]),[['13.4 g/dL',undefined],['13.9 g/dL',undefined]],'single-unit series unchanged');
 assert.equal(ss.measurements.find(m=>m.name==='Ferritin: iron stores'),undefined);
 // export: household markers included; household deletion removes them
 const exp=await R.exportData(owner);const hx=exp.data.households.find(x=>x.id===h.id);
 assert.deepEqual(hx.labMarkers.map(m=>[m.name,m.aliases]),[['Example family marker',[]],['Ferritin: iron stores',['Ferritin (Hauslabor)']]]);
 assert(hx.members.find(m=>m.id==='alex').records.lab_values.some(v=>v.method==='ocr'),'new columns exported');
 D.db().prepare('DELETE FROM households WHERE id=?').run(h.id);assert.equal(D.db().prepare('SELECT COUNT(*) n FROM lab_markers WHERE household_id=?').get(h.id).n,0);
 console.log('PASS labimport: migration 10, upload link + imported status, one report per file, file kept and readable again, linked file delete refused, canonical marker/printed name/method/confidence, household custom markers and aliases (scoped, collisions and viewers refused), duplicate check, sha256 + sameAs, mixed-unit series, export, household delete.');
}finally{D.close();rmSync(dir,{recursive:true,force:true})}
