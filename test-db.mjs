// db.mjs + store.mjs: migrations, constraints, the member access check and transactions (fictional data only).
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';
const dir=mkdtempSync(tmpdir()+'/apni-db-');process.env.DB_FILE=dir+'/test.db';
const D=await import('./db.mjs'),S=await import('./store.mjs');
const {MIGRATIONS}=await import('./migrations.mjs');
S.enterAs(S.SYSTEM);
try{
 const d=D.db();
 assert.equal(D.version(d),MIGRATIONS.at(-1).version,'migrated to the latest version on open');
 assert.equal(statSync(process.env.DB_FILE).mode&0o777,0o600,'database file is owner-only');
 D.migrate(d);assert.equal(d.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,MIGRATIONS.length,'migrate is idempotent');
 assert.equal(d.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 // a database from a newer app version is refused
 d.prepare('INSERT INTO schema_migrations VALUES(999,?,?)').run('future','now');assert.throws(()=>D.migrate(d),/newer than this app/);d.prepare('DELETE FROM schema_migrations WHERE version=999').run();
 // households and members
 const h=S.createHousehold('Example household'),h2=S.createHousehold('Other household');
 S.addMember(h.id,{id:'alex',name:'Alex',labs:true,color:'#157667'});S.addMember(h.id,{id:'mia',name:'Mia',kind:'child'});S.addMember(h2.id,{id:'sam',name:'Sam'});
 assert.deepEqual(S.listMembers(h.id).map(m=>m.id),['alex','mia']);assert.deepEqual(S.listMembers().map(m=>m.id),['alex','mia','sam']);
 assert.equal(S.listMembers(h.id)[1].labs,false);assert.equal(S.listMembers(h.id)[0].initial,'A');
 assert.throws(()=>S.addMember(h.id,{id:'alex',name:'Again'}),/UNIQUE|constraint/i);
 for(const bad of [{id:'Bad',name:'X'},{id:'x y',name:'X'},{id:'x',name:''},{id:'x',name:'X',kind:'pet'},{id:'x',name:'X',color:'red'}])assert.throws(()=>S.addMember(h.id,bad));
 assert.throws(()=>d.prepare("INSERT INTO members(id,household_id,name,initial,kind,created_at) VALUES('../x',?,'X','X','adult','now')").run(h.id),/CHECK/,'the schema also rejects unsafe ids');
 assert.throws(()=>d.prepare("INSERT INTO log_entries VALUES('e1','nobody','steps','2000-01-01',1,'manual',0)").run(),/FOREIGN KEY/);
 // the access check
 assert.throws(()=>S.forMember('nobody'),S.AccessError);assert.throws(()=>S.forMember(''),S.AccessError);assert.throws(()=>S.forMember(undefined),S.AccessError);
 // actors: a user sees only households they belong to, with their role; no actor means no access
 const Acc=await import('./accounts.mjs');
 const owner=Acc.createUser('owner@example.com'),viewer=Acc.createUser('viewer@example.com'),other=Acc.createUser('other@example.com');
 Acc.setMembership(h.id,owner.id,'owner');Acc.setMembership(h.id,viewer.id,'viewer');Acc.setMembership(h2.id,other.id,'editor');
 const asUser=(u,hh,fn)=>S.runAs({type:'user',userId:u.id,household:hh},fn);
 assert.equal(asUser(owner,h.id,()=>S.forMember('alex').role),'owner');
 assert.throws(()=>asUser(owner,h.id,()=>S.forMember('sam')),/Unknown profile/,'a member of another household looks unknown');
 assert.throws(()=>asUser(other,h2.id,()=>S.forMember('alex')),/Unknown profile/);
 assert.throws(()=>asUser(other,h.id,()=>S.forMember('alex')),/Unknown profile/,'claiming another household does not help');
 assert.equal(asUser(other,h2.id,()=>S.forMember('sam').role),'editor');
 const ins0="INSERT INTO log_entries(id,member_id,metric,date,value,source,ts) VALUES($id,$member,'steps','2000-01-01',1,'manual',1)";
 assert.throws(()=>asUser(viewer,h.id,()=>S.forMember('alex').run(ins0,{id:'v1'})),/Read-only/,'viewers cannot write');
 assert.deepEqual(asUser(viewer,h.id,()=>S.forMember('alex').all('SELECT id FROM log_entries WHERE member_id=$member')),[],'viewers can read');
 assert.equal(S.runAs({type:'ingest',household:h.id,memberId:'alex'},()=>S.forMember('alex').role),'editor');
 assert.throws(()=>S.runAs({type:'ingest',household:h.id,memberId:'alex'},()=>S.forMember('mia')),/Unknown profile/,'a member token reaches one member');
 assert.throws(()=>S.runAs({type:'ingest',household:h.id},()=>S.forMember('sam')),/Unknown profile/,'a household token stays in its household');
 assert.equal(await new Promise(ok=>setImmediate(()=>ok(S.runAs(undefined,()=>{try{S.forMember('alex');return 'allowed'}catch(e){return e.message}})))),'No access context','no actor, no access');
 const a=S.forMember('alex'),m=S.forMember('mia');
 assert.throws(()=>a.all('SELECT * FROM log_entries'),/not scoped/);
 assert.throws(()=>a.all('SELECT * FROM log_entries WHERE member_id=?',['mia']),/not scoped/);
 assert.throws(()=>a.all('SELECT * FROM log_entries WHERE member_id=$member',{member:'mia'}),/bound by the store/);
 const ins="INSERT INTO log_entries(id,member_id,metric,date,value,source,ts) VALUES($id,$member,'steps','2000-01-01',$v,'manual',1)";
 assert.throws(()=>a.run("INSERT INTO log_entries VALUES($id,'mia','steps','2000-01-01',1,'manual',1)",{id:'x'}),/not scoped/,'an insert must name member_id and use $member');
 a.run(ins,{id:'e1',v:1000});m.run(ins,{id:'e2',v:2000});
 assert.deepEqual(a.all('SELECT id FROM log_entries WHERE member_id=$member').map(r=>r.id),['e1']);
 assert.deepEqual(m.all('SELECT id FROM log_entries WHERE member_id=$member').map(r=>r.id),['e2']);
 assert.equal(a.run('DELETE FROM log_entries WHERE member_id=$member AND id=$id',{id:'e2'}).changes,0,'cannot delete another member\'s row');
 // document tables keep order and isolation
 const ep=S.docs('episodes');
 ep.replace('alex',[{id:'b',title:'Second'},{id:'a',title:'First'}]);ep.replace('mia',[{id:'a',title:'Same id, other member'}]);
 assert.deepEqual(ep.list('alex').map(r=>r.id),['b','a']);assert.equal(ep.list('mia')[0].title,'Same id, other member');
 S.docs('appointments').replace('alex',[{id:'x',date:'2000-01-02',status:'scheduled'}]);
 assert.equal(a.get('SELECT date,status FROM appointments WHERE member_id=$member').date,'2000-01-02');
 assert.throws(()=>ep.replace('alex',[{id:'ok'},{title:'no id'}]),/needs an id/);assert.deepEqual(ep.list('alex').map(r=>r.id),['b','a'],'a failed replace leaves the old list');
 assert.throws(()=>S.docs('members'),/Unknown document table/);
 // transactions roll back and nest
 assert.throws(()=>a.tx(()=>{a.run(ins,{id:'e3',v:1});a.tx(()=>{throw Error('boom')})}),/boom/);
 assert.equal(a.get("SELECT COUNT(*) n FROM log_entries WHERE member_id=$member").n,1);
 // deleting a member removes its data
 d.prepare("DELETE FROM members WHERE id='mia'").run();assert.equal(d.prepare('SELECT COUNT(*) n FROM episodes').get().n,2);assert.equal(d.prepare("SELECT COUNT(*) n FROM log_entries WHERE member_id='mia'").get().n,0);
 console.log('PASS db: migrations, owner-only file, constraints, member access check, scoped queries, documents, transactions, cascade, actors and roles.');
}finally{D.close();rmSync(dir,{recursive:true,force:true})}
