// Every app module (except the entry points server.mjs and worker.mjs) loads where import.meta.url is undefined, as on
// Cloudflare Workers: paths next to the code are resolved on use, never at module load. The modules are copied to a
// temp dir with import.meta.url replaced by undefined, then imported; the marker catalog then falls back to the
// bundled default. No data, no network.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const here=new URL('.',import.meta.url),dir=mkdtempSync(join(tmpdir(),'apni-load-'));
const ENTRY_POINTS=new Set(['server.mjs','worker.mjs','testlib.mjs']); // entry points (they listen or import cloudflare:*)
const mods=readdirSync(here).filter(f=>f.endsWith('.mjs')&&!f.startsWith('test-')&&!ENTRY_POINTS.has(f));
process.env.DB_FILE=join(dir,'never-opened.db');process.env.NO_PUSH='1';
try{
 cpSync(new URL('config/',here),join(dir,'config'),{recursive:true});
 for(const f of readdirSync(here).filter(f=>f.endsWith('.mjs')))writeFileSync(join(dir,f),readFileSync(new URL(f,here),'utf8').replaceAll('import.meta.url','undefined'));
 const failed=[];
 for(const f of mods){try{await import(pathToFileURL(join(dir,f)))}catch(e){failed.push(f+': '+e.message)}}
 assert.deepEqual(failed,[],'modules that fail to load without import.meta.url');
 const L=await import(pathToFileURL(join(dir,'labs.mjs')));
 assert(L.catalog().markers.length>50,'bundled default catalog without a private dir');
 assert(!readdirSync(dir).includes('private'),'nothing written next to the code at load');
 console.log(`PASS module load: ${mods.length} modules load without import.meta.url (paths resolved on use), default marker catalog.`);
}finally{rmSync(dir,{recursive:true,force:true})}
