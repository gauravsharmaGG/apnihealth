// Periodic jobs in one place, so they can run from a timer (Node: startScheduler) or from a Cron Trigger
// (Cloudflare Workers: call runScheduled(event.scheduledTime) from scheduled(), e.g. every minute).
// - purge of expired sessions, sign-in links and passkey challenges: at most once per PURGE_EVERY
// - medicine and appointment reminders (push.tick), unless NO_PUSH is set
// A run never throws; errors come back in `errors`. Runs do not overlap: a call while one is in progress
// returns {skipped:true} (a slow push service must not stack up ticks).
import * as A from './accounts.mjs';
import * as push from './push.mjs';
import {runAs,SYSTEM} from './store.mjs';
export const PURGE_EVERY=36e5;
let lastPurge=0,running=false;
export async function runScheduled(now=Date.now(),{push:sendPush=!process.env.NO_PUSH,send}={}){
 if(running)return {skipped:true};
 running=true;
 const out={purged:false,pushed:0,errors:[]};
 try{
  if(now-lastPurge>=PURGE_EVERY){try{runAs(SYSTEM,()=>A.purgeExpired(now));lastPurge=now;out.purged=true}catch(e){out.errors.push('purge: '+e.message)}}
  if(sendPush){try{out.pushed=await runAs(SYSTEM,()=>push.tick(now,send))||0}catch(e){out.errors.push('push: '+e.message)}}
 }finally{running=false}
 return out;
}
// Node: one timer for everything (reminders have 30-second granularity here; on Workers the cron interval decides).
export function startScheduler(every=30000){
 const t=setInterval(()=>runScheduled().then(r=>{for(const e of r.errors||[])console.error('scheduler',e)}),every);
 t.unref?.();return t;
}
// Tests only: forget when the last purge ran.
export const resetScheduler=()=>{lastPurge=0;running=false};
