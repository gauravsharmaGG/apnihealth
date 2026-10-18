// The Cloudflare Workers target end to end under `wrangler dev` (local workerd + Miniflare: Durable Object SQLite,
// R2, static assets and the Cron Trigger are all simulated locally; no Cloudflare account, nothing deployed).
// Needs network once to fetch the pinned wrangler with npx (not an npm dependency of the app). Fictional data only.
// Run: node test-workers.mjs   (WRANGLER overrides the command, e.g. WRANGLER="npx --yes wrangler@4.151.1")
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import net from 'node:net';import http from 'node:http';
import {until} from './testlib.mjs';
import {CONSENT_VERSION} from './consent.mjs';
const WRANGLER=(process.env.WRANGLER||'npx --yes wrangler@4.151.1').split(' ');
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-workers-')),state=join(dir,'.state');
const freePort=()=>new Promise((ok,no)=>{const s=net.createServer();s.unref();s.on('error',no);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>ok(port))})});
// Only tracked files (no private/ or locally generated data), then the generic build of public/ (empty private/).
for(const f of execFileSync('git',['ls-files','-z'],{cwd:src,encoding:'utf8'}).split('\0').filter(Boolean)){mkdirSync(join(dir,dirname(f)),{recursive:true});try{copyFileSync(join(src,f),join(dir,f))}catch(e){if(e.code!=='ENOENT')throw e}}
execFileSync('git',['init','-q'],{cwd:dir});execFileSync('git',['add','-A'],{cwd:dir});execFileSync('python3',['build.py'],{cwd:dir,stdio:'ignore'});
let proc=null,log='';
async function start(){
 const port=await freePort(),inspector=await freePort();log='';
 proc=spawn(WRANGLER[0],[...WRANGLER.slice(1),'dev','--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspector),'--persist-to',state,
  '--var',`PORT:${port}`,'--var','DO_JURISDICTION:none'],{cwd:dir,env:{...process.env,WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',CI:'1'},stdio:['ignore','pipe','pipe'],detached:true});
 const on=d=>{log+=d};proc.stdout.on('data',on);proc.stderr.on('data',on);
 try{await until(()=>/Ready on http/.test(log)||proc.exitCode!==null,180000,'wrangler dev')}catch(e){throw Error(e.message+'\n'+log)}
 if(proc.exitCode!==null)throw Error('wrangler dev exited:\n'+log);
 const O=`http://127.0.0.1:${port}`;
 const req=async(path,{method='GET',cookie,form,json,body,headers={}}={})=>{
  const h={...headers,...(cookie?{Cookie:cookie}:{})};
  if(method!=='GET'&&method!=='HEAD')h.Origin=O;
  if(form){h['Content-Type']='application/x-www-form-urlencoded';body=new URLSearchParams(form).toString()}
  if(json){h['Content-Type']='application/json';body=JSON.stringify(json)}
  const r=await fetch(O+path,{method,headers:h,body,redirect:'manual'});
  const buf=Buffer.from(await r.arrayBuffer());
  return {status:r.status,headers:r.headers,buf,body:buf.toString('utf8'),json:()=>JSON.parse(buf.toString('utf8'))};
 };
 return {req,O};
}
const stop=async()=>{if(!proc)return;try{process.kill(-proc.pid,'SIGTERM')}catch{}await until(()=>proc.exitCode!==null||proc.signalCode,15000,'wrangler exit').catch(()=>{try{process.kill(-proc.pid,'SIGKILL')}catch{}});proc=null};
try{
 let {req,O}=await start();
 // sign-in page and static files through the app: demo notice, security headers, private paths gated
 const login=await req('/login');assert.equal(login.status,200);assert.match(login.body,/class="demo-notice" role="note">This is a public demo/);
 const css=await req('/style.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
 assert.match(css.headers.get('content-security-policy'),/default-src 'self'/);assert.equal(css.headers.get('cache-control'),'private, no-store, max-age=0');
 assert.equal((await req('/')).headers.get('location'),'/login','signed out: sign in first');
 assert.equal((await req('/api/inbox')).status,401);
 assert.equal((await req('/records/x.pdf')).status,303,'no static file without a session');
 const hostCheck=await new Promise((ok,no)=>http.get(O+'/login',{headers:{Host:'evil.example'}},r=>{r.resume();ok(r.statusCode)}).on('error',no));assert.equal(hostCheck,400,'host check');
 // open sign-up: the emailed link (logged locally, no mail configured), session cookie, consent, onboarding
 const email='first@example.com';
 assert.equal((await req('/auth/email',{method:'POST',form:{email}})).status,303);
 const link=await until(()=>log.split('\n').map(l=>l.split('sign-in link for '+email+': ')[1]).filter(Boolean).pop(),10000,'sign-in link');
 const v=await req('/auth/verify',{method:'POST',form:{token:new URL(link.trim()).searchParams.get('token')}});
 assert.equal(v.status,303,'account created');const cookie=v.headers.get('set-cookie').split(';')[0];
 assert.equal((await req('/consent',{method:'POST',cookie,form:{disclaimer:'yes',consent:'yes',version:CONSENT_VERSION}})).status,303);
 assert.equal((await req('/',{cookie})).headers.get('location'),'/welcome');
 assert.equal((await req('/api/households',{method:'POST',cookie,json:{name:'Example Home',memberName:'Alex Example'}})).status,200);
 const member=(await req('/api/onboarding',{cookie})).json().members[0].id;
 // report-reading assets through the assets binding: wasm allowed only on the app page and those files, cached immutable
 {const {OCR_BASE,PATHS}=await import(join(dir,'public/ocr-assets.mjs'));
  assert.equal((await req('/api/household/onboarded',{method:'POST',cookie,json:{}})).status,200);
  const home=await req('/',{cookie});assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/script-src 'self' 'wasm-unsafe-eval';/);
  assert.match((await req('/style.css',{cookie})).headers.get('content-security-policy'),/script-src 'self';/);
  if(existsSync(join(dir,'public',OCR_BASE))){
   const core=await req(OCR_BASE+PATHS.core+'tesseract-core-simd-lstm.wasm.js',{cookie});assert.equal(core.status,200);assert(core.buf.length>3e6,'the 3.9 MB core in one piece');
   assert.equal(core.headers.get('cache-control'),'private, max-age=31536000, immutable');assert.match(core.headers.get('content-security-policy'),/'wasm-unsafe-eval'/);
   const g=await req(OCR_BASE+PATHS.lang+'eng.traineddata.gz',{cookie});assert.equal(g.headers.get('content-type'),'application/octet-stream');assert.equal(g.buf[0],0x1f);
   assert.equal((await req(OCR_BASE+PATHS.pdfWasm+'qcms_bg.wasm',{cookie})).headers.get('content-type'),'application/wasm');
   assert.equal((await req(OCR_BASE+PATHS.pdf)).status,303,'signed out: no vendored files');
  }else if(process.env.CI)throw Error('CI: build.py should have installed the OCR assets');else console.log('note: OCR assets not installed, vendor serving not checked');
 }
 // an upload goes to R2 and comes back byte for byte; the export ZIP contains it
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
 const up=await req('/api/inbox?profile='+member,{method:'POST',cookie,json:{category:'other',date:'2026-10-05',title:'Example scan',fileName:'scan.png',mimeType:'image/png',dataBase64:png.toString('base64')}});
 assert.equal(up.status,201,up.body);
 const items=(await req('/api/inbox?profile='+member,{cookie})).json().items;assert.equal(items.length,1);
 const file=await req(`/api/inbox/${items[0].id}/file?profile=${member}`,{cookie});assert.equal(file.status,200);assert.deepEqual(file.buf,png,'upload read back from R2');
 const zip=await req('/api/export',{cookie});assert.equal(zip.status,200);assert.equal(zip.headers.get('content-type'),'application/zip');
 assert.equal(zip.buf.readUInt32LE(0),0x04034b50,'a ZIP file');
 const inZip=JSON.parse(execFileSync('python3',['-c','import sys,zipfile,io,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({n:z.read(n).hex() for n in z.namelist() if n.startswith("files/")}))'],{input:zip.buf,encoding:'utf8'}));
 assert.deepEqual(Object.values(inZip),[png.toString('hex')],'the upload is in the export, byte for byte');
 // values read from the upload (migration 10 on the Durable Object): link, household marker, duplicate check, delete refused
 const lab=await req('/api/labs?profile='+member,{method:'POST',cookie,json:{date:'2026-10-05',uploadId:items[0].id,method:'ocr',values:[{name:'Ferritin',rawName:'Ferritin (example lab)',value:'45',unit:'ng/mL',confidence:0.92},{name:'Example custom marker',value:'3',unit:'mg/L'}],learn:{custom:[{name:'Example custom marker',unit:'mg/L'}]}}});
 assert.equal(lab.status,201,lab.body);
 assert.equal((await req('/api/inbox?profile='+member,{cookie})).json().items[0].status,'imported');
 assert((await req('/api/labs/catalog?profile='+member,{cookie})).json().markers.some(m=>m.name==='Example custom marker'&&m.custom),'household marker in the catalog');
 const dup=(await req('/api/labs/check?profile='+member,{method:'POST',cookie,json:{date:'2026-10-05',values:[{marker:'Ferritin',num:45,unit:'µg/L'}]}})).json();assert.deepEqual(dup.duplicates,['Ferritin: iron stores']);
 const del=await req(`/api/inbox/${items[0].id}?profile=${member}`,{method:'DELETE',cookie});assert.equal(del.status,400);assert.match(del.body,/Delete that report first/);
 // the Cron Trigger runs the scheduler without errors
 const sch=await req('/cdn-cgi/local/scheduled');assert.equal(sch.status,200);await new Promise(r=>setTimeout(r,500));assert.doesNotMatch(log,/scheduled: /,'scheduler reported no errors');
 // data survives a restart (Durable Object SQLite and R2 persisted locally)
 await stop();({req,O}=await start());
 assert.equal((await req('/api/inbox?profile='+member,{cookie})).json().items.length,1,'session and records persist');
 assert.deepEqual((await req(`/api/inbox/${items[0].id}/file?profile=${member}`,{cookie})).buf,png,'file persists');
 console.log('PASS workers (wrangler dev): sign-in page with demo notice and headers, report-reading assets (CSP, cache, MIME), gating and host check, open sign-up by emailed link, consent, onboarding in Durable Object SQLite, upload to R2 and back, values read from it saved with a household marker and duplicate check, ZIP export, Cron Trigger scheduler, data persists across restarts.');
}catch(e){console.error(log.slice(-4000));throw e}
finally{await stop();rmSync(dir,{recursive:true,force:true})}
