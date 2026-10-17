// Runs before first paint: show the animated splash once per browser session, never with reduced motion.
try{if(sessionStorage.getItem('splash')||matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('no-splash');else sessionStorage.setItem('splash','1')}catch{document.documentElement.classList.add('no-splash')}
// Low-power look (solid surfaces, no blur or motion): data saver, low-memory devices, or reduced transparency.
try{const c=navigator.connection;if((c&&c.saveData)||(navigator.deviceMemory&&navigator.deviceMemory<=2)||matchMedia('(prefers-reduced-transparency: reduce)').matches)document.documentElement.classList.add('lite')}catch{}
