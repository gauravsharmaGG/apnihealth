// SQLite storage via Node's built-in node:sqlite (Node 22.13+; no npm dependency).
// One database file per instance: private/apnihealth.db by default, or DB_FILE. Opened lazily, migrated on open.
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MIGRATIONS} from './migrations.mjs';
// node:sqlite prints an ExperimentalWarning on load; silence only that one warning.
const emit=process.emitWarning;
process.emitWarning=function(w,...rest){if(String(w?.message??w).includes('SQLite is an experimental feature'))return;return emit.call(process,w,...rest)};
const {DatabaseSync}=await import('node:sqlite');
process.emitWarning=emit;

export const defaultFile=()=>process.env.DB_FILE||fileURLToPath(new URL('./private/apnihealth.db',import.meta.url));
let current=null,currentFile=null;

export function open(file=defaultFile()){
 if(file!==':memory:'){mkdirSync(dirname(file),{recursive:true,mode:0o700})}
 const fresh=file===':memory:'||!existsSync(file);
 const db=new DatabaseSync(file);
 if(fresh&&file!==':memory:')chmodSync(file,0o600);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(file!==':memory:')db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
 migrate(db);
 return db;
}
// The shared connection for this process (reopened if DB_FILE changed, which only tests do).
export function db(){
 const file=defaultFile();
 if(!current||currentFile!==file){current?.close();current=open(file);currentFile=file}
 return current;
}
export function close(){current?.close();current=null;currentFile=null}

export function version(d){return d.prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get().v}
export function migrate(d){
 d.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
 const have=version(d);
 const latest=MIGRATIONS.at(-1)?.version||0;
 if(have>latest)throw Error(`Database schema ${have} is newer than this app (${latest}); upgrade the app`);
 for(const m of MIGRATIONS){
  if(m.version<=have)continue;
  transaction(d,()=>{d.exec(m.sql);d.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(m.version,m.name,new Date().toISOString())});
 }
}
// Runs fn inside one transaction (nested calls join the outer one).
const depth=new WeakMap();
export function transaction(d,fn){
 const n=depth.get(d)||0;
 if(n){depth.set(d,n+1);try{return fn()}finally{depth.set(d,n)}}
 d.exec('BEGIN IMMEDIATE');depth.set(d,1);
 try{const r=fn();d.exec('COMMIT');return r}
 catch(e){try{d.exec('ROLLBACK')}catch{}throw e}
 finally{depth.set(d,0)}
}
