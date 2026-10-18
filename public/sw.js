// App-shell cache so the dashboard opens instantly and works offline. Network first, so content is never stale online.
// /api/ and /records/ are never cached. Cache is wiped on sign out.
const V='apnihealth-v13',SHELL=['/','/style.css','/landing.css','/app.js','/labs.js','/log.js','/tip.js','/data-child.js','/config.js','/members.css','/core.js','/profiles.js','/medlist.js','/dashboard.js','/figure.js','/timeline.js','/insights.js','/child.js','/episodes.js','/medicines.js','/settings.js','/account.js','/calendar.js','/ahparse.js','/ahimport.js','/reports-data.js','/doc.html','/doc.js','/home.js','/splash.js','/pwa.js','/notes.js','/manifest.webmanifest','/icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(new Request(u,{credentials:'same-origin'})).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='clear')e.waitUntil(caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x)))))});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/records/')||u.pathname==='/logout')return;
 e.respondWith((async()=>{
  try{
   const res=await fetch(r);
   if(res.ok&&res.type==='basic'&&!res.redirected){const c=await caches.open(V);c.put(r.mode==='navigate'&&u.pathname==='/'?'/':r,res.clone())}
   return res;
  }catch{
   const hit=await caches.match(r.mode==='navigate'&&u.pathname==='/'?'/':r,{ignoreSearch:true});
   if(hit)return hit;
   return new Response('You are offline.',{status:503,headers:{'Content-Type':'text/plain'}});
  }})());
});

// Medicine reminders (Web Push). Every push must show a notification (iOS requirement).
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch{}
 e.waitUntil(self.registration.showNotification(d.title||'Health reminder',{body:d.body||'',tag:d.tag||'health',renotify:true,icon:'/icon-192.png',badge:'/icon-192.png',data:{url:d.url||'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL(e.notification.data?.url||'/',location.origin).href;
 e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async l=>{const c=l.find(x=>x.url.startsWith(location.origin));if(c){await c.focus();if('navigate' in c)try{return await c.navigate(url)}catch{}}return clients.openWindow(url)}))});
