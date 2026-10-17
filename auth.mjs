// Who is making a request. Two modes (AUTH_MODE):
//   builtin (default)  users sign in with a one-time email link or a passkey; a server-side session is kept
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
import * as W from './webauthn.mjs';

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
// Who may create an account with built-in sign-in: anyone with a verified email (open, the default) or only people
// holding an invite (invite). Invites work in both modes.
export function signupMode(env=process.env){
 const m=env.SIGNUP_MODE||'open';
 if(m!=='open'&&m!=='invite')throw Error('SIGNUP_MODE must be "open" or "invite"');
 return m;
}
export const SIGNUP=signupMode();

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
export const PUBLIC_PATHS=new Set(['/login','/login.js','/passkey-prompt.js','/style.css','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest']);

// ---- pages ----
export function page(title,body,status=200){
 return [status,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(APP_NAME)}</title><link rel="stylesheet" href="/style.css"><link rel="icon" href="/icon-192.png"></head><body class="auth-page"><main class="auth-card"><p class="eyebrow">${esc(APP_NAME)}</p>${body}</main></body></html>`];
}
const sendPage=(res,[status,html],extra)=>send(res,status,html,extra);
const jsonWith=(res,status,obj,extra)=>send(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8',...extra});
const startSession=(req,userId)=>({'Set-Cookie':sessionCookie(req,A.createSession(userId),A.SESSION_DAYS*86400)});
// WebAuthn relying party: this request's own origin and host name (APP_HOST behind TLS, or localhost in development).
const relyingParty=req=>{const origin=requestOrigin(req);return {origin,rpId:new URL(origin).hostname}};
async function readJson(req){try{const b=await readForm(req,65536);return b&&typeof b==='object'?b:{}}catch{return {}}}
function loginPage(msg='',error=''){
 return page('Sign in',`<h1>Sign in</h1>${msg?`<p class="auth-msg" role="status">${esc(msg)}</p>`:''}${error?`<p class="auth-error" role="alert">${esc(error)}</p>`:''}
<form method="post" action="/auth/email" class="auth-form"><label class="field">Email<input type="email" name="email" autocomplete="username email" required maxlength="254"></label><button class="primary" type="submit">Email me a sign-in link</button></form>
<div class="auth-passkey" id="passkey-area" hidden><p class="auth-or"><span>or</span></p><button class="ghost" type="button" id="passkey-login">Sign in with a passkey</button><p class="auth-error" id="passkey-msg" role="alert" hidden></p></div>
<p class="muted">The link works once and expires in ${A.LINK_MINUTES} minutes. ${SIGNUP==='open'?'New here? Enter your email: the link creates your account.':'No account? Ask the person who runs this app for an invite.'}</p><script src="/login.js" defer></script>`);
}

// Handles the sign-in routes; returns true when it answered the request.
export async function handle(req,res,path,url){
 if(path==='/logout'&&req.method==='POST'){
  if(MODE==='trusted-proxy')return send(res,303,'',{Location:process.env.LOGOUT_URL||'/cdn-cgi/access/logout'}),true;
  A.deleteSession(sessionToken(req));
  return send(res,303,'',{Location:'/login','Set-Cookie':sessionCookie(req,'',0)}),true;
 }
 if(path==='/invite'||path==='/invite/accept')return invite(req,res,path,url);
 if(MODE!=='builtin'){if(path==='/login'||path.startsWith('/auth/'))return send(res,303,'',{Location:'/'}),true;return false}
 if(path==='/login'&&req.method==='GET'){
  if(await authenticate(req))return send(res,303,'',{Location:'/'}),true;
  const sent=url.searchParams.get('sent')==='1',bad=url.searchParams.get('e');
  return sendPage(res,loginPage(sent?'If an account exists for that address, a sign-in link is on its way. Check your inbox.':'',bad==='expired'?'That sign-in link has expired or was already used. Ask for a new one.':bad==='busy'?'Too many attempts. Wait a few minutes and try again.':'')),true;
 }
 if(path==='/auth/email'&&req.method==='POST'){
  const f=await readForm(req).catch(()=>({}));
  let email;try{email=A.cleanEmail(f.email)}catch{return sendPage(res,loginPage('','Enter a valid email address.')),true}
  const inv=f.invite?A.inviteFor(String(f.invite)):null;
  if(limited('auth-email',60,9e5)||limited('auth-email:'+email,5,9e5))return send(res,303,'',{Location:'/login?e=busy'}),true;
  // Known people get a link; so does a new address when sign-up is open, or when it holds an invite it may accept.
  // The answer is the same either way, so the form does not reveal who has an account.
  const known=!!A.userByEmail(email);
  if(known||SIGNUP==='open'||A.inviteAllows(inv,email)){
   const link=requestOrigin(req)+'/auth/verify?token='+A.createLoginToken(email)+(inv?'&invite='+encodeURIComponent(f.invite):'');
   const [subject,intro]=known?['Sign in to '+APP_NAME,`Sign in to ${APP_NAME}:`]:['Create your '+APP_NAME+' account',`Someone (hopefully you) asked to create a ${APP_NAME} account for this address. Open this link to confirm it:`];
   if(mailConfigured()){
    sendMail({to:email,subject,text:`${intro}\n\n${link}\n\nThe link works once and expires in ${A.LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.\n`})
     .catch(e=>console.error('sign-in email could not be sent:',e.message));
   }else console.log(`[auth] SMTP is not configured; sign-in link for ${email}: ${link}`);
  }
  return send(res,303,'',{Location:'/login?sent=1'}),true;
 }
 // The emailed link opens a confirmation page; signing in needs a POST, so link scanners cannot use up the token.
 if(path==='/auth/verify'&&req.method==='GET'){
  const t=String(url.searchParams.get('token')||'').slice(0,64),inv=String(url.searchParams.get('invite')||'').slice(0,64);
  return sendPage(res,page('Sign in',`<h1>Finish signing in</h1><form method="post" action="/auth/verify" class="auth-form"><input type="hidden" name="token" value="${esc(t)}">${inv?`<input type="hidden" name="invite" value="${esc(inv)}">`:''}<button class="primary" type="submit">Sign in</button></form>`)),true;
 }
 if(path==='/auth/verify'&&req.method==='POST'){
  if(limited('auth-verify',30,6e5))return send(res,303,'',{Location:'/login?e=busy'}),true;
  const f=await readForm(req).catch(()=>({}));
  const email=A.consumeLoginToken(String(f.token||''));
  let user=email&&A.userByEmail(email);
  if(email&&f.invite){
   const t=String(f.invite);
   try{transaction(system(),()=>{
    if(!user){if(!A.inviteAllows(A.inviteFor(t),email))throw Error('invite');user=A.createUser(email)}
    A.acceptInvite(t,user);
   })}catch{if(!user)return sendPage(res,page('Invite',`<h1>This invite cannot be used</h1><p>It has expired or was already used. Ask for a new one.</p>`,410)),true}
  }
  // Open sign-up: the emailed link proved the address, so the account is created now.
  if(email&&!user&&SIGNUP==='open')user=A.userByEmail(email)||A.createUser(email);
  if(!user)return send(res,303,'',{Location:'/login?e=expired'}),true;
  // Offer a passkey once, to people who have none yet.
  const next=!user.passkeyPromptedAt&&!A.passkeysOf(user.id).length?'/welcome/passkey':'/';
  return send(res,303,'',{Location:next,...startSession(req,user.id)}),true;
 }
 // Passkey sign-in (discoverable credentials, so no email is asked for first).
 if(path==='/auth/passkey/options'&&req.method==='POST'){
  if(limited('auth-passkey',60,6e5))return json(res,429,{error:'Too many attempts. Wait a few minutes and try again.'}),true;
  return json(res,200,{challenge:A.createChallenge('login'),rpId:relyingParty(req).rpId,timeout:A.CHALLENGE_MINUTES*6e4,userVerification:'preferred'}),true;
 }
 if(path==='/auth/passkey'&&req.method==='POST'){
  if(limited('auth-verify',30,6e5))return json(res,429,{error:'Too many attempts. Wait a few minutes and try again.'}),true;
  const {credential}=await readJson(req);
  try{
   const c=W.claimedChallenge(credential);
   if(!c||!A.consumeChallenge(c,'login'))throw Error('Unknown or expired challenge');
   const pk=A.passkeyById(credential?.id);if(!pk)throw Error('Unknown passkey');
   const uh=credential.response?.userHandle;
   if(uh&&uh!==Buffer.from(pk.userId).toString('base64url'))throw Error('Passkey belongs to someone else');
   const count=W.verifyAssertion(credential,pk,{challenge:c,...relyingParty(req)});
   A.touchPasskey(pk.id,count);
   return jsonWith(res,200,{ok:true},startSession(req,pk.userId)),true;
  }catch{return json(res,400,{error:'That passkey could not be used to sign in. Try again, or use an email link.'}),true}
 }
 if(path.startsWith('/auth/'))return json(res,404,{error:'Not found'}),true;
 return false;
}

// Invite links: /invite?token=... shows the invite; signed-in people accept it, others first sign in by email.
async function invite(req,res,path,url){
 const signOut='<form method="post" action="/logout"><button class="ghost" type="submit">Sign out</button></form>';
 const gone=()=>sendPage(res,page('Invite',`<h1>This invite cannot be used</h1><p>It has expired or was already used. Ask for a new one.</p><p><a href="/">Open ${esc(APP_NAME)}</a></p>`,410));
 if(path==='/invite'&&req.method==='GET'){
  const t=String(url.searchParams.get('token')||'').slice(0,64),inv=A.inviteFor(t);
  if(!inv)return gone(),true;
  const user=await authenticate(req);
  const intro=`<h1>Join ${esc(inv.household.name)}</h1><p>You are invited as <strong>${esc(inv.role)}</strong>${inv.email?` (for ${esc(inv.email)})`:''}. ${esc({owner:'Owners can change everything, including who has access.',editor:'Editors can add and change records.',viewer:'Viewers can look at records but not change them.'}[inv.role])}</p>`;
  if(user)return sendPage(res,page('Invite',intro+(A.inviteAllows(inv,user.email)
   ?`<form method="post" action="/invite/accept" class="auth-form"><input type="hidden" name="token" value="${esc(t)}"><button class="primary" type="submit">Join as ${esc(user.email)}</button></form>`
   :`<p class="auth-error" role="alert">This invite is for a different email address. You are signed in as ${esc(user.email)}.</p>`)+signOut)),true;
  if(MODE!=='builtin')return send(res,403,'Sign-in required'),true;
  return sendPage(res,page('Invite',intro+`<form method="post" action="/auth/email" class="auth-form"><input type="hidden" name="invite" value="${esc(t)}"><label class="field">Your email<input type="email" name="email" autocomplete="username email" required maxlength="254" value="${esc(inv.email||'')}"${inv.email?' readonly':''}></label><button class="primary" type="submit">Email me a link to join</button></form>`)),true;
 }
 if(path==='/invite/accept'&&req.method==='POST'){
  if(limited('invite-accept',60,6e5))return send(res,429,'Too many attempts'),true;
  const user=await authenticate(req);if(!user)return send(res,303,'',{Location:'/login'}),true;
  try{A.acceptInvite(String((await readForm(req)).token||''),user)}catch(e){return /different email/.test(e.message)?sendPage(res,page('Invite',`<p class="auth-error" role="alert">${esc(e.message)}</p>`+signOut,403)):gone(),true}
  return send(res,303,'',{Location:'/'}),true;
 }
 return send(res,405,'Method not allowed'),true;
}

// Account routes for a signed-in user that do not depend on a household (passkeys). True when answered.
export async function account(req,res,path,user){
 if(path==='/welcome/passkey'&&req.method==='GET'){
  if(MODE!=='builtin')return send(res,303,'',{Location:'/'}),true;
  A.markPasskeyPrompted(user.id);
  return sendPage(res,page('Add a passkey',`<h1>Sign in faster next time</h1><p>Add a passkey and sign in with Face ID, Touch ID or your device PIN instead of waiting for an email. You can do this later in Settings.</p>
<div class="auth-form"><button class="primary" type="button" id="pk-prompt-add" hidden>Add a passkey</button><p class="auth-msg" id="pk-prompt-msg" role="status" hidden></p><a class="ghost button-link" href="/" id="pk-prompt-skip">Not now</a></div><script src="/passkey-prompt.js" defer></script>`)),true;
 }
 if(!path.startsWith('/api/passkeys'))return false;
 if(MODE!=='builtin')return json(res,404,{error:'Passkeys are managed by your sign-in proxy'}),true;
 const view=p=>({id:p.id,name:p.name,createdAt:p.createdAt,lastUsedAt:p.lastUsedAt});
 if(path==='/api/passkeys'&&req.method==='GET')return json(res,200,{passkeys:A.passkeysOf(user.id).map(view)}),true;
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'}),true;
 if(limited('passkeys:'+user.id,30,6e5))return json(res,429,{error:'Too many requests'}),true;
 const body=await readJson(req);
 try{
  if(path==='/api/passkeys/options'){
   const {rpId}=relyingParty(req);
   return json(res,200,{
    challenge:A.createChallenge('register',user.id),rp:{id:rpId,name:APP_NAME},
    user:{id:Buffer.from(user.id).toString('base64url'),name:user.email,displayName:user.name||user.email},
    pubKeyCredParams:W.ALGS.map(alg=>({type:'public-key',alg})),timeout:A.CHALLENGE_MINUTES*6e4,attestation:'none',
    authenticatorSelection:{residentKey:'required',requireResidentKey:true,userVerification:'preferred'},
    excludeCredentials:A.passkeysOf(user.id).map(p=>({type:'public-key',id:p.id,transports:p.transports}))
   }),true;
  }
  if(path==='/api/passkeys'){
   const c=W.claimedChallenge(body.credential);
   if(!c||!A.consumeChallenge(c,'register',user.id))throw Error('This request expired. Try again.');
   const p=W.verifyRegistration(body.credential,{challenge:c,...relyingParty(req)});
   return json(res,200,{passkey:view(A.addPasskey(user.id,p,body.name))}),true;
  }
  if(path==='/api/passkeys/rename')return A.renamePasskey(user.id,body.id,body.name)?json(res,200,{ok:true}):json(res,404,{error:'Not found'}),true;
  if(path==='/api/passkeys/delete')return A.deletePasskey(user.id,body.id)?json(res,200,{ok:true}):json(res,404,{error:'Not found'}),true;
 }catch(e){return json(res,400,{error:e.message}),true}
 return json(res,404,{error:'Not found'}),true;
}
