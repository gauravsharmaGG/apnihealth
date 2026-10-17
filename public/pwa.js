if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
document.addEventListener('submit',e=>{if(e.target.matches('form[action="/logout"]')){navigator.serviceWorker?.controller?.postMessage('clear');if(window.caches)caches.keys().then(k=>k.forEach(x=>caches.delete(x)))}});
// Open same-origin documents in the in-app viewer (with a Back button) instead of leaving the app with no way back.
document.addEventListener('click',e=>{
 if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
 const a=e.target.closest?.('a[href]');if(!a)return;
 let u;try{u=new URL(a.href,location.href)}catch{return}
 if(u.origin!==location.origin)return;
 if(!(/^\/records\//.test(u.pathname)||/^\/api\/inbox\/[^/]+\/file$/.test(u.pathname)))return;
 e.preventDefault();
 const title=(a.querySelector('.at-t strong')?.textContent||a.dataset.title||a.textContent||'Document').replace(/[↗📎]/g,'').trim().slice(0,80)||'Document';
 location.href='/doc.html?src='+encodeURIComponent(u.pathname+u.search+u.hash)+'&t='+encodeURIComponent(title);
},true);
