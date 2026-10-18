// SQLite storage via Node's built-in node:sqlite (Node 22.13+; no npm dependency).
// One database file per instance: private/apnihealth.db by default, or DB_FILE. Opened lazily, migrated on open.
// Callers get the synchronous storage interface from sqladapter.mjs, so another backend (SQLite in a Cloudflare
// Durable Object) can be installed with useDatabase().
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MIGRATIONS} from './migrations.mjs';
import {nodeAdapter} from './sqladapter.mjs';
// node:sqlite prints an ExperimentalWarning on load; silence only that one warning.
const emit=process.emitWarning;
process.emitWarning=function(w,...rest){if(String(w?.message??w).includes('SQLite is an experimental feature'))return;return emit.call(process,w,...rest)};
const {DatabaseSync}=await import('node:sqlite');
process.emitWarning=emit;

export const defaultFile=()=>process.env.DB_FILE||fileURLToPath(new URL('./private/apnihealth.db',import.meta.url));
let current=null,currentFile=null,installed=null;

// Opens (and migrates) a database file with node:sqlite and returns it behind the storage interface
// (sqladapter.mjs: prepare/exec/tx/close).
export function open(file=defaultFile()){
 if(file!==':memory:'){mkdirSync(dirname(file),{recursive:true,mode:0o700})}
 const fresh=file===':memory:'||!existsSync(file);
 const raw=new DatabaseSync(file);
 if(fresh&&file!==':memory:')chmodSync(file,0o600);
 raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 if(file!==':memory:')raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;'); // Node only (refused in a Durable Object)
 const d=asAdapter(raw);
 migrate(d);
 return d;
}
// The shared database for this process: an installed adapter (useDatabase, e.g. the Durable Object's), else the
// node:sqlite file (reopened if DB_FILE changed, which only tests do).
export function db(){
 if(installed)return installed;
 const file=defaultFile();
 if(!current||currentFile!==file){current?.close();current=open(file);currentFile=file}
 return current;
}
// Installs another backend (an object with the sqladapter.mjs interface, already migrated); null removes it.
export function useDatabase(adapter){
 if(adapter!==null&&!(adapter&&typeof adapter.prepare==='function'&&typeof adapter.exec==='function'&&typeof adapter.tx==='function'))throw TypeError('useDatabase needs a storage adapter (prepare, exec, tx)');
 installed=adapter;
}
export function close(){current?.close();current=null;currentFile=null;installed=null}

// Accepts an adapter or a bare node:sqlite DatabaseSync (wrapped once, so nesting is tracked per database).
const wrapped=new WeakMap();
export function asAdapter(d){
 if(typeof d?.tx==='function')return d;
 if(!wrapped.has(d))wrapped.set(d,nodeAdapter(d));
 return wrapped.get(d);
}

export function version(d){return asAdapter(d).prepare('SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations').get().v}
export function migrate(d){
 d=asAdapter(d);
 d.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
 const have=version(d);
 const latest=MIGRATIONS.at(-1)?.version||0;
 if(have>latest)throw Error(`Database schema ${have} is newer than this app (${latest}); upgrade the app`);
 for(const m of MIGRATIONS){
  if(m.version<=have)continue;
  d.tx(()=>{d.exec(m.sql);d.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(m.version,m.name,new Date().toISOString())});
 }
}
// Runs fn inside one transaction (nested calls join the outer one), through the backend's tx().
export function transaction(d,fn){return asAdapter(d).tx(fn)}
