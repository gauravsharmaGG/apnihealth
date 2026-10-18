// scripts/vendor-ocr.mjs without network: the tar reader, the sha256 checks (a changed tarball or file is refused,
// nothing half-written is left) and the lock itself (public/ocr-assets.mjs). Fictional packages only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {untar,check,vendor} from './scripts/vendor-ocr.mjs';
import {OCR_ID,OCR_BASE,PATHS,LANGS,PACKAGES} from './public/ocr-assets.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

// A minimal ustar writer for the fixtures (one long name goes through the prefix field).
function tar(files){
 const blocks=[];
 for(const [name,data] of Object.entries(files)){
  const h=Buffer.alloc(512);let n=name,prefix='';
  if(n.length>100){const i=n.lastIndexOf('/',n.length-101>0?155:n.length);prefix=n.slice(0,i);n=n.slice(i+1)}
  h.write(n,0);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
  h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.write('0',156);h.write('ustar\0',257);h.write('00',263);h.write(prefix,345);
  h.fill(' ',148,156);let sum=0;for(const b of h)sum+=b;h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));
 }
 blocks.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(blocks));
}

// the lock: every package and file pinned, one OCR_ID path, the browser paths all exist in it
assert.match(OCR_ID,/^[a-z0-9._-]+$/);assert.equal(OCR_BASE,`/vendor/ocr/${OCR_ID}/`);
const targets=new Set(PACKAGES.flatMap(p=>p.files.map(f=>f.to)));
for(const p of PACKAGES){
 assert.match(p.sha256,/^[0-9a-f]{64}$/,p.name);assert.match(p.tarball,new RegExp(`^https://registry\\.npmjs\\.org/${p.name.replace('.','\\.')}/-/`),p.name);
 for(const f of p.files){assert.match(f.sha256,/^[0-9a-f]{64}$/,f.to);assert(f.size<25*1024*1024,'Workers: max 25 MiB per asset');assert(!f.to.includes('..'))}
}
for(const k of ['pdf','pdfWorker','tesseract','tesseractWorker'])assert(targets.has(PATHS[k]),k);
for(const l of LANGS)assert(targets.has(`${PATHS.lang}${l}.traineddata.gz`),l);
for(const v of ['','simd-','relaxedsimd-'])assert(targets.has(`${PATHS.core}tesseract-core-${v}lstm.wasm.js`));
assert(PACKAGES.every(p=>p.license.startsWith('Apache-2.0')));

// tar reader: plain and prefixed long names
const long='package/'+'d'.repeat(120)+'/file.txt';
const files=untar(tar({'package/a.js':Buffer.from('console.log(1)\n'),[long]:Buffer.from('x'.repeat(700)),'package/LICENSE':Buffer.from('Example licence\n')}));
assert.deepEqual([...files.keys()],['package/a.js',long,'package/LICENSE']);assert.equal(files.get(long).length,700);

// vendor() from a cached fictional tarball, then refusals
const tmp=mkdtempSync(join(tmpdir(),'apni-vendor-')),cache=join(tmp,'cache'),out=join(tmp,'out');mkdirSync(cache);
const a=Buffer.from('console.log(1)\n'),tgz=tar({'package/a.js':a,'package/LICENSE':Buffer.from('Example licence\n')});
const pkg=over=>[{name:'example-pkg',version:'1.0.0',license:'Apache-2.0',tarball:'https://registry.invalid/example-pkg-1.0.0.tgz',sha256:sha(tgz),files:[{from:'package/a.js',to:'x/a.js',sha256:sha(a)}],licenses:[['package/LICENSE','x/LICENSE']],...over}];
const quiet=()=>{};
try{
 writeFileSync(join(cache,'example-pkg-1.0.0.tgz'),tgz);
 const dir=await vendor({out,cache,offline:true,log:quiet,packages:pkg(),id:'t1'});
 assert.deepEqual(readFileSync(join(dir,'x/a.js')),a);assert(existsSync(join(dir,'x/LICENSE'))&&existsSync(join(dir,'lang/NOTICE')));
 assert.deepEqual(check(dir,pkg()),[]);
 writeFileSync(join(dir,'x/a.js'),'changed');assert.deepEqual(check(dir,pkg()),['x/a.js: sha256 differs']);
 await vendor({out,cache,offline:true,log:quiet,packages:pkg(),id:'t1'});assert.deepEqual(readFileSync(join(dir,'x/a.js')),a,'a changed file is replaced');
 // a file inside the tarball that does not match its pin: refused, nothing installed
 await assert.rejects(vendor({out,cache,offline:true,log:quiet,packages:pkg({files:[{from:'package/a.js',to:'x/a.js',sha256:'0'.repeat(64)}]}),id:'t2'}),/sha256 differs; refusing/);
 assert(!existsSync(join(out,'t2')));
 // a cached tarball with the wrong hash is dropped; offline it cannot be fetched again
 await assert.rejects(vendor({out,cache,offline:true,log:quiet,packages:pkg({sha256:'1'.repeat(64)}),id:'t3'}),/not in the cache/);
 assert(!existsSync(join(cache,'example-pkg-1.0.0.tgz')),'a tarball that fails its hash is removed from the cache');
 assert.deepEqual(readdirSync(out).sort(),['t1'],'no temp folders left behind');
 assert.deepEqual(check(join(tmp,'none'),pkg()),['x/a.js: missing']);
}finally{rmSync(tmp,{recursive:true,force:true})}
console.log('vendor-ocr ok');
