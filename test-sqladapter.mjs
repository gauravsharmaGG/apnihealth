// sqladapter.mjs: the synchronous storage interface. $name -> ? translation, binding checks, and the same
// behaviour from the node:sqlite backend and the Durable Object backend. The Durable Object side runs against a
// fake ctx.storage built on node:sqlite that behaves like the real one where it matters: positional values only
// (an object is silently stored as "[object Object]"), BEGIN/COMMIT/SAVEPOINT and PRAGMA journal_mode refused,
// transactions only through transactionSync. Then the real data modules run on the Durable Object backend.
// Fictional data only.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'apni-sqladapter-'));
process.env.DB_FILE=join(dir,'unused.db');process.env.NO_PUSH='1';
const A=await import('./sqladapter.mjs'),D=await import('./db.mjs'),{MIGRATIONS}=await import('./migrations.mjs');
const {DatabaseSync}=await import('node:sqlite');

// A stand-in for a SQLite-backed Durable Object's ctx.storage.
function fakeStorage(){
 const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');
 let inTx=false;const calls={exec:0,objects:0};
 const refuse=q=>{if(/^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(q)||/PRAGMA\s+journal_mode/i.test(q))throw Error('not authorized: use state.storage.transactionSync()')};
 const cursor=rows=>({toArray:()=>rows,one(){if(rows.length!==1)throw Error('Expected exactly one result from SQL query, but got '+rows.length);return rows[0]},[Symbol.iterator]:()=>rows[Symbol.iterator]()});
 return {calls,raw,
  sql:{exec(q,...values){
   calls.exec++;refuse(q);
   values=values.map(v=>{if(v!==null&&typeof v==='object'&&!(v instanceof Uint8Array)&&!(v instanceof ArrayBuffer)){calls.objects++;return String(v)}return v}); // the silent mis-bind
   if(!values.length&&q.includes(';')){raw.exec(q);return cursor([])}
   return cursor(raw.prepare(q).all(...values).map(r=>{const o={...r};for(const k in o)if(o[k] instanceof Uint8Array)o[k]=o[k].buffer.slice(o[k].byteOffset,o[k].byteOffset+o[k].byteLength);return o})); // BLOBs as ArrayBuffer, like a Durable Object
  }},
  transactionSync(fn){
   if(inTx)throw Error('nested transactionSync not expected (the adapter joins nested calls)');
   inTx=true;raw.exec('SAVEPOINT tx');
   try{const r=fn();raw.exec('RELEASE tx');return r}catch(e){raw.exec('ROLLBACK TO tx');raw.exec('RELEASE tx');throw e}finally{inTx=false}
  },
 };
}

