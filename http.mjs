// Shared HTTP helpers: security headers, responses, body reading, rate limits and the same-origin (CSRF) check.
import {APP_HOST,PORT} from './env.mjs';
export const headers={'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
// The app page and the report-reading files (pdf.js, tesseract.js and their workers) may compile WebAssembly; nothing
// else may. 'wasm-unsafe-eval' allows wasm compilation only, not JS eval. A dedicated worker takes the CSP of its own
// script response, so the vendored worker scripts need it too. Vendored files are versioned by path: cache them.
export const appHeaders={...headers,'Content-Security-Policy':headers['Content-Security-Policy'].replace("script-src 'self'","script-src 'self' 'wasm-unsafe-eval'")};
export const vendorHeaders={...appHeaders,'Cache-Control':'private, max-age=31536000, immutable'};
export const frameHeaders={...headers,'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':headers['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'")};
export const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.png':'image/png','.wasm':'application/wasm','.gz':'application/octet-stream','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
export function readBody(req,limit=1048576){return new Promise((ok,no)=>{let b='',n=0;req.on('data',c=>{n+=c.length;if(n>limit){no(Error('too large'));req.destroy()}else b+=c});req.on('end',()=>ok(b));req.on('error',no)})}
export const json=(res,status,obj)=>send(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8'});
// In-memory sliding-window rate limit: true when key has been hit more than max times within windowMs.
const hits=new Map();export function limited(key,max,windowMs){const now=Date.now(),a=(hits.get(key)||[]).filter(t=>now-t<windowMs);a.push(now);hits.set(key,a);if(hits.size>5000)for(const [k,v] of hits)if(now-v.at(-1)>36e5)hits.delete(k);return a.length>max}
export const resetLimits=()=>hits.clear();
export const allowedHosts=new Set([...(APP_HOST?[APP_HOST]:[]),`127.0.0.1:${PORT}`,`localhost:${PORT}`]);
// Requests to APP_HOST arrive through the TLS proxy (plain http to it is redirected), so they are secure.
export const secureRequest=req=>!!APP_HOST&&req.headers.host===APP_HOST;
export const requestOrigin=req=>(secureRequest(req)?'https':'http')+'://'+req.headers.host;
export function send(res,status,body='',extra={}){res.writeHead(status,{...headers,'Content-Type':'text/html; charset=utf-8',...extra});res.end(body)}
export function sameOrigin(req){
 const expected=requestOrigin(req);
 const origin=req.headers.origin,site=req.headers['sec-fetch-site'];
 if(site==='cross-site'||site==='same-site')return false;
 if(origin===expected)return true;
 // Some browsers omit or null the Origin of form POSTs under privacy policies.
 // Browser-controlled Fetch Metadata still proves an exact same-origin request.
 // Never accept an explicit foreign origin or a request lacking both signals.
 return (!origin||origin==='null')&&site==='same-origin';
}
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Parses a JSON or urlencoded (HTML form) body.
export async function readForm(req,limit=16384){
 const raw=await readBody(req,limit);
 if(/application\/json/.test(req.headers['content-type']||''))return JSON.parse(raw||'{}');
 return Object.fromEntries(new URLSearchParams(raw));
}
