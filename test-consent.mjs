// Health-data notice and consent (fictional data): everything health-related is blocked until the current version
// is accepted, acceptance is recorded with time and version, a new version asks again, and the store refuses
// writes without consent even if a route forgot to check.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-cs-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin',PRIVACY_URL:'https://example.com/privacy'};
const node=code=>{const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
const U=JSON.parse(node(`const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs');S.enterAs(S.SYSTEM);
const h=S.createHousehold('Household A');S.addMember(h.id,{id:'ann',name:'Ann'});
const out={};for(const [e,r,c] of [['owner@example.com','owner','current'],['editor@example.com','editor',null],['old@example.com','editor','old']]){const u=A.createUser(e);A.setMembership(h.id,u.id,r);
 if(c==='current')C.recordConsent(u.id);if(c==='old')C.recordConsent(u.id,'2000-01-01.0');out[e]={id:u.id,token:A.createSession(u.id)}}
console.log(JSON.stringify(out))`));
let p;
try{
 const s=await startServer({cwd:dir,env});p=s.p;const port=s.port,O=`http://localhost:${port}`;
 const req=({method='GET',path,who,json,form})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(who?{Cookie:'apni_session='+U[who].token}:{}),...(method!=='GET'?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json',Origin:O}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,headers:res.headers,body:b,json:j})})});q.on('error',no);q.end(form?new URLSearchParams(form).toString():json?JSON.stringify(json):undefined)});
 const E='editor@example.com';
 // before consent: pages go to /consent, every health API is refused, nothing is written
 assert.equal((await req({path:'/',who:E})).headers.location,'/consent');
 assert.equal((await req({path:'/config.js',who:E})).headers.location,'/consent');
 for(const [path,json] of [['/api/log?profile=ann',null],['/api/episodes?profile=ann',null],['/api/medicines?profile=ann',null],['/api/household',null],['/api/me',null]]){const r=await req({path,who:E});assert.equal(r.status,403,path);assert.equal(r.json.consent,'required')}
 for(const [path,json] of [['/api/log?profile=ann',{entries:[{metric:'steps',date:'2000-01-01',value:5}]}],['/api/episodes?profile=ann',{title:'Example'}],['/api/inbox?profile=ann',{category:'other',date:'2000-01-01',title:'x',fileName:'x.pdf',mimeType:'application/pdf',dataBase64:'AAAA'}],['/api/households',{name:'X'}],['/api/household/members',{name:'X'}]])
  assert.equal((await req({method:'POST',path,who:E,json})).status,403,'no write before consent: '+path);
 assert.equal(node(`const S=await import('./store.mjs');S.enterAs(S.SYSTEM);console.log(S.system().prepare('SELECT (SELECT COUNT(*) FROM log_entries)+(SELECT COUNT(*) FROM episodes)+(SELECT COUNT(*) FROM inbox_items) n').get().n)`),'0');
 assert(!existsSync(join(dir,'private/profiles/ann/uploads')),'no upload file written');
 // the notice
 const page=await req({path:'/consent',who:E});assert.equal(page.status,200);
 assert.match(page.body,/not medical advice and not a medical device/);assert.match(page.body,/explicitly consent/);assert.match(page.body,/href="https:\/\/example.com\/privacy"/);
 const version=page.body.match(/name="version" value="([^"]+)"/)[1];
 assert.equal((await req({method:'POST',path:'/consent',who:E,form:{consent:'yes',version}})).status,400,'both boxes are required');
 assert.equal((await req({method:'POST',path:'/consent',who:E,form:{disclaimer:'yes',version}})).status,400);
 assert.equal((await req({method:'POST',path:'/consent',who:E,form:{disclaimer:'yes',consent:'yes',version:'1999-01-01.0'}})).status,400,'a stale page cannot accept the current notice');
 const t0=Date.now(),ok=await req({method:'POST',path:'/consent',who:E,form:{disclaimer:'yes',consent:'yes',version}});assert.equal(ok.status,303);assert.equal(ok.headers.location,'/');
 const me=(await req({path:'/api/me',who:E})).json;assert.equal(me.consent.version,version);assert.equal(me.consent.accepted.at(-1).version,version);
 assert(Math.abs(Date.parse(me.consent.accepted.at(-1).acceptedAt)-t0)<60000,'recorded with a timestamp');
 assert.equal((await req({method:'POST',path:'/api/log?profile=ann',who:E,json:{entries:[{metric:'steps',date:'2000-01-01',value:5}]}})).status,200,'writes work after consent');
 assert.match((await req({path:'/consent',who:E})).body,/You accepted version/);
 // a new notice version asks again (this user accepted an old one)
 assert.equal((await req({path:'/',who:'old@example.com'})).headers.location,'/consent');
 assert.match((await req({path:'/consent',who:'old@example.com'})).body,/has changed since you last accepted/);
 assert.equal((await req({method:'POST',path:'/api/log?profile=ann',who:'old@example.com',json:{entries:[]}})).status,403);
 // CSRF still applies to the consent form
 assert.equal((await new Promise(ok=>{const q=http.request({host:'127.0.0.1',port,method:'POST',path:'/consent',headers:{Host:`localhost:${port}`,Cookie:'apni_session='+U['old@example.com'].token,Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'}},ok);q.end('disclaimer=yes&consent=yes&version='+version)})).statusCode,403);
 // defence in depth: the store itself refuses writes for a person without consent
 const unit=node(`const S=await import('./store.mjs');const out=[];
for(const id of ${JSON.stringify([U['old@example.com'].id,U['owner@example.com'].id])}){S.enterAs({type:'user',userId:id,household:null});
 try{S.forMember('ann').run("INSERT INTO log_entries(id,member_id,metric,date,value,source,ts) VALUES('x'||abs(random()),$member,'steps','2000-01-02',1,'manual',0)");out.push('wrote')}catch(e){out.push(e.message)}}
console.log(JSON.stringify(out))`);
 assert.deepEqual(JSON.parse(unit),['Accept the health data notice first','wrote']);
 console.log('PASS consent: no health reads or writes (DB rows or files) before consent, notice text and privacy link, both boxes and current version required, timestamped record, re-prompt on new version, CSRF, store-level guard.');
}finally{p?.kill();rmSync(dir,{recursive:true,force:true})}
