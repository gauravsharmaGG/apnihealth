// The public landing page for signed-out visitors (built-in sign-in only). Server-rendered like auth.mjs `page()`:
// no scripts, no inline styles; all motion is CSS in public/landing.css. The vitals on the figure are fixed sample
// values, labelled as such. Fictional content only.
import {esc} from './http.mjs';

const icon=d=>`<svg class="lp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const FEATURES=[
 ['sky','Episodes','Log an illness from first symptom to recovery: symptoms, temperature, notes and what helped.','<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>'],
 ['peach','Medicines & reminders','Keep each person’s medicines and courses together, with reminders that reach your phone.','<rect x="3.5" y="9" width="17" height="6.5" rx="3.25" transform="rotate(-35 12 12)"/><path d="M9.2 7.4l5.6 8.2"/>'],
 ['lilac','Appointments','Check-ups, vaccinations and follow-ups in one calendar, with a nudge before each.','<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
 ['green','Lab trends','Chart results over time in plain language, with each report’s own reference range.','<path d="M4 19V5M4 19h16"/><path d="M7.5 15l3.5-4 3 2.5 4.5-6"/>'],
 ['sand','Reports','Upload PDFs and photos of reports and letters, and keep the originals exactly as supplied.','<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12.5h5M9.5 16h5"/>'],
 ['rose','Apple Health import','Send steps, heart rate, sleep and more from Apple Health with a personal key.','<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'],
 ['green','Households','One account for the whole family: adults, children and carers, with roles for who can view or edit.','<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.2"/><path d="M16.5 14.7c2.4.1 3.8 1.6 4.2 4.3"/>'],
 ['sky','Privacy & EU hosting','Hosted in the EU or on your own server. Built with GDPR in mind: export everything or delete your account any time.','<path d="M12 3.5l7 2.8v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.3z"/><path d="M9 12l2.2 2.2L15.2 10"/>'],
 ['lilac','Open source','AGPL-3.0 licensed. Read the code, run it yourself, and keep your family’s records under your control.','<path d="M8.5 7L4 12l4.5 5M15.5 7l4.5 5-4.5 5M13.5 5l-3 14"/>'],
];
// Callouts on the figure: [class, label, value, unit, side]. Sample values only.
const VITALS=[['heart','Heart','72','bpm'],['temp','Body temp','36.6','°C'],['breath','Breathing','14','rpm'],['spo2','SpO₂','98','%']];
const SAMPLE='Example figure with sample values, not real data: heart 72 beats per minute, breathing 14 breaths per minute, body temperature 36.6 degrees Celsius, blood oxygen 98 percent.';

function figure(){
 return `<div class="lp-stage" role="img" aria-label="${esc(SAMPLE)}">
