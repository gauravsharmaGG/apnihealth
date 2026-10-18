// scripts/unmapped-markers.mjs on a fictional database: names and counts only (no value, unit or date ever
// printed), catalog names and aliases (any case) are known, household markers count, and the file is untouched.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
const {DatabaseSync}=await import('node:sqlite');
const dir=mkdtempSync(join(tmpdir(),'apni-unmapped-')),file=join(dir,'example.db');
try{
 const db=new DatabaseSync(file);
 db.exec(`CREATE TABLE lab_values(member_id TEXT,report_id TEXT,pos INTEGER,name TEXT,value TEXT,num REAL,unit TEXT,reference TEXT,flag TEXT,page INTEGER);
  CREATE TABLE lab_pending(member_id TEXT,report_id TEXT,pos INTEGER,name TEXT,note TEXT);
  CREATE TABLE lab_markers(household_id TEXT,name TEXT,group_name TEXT,unit TEXT,aliases TEXT,created_at TEXT);`);
 const ins=db.prepare('INSERT INTO lab_values VALUES(?,?,?,?,?,?,?,?,?,?)');
 [['Ferritin','987.6'],['hämoglobin','12.3'],['Exotic example marker','4242.5'],['Exotic example marker','4343.5'],['Kreatinln','1.1'],['House example marker','7.7'],['Example alias','8.8']]
  .forEach(([n,v],i)=>ins.run('example','r1',i,n,v,Number(v),'zz/unitx','1-2','high',1));
 db.prepare('INSERT INTO lab_pending VALUES(?,?,?,?,?)').run('example','r1',1,'Pending example marker','secret note');
 db.prepare('INSERT INTO lab_markers VALUES(?,?,?,?,?,?)').run('h','House example marker','Other',null,'["Example alias"]','2000-01-01');
 db.close();
 const before=createHash('sha256').update(readFileSync(file)).digest('hex'),mtime=statSync(file).mtimeMs;
 const r=spawnSync(process.execPath,['scripts/unmapped-markers.mjs','--db',file,'--private',join(dir,'none')],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const out=r.stdout;
 assert.match(out,/^ {3}2 {2}Exotic example marker$/m);assert.match(out,/^ {3}1 {2}Pending example marker$/m);
 assert.match(out,/Kreatinln {2}\[reader: Creatinine: kidney blood marker \(fuzzy\)\]/);
 assert.doesNotMatch(out,/Ferritin|hämoglobin|House example|Example alias/,'catalog, alias (any case) and household names are known');
 assert.doesNotMatch(out,/4242|4343|987|12\.3|zz\/unitx|secret|high|2000/,'no values, units, notes, flags or dates');
 assert.match(out,/3 unknown names/);
 assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),before,'database unchanged');assert.equal(statSync(file).mtimeMs,mtime);
 console.log('PASS unmapped markers: names and counts only, catalog/alias/household names known, database untouched.');
}finally{rmSync(dir,{recursive:true,force:true})}
