// Passkeys (WebAuthn) on fictional data: the verifier against a software authenticator (ES256, Ed25519, RS256,
// tampering, wrong origin/RP/challenge, counters, malformed CBOR) and the server flow end to end (register,
// sign in, single-use challenges, other users' passkeys, CSRF).
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {randomBytes} from 'node:crypto';
import * as W from './webauthn.mjs';
import {softAuthenticator,encodeCbor,startServer} from './testlib.mjs';

// ---- verifier units ----
const origin='https://health.example.com',rpId='health.example.com',ch=()=>randomBytes(32).toString('base64url');
for(const alg of [-7,-8,-257]){
 const a=softAuthenticator({alg}),c1=ch();
 const reg=W.verifyRegistration(a.create({challenge:c1,origin,rpId,user:'dXNlcg'}),{challenge:c1,origin,rpId});
 assert.equal(reg.id,a.id);assert.equal(reg.alg,alg);assert.deepEqual(reg.transports,['internal']);
 let stored={...reg};
 const c2=ch();stored.signCount=W.verifyAssertion(a.get({challenge:c2,origin,rpId}),stored,{challenge:c2,origin,rpId});assert.equal(stored.signCount,2);
 const bad=(fn,msg)=>assert.throws(fn,msg);
 const c3=ch();
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId}),stored,{challenge:ch(),origin,rpId}),/Challenge/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin:'https://evil.example',rpId}),stored,{challenge:c3,origin,rpId}),/Origin/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId:'evil.example'}),stored,{challenge:c3,origin,rpId}),/relying party/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId,type:'webauthn.create'}),stored,{challenge:c3,origin,rpId}),/ceremony/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId,flags:0x04}),stored,{challenge:c3,origin,rpId}),/presence/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId,flags:0x01}),stored,{challenge:c3,origin,rpId,requireUV:true}),/verification/);
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId,clientData:{crossOrigin:true}}),stored,{challenge:c3,origin,rpId}),/Cross-origin/);
 const t=a.get({challenge:c3,origin,rpId}),s=Buffer.from(t.response.signature,'base64url');s[s.length-1]^=1;t.response.signature=s.toString('base64url');
 bad(()=>W.verifyAssertion(t,stored,{challenge:c3,origin,rpId}),/signature|Invalid/);
 const ad=Buffer.from(a.get({challenge:c3,origin,rpId}).response.authenticatorData,'base64url');
 const t2=a.get({challenge:c3,origin,rpId});const ad2=Buffer.from(t2.response.authenticatorData,'base64url');ad2[36]^=0x10;t2.response.authenticatorData=ad2.toString('base64url');
 bad(()=>W.verifyAssertion(t2,stored,{challenge:c3,origin,rpId}),/signature/,'authenticator data is covered by the signature');
 bad(()=>W.verifyAssertion(a.get({challenge:c3,origin,rpId,setCount:2}),stored,{challenge:c3,origin,rpId}),/counter/);
 const other=softAuthenticator({alg});bad(()=>W.verifyAssertion(other.get({challenge:c3,origin,rpId}),stored,{challenge:c3,origin,rpId}),/Unknown passkey/);
 void ad;
 // registration checks
 const c4=ch();
 bad(()=>W.verifyRegistration(a.create({challenge:c4,origin:'http://health.example.com',rpId,user:'x'}),{challenge:c4,origin,rpId}),/Origin/);
 bad(()=>W.verifyRegistration(a.create({challenge:c4,origin,rpId:'example.com',user:'x'}),{challenge:c4,origin,rpId}),/relying party/);
 bad(()=>W.verifyRegistration({...a.create({challenge:c4,origin,rpId,user:'x'}),id:'AAAA'},{challenge:c4,origin,rpId}),/mismatch/);
 bad(()=>W.verifyRegistration(a.create({challenge:c4,origin,rpId,user:'x',flags:0x40}),{challenge:c4,origin,rpId}),/presence/);
}
// authenticators without a counter (always 0, as many synced passkeys) are fine
{const a=softAuthenticator({counter:false}),c=ch();const st=W.verifyRegistration(a.create({challenge:c,origin,rpId,user:'x'}),{challenge:c,origin,rpId});
 for(let i=0;i<2;i++){const c2=ch();assert.equal(W.verifyAssertion(a.get({challenge:c2,origin,rpId}),st,{challenge:c2,origin,rpId}),0)}}
