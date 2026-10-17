// Passkeys (WebAuthn Level 2) without dependencies: just enough CBOR, COSE keys and signature checks for
// registration ("none" attestation: the attestation statement is ignored, we never rely on device make/model)
// and sign-in assertions. Supported algorithms: ES256 (-7), EdDSA/Ed25519 (-8), RS256 (-257).
import {createHash,createPublicKey,verify as cryptoVerify,timingSafeEqual} from 'node:crypto';

export const ALGS=[-7,-8,-257];
const b64u=b=>Buffer.from(b).toString('base64url');
const fromB64u=(s,what)=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s)||s.length>16384)throw Error('Invalid '+what);return Buffer.from(s,'base64url')};
const sha256=b=>createHash('sha256').update(b).digest();
const same=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);

// ---- CBOR (RFC 8949), the subset authenticators use: ints, byte/text strings, arrays, maps, simple values ----
export function decodeCbor(buf,start=0){
 let o=start;
 const need=n=>{if(o+n>buf.length)throw Error('Truncated CBOR')};
 function len(info){
  if(info<24)return info;
  const n={24:1,25:2,26:4,27:8}[info];if(!n)throw Error('Unsupported CBOR length');
  need(n);let v=0;for(let i=0;i<n;i++)v=v*256+buf[o+i];o+=n;
  if(v>Number.MAX_SAFE_INTEGER)throw Error('CBOR value too large');return v;
 }
 function item(depth){
  if(depth>16)throw Error('CBOR nested too deep');
  need(1);const b=buf[o++],major=b>>5,info=b&31;
  switch(major){
   case 0:return len(info);
   case 1:return -1-len(info);
   case 2:{const n=len(info);need(n);const v=buf.subarray(o,o+n);o+=n;return Buffer.from(v)}
   case 3:{const n=len(info);need(n);const v=buf.toString('utf8',o,o+n);o+=n;return v}
   case 4:{const n=len(info);if(n>1024)throw Error('CBOR array too long');const a=[];for(let i=0;i<n;i++)a.push(item(depth+1));return a}
   case 5:{const n=len(info);if(n>1024)throw Error('CBOR map too long');const m=new Map();for(let i=0;i<n;i++){const k=item(depth+1);m.set(k,item(depth+1))}return m}
   case 7:if(info===20)return false;if(info===21)return true;if(info===22)return null;throw Error('Unsupported CBOR simple value');
   default:throw Error('Unsupported CBOR type');
  }
 }
 const value=item(0);return {value,end:o};
}

// ---- COSE public key -> node KeyObject ----
export function coseKey(m){
 if(!(m instanceof Map))throw Error('Invalid credential public key');
 const kty=m.get(1),alg=m.get(3);
 let jwk;
 if(kty===2&&alg===-7&&m.get(-1)===1)jwk={kty:'EC',crv:'P-256',x:b64u(m.get(-2)),y:b64u(m.get(-3))};
 else if(kty===1&&alg===-8&&m.get(-1)===6)jwk={kty:'OKP',crv:'Ed25519',x:b64u(m.get(-2))};
 else if(kty===3&&alg===-257)jwk={kty:'RSA',n:b64u(m.get(-1)),e:b64u(m.get(-2))};
 else throw Error('Unsupported passkey algorithm');
 const key=createPublicKey({key:jwk,format:'jwk'});
 if(kty===3&&key.asymmetricKeyDetails.modulusLength<2048)throw Error('RSA key too short');
 return {alg,key};
}

// ---- authenticator data ----
const FLAG_UP=1,FLAG_UV=4,FLAG_AT=64,FLAG_ED=128;
export function parseAuthData(a){
 if(!Buffer.isBuffer(a)||a.length<37)throw Error('Invalid authenticator data');
 const flags=a[32],out={rpIdHash:a.subarray(0,32),flags,up:!!(flags&FLAG_UP),uv:!!(flags&FLAG_UV),signCount:a.readUInt32BE(33)};
 let o=37;
 if(flags&FLAG_AT){
  if(a.length<o+18)throw Error('Invalid authenticator data');
  const n=a.readUInt16BE(o+16);o+=18;
  if(n<16||n>1023||a.length<o+n)throw Error('Invalid credential id');
  out.credentialId=b64u(a.subarray(o,o+n));o+=n;
  const {value,end}=decodeCbor(a,o);out.cose=value;o=end;
 }
 if(flags&FLAG_ED){o=decodeCbor(a,o).end}
 if(o!==a.length)throw Error('Unexpected bytes in authenticator data');
 return out;
}