<svg class="lp-figure" viewBox="0 0 560 520" aria-hidden="true" focusable="false">
<defs>
<radialGradient id="lp-glow" cx="50%" cy="42%" r="55%"><stop offset="0" stop-color="#bfe6da" stop-opacity=".85"/><stop offset=".6" stop-color="#d9e8fa" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="lp-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f5f0"/><stop offset=".55" stop-color="#d5e6f4"/><stop offset="1" stop-color="#d5e6f4" stop-opacity="0"/></linearGradient>
<linearGradient id="lp-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f6e60" stop-opacity=".55"/><stop offset="1" stop-color="#2f5f96" stop-opacity="0"/></linearGradient>
</defs>
<circle class="lp-halo" cx="280" cy="240" r="250" fill="url(#lp-glow)"/>
<g class="lp-breathe">
<path class="lp-body" d="M280 26c27 0 44 21 44 50 0 22-9 38-22 47v18c34 8 77 20 100 37 23 15 32 38 36 80l8 262H114l8-262c4-42 13-65 36-80 23-17 66-29 100-37v-18c-13-9-22-25-22-47 0-29 17-50 44-50z" fill="url(#lp-body)" stroke="url(#lp-edge)" stroke-width="2"/>
<path d="M232 150c14 14 31 21 48 21s34-7 48-21" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="3" stroke-linecap="round"/>
<path class="lp-ecg" pathLength="1" d="M214 248h22l8-1 10-34 14 66 12-46 8 15h46" fill="none" stroke="#0f6e60" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<g class="lp-lines" fill="none" stroke="#56656f" stroke-opacity=".55" stroke-width="1">
<path d="M110 70H236L262 64"/><path d="M110 232H212L236 250"/><path d="M450 142H350L330 190"/><path d="M450 312H372L352 330"/>
</g>
<g class="lp-dots">
<g class="lp-dot d-temp"><circle class="ring" cx="262" cy="64" r="7"/><circle class="core" cx="262" cy="64" r="6"/></g>
<g class="lp-dot d-heart"><circle class="ring" cx="236" cy="250" r="7"/><circle class="core" cx="236" cy="250" r="6"/></g>
<g class="lp-dot d-breath"><circle class="ring" cx="330" cy="190" r="7"/><circle class="core" cx="330" cy="190" r="6"/></g>
<g class="lp-dot d-spo2"><circle class="ring" cx="352" cy="330" r="7"/><circle class="core" cx="352" cy="330" r="6"/></g>
</g>
</svg>
${VITALS.map(([k,l,v,u])=>`<div class="lp-call c-${k}" aria-hidden="true"><span class="lp-call-label">${l}</span><span class="lp-call-val"><b>${v}</b> ${u}</span></div>`).join('\n')}
<span class="lp-chip" aria-hidden="true">Sample data</span>
</div>`;
}

export function landingPage({appName,demoNotice='',signup='open'}={}){
 const n=esc(appName),open=signup==='open';
 const ctas=(where)=>`<div class="lp-cta">${open?`<a class="lp-btn lp-primary" href="/login">Create account</a><a class="lp-btn lp-ghost" href="/login">Sign in</a>`:`<a class="lp-btn lp-primary" href="/login">Sign in</a>`}</div>${open?'':`<p class="lp-note">Sign-up is by invitation only. Ask the person who runs this app for an invite.</p>`}`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="index,follow"><meta name="theme-color" content="#f3f5f7"><title>${n}: a private health record for your household</title><meta name="description" content="${n} is a self-hosted, mobile-first health record for your household: episodes, medicines, appointments, lab trends and reports. Private by design, open source, EU hosting."><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/landing.css"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head><body class="lp">${demoNotice?`<p class="demo-notice" role="note">${esc(demoNotice)}</p>`:''}<a class="skip" href="#main">Skip to content</a>
<header class="lp-top"><a class="lp-brand" href="/" aria-label="${n} home"><span class="lp-mark" aria-hidden="true">AH</span><span>${n}</span></a><a class="lp-btn lp-ghost lp-small" href="/login">Sign in</a></header>
<main id="main" class="lp-main">
<section class="lp-hero" aria-labelledby="lp-h1"><div class="lp-copy"><p class="lp-eyebrow">Private health record for your household</p><h1 id="lp-h1">Your family’s health,<br><em>calm and in one place.</em></h1><p class="lp-sub">${n} keeps illnesses, medicines, appointments, lab results and reports together. Self-hosted, mobile first, and yours alone.</p>${ctas('hero')}</div>
${figure()}</section>
<section class="lp-features" aria-labelledby="lp-h2"><p class="lp-eyebrow">What’s inside</p><h2 id="lp-h2">Everything a household needs, nothing it doesn’t</h2>
<ul class="lp-grid">${FEATURES.map(([t,h,p,d])=>`<li class="lp-card t-${t}">${icon(d)}<h3>${h}</h3><p>${p}</p></li>`).join('')}</ul></section>
<section class="lp-final" aria-labelledby="lp-h3"><h2 id="lp-h3">Keep your health records yours</h2><p>${open?'Create an account with just your email and have your household set up in a few minutes.':'Sign in with the link or passkey you were invited with.'}</p>${ctas('bottom')}</section>
</main>
<footer class="lp-foot"><p>${n} is open source (AGPL-3.0). <a href="https://github.com/gauravsharmaGG/apnihealth" rel="noopener">Source code on GitHub</a></p><p>Your health data is never sold or shared, and you can export or delete it at any time. ${n} is a record keeper, not medical advice.</p></footer>
</body></html>`;
}
