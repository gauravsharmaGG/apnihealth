// Household members, stored in the database (add them with scripts/import-json.mjs from a members.json shaped
// like config/members.example.json). Every data module checks member ids through store.forMember.
import {listMembers,cleanMember} from './store.mjs';
const SETUP='No household members yet: copy config/members.example.json to private/members.json, edit it, then run node scripts/import-json.mjs';
// Validates a members.json-style list (used by the importer and tests).
export function validate(list){
 if(!Array.isArray(list)||!list.length)throw Error('members.json must be a non-empty list');
 if(list.length>20)throw Error('members.json: at most 20 members');
 const seen=new Set();
 return list.map((m,i)=>{const c=cleanMember(m,'members.json entry '+i);if(seen.has(c.id))throw Error('members.json entry '+i+': duplicate id');seen.add(c.id);return c});
}
// One household per instance for now; members come back in household order. No cache: the list is tiny and
// SQLite reads are fast, so changes are visible immediately.
export function load(){
 const l=listMembers().map(({household,...m})=>m);
 if(!l.length)throw Error(SETUP);
 return l;
}
export const list=()=>load();
export const ids=()=>load().map(m=>m.id);
export const has=id=>typeof id==='string'&&listMembers().some(m=>m.id===id);
export const get=id=>load().find(m=>m.id===id);
export const defaultId=()=>load()[0].id;
export const name=id=>get(id)?.name||id;
