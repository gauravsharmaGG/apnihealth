import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
process.env.CF_ACCESS_ISSUER??='https://test.cloudflareaccess.com';process.env.CF_ACCESS_AUD??='test-aud';process.env.CF_ACCESS_EMAIL??='owner@example.com, Partner@example.com';
const {verifyToken,issuer,audience,allowedEmails,loadKeys}=await import('./access.mjs');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const keys=[{...publicKey.export({format:'jwk'}),kid:'test'}];
const now=Math.floor(Date.now()/1000);
assert.deepEqual([...allowedEmails],['owner@example.com','partner@example.com']);
const base={iss:issuer,aud:[audience],email:'owner@example.com',type:'app',iat:now,exp:now+300};
function token(claim=base,header={alg:'RS256',kid:'test'}){const input=[header,claim].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}
assert(verifyToken(token(),keys));
assert(verifyToken(token({...base,email:'PARTNER@example.com'}),keys),'every listed identity is allowed, case-insensitively');
for(const patch of [{email:'other@example.com'},{aud:['wrong']},{iss:'https://evil.example'},{exp:now-1},{exp:null},{iat:now+1000},{nbf:now+1000},{type:'meta'},{email:undefined},{email:'owner@example.com.evil.example'}])assert.equal(verifyToken(token({...base,...patch}),keys),false);
assert.equal(verifyToken(token(base,{alg:'none',kid:'test'}),keys),false);
assert.equal(verifyToken(token().slice(0,-8)+'AAAAAAAA',keys),false);
assert.equal(verifyToken('invalid',keys),false);
assert.equal(verifyToken(token(),[]),false);
console.log('PASS: signed tokens for listed identities accepted; invalid signatures, identity, audience, issuer, timing and algorithm rejected.');
if(process.argv.includes('--live-keys'))console.log('PASS: Access public keys retrieved:',(await loadKeys()).length);
