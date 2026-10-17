// Data rights on fictional data: export (ZIP with data.json and every uploaded file; complete row counts for every
// record table; only the person's own households; no secrets; valid ZIP), deleting a profile removes its rows and
// files, deleting an account removes the user, every household they solely own (rows and files) and nothing else.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import http from 'node:http';
import {startServer} from './testlib.mjs';
const src=new URL('.',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'apni-dr-'));
cpSync(src,dir,{recursive:true,filter:p=>!new Set(['.git','private','node_modules']).has(p.slice(src.length).split('/')[0])});
const env={PATH:process.env.PATH,NO_PUSH:'1',DB_FILE:join(dir,'private/test.db'),AUTH_MODE:'builtin'};
const node=code=>{const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
const U=JSON.parse(node(`const S=await import('./store.mjs'),A=await import('./accounts.mjs'),C=await import('./consent.mjs'),log=await import('./log.mjs'),ev=await import('./events.mjs'),labs=await import('./labs.mjs'),ap=await import('./appointments.mjs'),ing=await import('./ingest.mjs');S.enterAs(S.SYSTEM);
const a=S.createHousehold('Household A'),sh=S.createHousehold('Shared'),b=S.createHousehold('Household B');
S.addMember(a.id,{id:'ann',name:'Ann'});S.addMember(a.id,{id:'kid',name:'Kid',kind:'child'});S.addMember(sh.id,{id:'sal',name:'Sal'});S.addMember(b.id,{id:'bob',name:'Bob'});
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex').toString('base64');
for(const m of ['ann','kid','sal','bob']){
 log.add([{metric:'steps',date:'2000-01-01',value:1000},{metric:'weight',date:'2000-01-02',value:60}],'manual',m);
 const e=ev.addEpisode(m,{title:'Example cold',category:'Illness',startDate:'2000-01-03'});ev.addEvent(m,{episodeId:e.id,kind:'note',date:'2000-01-03',time:'08:00',note:'Example note'});
 labs.addReport(m,{date:'2000-01-04',values:[{name:'Ferritin',value:'45',unit:'ng/mL',reference:'30-300'}]});
 ap.mutate(m,{action:'save',appointment:{title:'Checkup',category:'checkup',date:'2000-02-01',time:'09:00'}});
 await ev.addInbox(m,{category:'other',date:'2000-01-05',title:'Scan',fileName:'scan.png',mimeType:'image/png',dataBase64:png});
}
const out={};
for(const [e,roles,c] of [['owner-a@example.com',[[a,'owner'],[sh,'owner']],1],['editor-a@example.com',[[a,'editor']],1],['viewer-a@example.com',[[a,'viewer']],1],['owner-s@example.com',[[sh,'owner']],1],['owner-b@example.com',[[b,'owner']],1],['undecided@example.com',[],0]]){
 const u=A.createUser(e);for(const [h,r] of roles)A.setMembership(h.id,u.id,r);if(c)C.recordConsent(u.id);out[e]={id:u.id,token:A.createSession(u.id)}}
ing.createKey('ann','Phone',out['owner-a@example.com'].id);
out.households={a:a.id,sh:sh.id,b:b.id};console.log(JSON.stringify(out))`));
mkdirSync(join(dir,'private/profiles/kid/extra'),{recursive:true});writeFileSync(join(dir,'private/profiles/kid/extra/notes.txt'),'fictional note\n');
// Row counts per record table and member, straight from the database.
const counts=()=>JSON.parse(node(`const S=await import('./store.mjs');S.enterAs(S.SYSTEM);const d=S.system();
const t=d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).filter(n=>d.prepare('PRAGMA table_info("'+n+'")').all().some(c=>c.name==='member_id'));
const o={};for(const n of t)for(const r of d.prepare('SELECT member_id m,COUNT(*) c FROM "'+n+'" GROUP BY member_id').all())(o[r.m]??={})[n]=r.c;console.log(JSON.stringify(o))`));
const q=sql=>JSON.parse(node(`const S=await import('./store.mjs');console.log(JSON.stringify(S.system().prepare(${JSON.stringify(sql)}).all()))`));
let p;
try{
 const before=counts();
 for(const m of ['ann','kid','sal','bob'])assert(before[m].log_entries===2&&before[m].lab_reports===1&&before[m].inbox_items===1,'seeded '+m);
 const s=await startServer({cwd:dir,env});p=s.p;const port=s.port,O=`http://localhost:${port}`;
 const req=({method='GET',path,who,json,origin=O})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`localhost:${port}`,...(who?{Cookie:'apni_session='+U[who].token}:{}),...(method!=='GET'?{'Content-Type':'application/json',...(origin?{Origin:origin}:{})}:{})}},res=>{const c=[];res.on('data',d=>c.push(d));res.on('end',()=>{const b=Buffer.concat(c);let j;try{j=JSON.parse(b)}catch{}ok({status:res.statusCode,headers:res.headers,buf:b,body:b.toString(),json:j})})});q.on('error',no);q.end(json?JSON.stringify(json):undefined)});
 // unzip with Python's zipfile (an independent reader): CRCs checked, names and contents returned
 const unzip=buf=>{const f=join(dir,'x.zip');writeFileSync(f,buf);const r=spawnSync('python3',['-c',`import zipfile,sys,json,base64
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
print(json.dumps({i.filename:base64.b64encode(z.read(i)).decode() for i in z.infolist()}))`,f],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return Object.fromEntries(Object.entries(JSON.parse(r.stdout)).map(([k,v])=>[k,Buffer.from(v,'base64')]))};
 // --- export ---
 const ex=await req({path:'/api/export',who:'owner-a@example.com'});
 assert.equal(ex.status,200);assert.equal(ex.headers['content-type'],'application/zip');assert.match(ex.headers['content-disposition'],/attachment; filename="apnihealth-export-\d{4}-\d{2}-\d{2}\.zip"/);
 const z=unzip(ex.buf),data=JSON.parse(z['data.json']);
 assert(z['README.txt']);assert.equal(data.account.email,'owner-a@example.com');assert.equal(data.account.healthDataConsents.length,1);
 assert.deepEqual(data.households.map(h=>h.name).sort(),['Household A','Shared'],'every household of this person, no others');
 for(const h of data.households)for(const m of h.members){
  const want=before[m.id];for(const [t,c] of Object.entries(want)){if(t==='ingest_tokens'||t==='push_topics')continue;assert.equal(m.records[t]?.length,c,`${m.id}.${t}`)}
 }
 assert.equal(JSON.stringify(data).includes('bob'),false,'nothing of other households');
 for(const secret of ['token_hash','public_key','apni_session'])assert.equal(JSON.stringify(data).includes(secret),false,'no '+secret);
 const onDisk=JSON.parse(node(`import('node:fs').then(fs=>{const out=[];for(const m of ['ann','kid','sal'])for(const f of fs.readdirSync('private/profiles/'+m,{recursive:true,withFileTypes:true}))if(f.isFile())out.push((f.parentPath||f.path).replace(/^.*private\\/profiles\\//,'')+'/'+f.name);console.log(JSON.stringify(out.sort()))})`));
 const zipped=Object.keys(z).filter(n=>n.startsWith('files/')).map(n=>n.slice(6)).sort();
 assert.deepEqual(zipped,onDisk,'every uploaded file of every profile');assert.equal(zipped.length,4);
 for(const n of zipped)assert(z['files/'+n].equals(readFileSync(join(dir,'private/profiles',n))),'file bytes identical: '+n);
 assert.deepEqual(data.files.slice().sort(),zipped.map(n=>'files/'+n));
 const vz=unzip((await req({path:'/api/export',who:'viewer-a@example.com'})).buf),vd=JSON.parse(vz['data.json']);
 assert.deepEqual(vd.households.map(h=>[h.name,h.yourRole]),[['Household A','viewer']],'viewers can export what they can see');
 assert.equal((await req({path:'/api/export',who:'undecided@example.com'})).status,403,'no export of health data before consent');
 assert.equal((await req({path:'/api/export'})).status,401);
 // --- deleting a profile removes its rows and files ---
 assert.equal((await req({method:'POST',path:'/api/household/members/remove',who:'owner-a@example.com',json:{id:'kid',confirm:'Kid'}})).status,200);
 assert.equal(counts().kid,undefined,'no rows left for the profile');assert.equal(existsSync(join(dir,'private/profiles/kid')),false,'its files are gone');
 assert(existsSync(join(dir,'private/profiles/ann/uploads')),'other profiles keep their files');
 // --- deleting an account ---
 const acct=(await req({path:'/api/account',who:'owner-a@example.com'})).json;
 assert.deepEqual(acct.soleOwned.map(h=>[h.name,h.others]),[['Household A',2]],'the shared household has another owner');
 assert.equal((await req({method:'POST',path:'/api/account/delete',who:'owner-a@example.com',json:{confirm:'someone@example.com'}})).status,400,'needs the right email');
 assert.equal((await req({method:'POST',path:'/api/account/delete',who:'owner-a@example.com',json:{confirm:'owner-a@example.com'},origin:'https://evil.example'})).status,403,'CSRF');
 assert.equal(q("SELECT COUNT(*) n FROM users WHERE email='owner-a@example.com'")[0].n,1,'nothing deleted yet');
 const del=await req({method:'POST',path:'/api/account/delete',who:'owner-a@example.com',json:{confirm:' Owner-A@example.com '}});
 assert.equal(del.status,200);assert.deepEqual(del.json.households,['Household A']);assert.match(del.headers['set-cookie'][0],/Max-Age=0/);
 assert.equal((await req({path:'/api/me',who:'owner-a@example.com'})).status,401,'signed out everywhere');
 const uid=U['owner-a@example.com'].id;
 for(const t of ['users WHERE id=?','sessions WHERE user_id=?','memberships WHERE user_id=?','consents WHERE user_id=?','passkeys WHERE user_id=?'])assert.equal(q(`SELECT COUNT(*) n FROM ${t.replace('?',`'${uid}'`)}`)[0].n,0,t);
 assert.equal(q(`SELECT COUNT(*) n FROM households WHERE id='${U.households.a}'`)[0].n,0,'sole-owned household deleted');
 assert.equal(q("SELECT COUNT(*) n FROM members WHERE id IN ('ann','kid')")[0].n,0);
 assert.equal(q(`SELECT COUNT(*) n FROM ingest_tokens WHERE household_id='${U.households.a}'`)[0].n,0,'its Apple Health keys too');
 const after=counts();assert.equal(after.ann,undefined,'no records left');assert.equal(existsSync(join(dir,'private/profiles/ann')),false,'files removed from disk');
 assert.deepEqual(after.sal,before.sal,'the shared household (another owner) keeps everything');assert(existsSync(join(dir,'private/profiles/sal/uploads')));
 assert.deepEqual(after.bob,before.bob,'other households untouched');assert(existsSync(join(dir,'private/profiles/bob/uploads')));
 assert.equal((await req({path:'/api/household',who:'owner-s@example.com'})).json.people.length,1,'the co-owner stays, alone');
 for(const w of ['editor-a@example.com','viewer-a@example.com']){assert.equal(q(`SELECT COUNT(*) n FROM users WHERE email='${w}'`)[0].n,1,'other people keep their accounts');assert.equal((await req({path:'/',who:w})).headers.location,'/welcome','and have no household now')}
 assert.equal((await req({path:'/api/log?profile=bob',who:'owner-b@example.com'})).json.entries.length,2,'isolation still holds');
 assert.equal((await req({path:'/api/log?profile=sal',who:'owner-b@example.com'})).status,400);
 // withdrawing before ever accepting the notice also works
 assert.equal((await req({method:'POST',path:'/api/account/delete',who:'undecided@example.com',json:{confirm:'undecided@example.com'}})).status,200);
 assert.equal(q("SELECT COUNT(*) n FROM users WHERE email='undecided@example.com'")[0].n,0);
 console.log('PASS data rights: export ZIP (valid, every household of the person, complete row counts for every record table, every uploaded file byte for byte, no secrets, viewers too, consent required); profile deletion removes rows and files; account deletion (email confirmation, CSRF) removes the user, sole-owned households with rows, keys and files, keeps shared and other households and other people; isolation.');
}finally{p?.kill();rmSync(dir,{recursive:true,force:true})}
