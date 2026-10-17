// Shared helpers for the tests (fictional data only). Not loaded by the app.
import net from 'node:net';
// A tiny SMTP server for tests: records each message; advertises AUTH, never STARTTLS.
export function fakeSmtp(host='127.0.0.1'){
 const messages=[],log=[];
 const server=net.createServer(sock=>{
  sock.setEncoding('utf8');let buf='',data=null,msg={};
  const say=l=>sock.write(l+'\r\n');say('220 fake ESMTP');
  sock.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);
   if(data!==null){if(line==='.'){msg.data=data.join('\n');messages.push(msg);msg={};data=null;say('250 queued')}else data.push(line);continue}
   log.push(line.startsWith('AUTH')?'AUTH ***':line);
   if(/^EHLO/i.test(line)){say('250-fake');say('250 AUTH PLAIN')}
   else if(/^AUTH PLAIN /i.test(line)){msg.auth=Buffer.from(line.slice(11),'base64').toString();say('235 ok')}
   else if(/^MAIL FROM:/i.test(line)){msg.from=line.slice(10);say('250 ok')}
   else if(/^RCPT TO:/i.test(line)){msg.to=line.slice(8);say('250 ok')}
   else if(/^DATA/i.test(line)){data=[];say('354 go')}
   else if(/^QUIT/i.test(line)){say('221 bye');sock.end()}
   else say('502 no')}});
  sock.on('error',()=>{});
 });
 return new Promise(ok=>server.listen(0,host,()=>ok({port:server.address().port,host,messages,log,close:()=>server.close()})));
}
// Waits until fn() returns a truthy value (polling), or throws after ms.
export async function until(fn,ms=5000,what='condition'){const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw Error('timed out waiting for '+what);await new Promise(r=>setTimeout(r,50))}}
