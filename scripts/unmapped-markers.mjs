// Which lab marker names in a database the catalog doesn't know: prints NAMES AND COUNTS ONLY, never values, units,
// dates or members. Use it to decide which aliases to add (config/markers.default.json or private/markers.json).
// The database is opened read-only and never migrated, so it also works on a copy that is behind the code.
// Run: node scripts/unmapped-markers.mjs [--db private/apnihealth.db] [--private private]
// Output: one line per unknown name, "<count>  <name>  [reader: <catalog marker it would suggest>]".
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeMatcher} from '../public/labmap.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const a=process.argv.slice(2),opt=(n,d)=>{const i=a.indexOf(n);return i>=0?a[i+1]:d};
const dbFile=resolve(opt('--db',process.env.DB_FILE||join(root,'private/apnihealth.db'))),privateDir=resolve(opt('--private',join(root,'private')));
if(!existsSync(dbFile)){console.error('No database at '+dbFile);process.exit(1)}

// The catalog as the server builds it: default, then private/markers.json, then household markers (if the table exists).
const markers=new Map();
const add=list=>{for(const m of list||[])if(m&&typeof m.name==='string'){const o=markers.get(m.name)||{name:m.name,aliases:[]};o.aliases=[...new Set([...o.aliases,...(m.aliases||[])])];for(const k of ['unit','units','alt','plausible'])if(m[k]!==undefined)o[k]=m[k];markers.set(m.name,o)}};
add(JSON.parse(readFileSync(join(root,'config/markers.default.json'),'utf8')).markers);
const own=join(privateDir,'markers.json');if(existsSync(own))add(JSON.parse(readFileSync(own,'utf8')).markers);
const db=new DatabaseSync(dbFile,{readOnly:true});
try{
 const has=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
 if(has('lab_markers'))for(const r of db.prepare('SELECT name,aliases FROM lab_markers').all()){let al=[];try{al=JSON.parse(r.aliases)}catch{}add([{name:r.name,aliases:al,custom:true}])}
 const index=new Set();for(const m of markers.values())for(const k of [m.name,...m.aliases])index.add(String(k).trim().toLowerCase());
 // names only: SELECT never touches value, num, unit, reference, flag, dates or member columns
 const counts=new Map();
 const tally=sql=>{for(const r of db.prepare(sql).all()){const n=String(r.name).trim();if(n&&!index.has(n.toLowerCase()))counts.set(n,(counts.get(n)||0)+Number(r.n))}};
 if(has('lab_values'))tally('SELECT name, COUNT(*) AS n FROM lab_values GROUP BY name');
 if(has('lab_pending'))tally('SELECT name, COUNT(*) AS n FROM lab_pending GROUP BY name');
 const matcher=makeMatcher([...markers.values()]);
 const rows=[...counts].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));
 for(const [name,n] of rows){const m=matcher.match(name);console.log(`${String(n).padStart(4)}  ${name}${m?`  [reader: ${m.marker.name} (${m.how})]`:''}`)}
 console.log(`${rows.length} unknown name${rows.length===1?'':'s'} (catalog: ${markers.size} markers).`);
}finally{db.close()}
