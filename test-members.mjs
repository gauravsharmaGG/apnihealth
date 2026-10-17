// members.mjs: members come from the database; validation of members.json-style lists (fictional members only).
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';
const dir=mkdtempSync(tmpdir()+'/apni-members-');process.env.DB_FILE=dir+'/m.db';
const M=await import('./members.mjs'),S=await import('./store.mjs'),D=await import('./db.mjs');
try{
 assert.throws(()=>M.load(),/No household members yet.*import-json/,'an empty database explains how to add members');
 assert.equal(M.has('alex'),false);
 const h=S.createHousehold('Example household');
 for(const m of M.validate(JSON.parse(readFileSync(new URL('config/members.example.json',import.meta.url)))))S.addMember(h.id,m);
 assert.deepEqual(M.ids(),['alex','sam','mia']);assert.equal(M.defaultId(),'alex');
 assert(M.has('mia')&&!M.has('../mia')&&!M.has('nobody')&&!M.has(undefined));
 assert.equal(M.get('alex').labs,true);assert.equal(M.get('sam').labs,false);assert.equal(M.get('mia').kind,'child');assert.equal(M.get('mia').initial,'M');
 assert.equal(M.name('sam'),'Sam');assert.equal('household' in M.get('alex'),false,'the client list carries no internal ids');
 S.addMember(h.id,{id:'kai',name:'Kai',kind:'child'});assert.deepEqual(M.ids(),['alex','sam','mia','kai'],'new members show up without a restart');
 for(const bad of [[],{},[{id:'Alex',name:'A'}],[{id:'a b',name:'A'}],[{id:'x',name:''}],[{id:'x',name:'A'},{id:'x',name:'B'}],[{id:'x',name:'A',kind:'pet'}],[{id:'x',name:'A',color:'red;}'}],[{id:'../x',name:'A'}],Array.from({length:21},(_,i)=>({id:'m'+i,name:'M'}))])
  assert.throws(()=>M.validate(bad),undefined,JSON.stringify(bad).slice(0,60));
 assert.equal(M.validate([{id:'kid',name:'Kid',kind:'child',labs:true}])[0].labs,false,'lab results are an adult feature for now');
 console.log('PASS members: database-backed list, setup hint, lookups, id/name/kind/colour validation.');
}finally{D.close();rmSync(dir,{recursive:true,force:true})}
