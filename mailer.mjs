// Outgoing email for sign-in links and invites, with two transports:
// - Resend HTTP API (RESEND_API_KEY): one HTTPS POST with fetch, so it also works where raw sockets are not
//   available (Cloudflare Workers). RESEND_API_URL overrides the endpoint (tests; plain http only to loopback).
// - SMTP (SMTP_URL), a minimal client on node:net/node:tls:
//   smtps://user:pass@host:465 (implicit TLS) or smtp://user:pass@host:587 (STARTTLS is required).
//   Plain, unencrypted SMTP is accepted only to a loopback address (a local relay or a test server).
// RESEND_API_KEY wins when both are set. MAIL_FROM (or SMTP_FROM) is the sender, e.g. "ApniHealth <health@example.com>".
// With neither transport, nothing is sent and mailConfigured() is false (the server then prints sign-in links to
// its log, for development).
import {randomBytes} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
const caFile=process.env.CA_BUNDLE||['/etc/ssl/cert.pem','/etc/ssl/certs/ca-certificates.crt'].find(f=>existsSync(f));
export const mailTransport=()=>process.env.RESEND_API_KEY?'resend':process.env.SMTP_URL?'smtp':null;
export const mailConfigured=()=>!!mailTransport();
const defaultFrom=()=>process.env.MAIL_FROM||process.env.SMTP_FROM||('no-reply@'+(process.env.APP_HOST||'localhost'));
const noCrlf=(v,label)=>{if(/[\r\n]/.test(String(v)))throw Error(label+' contains a line break');return String(v)};
const loopback=h=>h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='[::1]';
const encodeHeader=v=>/^[\x20-\x7e]*$/.test(v)?v:'=?UTF-8?B?'+Buffer.from(v).toString('base64')+'?=';
const addr=v=>{const m=/<([^<>\s]+@[^<>\s]+)>\s*$/.exec(v);return m?m[1]:v.trim()};

function client(socket){
 let buf='',waiting=null;const lines=[];
 const pump=()=>{if(!waiting)return;const i=lines.findIndex(l=>/^\d{3} /.test(l));if(i<0)return;const reply=lines.splice(0,i+1);const w=waiting;waiting=null;w.ok({code:Number(reply.at(-1).slice(0,3)),text:reply.join('\n')})};
 const onData=d=>{buf+=d;let i;while((i=buf.indexOf('\r\n'))>=0){lines.push(buf.slice(0,i));buf=buf.slice(i+2)}pump()};
 const attach=s=>{s.setEncoding('utf8');s.on('data',onData)};attach(socket);
 return {
  read:()=>new Promise((ok,no)=>{waiting={ok,no};pump()}),
  async cmd(line,expect){if(line!==null)this.sock.write(line+'\r\n');const r=await this.read();if(!expect.includes(r.code))throw Error('SMTP server refused: '+r.code);return r},
  sock:socket,
  upgrade(s){socket.removeListener('data',onData);this.sock=s;attach(s)},
 };
}

// Sends one plain-text email. Options override the environment: {apiKey} (Resend) or {url} (SMTP), {from}, {timeout}.
export async function sendMail(msg,opts={}){
 const apiKey=opts.apiKey??(opts.url?null:process.env.RESEND_API_KEY);
 if(apiKey)return sendResend(msg,{...opts,apiKey});
 const url=opts.url??process.env.SMTP_URL;
 if(!url)throw Error('Email is not configured (set RESEND_API_KEY or SMTP_URL)');
 return sendSmtp(msg,{...opts,url});
}

