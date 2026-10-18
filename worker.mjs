// Cloudflare Workers entry point (plan: docs/plans/workers-d1.md, SQLite in a Durable Object). Node uses server.mjs.
//
// The Worker is a thin front: every request goes to ONE Durable Object ("instance"), which owns the SQLite
// database (ctx.storage.sql, synchronous, so the data modules run unchanged) and runs the same app handler as Node
// through cloudflare:node's httpServerHandler. Uploads go to R2 (env.BLOBS), static files come from the assets
// binding (env.ASSETS, run_worker_first so the auth checks and headers still apply), and a Cron Trigger calls
// runScheduled() every minute. Configuration comes from wrangler.toml vars and secrets via process.env.
import {DurableObject} from 'cloudflare:workers';
import {httpServerHandler} from 'cloudflare:node';
import http from 'node:http';
import {doAdapter} from './sqladapter.mjs';
import {migrate,useDatabase} from './db.mjs';
import {setBlobs} from './blobs.mjs';
import {r2Blobs,assetFiles} from './workers-backends.mjs';

const INTERNAL_PORT=8080; // the in-isolate port httpServerHandler routes to (nothing listens on the network)

// The instance Durable Object, in the EU jurisdiction unless DO_JURISDICTION is "none" (local tests only).
function instance(env){
 const ns=env.DO_JURISDICTION==='none'?env.APP:env.APP.jurisdiction(env.DO_JURISDICTION||'eu');
 return ns.get(ns.idFromName('instance'));
}

export default {
 // Forwarded with x-forwarded-proto set from the real request URL (Cloudflare terminates TLS), replacing any
 // client-sent forwarding headers; the app trusts it for APP_HOST like it trusts the tunnel on Node.
 async fetch(request,env){
  const headers=new Headers(request.headers);
  for(const h of ['x-forwarded-proto','x-forwarded-for','x-forwarded-host','forwarded'])headers.delete(h);
  headers.set('x-forwarded-proto',new URL(request.url).protocol.slice(0,-1));
  return instance(env).fetch(new Request(request,{headers}));
 },
 async scheduled(controller,env,ctx){
  ctx.waitUntil(instance(env).scheduled(controller.scheduledTime).then(r=>{if(r?.errors?.length)console.error('scheduled:',r.errors.join('; '))}));
 },
};

export class ApniHealth extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  // Nothing is served until the database is migrated and the backends are installed.
  ctx.blockConcurrencyWhile(async()=>{
   if(!env.BLOBS)throw Error('The R2 binding BLOBS is missing');
   if(!env.ASSETS)throw Error('The assets binding ASSETS is missing');
   const d=doAdapter(ctx.storage);migrate(d);useDatabase(d);
   setBlobs(r2Blobs(env.BLOBS));
   const app=await import('./app.mjs'); // after useDatabase: app modules read config and may query at startup
   app.setStaticFiles(assetFiles(env.ASSETS));
   app.startup({legacyImport:false});
   http.createServer(app.handler).listen(INTERNAL_PORT);
   this.http=httpServerHandler({port:INTERNAL_PORT});
  });
 }
 fetch(request){return this.http.fetch(request,this.env,this.ctx)}
 // Called by the Worker's Cron Trigger (RPC): expired-session purge (hourly) and due reminders.
 async scheduled(time){const {runScheduled}=await import('./scheduler.mjs');return runScheduled(time)}
}
