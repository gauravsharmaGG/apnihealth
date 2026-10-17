#!/usr/bin/env node
// Import the JSON files in private/ into the SQLite database (see importer.mjs). Prints counts only.
//   node scripts/import-json.mjs [--dry-run] [--private DIR] [--household NAME]
// The database is DB_FILE or private/apnihealth.db. Stop the server first. JSON files are left untouched.
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
const privateDir=opt('--private')||fileURLToPath(new URL('../private/',import.meta.url));
const {importJson}=await import('../importer.mjs');
try{
 const r=importJson({privateDir,householdName:opt('--household')||'Household',dryRun:args.includes('--dry-run')});
 for(const [k,v] of Object.entries(r.counts))console.log(k.padEnd(22),v);
 console.log(r.dryRun?'DRY RUN: nothing was written.':'IMPORT COMPLETE. The JSON files were not changed; keep them as a backup until you have checked the app.');
}catch(e){console.error('IMPORT FAILED:',e.message);process.exit(1)}
