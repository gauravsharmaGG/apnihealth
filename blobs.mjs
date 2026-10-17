// Blob storage for uploaded files (record inbox) behind one small async interface, so the same data modules can
// later run on Cloudflare Workers with R2. Keys are relative, slash-separated paths such as
// "profiles/<memberId>/uploads/<uuid>.png". Segments are non-empty, never "." or "..", and contain no backslash
// or NUL; the fs backend also checks that the resolved path stays inside its root.
//
// Interface (every method returns a Promise except stream):
//   put(key, bytes, {contentType})   store new bytes; refuses to overwrite an existing key
//   stat(key) -> {size} | null
//   read(key) -> Buffer | null
//   stream(key) -> Node Readable      (for responses; emits 'error' when the key is missing)
//   delete(key) -> boolean            true when something was removed
//   list(prefix) -> [{key, size}]     every blob under prefix ("profiles/ann/"), sorted by key
//   deletePrefix(prefix)              removes every blob under prefix
//
// The default backend keeps files on disk under private/ next to the code, so a key maps to exactly the path
// used before this interface existed (private/profiles/<id>/uploads/...): existing data needs no migration.
// Directories are created 0700 and files 0600. The fs backend does its work synchronously before the returned
// Promise settles, so callers keep today's ordering.
import {writeFileSync,mkdirSync,statSync,readFileSync,unlinkSync,rmSync,readdirSync,createReadStream,existsSync} from 'node:fs';
import {resolve,sep,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const SEGMENT=/^[^/\\\0]{1,255}$/;
export function checkKey(key,{prefix=false}={}){
 if(typeof key!=='string'||!key||key.length>1024)throw Error('Bad blob key');
 const parts=(prefix&&key.endsWith('/')?key.slice(0,-1):key).split('/');
 if(parts.some(p=>!SEGMENT.test(p)||p==='.'||p==='..'))throw Error('Bad blob key');
 return parts;
}

export function fsBlobs(root=resolve(fileURLToPath(new URL('.',import.meta.url)),'private')){
 const pathOf=(key,o)=>{const p=resolve(root,...checkKey(key,o));if(!p.startsWith(root+sep))throw Error('Bad blob key');return p};
 const isMissing=e=>e?.code==='ENOENT'||e?.code==='ENOTDIR';
 const run=fn=>{try{return Promise.resolve(fn())}catch(e){return Promise.reject(e)}};
 return {
  kind:'fs',
  put:(key,bytes)=>run(()=>{const p=pathOf(key);mkdirSync(resolve(p,'..'),{recursive:true,mode:0o700});writeFileSync(p,bytes,{mode:0o600,flag:'wx'})}),
  stat:key=>run(()=>{try{const s=statSync(pathOf(key));return s.isFile()?{size:s.size}:null}catch(e){if(isMissing(e))return null;throw e}}),
  read:key=>run(()=>{try{return readFileSync(pathOf(key))}catch(e){if(isMissing(e)||e?.code==='EISDIR')return null;throw e}}),
  stream:key=>createReadStream(pathOf(key)),
  delete:key=>run(()=>{try{unlinkSync(pathOf(key));return true}catch(e){if(isMissing(e))return false;throw e}}),
  list:prefix=>run(()=>{
   const dir=pathOf(prefix,{prefix:true}),out=[];if(!existsSync(dir))return out;
   const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())out.push({key:relative(root,p).split(sep).join('/'),size:statSync(p).size})}};
   walk(dir);return out.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  }),
  deletePrefix:prefix=>run(()=>{rmSync(pathOf(prefix,{prefix:true}),{recursive:true,force:true})}),
 };
}

// The backend in use. Node uses the fs backend; a Workers entry point (later) installs an R2 backend at startup.
let current=null;
export const blobs=()=>current||(current=fsBlobs());
export function setBlobs(impl){current=impl}
// Key helpers so every module builds the same paths.
const one=v=>{if(checkKey(String(v)).length!==1)throw Error('Bad blob key');return String(v)};
export const profilePrefix=memberId=>`profiles/${one(memberId)}/`;
export const uploadKey=(memberId,stored)=>profilePrefix(memberId)+'uploads/'+one(stored);
