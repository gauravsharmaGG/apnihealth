// Backends for the Cloudflare Workers target, kept out of worker.mjs so they can be tested on Node with fakes:
//   r2Blobs(bucket)    the blobs.mjs interface on an R2 bucket binding (same keys as the fs backend)
//   assetFiles(assets) the static-file source of app.mjs on the static assets binding (env.ASSETS)
import {Readable} from 'node:stream';
import {checkKey} from './blobs.mjs';

// R2: put refuses to overwrite (as the fs backend's 'wx'); list pages through every result; deletePrefix removes
// in batches of up to 1000 keys (R2's limit per delete call).
export function r2Blobs(bucket){
 const key=(k,o)=>{checkKey(k,o);return k};
 const all=async prefix=>{const out=[];let cursor;do{const r=await bucket.list({prefix:key(prefix,{prefix:true}),cursor});for(const o of r.objects)out.push({key:o.key,size:o.size});cursor=r.truncated?r.cursor:undefined}while(cursor);return out.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
 return {
  kind:'r2',
  async put(k,bytes,{contentType}={}){
   key(k);if(await bucket.head(k))throw Object.assign(Error('Blob already exists'),{code:'EEXIST'});
   await bucket.put(k,bytes,contentType?{httpMetadata:{contentType}}:undefined);
  },
  async stat(k){const o=await bucket.head(key(k));return o?{size:o.size}:null},
  async read(k){const o=await bucket.get(key(k));return o?Buffer.from(await o.arrayBuffer()):null},
  // A Node Readable for responses, like fs.createReadStream: emits 'error' when the key is missing.
  stream(k){
   key(k);
   return Readable.from((async function*(){
    const o=await bucket.get(k);if(!o)throw Object.assign(Error('Blob not found'),{code:'ENOENT'});
    for await(const chunk of o.body)yield Buffer.from(chunk);
   })());
  },
  async delete(k){if(!await bucket.head(key(k)))return false;await bucket.delete(k);return true},
  list:prefix=>all(prefix),
  async deletePrefix(prefix){const keys=(await all(prefix)).map(o=>o.key);for(let i=0;i<keys.length;i+=1000)await bucket.delete(keys.slice(i,i+1000))},
 };
}

// Static assets: path is the decoded request path ('/index.html', '/app.js'). Segments are re-encoded, so a
// request can only name a file inside the uploaded asset directory; '..' segments and NUL are refused.
export function assetFiles(assets,origin='https://assets.invalid'){
 return {
  async open(path){
   if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0'))return null;
   const parts=path.slice(1).split('/');if(parts.some(p=>!p||p==='.'||p==='..'))return null;
   const r=await assets.fetch(new Request(origin+'/'+parts.map(encodeURIComponent).join('/'),{redirect:'manual'}));
   if(r.status!==200){await r.body?.cancel?.();return null}
   const buf=Buffer.from(await r.arrayBuffer());
   return {size:buf.length,read:async()=>buf,stream:()=>Readable.from([buf])};
  },
 };
}
