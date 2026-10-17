// In-app document viewer: keeps a Back button on screen (installed apps have no browser chrome).
(()=>{
const q=new URLSearchParams(location.search),src=q.get('src')||'',t=q.get('t')||'Document';
const ok=/^\/(records\/[\w.\-]+|api\/inbox\/[0-9a-f-]{36}\/file\?profile=[a-z]+)(#[\w=&.\-]*)?$/i.test(src);
const back=()=>{if(history.length>1)history.back();else location.href='/'};
document.getElementById('doc-back').addEventListener('click',back);
document.addEventListener('keydown',e=>{if(e.key==='Escape')back()});
document.getElementById('doc-title').textContent=t;document.title=t;
if(!ok){document.getElementById('doc-frame').remove();document.body.insertAdjacentHTML('beforeend','<p class="docbad">This document link is not valid.</p>');return}
document.getElementById('doc-open').href=src;
if(/\.md(#.*)?$/i.test(src)){
 const frame=document.getElementById('doc-frame'),art=document.createElement('article');art.className='mdview';frame.replaceWith(art);
 const esc=x=>x.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const inl=x=>esc(x).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code>$1</code>');
 fetch(src.split('#')[0],{credentials:'same-origin'}).then(r=>r.ok?r.text():Promise.reject()).then(t=>{
  let h='',list=false;const close=()=>{if(list){h+='</ul>';list=false}};
  for(const line of t.split('\n')){
   const m=/^(#{1,4})\s+(.*)/.exec(line),li=/^\s*[-*]\s+(.*)/.exec(line);
   if(m){close();const n=Math.min(m[1].length+1,4);h+=`<h${n}>${inl(m[2])}</h${n}>`}
   else if(li){if(!list){h+='<ul>';list=true}h+=`<li>${inl(li[1])}</li>`}
   else if(!line.trim()){close()}
   else{close();h+=`<p>${inl(line)}</p>`}
  }close();art.innerHTML=h}).catch(()=>{art.textContent='Could not load this document.'});
}else document.getElementById('doc-frame').src=src;
})();
