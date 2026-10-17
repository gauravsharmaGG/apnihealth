// Per-household settings chosen during onboarding (and later in Settings): which daily measurements to track,
// the household's time zone, and display units. Values are always stored in metric units (kg, °C).
import {system} from './store.mjs';
import {TIME_ZONE,validZone} from './env.mjs';

// Measurement groups people can switch on or off, and the log metrics behind each.
export const METRIC_GROUPS={
 weight:{label:'Weight',metrics:['weight']},
 body_fat:{label:'Body fat',metrics:['body_fat']},
 sleep:{label:'Sleep',metrics:['sleep']},
 steps:{label:'Steps',metrics:['steps']},
 heart_rate:{label:'Resting heart rate',metrics:['resting_hr']},
 blood_pressure:{label:'Blood pressure',metrics:['bp_sys','bp_dia']},
 spo2:{label:'Blood oxygen (SpO2)',metrics:['spo2']},
 hrv:{label:'Heart rate variability',metrics:['hrv']},
 temperature:{label:'Body temperature',metrics:['temperature']}
};
// Always on: these are the core of the app, not optional trackers.
export const CORE=[['episodes','Illness episodes'],['medicines','Medicines and reminders'],['appointments','Appointments'],['labs','Lab results and reports']];
export const DEFAULT_METRICS=['weight','body_fat','sleep','steps','heart_rate','blood_pressure'];

function normalize(s){
 s=s&&typeof s==='object'?s:{};
 return {
  metrics:Array.isArray(s.metrics)?[...new Set(s.metrics.filter(k=>Object.hasOwn(METRIC_GROUPS,k)))]:DEFAULT_METRICS,
  timeZone:validZone(s.timeZone)?s.timeZone:TIME_ZONE,
  units:{weight:s.units?.weight==='lb'?'lb':'kg',temperature:s.units?.temperature==='F'?'F':'C'}
 };
}
const parse=t=>{try{return JSON.parse(t||'{}')}catch{return {}}};
export function get(householdId){
 const r=system().prepare('SELECT settings,onboarded_at FROM households WHERE id=?').get(householdId);
 if(!r)throw Error('Unknown household');
 return {...normalize(parse(r.settings)),onboarded:!!r.onboarded_at};
}
// Validates a partial update and stores the merged result. Throws on bad input instead of guessing.
export function save(householdId,patch){
 const cur=normalize(parse(system().prepare('SELECT settings FROM households WHERE id=?').get(householdId)?.settings));
 const p=patch&&typeof patch==='object'?patch:{};
 if(p.metrics!==undefined){if(!Array.isArray(p.metrics)||p.metrics.some(k=>!Object.hasOwn(METRIC_GROUPS,k)))throw Error('Unknown measurement');cur.metrics=[...new Set(p.metrics)]}
 if(p.timeZone!==undefined){if(!validZone(p.timeZone))throw Error('Unknown time zone');cur.timeZone=p.timeZone}
 if(p.units!==undefined){
  if(p.units?.weight!==undefined){if(!['kg','lb'].includes(p.units.weight))throw Error('Weight unit must be kg or lb');cur.units.weight=p.units.weight}
  if(p.units?.temperature!==undefined){if(!['C','F'].includes(p.units.temperature))throw Error('Temperature unit must be C or F');cur.units.temperature=p.units.temperature}
 }
 system().prepare('UPDATE households SET settings=? WHERE id=?').run(JSON.stringify(cur),householdId);
 return get(householdId);
}
export const markOnboarded=householdId=>system().prepare('UPDATE households SET onboarded_at=COALESCE(onboarded_at,?) WHERE id=?').run(new Date().toISOString(),householdId);
// The time zone of the household a profile belongs to (reminders run outside any request).
export function zoneOfMember(memberId){
 const r=system().prepare('SELECT h.settings FROM members m JOIN households h ON h.id=m.household_id WHERE m.id=?').get(memberId);
 return r?normalize(parse(r.settings)).timeZone:null;
}
