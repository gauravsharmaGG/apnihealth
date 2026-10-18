// Apple Health / Shortcuts ingest keys: one or more per profile, shown once when created, stored as SHA-256 hashes.
// A key only lets a device add measurements to its own profile. The single shared key of older versions
// (private/ingest-token.txt) is migrated as a household-wide "shared" key that keeps working until revoked.
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {db} from './db.mjs';
import {forMember,households,AccessError,canWrite} from './store.mjs';
const hash=t=>createHash('sha256').update(String(t)).digest('hex');
// Resolved on use, not at load: on Workers import.meta.url is undefined (and there is no legacy file).
export const legacyFile=()=>fileURLToPath(new URL('./private/ingest-token.txt',import.meta.url));
export const MAX_KEYS=10;

// Once, at startup: register the old shared key (if any) for the oldest household. Never re-adds a revoked one.
export function migrateLegacy(file=legacyFile()){
 if(!existsSync(file))return false;
 const t=readFileSync(file,'utf8').trim(),h=households()[0];
 if(!t||!h)return false;
 const d=db();if(d.prepare('SELECT 1 FROM ingest_tokens WHERE token_hash=?').get(hash(t)))return false;
 d.prepare('INSERT INTO ingest_tokens(token_hash,household_id,member_id,label,created_at) VALUES(?,?,NULL,?,?)').run(hash(t),h.id,'Shared key (from before per-profile keys)',new Date().toISOString());
 return true;
}
const writable=memberId=>{const m=forMember(memberId);if(!canWrite(m.role))throw new AccessError('Read-only access',403);return m};
export function createKey(memberId,label,userId=null){
 const m=writable(memberId),d=db();
 if(d.prepare('SELECT COUNT(*) n FROM ingest_tokens WHERE member_id=? AND revoked_at IS NULL').get(memberId).n>=MAX_KEYS)throw Error('Too many keys for this profile; revoke one first');
 const t=randomBytes(32).toString('base64url'),name=typeof label==='string'&&label.trim()?label.trim().slice(0,60):'Apple Health';
 d.prepare('INSERT INTO ingest_tokens(token_hash,household_id,member_id,label,created_by,created_at) VALUES(?,?,?,?,?,?)').run(hash(t),m.household,memberId,name,userId,new Date().toISOString());
 return t;
}
// Keys that can write to this profile: its own, plus the household's shared legacy key while it exists.
export function keysFor(memberId){
 const m=forMember(memberId);
 return db().prepare('SELECT token_hash,member_id,label,created_at,last_used_at FROM ingest_tokens WHERE revoked_at IS NULL AND (member_id=? OR (member_id IS NULL AND household_id=?)) ORDER BY created_at')
  .all(memberId,m.household).map(r=>({id:r.token_hash,label:r.label,createdAt:r.created_at,lastUsedAt:r.last_used_at||null,shared:r.member_id===null}));
}
export function revokeKey(memberId,id){
 const m=writable(memberId);
 return db().prepare('UPDATE ingest_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL AND (member_id=? OR (member_id IS NULL AND household_id=?))').run(new Date().toISOString(),String(id),memberId,m.household).changes>0;
}
// The access context for a bearer key, or null: a profile key may only write to its profile.
export function actorFor(token){
 if(typeof token!=='string'||!token||token.length>256)return null;
 const d=db(),r=d.prepare('SELECT token_hash,household_id,member_id FROM ingest_tokens WHERE token_hash=? AND revoked_at IS NULL').get(hash(token));
 if(!r)return null;
 d.prepare('UPDATE ingest_tokens SET last_used_at=? WHERE token_hash=?').run(new Date().toISOString(),r.token_hash);
 return {type:'ingest',household:r.household_id,...(r.member_id?{memberId:r.member_id}:{})};
}
