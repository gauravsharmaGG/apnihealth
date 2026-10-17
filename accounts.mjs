// Users, household memberships, sessions and one-time sign-in links (instance-wide tables, never member data).
// Session and sign-in tokens are random 256-bit values; only their SHA-256 hashes are stored.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './db.mjs';
import {ROLES} from './store.mjs';
export const SESSION_DAYS=30,LINK_MINUTES=15;
const DAY=864e5;
const hash=t=>createHash('sha256').update(String(t)).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const TOKEN_RE=/^[A-Za-z0-9_-]{43}$/;

// ---- users ----
const EMAIL=/^[^\s@<>,;"'()\\]{1,64}@[^\s@<>,;"'()\\]{1,189}\.[^\s@<>,;"'()\\.]{2,}$/;
export function cleanEmail(e){
 const v=typeof e==='string'?e.trim().toLowerCase():'';
 if(v.length>254||!EMAIL.test(v))throw Error('Enter a valid email address');
 return v;
}
const rowToUser=r=>r&&{id:r.id,email:r.email,name:r.name||null,activeHousehold:r.active_household_id||null};
export const userById=id=>rowToUser(db().prepare('SELECT * FROM users WHERE id=?').get(String(id)));
export const userByEmail=email=>{try{return rowToUser(db().prepare('SELECT * FROM users WHERE email=?').get(cleanEmail(email)))}catch{return null}};
export function createUser(email,{name}={}){
 const u={id:randomUUID(),email:cleanEmail(email),name:typeof name==='string'&&name.trim()?name.trim().slice(0,60):null};
 db().prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run(u.id,u.email,u.name,new Date().toISOString());
 return userById(u.id);
}
export const userCount=()=>db().prepare('SELECT COUNT(*) n FROM users').get().n;

// ---- memberships ----
export function setMembership(householdId,userId,role){
 if(!ROLES.includes(role))throw Error('Unknown role');
 db().prepare('INSERT INTO memberships(household_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(household_id,user_id) DO UPDATE SET role=excluded.role')
  .run(householdId,userId,role,new Date().toISOString());
}
export const membership=(householdId,userId)=>db().prepare('SELECT role FROM memberships WHERE household_id=? AND user_id=?').get(householdId,userId)?.role||null;
export const householdsOf=userId=>db().prepare('SELECT h.id,h.name,m.role FROM memberships m JOIN households h ON h.id=m.household_id WHERE m.user_id=? ORDER BY m.created_at,h.created_at').all(userId).map(r=>({...r}));
// The household a user is working in: their saved choice if they still belong to it, else their first one.
export function activeHousehold(user){
 const hs=householdsOf(user.id);
 return hs.find(h=>h.id===user.activeHousehold)||hs[0]||null;
}
export function setActiveHousehold(userId,householdId){
 if(!membership(householdId,userId))throw Error('Unknown household');
 db().prepare('UPDATE users SET active_household_id=? WHERE id=?').run(householdId,userId);
}

