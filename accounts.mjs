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
