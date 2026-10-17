// Demo instances (fictional data only): an empty database starts with open built-in sign-up, the first person
// to sign up gets their own household, and DEMO_NOTICE is shown (escaped) on the sign-in pages and the app shell.
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {until,startServer} from './testlib.mjs';
import {CONSENT_VERSION} from './consent.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-demo-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const NOTICE='Demo <b>instance</b>: data may be wiped. Do not enter real health data.';
const base={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/demo.db'),AUTH_MODE:'builtin'};
const procs=[];
async function server(extra){let log='';const {p,port}=await startServer({cwd:dir,env:{...base,...extra},onData:d=>log+=d});procs.push(p);
 const req=({method='GET',path,cookie,form})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(cookie?{Cookie:cookie}:{}),...(form?{'Content-Type':'application/x-www-form-urlencoded',Origin:`http://localhost:${port}`}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:b}))});q.on('error',no);q.end(form?new URLSearchParams(form).toString():undefined)});
 const links=email=>log.split('\n').filter(l=>l.includes('sign-in link for '+email+': ')).map(l=>new URL(l.split(': ').pop().trim()));
 return {req,links};
}
try{
 // empty database + open sign-up: starts, shows the notice escaped
 const S=await server({SIGNUP_MODE:'open',DEMO_NOTICE:NOTICE});
 const login=await S.req({path:'/login'});
 assert.equal(login.status,200);
 assert.ok(login.body.includes('<p class="demo-notice" role="note">Demo &lt;b&gt;instance&lt;/b&gt;: data may be wiped.'),'notice on the sign-in page, escaped');
 assert.ok(!login.body.includes('<b>instance</b>'),'notice is never raw HTML');
 // first sign-up on an empty instance
 const email='first@example.com';
 await S.req({method:'POST',path:'/auth/email',form:{email}});await until(()=>S.links(email).length,5000,'sign-in link');
 const v=await S.req({method:'POST',path:'/auth/verify',form:{token:S.links(email)[0].searchParams.get('token')}});
 assert.equal(v.status,303,'account created');const cookie=v.headers['set-cookie'][0].split(';')[0];
 assert.equal((await S.req({method:'POST',path:'/consent',cookie,form:{disclaimer:'yes',consent:'yes',version:CONSENT_VERSION}})).status,303,'consent recorded');
 const home=await S.req({path:'/',cookie});assert.equal(home.status,303);assert.equal(home.headers.location,'/welcome','no household yet: first-run setup');
 const w=await S.req({path:'/welcome',cookie});assert.equal(w.status,200);
 assert.equal((w.body.match(/class="demo-notice"/g)||[]).length,1,'notice on the app shell, once');
 assert.ok(w.body.includes('Demo &lt;b&gt;instance&lt;/b&gt;'));
 assert.equal(Number(w.headers['content-length']),Buffer.byteLength(w.body),'content length matches the injected page');
 // without DEMO_NOTICE: no banner
 procs.pop().kill();
 const N=await server({SIGNUP_MODE:'open'});
 assert.ok(!(await N.req({path:'/login'})).body.includes('demo-notice'),'no notice by default');
 assert.ok(!(await N.req({path:'/welcome.html'})).body.includes('demo-notice'));
 procs.pop().kill();
 // invite-only with no members still fails fast at startup
 const empty={...base,DB_FILE:join(dir,'private/empty.db'),SIGNUP_MODE:'invite'};
 await assert.rejects(startServer({cwd:dir,env:empty}),/No household members yet/,'invite mode needs members');
 console.log('PASS demo: empty instance starts with open sign-up; first sign-up reaches setup; DEMO_NOTICE shown escaped on sign-in and app pages; off by default; invite mode still fails fast.');
}finally{for(const p of procs)p.kill()}
