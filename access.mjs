import {createPublicKey,verify} from 'node:crypto';
import {get} from 'node:https';
import {readFileSync,existsSync} from 'node:fs';
// AUTH_MODE=trusted-proxy: Cloudflare Access (or a proxy issuing the same signed JWT) in front of the app.
// The server re-verifies the JWT on every request and maps its email to a user (see auth.mjs); requests without
// a valid token for one of the allowed identities are rejected (fail closed).
export const issuer=process.env.CF_ACCESS_ISSUER||'';            // e.g. https://<team>.cloudflareaccess.com
export const audience=process.env.CF_ACCESS_AUD||'';             // Access application AUD tag
export const allowedEmails=new Set(String(process.env.CF_ACCESS_EMAIL||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)); // comma-separated identities allowed in
// System CA bundle; Node's built-in roots are used when none is configured or found.
const caFile=process.env.CA_BUNDLE||['/etc/ssl/cert.pem','/etc/ssl/certs/ca-certificates.crt'].find(f=>existsSync(f));
let cache=[],loaded=0,pending;
export function loadKeys(){
 if(pending)return pending;
 pending=new Promise((resolve,reject)=>{
  const req=get(issuer+'/cdn-cgi/access/certs',{...(caFile?{ca:readFileSync(caFile)}:{}),timeout:10000},res=>{
   let body='';res.on('data',c=>{body+=c;if(body.length>100000)req.destroy(Error('oversize'))});
   res.on('end',()=>{try{if(res.statusCode!==200)throw Error('keys unavailable');const data=JSON.parse(body);if(!Array.isArray(data.keys)||!data.keys.length)throw Error('missing keys');cache=data.keys;loaded=Date.now();resolve(cache)}catch(e){reject(e)}});
  });req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',reject);
 }).finally(()=>{pending=undefined});return pending;
}
// The verified claim set, or null.
export function verifiedClaim(token,keys,now=Date.now()/1000){
 try{
  if(typeof token!=='string'||token.length>16000)return null;
  const parts=token.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))return null;
  const [h,p,s]=parts,header=JSON.parse(Buffer.from(h,'base64url')),claim=JSON.parse(Buffer.from(p,'base64url'));
  if(header.alg!=='RS256'||header.crit||typeof header.kid!=='string')return null;
  if(claim.iss!==issuer||!Array.isArray(claim.aud)||!claim.aud.includes(audience)||!allowedEmails.size||typeof claim.email!=='string'||!allowedEmails.has(claim.email.toLowerCase())||claim.type!=='app')return null;
  if(!Number.isFinite(claim.exp)||claim.exp<=now||!Number.isFinite(claim.iat)||claim.iat>now+30||(claim.nbf!==undefined&&(!Number.isFinite(claim.nbf)||claim.nbf>now+30)))return null;
  const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!key)return null;
  return verify('RSA-SHA256',Buffer.from(h+'.'+p),createPublicKey({key,format:'jwk'}),Buffer.from(s,'base64url'))?claim:null;
 }catch{return null}
}
export const verifyToken=(token,keys,now)=>!!verifiedClaim(token,keys,now);
// The request's verified, allowed email (lowercase), or null.
export async function verifiedEmail(req){
 const token=req.headers['cf-access-jwt-assertion'];if(!token)return null;
 try{if(Date.now()-loaded>3600000)await loadKeys();return verifiedClaim(token,cache)?.email.toLowerCase()||null}catch{return null}
}
export const authorized=async req=>!!(await verifiedEmail(req));
