// The synchronous SQL storage interface the data modules use, with two backends:
//   nodeAdapter(DatabaseSync)   node:sqlite (Node 22.13+), the self-hosted default; statements pass straight through.
//   doAdapter(ctx.storage)      SQLite in a Cloudflare Durable Object (ctx.storage.sql + transactionSync).
// Pure JavaScript with no imports, so a Worker can load it without node:sqlite.
//
// Interface (all synchronous):
//   prepare(sql) -> {get(...p), all(...p), run(...p) -> {changes}}
//        p is either positional values for ? placeholders, or ONE plain object for $name placeholders
//        (keys with or without the $; a missing name binds NULL and an unknown key is an error, as in node:sqlite)
//   exec(sql)       one or more statements without parameters (migrations)
//   tx(fn)          runs fn atomically and returns its result; nested calls join the outer transaction
//   close()
//
// Why the translation: Durable Object SQLite binds only positional values. Given a {$name: ...} object it does
// not fail, it silently stores the text "[object Object]". doAdapter therefore rewrites $name/:name/@name
// placeholders to plain ? once per statement (a name used twice is bound twice) and never passes an object to the
// backend. BEGIN/COMMIT are
// refused inside a Durable Object, so tx() maps to ctx.storage.transactionSync.

// ---- $name -> ? ----
// Skips string literals, quoted identifiers and comments. Returns {sql, names, order}: names are the distinct
// parameter names, order[i] is the name bound to the i-th ?. Both are null when the statement has no named
// parameters (it may then use ? or ?N).
const cache=new Map(),CACHE_MAX=500;
export function namedToPositional(sql){
 if(typeof sql!=='string')throw TypeError('SQL must be a string');
 const hit=cache.get(sql);if(hit)return hit;
 let out='',i=0,positional=false;const names=[],order=[];
 while(i<sql.length){
  const c=sql[i];
  if(c==="'"||c==='"'||c==='`'||c==='['){ // literal or quoted identifier, copied as is
   const close=c==='['?']':c;let j=i+1;
   for(;j<sql.length;j++){if(sql[j]===close){if(close!==']'&&sql[j+1]===close){j++;continue}break}}
   out+=sql.slice(i,j+1);i=j+1;continue;
  }
  if(c==='-'&&sql[i+1]==='-'){const j=sql.indexOf('\n',i);const e=j<0?sql.length:j;out+=sql.slice(i,e);i=e;continue}
  if(c==='/'&&sql[i+1]==='*'){const j=sql.indexOf('*/',i+2);const e=j<0?sql.length:j+2;out+=sql.slice(i,e);i=e;continue}
  if((c==='$'||c===':'||c==='@')&&/[A-Za-z_]/.test(sql[i+1]||'')){
   let j=i+1;while(j<sql.length&&/[A-Za-z0-9_]/.test(sql[j]))j++;
   const name=sql.slice(i+1,j);
   if(!names.includes(name))names.push(name);
   order.push(name);out+='?';i=j;continue;
  }
  if(c==='?')positional=true;
  out+=c;i++;
 }
 if(names.length&&positional)throw Error('Do not mix ? and named parameters in one statement');
 const r=Object.freeze({sql:names.length?out:sql,names:names.length?Object.freeze(names):null,order:names.length?Object.freeze(order):null});
 if(cache.size>=CACHE_MAX)cache.delete(cache.keys().next().value);
 cache.set(sql,r);return r;
}

const isBytes=v=>v instanceof Uint8Array||v instanceof ArrayBuffer;
const isPlainObject=v=>v!==null&&typeof v==='object'&&!isBytes(v)&&!Array.isArray(v);
// Turns the arguments of get/all/run into the positional values for the translated statement.
export function bindings({names,order},args){
 if(names){
  if(args.length!==1||!isPlainObject(args[0]))throw TypeError('This statement uses named parameters: pass one object');
  const o=args[0],known=new Set(names);
  for(const k of Object.keys(o)){const n=k.replace(/^[$:@]/,'');if(!known.has(n))throw Error(`Unknown named parameter '${n}'`)}
  const value=n=>{for(const p of [n,'$'+n,':'+n,'@'+n])if(Object.hasOwn(o,p))return check(o[p],n);return null};
  return order.map(value);
 }
 return args.map((v,i)=>{if(isPlainObject(v))throw TypeError('This statement has no named parameters: pass positional values');return check(v,i+1)});
}
function check(v,where){
 if(v===undefined)throw TypeError(`Parameter ${where} is undefined`);
 if(v===null||typeof v==='number'||typeof v==='string'||typeof v==='bigint'||isBytes(v))return v;
 throw TypeError(`Parameter ${where}: only null, numbers, strings and bytes can be bound`);
}

// Nested tx() calls join the outer transaction (as db.mjs always did): an error in an inner call that the
// outer code catches does not undo the inner writes; an error that escapes the outermost call undoes everything.
function nested(begin){
 let depth=0;
 return fn=>{
  if(depth){depth++;try{return fn()}finally{depth--}}
  depth=1;try{return begin(fn)}finally{depth=0}
 };
}

// ---- node:sqlite ----
// db is a DatabaseSync. Statements are node:sqlite's own (same results, same errors as before this interface).
export function nodeAdapter(db){
 const tx=nested(fn=>{
  db.exec('BEGIN IMMEDIATE');
  try{const r=fn();db.exec('COMMIT');return r}
  catch(e){try{db.exec('ROLLBACK')}catch{}throw e}
 });
 return Object.freeze({kind:'node-sqlite',prepare:sql=>db.prepare(sql),exec:sql=>{db.exec(sql)},tx,close:()=>db.close(),raw:db});
}

// ---- SQLite in a Durable Object ----
// storage is the Durable Object's ctx.storage: storage.sql.exec(sql, ...values) -> cursor (toArray(), one()),
// storage.transactionSync(fn).
export function doAdapter(storage){
 const sql=storage.sql;
 // BLOB columns come back as ArrayBuffer from a Durable Object and as Uint8Array from node:sqlite: return Uint8Array.
 const fix=r=>{for(const k in r)if(r[k] instanceof ArrayBuffer)r[k]=new Uint8Array(r[k]);return r};
 const rows=(q,args)=>{const t=namedToPositional(q);return sql.exec(t.sql,...bindings(t,args)).toArray().map(fix)};
 return Object.freeze({
  kind:'do-sqlite',
  prepare(q){
   namedToPositional(q); // fail early on bad SQL text, like prepare()
   return Object.freeze({
    all:(...a)=>rows(q,a),
    get:(...a)=>rows(q,a)[0],
    run:(...a)=>{rows(q,a);return {changes:Number(sql.exec('SELECT changes() AS n').one().n)}},
   });
  },
  exec:q=>{sql.exec(q)},
  tx:nested(fn=>storage.transactionSync(fn)),
  close(){},
 });
}
