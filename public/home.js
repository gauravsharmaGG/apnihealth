// Homepage motion: scroll reveals and number count-ups.
(()=>{
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduce)return;
const $$=s=>[...document.querySelectorAll(s)];
function countUp(el){
 const n=el.firstChild;if(!n||n.nodeType!==3)return;const m=/^\s*(\d+(?:\.\d+)?)\s*$/.exec(n.nodeValue);if(!m)return;
 const to=parseFloat(m[1]),dp=(m[1].split('.')[1]||'').length,t0=performance.now(),d=1100;
 const step=t=>{const k=Math.min(1,(t-t0)/d),e=1-Math.pow(1-k,4);n.nodeValue=(to*e).toFixed(dp)+' ';if(k<1)requestAnimationFrame(step);else n.nodeValue=m[1]+' '};
 n.nodeValue='0 ';requestAnimationFrame(step);
}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target;io.unobserve(el);el.classList.add('in');setTimeout(()=>{el.style.transitionDelay=''},1200);el.querySelectorAll?.('.big').forEach(countUp);if(el.classList.contains('big'))countUp(el)}),{threshold:.15,rootMargin:'0px 0px -6% 0px'});
function arm(){
 $$('#overview .section-head,#overview .takeaway,#overview .preview,#overview .safety,#overview .recovery,#overview .today').forEach((el,i,all)=>{
  if(el.classList.contains('rv'))return;el.classList.add('rv');
  const sib=[...el.parentElement.children].filter(c=>c.classList.contains('takeaway')||c.classList.contains('preview')).indexOf(el);
  if(sib>=0)el.style.transitionDelay=Math.min(sib,5)*70+'ms';
  io.observe(el)});
}
arm();
// Re-arm after the Log strip finishes loading into #today-strip.
new MutationObserver(arm).observe(document.querySelector('#today-strip')||document.body,{childList:true});
})();
