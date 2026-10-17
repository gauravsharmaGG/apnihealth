// Sign-in page: passkey button (shown only where the browser supports passkeys).
(()=>{
const area=document.getElementById('passkey-area'),btn=document.getElementById('passkey-login'),msg=document.getElementById('passkey-msg');
if(!area||!window.PublicKeyCredential||!navigator.credentials)return;
area.hidden=false;
const buf=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const post=async(url,body)=>{const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Sign-in failed');return j};
btn.addEventListener('click',async()=>{
 msg.hidden=true;btn.disabled=true;
 try{
  const o=await post('/auth/passkey/options');
  const cred=await navigator.credentials.get({publicKey:{challenge:buf(o.challenge),rpId:o.rpId,timeout:o.timeout,userVerification:o.userVerification}});
  const r=cred.response;
  await post('/auth/passkey',{credential:{id:cred.id,type:cred.type,response:{clientDataJSON:b64u(r.clientDataJSON),authenticatorData:b64u(r.authenticatorData),signature:b64u(r.signature),userHandle:r.userHandle?b64u(r.userHandle):null}}});
  location.replace('/');
 }catch(e){msg.textContent=e.name==='NotAllowedError'?'Passkey sign-in was cancelled.':e.message;msg.hidden=false}
 btn.disabled=false;
});
})();
