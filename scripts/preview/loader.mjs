// Preview-only loader: node --import ./scripts/preview/loader.mjs server.mjs (used by .preview.jsonc only).
// Swaps the app's ./access.mjs for ./auth-shim.mjs. Refuses to start unless PREVIEW_MODE=1 AND private/ holds
// seeded dummy data (private/.preview marker written by seed.mjs), so it can never run against real data.
// The live server never loads this file; server.mjs and access.mjs are unchanged.
import {register} from 'node:module';
import {existsSync} from 'node:fs';
const root=new URL('../../',import.meta.url);
if(process.env.PREVIEW_MODE!=='1')throw Error('preview loader: PREVIEW_MODE=1 is required');
if(!existsSync(new URL('private/.preview',root)))throw Error('preview loader: private/.preview marker missing (run scripts/preview/seed.mjs first)');
process.env.AUTH_MODE='trusted-proxy'; // the shim stands in for the proxy; the seeded preview user is signed in
const target=new URL('access.mjs',root).href,shim=new URL('./auth-shim.mjs',import.meta.url).href;
register('data:text/javascript,'+encodeURIComponent(`
export async function resolve(spec,ctx,next){
  const r=await next(spec,ctx);
  return r.url===${JSON.stringify(target)}?{...r,url:${JSON.stringify(shim)},shortCircuit:true}:r;
}`));
