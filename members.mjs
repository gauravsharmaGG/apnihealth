// Household members (people whose records are kept; they need no login), stored in the database.
// The list depends on who is asking (store.actor()): a signed-in user sees the members of their active
// household, a sync token its household, and system code (scripts, scheduler) every member.
import {listMembers,cleanMember,actor} from './store.mjs';
const SETUP='No household members yet: copy config/members.example.json to private/members.json, edit it, then run node scripts/import-json.mjs';
// Validates a members.json-style list (used by the importer and tests).
export function validate(list){
 if(!Array.isArray(list)||!list.length)throw Error('members.json must be a non-empty list');
 if(list.length>20)throw Error('members.json: at most 20 members');
 const seen=new Set();
 return list.map((m,i)=>{const c=cleanMember(m,'members.json entry '+i);if(seen.has(c.id))throw Error('members.json entry '+i+': duplicate id');seen.add(c.id);return c});
}
const strip=({household,...m})=>m;
export function list(){
 const a=actor();if(!a)return [];
 if(a.type==='system')return listMembers().map(strip);
 if(!a.household)return [];
 const l=listMembers(a.household);
 return (a.type==='ingest'&&a.memberId?l.filter(m=>m.id===a.memberId):l).map(strip);
}
// Startup check (system view): the instance has at least one member.
export function load(){const l=listMembers().map(strip);if(!l.length)throw Error(SETUP);return l}
export const ids=()=>list().map(m=>m.id);
export const has=id=>typeof id==='string'&&list().some(m=>m.id===id);
export const get=id=>list().find(m=>m.id===id);
export const defaultId=()=>list()[0]?.id;
export const name=id=>get(id)?.name||id;
