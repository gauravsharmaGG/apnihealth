// workers-backends.mjs on Node with fakes of the R2 bucket and static assets bindings (fictional data only):
// R2 blobs behave like the fs backend (no overwrite, stat/read/stream/list/delete/deletePrefix, key checks, paging,
// batched deletes) and the data modules work on them; static assets resolve only inside the asset directory.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'apni-wb-'));process.env.DB_FILE=join(dir,'t.db');process.env.NO_PUSH='1';
const W=await import('./workers-backends.mjs'),B=await import('./blobs.mjs');
const collect=async s=>{const parts=[];for await(const c of s)parts.push(c);return Buffer.concat(parts)};
// The subset of the R2 binding API used: head/get/put/delete(key|keys)/list({prefix,cursor}) with a small page size.
function fakeBucket(page=2){
 const m=new Map(),calls={deletes:[]};
 const obj=(k,v)=>({key:k,size:v.bytes.length,httpMetadata:v.meta,arrayBuffer:async()=>v.bytes.buffer.slice(v.bytes.byteOffset,v.bytes.byteOffset+v.bytes.length),body:(async function*(){for(let i=0;i<v.bytes.length;i+=3)yield new Uint8Array(v.bytes.subarray(i,i+3))})()});
 return {m,calls,
  head:async k=>m.has(k)?{key:k,size:m.get(k).bytes.length}:null,
  get:async k=>m.has(k)?obj(k,m.get(k)):null,
  put:async(k,b,o)=>{m.set(k,{bytes:Buffer.from(b),meta:o?.httpMetadata})},
  delete:async k=>{const ks=Array.isArray(k)?k:[k];assert(ks.length<=1000);calls.deletes.push(ks.length);for(const x of ks)m.delete(x)},
  list:async({prefix,cursor})=>{const ks=[...m.keys()].filter(k=>k.startsWith(prefix)).sort(),start=cursor?Number(cursor):0,objects=ks.slice(start,start+page).map(k=>({key:k,size:m.get(k).bytes.length}));return {objects,truncated:start+page<ks.length,cursor:String(start+page)}},
 };
}
try{
 const bucket=fakeBucket(),r=W.r2Blobs(bucket);
 await r.put('profiles/ann/uploads/u1.png',Buffer.from('png-bytes'),{contentType:'image/png'});
 assert.equal(bucket.m.get('profiles/ann/uploads/u1.png').meta.contentType,'image/png');
 await assert.rejects(r.put('profiles/ann/uploads/u1.png',Buffer.from('x')),/already exists/,'no overwrite');
 assert.deepEqual(await r.stat('profiles/ann/uploads/u1.png'),{size:9});assert.equal(await r.stat('profiles/ann/uploads/none.png'),null);
 assert.equal((await r.read('profiles/ann/uploads/u1.png')).toString(),'png-bytes');assert.equal(await r.read('profiles/ann/nope'),null);
 assert.equal((await collect(r.stream('profiles/ann/uploads/u1.png'))).toString(),'png-bytes','streamed in chunks');
 await assert.rejects(collect(r.stream('profiles/ann/uploads/none.png')),/not found/,'stream errors on a missing key');
 for(const n of ['a','b','c','d','e'])await r.put(`profiles/bob/uploads/${n}.pdf`,Buffer.from(n));
 await r.put('profiles/bobby/uploads/x.pdf',Buffer.from('x'));
 assert.deepEqual((await r.list('profiles/bob/')).map(o=>o.key),['a','b','c','d','e'].map(n=>`profiles/bob/uploads/${n}.pdf`),'all pages, sorted, prefix ends at the slash');
 assert.equal(await r.delete('profiles/bob/uploads/a.pdf'),true);assert.equal(await r.delete('profiles/bob/uploads/a.pdf'),false);
 await r.deletePrefix('profiles/bob/');assert.deepEqual((await r.list('profiles/bob/')),[]);assert.ok(bucket.m.has('profiles/bobby/uploads/x.pdf'),'other prefixes stay');
 for(const bad of ['../x','a//b','/a','a/./b','a\\b',''])await assert.rejects(async()=>r.put(bad,Buffer.from('x')),/Bad blob key/,bad);
 assert.throws(()=>r.stream('../x'),/Bad blob key/);
 // batched deletes stay within R2's 1000 keys per call
 const big=fakeBucket(1000),rb=W.r2Blobs(big);for(let i=0;i<1203;i++)big.m.set('profiles/z/'+i,{bytes:Buffer.from('1')});
 await rb.deletePrefix('profiles/z/');assert.deepEqual(big.calls.deletes,[1000,203]);assert.equal(big.m.size,0);
 // the data modules on the R2 backend: inbox upload, read back, export, profile deletion
 B.setBlobs(W.r2Blobs(fakeBucket()));
 const S=await import('./store.mjs'),ev=await import('./events.mjs');S.enterAs(S.SYSTEM);
 const h=S.createHousehold('Example household');S.addMember(h.id,{id:'alex',name:'Alex'});S.addMember(h.id,{id:'mia',name:'Mia'});
 const png=Buffer.from('89504e470d0a1a0a0000','hex');
 const item=await ev.addInbox('alex',{category:'other',date:'2000-01-05',title:'Scan',fileName:'scan.png',mimeType:'image/png',dataBase64:png.toString('base64')});
 const f=await ev.inboxFile('alex',item.id);assert.equal(f.size,png.length);assert.deepEqual(await collect(B.blobs().stream(f.key)),png);
 await S.removeMember('alex');assert.deepEqual(await B.blobs().list('profiles/alex/'),[],'profile deletion clears its R2 prefix');
 // static assets
 const served=new Map([['/index.html','<html><body>shell</body></html>'],['/app.js','js'],['/a%20b.css','css']]),seen=[];
 const assets={fetch:async req=>{const u=new URL(req.url);seen.push(u.pathname);return served.has(u.pathname)?new Response(served.get(u.pathname)):new Response('nf',{status:404})}};
 const A=W.assetFiles(assets);
 const idx=await A.open('/index.html');assert.equal(idx.size,31);assert.equal((await idx.read()).toString(),'<html><body>shell</body></html>');assert.equal((await collect(idx.stream())).toString(),'<html><body>shell</body></html>');
 assert.equal((await (await A.open('/a b.css')).read()).toString(),'css','decoded paths are re-encoded');
 assert.equal(await A.open('/missing.js'),null);
 const before=seen.length;for(const bad of ['/../private/x.db','/a/../b','/x\0','relative','/a//b',''])assert.equal(await A.open(bad),null,bad);
 assert.equal(seen.length,before,'refused paths never reach the binding');
 console.log('PASS workers backends: R2 blobs (no overwrite, stat/read/stream/list paging/delete/deletePrefix in batches, key checks, inbox/profile deletion on R2), static assets only inside the asset directory.');
}finally{rmSync(dir,{recursive:true,force:true})}
