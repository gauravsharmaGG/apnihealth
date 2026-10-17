// Chart tooltips: hover, keyboard focus and touch. First tap on a linked point shows the tooltip, a second tap opens the report.
(()=>{
const tip=document.createElement('div');tip.className='tip';tip.setAttribute('role','tooltip');tip.id='chart-tip';document.body.appendChild(tip);
let cur=null;
function show(el){
 const lines=(el.dataset.tip||'').split('||').filter(Boolean);if(!lines.length)return hide();
 clearTimeout(ht);cur=el;tip.replaceChildren(...lines.map((t,i)=>{const d=document.createElement('div');d.textContent=t;d.className=i===0?'tip-main':i===1?'tip-date':'tip-line';return d}));
 if(el.dataset.href){const a=document.createElement('a');a.className='tip-open';a.href=el.dataset.href;a.target='_blank';a.rel='noopener';a.textContent=el.dataset.label||'Open report, page '+el.dataset.pg+' ↗';tip.append(a);if(el.dataset.locked==='1'){const n=document.createElement('div');n.className='tip-note';n.textContent='This PDF asks for its own password.';tip.append(n)}}
 const x=document.createElement('button');x.className='tip-x';x.type='button';x.setAttribute('aria-label','Close');x.textContent='×';x.addEventListener('click',hide);tip.append(x);
 tip.classList.toggle('interactive',!!el.dataset.href);
 tip.classList.add('show');
 const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,vw=document.documentElement.clientWidth;
 let left=Math.min(Math.max(8,r.left+r.width/2-w/2),vw-w-8),top=r.top-h-10;
 tip.classList.toggle('below',top<8);if(top<8)top=r.bottom+10;
 tip.style.left=left+'px';tip.style.top=top+'px';
}
let ht;function hide(){cur=null;tip.classList.remove('show','interactive')}
function hideSoon(){clearTimeout(ht);ht=setTimeout(hide,260)}
tip.addEventListener('pointerenter',()=>clearTimeout(ht));tip.addEventListener('pointerleave',e=>{if(e.pointerType!=='touch')hideSoon()});
const target=e=>e.target.closest?.('[data-tip]');
document.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;if(e.target.closest('.tip'))return;const t=target(e);if(t)show(t);else if(cur)hideSoon()});
document.addEventListener('focusin',e=>{const t=target(e)||e.target.querySelector?.('[data-tip]');if(t&&e.target.closest('svg'))show(t)});
document.addEventListener('focusout',e=>{if(!e.relatedTarget?.closest?.('.tip'))hide()});
document.addEventListener('pointerdown',e=>{if(e.target.closest('.tip'))return;if(e.pointerType!=='touch')return;const t=target(e);if(t){e.target.closest('a')?.setAttribute('data-first',cur===t?'0':'1');show(t)}else hide()});
// On touch, a linked point only opens its report on the second tap.
document.addEventListener('click',e=>{const a=e.target.closest?.('a[data-tipa]');if(a&&a.dataset.first==='1'){e.preventDefault();a.dataset.first='0'}},true);
addEventListener('scroll',()=>{if(cur)hide()},{passive:true});addEventListener('resize',hide);addEventListener('hashchange',hide);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hide()});
})();
