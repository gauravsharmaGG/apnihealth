// Node entry point: runs the app (app.mjs) on 127.0.0.1:$PORT and the background jobs on one timer.
// Cloudflare Workers use worker.mjs instead.
import http from 'node:http';
import {startup,handler} from './app.mjs';
import {startScheduler} from './scheduler.mjs';
import {PORT,APP_NAME} from './env.mjs';
startup();
// Background jobs (expired-session purge, reminders unless NO_PUSH) run on one timer; see scheduler.mjs.
http.createServer(handler).listen(PORT,'127.0.0.1',()=>{console.log(`${APP_NAME} listening on 127.0.0.1:${PORT}`);startScheduler()});
