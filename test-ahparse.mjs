import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const AH=createRequire(import.meta.url)('./public/ahparse.js');
const dir=mkdtempSync(tmpdir()+'/apni-ah-');
const R=(type,start,end,value,extra='')=>`<Record type="${type}" sourceName="${extra.includes('Watch')?'Alex’s Apple Watch':'Alex’s iPhone'}" sourceVersion="17.0" device="&lt;&lt;HKDevice: 0x1&gt;, name:iPhone&gt;" unit="${extra.replace('Watch','')||'count'}" creationDate="${start}" startDate="${start}" endDate="${end}" value="${value}"><MetadataEntry key="HKWasUserEntered" value="1"/></Record>`;
const T='+0200';
const rec=[
 '<?xml version="1.0" encoding="UTF-8"?><HealthData locale="en_DE"><ExportDate value="2026-10-05 11:00:00 +0200"/><Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01"/>',
 // steps 30 Sep: 08:xx phone 100 + watch 120 overlap -> 120; 09:xx phone 50 -> total 170
 R('HKQuantityTypeIdentifierStepCount',`2026-09-30 08:10:00 ${T}`,`2026-09-30 08:20:00 ${T}`,100),
 R('HKQuantityTypeIdentifierStepCount',`2026-09-30 08:15:00 ${T}`,`2026-09-30 08:25:00 ${T}`,120,'Watch'),
 R('HKQuantityTypeIdentifierStepCount',`2026-09-30 09:05:00 ${T}`,`2026-09-30 09:15:00 ${T}`,50),
 R('HKQuantityTypeIdentifierStepCount',`2026-10-01 10:00:00 ${T}`,`2026-10-01 10:30:00 ${T}`,4000,'Watch'),
 // weight: lb then later kg same day -> latest wins; another day in lb
 R('HKQuantityTypeIdentifierBodyMass',`2026-09-30 07:00:00 ${T}`,`2026-09-30 07:00:00 ${T}`,176.4,'lb'),
 R('HKQuantityTypeIdentifierBodyMass',`2026-09-30 21:00:00 ${T}`,`2026-09-30 21:00:00 ${T}`,79.8,'kg'),
 R('HKQuantityTypeIdentifierBodyMass',`2026-10-02 07:00:00 ${T}`,`2026-10-02 07:00:00 ${T}`,176.4,'lb'),
 R('HKQuantityTypeIdentifierRestingHeartRate',`2026-09-30 00:00:00 ${T}`,`2026-09-30 00:00:00 ${T}`,60,'count/min'),
 R('HKQuantityTypeIdentifierRestingHeartRate',`2026-09-30 12:00:00 ${T}`,`2026-09-30 12:00:00 ${T}`,62,'count/min'),
 R('HKQuantityTypeIdentifierBodyFatPercentage',`2026-09-30 07:00:00 ${T}`,`2026-09-30 07:00:00 ${T}`,0.205,'%'),
 R('HKQuantityTypeIdentifierBloodPressureSystolic',`2026-09-30 08:00:00 ${T}`,`2026-09-30 08:00:00 ${T}`,120,'mmHg'),
 R('HKQuantityTypeIdentifierBloodPressureSystolic',`2026-09-30 20:00:00 ${T}`,`2026-09-30 20:00:00 ${T}`,124,'mmHg'),
 R('HKQuantityTypeIdentifierBloodPressureDiastolic',`2026-09-30 08:00:00 ${T}`,`2026-09-30 08:00:00 ${T}`,80,'mmHg'),
 R('HKQuantityTypeIdentifierBloodPressureDiastolic',`2026-09-30 20:00:00 ${T}`,`2026-09-30 20:00:00 ${T}`,82,'mmHg'),
 // sleep night ending 1 Oct: InBed ignored; core 23:00-02:00, deep 02-03, rem 03-06 (watch) + overlapping phone asleep 23:10-06:10 -> union 23:00-06:10 = 7.2h
 R('HKCategoryTypeIdentifier'+'SleepAnalysis',`2026-09-30 22:30:00 ${T}`,`2026-10-01 06:30:00 ${T}`,'HKCategoryValueSleepAnalysisInBed'),
 R('HKCategoryTypeIdentifierSleepAnalysis',`2026-09-30 23:00:00 ${T}`,`2026-10-01 02:00:00 ${T}`,'HKCategoryValueSleepAnalysisAsleepCore','Watch'),
 R('HKCategoryTypeIdentifierSleepAnalysis',`2026-10-01 02:00:00 ${T}`,`2026-10-01 03:00:00 ${T}`,'HKCategoryValueSleepAnalysisAsleepDeep','Watch'),
 R('HKCategoryTypeIdentifierSleepAnalysis',`2026-10-01 03:00:00 ${T}`,`2026-10-01 06:00:00 ${T}`,'HKCategoryValueSleepAnalysisAsleepREM','Watch'),
 R('HKCategoryTypeIdentifierSleepAnalysis',`2026-09-30 23:10:00 ${T}`,`2026-10-01 06:10:00 ${T}`,'HKCategoryValueSleepAnalysisAsleepUnspecified'),
 R('HKQuantityTypeIdentifierHeartRate',`2026-09-30 08:00:00 ${T}`,`2026-09-30 08:00:00 ${T}`,70,'count/min'), // ignored type
 '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30"/></HealthData>'].join('\n');
