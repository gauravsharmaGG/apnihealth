// Instance settings from the process environment (see .env.example).
export const PORT=Number(process.env.PORT||4174);
// Public hostname the app is served on behind a TLS proxy, e.g. health.example.com. Empty: localhost only.
export const APP_HOST=String(process.env.APP_HOST||'').trim().toLowerCase();
export const APP_NAME=String(process.env.APP_NAME||'ApniHealth').trim().slice(0,40)||'ApniHealth';
// Time zone used for medicine schedules, reminders and calendar exports.
export const TIME_ZONE=process.env.APP_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export const publicOrigin=()=>APP_HOST?'https://'+APP_HOST:`http://localhost:${PORT}`;
