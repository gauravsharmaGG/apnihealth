// /consent: the health-data notice and consent form (see consent.mjs). Shown before anything else after sign-in
// until the current version is accepted.
import {CONSENT_VERSION,NOTICE,hasConsent,recordConsent,consentsOf} from './consent.mjs';
import {page} from './auth.mjs';
import {send,readForm,esc} from './http.mjs';
import {APP_NAME} from './env.mjs';

function form(user,error=''){
 const privacy=process.env.PRIVACY_URL;
 const prev=consentsOf(user.id).at(-1);
 return page('Before you start',`<h1>Before you start</h1>
${prev?`<p class="auth-msg" role="status">This notice has changed since you last accepted it. Please read it again.</p>`:''}
${error?`<p class="auth-error" role="alert">${esc(error)}</p>`:''}
<h2>Not medical advice</h2><ul class="notice-list">${NOTICE.disclaimer.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>
<h2>Your health data</h2><ul class="notice-list">${NOTICE.consent.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>
${privacy?`<p><a href="${esc(privacy)}" target="_blank" rel="noopener">Read the full privacy notice of this ${esc(APP_NAME)} instance ↗</a></p>`:''}
<form method="post" action="/consent" class="auth-form">
<label class="check"><input type="checkbox" name="disclaimer" value="yes" required> I understand that ${esc(APP_NAME)} is not medical advice and not a medical device.</label>
<label class="check"><input type="checkbox" name="consent" value="yes" required> I explicitly consent to ${esc(APP_NAME)} processing the health information I enter, as described above.</label>
<input type="hidden" name="version" value="${esc(CONSENT_VERSION)}">
<button class="primary" type="submit">I agree</button></form>
<form method="post" action="/logout"><button class="ghost" type="submit">No thanks, sign out</button></form>
<p class="muted">Notice version ${esc(CONSENT_VERSION)}.</p>`);
}
// True when it answered the request.
export async function handle(req,res,path,user){
 if(path!=='/consent')return false;
 if(req.method==='GET'){
  if(hasConsent(user.id)){const c=consentsOf(user.id).at(-1);const [st,html]=page('Health data notice',`<h1>Health data notice</h1><p>You accepted version ${esc(CONSENT_VERSION)} on ${esc(new Date(c.acceptedAt).toUTCString())}.</p><ul class="notice-list">${[...NOTICE.disclaimer,...NOTICE.consent].map(l=>`<li>${esc(l)}</li>`).join('')}</ul><p><a href="/">Back to the app</a></p>`);return send(res,st,html),true}
  const [st,html]=form(user);return send(res,st,html),true;
 }
 if(req.method==='POST'){
  const f=await readForm(req).catch(()=>({}));
  // The version in the form must be the one shown, so a stale page cannot accept a newer notice.
  if(f.disclaimer!=='yes'||f.consent!=='yes'||f.version!==CONSENT_VERSION){const [,html]=form(user,f.version!==CONSENT_VERSION?'The notice changed while this page was open. Please read it again.':'Please tick both boxes to continue.');return send(res,400,html),true}
  recordConsent(user.id);
  return send(res,303,'',{Location:'/'}),true;
 }
 return send(res,405,'Method not allowed'),true;
}
