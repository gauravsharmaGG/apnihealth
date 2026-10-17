// Built-in accounts end to end (AUTH_MODE=builtin) on fictional data: sign-in links, sessions and cookies, CSRF,
// rate limits, cross-household isolation and roles; plus trusted-proxy provisioning and session expiry units.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {fakeSmtp,until,startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-auth-'));
const skip=new Set(['.git','private','node_modules']);
cpSync(src,dir,{recursive:true,filter:p=>!skip.has(p.slice(src.length).split('/')[0])});
const DB=join(dir,'private/test.db'),env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:DB,AUTH_MODE:'builtin',SIGNUP_MODE:'invite',APP_HOST:'health.example.com'};
// two households with members, users and a little data
writeFileSync(join(dir,'setup.mjs'),`
const S=await import('./store.mjs'),A=await import('./accounts.mjs'),log=await import('./log.mjs');S.enterAs(S.SYSTEM);
const a=S.createHousehold('Household A'),b=S.createHousehold('Household B');
S.addMember(a.id,{id:'ann',name:'Ann'});S.addMember(a.id,{id:'kid',name:'Kid',kind:'child'});S.addMember(b.id,{id:'bob',name:'Bob'});
for(const [e,h,r] of [['owner-a@example.com',a,'owner'],['editor-a@example.com',a,'editor'],['viewer-a@example.com',a,'viewer'],['owner-b@example.com',b,'owner']])A.setMembership(h.id,A.createUser(e).id,r);
A.createUser('lonely@example.com');
log.add([{metric:'steps',date:'2000-01-01',value:1111}],'manual','ann');log.add([{metric:'steps',date:'2000-01-01',value:2222}],'manual','bob');
`);
let r=spawnSync(process.execPath,['setup.mjs'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const procs=[];let out='';
async function start(extra={}){
 let o='';const {p,port}=await startServer({cwd:dir,env:{...env,...extra},onData:d=>{o+=d;out+=d}});procs.push(p);
 return {port,base:`http://127.0.0.1:${port}`,output:()=>o};
}
// raw request (fetch cannot set Host or Origin freely)
const req=(port,{method='GET',path='/',headers={},body}={})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`127.0.0.1:${port}`,...headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:b}))});q.on('error',no);if(body)q.write(body);q.end()});
try{
 const S1=await start(),{port}=S1,O=`http://127.0.0.1:${port}`;
 const form=o=>new URLSearchParams(o).toString(),FORM={'Content-Type':'application/x-www-form-urlencoded',Origin:O};
 const links=email=>out.split('\n').filter(l=>l.includes('sign-in link for '+email+': ')).map(l=>l.split(': ').pop().trim());
 const linkFor=email=>until(()=>links(email).at(-1),5000,'link for '+email);
 async function signIn(email){
  const before=links(email).length;
  const s=await req(port,{method:'POST',path:'/auth/email',headers:FORM,body:form({email})});assert.equal(s.status,303);assert.equal(s.headers.location,'/login?sent=1');
  await until(()=>links(email).length>before,5000,'new link');
  const link=new URL(await linkFor(email)),token=link.searchParams.get('token');
  const page=await req(port,{path:link.pathname+link.search});assert.equal(page.status,200);assert(page.body.includes('value="'+token+'"'),'confirmation page carries the token');
  const v=await req(port,{method:'POST',path:'/auth/verify',headers:FORM,body:form({token})});assert.equal(v.status,303,v.body);assert.equal(v.headers.location,'/welcome/passkey','first sign-in offers a passkey');
  const c=v.headers['set-cookie'][0];return {cookie:c.split(';')[0],raw:c,token};
 }
 const as=(c,path,o={})=>req(port,{path,...o,headers:{Cookie:c.cookie,...(o.method&&o.method!=='GET'?{Origin:O,'Content-Type':'application/json'}:{}),...(o.headers||{})}});
 const J=async p=>JSON.parse((await p).body);
 // signed out
 assert.equal((await req(port,{path:'/'})).status,303);assert.equal((await req(port,{path:'/'})).headers.location,'/login');
 assert.equal((await req(port,{path:'/api/log'})).status,401);assert.equal((await req(port,{path:'/config.js'})).status,303);
 assert.equal((await req(port,{path:'/login'})).status,200);assert.equal((await req(port,{path:'/style.css'})).status,200);
 assert.equal((await req(port,{path:'/api/log',headers:{Cookie:'apni_session='+'x'.repeat(43)}})).status,401,'a made-up session is refused');
 // unknown address: same answer, no link
 const u=await req(port,{method:'POST',path:'/auth/email',headers:FORM,body:form({email:'nobody@example.com'})});assert.equal(u.headers.location,'/login?sent=1');
 assert.equal((await req(port,{method:'POST',path:'/auth/email',headers:FORM,body:form({email:'not an email'})})).status,200);
 // owner of A
 const A=await signIn('owner-a@example.com');
 assert.match(A.raw,/HttpOnly/);assert.match(A.raw,/SameSite=Lax/);assert.match(A.raw,/Path=\//);assert.match(A.raw,/Max-Age=2592000/);assert.doesNotMatch(A.raw,/Secure/,'plain http on localhost: no Secure flag');
 const reuse=await req(port,{method:'POST',path:'/auth/verify',headers:FORM,body:form({token:A.token})});assert.equal(reuse.headers.location,'/login?e=expired','a sign-in link works once');
 assert(!out.includes('link for nobody@example.com'),'no link for unknown addresses');
 const cfg=(await as(A,'/config.js')).body;assert(cfg.includes('"ann"')&&cfg.includes('"kid"')&&!cfg.includes('"bob"'),'only own household members');
 assert.equal((await J(as(A,'/api/me'))).household.role,'owner');
 assert.equal((await J(as(A,'/api/log?profile=ann'))).entries[0].value,1111);
 // cross-household isolation: A never reads or writes B's data, B never A's
 const B=await signIn('owner-b@example.com');
 for(const p of ['/api/log','/api/episodes','/api/events','/api/inbox','/api/medicines','/api/appointments','/api/labs','/api/sync-info'])
  assert.equal((await as(A,p+'?profile=bob')).status,400,'A reads '+p+' of B');
 assert.equal((await as(A,'/api/log?profile=bob',{method:'POST',body:JSON.stringify({entries:[{metric:'steps',date:'2000-01-02',value:5}]})})).status,400);
 assert.equal((await as(A,'/api/episodes?profile=bob',{method:'POST',body:JSON.stringify({title:'x'})})).status,400);
 assert.equal((await J(as(B,'/api/log?profile=bob'))).entries.length,1,'B data unchanged');
 assert.equal((await as(B,'/api/log?profile=ann')).status,400);assert.equal((await J(as(B,'/api/log'))).entries[0].value,2222,'default member is from B');
 const del=await J(as(B,'/api/log?profile=bob',{method:'POST',body:JSON.stringify({delete:(await J(as(A,'/api/log?profile=ann'))).entries[0].id})}));assert.equal(del.removed,false);
 // roles
 const V=await signIn('viewer-a@example.com'),E=await signIn('editor-a@example.com');
 assert.equal((await as(V,'/api/log?profile=ann')).status,200,'viewer reads');
 assert.equal((await as(V,'/api/log?profile=ann',{method:'POST',body:JSON.stringify({entries:[{metric:'steps',date:'2000-01-02',value:5}]})})).status,403,'viewer cannot log');
 assert.equal((await as(V,'/api/episodes?profile=ann',{method:'POST',body:JSON.stringify({title:'Example'})})).status,403);
 assert.equal((await as(V,'/api/labs?profile=ann',{method:'POST',body:JSON.stringify({date:'2000-01-01',values:[{name:'Ferritin',value:'1'}]})})).status,403);
 assert.equal((await as(V,'/api/inbox?profile=ann',{method:'POST',body:JSON.stringify({category:'other',date:'2000-01-01',title:'x',fileName:'x.pdf',mimeType:'application/pdf',dataBase64:'AAAA'})})).status,403);
 assert.equal((await as(V,'/api/sync-info?profile=ann')).status,403,'viewer cannot get the sync key');
 assert.equal((await as(E,'/api/log?profile=ann',{method:'POST',body:JSON.stringify({entries:[{metric:'steps',date:'2000-01-02',value:5}]})})).status,200,'editor writes');
 assert.equal((await as(E,'/api/episodes?profile=kid',{method:'POST',body:JSON.stringify({title:'Example'})})).status,201);
 // CSRF: state changes need this origin
 const evil={method:'POST',body:JSON.stringify({entries:[]}),headers:{Origin:'https://evil.example'}};
 assert.equal((await as(A,'/api/log?profile=ann',evil)).status,403);
 assert.equal((await req(port,{method:'POST',path:'/api/log?profile=ann',headers:{Cookie:A.cookie,'Content-Type':'application/json'},body:'{}'})).status,403,'no Origin and no Fetch Metadata');
 assert.equal((await req(port,{method:'POST',path:'/api/log?profile=ann',headers:{Cookie:A.cookie,'Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);
 assert.equal((await req(port,{method:'POST',path:'/auth/email',headers:{...FORM,Origin:'https://evil.example'},body:form({email:'owner-a@example.com'})})).status,403);
 assert.equal((await req(port,{method:'POST',path:'/logout',headers:{Cookie:A.cookie,Origin:'https://evil.example'}})).status,403,'no cross-site sign-out');
 // no household yet
 const L=await signIn('lonely@example.com');
 assert.match((await as(L,'/')).body,/not part of a household/);assert.equal((await as(L,'/api/log')).status,403);
 // sign out ends the session
 const out1=await req(port,{method:'POST',path:'/logout',headers:{Cookie:A.cookie,Origin:O}});assert.equal(out1.status,303);assert.match(out1.headers['set-cookie'][0],/Max-Age=0/);
 assert.equal((await as(A,'/api/me')).status,401);
 // rate limit: at most 5 links per address per 15 minutes
 let last;for(let i=0;i<6;i++)last=await req(port,{method:'POST',path:'/auth/email',headers:FORM,body:form({email:'editor-a@example.com'})});
 assert.equal(last.headers.location,'/login?e=busy');
 // behind TLS (APP_HOST): Secure, __Host- prefixed cookie
 const H={Host:'health.example.com','X-Forwarded-Proto':'https',Origin:'https://health.example.com','Content-Type':'application/x-www-form-urlencoded'};
 await req(port,{method:'POST',path:'/auth/email',headers:H,body:form({email:'owner-b@example.com'})});
 const tl=new URL(await until(async()=>{const m=[...out.matchAll(/sign-in link for owner-b@example\.com: (https:\S+)/g)];return m.length&&m.at(-1)[1]}));
 assert.equal(tl.origin,'https://health.example.com','links use the public origin');
 const sv=await req(port,{method:'POST',path:'/auth/verify',headers:H,body:form({token:tl.searchParams.get('token')})});
 assert.match(sv.headers['set-cookie'][0],/^__Host-apni_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
 // with SMTP configured the link is emailed, not logged
 const smtp=await fakeSmtp();
 const S2=await start({SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,SMTP_FROM:'Example <no-reply@example.com>'});
 await req(S2.port,{method:'POST',path:'/auth/email',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:`http://127.0.0.1:${S2.port}`},body:form({email:'viewer-a@example.com'})});
 const mail=await until(()=>smtp.messages[0],5000,'email');assert.equal(mail.to,'<viewer-a@example.com>');assert.match(mail.data,/\/auth\/verify\?token=[A-Za-z0-9_-]{43}/);
 assert(!S2.output().includes('sign-in link for'),'not printed when emailed');smtp.close();
 console.log('PASS auth (builtin): sign-in links (single use, no enumeration, emailed or logged), session cookies (HttpOnly, SameSite, Secure/__Host- behind TLS), sign-out, CSRF, rate limit, cross-household isolation, owner/editor/viewer roles.');
}finally{for(const p of procs)p.kill();rmSync(dir,{recursive:true,force:true})}

// ---- units: session expiry and sliding, link expiry, trusted-proxy provisioning, AUTH_MODE checks ----
{
 const d2=mkdtempSync(join(tmpdir(),'apni-auth-u-'));
 const code=`
import assert from 'node:assert/strict';
const S=await import('./store.mjs'),A=await import('./accounts.mjs');S.enterAs(S.SYSTEM);
const h=S.createHousehold('H');const u=A.createUser('Someone@Example.com');assert.equal(u.email,'someone@example.com');
assert.throws(()=>A.createUser('someone@example.com'),/UNIQUE/);for(const bad of ['','x','a@b','a b@example.com','<a@example.com>'])assert.throws(()=>A.cleanEmail(bad));
const t0=Date.now(),tok=A.createSession(u.id,t0);assert.equal(A.sessionUser(tok,t0+1000).id,u.id);
assert.equal(A.sessionUser(tok,t0+29*864e5).id,u.id,'used within 30 days: slides');assert.equal(A.sessionUser(tok,t0+58*864e5).id,u.id,'still valid after sliding');
assert.equal(A.sessionUser(tok,t0+120*864e5),null,'expired');assert.equal(A.sessionUser(tok,t0),null,'expired sessions are deleted');
const lt=A.createLoginToken('someone@example.com',t0);assert.equal(A.consumeLoginToken(lt,t0+16*6e4),null,'links expire after 15 minutes');
const db=(await import('./db.mjs')).db();assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?').get(tok)?.n,0,'raw tokens are never stored');
process.env.AUTH_MODE='trusted-proxy';const auth=await import('./auth.mjs');
assert.equal(auth.authMode({}),'builtin');assert.equal(auth.authMode({AUTH_MODE:'trusted-proxy'}),'trusted-proxy');
assert.throws(()=>auth.authMode({CF_ACCESS_ISSUER:'https://x.example'}),/Set AUTH_MODE=trusted-proxy/,'existing Cloudflare setups must choose explicitly');assert.throws(()=>auth.authMode({AUTH_MODE:'none'}));
const first=auth.provision('first@example.com'),second=auth.provision('second@example.com');
assert.equal(A.membership(h.id,first.id),'owner','the first proxy user owns the household');assert.equal(A.membership(h.id,second.id),'editor');
assert.equal(auth.provision('FIRST@example.com').id,first.id,'emails map to the same user');
process.env.TRUSTED_PROXY_ROLE='viewer';assert.equal(A.membership(h.id,auth.provision('third@example.com').id),'viewer');
console.log('PASS auth units: emails, session sliding and expiry, hashed tokens, link expiry, AUTH_MODE checks, trusted-proxy provisioning.');`;
 cpSync(src,d2,{recursive:true,filter:p=>!skip.has(p.slice(src.length).split('/')[0])});writeFileSync(join(d2,'unit.mjs'),code);
 const u=spawnSync(process.execPath,['unit.mjs'],{cwd:d2,encoding:'utf8',env:{PATH:process.env.PATH,DB_FILE:join(d2,'private/u.db')}});
 rmSync(d2,{recursive:true,force:true});assert.equal(u.status,0,u.stderr+u.stdout);process.stdout.write(u.stdout);
}
