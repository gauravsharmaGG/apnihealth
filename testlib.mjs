// Shared helpers for the tests (fictional data only). Not loaded by the app.
import net from 'node:net';
// A tiny SMTP server for tests: records each message; advertises AUTH, never STARTTLS.
export function fakeSmtp(host='127.0.0.1'){
 const messages=[],log=[];
 const server=net.createServer(sock=>{
  sock.setEncoding('utf8');let buf='',data=null,msg={};
  const say=l=>sock.write(l+'\r\n');say('220 fake ESMTP');
  sock.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
   if(data!==null){if(line==='.'){msg.data=data.join('\n');messages.push(msg);msg={};data=null;say('250 queued')}else data.push(line);continue}
   log.push(line.startsWith('AUTH')?'AUTH ***':line);
   if(/^EHLO/i.test(line)){say('250-fake');say('250 AUTH PLAIN')}
   else if(/^AUTH PLAIN /i.test(line)){msg.auth=Buffer.from(line.slice(11),'base64').toString();say('235 ok')}
   else if(/^MAIL FROM:/i.test(line)){msg.from=line.slice(10);say('250 ok')}
   else if(/^RCPT TO:/i.test(line)){msg.to=line.slice(8);say('250 ok')}
   else if(/^DATA/i.test(line)){data=[];say('354 go')}
   else if(/^QUIT/i.test(line)){say('221 bye');sock.end()}
   else say('502 no')}});
  sock.on('error',()=>{});
 });
 return new Promise(ok=>server.listen(0,host,()=>ok({port:server.address().port,host,messages,log,close:()=>server.close()})));
}
// Waits until fn() returns a truthy value (polling), or throws after ms.
export async function until(fn,ms=5000,what='condition'){const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timed out waiting for '+what);await new Promise(r=>setTimeout(r,50))}}

// ---- a software passkey authenticator (WebAuthn), for tests ----
import {createHash,generateKeyPairSync,sign as cryptoSign,randomBytes} from 'node:crypto';
export function encodeCbor(v){
 const head=(major,n)=>n<24?Buffer.from([major<<5|n]):n<256?Buffer.from([major<<5|24,n]):n<65536?Buffer.from([major<<5|25,n>>8,n&255]):(()=>{const b=Buffer.alloc(5);b[0]=major<<5|26;b.writeUInt32BE(n,1);return b})();
 if(typeof v==='number')return v>=0?head(0,v):head(1,-1-v);
 if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
 if(typeof v==='string'){const b=Buffer.from(v);return Buffer.concat([head(3,b.length),b])}
 if(Array.isArray(v))return Buffer.concat([head(4,v.length),...v.map(encodeCbor)]);
 if(v instanceof Map)return Buffer.concat([head(5,v.size),...[...v].flatMap(([k,x])=>[encodeCbor(k),encodeCbor(x)])]);
 throw Error('cannot encode');
}
const sha=b=>createHash('sha256').update(b).digest(),b64u=b=>Buffer.from(b).toString('base64url');
export function softAuthenticator({alg=-7,counter=true}={}){
 const kp=alg===-7?generateKeyPairSync('ec',{namedCurve:'P-256'}):alg===-8?generateKeyPairSync('ed25519'):generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk=kp.publicKey.export({format:'jwk'}),u=s=>Buffer.from(s,'base64url');
 const cose=alg===-7?new Map([[1,2],[3,-7],[-1,1],[-2,u(jwk.x)],[-3,u(jwk.y)]]):alg===-8?new Map([[1,1],[3,-8],[-1,6],[-2,u(jwk.x)]]):new Map([[1,3],[3,-257],[-1,u(jwk.n)],[-2,u(jwk.e)]]);
 const credId=randomBytes(32);let count=0,userHandle=null;
 const authData=(rpId,flags,extra=Buffer.alloc(0))=>{const c=Buffer.alloc(4);c.writeUInt32BE(counter?count:0);return Buffer.concat([sha(rpId),Buffer.from([flags]),c,extra])};
 const cd=(type,challenge,origin,more={})=>Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false,...more}));
 return {
  id:b64u(credId),
  create({challenge,origin,rpId,user,flags=0x45,clientData={}}){
   userHandle=user;count=counter?1:0;
   const len=Buffer.alloc(2);len.writeUInt16BE(credId.length);
   const ad=authData(rpId,flags,Buffer.concat([Buffer.alloc(16),len,credId,encodeCbor(cose)]));
   return {id:b64u(credId),type:'public-key',response:{clientDataJSON:b64u(cd('webauthn.create',challenge,origin,clientData)),attestationObject:b64u(encodeCbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',ad]]))),transports:['internal']}};
  },
  get({challenge,origin,rpId,flags=0x05,clientData={},type='webauthn.get',setCount}){
   if(counter)count=setCount??count+1;
   const ad=authData(rpId,flags),c=cd(type,challenge,origin,clientData),data=Buffer.concat([ad,sha(c)]);
   const sig=alg===-8?cryptoSign(null,data,kp.privateKey):cryptoSign('sha256',data,kp.privateKey);
   return {id:b64u(credId),type:'public-key',response:{clientDataJSON:b64u(c),authenticatorData:b64u(ad),signature:b64u(sig),userHandle}};
  }
 };
}

// Starts server.mjs on a random free-looking port, retrying if the port turns out to be taken.
// onData gets every stdout/stderr chunk from the start. Returns {p, port}.
import {spawn} from 'node:child_process';
export async function startServer({cwd,env,onData=()=>{},args=['server.mjs']}){
 for(let attempt=0;;attempt++){
  const port=20000+Math.floor(Math.random()*20000);
  const p=spawn(process.execPath,args,{cwd,env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let out='',exited=false;const on=d=>{out+=d;onData(String(d))};p.stdout.on('data',on);p.stderr.on('data',on);p.on('exit',()=>exited=true);
  try{await until(()=>/listening/.test(out)||exited,10000,'server start')}catch{p.kill();throw Error('server did not start:\n'+out)}
  if(!exited)return {p,port};
  if(attempt>=4||!/EADDRINUSE/.test(out))throw Error('server exited:\n'+out);
 }
}

// Starts headless Chrome for the browser tests and resolves once DevTools is listening AND a page target exists.
// --remote-debugging-port=0 lets Chrome pick a free port (no clashes between runs or with other services); Chrome
// prints the address on stderr ("DevTools listening on ws://127.0.0.1:PORT/..."). If Chrome exits or is not ready
// within `ms`, this fails with a clear message and Chrome's own output instead of handing back an undefined target.
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
export async function launchChrome({chrome=process.env.CHROME_BIN||'google-chrome',args=[],ms=60000}={}){
 const t0=Date.now(),deadline=t0+ms;
 const proc=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+mkdtempSync(join(tmpdir(),'apni-chrome-')),...args,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let err='',exit=null;proc.stderr.on('data',d=>{err=(err+d).slice(-20000)});proc.on('exit',(c,s)=>{exit=c??s});proc.on('error',e=>{exit=e.message});
 const fail=why=>{try{proc.kill()}catch{};return Error(`Chrome ${why} (after ${Date.now()-t0} ms)\n--- chrome stderr (last lines) ---\n${err.slice(-3000)}`)};
 const sleep=t=>new Promise(r=>setTimeout(r,t));
 let port,last='';
 for(;;){
  if(exit!==null)throw fail(`exited (${exit}) before DevTools was ready`);
  port??=/DevTools listening on ws:\/\/[^\s/]+:(\d+)\//.exec(err)?.[1];
  if(port){
   try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();last=JSON.stringify(list.map(x=>x.type));
    const target=list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
    if(target){const readyMs=Date.now()-t0;if(readyMs>5000)console.log(`note: Chrome took ${readyMs} ms to become ready`);return {proc,port:+port,target,readyMs}}
   }catch(e){last=e.message}
  }
  if(Date.now()>deadline)throw fail(port?`had no page target (last /json/list: ${last})`:'did not report a DevTools port');
  await sleep(50);
 }
}
