// The single access path to member data. Request handlers and data modules use forMember(id): it checks that
// the current actor may see the member and, for writes, may change it, and only runs SQL that is scoped with
// `member_id = $member` (inserts: a member_id column with $member), binding $member itself.
// The actor comes from the request context (AsyncLocalStorage), set by the server for every request:
//   {type:'user', userId, household}  a signed-in user: access follows their role in the member's household
//                                     (owner and editor read and write, viewer reads only)
//   {type:'ingest', household, memberId?}  an Apple Health sync token: one household (or one member)
//   SYSTEM                            migrations, import, scripts and the push scheduler
// Without an actor every access is refused (fail closed). Instance-wide tables (households, members, users,
// push subscriptions) go through the named helpers below and accounts.mjs.
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {db,transaction} from './db.mjs';

// Reads, updates and deletes must filter on member_id = $member; inserts must name member_id and use $member.
const scoped=sql=>/\bmember_id\s*=\s*\$member\b/.test(sql)||(/^\s*INSERT\s+INTO\s+\w+\s*\([^)]*\bmember_id\b/i.test(sql)&&/\$member\b/.test(sql));
export class AccessError extends Error{constructor(m,status=404){super(m);this.name='AccessError';this.status=status}}

const als=new AsyncLocalStorage();
export const SYSTEM=Object.freeze({type:'system'});
export const runAs=(actor,fn)=>als.run(actor,fn);       // for one request or task
export const enterAs=actor=>als.enterWith(actor);       // for scripts and tests (rest of the process)
export const actor=()=>als.getStore();
export const ROLES=['owner','editor','viewer'];
export const canWrite=role=>role==='owner'||role==='editor';

// The actor's role in a household, or null.
export function roleIn(householdId,a=actor()){
 if(!a)return null;
 if(a.type==='system')return 'owner';
 if(a.type==='user')return db().prepare('SELECT role FROM memberships WHERE household_id=? AND user_id=?').get(householdId,a.userId)?.role||null;
 if(a.type==='ingest')return a.household===householdId?'editor':null;
 return null;
}

export function forMember(memberId){
 const a=actor();if(!a)throw new AccessError('No access context',403);
 if(typeof memberId!=='string'||!memberId)throw new AccessError('Unknown profile');
 const d=db(),m=d.prepare('SELECT id,household_id FROM members WHERE id=?').get(memberId);
 // Unknown and not-yours look the same, so member ids of other households are not revealed.
 if(!m)throw new AccessError('Unknown profile');
 if(a.type==='ingest'&&a.memberId&&a.memberId!==memberId)throw new AccessError('Unknown profile');
 const role=roleIn(m.household_id,a);if(!role)throw new AccessError('Unknown profile');
 const bind=(sql,params={})=>{
  if(!scoped(sql))throw new AccessError('Query is not scoped to a member',500);
  if(params===null||typeof params!=='object'||Array.isArray(params))throw new AccessError('Use named parameters',500);
  if('member' in params)throw new AccessError('$member is bound by the store',500);
  return [d.prepare(sql),{...params,member:memberId}];
 };
 return {
  id:memberId,household:m.household_id,role,
  all:(sql,params)=>{const [s,p]=bind(sql,params);return s.all(p)},
  get:(sql,params)=>{const [s,p]=bind(sql,params);return s.get(p)},
  run:(sql,params)=>{if(!canWrite(role))throw new AccessError('Read-only access',403);const [s,p]=bind(sql,params);return s.run(p)},
  tx:fn=>transaction(d,fn),
 };
}

// Document tables: an ordered list of JSON records per member (episodes, entries, inbox, medicines, appointments).
const DOCS={
 episodes:{},
 episode_entries:{episode_id:r=>r.episodeId??null},
 inbox_items:{},
 medicine_plans:{episode_id:r=>r.episodeId??null},
 appointments:{date:r=>r.date??null,status:r=>r.status??null},
};
export function docs(table){
 const extra=DOCS[table];if(!extra)throw Error('Unknown document table');
 const cols=Object.keys(extra);
 const insert=`INSERT INTO ${table}(member_id,id,pos,data${cols.map(c=>','+c).join('')}) VALUES($member,$id,$pos,$data${cols.map(c=>',$'+c).join('')})`;
 return {
  list(memberId){return forMember(memberId).all(`SELECT data FROM ${table} WHERE member_id=$member ORDER BY pos`).map(r=>JSON.parse(r.data))},
  // Replaces the member's whole list atomically (lists are small; keeps the modules' array logic unchanged).
  replace(memberId,records){
   const m=forMember(memberId);
   m.tx(()=>{
    m.run(`DELETE FROM ${table} WHERE member_id=$member`);
    records.forEach((r,pos)=>{
     if(!r||typeof r.id!=='string'||!r.id)throw Error(table+': every record needs an id');
     m.run(insert,{id:r.id,pos,data:JSON.stringify(r),...Object.fromEntries(cols.map(c=>[c,extra[c](r)]))});
    });
   });
  },
 };
}

