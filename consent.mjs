// The health-data notice every user must accept before the app stores or shows health records:
// "not medical advice / not a medical device", and explicit consent to processing health data (GDPR Art. 9(2)(a)).
// Change the text => bump CONSENT_VERSION, and everyone is asked again. Acceptances are kept with a timestamp.
import {db} from './db.mjs';
export const CONSENT_VERSION='2026-10-17.1';
export const NOTICE={
 disclaimer:[
  'This app is a personal record keeper. It is not medical advice and not a medical device.',
  'It does not diagnose, treat or recommend doses. Explanations of results are general education only.',
  'In an emergency, call your local emergency number. Talk to a doctor or pharmacist about your health.'
 ],
 consent:[
  'You will store health information here: measurements, symptoms, medicines, appointments, lab results and documents, for yourself and for people you add (such as your children).',
  'This information is special-category personal data. It is processed only to run this app for you and your household, on the server operated by whoever runs this instance; it is not sold or used for advertising.',
  'You can export all of it or delete your account at any time (Settings). You can withdraw consent by deleting your account; this does not affect processing that happened before.',
  'If you add someone else (for example a child), you confirm you are allowed to record their health information.'
 ]
};
export const hasConsent=(userId,version=CONSENT_VERSION)=>!!db().prepare('SELECT 1 FROM consents WHERE user_id=? AND version=?').get(userId,version);
export function recordConsent(userId,version=CONSENT_VERSION,at=new Date()){
 db().prepare('INSERT INTO consents(user_id,version,accepted_at) VALUES(?,?,?) ON CONFLICT(user_id,version) DO NOTHING').run(userId,version,at.toISOString());
}
export const consentsOf=userId=>db().prepare('SELECT version,accepted_at AS acceptedAt FROM consents WHERE user_id=? ORDER BY accepted_at').all(userId).map(r=>({...r}));