// CBOR: truncation, depth, unsupported types; weak RSA keys
assert.deepEqual(W.decodeCbor(encodeCbor(new Map([[1,2],[-3,Buffer.from([1,2])],['a',[1,'x']]]))).value,new Map([[1,2],[-3,Buffer.from([1,2])],['a',[1,'x']]]));
assert.throws(()=>W.decodeCbor(Buffer.from([0x5a,0,0,0,9,1])),/Truncated/);
assert.throws(()=>W.decodeCbor(Buffer.alloc(40,0x81)),/deep/);
assert.throws(()=>W.decodeCbor(Buffer.from([0xc0,0])),/Unsupported/);
assert.throws(()=>W.coseKey(new Map([[1,2],[3,-36]])),/Unsupported/);
{const {generateKeyPairSync}=await import('node:crypto');const j=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({format:'jwk'});
 assert.throws(()=>W.coseKey(new Map([[1,3],[3,-257],[-1,Buffer.from(j.n,'base64url')],[-2,Buffer.from(j.e,'base64url')]])),/too short/)}
assert.equal(W.claimedChallenge({response:{clientDataJSON:'!!'}}),null);
console.log('PASS passkeys (verifier): ES256, Ed25519, RS256; challenge/origin/RP/type/presence/cross-origin checks; tampering; counters; CBOR limits.');

