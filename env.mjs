// Instance settings from the process environment (see .env.example).
export const PORT=Number(process.env.PORT||4174);
// Public hostname the app is served on behind a TLS proxy, e.g. health.example.com. Empty: localhost only.
export const APP_HOST=String(process.env.APP_HOST||'').trim().toLowerCase();
// Optional notice shown on every page of a demo or test instance, e.g. "Demo: data may be wiped. Do not enter real health data."
export const DEMO_NOTICE=String(process.env.DEMO_NOTICE||'').replace(/\s+/g,' ').trim().slice(0,300);
export const APP_NAME=String(process.env.APP_NAME||'ApniHealth').trim().slice(0,40)||'ApniHealth';
// Time zone used for medicine schedules, reminders and calendar exports.
export const TIME_ZONE=process.env.APP_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
// Households choose their own zone (settings.mjs); code that needs "the" zone calls zone(), which returns the zone
// of the household being served (inZone) and falls back to TIME_ZONE.
import {AsyncLocalStorage} from 'node:async_hooks';
const zoneCtx=new AsyncLocalStorage();
export const zone=()=>zoneCtx.getStore()||TIME_ZONE;
export const inZone=(tz,fn)=>tz?zoneCtx.run(tz,fn):fn();
export const validZone=z=>{if(typeof z!=='string'||!z||z.length>64)return false;try{new Intl.DateTimeFormat('en',{timeZone:z});return true}catch{return false}};
export const publicOrigin=()=>APP_HOST?'https://'+APP_HOST:`http://localhost:${PORT}`;
