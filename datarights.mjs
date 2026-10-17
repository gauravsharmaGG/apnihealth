// Data rights: export everything a person can see (their account and every household they belong to, with
// uploaded files) as one ZIP, and delete an account (and every household they are the only owner of, with all
// of its profiles' records and files).
import * as A from './accounts.mjs';
import {forMember,listMembers,system,transaction} from './store.mjs';
import {blobs,profilePrefix} from './blobs.mjs';
import {consentsOf} from './consent.mjs';
import * as settings from './settings.mjs';
import {zipWriter} from './zip.mjs';
import {APP_NAME} from './env.mjs';

// Tables with a member_id column are member records, except secrets and device plumbing.
const SKIP=new Set(['ingest_tokens','push_topics']);
function recordTables(){
 const d=system();
 return d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name)
  .filter(t=>!SKIP.has(t)&&d.prepare(`PRAGMA table_info("${t}")`).all().some(c=>c.name==='member_id'));
}
const tidy=row=>{const o={...row};if(typeof o.data==='string'){try{o.data=JSON.parse(o.data)}catch{}}return o};
// Runs as the signed-in user, so every record goes through the normal access check (forMember).
export async function exportData(user){
 const tables=recordTables(),files=[];
 const households=[];
 for(const h of A.householdsOf(user.id)){
  const members=[];
  for(const m of listMembers(h.id)){
   const f=forMember(m.id),records={};
   for(const t of tables)records[t]=f.all(`SELECT * FROM "${t}" WHERE member_id=$member`).map(tidy);
   const prefix=profilePrefix(m.id);
   for(const b of await blobs().list(prefix))files.push({name:`files/${m.id}/${b.key.slice(prefix.length)}`,key:b.key});
   members.push({id:m.id,name:m.name,kind:m.kind,color:m.color,records});
  }
  const s=settings.get(h.id);
  households.push({id:h.id,name:h.name,yourRole:h.role,settings:{metrics:s.metrics,timeZone:s.timeZone,units:s.units},
   people:A.people(h.id).map(p=>({email:p.email,name:p.name,role:p.role})),members});
 }
 const data={
  format:'apnihealth-export',version:1,app:APP_NAME,exportedAt:new Date().toISOString(),
  account:{email:user.email,name:user.name||null,
   passkeys:A.passkeysOf(user.id).map(p=>({name:p.name,createdAt:p.createdAt??p.created_at,lastUsedAt:p.lastUsedAt??p.last_used_at??null})),
   healthDataConsents:consentsOf(user.id)},
  households,
  files:files.map(f=>f.name)
 };
 return {data,files};
}
// Streams the ZIP: data.json, a short README, then every uploaded file (read one at a time).
export async function writeZip(out,{data,files}){
 const z=zipWriter(b=>out.write(b));
 z.add('README.txt',`${APP_NAME} export of ${data.account.email}, made ${data.exportedAt}.\n\ndata.json holds your account, every household you belong to, its profiles and all their records.\nfiles/<profile id>/ holds the photos and documents uploaded for each profile.\nMeasurements are in metric units (kg, °C).\n`);
 z.add('data.json',JSON.stringify(data,null,1));
 for(const f of files){const bytes=await blobs().read(f.key);if(!bytes)throw Error('Uploaded file missing: '+f.name);z.add(f.name,bytes)}
 z.end();
}

// Households this person is the only owner of: deleted with the account.
export function soleOwned(userId){
 const d=system();
 return A.householdsOf(userId).filter(h=>h.role==='owner'&&d.prepare("SELECT COUNT(*) n FROM memberships WHERE household_id=? AND role='owner'").get(h.id).n===1)
  .map(h=>({id:h.id,name:h.name,others:d.prepare('SELECT COUNT(*) n FROM memberships WHERE household_id=? AND user_id<>?').get(h.id,userId).n}));
}
// Deletes the account and its sole-owned households (records cascade in the database; files are removed from
// storage afterwards). Memberships in other households, sessions, passkeys, consents and push devices go with the user.
export async function deleteAccount(user){
 const d=system(),gone=soleOwned(user.id),prefixes=[];
 transaction(d,()=>{
  for(const h of gone){for(const m of listMembers(h.id))prefixes.push(profilePrefix(m.id));d.prepare('DELETE FROM households WHERE id=?').run(h.id)}
  d.prepare('DELETE FROM login_tokens WHERE email=?').run(user.email);
  d.prepare('DELETE FROM users WHERE id=?').run(user.id);
 });
 for(const p of prefixes)await blobs().deletePrefix(p);
 return {households:gone.map(h=>h.name)};
}
