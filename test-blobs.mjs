// blobs.mjs: the fs backend (same on-disk paths as before, modes, no overwrite, key checks, list/deletePrefix)
// and the data modules using whatever backend is installed (an in-memory one here, as an R2 backend would be).
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Readable} from 'node:stream';
const dir=mkdtempSync(join(tmpdir(),'apni-blobs-'));
process.env.DB_FILE=join(dir,'test.db');process.env.NO_PUSH='1';
const B=await import('./blobs.mjs');
const collect=async s=>{const parts=[];for await(const c of s)parts.push(c);return Buffer.concat(parts)};
try{
 // ---- fs backend ----
 const root=join(dir,'private'),fb=B.fsBlobs(root);
 const key=B.uploadKey('ann','u1.png');assert.equal(key,'profiles/ann/uploads/u1.png');
 await fb.put(key,Buffer.from('png-bytes'),{contentType:'image/png'});
 const onDisk=join(root,'profiles/ann/uploads/u1.png');
 assert.equal(readFileSync(onDisk,'utf8'),'png-bytes','same path as before: private/profiles/<id>/uploads/<file>');
 assert.equal(statSync(onDisk).mode&0o777,0o600,'file 0600');assert.equal(statSync(join(root,'profiles/ann/uploads')).mode&0o777,0o700,'dir 0700');
 await assert.rejects(fb.put(key,Buffer.from('other')),/EEXIST/,'never overwrites');assert.equal(readFileSync(onDisk,'utf8'),'png-bytes');
 assert.deepEqual(await fb.stat(key),{size:9});assert.equal(await fb.stat('profiles/ann/uploads/none.png'),null);assert.equal(await fb.stat('profiles/ann/uploads'),null,'a directory is not a blob');
 assert.equal((await fb.read(key)).toString(),'png-bytes');assert.equal(await fb.read('profiles/nobody/x'),null);
 assert.equal((await collect(fb.stream(key))).toString(),'png-bytes');
 await assert.rejects(collect(fb.stream('profiles/ann/missing')),/ENOENT/,'stream of a missing key errors');
 mkdirSync(join(root,'profiles/ann/extra'),{recursive:true});writeFileSync(join(root,'profiles/ann/extra/My notes.txt'),'n');writeFileSync(join(root,'profiles/ann/child-record.json'),'{}');
 await fb.put('profiles/bob/uploads/b.pdf',Buffer.from('pdf'));
 assert.deepEqual(await fb.list('profiles/ann/'),[{key:'profiles/ann/child-record.json',size:2},{key:'profiles/ann/extra/My notes.txt',size:1},{key:'profiles/ann/uploads/u1.png',size:9}],'every file under the prefix, sorted');
 assert.equal((await fb.read('profiles/ann/extra/My notes.txt')).toString(),'n','listed keys can be read back');
 assert.deepEqual(await fb.list('profiles/nobody/'),[]);
 assert.equal(await fb.delete(key),true);assert.equal(await fb.delete(key),false);assert(!existsSync(onDisk));
 await fb.deletePrefix('profiles/ann/');assert(!existsSync(join(root,'profiles/ann')));assert(existsSync(join(root,'profiles/bob/uploads/b.pdf')),'other prefixes stay');
 await fb.deletePrefix('profiles/ann/');// missing prefix is fine
 for(const bad of ['','/etc/passwd','../x','profiles/../../x','profiles/./x','profiles//x','profiles\\x','a\0b','x'.repeat(2000)]){
  await assert.rejects(fb.put(bad,Buffer.from('x')),/Bad blob key/,'refused: '+JSON.stringify(bad));
  await assert.rejects(fb.read(bad),/Bad blob key/);await assert.rejects(fb.deletePrefix(bad),/Bad blob key/);
 }
 assert.throws(()=>B.profilePrefix('../x'),/Bad blob key/);assert.throws(()=>B.uploadKey('ann/x','y'),/Bad blob key/);
 assert(!existsSync(join(dir,'x'))&&!existsSync(join(dir,'..','x')),'nothing written outside the root');
 console.log('PASS blobs (fs): same on-disk paths, 0600/0700, no overwrite, stat/read/stream/list/delete/deletePrefix, key checks.');

 // ---- data modules on an installed backend (in memory, like R2 later) ----
 const mem=new Map(),calls=[];let failPut=false;
 B.setBlobs({kind:'memory',
  put:async(k,b,o)=>{B.checkKey(k);calls.push('put '+k);if(failPut)throw Error('storage down');if(mem.has(k))throw Error('exists');mem.set(k,{bytes:Buffer.from(b),type:o?.contentType})},
  stat:async k=>mem.has(k)?{size:mem.get(k).bytes.length}:null,
  read:async k=>mem.get(k)?.bytes??null,
  stream:k=>mem.has(k)?Readable.from([mem.get(k).bytes]):Readable.from((async function*(){throw Error('missing')})()),
  delete:async k=>{calls.push('delete '+k);return mem.delete(k)},
  list:async p=>[...mem.keys()].filter(k=>k.startsWith(p)).sort().map(k=>({key:k,size:mem.get(k).bytes.length})),
  deletePrefix:async p=>{calls.push('deletePrefix '+p);for(const k of [...mem.keys()])if(k.startsWith(p))mem.delete(k)},
 });
 const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs'),ev=await import('./events.mjs'),R=await import('./datarights.mjs');
 S.enterAs(S.SYSTEM);
 const h=S.createHousehold('Household A');S.addMember(h.id,{id:'ann',name:'Ann'});S.addMember(h.id,{id:'kid',name:'Kid',kind:'child'});
 const u=A.createUser('owner@example.com');A.setMembership(h.id,u.id,'owner');C.recordConsent(u.id);
 const png=Buffer.from('89504e470d0a1a0a','hex');
 const item=await ev.addInbox('ann',{category:'other',date:'2000-01-05',title:'Scan',fileName:'scan.png',mimeType:'image/png',dataBase64:png.toString('base64')});
 const k=[...mem.keys()][0];assert.match(k,/^profiles\/ann\/uploads\/[0-9a-f-]{36}\.png$/);assert.equal(mem.get(k).type,'image/png');assert(mem.get(k).bytes.equals(png));
 const f=await ev.inboxFile('ann',item.id);assert.deepEqual(f,{key:k,size:8,mime:'image/png',name:'scan.png'});
 assert.equal(await ev.inboxFile('ann','nope'),null);
 // a failed upload leaves no record behind
 failPut=true;await assert.rejects(ev.addInbox('kid',{category:'other',date:'2000-01-05',title:'X',fileName:'x.pdf',mimeType:'application/pdf',dataBase64:'JVBERg=='}),/storage down/);failPut=false;
 assert.equal(ev.listInbox('kid').length,0,'no inbox row without its file');
 await assert.rejects(ev.addInbox('ghost',{category:'other',date:'2000-01-05',title:'X',fileName:'x.pdf',mimeType:'application/pdf',dataBase64:'JVBERg=='}));
 assert(!calls.some(c=>c.includes('ghost')),'nothing stored for an unknown profile');
 const item2=await ev.addInbox('kid',{category:'other',date:'2000-01-06',title:'Y',fileName:'y.pdf',mimeType:'application/pdf',dataBase64:'JVBERg=='});
 // export reads every blob of every profile through the backend
 const exp=await S.runAs({type:'user',userId:u.id,household:null},()=>R.exportData(u));
 assert.deepEqual(exp.data.files.sort(),[`files/ann/uploads/${item.id}.png`,`files/kid/uploads/${item2.id}.pdf`]);
 const chunks=[];await R.writeZip({write:b=>chunks.push(Buffer.from(b))},exp);const zip=Buffer.concat(chunks);
 assert.equal(zip.readUInt32LE(0),0x04034b50);assert(zip.includes(Buffer.from(`files/ann/uploads/${item.id}.png`)));
 mem.delete(k);await assert.rejects(R.writeZip({write(){}},exp),/Uploaded file missing/,'a missing file fails the export instead of silently skipping it');
 mem.set(k,{bytes:png,type:'image/png'});
 // deleting an inbox item, a profile, an account: DB first, then the backend
 assert.equal(await ev.deleteInbox('ann',item.id),true);assert(!mem.has(k));assert.equal(await ev.deleteInbox('ann',item.id),false);
 await S.removeMember('kid');assert.deepEqual([...mem.keys()].filter(x=>x.startsWith('profiles/kid/')),[]);assert(calls.includes('deletePrefix profiles/kid/'));
 await ev.addInbox('ann',{category:'other',date:'2000-01-07',title:'Z',fileName:'z.png',mimeType:'image/png',dataBase64:png.toString('base64')});
 const r=await R.deleteAccount(u);assert.deepEqual(r.households,['Household A']);assert.equal(mem.size,0,'files of sole-owned households removed');assert(calls.includes('deletePrefix profiles/ann/'));
 console.log('PASS blobs (installed backend): inbox upload/read/delete, no row when storing fails, export reads every file and fails on a missing one, profile and account deletion clear their prefixes.');
}finally{rmSync(dir,{recursive:true,force:true})}
