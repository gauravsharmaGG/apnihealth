// mailer.mjs against a local fake SMTP server (AUTH, envelope, headers, dot-stuffing, refusals) and a local fake
// Resend HTTP API (request shape, transport choice, error mapping without leaking the key).
import assert from 'node:assert/strict';
import http from 'node:http';
import {fakeSmtp} from './testlib.mjs';
delete process.env.RESEND_API_KEY;delete process.env.RESEND_API_URL;delete process.env.MAIL_FROM;delete process.env.SMTP_FROM;
const {sendMail,mailConfigured,mailTransport}=await import('./mailer.mjs');
const s=await fakeSmtp();
try{
 delete process.env.SMTP_URL;assert.equal(mailConfigured(),false);
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'}),/not configured/);
 const url=`smtp://user%40example.com:p%40ss@127.0.0.1:${s.port}`;
 await sendMail({to:'alex@example.com',subject:'Sign in to Exämple',text:'Line one\n.hidden dot line\nhttps://example.com/x'},{url,from:'Example <no-reply@example.com>'});
 const m=s.messages[0];
 assert.equal(m.auth,'\0user@example.com\0p@ss','AUTH PLAIN with decoded credentials');
 assert.equal(m.from,'<no-reply@example.com>');assert.equal(m.to,'<alex@example.com>');
 assert.match(m.data,/^Subject: =\?UTF-8\?B\?/m,'non-ASCII subject is encoded');assert.match(m.data,/^To: alex@example.com$/m);
 assert.match(m.data,/^\.\.hidden dot line$/m,'leading dots are stuffed');assert.match(m.data,/^Content-Type: text\/plain; charset=utf-8$/m);
 await assert.rejects(sendMail({to:'a@example.com\r\nBcc: x@example.com',subject:'x',text:'y'},{url}),/line break/,'no header injection');
 await assert.rejects(sendMail({to:'a@example.com',subject:'x\nBcc: y',text:'y'},{url}),/line break/);
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'},{url:'http://127.0.0.1:1'}),/smtp:\/\//);
 // a non-loopback server without STARTTLS is refused before any credentials are sent
 const remote=await fakeSmtp('127.0.0.2').catch(()=>null);
 if(remote){await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'},{url:`smtp://u:p@127.0.0.2:${remote.port}`}),/STARTTLS/);assert(!remote.log.some(l=>l.startsWith('AUTH')),'no credentials sent');remote.close()}
 console.log('PASS mailer: AUTH PLAIN, envelope, encoded subject, dot-stuffing, header-injection guard, STARTTLS required off loopback'+(remote?'':' (127.0.0.2 unavailable: skipped)')+'.');
}catch(e){s.close();throw e}

// ---- Resend HTTP API ----
const KEY='re_test_'+'k'.repeat(24);
const fake={reqs:[],reply:{status:200,body:'{"id":"email-1"}'}};
const api=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{fake.reqs.push({method:req.method,url:req.url,headers:req.headers,body:b});res.writeHead(fake.reply.status,{'content-type':'application/json'});res.end(fake.reply.body)})});
await new Promise(ok=>api.listen(0,'127.0.0.1',ok));
const endpoint=`http://127.0.0.1:${api.address().port}/emails`;
try{
 process.env.RESEND_API_URL=endpoint;
 // transport choice: Resend wins over SMTP; either one makes mail "configured"
 process.env.RESEND_API_KEY=KEY;assert.equal(mailTransport(),'resend');assert.equal(mailConfigured(),true);
 process.env.SMTP_URL='smtp://u:p@127.0.0.1:1';assert.equal(mailTransport(),'resend','RESEND_API_KEY wins over SMTP_URL');
 delete process.env.RESEND_API_KEY;assert.equal(mailTransport(),'smtp');delete process.env.SMTP_URL;assert.equal(mailTransport(),null);
 process.env.RESEND_API_KEY=KEY;process.env.SMTP_URL='smtp://u:p@127.0.0.1:1';
 process.env.MAIL_FROM='Exämple Health <no-reply@example.com>';
 const r=await sendMail({to:'alex@example.com',subject:'Sign in to Exämple',text:'Line one\n.dot line\nhttps://example.com/x'});
 assert.deepEqual(r,{id:'email-1'});
 assert.equal(fake.reqs.length,1,'one HTTP request, SMTP not used');
 const q=fake.reqs[0],j=JSON.parse(q.body);
 assert.equal(q.method,'POST');assert.equal(q.url,'/emails');
 assert.equal(q.headers.authorization,'Bearer '+KEY);assert.match(q.headers['content-type'],/^application\/json/);
 assert.deepEqual(j,{from:'Exämple Health <no-reply@example.com>',to:['alex@example.com'],subject:'Sign in to Exämple',text:'Line one\n.dot line\nhttps://example.com/x',headers:{'Auto-Submitted':'auto-generated'}},'plain text body sent as is (no SMTP dot-stuffing)');
 // SMTP_FROM still works as the sender when MAIL_FROM is not set
 delete process.env.MAIL_FROM;process.env.SMTP_FROM='Old <old@example.com>';
 await sendMail({to:'a@example.com',subject:'x',text:'y'});assert.equal(JSON.parse(fake.reqs[1].body).from,'Old <old@example.com>');
 // explicit options override the environment (an SMTP url in opts means SMTP even with RESEND_API_KEY set)
 await sendMail({to:'a@example.com',subject:'x',text:'y'},{from:'Opt <opt@example.com>'});assert.equal(JSON.parse(fake.reqs[2].body).from,'Opt <opt@example.com>');
 const n=fake.reqs.length;
 await sendMail({to:'alex@example.com',subject:'via smtp',text:'y'},{url:`smtp://u:p@127.0.0.1:${s.port}`});
 assert.equal(fake.reqs.length,n,'opts.url forces SMTP');assert(s.messages.some(m=>/via smtp/.test(m.data)));
 // header injection is refused before any request
 await assert.rejects(sendMail({to:'a@example.com\r\nBcc: x@example.com',subject:'x',text:'y'}),/line break/);
 await assert.rejects(sendMail({to:'a@example.com',subject:'x\nBcc: y',text:'y'}),/line break/);
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'},{from:'A <a@example.com>\nBcc: z'}),/line break/);
 assert.equal(fake.reqs.length,n,'nothing sent for refused messages');
 // API errors: status and Resend's error name/message, never the key
 fake.reply={status:422,body:JSON.stringify({statusCode:422,name:'validation_error',message:'The from domain is not verified'})};
 const e=await sendMail({to:'a@example.com',subject:'x',text:'y'}).then(()=>null,e=>e);
 assert(e,'422 rejects');assert.match(e.message,/^Resend refused: 422 validation_error: The from domain is not verified$/);assert(!e.message.includes(KEY));
 fake.reply={status:500,body:'<html>oops</html>'};
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'}),/^Error: Resend refused: 500$/);
 // https is required except for a loopback test endpoint; network errors do not echo the key or URL
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'},{endpoint:'http://api.example.com/emails'}),/https/);
 const dead=await sendMail({to:'a@example.com',subject:'x',text:'y'},{endpoint:'http://127.0.0.1:1/emails'}).then(()=>null,e=>e);
 assert.match(dead.message,/^Resend request failed: /);assert(!dead.message.includes(KEY));
 // the timeout applies
 const slow=http.createServer(()=>{});await new Promise(ok=>slow.listen(0,'127.0.0.1',ok));
 await assert.rejects(sendMail({to:'a@example.com',subject:'x',text:'y'},{endpoint:`http://127.0.0.1:${slow.address().port}/emails`,timeout:200}),/timeout/);
 slow.closeAllConnections();slow.close();
 console.log('PASS mailer (Resend): HTTP request shape, RESEND_API_KEY wins over SMTP_URL, MAIL_FROM/SMTP_FROM sender, option overrides, header-injection guard, error mapping without the key, https only, timeout.');
}finally{api.close();s.close();for(const k of ['RESEND_API_KEY','RESEND_API_URL','SMTP_URL','MAIL_FROM','SMTP_FROM'])delete process.env[k]}