// ---- households and members (instance-wide) ----
const ID=/^[a-z][a-z0-9-]{0,31}$/,COLOR=/^#[0-9a-f]{6}$/i;
export function createHousehold(name='Household'){
 const h={id:randomUUID(),name:String(name).trim().slice(0,80)||'Household',created_at:new Date().toISOString()};
 db().prepare('INSERT INTO households(id,name,created_at) VALUES($id,$name,$created_at)').run(h);return h;
}
export const households=()=>db().prepare('SELECT id,name,created_at FROM households ORDER BY created_at,rowid').all();
export function cleanMember(m,where='member'){
 if(!m||typeof m!=='object')throw Error(where+' must be an object');
 if(typeof m.id!=='string'||!ID.test(m.id))throw Error(where+': id must be lowercase letters, digits or dashes (max 32)');
 const name=typeof m.name==='string'?m.name.trim():'';if(!name||name.length>40)throw Error(where+': name is required (max 40 characters)');
 const kind=m.kind??'adult';if(kind!=='adult'&&kind!=='child')throw Error(where+': kind must be "adult" or "child"');
 if(m.color!==undefined&&m.color!==null&&(typeof m.color!=='string'||!COLOR.test(m.color)))throw Error(where+': color must look like #157667');
 const initial=typeof m.initial==='string'&&m.initial.trim()?m.initial.trim().slice(0,2):[...name][0].toUpperCase();
 return {id:m.id,name,initial,kind,labs:kind==='adult'&&m.labs===true,color:m.color||null};
}
export function addMember(householdId,m){
 const c=cleanMember(m),d=db();
 const pos=d.prepare('SELECT COALESCE(MAX(position)+1,0) AS p FROM members WHERE household_id=?').get(householdId).p;
 d.prepare('INSERT INTO members(id,household_id,name,initial,kind,labs,color,position,created_at) VALUES($id,$household,$name,$initial,$kind,$labs,$color,$pos,$at)')
  .run({...c,labs:c.labs?1:0,household:householdId,pos,at:new Date().toISOString()});
 return c;
}
// A new, instance-wide unique member id from a display name (ids are folder names and the global key).
export function newMemberId(name){
 const base=String(name||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/^[^a-z]+/,'').slice(0,20)||'member';
 const d=db();
 for(;;){const id=base+'-'+randomUUID().slice(0,4);if(!d.prepare('SELECT 1 FROM members WHERE id=?').get(id))return id}
}
// Profile changes go through the access check and need the owner role in the member's household.
function ownerOf(memberId){
 const m=forMember(memberId);
 if(m.role!=='owner')throw new AccessError('Only an owner can change profiles',403);
 return m;
}
export function updateMember(memberId,patch){
 ownerOf(memberId);
 const d=db(),cur=d.prepare('SELECT * FROM members WHERE id=?').get(memberId);
 const c=cleanMember({id:memberId,name:patch.name??cur.name,kind:patch.kind??cur.kind,color:patch.color===undefined?cur.color:patch.color,labs:!!cur.labs,initial:patch.name&&patch.name!==cur.name?undefined:cur.initial});
 d.prepare('UPDATE members SET name=$name,initial=$initial,kind=$kind,labs=$labs,color=$color WHERE id=$id').run({...c,labs:c.labs?1:0});
 return c;
}
export function addProfile(householdId,m){
 if(roleIn(householdId)!=='owner')throw new AccessError('Only an owner can add profiles',403);
 return addMember(householdId,{...m,id:newMemberId(m?.name)});
}
// Deletes a profile and, through ON DELETE CASCADE, all of its records.
export function removeMember(memberId){
 const m=ownerOf(memberId),d=db();
 return transaction(d,()=>{
  if(d.prepare('SELECT COUNT(*) n FROM members WHERE household_id=?').get(m.household).n<=1)throw Error('A household needs at least one profile');
  d.prepare('DELETE FROM members WHERE id=?').run(memberId);
 });
}
const rowToMember=r=>({id:r.id,name:r.name,initial:r.initial,kind:r.kind,labs:!!r.labs,color:r.color,household:r.household_id});
export function listMembers(householdId){
 const d=db();
 const rows=householdId===undefined?d.prepare('SELECT m.* FROM members m JOIN households h ON h.id=m.household_id ORDER BY h.created_at,h.rowid,m.position').all()
  :d.prepare('SELECT * FROM members WHERE household_id=? ORDER BY position').all(householdId);
 return rows.map(rowToMember);
}

// Unscoped access for migrations, the importer and the push scheduler only.
export const system=()=>db();
export {transaction};
