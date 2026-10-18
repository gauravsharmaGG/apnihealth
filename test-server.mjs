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
 const sync=await (await get('/api/sync-info?profile=sam')).json();assert.equal(sync.endpoint,'https://health.example.com/api/ingest');assert.equal(sync.keys.length,1,'the migrated shared key');assert(sync.keys[0].shared);
 const ics=await (await get('/api/appointments/ics?profile=alex&id='+(await (await get('/api/appointments?profile=alex')).json()).appointments[0].id)).text();
 assert(ics.includes('PRODID:-//Test Health//EN')&&ics.includes('@health.example.com')&&ics.includes('SUMMARY:Alex: '));
 const child=await (await get('/data-child.js')).text();assert(child.startsWith('window.CHILD_RECORDS={"mia":'));
 const del=await fetch(base+'/api/log?profile=sam',{method:'POST',headers:{...H,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({delete:log.entries[0].id})});
 assert.equal((await del.json()).removed,false,'an entry can only be deleted from its own member');
 assert.equal((await fetch(base+'/api/log',{method:'POST',headers:{...H,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403,'foreign origin rejected');
 // writes go to the database, per member: an episode added for sam is not visible to alex or mia
 const post=(p,body)=>fetch(base+p,{method:'POST',headers:{...H,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const ep=(await (await post('/api/episodes?profile=sam',{title:'Example sore throat',category:'Illness'})).json()).episode;assert(ep?.id);
 assert.deepEqual((await (await get('/api/episodes?profile=sam')).json()).episodes.map(e=>e.id),[ep.id]);
 assert(!(await (await get('/api/episodes?profile=alex')).json()).episodes.some(e=>e.id===ep.id),'episodes are isolated');
 assert.equal((await post('/api/events?profile=alex',{episodeId:ep.id,date:'2000-01-01',time:'08:00',kind:'note',note:'x'})).status,400,'cannot attach to another member\'s episode');
 assert.equal((await post('/api/events?profile=sam',{episodeId:ep.id,date:'2000-01-01',time:'08:00',kind:'note',note:'Example note'})).status,201);
 assert.equal((await post('/api/log?profile=sam',{entries:[{metric:'steps',date:new Date().toISOString().slice(0,10),value:1234}]})).status,200);
 assert.equal((await (await get('/api/log?profile=sam')).json()).entries.length,1);
 // lab results: per member, through the API
 const labsOf=async p=>(await get('/api/labs?profile='+p)).json();
 const la=await labsOf('alex');assert(la.measurements.length>10&&la.reports.length===4&&la.pending.length===1);
 const ls=await labsOf('sam');assert.deepEqual(ls.measurements.map(m=>m.points.length).sort(),[1,2],'a second adult has their own lab results');assert(ls.measurements.every(m=>m.points.every(p=>p.source===null)));
 assert.equal((await labsOf('mia')).measurements.length,0);
 const cat=await (await get('/api/labs/catalog')).json();assert(cat.markers.length>50&&cat.markers.every(m=>m.name&&m.group&&Array.isArray(m.aliases)));
 {const g=cat.markers.find(m=>m.name==='Fasting blood sugar');assert.equal(g.unit,'mg/dL');assert.equal(g.units[0].factor,18.016);assert.deepEqual(g.plausible,[10,2000])}
 const lr=await post('/api/labs?profile=mia',{date:'2000-01-01',values:[{name:'Hemoglobin',value:'12',unit:'g/dL'}]});assert.equal(lr.status,201,'any member can hold lab results');
 const added=await lr.json();assert.equal(added.measurements.length,1);
 assert.equal((await post('/api/labs?profile=mia',{date:'2000-01-01',values:[{name:'Not a real marker',value:'1'}]})).status,400);
 const delOther=await fetch(base+'/api/labs/'+added.id+'?profile=alex',{method:'DELETE',headers:{...H,Origin:base}});assert.equal(delOther.status,404,'cannot delete another member\'s report');
 assert.equal((await fetch(base+'/api/labs/'+added.id+'?profile=mia',{method:'DELETE',headers:{...H,Origin:'https://evil.example'}})).status,403);
 const delOwn=await fetch(base+'/api/labs/'+added.id+'?profile=mia',{method:'DELETE',headers:{...H,Origin:base}});assert.equal(delOwn.status,200);assert.equal((await delOwn.json()).measurements.length,0);
 assert.equal((await get('/data.js')).status,404,'lab data is no longer a static build output');
 assert(existsSync(join(dir,'private/apnihealth.db'))&&!existsSync(join(dir,'private/health-log.json'))&&!existsSync(join(dir,'private/profiles/sam/episodes.json')),'data is stored in the database, not JSON files');
 console.log('PASS server: auth fail-closed, host check, config/members endpoints, member isolation (reads and writes, stored in SQLite), lab results API, ics/ingest use instance settings.');
}finally{srv?.kill();rmSync(dir,{recursive:true,force:true})}
