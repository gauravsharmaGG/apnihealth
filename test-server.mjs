// End to end on fictional data: copy the code to a temp dir, seed preview data, build, start the server with the
// preview auth shim and check the member-driven endpoints, isolation and fail-closed behaviour.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import http from 'node:http';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-server-'));
const skip=new Set(['.git','private','node_modules']);
cpSync(src,dir,{recursive:true,filter:p=>!skip.has(p.slice(src.length).split('/')[0])&&!/public\/(data|data-child|reports-data|notes)\.js$|public\/index\.html$/.test(p)});
const env={PATH:process.env.PATH,PREVIEW_MODE:'1',NO_PUSH:'1',APP_TIME_ZONE:'Europe/Berlin'};
let srv;
try{
 let r=spawnSync(process.execPath,['scripts/preview/seed.mjs'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 spawnSync('git',['init','-q'],{cwd:dir});
 r=spawnSync('python3',['build.py'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);
 const html=readFileSync(join(dir,'public/index.html'),'utf8');assert(!html.includes('<!--SLOT:')&&!html.includes('<!--REPORT_LIBRARY-->'));
 const token=randomBytes(16).toString('hex'),port=4300+Math.floor(Math.random()*500);
 srv=spawn(process.execPath,['--import','./scripts/preview/loader.mjs','server.mjs'],{cwd:dir,env:{...env,PORT:String(port),PREVIEW_AUTH_TOKEN:token,APP_HOST:'health.example.com',APP_NAME:'Test Health'},stdio:['ignore','pipe','pipe']});
 await new Promise((ok,no)=>{srv.stdout.on('data',d=>/listening/.test(d)&&ok());srv.on('exit',c=>no(Error('server exited '+c)));setTimeout(()=>no(Error('server did not start')),8000)});
 const base=`http://127.0.0.1:${port}`,H={'X-Preview-Auth':token};
 const get=(p,h=H)=>fetch(base+p,{headers:h});
 assert.equal((await get('/',{})).status,403,'no token: denied');
 assert.equal((await get('/config.js',{})).status,403,'config needs auth too');
 const hostStatus=h=>new Promise((ok,no)=>http.get({host:'127.0.0.1',port,path:'/',headers:{...H,Host:h}},res=>{res.resume();ok(res.statusCode)}).on('error',no));
 assert.equal(await hostStatus('evil.example'),400,'unknown host rejected');
 assert.equal(await hostStatus('health.example.com'),308,'APP_HOST over plain http redirects to https');
 const cfg=await (await get('/config.js')).text();assert.match(cfg,/^window\.APP_CONFIG=/);
 const C=JSON.parse(cfg.slice('window.APP_CONFIG='.length,-2));
 assert.equal(C.name,'Test Health');assert.equal(C.timeZone,'Europe/Berlin');assert.deepEqual(C.members.map(m=>m.id),['alex','sam','mia']);
 const css=await (await get('/members.css')).text();assert.match(css,/\.pc-mia\{--pc:#3b6ea5\}/);
 assert.equal((await get('/')).status,200);
 const log=await (await get('/api/log')).json();assert(log.entries.length>50,'default member is the first one');
 assert.equal((await (await get('/api/log?profile=sam')).json()).entries.length,0,'members are isolated');
 assert.equal((await get('/api/log?profile=nobody')).status,400);
 assert.equal((await get('/api/episodes?profile=../alex')).status,400);
 assert.equal((await (await get('/api/episodes?profile=mia')).json()).episodes.length,1);
 const sync=await (await get('/api/sync-info?profile=sam')).json();assert.equal(sync.endpoint,'https://health.example.com/api/ingest?profile=sam');
 const ics=await (await get('/api/appointments/ics?profile=alex&id='+(await (await get('/api/appointments?profile=alex')).json()).appointments[0].id)).text();
 assert(ics.includes('PRODID:-//Test Health//EN')&&ics.includes('@health.example.com')&&ics.includes('SUMMARY:Alex: '));
 const child=await (await get('/data-child.js')).text();assert(child.startsWith('window.CHILD_RECORDS={"mia":'));
 const del=await fetch(base+'/api/log?profile=sam',{method:'POST',headers:{...H,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({delete:log.entries[0].id})});
 assert.equal((await del.json()).removed,false,'an entry can only be deleted from its own member');
 assert.equal((await fetch(base+'/api/log',{method:'POST',headers:{...H,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403,'foreign origin rejected');
 console.log('PASS server: auth fail-closed, host check, config/members endpoints, member isolation, ics/ingest use instance settings.');
}finally{srv?.kill();rmSync(dir,{recursive:true,force:true})}
