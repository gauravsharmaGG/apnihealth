// mailer.mjs against a local fake SMTP server: AUTH, envelope, headers, dot-stuffing and refusals.
import assert from 'node:assert/strict';
import {fakeSmtp} from './testlib.mjs';
const {sendMail,mailConfigured}=await import('./mailer.mjs');
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
}finally{s.close()}