function clientData(b64,type,{challenge,origin}){
 const raw=fromB64u(b64,'client data');let c;
 try{c=JSON.parse(raw.toString('utf8'))}catch{throw Error('Invalid client data')}
 if(c.type!==type)throw Error('Wrong ceremony type');
 if(typeof c.challenge!=='string'||!same(Buffer.from(c.challenge),Buffer.from(challenge)))throw Error('Challenge mismatch');
 if(c.origin!==origin)throw Error('Origin mismatch');
 if(c.crossOrigin===true)throw Error('Cross-origin ceremony');
 return raw;
}
// The challenge a response claims to answer (look it up server-side before verifying).
export function claimedChallenge(credential){
 try{const c=JSON.parse(fromB64u(credential?.response?.clientDataJSON,'client data').toString('utf8'));return typeof c.challenge==='string'&&/^[A-Za-z0-9_-]{43}$/.test(c.challenge)?c.challenge:null}catch{return null}
}
function checkRp(auth,rpId,requireUV){
 if(!same(auth.rpIdHash,sha256(rpId)))throw Error('Wrong relying party');
 if(!auth.up)throw Error('User presence required');
 if(requireUV&&!auth.uv)throw Error('User verification required');
}

// Registration. Returns what to store: {id, publicKey (SPKI, base64url), alg, signCount, transports}.
export function verifyRegistration(credential,{challenge,origin,rpId,requireUV=false}){
 if(credential?.type!=='public-key')throw Error('Not a passkey');
 clientData(credential.response?.clientDataJSON,'webauthn.create',{challenge,origin});
 const att=decodeCbor(fromB64u(credential.response?.attestationObject,'attestation')).value;
 if(!(att instanceof Map)||!Buffer.isBuffer(att.get('authData')))throw Error('Invalid attestation');
 const auth=parseAuthData(att.get('authData'));
 checkRp(auth,rpId,requireUV);
 if(!auth.credentialId)throw Error('No credential in response');
 if(credential.id!==auth.credentialId)throw Error('Credential id mismatch');
 const {alg,key}=coseKey(auth.cose);
 const transports=Array.isArray(credential.response.transports)?credential.response.transports.filter(t=>typeof t==='string'&&/^[a-z-]{2,16}$/.test(t)).slice(0,8):[];
 return {id:auth.credentialId,publicKey:b64u(key.export({type:'spki',format:'der'})),alg,signCount:auth.signCount,transports};
}

// Sign-in. `stored` is what verifyRegistration returned (as saved). Returns the new signature counter.
export function verifyAssertion(credential,stored,{challenge,origin,rpId,requireUV=false}){
 if(credential?.type!=='public-key'||credential.id!==stored.id)throw Error('Unknown passkey');
 const r=credential.response||{};
 const cdRaw=clientData(r.clientDataJSON,'webauthn.get',{challenge,origin});
 const authRaw=fromB64u(r.authenticatorData,'authenticator data'),auth=parseAuthData(authRaw);
 checkRp(auth,rpId,requireUV);
 const sig=fromB64u(r.signature,'signature'),data=Buffer.concat([authRaw,sha256(cdRaw)]);
 const key=createPublicKey({key:fromB64u(stored.publicKey,'key'),format:'der',type:'spki'});
 const ok=stored.alg===-8?cryptoVerify(null,data,key,sig):stored.alg===-7?cryptoVerify('sha256',data,{key,dsaEncoding:'der'},sig):stored.alg===-257?cryptoVerify('sha256',data,key,sig):false;
 if(!ok)throw Error('Invalid signature');
 // A counter that does not increase (when the authenticator keeps one) suggests a cloned credential.
 if((auth.signCount||stored.signCount)&&auth.signCount<=stored.signCount)throw Error('Passkey counter went backwards');
 return auth.signCount;
}
