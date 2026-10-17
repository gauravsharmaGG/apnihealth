// importer.mjs: JSON private/ layout -> SQLite, on a fictional layout. Counts only; JSON files untouched.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const dir=mkdtempSync(tmpdir()+'/apni-import-'),priv=join(dir,'private');process.env.DB_FILE=join(dir,'apni.db');
const J=(f,v)=>{mkdirSync(join(priv,f,'..'),{recursive:true});writeFileSync(join(priv,f),JSON.stringify(v))};
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
J('members.json',JSON.parse(readFileSync(new URL('config/members.example.json',import.meta.url))));
J('health-log.json',{entries:[
 {id:'l1',metric:'steps',date:'2000-01-01',value:8000,profile:'alex',source:'manual',ts:1},
 {id:'l2',metric:'weight',date:'2000-01-01',value:70.5,source:'apple-health',ts:2},          // no profile: first member
 {id:'l3',metric:'steps',date:'2000-01-02',value:5000,profile:'sam',source:'manual',ts:3},
 {id:'l4',metric:'steps',date:'2000-01-02',value:5000,profile:'nobody',ts:4},                 // unknown member: skipped
 {id:'l5',metric:'steps',date:'not-a-date',value:1,profile:'alex'},                            // invalid: skipped
 {id:'l1',metric:'steps',date:'2000-01-03',value:1,profile:'alex'}]});                         // duplicate id: skipped
J('profiles/alex/episodes.json',[{id:'ep1',title:'Example cold',category:'Illness',startDate:'2000-01-01',status:'ongoing',endDate:null,createdAt:'2000-01-01T00:00:00Z'}]);
J('profiles/alex/events.json',[{id:'ev1',episodeId:'ep1',date:'2000-01-01',time:'08:00',kind:'note',note:'Example note'},{noId:true}]);
J('profiles/alex/medicines.json',[{id:'p1',episodeId:'ep1',name:'Medicine A',days:3,frequency:2,mode:'times',times:['08:00','20:00'],startDate:'2000-01-01',confirmed:true,logs:{}}]);
J('profiles/alex/appointments.json',[{id:'a1',title:'Example check-up',date:'2000-02-01',time:'09:00',status:'scheduled',category:'Check-up'}]);
J('profiles/mia/inbox.json',[{id:uuid(1),category:'vaccination',date:'2000-01-05',title:'Example record',fileName:'example.jpg',storedFileName:uuid(1)+'.jpg',mimeType:'image/jpeg',size:3,createdAt:'2000-01-05T00:00:00Z',status:'needs-review'},
 {id:uuid(2),category:'other',date:'2000-01-06',title:'Missing file',fileName:'x.pdf',storedFileName:uuid(2)+'.pdf',mimeType:'application/pdf',size:3,createdAt:'2000-01-06T00:00:00Z',status:'needs-review'}]);
mkdirSync(join(priv,'profiles/mia/uploads'),{recursive:true});writeFileSync(join(priv,'profiles/mia/uploads',uuid(1)+'.jpg'),'abc');
J('profiles/ghost/episodes.json',[{id:'x'}]);                                                    // folder of an unknown member
J('push-subs.json',[{endpoint:'https://push.example/one',keys:{p256dh:'k',auth:'a'},createdAt:5,profiles:{alex:{since:10},nobody:{since:1}},appt:{mia:{since:11}},muted:['p1']},{endpoint:'bad'}]);
J('push-state.json',{'one|p1|0:0|due':1234,'bad':'x'});
const hashAll=()=>createHash('sha256').update(readdirSync(priv,{recursive:true}).sort().map(f=>{const p=join(priv,f);return statSync(p).isFile()?f+readFileSync(p):f}).join('|')).digest('hex');
const before=hashAll();
const {importJson}=await import('./importer.mjs'),D=await import('./db.mjs'),S=await import('./store.mjs'),{docs}=S;
try{
 // dry run: full validation, nothing written
 const dry=importJson({privateDir:priv,dryRun:true});
 assert.equal(dry.dryRun,true);assert.equal(S.households().length,0,'dry run writes nothing');
 const r=importJson({privateDir:priv,householdName:'Example household'});
 assert.deepEqual(r.counts,dry.counts,'dry run reports the same counts');
 assert.deepEqual(r.counts,{members:3,log_entries:3,episodes:1,episode_entries:1,inbox_items:2,medicine_plans:1,appointments:1,push_subscriptions:1,push_topics:2,push_sent:1,skipped:6,missing_upload_files:1,unknown_profile_dirs:1});
 assert.deepEqual(S.listMembers().map(m=>[m.id,m.kind,m.labs]),[['alex','adult',true],['sam','adult',false],['mia','child',false]]);
 const a=S.forMember('alex');
 assert.deepEqual(a.all('SELECT id FROM log_entries WHERE member_id=$member ORDER BY id').map(x=>x.id),['l1','l2'],'entries without a profile belong to the first member');
 assert.equal(docs('episodes').list('alex')[0].title,'Example cold');assert.equal(docs('medicine_plans').list('alex')[0].times.length,2);
 assert.equal(a.get('SELECT episode_id FROM episode_entries WHERE member_id=$member').episode_id,'ep1');
 assert.equal(docs('inbox_items').list('mia').length,2);assert.equal(docs('episodes').list('sam').length,0);
 const sub=D.db().prepare('SELECT * FROM push_subscriptions').get();assert.equal(sub.muted,'["p1"]');
 assert.deepEqual(D.db().prepare('SELECT member_id,topic,since FROM push_topics ORDER BY topic').all().map(x=>({...x})),[{member_id:'mia',topic:'appointments',since:11},{member_id:'alex',topic:'medicine',since:10}]);
 // never twice, JSON untouched
 assert.throws(()=>importJson({privateDir:priv}),/already has a household/);
 assert.equal(hashAll(),before,'JSON files and uploads are unchanged');
 // CLI: counts only, refuses a second run
 D.close();
 const cli=spawnSync(process.execPath,['scripts/import-json.mjs','--private',priv],{env:{...process.env},encoding:'utf8'});
 assert.notEqual(cli.status,0);assert.match(cli.stderr,/already has a household/);
 rmSync(process.env.DB_FILE);rmSync(process.env.DB_FILE+'-wal',{force:true});rmSync(process.env.DB_FILE+'-shm',{force:true});
 const ok=spawnSync(process.execPath,['scripts/import-json.mjs','--private',priv,'--dry-run'],{env:{...process.env},encoding:'utf8'});
 assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/DRY RUN/);assert(!/Example|Medicine A|push\.example/.test(ok.stdout),'CLI prints counts, never values');
 // invalid input fails cleanly
 J('members.json',[{id:'Bad Id',name:'X'}]);assert.throws(()=>importJson({privateDir:priv}),/members.json entry 0/);
 J('members.json',[]);assert.throws(()=>importJson({privateDir:priv}),/missing or empty/);
 console.log('PASS import: dry run, counts, member mapping, skips, documents, push data, never twice, JSON untouched, CLI.');
}finally{D.close();rmSync(dir,{recursive:true,force:true})}