writeFileSync(dir+'/export.xml',rec);
// build zips: deflate, stored, zip64-forced (python), all with the same folder layout Apple uses
execFileSync('python3',['-c',`
import zipfile,sys
d=sys.argv[1];x=open(d+'/export.xml','rb').read()
for name,comp,z64 in [('deflate.zip',zipfile.ZIP_DEFLATED,False),('stored.zip',zipfile.ZIP_STORED,False),('zip64.zip',zipfile.ZIP_DEFLATED,True)]:
    if z64:
        zipfile.ZIP64_LIMIT=1;zipfile.ZIP_FILECOUNT_LIMIT=0
    with zipfile.ZipFile(d+'/'+name,'w',comp) as z:
        z.writestr('apple_health_export/export_cda.xml',b'<ClinicalDocument/>')
        z.writestr('apple_health_export/export.xml',x)
        z.writestr('apple_health_export/electrocardiograms/ecg_1.csv',b'a,b\\n1,2\\n')
`,dir]);
const expect=e=>{const g=(d,m)=>e.entries.find(x=>x.date===d&&x.metric===m)?.value;
 assert.equal(g('2026-09-30','steps'),170,'steps dedupe (max source per hour)');assert.equal(g('2026-10-01','steps'),4000);
 assert.equal(g('2026-09-30','weight'),79.8,'latest weight of the day');assert.equal(g('2026-10-02','weight'),80);
 assert.equal(g('2026-09-30','resting_hr'),61);assert.equal(g('2026-09-30','body_fat'),20.5);
 assert.equal(g('2026-09-30','bp_sys'),122);assert.equal(g('2026-09-30','bp_dia'),81);
 assert.equal(g('2026-10-01','sleep'),7.2,'sleep = union of asleep intervals, dated by wake-up day');assert.equal(g('2026-09-30','sleep'),undefined);
 assert.equal(e.entries.some(x=>x.metric==='heart_rate'),false);
 assert.equal(e.summary.steps.n,2);assert.equal(e.summary.weight.from,'2026-09-30');assert.equal(e.summary.weight.to,'2026-10-02');};
const asFile=p=>new File([readFileSync(p)],p.split('/').pop());
for(const z of ['deflate.zip','stored.zip','zip64.zip']){expect(await AH.importFile(asFile(dir+'/'+z)));console.log('PASS',z)}
expect(await AH.importFile(asFile(dir+'/export.xml')));console.log('PASS raw export.xml');
{ // force the zip64 end-of-central-directory path: classic EOCD fields set to 0xFFFF / 0xFFFFFFFF like a >4 GB archive
 const b=Buffer.from(readFileSync(dir+'/zip64.zip'));let e=b.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 b.writeUInt16LE(0xFFFF,e+10);b.writeUInt32LE(0xFFFFFFFF,e+12);b.writeUInt32LE(0xFFFFFFFF,e+16);writeFileSync(dir+'/zip64b.zip',b);
 expect(await AH.importFile(asFile(dir+'/zip64b.zip')));console.log('PASS zip64 end-of-archive record');}
// since filter, tiny chunk boundaries, cancel, and bad input
let r=await AH.importFile(asFile(dir+'/deflate.zip'),{since:'2026-10-01'});assert.equal(r.entries.some(x=>x.date==='2026-09-30'&&x.metric!=='sleep'),false);assert(r.entries.some(x=>x.date==='2026-10-01'&&x.metric==='sleep'));
const bytes=Buffer.from(rec),agg=AH.aggregator();let i=0;
await AH.scanXml(new ReadableStream({pull(c){if(i>=bytes.length){c.close();return}c.enqueue(new Uint8Array(bytes.subarray(i,i+37)));i+=37}}),agg);expect(agg.finish());console.log('PASS 37-byte chunks (records split across boundaries)');
const ac=new AbortController();ac.abort();await assert.rejects(()=>AH.importFile(asFile(dir+'/deflate.zip'),{signal:ac.signal}),e=>e.cancelled);
await assert.rejects(()=>AH.importFile(new File([Buffer.from('not a zip at all')],'x.zip')),/zip/i);
await assert.rejects(()=>AH.importFile(new File([Buffer.from('PK')],'y.zip')),/zip/i);
console.log('PASS since filter, cancel, bad input');
rmSync(dir,{recursive:true,force:true});
