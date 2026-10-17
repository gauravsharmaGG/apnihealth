// labs.mjs: catalog and aliases, report validation, per-member storage and the explorer series (fictional data only).
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';
const dir=mkdtempSync(tmpdir()+'/apni-labs-');process.env.DB_FILE=dir+'/l.db';
const L=await import('./labs.mjs'),S=await import('./store.mjs'),D=await import('./db.mjs');
const priv=dir+'/private';mkdirSync(priv);
try{
 // catalog: default markers, case-insensitive names and aliases, private additions merged in
 const def=L.catalog(dir+'/none');assert(def.markers.length>50);assert.equal(def.lookup('  ferritin ')?.name,L.catalog(dir+'/none').lookup('Ferritin').name);
 writeFileSync(priv+'/markers.json',JSON.stringify({markers:[{name:'Ferritin: iron stores',aliases:['Ferritin (example lab)']},{name:'Example marker',group:'Example group',meaning:'A fictional marker.',aliases:['Ex']}]}));
 const cat=L.catalog(priv);assert.equal(cat.lookup('ferritin (example lab)').name,'Ferritin: iron stores');assert.equal(cat.lookup('ex').group,'Example group');
 assert(cat.lookup('Ferritin'),'default aliases are kept when private/markers.json extends an entry');
 writeFileSync(dir+'/bad.json','{');mkdirSync(dir+'/badp');writeFileSync(dir+'/badp/markers.json','{');assert.throws(()=>L.catalog(dir+'/badp'),/not valid JSON/);
 const h=S.createHousehold('Example household');for(const m of [{id:'alex',name:'Alex'},{id:'sam',name:'Sam'},{id:'mia',name:'Mia',kind:'child'}])S.addMember(h.id,m);
 const opts={privateDir:priv};
 // validation
 const ok={date:'2000-01-10',values:[{name:'Ferritin',value:'45',unit:'ng/mL',reference:'30-300'}]};
 for(const [bad,re] of [[{...ok,date:'2000-02-30'},/valid report date/],[{...ok,date:'2999-01-01'},/future/],[{...ok,values:[]},/at least one/],[{...ok,values:[{name:'Ferritin',value:'high'}]},/needs a number/],
  [{...ok,values:[{name:'Not a real marker',value:'1'}]},/Unknown marker name: Not a real marker/],[{...ok,values:[{value:'1'}]},/marker name/],[{...ok,source:'../x.pdf'},/Source/],[{...ok,source:'.hidden.pdf'},/Source/],
  [{...ok,values:Array.from({length:201},()=>({name:'Ferritin',value:'1'}))},/At most 200/],[{...ok,values:[{name:'Ferritin',value:'1',page:0}]},/page/],[null,/object/]])
  assert.throws(()=>L.validateReport(bad,opts),re,JSON.stringify(bad)?.slice(0,80));
 const v=L.validateReport({...ok,values:[{name:'Ex',value:'6,8 mg/L ↑'},{name:'ferritin',value:'12',flag:'low'}]},opts);
 assert.deepEqual(v.values.map(x=>[x.value,x.num,x.unit,x.flag]),[['6,8 mg/L',6.8,'mg/L','high'],['12',12,null,'low']],'arrows become flags, units are read from the value, decimal commas parse');
 // storage, per member
 const r1=L.addReport('alex',{date:'2000-01-10',title:'Example labs',values:[{name:'Ferritin',value:'45',unit:'ng/mL',reference:'30-300'},{name:'Ex',value:'3'}],pending:[{name:'Example marker',note:'Waiting'}]},opts);
 const r2=L.addReport('alex',{date:'2000-03-01',preliminary:true,reported:'2000-03-03',source:'example labs (2).pdf',values:[{name:'Ferritin (example lab)',value:'25',unit:'ng/mL',reference:'30-300',flag:'low',page:2}]},opts);
 L.addReport('alex',{date:'1999-12-01',screening:true,values:[{name:'Ex',value:'2 units',reference:'ignored'}]},opts);
 L.addReport('sam',{date:'2000-02-01',values:[{name:'Ferritin',value:'80',unit:'ng/mL'}]},opts);
 assert.throws(()=>L.addReport('nobody',ok,opts),S.AccessError);assert.throws(()=>L.addReport('../alex',ok,opts),S.AccessError);
 assert.equal(L.listReports('alex').length,3);assert.equal(L.listReports('sam').length,1);assert.equal(L.listReports('mia').length,0);
 assert.deepEqual(L.listReports('alex').map(r=>r.date),['1999-12-01','2000-01-10','2000-03-01'],'reports are sorted by date');
 assert.equal(L.deleteReport('sam',r1.id),false,'a report can only be deleted by its own member');
 // explorer series
 const s=L.series('alex',opts),fe=s.measurements.find(m=>m.name==='Ferritin: iron stores'),ex=s.measurements.find(m=>m.name==='Example marker');
 assert.equal(fe.points.length,2);assert.deepEqual(fe.points.map(p=>[p.date,p.display,p.status]),[['2000-01-10','45 ng/mL','range'],['2000-03-01','25 ng/mL','low']]);
 assert.equal(fe.latest.preliminary,true);assert.equal(fe.latest.reported,'2000-03-03');assert.equal(fe.latest.source,'example labs (2).pdf');assert.equal(fe.latest.page,2);assert.match(fe.latest.note,/Preliminary/);
 assert.deepEqual(fe.aliases.sort(),['Ferritin','Ferritin (example lab)']);assert.equal(fe.points[0].source,null,'results typed into the app have no source file');
 assert.deepEqual(ex.points.map(p=>[p.status,p.range,p.display]),[['screening',null,'2 units'],['range',null,'3']]);
 assert.deepEqual(s.pending.map(p=>[p.name,p.note]),[['Example marker','Waiting']]);
 assert.deepEqual(L.series('sam',opts).measurements.map(m=>[m.name,m.points.length]),[['Ferritin: iron stores',1]],'members are isolated');
 assert.deepEqual(L.series('mia',opts),{measurements:[],pending:[]});
 // delete cascades to values and pending results
 assert.equal(L.deleteReport('alex',r1.id),true);assert.equal(L.series('alex',opts).pending.length,0);
 assert.equal(D.db().prepare("SELECT COUNT(*) n FROM lab_values WHERE report_id=?").get(r1.id).n,0);
 // removing a member removes its lab data
 D.db().prepare("DELETE FROM members WHERE id='sam'").run();assert.equal(D.db().prepare("SELECT COUNT(*) n FROM lab_reports WHERE member_id='sam'").get().n,0);
 assert(r2.id);
 console.log('PASS labs: catalog + aliases + private markers, validation, flags/units, per-member storage and isolation, series, pending, delete cascade.');
}finally{D.close();rmSync(dir,{recursive:true,force:true})}