// ---- sessions ----
export function createSession(userId,now=Date.now()){
 const t=token();
 db().prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)').run(hash(t),userId,now,now+SESSION_DAYS*DAY,now);
 db().prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date(now).toISOString(),userId);
 return t;
}
// The session's user, or null. Sessions slide: each use (at most hourly) extends them to SESSION_DAYS.
export function sessionUser(t,now=Date.now()){
 if(typeof t!=='string'||!TOKEN_RE.test(t))return null;
 const d=db(),s=d.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash(t));
 if(!s)return null;
 if(s.expires_at<=now){d.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);return null}
 if(now-s.last_seen_at>36e5)d.prepare('UPDATE sessions SET last_seen_at=?,expires_at=? WHERE token_hash=?').run(now,now+SESSION_DAYS*DAY,s.token_hash);
 return userById(s.user_id);
}
export const deleteSession=t=>typeof t==='string'&&db().prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(t)).changes>0;
export const deleteUserSessions=userId=>db().prepare('DELETE FROM sessions WHERE user_id=?').run(userId).changes;
export function purgeExpired(now=Date.now()){
 const d=db();
 d.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
 d.prepare('DELETE FROM login_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(now-DAY);
 d.prepare('DELETE FROM webauthn_challenges WHERE expires_at<=?').run(now);
}

// ---- one-time sign-in links ----
export function createLoginToken(email,now=Date.now()){
 const t=token();
 db().prepare('INSERT INTO login_tokens(token_hash,email,created_at,expires_at) VALUES(?,?,?,?)').run(hash(t),cleanEmail(email),now,now+LINK_MINUTES*6e4);
 return t;
}
// Uses up a sign-in token: returns its email once, or null (unknown, expired or already used).
export function consumeLoginToken(t,now=Date.now()){
 if(typeof t!=='string'||!TOKEN_RE.test(t))return null;
 const d=db();
 return transaction(d,()=>{
  const r=d.prepare('SELECT * FROM login_tokens WHERE token_hash=?').get(hash(t));
  if(!r||r.used_at||r.expires_at<=now)return null;
  d.prepare('UPDATE login_tokens SET used_at=? WHERE token_hash=?').run(now,r.token_hash);
  return r.email;
 });
}

// ---- passkeys ----
export const CHALLENGE_MINUTES=5,MAX_PASSKEYS=20;
const rowToPasskey=r=>r&&{id:r.id,userId:r.user_id,publicKey:r.public_key,alg:r.alg,signCount:r.sign_count,transports:JSON.parse(r.transports),name:r.name,createdAt:r.created_at,lastUsedAt:r.last_used_at||null};
export const passkeyById=id=>rowToPasskey(db().prepare('SELECT * FROM passkeys WHERE id=?').get(String(id)));
export const passkeysOf=userId=>db().prepare('SELECT * FROM passkeys WHERE user_id=? ORDER BY created_at').all(userId).map(rowToPasskey);
export function addPasskey(userId,p,name){
 const d=db();
 return transaction(d,()=>{
  if(d.prepare('SELECT COUNT(*) n FROM passkeys WHERE user_id=?').get(userId).n>=MAX_PASSKEYS)throw Error('Too many passkeys; remove one first');
  if(passkeyById(p.id))throw Error('This passkey is already registered');
  const label=typeof name==='string'&&name.trim()?name.trim().slice(0,60):'Passkey';
  d.prepare('INSERT INTO passkeys(id,user_id,public_key,alg,sign_count,transports,name,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(p.id,userId,p.publicKey,p.alg,p.signCount,JSON.stringify(p.transports||[]),label,new Date().toISOString());
  return passkeyById(p.id);
 });
}
export const touchPasskey=(id,signCount)=>db().prepare('UPDATE passkeys SET sign_count=?,last_used_at=? WHERE id=?').run(signCount,new Date().toISOString(),id);
export const renamePasskey=(userId,id,name)=>{
 const label=typeof name==='string'?name.trim().slice(0,60):'';if(!label)throw Error('Give the passkey a name');
 return db().prepare('UPDATE passkeys SET name=? WHERE id=? AND user_id=?').run(label,String(id),userId).changes>0;
};
export const deletePasskey=(userId,id)=>db().prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(String(id),userId).changes>0;
// Challenges: random, stored hashed, single use, expire after CHALLENGE_MINUTES.
export function createChallenge(purpose,userId=null,now=Date.now()){
 const c=token();
 db().prepare('INSERT INTO webauthn_challenges(challenge_hash,purpose,user_id,expires_at) VALUES(?,?,?,?)').run(hash(c),purpose,userId,now+CHALLENGE_MINUTES*6e4);
 return c;
}
// Uses up a challenge: true once if it exists, has this purpose (and user), and has not expired.
export function consumeChallenge(c,purpose,userId=null,now=Date.now()){
 if(typeof c!=='string'||!TOKEN_RE.test(c))return false;
 const d=db();
 return transaction(d,()=>{
  const r=d.prepare('SELECT * FROM webauthn_challenges WHERE challenge_hash=?').get(hash(c));
  if(!r)return false;
  d.prepare('DELETE FROM webauthn_challenges WHERE challenge_hash=?').run(r.challenge_hash);
  return r.purpose===purpose&&(r.user_id||null)===(userId||null)&&r.expires_at>now;
 });
}
