// Who is making a request. Two modes (AUTH_MODE):
//   builtin (default)  users sign in with a one-time email link (passkeys follow); a server-side session is kept
//                      in an HttpOnly, SameSite=Lax cookie (Secure and __Host- prefixed behind TLS).
//   trusted-proxy      Cloudflare Access or a compatible proxy authenticates; access.mjs verifies its signed JWT and
//                      the allowed email is mapped to a user (created on first sight, see provision()).
// CSRF: every state-changing request must pass the same-origin check in server.mjs (sameOrigin), and the session
// cookie is SameSite=Lax. Auth endpoints are rate limited.
import * as access from './access.mjs';
import * as A from './accounts.mjs';
import {households,system,transaction} from './store.mjs';
import {sendMail,mailConfigured} from './mailer.mjs';
import {APP_NAME} from './env.mjs';
import {send,json,readForm,limited,esc,secureRequest,requestOrigin} from './http.mjs';

export function authMode(env=process.env){
 const m=env.AUTH_MODE;
 if(!m){
  if(env.CF_ACCESS_ISSUER)throw Error('CF_ACCESS_ISSUER is set but AUTH_MODE is not. Set AUTH_MODE=trusted-proxy to keep using Cloudflare Access, or AUTH_MODE=builtin for built-in sign-in.');
  return 'builtin';
 }
 if(m!=='builtin'&&m!=='trusted-proxy')throw Error('AUTH_MODE must be "builtin" or "trusted-proxy"');
 return m;
}
export const MODE=authMode();

// ---- cookies ----
const cookieName=req=>secureRequest(req)?'__Host-apni_session':'apni_session';
function readCookie(req,name){
 for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim()}
 return null;
}
const sessionCookie=(req,value,maxAge)=>`${cookieName(req)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureRequest(req)?'; Secure':''}`;
export const sessionToken=req=>readCookie(req,cookieName(req));

// ---- trusted proxy: map an allowed email to a user ----
// A new user joins the oldest household: as owner if it has no owner yet, otherwise as TRUSTED_PROXY_ROLE (editor).
export function provision(email){
 const d=system();
 return transaction(d,()=>{
  const existing=A.userByEmail(email);if(existing)return existing;
  const u=A.createUser(email),h=households()[0];
  if(h){
   const hasOwner=d.prepare("SELECT 1 FROM memberships WHERE household_id=? AND role='owner'").get(h.id);
   const role=hasOwner?(['editor','viewer'].includes(process.env.TRUSTED_PROXY_ROLE)?process.env.TRUSTED_PROXY_ROLE:'editor'):'owner';
   A.setMembership(h.id,u.id,role);
  }
  return u;
 });
}

// The signed-in user for a request, or null.
export async function authenticate(req){
 if(MODE==='trusted-proxy'){const email=await access.verifiedEmail(req);return email?(A.userByEmail(email)||provision(email)):null}
 return A.sessionUser(sessionToken(req));
}

// Paths a signed-out browser may load in builtin mode (the sign-in page and what it needs).
export const PUBLIC_PATHS=new Set(['/login','/style.css','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest']);

// ---- pages ----
export function page(title,body,status=200){
 return [status,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(APP_NAME)}</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/icon-192.png"></head><body class="auth-page"><main class="auth-card"><p class="eyebrow">${esc(APP_NAME)}</p>${body}</main></body></html>`];
}
const sendPage=(res,[status,html],extra)=>send(res,status,html,extra);
function loginPage(msg='',error=''){
 return page('Sign in',`<h1>Sign in</h1>${msg?`<p class="auth-msg" role="status">${esc(msg)}</p>`:''}${error?`<p class="auth-error" role="alert">${esc(error)}</p>`:''}
<form method="post" action="/auth/email" class="auth-form"><label class="field">Email<input type="email" name="email" autocomplete="username email" required maxlength="254"></label><button class="primary" type="submit">Email me a sign-in link</button></form>
<p class="muted">The link works once and expires in ${A.LINK_MINUTES} minutes. No account? Ask the person who runs this app for an invite.</p>`);
}

// Handles the sign-in routes; returns true when it answered the request.
export async function handle(req,res,path,url){
 if(path==='/logout'&&req.method==='POST'){
  if(MODE==='trusted-proxy')return send(res,303,'',{Location:process.env.LOGOUT_URL||'/cdn-cgi/access/logout'}),true;
  A.deleteSession(sessionToken(req));
  return send(res,303,'',{Location:'/login','Set-Cookie':sessionCookie(req,'',0)}),true;
 }
 if(MODE!=='builtin'){if(path==='/login'||path.startsWith('/auth/'))return send(res,303,'',{Location:'/'}),true;return false}
 if(path==='/login'&&req.method==='GET'){
  if(await authenticate(req))return send(res,303,'',{Location:'/'}),true;
  const sent=url.searchParams.get('sent')==='1',bad=url.searchParams.get('e');
  return sendPage(res,loginPage(sent?'If an account exists for that address, a sign-in link is on its way. Check your inbox.':'',bad==='expired'?'That sign-in link has expired or was already used. Ask for a new one.':bad==='busy'?'Too many attempts. Wait a few minutes and try again.':'')),true;
 }
 if(path==='/auth/email'&&req.method==='POST'){
  let email;try{email=A.cleanEmail((await readForm(req)).email)}catch{return sendPage(res,loginPage('','Enter a valid email address.')),true}
  if(limited('auth-email',60,9e5)||limited('auth-email:'+email,5,9e5))return send(res,303,'',{Location:'/login?e=busy'}),true;
  const user=A.userByEmail(email);
  if(user){
   const link=requestOrigin(req)+'/auth/verify?token='+A.createLoginToken(email);
   if(mailConfigured()){
    sendMail({to:email,subject:'Sign in to '+APP_NAME,text:`Sign in to ${APP_NAME}:\n\n${link}\n\nThe link works once and expires in ${A.LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.\n`})
     .catch(e=>console.error('sign-in email could not be sent:',e.message));
   }else console.log(`[auth] SMTP is not configured; sign-in link for ${email}: ${link}`);
  }
  return send(res,303,'',{Location:'/login?sent=1'}),true;
 }
 // The emailed link opens a confirmation page; signing in needs a POST, so link scanners cannot use up the token.
 if(path==='/auth/verify'&&req.method==='GET'){
  const t=String(url.searchParams.get('token')||'').slice(0,64);
  return sendPage(res,page('Sign in',`<h1>Finish signing in</h1><form method="post" action="/auth/verify" class="auth-form"><input type="hidden" name="token" value="${esc(t)}"><button class="primary" type="submit">Sign in</button></form>`)),true;
 }
 if(path==='/auth/verify'&&req.method==='POST'){
  if(limited('auth-verify',30,6e5))return send(res,303,'',{Location:'/login?e=busy'}),true;
  const email=A.consumeLoginToken(String((await readForm(req)).token||''));
  const user=email&&A.userByEmail(email);
  if(!user)return send(res,303,'',{Location:'/login?e=expired'}),true;
  return send(res,303,'',{Location:'/','Set-Cookie':sessionCookie(req,A.createSession(user.id),A.SESSION_DAYS*86400)}),true;
 }
 if(path.startsWith('/auth/'))return json(res,404,{error:'Not found'}),true;
 return false;
}
