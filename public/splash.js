// Runs before first paint: show the animated splash once per browser session, never with reduced motion.
try{if(sessionStorage.getItem('splash')||matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('no-splash');else sessionStorage.setItem('splash','1')}catch{document.documentElement.classList.add('no-splash')}
