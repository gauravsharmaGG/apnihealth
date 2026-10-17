#!/usr/bin/env node
// Create a user (or change their role) in a household, and optionally print a one-time sign-in link.
//   node scripts/create-user.mjs --email you@example.com [--role owner|editor|viewer] [--household ID] [--link] [--origin https://health.example.com]
// Defaults: role owner, the oldest household. The database is DB_FILE or private/apnihealth.db.
const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
const S=await import('../store.mjs'),A=await import('../accounts.mjs'),{publicOrigin}=await import('../env.mjs');
try{
 S.enterAs(S.SYSTEM);
 const email=A.cleanEmail(opt('--email')),role=opt('--role')||'owner';
 if(!S.ROLES.includes(role))throw Error('--role must be owner, editor or viewer');
 const hs=S.households(),h=opt('--household')?hs.find(x=>x.id===opt('--household')):hs[0];
 if(!h)throw Error(hs.length?'Unknown --household':'No household yet: run node scripts/import-json.mjs first');
 const u=A.userByEmail(email)||A.createUser(email);
 A.setMembership(h.id,u.id,role);
 console.log(`${email} is now ${role} of "${h.name}".`);
 if(args.includes('--link')){
  const origin=(opt('--origin')||publicOrigin()).replace(/\/$/,'');
  console.log(`One-time sign-in link (valid ${A.LINK_MINUTES} minutes; AUTH_MODE=builtin):\n${origin}/auth/verify?token=${A.createLoginToken(email)}`);
 }
}catch(e){console.error('FAILED:',e.message);process.exit(1)}
