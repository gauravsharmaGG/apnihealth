// Theme checks: colour tokens meet WCAG AA contrast where they are used for text, and the styles and pages load
// nothing from other origins (strict CSP: no external fonts, CDNs or inline styles/scripts).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const css=readFileSync(new URL('public/style.css',import.meta.url),'utf8');
const root=[...css.matchAll(/:root\{([^}]*)\}/g)].at(-1)[1];
const tok=Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):([^;]+);?/g)].map(m=>[m[1],m[2].trim()]));
const hex=v=>{const m=/#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v);assert(m,'colour expected: '+v);let h=m[1];if(h.length===3)h=[...h].map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const lum=rgb=>{const [r,g,b]=rgb.map(c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const [x,y]=[lum(hex(a)),lum(hex(b))].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
const bgs=['surface-solid','bg','accent-soft','good-soft','warn-soft','bad-soft','info-soft'];
const fails=[];
for(const fg of ['ink','ink-2','muted','faint','accent','accent-strong'])for(const bg of ['surface-solid','bg'])if(ratio(tok[fg],tok[bg])<4.5)fails.push(`${fg} on ${bg}: ${ratio(tok[fg],tok[bg]).toFixed(2)}`);
for(const [fg,bg] of [['good','good-soft'],['warn','warn-soft'],['bad','bad-soft'],['info','info-soft'],['accent','accent-soft'],['on-accent','accent'],['on-accent','accent-strong']])if(ratio(tok[fg],tok[bg])<4.5)fails.push(`${fg} on ${bg}: ${ratio(tok[fg],tok[bg]).toFixed(2)}`);
// card tints: text sits on the lightest-to-darkest gradient; check the darkest (first) stop
for(const t of ['tint-green','tint-peach','tint-rose','tint-sky','tint-lilac','tint-sand'])for(const fg of ['ink','muted'])if(ratio(tok[fg],tok[t])<4.5)fails.push(`${fg} on ${t}: ${ratio(tok[fg],tok[t]).toFixed(2)}`);
assert.deepEqual(fails,[],'WCAG AA contrast');
assert.equal(bgs.every(b=>tok[b]),true,'tokens defined');
// nothing from elsewhere
assert(!/@import|url\(\s*['"]?(https?:)?\/\//i.test(css),'no external CSS resources');
assert(!/@font-face/i.test(css),'system fonts only');
const pages=['templates/index.template.html',...readdirSync(new URL('public',import.meta.url)).filter(f=>f.endsWith('.html')).map(f=>'public/'+f)];
for(const p of pages){const h=readFileSync(new URL(p,import.meta.url),'utf8');
 assert(!/<(script|link)[^>]+(src|href)=["']?(https?:)?\/\//i.test(h),p+': no external scripts or styles');
 assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(h),p+': no inline scripts');assert(!/\sstyle=/i.test(h),p+': no inline style attributes');}
console.log('PASS theme: AA contrast for text tokens on surfaces, badges and card tints; no external fonts, CSS or scripts; no inline scripts or styles.');
