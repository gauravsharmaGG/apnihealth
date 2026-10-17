import http from 'node:http';
import {readFileSync,createReadStream,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorized} from './access.mjs';
import * as hlog from './log.mjs';
import * as ev from './events.mjs';
import * as meds from './medicines.mjs';
import * as push from './push.mjs';
import * as appts from './appointments.mjs';
import * as members from './members.mjs';
import * as labs from './labs.mjs';
import {PORT,APP_HOST,APP_NAME,TIME_ZONE,publicOrigin} from './env.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const pub=resolve(root,'public'),port=PORT;
members.load(); // fail fast at startup when the database has no members (the error says how to add them)
labs.catalog(); // and when the marker catalog (config/markers.default.json + private/markers.json) is invalid
const headers={'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const frameHeaders={...headers,'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':headers['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'")};
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
function readBody(req,limit=1048576){return new Promise((ok,no)=>{let b='',n=0;req.on('data',c=>{n+=c.length;if(n>limit){no(Error('too large'));req.destroy()}else b+=c});req.on('end',()=>ok(b));req.on('error',no)})}
const json=(res,status,obj)=>send(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8'});
const hits=new Map();function limited(key,max,windowMs){const now=Date.now(),a=(hits.get(key)||[]).filter(t=>now-t<windowMs);a.push(now);hits.set(key,a);return a.length>max}
const allowed=new Set([...(APP_HOST?[APP_HOST]:[]),`127.0.0.1:${port}`,`localhost:${port}`]);
function send(res,status,body='',extra={}){res.writeHead(status,{...headers,'Content-Type':'text/html; charset=utf-8',...extra});res.end(body)}
function sameOrigin(req){
 const scheme=APP_HOST&&req.headers.host===APP_HOST?'https':'http';
 const expected=`${scheme}://${req.headers.host}`;
 const origin=req.headers.origin,site=req.headers['sec-fetch-site'];
 if(site==='cross-site'||site==='same-site')return false;
 if(origin===expected)return true;
 // Some browsers omit or null the Origin of form POSTs under privacy policies.
 // Browser-controlled Fetch Metadata still proves an exact same-origin request.
 // Never accept an explicit foreign origin or a request lacking both signals.
 return (!origin||origin==='null')&&site==='same-origin';
}
const server=http.createServer(async(req,res)=>{try{
 if(!allowed.has(req.headers.host))return send(res,400,'Invalid host');
 if(APP_HOST&&req.headers.host===APP_HOST && req.headers['x-forwarded-proto']!=='https')return send(res,308,'',{Location:publicOrigin()+'/'});
 const reqUrl=new URL(req.url,'http://localhost'),path=decodeURIComponent(reqUrl.pathname);
 const qProfile=reqUrl.searchParams.get('profile')||members.defaultId();
 // Write-only Apple Health / Shortcuts endpoint with its own bearer token (Cloudflare Access must bypass this one path).
 if(path==='/api/ingest'){
  if(req.method!=='POST')return json(res,405,{error:'POST only'});
  if(limited('ingest',120,600000))return json(res,429,{error:'Too many requests'});
  const m=/^Bearer (.+)$/.exec(req.headers.authorization||'');
  if(!m||!hlog.tokenOk(m[1]))return json(res,401,{error:'Invalid token'});
  let body;try{body=JSON.parse(await readBody(req))}catch{return json(res,400,{error:'Invalid JSON'})}
  const prof=hlog.profileOk(body.profile)?body.profile:(reqUrl.searchParams.has('profile')&&hlog.profileOk(qProfile)?qProfile:members.defaultId());const entries=hlog.parseIngest(body);return json(res,200,{received:entries.length,saved:hlog.add(entries,'apple-health',prof)});
 }
 if(!await authorized(req))return send(res,403,'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Sign-in required</title><h1>Sign-in required</h1><p><a href="/">Open your private health record</a></p></html>');
 if(path==='/logout'&&req.method==='POST'){if(!sameOrigin(req))return send(res,403,'Origin rejected');return send(res,303,'',{Location:process.env.LOGOUT_URL||'/cdn-cgi/access/logout'})}
 if(path.startsWith('/api/')&&!hlog.profileOk(qProfile))return json(res,400,{error:'Unknown profile'});
 if(path==='/api/medicines'){
  try{
   const view=()=>meds.list(qProfile).filter(p=>ev.listEpisodes(qProfile).some(e=>e.id===p.episodeId)).map(p=>({...p,slots:meds.slots(p),effs:meds.effective(p)}));
   if(req.method==='GET')return json(res,200,{plans:view()});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('medicines',300,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,65536));meds.mutate(qProfile,b);return json(res,200,{plans:view()});
  }catch(e){return json(res,400,{error:e.message})}
 }

 if(path==='/api/import'){
  try{
   if(req.method!=='POST')return json(res,405,{error:'POST only'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('import',60,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,4*1024*1024));if(!Array.isArray(b.entries)||b.entries.length>60000)throw Error('Send at most 60,000 values at a time');
   const saved=hlog.add(hlog.parseIngest({entries:b.entries}),'apple-health',qProfile);return json(res,200,{received:b.entries.length,saved});
  }catch(e){return json(res,400,{error:e.message})}
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
  }catch(e){return json(res,400,{error:e.message})}
 }

 if(path==='/api/push'){
  try{
   if(req.method==='GET')return json(res,200,{publicKey:push.publicKey()});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('push',120,600000))return json(res,429,{error:'Too many requests'});
   const b=JSON.parse(await readBody(req,16384)),ep=b.endpoint||b.subscription?.endpoint;
   const topic=b.topic==='appointments'?'appointments':'medicine';
   if(b.action==='subscribe')return json(res,200,push.subscribe(b.subscription,qProfile,Date.now(),topic));
   if(typeof ep!=='string')throw Error('Missing endpoint');
   if(b.action==='unsubscribe')return json(res,200,push.unsubscribe(ep,qProfile,topic));
   if(b.action==='status')return json(res,200,push.status(ep,qProfile));
   if(b.action==='summary')return json(res,200,push.summary(ep));
   if(b.action==='unsubscribe-all')return json(res,200,push.unsubscribe(ep));
   if(b.action==='mute')return json(res,200,push.mute(ep,String(b.planId),b.muted===true));
   if(b.action==='test'){const s=push.subs().find(x=>x.endpoint===ep);if(!s)throw Error('Not subscribed');const r=await push.deliver(s,{title:'Reminders are on',body:'You will get a notification when a medicine is due.',tag:'meds-test',url:'/?p='+qProfile+'#episodes'},{ttl:300});return json(res,r.status>=200&&r.status<300?200:502,{ok:r.status>=200&&r.status<300,status:r.status})}
   throw Error('Unknown action');
  }catch(e){return json(res,400,{error:e.message})}
 }
 // Lab results: catalog of known markers (names, groups, aliases), and per-member reports.
 if(path==='/api/labs/catalog'&&req.method==='GET')return json(res,200,{markers:labs.catalog().markers.map(({name,group,aliases})=>({name,group,aliases}))});
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
  }catch(e){return json(res,400,{error:e.message||'Invalid request'})}
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
  }catch(e){return json(res,400,{error:e.message||'Invalid request'})}
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
  }catch(e){return json(res,400,{error:e.message||'Invalid request'})}
 }
 if(path==='/api/inbox'||path.startsWith('/api/inbox/')){
  const parts=path.split('/'),id=parts[3],isFile=parts[4]==='file';
  try{
   if(req.method==='GET'&&!id)return json(res,200,{items:ev.listInbox(qProfile)});
   if(req.method==='GET'&&id&&isFile){
    const f=ev.inboxFile(qProfile,id);if(!f)return send(res,404,'Upload not found');
    res.writeHead(200,{...frameHeaders,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Content-Length':f.size,'Content-Type':f.mime});
    return ev.createReadStream(f.path).on('error',()=>res.destroy()).pipe(res);
   }
   if(!['POST','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
   if(!sameOrigin(req))return json(res,403,{error:'Origin rejected'});
   if(limited('inbox',60,600000))return json(res,429,{error:'Too many requests'});
   if(req.method==='POST'&&!id){const b=JSON.parse(await readBody(req,ev.MAX_UPLOAD_BODY));return json(res,201,{item:ev.addInbox(qProfile,b)})}
   if(req.method==='DELETE'&&id)return ev.deleteInbox(qProfile,id)?json(res,200,{removed:true}):json(res,404,{error:'Upload not found'});
   return json(res,404,{error:'Not found'});
  }catch(e){return json(res,400,{error:e.message||'Invalid request'})}
 }
 if(path==='/api/sync-info'&&req.method==='GET')return json(res,200,{token:hlog.token(),endpoint:publicOrigin()+'/api/ingest?profile='+qProfile});
 if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'Method not allowed',{'Allow':'GET, HEAD'});
 if(path==='/login')return send(res,303,'',{Location:'/'});
 // Instance settings and the member list for the client (names, kinds, colours; no health data).
 // Member colours as CSS (the CSP forbids inline styles): .pc-<id> sets --pc, body[data-profile=<id>] sets --member.
 if(path==='/members.css')return send(res,200,req.method==='HEAD'?'':members.list().map(m=>`.pc-${m.id}{--pc:${m.color||'#157667'}}body[data-profile=${m.id}]{--member:${m.color||'#157667'}}`).join('\n')+'\n',{'Content-Type':'text/css; charset=utf-8'});
 if(path==='/config.js'){const body='window.APP_CONFIG='+JSON.stringify({name:APP_NAME,timeZone:TIME_ZONE,members:members.list()}).replace(/</g,'\\u003c')+';\n';return send(res,200,req.method==='HEAD'?'':body,{'Content-Type':'text/javascript; charset=utf-8'})}
 const file=resolve(pub,'.'+(path==='/'?'/index.html':path));
 if(!file.startsWith(pub+'/') || path.includes('\0'))return send(res,404,'Not found');
 let stat;try{stat=statSync(file)}catch{return send(res,404,'Not found')};if(!stat.isFile()||!mime[extname(file)])return send(res,404,'Not found');
 res.writeHead(200,{...(path.startsWith('/records/')?frameHeaders:headers),'Content-Type':mime[extname(file)],'Content-Length':stat.size});if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
 }catch{if(!res.headersSent)send(res,400,'Unable to process request');else res.destroy()}});
server.listen(port,'127.0.0.1',()=>{console.log(`${APP_NAME} listening on 127.0.0.1:${port}`);if(!process.env.NO_PUSH)push.start()});
