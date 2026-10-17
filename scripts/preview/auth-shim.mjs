// Preview-only stand-in for ./access.mjs, loaded only through scripts/preview/loader.mjs.
// A request is authorized only if its X-Preview-Auth header equals PREVIEW_AUTH_TOKEN (random per preview run,
// set by whoever starts the preview, e.g. a local reverse proxy). Fails closed otherwise.
import {timingSafeEqual} from 'node:crypto';
if(process.env.PREVIEW_MODE!=='1')throw Error('preview auth shim: PREVIEW_MODE=1 is required');
const t=Buffer.from(process.env.PREVIEW_AUTH_TOKEN||'');
if(t.length<16)throw Error('preview auth shim: PREVIEW_AUTH_TOKEN missing or too short');
export const issuer='',audience='',allowedEmails=new Set(['preview']);
export async function loadKeys(){return []}
export function verifyToken(){return false}
export function verifiedClaim(){return null}
export const PREVIEW_EMAIL='preview@example.com'; // the preview user seeded by seed.mjs (owner of the example household)
export async function authorized(req){const h=Buffer.from(String(req.headers['x-preview-auth']||''));return h.length===t.length&&timingSafeEqual(h,t)}
export async function verifiedEmail(req){return await authorized(req)?PREVIEW_EMAIL:null}
