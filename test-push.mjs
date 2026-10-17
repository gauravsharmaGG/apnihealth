import assert from 'node:assert/strict';
process.env.APP_TIME_ZONE='Europe/Berlin'; // fixtures below use Berlin offsets
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {createECDH,createDecipheriv,createPublicKey,verify,hkdfSync,randomBytes} from 'node:crypto';
const root=mkdtempSync(tmpdir()+'/apni-push-');
try{
for(const f of ['medicines.mjs','events.mjs','push.mjs','appointments.mjs','members.mjs','env.mjs','db.mjs','migrations.mjs','store.mjs','accounts.mjs','consent.mjs','settings.mjs'])cpSync(new URL(f,import.meta.url),root+'/'+f);
process.env.DB_FILE=root+'/private/test.db'; // fictional household from config/members.example.json, one episode for alex
{const S=await import(pathToFileURL(root+'/store.mjs'));S.enterAs(S.SYSTEM);const h=S.createHousehold('Example household');for(const m of JSON.parse(readFileSync(new URL('config/members.example.json',import.meta.url),'utf8')))S.addMember(h.id,m);S.docs('episodes').replace('alex',[{id:'ep'}])}
const P=await import(pathToFileURL(root+'/push.mjs')),M=await import(pathToFileURL(root+'/medicines.mjs'));
const b=s=>Buffer.from(s,'base64url');
// 1) encryption round trip, decrypted the way a browser (user agent) does it
const ua=createECDH('prime256v1');ua.generateKeys();const auth=randomBytes(16);
const sub={endpoint:'https://push.example/x',keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
const msg=JSON.stringify({title:'Time for your medicine',body:'Medicine A · 16:00 — ünïcode ✓'});
const body=P.encrypt(sub,msg),salt=body.subarray(0,16),rs=body.readUInt32BE(16),idlen=body[20],asPub=body.subarray(21,21+idlen),ct=body.subarray(21+idlen);
assert.equal(rs,4096);assert.equal(idlen,65);
const secret=ua.computeSecret(asPub),prk=Buffer.from(hkdfSync('sha256',secret,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),asPub]),32));
const cek=Buffer.from(hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: nonce\0'),12));
const d=createDecipheriv('aes-128-gcm',cek,nonce);d.setAuthTag(ct.subarray(-16));const pt=Buffer.concat([d.update(ct.subarray(0,-16)),d.final()]);
assert.equal(pt.at(-1),2);assert.equal(pt.subarray(0,-1).toString(),msg);
// 2) VAPID JWT verifies against the published public key
const pub=b(P.publicKey());assert.equal(pub.length,65);assert.equal(pub[0],4);
const t=P.jwt('https://web.push.apple.com'),[h,c,sg]=t.split('.');
assert.equal(JSON.parse(b(h)).alg,'ES256');const claim=JSON.parse(b(c));assert.equal(claim.aud,'https://web.push.apple.com');assert(claim.exp>Date.now()/1000&&claim.exp<Date.now()/1000+13*3600);assert(!JSON.stringify(claim).includes('@'));
const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')},format:'jwk'});
assert(verify('sha256',Buffer.from(h+'.'+c),{key,dsaEncoding:'ieee-p1363'},b(sg)));
// 3) reminder logic
const plan=M.validate({name:'Medicine A',days:10,frequency:3,mode:'interval',interval:8,startDate:'2026-10-05',anchor:'2026-10-05T08:00:00+02:00',confirmed:true});
const ibu=M.validate({name:'Medicine B',days:10,frequency:2,mode:'times',startDate:'2026-10-05',times:['08:00','20:00'],confirmed:true});
M.mutate('alex',{action:'plan',episodeId:'ep',plan});M.mutate('alex',{action:'plan',episodeId:'ep',plan:ibu});
const L=M.list('alex'),am=L[0],ib=L[1];
const at=(h,m=0)=>Date.parse('2026-10-05T'+String(h-2).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00Z'); // Berlin = UTC+2 on this date
const s1={endpoint:'https://push.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaa',keys:sub.keys,profiles:{alex:{since:at(7)}},muted:[]};
const plansOf=()=>L;let state={};
assert.equal(P.due(at(7,59),[s1],plansOf,state).length,0,'nothing before due time');
let r=P.due(at(8,1),[s1],plansOf,state);assert.equal(r.length,1);assert.equal(r[0].items.length,2,'Medicine A and Medicine B at 08:00 are one notification');
assert.deepEqual(P.message(r[0]).body,'Alex: Medicine A, Medicine B · 08:00','several members: the body names the member');assert.equal(P.message(r[0]).title,'Time for your medicine');
for(const i of r[0].items)state[i.key]=1;
assert.equal(P.due(at(8,10),[s1],plansOf,state).length,0,'not sent twice');
r=P.due(at(8,31),[s1],plansOf,state);assert.equal(r.length,1);assert(r[0].items.every(i=>i.kind==='late'));assert.equal(P.message(r[0]).title,'Medicine not recorded yet');
// recorded dose => no reminder
M.mutate('alex',{action:'taken',id:am.id,key:'0',at:new Date(at(8,5)).toISOString()});const L2=M.list('alex');
r=P.due(at(8,31),[s1],()=>L2,state);assert.equal(r[0].items.length,1);assert.equal(r[0].items[0].p.name,'Medicine B');
// muted medicine, other profile, and slots before enabling stay silent
assert.equal(P.due(at(8,31),[{...s1,muted:[ib.id,am.id]}],()=>L2,state).length,0);
assert.equal(P.due(at(8,31),[{...s1,profiles:{mia:{since:0}}}],()=>[],{}).length,0);
assert.equal(P.due(at(12,0),[{...s1,profiles:{alex:{since:at(12)}}}],plansOf,{}).length,0,'08:00 slot predates enabling');
assert.equal(P.due(at(11,30),[s1],plansOf,{}).length,0,'outside 3h window');
// midnight slot (Medicine A every 8h) fires at 00:00 Berlin the next day
assert.equal(P.due(Date.parse('2026-10-05T22:01:00Z'),[{...s1,profiles:{alex:{since:at(7)}}}],plansOf,{}).filter(x=>x.items.some(i=>i.p.name==='Medicine A')).length,1);
// shifted reminder: with shift on, a late first dose moves the next reminder to taken+8h
{const sp=M.validate({name:'Med A',days:10,frequency:3,mode:'interval',interval:8,startDate:'2026-10-05',anchor:'2026-10-05T08:00:00+02:00',confirmed:true,shift:true});
 const mk=(logs)=>({...sp,id:'sh',logs});const sub2={...s1,profiles:{alex:{since:at(7)}}},st2={};
 // 08:00 dose taken at 10:30 -> next due 18:30, not 16:00
 const logs={0:{status:'taken',at:new Date(at(10,30)).toISOString()}};
 assert.equal(P.due(at(16,5),[sub2],()=>[mk(logs)],st2).length,0,'shifted reminder: nothing at the planned 16:00');
 assert.equal(P.due(at(18,35),[sub2],()=>[mk(logs)],st2).length,1,'shifted reminder: due at 18:30');
 assert.equal(P.due(at(16,5),[sub2],()=>[{...mk(logs),shift:false}],{}).length,1,'shift off: reminder stays at 16:00');}
// 4) tick(): sends, records state, drops gone subscriptions, retries failures
P.subscribe(sub,'alex',at(7));assert.equal(P.subs().length,1);assert(P.status(sub.endpoint,'alex').subscribed);assert.throws(()=>P.subscribe({endpoint:'http://x',keys:sub.keys},'alex'));assert.throws(()=>P.subscribe(sub,'evil'));
const sent=[];assert.equal(await P.tick(at(16,1),async(s,m)=>{sent.push(m);return {status:201}}),1);assert.equal(sent.length,1);
assert.equal(await P.tick(at(16,2),async()=>{throw Error('must not resend')}),0);
assert.equal(await P.tick(at(20,1),async()=>({status:500})),1);assert.equal(await P.tick(at(20,2),async()=>({status:201})),1,'failed send is retried');
assert.equal(await P.tick(at(20,40),async()=>({status:410,gone:true})),1);assert.equal(P.subs().length,0,'expired subscription removed');
console.log('PASS push: aes128gcm round trip, VAPID JWT, grouping, dedupe, late nudge, taken/mute/profile/window rules, retries, expired subs.');
// 5) deliver() over fetch against a local fake push service (plain http on loopback, allowed only through endpointOk)
{
 const http=await import('node:http');const got=[];let reply=201,hang=false;
 const svc=http.createServer((rq,rs)=>{const parts=[];rq.on('data',c=>parts.push(c));rq.on('end',()=>{got.push({method:rq.method,url:rq.url,headers:rq.headers,body:Buffer.concat(parts)});if(hang)return;if(reply===302){rs.writeHead(302,{Location:'http://127.0.0.1:1/elsewhere'});return rs.end()}rs.writeHead(reply);rs.end('ok')})});
 await new Promise(ok=>svc.listen(0,'127.0.0.1',ok));
 const ep=`http://127.0.0.1:${svc.address().port}/push/abc?x=1`,okLoop=u=>u.protocol==='https:'||u.hostname==='127.0.0.1',dsub={endpoint:ep,keys:sub.keys};
 try{
  assert.deepEqual(await P.deliver(dsub,{title:'T',body:'B'},{endpointOk:okLoop,ttl:600,urgency:'normal'}),{status:201,gone:false});
  const q=got[0];assert.equal(q.method,'POST');assert.equal(q.url,'/push/abc?x=1');
  assert.equal(q.headers['content-encoding'],'aes128gcm');assert.equal(q.headers['content-type'],'application/octet-stream');assert.equal(q.headers.ttl,'600');assert.equal(q.headers.urgency,'normal');
  assert.equal(Number(q.headers['content-length']),q.body.length);
  const m=/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(q.headers.authorization);assert(m,'VAPID authorization header');assert.equal(m[2],P.publicKey());
  const [jh,jc,js]=m[1].split('.');assert.equal(JSON.parse(b(jc)).aud,new URL(ep).origin,'audience is the push service origin');assert(verify('sha256',Buffer.from(jh+'.'+jc),{key,dsaEncoding:'ieee-p1363'},b(js)));
  // the body decrypts like a browser would
  const sl=q.body.subarray(0,16),ap=q.body.subarray(21,86),cx=q.body.subarray(86),sc=ua.computeSecret(ap),pk=Buffer.from(hkdfSync('sha256',sc,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),ap]),32));
  const dc=createDecipheriv('aes-128-gcm',Buffer.from(hkdfSync('sha256',pk,sl,Buffer.from('Content-Encoding: aes128gcm\0'),16)),Buffer.from(hkdfSync('sha256',pk,sl,Buffer.from('Content-Encoding: nonce\0'),12)));dc.setAuthTag(cx.subarray(-16));
  assert.deepEqual(JSON.parse(Buffer.concat([dc.update(cx.subarray(0,-16)),dc.final()]).subarray(0,-1)),{title:'T',body:'B'});
  reply=410;assert.deepEqual(await P.deliver(dsub,{t:1},{endpointOk:okLoop}),{status:410,gone:true});
  reply=404;assert.deepEqual(await P.deliver(dsub,{t:1},{endpointOk:okLoop}),{status:404,gone:true});
  reply=500;assert.deepEqual(await P.deliver(dsub,{t:1},{endpointOk:okLoop}),{status:500,gone:false});
  reply=302;const n=got.length;const rr=await P.deliver(dsub,{t:1},{endpointOk:okLoop});assert.equal(rr.gone,false);assert.equal(got.length,n+1,'redirects are not followed');
  assert.deepEqual(await P.deliver(dsub,{t:1}),{status:0,gone:true},'plain http is refused by default');
  assert.deepEqual(await P.deliver({endpoint:'not a url',keys:sub.keys},{t:1}),{status:0,gone:true});
  assert.equal((await P.deliver({endpoint:'http://127.0.0.1:1/x',keys:sub.keys},{t:1},{endpointOk:okLoop})).status,0,'network error resolves with status 0');
  assert.equal((await P.deliver({endpoint:ep,keys:{p256dh:'AA',auth:'AA'}},{t:1},{endpointOk:okLoop})).status,0,'bad keys resolve with status 0');
  hang=true;assert.deepEqual(await P.deliver(dsub,{t:1},{endpointOk:okLoop,timeout:200}),{status:0,error:'timeout'});
 }finally{svc.closeAllConnections();svc.close()}
}
// 6) VAPID key from VAPID_PRIVATE_JWK (Workers secret): used instead of private/vapid.json, validated once
{
 const {generateKeyPairSync}=await import('node:crypto'),{existsSync,unlinkSync}=await import('node:fs');
 const j=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'}),fileKey=P.publicKey();
 unlinkSync(root+'/private/vapid.json');
 process.env.VAPID_PRIVATE_JWK=JSON.stringify(j);
 assert.equal(P.publicKey(),Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url'));assert.notEqual(P.publicKey(),fileKey);
 const [eh,ec,es]=P.jwt('https://push.example').split('.');
 assert(verify('sha256',Buffer.from(eh+'.'+ec),{key:createPublicKey({key:{kty:'EC',crv:'P-256',x:j.x,y:j.y},format:'jwk'}),dsaEncoding:'ieee-p1363'},b(es)),'JWT signed with the env key');
 assert(!existsSync(root+'/private/vapid.json'),'no key file written when the env key is set');
 process.env.VAPID_PRIVATE_JWK='{not json';assert.throws(()=>P.publicKey(),/not valid JSON/);
 process.env.VAPID_PRIVATE_JWK=JSON.stringify({...j,crv:'P-384'});assert.throws(()=>P.publicKey(),/P-256/);
 const other=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
 process.env.VAPID_PRIVATE_JWK=JSON.stringify({...j,d:other.d});assert.throws(()=>P.publicKey(),/does not match/);
 for(const e of ['{not json',JSON.stringify({...j,d:other.d})]){process.env.VAPID_PRIVATE_JWK=e;try{P.publicKey()}catch(x){assert(!x.message.includes(j.d)&&!x.message.includes(other.d),'errors never echo the key')}}
 delete process.env.VAPID_PRIVATE_JWK;
}
console.log('PASS push delivery: fetch POST with aes128gcm body + VAPID header (decrypts, verifies), 201/404/410/500, no redirects, http refused, network errors and timeout resolve; VAPID_PRIVATE_JWK used instead of the key file, validated, never echoed.');
}finally{rmSync(root,{recursive:true,force:true})}