const RESEND_URL='https://api.resend.com/emails';
async function sendResend({to,subject,text},{apiKey,from=defaultFrom(),timeout=20000,endpoint=process.env.RESEND_API_URL||RESEND_URL}){
 const u=new URL(endpoint);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&loopback(u.hostname)))throw Error('RESEND_API_URL must use https://');
 noCrlf(from,'MAIL_FROM');noCrlf(to,'Recipient');noCrlf(subject,'Subject');noCrlf(apiKey,'RESEND_API_KEY');
 let res;
 try{
  res=await fetch(u,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeout),
   headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json','User-Agent':'ApniHealth'},
   body:JSON.stringify({from,to:[to],subject,text:String(text),headers:{'Auto-Submitted':'auto-generated'}})});
 }catch(e){throw Error('Resend request failed: '+(e?.name==='TimeoutError'?'timeout':'network error'))}
 // The error text names the status and Resend's own error name/message only; never the key or the request.
 const body=await res.text().catch(()=>'');
 if(!res.ok){let why='';try{const j=JSON.parse(body);why=[j.name,j.message].filter(v=>typeof v==='string').join(': ').slice(0,200)}catch{}throw Error('Resend refused: '+res.status+(why?' '+why:''))}
 try{return {id:JSON.parse(body).id}}catch{return {}}
}

async function sendSmtp({to,subject,text},{url,from=defaultFrom(),timeout=20000}){
 const [{default:net},{default:tls}]=await Promise.all([import('node:net'),import('node:tls')]);
 const u=new URL(url),host=u.hostname,implicit=u.protocol==='smtps:';
 if(!implicit&&u.protocol!=='smtp:')throw Error('SMTP_URL must start with smtp:// or smtps://');
 const port=Number(u.port||(implicit?465:587));
 const sender=noCrlf(from,'SMTP_FROM');
 noCrlf(to,'Recipient');noCrlf(subject,'Subject');
 const tlsOpts={servername:host,...(caFile?{ca:readFileSync(caFile)}:{}),minVersion:'TLSv1.2'};
 const socket=implicit?tls.connect({host,port,...tlsOpts}):net.connect({host,port});
 socket.setTimeout(timeout,()=>socket.destroy(Error('SMTP timeout')));
 const failed=new Promise((_,no)=>socket.once('error',no));
 const run=async()=>{
  await new Promise((ok,no)=>{socket.once(implicit?'secureConnect':'connect',ok);socket.once('error',no)});
  const c=client(socket);
  await c.cmd(null,[220]);
  const ehlo=async()=>(await c.cmd('EHLO '+(process.env.APP_HOST||'localhost'),[250])).text;
  let caps=await ehlo();
  if(!implicit){
   if(/STARTTLS/i.test(caps)){
    await c.cmd('STARTTLS',[220]);
    const secure=tls.connect({socket:c.sock,...tlsOpts});
    await new Promise((ok,no)=>{secure.once('secureConnect',ok);secure.once('error',no)});
    c.upgrade(secure);caps=await ehlo();
   }else if(!loopback(host))throw Error('The SMTP server does not offer STARTTLS; refusing to send unencrypted');
  }
  if(u.username){
   const user=decodeURIComponent(u.username),pass=decodeURIComponent(u.password);
   await c.cmd('AUTH PLAIN '+Buffer.from('\0'+user+'\0'+pass).toString('base64'),[235]);
  }
  await c.cmd('MAIL FROM:<'+addr(sender)+'>',[250]);
  await c.cmd('RCPT TO:<'+addr(to)+'>',[250,251]);
  await c.cmd('DATA',[354]);
  const domain=addr(sender).split('@')[1]||'localhost';
  const msg=['From: '+sender,'To: '+to,'Subject: '+encodeHeader(subject),'Date: '+new Date().toUTCString(),'Message-ID: <'+randomBytes(12).toString('hex')+'@'+domain+'>',
   'MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: 8bit','Auto-Submitted: auto-generated','',
   ...String(text).replace(/\r?\n/g,'\n').split('\n').map(l=>l.startsWith('.')?'.'+l:l)].join('\r\n');
  await c.cmd(msg+'\r\n.',[250]);
  await c.cmd('QUIT',[221]).catch(()=>{});
  c.sock.end();
 };
 try{await Promise.race([run(),failed])}finally{socket.destroy()}
}
