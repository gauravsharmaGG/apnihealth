// "Sign in faster next time": optional passkey right after the first email-link sign-in.
(()=>{
const add=document.getElementById('pk-prompt-add'),msg=document.getElementById('pk-prompt-msg'),skip=document.getElementById('pk-prompt-skip');
if(!add||!window.PublicKeyCredential||!navigator.credentials){if(msg){msg.textContent='This browser does not support passkeys. You can keep using email links.';msg.hidden=false}return}
add.hidden=false;
const buf=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const call=async(url,body)=>{const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j};
add.addEventListener('click',async()=>{
 add.disabled=true;msg.hidden=true;
 try{
  const o=await call('/api/passkeys/options',{});
  const cred=await navigator.credentials.create({publicKey:{...o,challenge:buf(o.challenge),user:{...o.user,id:buf(o.user.id)},excludeCredentials:o.excludeCredentials.map(c=>({...c,id:buf(c.id)}))}});
  const r=cred.response;
  await call('/api/passkeys',{name:/iPhone/.test(navigator.userAgent)?'iPhone':/Android/.test(navigator.userAgent)?'Android':'This device',credential:{id:cred.id,type:cred.type,response:{clientDataJSON:b64u(r.clientDataJSON),attestationObject:b64u(r.attestationObject),transports:r.getTransports?r.getTransports():[]}}});
  msg.textContent='Passkey added.';msg.hidden=false;add.hidden=true;skip.textContent='Continue';
 }catch(e){msg.textContent=e.name==='NotAllowedError'?'Cancelled. You can add one later in Settings.':e.message;msg.hidden=false;add.disabled=false}
});
})();