// ---- server flow ----
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-pk-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin'};
writeFileSync(join(dir,'setup.mjs'),`
const S=await import('./store.mjs'),A=await import('./accounts.mjs');S.enterAs(S.SYSTEM);
const h=S.createHousehold('Household A');S.addMember(h.id,{id:'ann',name:'Ann'});
const out={};for(const [e,r] of [['owner@example.com','owner'],['viewer@example.com','viewer']]){const u=A.createUser(e);A.setMembership(h.id,u.id,r);out[e]={id:u.id,token:A.createSession(u.id)}}
console.log(JSON.stringify(out));`);
const r=spawnSync(process.execPath,['setup.mjs'],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
const U=JSON.parse(r.stdout.trim().split('\n').at(-1));
let log='';const {p,port}=await startServer({cwd:dir,env,onData:d=>log+=d}),O=`http://localhost:${port}`;
const req=({method='GET',path,cookie,body,origin=O})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(cookie?{Cookie:'apni_session='+cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json',...(origin?{Origin:origin}:{})}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,headers:res.headers,body:b,json:j})})});q.on('error',no);q.end(body?JSON.stringify(body):undefined)});
try{
 const own=U['owner@example.com'].token,view=U['viewer@example.com'].token,rp={origin:O,rpId:'localhost'};
 assert.equal((await req({path:'/api/passkeys'})).status,401);
 assert.deepEqual((await req({path:'/api/passkeys',cookie:own})).json,{passkeys:[]});
 // register
 const o=(await req({method:'POST',path:'/api/passkeys/options',cookie:own,body:{}})).json;
 assert.equal(o.rp.id,'localhost');assert.equal(o.attestation,'none');assert.equal(o.authenticatorSelection.residentKey,'required');
 assert.equal(Buffer.from(o.user.id,'base64url').toString(),U['owner@example.com'].id);assert.deepEqual(o.pubKeyCredParams.map(x=>x.alg),[-7,-8,-257]);
 const auth=softAuthenticator();
 const cred=auth.create({challenge:o.challenge,...rp,user:o.user.id});
 assert.equal((await req({method:'POST',path:'/api/passkeys',cookie:view,body:{credential:cred}})).status,400,'another user cannot use my registration challenge');
 const o2=(await req({method:'POST',path:'/api/passkeys/options',cookie:own,body:{}})).json;
 const added=await req({method:'POST',path:'/api/passkeys',cookie:own,body:{name:'Test phone',credential:auth.create({challenge:o2.challenge,...rp,user:o2.user.id})}});
 assert.equal(added.status,200,added.body);assert.equal(added.json.passkey.name,'Test phone');
 const o3=(await req({method:'POST',path:'/api/passkeys/options',cookie:own,body:{}})).json;assert.deepEqual(o3.excludeCredentials.map(c=>c.id),[auth.id]);
 assert.match((await req({method:'POST',path:'/api/passkeys',cookie:own,body:{credential:auth.create({challenge:o3.challenge,...rp,user:o3.user.id})}})).json.error,/already registered/);
 assert.equal((await req({path:'/api/passkeys',cookie:view})).json.passkeys.length,0,'passkeys are per user');
 // sign in
 const lo=(await req({method:'POST',path:'/auth/passkey/options'})).json;assert.equal(lo.rpId,'localhost');
 const assertion=auth.get({challenge:lo.challenge,...rp});
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:assertion},origin:null})).status,403,'CSRF: no Origin, no sign-in');
 const ok=await req({method:'POST',path:'/auth/passkey',body:{credential:assertion}});assert.equal(ok.status,200,ok.body);
 const sc=ok.headers['set-cookie'][0];assert.match(sc,/^apni_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax/);
 const me=await req({path:'/api/me',cookie:sc.split(';')[0].split('=')[1]});assert.equal(me.json.email,'owner@example.com');
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:assertion}})).status,400,'a challenge works once (no replay)');
 const ro=(await req({method:'POST',path:'/api/passkeys/options',cookie:own,body:{}})).json;
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:auth.get({challenge:ro.challenge,...rp})}})).status,400,'a registration challenge cannot sign in');
 const lo2=(await req({method:'POST',path:'/auth/passkey/options'})).json,forged=auth.get({challenge:lo2.challenge,...rp});forged.response.userHandle=Buffer.from(U['viewer@example.com'].id).toString('base64url');
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:forged}})).status,400,'user handle must match the passkey owner');
 const lo3=(await req({method:'POST',path:'/auth/passkey/options'})).json;
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:softAuthenticator().get({challenge:lo3.challenge,...rp})}})).status,400,'unknown passkey');
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:{garbage:true}}})).status,400);
 const list=(await req({path:'/api/passkeys',cookie:own})).json.passkeys;assert(list[0].lastUsedAt,'last use recorded');assert(!('publicKey' in list[0]),'keys are not sent to the browser');
 // rename/remove: own only
 assert.equal((await req({method:'POST',path:'/api/passkeys/delete',cookie:view,body:{id:auth.id}})).status,404,'cannot remove someone else\'s passkey');
 assert.equal((await req({method:'POST',path:'/api/passkeys/rename',cookie:own,body:{id:auth.id,name:'Renamed'}})).status,200);
 assert.equal((await req({method:'POST',path:'/api/passkeys/delete',cookie:own,body:{id:auth.id}})).status,200);
 const lo4=(await req({method:'POST',path:'/auth/passkey/options'})).json;
 assert.equal((await req({method:'POST',path:'/auth/passkey',body:{credential:auth.get({challenge:lo4.challenge,...rp})}})).status,400,'a removed passkey no longer signs in');
 // login page offers the passkey button, served without inline script
 const lp=await req({path:'/login'});assert(lp.body.includes('id="passkey-login"')&&lp.body.includes('src="/login.js"')&&!/<script>/.test(lp.body));
 assert.equal((await req({path:'/login.js'})).status,200);
 console.log('PASS passkeys (server): register, per-user lists, sign in with session cookie, single-use challenges, purpose and owner checks, rename/remove, CSRF.');
}finally{p.kill();rmSync(dir,{recursive:true,force:true})}