try{
 // ---- translation ----
 const t=A.namedToPositional('SELECT * FROM t WHERE a=$a AND b=:b AND c=@c AND d=$a');
 assert.equal(t.sql,'SELECT * FROM t WHERE a=? AND b=? AND c=? AND d=?');assert.deepEqual(t.names,['a','b','c']);assert.deepEqual(t.order,['a','b','c','a']);
 assert.deepEqual(A.bindings(t,[{a:1,b:2,c:3}]),[1,2,3,1],'a name used twice is bound twice');
 const lit=A.namedToPositional(`SELECT '$x', 'it''s $y', "col:z", [@w] -- $c\n, x/* :d */ FROM t WHERE e=$e`);
 assert.equal(lit.sql,`SELECT '$x', 'it''s $y', "col:z", [@w] -- $c\n, x/* :d */ FROM t WHERE e=?`,'literals, identifiers and comments untouched');assert.deepEqual(lit.names,['e']);
 assert.deepEqual(A.namedToPositional('SELECT ? , ?2').names,null);assert.equal(A.namedToPositional('SELECT ?').sql,'SELECT ?');
 assert.equal(A.namedToPositional('SELECT $1').names,null,'$ followed by a digit is not a name');
 assert.throws(()=>A.namedToPositional('SELECT ? WHERE a=$a'),/mix/);
 assert.equal(A.namedToPositional('SELECT $q'),A.namedToPositional('SELECT $q'),'cached per statement');
 // ---- binding checks ----
 const b=A.namedToPositional('INSERT INTO t VALUES($a,$b)');
 assert.deepEqual(A.bindings(b,[{a:1,$b:'x'}]),[1,'x'],'bare and $-prefixed keys');
 assert.deepEqual(A.bindings(b,[{a:1}]),[1,null],'a missing name binds NULL (as node:sqlite)');
 assert.throws(()=>A.bindings(b,[{a:1,c:2}]),/Unknown named parameter 'c'/);
 assert.throws(()=>A.bindings(b,[1,2]),/pass one object/);
 assert.throws(()=>A.bindings(A.namedToPositional('SELECT ?'),[{a:1}]),/positional/,'an object is never passed on as a value');
 assert.throws(()=>A.bindings(A.namedToPositional('SELECT ?'),[undefined]),/undefined/);
 assert.throws(()=>A.bindings(A.namedToPositional('SELECT ?'),[true]),/can be bound/);
 assert.throws(()=>A.bindings(b,[{a:{nested:1}}]),/can be bound/);
 assert.deepEqual(A.bindings(A.namedToPositional('SELECT ?'),[Buffer.from('hi')]),[Buffer.from('hi')]);
 // the fake really mis-binds objects silently, like the real Durable Object (so the checks above matter)
 {const f=fakeStorage();f.sql.exec('CREATE TABLE t(a)');f.sql.exec('INSERT INTO t VALUES(?)',{$a:1});assert.equal(f.sql.exec('SELECT a FROM t').one().a,'[object Object]');}

 // ---- both backends behave the same ----
 const backends={node:()=>A.nodeAdapter(new DatabaseSync(':memory:')),do:()=>{const f=fakeStorage();return {...A.doAdapter(f),fake:f}}};
 const results={};
 for(const [name,make] of Object.entries(backends)){
  const d=make(),r=results[name]=[];
  if(name==='node')d.exec('PRAGMA foreign_keys=ON');
  D.migrate(d);r.push(D.version(d));
  assert.equal(D.version(d),MIGRATIONS.at(-1).version,name+': every migration applies');
  D.migrate(d);r.push(d.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n);
  d.exec('CREATE TABLE t(id TEXT PRIMARY KEY, n INTEGER, b BLOB, p TEXT REFERENCES t(id) ON DELETE CASCADE)');
  const ins=d.prepare('INSERT INTO t(id,n,b,p) VALUES($id,$n,$b,$p)');
  ins.run({id:'a',n:1,b:Buffer.from([1,2,3]),p:null});ins.run({id:'b',n:2,p:'a'});d.prepare('INSERT INTO t(id,n) VALUES(?,?)').run('c',3);
  r.push(d.prepare('SELECT id,n,p FROM t ORDER BY id').all().map(x=>({...x})));
  {const blob=d.prepare('SELECT b FROM t WHERE id=$id').get({id:'a'}).b;assert(blob instanceof Uint8Array,name+': BLOBs come back as Uint8Array');r.push(Buffer.from(blob).toString('hex'))}
  r.push(d.prepare('SELECT * FROM t WHERE id=?').get('zzz'),'get with no row');
  r.push(d.prepare('UPDATE t SET n=n+10 WHERE n<$max').run({max:3}).changes);
  r.push(d.prepare('DELETE FROM t WHERE id=?').run('nope').changes);
  assert.throws(()=>ins.run({id:'a',n:9}),/UNIQUE|constraint/i,name+': constraint errors surface');
  assert.throws(()=>d.prepare("INSERT INTO t(id,p) VALUES('x','missing')").run(),/FOREIGN KEY/,name+': foreign keys on');
  // transactions: commit, rollback on throw, nested calls join the outer one, result returned
  r.push(d.tx(()=>{d.prepare('INSERT INTO t(id) VALUES(?)').run('t1');return 'done'}));
  assert.throws(()=>d.tx(()=>{d.prepare('INSERT INTO t(id) VALUES(?)').run('t2');d.tx(()=>d.prepare('INSERT INTO t(id) VALUES(?)').run('t3'));throw Error('boom')}),/boom/);
  r.push(d.prepare("SELECT COUNT(*) n FROM t WHERE id IN ('t1','t2','t3')").get().n);
  d.tx(()=>{d.prepare('INSERT INTO t(id) VALUES(?)').run('t4');try{d.tx(()=>{d.prepare('INSERT INTO t(id) VALUES(?)').run('t5');throw Error('inner')})}catch{}});
  r.push(d.prepare("SELECT COUNT(*) n FROM t WHERE id IN ('t4','t5')").get().n,'inner writes kept when the outer call catches (join-outer, as before)');
  d.prepare('DELETE FROM t WHERE id=$id').run({id:'a'});r.push(d.prepare('SELECT COUNT(*) n FROM t').get().n,'cascade');
  if(name==='do'){
   assert.equal(d.fake.calls.objects,0,'the Durable Object backend was never given an object to bind');
   assert.throws(()=>d.exec('BEGIN IMMEDIATE'),/transactionSync/,'the fake refuses BEGIN like a Durable Object');
  }
  d.close();
 }
 assert.deepEqual(results.do,results.node,'same results from both backends');

 // ---- the real data modules on the Durable Object backend ----
 const f=fakeStorage(),dob=A.doAdapter(f);D.migrate(dob);D.useDatabase(dob);
 assert.equal(D.db(),dob,'the installed backend is used');
 const S=await import('./store.mjs'),Acc=await import('./accounts.mjs'),ev=await import('./events.mjs'),L=await import('./labs.mjs'),log=await import('./log.mjs'),M=await import('./medicines.mjs'),C=await import('./consent.mjs');
 S.enterAs(S.SYSTEM);
 const h=S.createHousehold('Example household'),h2=S.createHousehold('Other household');
 S.addMember(h.id,{id:'alex',name:'Alex',labs:true});S.addMember(h.id,{id:'mia',name:'Mia',kind:'child'});S.addMember(h2.id,{id:'sam',name:'Sam'});
 assert.deepEqual(S.listMembers(h.id).map(m=>m.id),['alex','mia']);assert.equal(S.listMembers(h.id)[0].labs,true);assert.equal(S.listMembers(h.id)[1].labs,false);
 const owner=Acc.createUser('owner@example.com'),viewer=Acc.createUser('viewer@example.com');
 Acc.setMembership(h.id,owner.id,'owner');Acc.setMembership(h.id,viewer.id,'viewer');C.recordConsent(owner.id);
 const tok=Acc.createSession(owner.id);assert.equal(Acc.sessionUser(tok)?.id,owner.id);assert.equal(Acc.deleteSession(tok),true);assert.equal(Acc.deleteSession(tok),false,'changes counted');
 const e=ev.addEpisode('alex',{title:'Example cold',category:'Illness',startDate:'2026-10-05'});
 ev.addEvent('alex',{date:'2026-10-05',time:'09:30',kind:'visit',note:'Example visit',episodeId:e.id});
 assert.deepEqual(ev.listEpisodes('alex').map(x=>x.title),['Example cold']);assert.equal(ev.listEvents('alex').length,1);
 M.mutate('alex',{action:'plan',episodeId:e.id,plan:M.validate({name:'Medicine A',days:3,frequency:2,mode:'times',startDate:'2026-10-05',times:['08:00','20:00'],confirmed:true})});
 assert.equal(M.list('alex').length,1);
 log.add([{metric:'steps',date:'2026-10-05',value:1234}],'manual','alex');assert.equal(log.list('alex').length,1);
 const rep=L.addReport('alex',{date:'2026-10-01',title:'Example labs',values:[{name:'Ferritin',value:'50',unit:'ng/mL'}]});
 assert.equal(L.listReports('alex').length,1);assert.equal(L.deleteReport('alex',rep.id),true);assert.equal(L.deleteReport('alex',rep.id),false);
 // access rules still hold on this backend
 S.runAs({type:'user',userId:viewer.id},()=>{assert.equal(ev.listEpisodes('alex').length,1);assert.throws(()=>ev.addEpisode('alex',{title:'X',category:'Illness',startDate:'2026-10-06'}),S.AccessError);assert.throws(()=>S.forMember('sam'),S.AccessError)});
 assert.throws(()=>S.forMember('alex').all('SELECT * FROM log_entries'),/not scoped/);
 // a failing docs().replace leaves the list as it was (transactionSync rollback)
 assert.throws(()=>S.docs('episodes').replace('alex',[{id:'ok'},{}]),/needs an id/);assert.deepEqual(ev.listEpisodes('alex').map(x=>x.title),['Example cold']);
 // deleting a profile cascades on this backend too
 await S.removeMember('mia');assert.deepEqual(S.listMembers(h.id).map(m=>m.id),['alex']);
 await assert.rejects(async()=>S.removeMember('alex'),/at least one profile/);
 assert.equal(f.calls.objects,0,'no object was ever bound on the Durable Object backend');
 assert.throws(()=>D.useDatabase({}),/storage adapter/);
 D.close();assert.notEqual(D.db(),dob,'close() removes the installed backend');D.close();
 console.log('PASS sqladapter: $name -> ? (literals and comments untouched), binding checks (no objects reach the backend), node:sqlite and Durable Object backends agree (migrations, CRUD, blobs, changes, constraints, foreign keys, tx commit/rollback/nesting), data modules on the Durable Object backend.');
}finally{rmSync(dir,{recursive:true,force:true})}
