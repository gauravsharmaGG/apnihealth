// Sign-up (SIGNUP_MODE) with built-in sign-in, on fictional data: open sign-up by verified email, invite-only mode,
// the one-time passkey prompt, no account enumeration, and new accounts see nothing of other households.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {until,startServer,fakeSmtp} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-su-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin'};
writeFileSync(join(dir,'setup.mjs'),`const S=await import('./store.mjs'),A=await import('./accounts.mjs'),log=await import('./log.mjs');S.enterAs(S.SYSTEM);
const h=S.createHousehold('Household A');S.addMember(h.id,{id:'ann',name:'Ann'});A.setMembership(h.id,A.createUser('owner-a@example.com').id,'owner');
log.add([{metric:'steps',date:'2000-01-01',value:1234}],'manual','ann');`);
assert.equal(spawnSync(process.execPath,['setup.mjs'],{cwd:dir,env,encoding:'utf8'}).status,0);
const procs=[];
async function server(extra={}){let log='';const {p,port}=await startServer({cwd:dir,env:{...env,...extra},onData:d=>log+=d});procs.push(p);
 const req=({method='GET',path,cookie,form})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(cookie?{Cookie:cookie}:{}),...(form?{'Content-Type':'application/x-www-form-urlencoded',Origin:`http://localhost:${port}`}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:b}))});q.on('error',no);q.end(form?new URLSearchParams(form).toString():undefined)});
 const links=email=>log.split('\n').filter(l=>l.includes('sign-in link for '+email+': ')).map(l=>new URL(l.split(': ').pop().trim()));
 async function signIn(email){const n=links(email).length;await req({method:'POST',path:'/auth/email',form:{email}});await until(()=>links(email).length>n,5000,'link for '+email);
  const t=links(email).at(-1).searchParams.get('token'),v=await req({method:'POST',path:'/auth/verify',form:{token:t}});return {v,cookie:v.headers['set-cookie']?.[0].split(';')[0]}}
 return {req,signIn,links,log:()=>log};
}
try{
 // default: open sign-up
 const S=await server();
 assert.match((await S.req({path:'/login'})).body,/New here\?/);
 const n=await S.signIn('new-person@example.com');
 assert.equal(n.v.status,303);assert.equal(n.v.headers.location,'/welcome/passkey','new account, offered a passkey');
 const pp=await S.req({path:'/welcome/passkey',cookie:n.cookie});assert.equal(pp.status,200);assert.match(pp.body,/pk-prompt-add/);assert.match(pp.body,/src="\/passkey-prompt.js"/);
 assert.equal((await S.req({path:'/passkey-prompt.js',cookie:n.cookie})).status,200);
 const again=await S.signIn('new-person@example.com');assert.equal(again.v.headers.location,'/','the passkey prompt is shown once');
 assert.equal((await S.req({path:'/',cookie:n.cookie})).headers.location,'/consent','the health data notice comes first');
 const ver=(await S.req({path:'/consent',cookie:n.cookie})).body.match(/name="version" value="([^"]+)"/)[1];
 assert.equal((await S.req({method:'POST',path:'/consent',cookie:n.cookie,form:{disclaimer:'yes',consent:'yes',version:ver}})).status,303);
 const home=await S.req({path:'/',cookie:n.cookie});assert.equal(home.headers.location,'/welcome','a new account starts without a household, in onboarding');
 assert.equal((await S.req({path:'/api/log?profile=ann',cookie:n.cookie})).status,403,'and sees nothing of existing households');
 // same answer for known and unknown addresses
 const a=await S.req({method:'POST',path:'/auth/email',form:{email:'owner-a@example.com'}}),b=await S.req({method:'POST',path:'/auth/email',form:{email:'someone-else@example.com'}});
 assert.equal(a.headers.location,b.headers.location);assert.equal(a.body,b.body);
 // a link that was never verified creates no account
 const pending=S.links('someone-else@example.com').length;assert.equal(pending,1);
 const users=()=>JSON.parse(spawnSync(process.execPath,['--input-type=module','-e',"const A=await import('./accounts.mjs');console.log(JSON.stringify(A.userCount()))"],{cwd:dir,env,encoding:'utf8'}).stdout);
 assert.equal(users(),2,'owner + the verified new person only');
 // with SMTP: different subjects for new and existing addresses
 const smtp=await fakeSmtp(),M=await server({SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,SMTP_FROM:'Example <no-reply@example.com>'});
 await M.req({method:'POST',path:'/auth/email',form:{email:'brand-new@example.com'}});await M.req({method:'POST',path:'/auth/email',form:{email:'owner-a@example.com'}});
 await until(()=>smtp.messages.length>=2,5000,'two emails');
 const subj=e=>smtp.messages.find(m=>m.to==='<'+e+'>').data.match(/^Subject: (.*)$/m)[1];
 assert.match(subj('brand-new@example.com'),/Create your/);assert.match(subj('owner-a@example.com'),/Sign in to/);smtp.close();
 // invite-only mode
 const I=await server({SIGNUP_MODE:'invite'});
 assert.match((await I.req({path:'/login'})).body,/Ask the person who runs this app for an invite/);
 await I.req({method:'POST',path:'/auth/email',form:{email:'uninvited@example.com'}});await new Promise(r=>setTimeout(r,200));
 assert.equal(I.links('uninvited@example.com').length,0,'invite mode: no link for unknown addresses');
 // a bad SIGNUP_MODE stops the server
 const bad=spawnSync(process.execPath,['server.mjs'],{cwd:dir,env:{...env,PORT:'1',SIGNUP_MODE:'everyone'},encoding:'utf8',timeout:8000});
 assert.notEqual(bad.status,0);assert.match(bad.stderr,/SIGNUP_MODE must be/);
 console.log('PASS signup: open by default (verified email creates the account), invite-only mode, one-time passkey prompt, no enumeration, new accounts isolated, bad SIGNUP_MODE refused.');
}finally{for(const p of procs)p.kill();rmSync(dir,{recursive:true,force:true})}
