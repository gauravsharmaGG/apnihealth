// Household members, read from private/members.json (shape: config/members.example.json).
// Every data module validates member ids through this list, so ids double as safe folder names.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const defaultFile=fileURLToPath(new URL('./private/members.json',import.meta.url));
const ID=/^[a-z][a-z0-9-]{0,31}$/,COLOR=/^#[0-9a-f]{6}$/i,KINDS=new Set(['adult','child']);
let cache;
export function validate(list){
 if(!Array.isArray(list)||!list.length)throw Error('members.json must be a non-empty list');
 if(list.length>20)throw Error('members.json: at most 20 members');
 const seen=new Set();
 return list.map((m,i)=>{
  const where='members.json entry '+i;
  if(!m||typeof m!=='object')throw Error(where+' must be an object');
  if(typeof m.id!=='string'||!ID.test(m.id))throw Error(where+': id must be lowercase letters, digits or dashes (max 32)');
  if(seen.has(m.id))throw Error(where+': duplicate id');seen.add(m.id);
  const name=typeof m.name==='string'?m.name.trim():'';if(!name||name.length>40)throw Error(where+': name is required (max 40 characters)');
  const kind=m.kind??'adult';if(!KINDS.has(kind))throw Error(where+': kind must be "adult" or "child"');
  if(m.color!==undefined&&(typeof m.color!=='string'||!COLOR.test(m.color)))throw Error(where+': color must look like #157667');
  const initial=typeof m.initial==='string'&&m.initial.trim()?m.initial.trim().slice(0,2):[...name][0].toUpperCase();
  return {id:m.id,name,initial,kind,labs:kind==='adult'&&m.labs===true,color:m.color||null};
 });
}
export function load(){
 if(cache)return cache;
 const file=process.env.MEMBERS_FILE||defaultFile;
 let raw;try{raw=JSON.parse(readFileSync(file,'utf8'))}catch(e){throw Error('Cannot read members file (copy config/members.example.json to private/members.json): '+(e.code||'invalid JSON'))}
 return cache=validate(raw);
}
export const list=()=>load();
export const ids=()=>load().map(m=>m.id);
export const has=id=>typeof id==='string'&&load().some(m=>m.id===id);
export const get=id=>load().find(m=>m.id===id);
export const defaultId=()=>load()[0].id;
export const name=id=>get(id)?.name||id;
export function reset(){cache=undefined}
