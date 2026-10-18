// The app: one (req,res) handler shared by the Node server (server.mjs) and the Cloudflare Workers entry point
// (worker.mjs, through cloudflare:node's httpServerHandler). Nothing here listens or starts timers.
import {readFileSync,createReadStream,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as auth from './auth.mjs';
import * as A from './accounts.mjs';
import {runAs,SYSTEM,households,AccessError,canWrite,actor} from './store.mjs';
import * as hlog from './log.mjs';
import * as ev from './events.mjs';
import * as meds from './medicines.mjs';
import * as push from './push.mjs';
import * as appts from './appointments.mjs';
import * as members from './members.mjs';
import * as labs from './labs.mjs';
import * as household from './household.mjs';
import * as ingest from './ingest.mjs';
import * as consentPage from './consent-page.mjs';
import * as settings from './settings.mjs';
import * as rights from './datarights.mjs';
import {blobs} from './blobs.mjs';
import {inZone} from './env.mjs';
import {hasConsent,consentsOf,CONSENT_VERSION} from './consent.mjs';
import {APP_HOST,APP_NAME,TIME_ZONE,DEMO_NOTICE,publicOrigin} from './env.mjs';
import {landingPage} from './landing.mjs';
import {headers,frameHeaders,mime,readBody,json,send,limited,sameOrigin,allowedHosts as allowed} from './http.mjs';

// Static files come from a source with open(path) -> null | {size, read() -> Promise<Buffer>, stream() -> Readable}.
// Node reads public/ next to the code; the Workers entry point installs one backed by the static assets binding.
export function fsStatic(pub=resolve(fileURLToPath(new URL('.',import.meta.url)),'public')){
 return {
  async open(path){
   const file=resolve(pub,'.'+path);
   if(!file.startsWith(pub+'/')||path.includes('\0'))return null;
   let stat;try{stat=statSync(file)}catch{return null}
   return stat.isFile()?{size:stat.size,read:async()=>readFileSync(file),stream:()=>createReadStream(file)}:null;
  },
 };
}
let files=null;
export function setStaticFiles(source){files=source}
const staticFiles=()=>files||(files=fsStatic());

// Checks to run once before serving. Fail fast when the database has no members (the error says how to add them),
// except with open built-in sign-up, where an empty instance is normal: the first person to sign up creates their
// own household. legacyImport: the one-time private/ingest-token.txt migration (Node only).
export function startup({legacyImport=true}={}){
if(!(auth.MODE==='builtin'&&auth.SIGNUP==='open'))runAs(SYSTEM,()=>members.load());
if(legacyImport&&runAs(SYSTEM,()=>ingest.migrateLegacy()))console.log('Registered the existing Apple Health key from private/ingest-token.txt as a shared household key. Create per-profile keys in the app and revoke it when ready.');
if(auth.MODE==='builtin'&&!A.userCount())console.log('No users yet. Create the first one: node scripts/create-user.mjs --email you@example.com --role owner --link');
labs.catalog(); // and when the marker catalog (config/markers.default.json + private/markers.json) is invalid
}
// Errors from the access check: read-only access is 403; unknown or someone else's member stays 400.
const fail=(res,e)=>json(res,e instanceof AccessError&&e.status===403?403:400,{error:e.message||'Invalid request'});
export async function handler(req,res){try{
 if(!allowed.has(req.headers.host))return send(res,400,'Invalid host');
 if(APP_HOST&&req.headers.host===APP_HOST && req.headers['x-forwarded-proto']!=='https')return send(res,308,'',{Location:publicOrigin()+'/'});
 const reqUrl=new URL(req.url,'http://localhost'),path=decodeURIComponent(reqUrl.pathname);
 // Write-only Apple Health endpoint: its own bearer token, scoped to one household (no cookies involved).
 if(path==='/api/ingest'){
  if(req.method!=='POST')return json(res,405,{error:'POST only'});
  if(limited('ingest',120,600000))return json(res,429,{error:'Too many requests'});
  const m=/^Bearer (.+)$/.exec(req.headers.authorization||''),a=m&&ingest.actorFor(m[1]);
  if(!a)return json(res,401,{error:'Invalid token'});
  return await runAs(a,()=>app(req,res,reqUrl,path));
 }
 // CSRF: every state-changing request must come from this origin (sign-in forms and fetch alike).
 if(req.method!=='GET'&&req.method!=='HEAD'&&!sameOrigin(req))return path.startsWith('/api/')?json(res,403,{error:'Origin rejected'}):send(res,403,'Origin rejected');
 if(await auth.handle(req,res,path,reqUrl))return;
 const user=await auth.authenticate(req);
 if(!user){
  // Built-in sign-in: signed-out visitors get the public landing page (indexable, unlike the rest of the app).
  if(auth.MODE==='builtin'&&path==='/'&&(req.method==='GET'||req.method==='HEAD')){
   const html=landingPage({appName:APP_NAME,demoNotice:DEMO_NOTICE,signup:auth.SIGNUP}),{'X-Robots-Tag':_,...h}=headers;
   res.writeHead(200,{...h,'Content-Type':mime['.html'],'Content-Length':Buffer.byteLength(html)});return res.end(req.method==='HEAD'?undefined:html);
  }
  if(auth.MODE==='builtin'&&auth.PUBLIC_PATHS.has(path)&&(req.method==='GET'||req.method==='HEAD'))return serveStatic(req,res,path);
  if(path.startsWith('/api/'))return json(res,401,{error:'Sign in first'});
  if(auth.MODE==='builtin')return send(res,303,'',{Location:'/login'});
  return send(res,403,'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Sign-in required</title><h1>Sign-in required</h1><p><a href="/">Open your private health record</a></p></html>');
 }
 // The sign-in page's assets (styles, icons, scripts) also serve signed-in people without a household yet.
 if(auth.PUBLIC_PATHS.has(path)&&path!=='/login'&&(req.method==='GET'||req.method==='HEAD'))return serveStatic(req,res,path);
 if(await auth.account(req,res,path,user))return;
 // Deleting the account works at any time, also before accepting the notice (withdrawing consent).
 if(path==='/api/account'&&req.method==='GET')return json(res,200,{email:user.email,mode:auth.MODE,soleOwned:rights.soleOwned(user.id)});
 if(path==='/api/account/delete'&&req.method==='POST'){
  if(limited('delete:'+user.id,10,36e5))return json(res,429,{error:'Too many requests'});
  let b={};try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}
  if(typeof b.confirm!=='string'||b.confirm.trim().toLowerCase()!==user.email)return json(res,400,{error:'Type your email address to confirm'});
  const r=await rights.deleteAccount(user);
  return send(res,200,JSON.stringify({deleted:true,households:r.households}),{'Content-Type':'application/json; charset=utf-8',...(auth.MODE==='builtin'?{'Set-Cookie':auth.clearSession(req)}:{})});
 }
 // Nothing health-related happens before the current health-data notice is accepted (consent.mjs).
 if(await consentPage.handle(req,res,path,user))return;
 if(!hasConsent(user.id)){
  if(path.startsWith('/api/'))return json(res,403,{error:'Accept the health data notice first',consent:'required'});
  return send(res,303,'',{Location:'/consent'});
 }
 if(await household.handleAnywhere(req,res,path,user))return;
 // Export: the account and every household this person belongs to, with uploaded files, as one ZIP.
 if(path==='/api/export'&&req.method==='GET'){
  if(limited('export:'+user.id,20,36e5))return json(res,429,{error:'Too many exports; try again later'});
  const exp=await runAs({type:'user',userId:user.id,household:null},()=>rights.exportData(user));
  res.writeHead(200,{...headers,'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${APP_NAME.replace(/[^A-Za-z0-9]+/g,'-').toLowerCase()}-export-${new Date().toISOString().slice(0,10)}.zip"`});
  try{await rights.writeZip(res,exp);res.end()}catch(e){console.error('export failed:',e.message);res.destroy()}
  return;
 }
 const hh=A.activeHousehold(user);
 const hs=hh?settings.get(hh.id):null;
 return await runAs({type:'user',userId:user.id,household:hh?.id||null},()=>inZone(hs?.timeZone,()=>app(req,res,reqUrl,path,user,hh,hs)));
}catch(e){if(res.headersSent)res.destroy();else if(e instanceof AccessError)fail(res,e);else send(res,400,'Unable to process request')}}

const escHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
async function serveStatic(req,res,path){
 const rel=path==='/'?'/index.html':path,ext=extname(rel);
 if(path.includes('\0')||!mime[ext])return send(res,404,'Not found');
 const file=await staticFiles().open(rel);if(!file)return send(res,404,'Not found');
 if(DEMO_NOTICE&&ext==='.html'){ // demo instances: the notice on top of the app shell too
  const html=(await file.read()).toString('utf8').replace(/<body[^>]*>/,m=>m+`<p class="demo-notice" role="note">${escHtml(DEMO_NOTICE)}</p>`);
  res.writeHead(200,{...(path.startsWith('/records/')?frameHeaders:headers),'Content-Type':mime['.html'],'Content-Length':Buffer.byteLength(html)});return res.end(req.method==='HEAD'?undefined:html);
 }
 res.writeHead(200,{...(path.startsWith('/records/')?frameHeaders:headers),'Content-Type':mime[ext],'Content-Length':file.size});if(req.method==='HEAD')res.end();else file.stream().on('error',()=>res.destroy()).pipe(res);
}

// The app itself, running inside the request's access context (store.actor()).
async function app(req,res,reqUrl,path,user,hh,hs){
 const qProfile=reqUrl.searchParams.get('profile')||members.defaultId();
 // Write-only Apple Health / Shortcuts endpoint with its own bearer token (Cloudflare Access must bypass this one path).
 if(path==='/api/ingest'){
  let body;try{body=JSON.parse(await readBody(req))}catch{return json(res,400,{error:'Invalid JSON'})}
  const key=actor().memberId,asked=body.profile??(reqUrl.searchParams.has('profile')?qProfile:undefined);
  if(key&&asked!==undefined&&asked!==key)return json(res,403,{error:'This key belongs to another profile'});
  if(!key&&asked!==undefined&&!hlog.profileOk(asked))return json(res,400,{error:'Unknown profile'}); // never fall back to someone else
  const prof=key||(asked!==undefined?asked:members.defaultId());const entries=hlog.parseIngest(body);return json(res,200,{received:entries.length,saved:hlog.add(entries,'apple-health',prof)});
 }
 // First-run setup: people without a household, and owners who have not finished setting one up.
 if(path==='/welcome'&&(req.method==='GET'||req.method==='HEAD'))return serveStatic(req,res,'/welcome.html');
 if(!hh){ // signed in, but not in any household yet
  if(path.startsWith('/api/'))return json(res,403,{error:'You are not a member of a household yet'});
  if(path==='/onboarding.js')return serveStatic(req,res,path);
  return path==='/'||path==='/index.html'?send(res,303,'',{Location:'/welcome'}):send(res,404,'Not found');
 }
 if(hh.role==='owner'&&!hs.onboarded&&(path==='/'||path==='/index.html'))return send(res,303,'',{Location:'/welcome'});
 if(await household.handle(req,res,path,user,hh))return;
 if(path==='/api/me'&&req.method==='GET')return json(res,200,{email:user.email,name:user.name,mode:auth.MODE,household:hh,households:A.householdsOf(user.id),consent:{version:CONSENT_VERSION,accepted:consentsOf(user.id)}});
 if(path.startsWith('/api/')&&!hlog.profileOk(qProfile))return json(res,400,{error:'Unknown profile'});
 if(path==='/api/medicines'){
  try{
   const view=()=>meds.list(qProfile).filter(p=>ev.listEpisodes(qProfile).some(e=>e.id===p.episodeId)).map(p=>({...p,slots:meds.slots(p),effs:meds.effective(p)}));
   if(req.method==='GET')return json(res,200,{plans:view()});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('medicines',300,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,65536));meds.mutate(qProfile,b);return json(res,200,{plans:view()});
  }catch(e){return fail(res,e)}
 }

 if(path==='/api/import'){
  try{
   if(req.method!=='POST')return json(res,405,{error:'POST only'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('import',60,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,4*1024*1024));if(!Array.isArray(b.entries)||b.entries.length>60000)throw Error('Send at most 60,000 values at a time');
   const saved=hlog.add(hlog.parseIngest({entries:b.entries}),'apple-health',qProfile);return json(res,200,{received:b.entries.length,saved});
  }catch(e){return fail(res,e)}
 }

 if(path==='/api/appointments/ics'){
  const a=appts.list(qProfile).find(x=>x.id===reqUrl.searchParams.get('id'));if(!a)return json(res,404,{error:'Not found'});
  const who=members.list().length>1?members.name(qProfile):'';
  return send(res,200,appts.ics(a,who),{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="appointment.ics"'});
 }
 if(path==='/api/appointments'){
  try{
   if(req.method==='GET')return json(res,200,{appointments:appts.list(qProfile),categories:appts.CATEGORIES});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('appointments',300,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,32768));return json(res,200,{appointments:appts.mutate(qProfile,b)});
  }catch(e){return fail(res,e)}
 }

 if(path==='/api/push'){
  try{
   if(req.method==='GET')return json(res,200,{publicKey:push.publicKey()});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('push',120,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,16384)),ep=b.endpoint||b.subscription?.endpoint;
   const topic=b.topic==='appointments'?'appointments':'medicine';
   const uid=user.id;
   if(b.action==='subscribe')return json(res,200,push.subscribe(b.subscription,qProfile,Date.now(),topic,uid));
   if(typeof ep!=='string')throw Error('Missing endpoint');
   if(b.action==='unsubscribe')return json(res,200,push.unsubscribe(ep,qProfile,topic,uid));
   if(b.action==='status')return json(res,200,push.status(ep,qProfile,uid));
   if(b.action==='summary')return json(res,200,push.summary(ep,uid));
   if(b.action==='unsubscribe-all')return json(res,200,push.unsubscribe(ep,undefined,'medicine',uid));
   if(b.action==='mute')return json(res,200,push.mute(ep,String(b.planId),b.muted===true,uid));
   if(b.action==='test'){const s=push.device(ep,uid);if(!s)throw Error('Not subscribed');const r=await push.deliver(s,{title:'Reminders are on',body:'You will get a notification when a medicine is due.',tag:'meds-test',url:'/?p='+qProfile+'#episodes'},{ttl:300});return json(res,r.status>=200&&r.status<300?200:502,{ok:r.status>=200&&r.status<300,status:r.status})}
   throw Error('Unknown action');
  }catch(e){return fail(res,e)}
 }
 // Lab results: catalog of known markers (names, groups, aliases), and per-member reports.
 // The marker catalog as this profile's household sees it (defaults, private/markers.json, household markers).
 if(path==='/api/labs/catalog'&&req.method==='GET'){try{return json(res,200,{markers:labs.catalogFor(qProfile).markers.map(({name,group,aliases,unit,units,plausible,alt,custom})=>({name,group,aliases,unit,units,plausible,alt,...(custom?{custom:true}:{})}))})}catch(e){return fail(res,e)}}
 // Read-only duplicate check before saving values read from a report.
 if(path==='/api/labs/check'&&req.method==='POST'){
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
  if(limited('labs-check',120,600000))return json(res,429,{error:'Too many requests'});
  try{return json(res,200,labs.checkDuplicates(qProfile,JSON.parse(await readBody(req,65536))))}catch(e){return fail(res,e)}
 }
 if(path==='/api/labs'||path.startsWith('/api/labs/')){
  const id=path.split('/')[3];
  try{
   const view=()=>({...labs.series(qProfile),reports:labs.listReports(qProfile).map(({values,pending,...r})=>({...r,count:values.length,pendingCount:pending.length}))});
   if(req.method==='GET'&&!id)return json(res,200,view());
   if(!['POST','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('labs',120,600000))return json(res,429,{error:'Too many requests'});
   if(req.method==='POST'&&!id){const r=labs.addReport(qProfile,JSON.parse(await readBody(req,262144)));return json(res,201,{id:r.id,...view()})}
   if(req.method==='DELETE'&&id)return labs.deleteReport(qProfile,id)?json(res,200,{removed:true,...view()}):json(res,404,{error:'Report not found'});
   return json(res,404,{error:'Not found'});
  }catch(e){return fail(res,e)}
 }
 if(path==='/api/log'){
  if(req.method==='GET')return json(res,200,{metrics:hlog.METRICS,entries:hlog.list(qProfile)});
  if(req.method==='POST'){
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('log',300,600000))return json(res,429,{error:'Too many requests'});
   let b;try{b=JSON.parse(await readBody(req,65536))}catch{return json(res,400,{error:'Invalid JSON'})}
   if(b.delete)return json(res,200,{removed:hlog.remove(String(b.delete),qProfile)});
   const prof=hlog.profileOk(b.profile)?b.profile:qProfile;
   const items=(Array.isArray(b.entries)?b.entries:[]).slice(0,20);const saved=hlog.add(items,'manual',prof);
   return json(res,saved?200:422,{saved,error:saved?undefined:'No valid values. Check the numbers and date.'});
  }
  return json(res,405,{error:'Method not allowed'});
 }
 if(path==='/api/events'||path.startsWith('/api/events/')){
  const id=path.split('/')[3];
  try{
   if(req.method==='GET'&&!id)return json(res,200,{events:ev.listEvents(qProfile)});
   if(!['POST','PUT','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('events',300,600000))return json(res,429,{error:'Too many requests'});
   if(req.method==='POST'&&!id){const b=JSON.parse(await readBody(req,32768));return json(res,201,{event:ev.addEvent(qProfile,b)})}
   if(!id)return json(res,404,{error:'Not found'});
   if(req.method==='PUT'){const e=ev.updateEvent(qProfile,id,JSON.parse(await readBody(req,32768)));return e?json(res,200,{event:e}):json(res,404,{error:'Event not found'})}
   return ev.deleteEvent(qProfile,id)?json(res,200,{removed:true}):json(res,404,{error:'Event not found'});
  }catch(e){return fail(res,e)}
 }
 if(path==='/api/episodes'||path.startsWith('/api/episodes/')){
  const id=path.split('/')[3];
  try{
   if(req.method==='GET'&&!id)return json(res,200,{episodes:ev.listEpisodes(qProfile)});
   if(!['POST','PUT','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('episodes',200,600000))return json(res,429,{error:'Too many requests'});
   if(req.method==='POST'&&!id)return json(res,201,{episode:ev.addEpisode(qProfile,JSON.parse(await readBody(req,16384)))});
   if(!id)return json(res,404,{error:'Not found'});
   if(req.method==='PUT'){const e=ev.updateEpisode(qProfile,id,JSON.parse(await readBody(req,16384)));return e?json(res,200,{episode:e}):json(res,404,{error:'Episode not found'})}
   return ev.deleteEpisode(qProfile,id)?json(res,200,{removed:true}):json(res,404,{error:'Episode not found'});
  }catch(e){return fail(res,e)}
 }
 if(path==='/api/inbox'||path.startsWith('/api/inbox/')){
  const parts=path.split('/'),id=parts[3],isFile=parts[4]==='file';
  try{
   if(req.method==='GET'&&!id)return json(res,200,{items:ev.listInbox(qProfile)});
   if(req.method==='GET'&&id&&isFile){
    const f=await ev.inboxFile(qProfile,id);if(!f)return send(res,404,'Upload not found');
    res.writeHead(200,{...frameHeaders,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Content-Length':f.size,'Content-Type':f.mime});
    return blobs().stream(f.key).on('error',()=>res.destroy()).pipe(res);
   }
   if(!['POST','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('inbox',60,600000))return json(res,429,{error:'Too many requests'});
   if(req.method==='POST'&&!id){const b=JSON.parse(await readBody(req,ev.MAX_UPLOAD_BODY));return json(res,201,{item:await ev.addInbox(qProfile,b)})}
   if(req.method==='DELETE'&&id)return (await ev.deleteInbox(qProfile,id))?json(res,200,{removed:true}):json(res,404,{error:'Upload not found'});
   return json(res,404,{error:'Not found'});
  }catch(e){return fail(res,e)}
 }
 if(path==='/api/sync-info'&&req.method==='GET'&&!canWrite(hh.role))return json(res,403,{error:'Read-only access'});
 if(path==='/api/sync-info'&&req.method==='GET')return json(res,200,{endpoint:publicOrigin()+'/api/ingest',keys:ingest.keysFor(qProfile)});
 if(path==='/api/sync-info'&&req.method==='POST'){
  try{
   const b=JSON.parse(await readBody(req,4096)||'{}');
   if(b.action==='create')return json(res,200,{endpoint:publicOrigin()+'/api/ingest',token:ingest.createKey(qProfile,b.label,user.id)});
   if(b.action==='revoke')return ingest.revokeKey(qProfile,b.id)?json(res,200,{ok:true}):json(res,404,{error:'Not found'});
   throw Error('Unknown action');
  }catch(e){return fail(res,e)}
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'Method not allowed',{'Allow':'GET, HEAD'});
 // Instance settings and the member list for the client (names, kinds, colours; no health data).
 // Member colours as CSS (the CSP forbids inline styles): .pc-<id> sets --pc, body[data-profile=<id>] sets --member.
 if(path==='/members.css')return send(res,200,req.method==='HEAD'?'':members.list().map(m=>`.pc-${m.id}{--pc:${m.color||'#157667'}}body[data-profile=${m.id}]{--member:${m.color||'#157667'}}`).join('\n')+'\n',{'Content-Type':'text/css; charset=utf-8'});
 if(path==='/config.js'){const body='window.APP_CONFIG='+JSON.stringify({name:APP_NAME,timeZone:hs.timeZone,settings:{metrics:hs.metrics,units:hs.units},members:members.list(),user:{email:user.email,role:hh.role},authMode:auth.MODE}).replace(/</g,'\\u003c')+';\n';return send(res,200,req.method==='HEAD'?'':body,{'Content-Type':'text/javascript; charset=utf-8'})}
 return serveStatic(req,res,path);
}
