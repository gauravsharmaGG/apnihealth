// Preview mode guards: the loader and auth shim refuse to load without PREVIEW_MODE=1 (and the loader without the
// private/.preview marker); the shim accepts only the exact per-run token. Runs in a temp copy; no real data.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'fh-preview-'));
try{
  mkdirSync(join(dir,'scripts/preview'),{recursive:true});
  for(const f of ['loader.mjs','auth-shim.mjs'])copyFileSync(new URL('scripts/preview/'+f,import.meta.url),join(dir,'scripts/preview',f));
  writeFileSync(join(dir,'access.mjs'),"export const real=true;export async function authorized(){return 'real'}\n");
  writeFileSync(join(dir,'probe.mjs'),"const a=await import('./access.mjs');const t=process.env.PREVIEW_AUTH_TOKEN||'';\n"+
    "console.log(JSON.stringify({real:!!a.real,ok:await a.authorized({headers:{'x-preview-auth':t}}),bad:await a.authorized({headers:{'x-preview-auth':t.slice(1)+'x'}}),none:await a.authorized({headers:{}})}));\n");
  const run=env=>spawnSync(process.execPath,['--import','./scripts/preview/loader.mjs','probe.mjs'],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,...env}});
  const token='t'.repeat(32);
  let r=run({PREVIEW_AUTH_TOKEN:token});assert.notEqual(r.status,0,'loader must refuse without PREVIEW_MODE');assert.match(r.stderr,/PREVIEW_MODE=1 is required/);
  r=run({PREVIEW_MODE:'1',PREVIEW_AUTH_TOKEN:token});assert.notEqual(r.status,0,'loader must refuse without marker');assert.match(r.stderr,/marker missing/);
  mkdirSync(join(dir,'private'));writeFileSync(join(dir,'private/.preview'),'dummy data only\n');
  r=run({PREVIEW_MODE:'1',PREVIEW_AUTH_TOKEN:'short'});assert.notEqual(r.status,0,'shim must refuse a short token');
  r=run({PREVIEW_MODE:'1',PREVIEW_AUTH_TOKEN:token});assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{real:false,ok:true,bad:false,none:false});
  r=spawnSync(process.execPath,['probe.mjs'],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,PREVIEW_MODE:'1',PREVIEW_AUTH_TOKEN:token}});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).real,true,'without the loader the real access.mjs is used');
  const s=spawnSync(process.execPath,[new URL('scripts/preview/seed.mjs',import.meta.url).pathname],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.notEqual(s.status,0,'seed must refuse without PREVIEW_MODE');assert.match(s.stderr,/PREVIEW_MODE=1 is required/);
  console.log('ok test-preview');
}finally{rmSync(dir,{recursive:true,force:true})}
