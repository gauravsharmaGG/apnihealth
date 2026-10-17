// members.mjs: validation of private/members.json and lookups (fictional members only).
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';
const dir=mkdtempSync(tmpdir()+'/apni-members-');
try{
 const file=dir+'/members.json';process.env.MEMBERS_FILE=file;
 const M=await import('./members.mjs');
 assert.throws(()=>M.load(),/Cannot read members file/);
 writeFileSync(file,readFileSync(new URL('config/members.example.json',import.meta.url)));M.reset();
 assert.deepEqual(M.ids(),['alex','sam','mia']);assert.equal(M.defaultId(),'alex');
 assert(M.has('mia')&&!M.has('../mia')&&!M.has('nobody')&&!M.has(undefined));
 assert.equal(M.get('alex').labs,true);assert.equal(M.get('sam').labs,false);assert.equal(M.get('mia').kind,'child');assert.equal(M.get('mia').initial,'M');
 for(const bad of [[],{},[{id:'Alex',name:'A'}],[{id:'a b',name:'A'}],[{id:'x',name:''}],[{id:'x',name:'A'},{id:'x',name:'B'}],[{id:'x',name:'A',kind:'pet'}],[{id:'x',name:'A',color:'red;}'}],[{id:'../x',name:'A'}]])
  assert.throws(()=>M.validate(bad),undefined,JSON.stringify(bad));
 assert.equal(M.validate([{id:'kid',name:'Kid',kind:'child',labs:true}])[0].labs,false,'lab results are an adult feature for now');
 console.log('PASS members: example config, lookups, id/name/kind/colour validation.');
}finally{rmSync(dir,{recursive:true,force:true})}
