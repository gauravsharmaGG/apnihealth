// Per-profile episodes, care log (fever, medicine, notes) and record inbox (photo/PDF uploads awaiting review).
// Records live in the database (document tables via store.docs); uploaded files go through blobs.mjs
// (key profiles/<id>/uploads/<file>; on Node that is still private/profiles/<id>/uploads/).
import {randomUUID} from 'node:crypto';
import * as members from './members.mjs';
import {blobs,uploadKey} from './blobs.mjs';
import {docs,forMember,canWrite,AccessError,canWriteMember} from './store.mjs';
const known=p=>{if(!members.has(p))throw Error('Unknown profile')};
const kinds=new Set(['temperature','medication','care','status','note','symptom','visit','test']);
const epCats=new Set(['Illness','Infection','Injury','Procedure','Chronic condition','Other']);
const cats=new Set(['u-examination','vaccination','growth-chart','medical-document','lab-report','other']);
const mimes=new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp'],['image/heic','.heic'],['image/heif','.heif'],['application/pdf','.pdf']]);
export const MAX_UPLOAD_BODY=12*1024*1024,MAX_FILE=8*1024*1024;
const EV=docs('episode_entries'),EP=docs('episodes'),IN=docs('inbox_items');
const opt=(v,label,max=500)=>{if(v===undefined||v===null||v==='')return undefined;if(typeof v!=='string')throw Error(label+' must be text');const c=v.trim();if(!c||c.length>max)throw Error(label+' is invalid');return c};
function cleanLink(l){
 if(!l||typeof l!=='object')throw Error('Attachment is invalid');const title=opt(l.title,'Attachment title',120)||'Report';
 if(l.type==='record'){if(typeof l.ref!=='string'||!/^[\w.\-]{1,120}\.(pdf|md)$/i.test(l.ref))throw Error('Attachment is invalid')}
 else if(l.type==='upload'){if(typeof l.ref!=='string'||!/^[0-9a-f-]{36}$/i.test(l.ref))throw Error('Attachment is invalid')}
 else if(l.type==='url'){if(typeof l.ref!=='string'||l.ref.length>500||!/^https:\/\/[^\s]+$/.test(l.ref))throw Error('Attachment is invalid')}
 else throw Error('Attachment is invalid');
 return {type:l.type,ref:l.ref,title};
}
export function validateEvent(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Event must be an object');
 if(typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date))throw Error('Date is invalid');
 if(typeof v.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))throw Error('Time is invalid');
 if(!kinds.has(v.kind))throw Error('Event type is invalid');
 const e={date:v.date,time:v.time,kind:v.kind,medicine:opt(v.medicine,'Medicine',80),dose:opt(v.dose,'Dose',40),note:opt(v.note,'Notes')};
 if(v.episodeId!==undefined&&v.episodeId!==null&&v.episodeId!==''){if(typeof v.episodeId!=='string'||v.episodeId.length>80)throw Error('Episode is invalid');e.episodeId=v.episodeId}
 if(v.timeKnown===false)e.timeKnown=false;
 if(v.link!==undefined&&v.link!==null){const l=v.link;if(typeof l!=='object')throw Error('Attachment is invalid');const title=opt(l.title,'Attachment title',120)||'Report';
  if(l.type==='record'){if(typeof l.ref!=='string'||!/^[\w.\-]{1,120}\.(pdf|md)$/i.test(l.ref))throw Error('Attachment is invalid')}
  else if(l.type==='upload'){if(typeof l.ref!=='string'||!/^[0-9a-f-]{36}$/i.test(l.ref))throw Error('Attachment is invalid')}
  else if(l.type==='url'){if(typeof l.ref!=='string'||l.ref.length>500||!/^https:\/\/[^\s]+$/.test(l.ref))throw Error('Attachment is invalid')}
  else throw Error('Attachment is invalid');
  e.link={type:l.type,ref:l.ref,title}}
 if(v.kind==='temperature'){const t=Number(String(v.temperatureF).replace(',','.'));if(!Number.isFinite(t)||t<80||t>115)throw Error('Temperature must be between 80 and 115 °F');e.temperatureF=Math.round(t*10)/10}
 if(v.kind==='medication'&&!e.medicine)throw Error('Medicine is required');
 if(v.kind==='medication'&&!e.dose)throw Error('Dose is required');
 if(['care','status','note','symptom','visit','test'].includes(v.kind)&&!e.note)throw Error('Notes are required');
 return e;
}
export const listEvents=p=>EV.list(p);
export const listEpisodes=p=>EP.list(p);
const dateOk=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d);
export function validateEpisode(v,prev){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Episode must be an object');
 const m={...(prev||{}),...v};
 const title=opt(m.title,'Title',80);if(!title)throw Error('Title is required');
 const category=epCats.has(m.category)?m.category:'Illness';
 const summary=opt(m.summary,'Summary',3000);
 const startDate=dateOk(m.startDate)?m.startDate:new Date().toISOString().slice(0,10);
 const status=m.status==='resolved'?'resolved':'ongoing';
 let links;if(m.links!==undefined&&m.links!==null){if(!Array.isArray(m.links)||m.links.length>8)throw Error('Attachments are invalid');links=m.links.map(cleanLink)}
 let endDate=status==='resolved'?(dateOk(m.endDate)?m.endDate:new Date().toISOString().slice(0,10)):null;
 if(endDate&&endDate<startDate)endDate=startDate;
 const sb=m.summaryBy==='ai'?'ai':m.summary?'manual':undefined,sa=dateOk(m.summaryAt)?m.summaryAt:(sb?new Date().toISOString().slice(0,10):undefined),sc=Number.isInteger(m.summaryCount)&&m.summaryCount>=0?m.summaryCount:undefined;
 return {title,category,summary,...(summary&&sb?{summaryBy:sb,summaryAt:sa}:{}),...(summary&&sb==='ai'&&sc!==undefined?{summaryCount:sc}:{}),startDate,status,endDate,...(links&&links.length?{links}:{})};
}
export function addEpisode(p,v){const e={id:randomUUID(),...validateEpisode(v),createdAt:new Date().toISOString()};const all=listEpisodes(p);all.push(e);EP.replace(p,all);return e}
export function updateEpisode(p,id,v){const all=listEpisodes(p),i=all.findIndex(e=>e.id===id);if(i<0)return null;const prev=all[i],edited=typeof v.summary==='string'&&v.summary.trim()!==(prev.summary||'')&&v.summaryBy===undefined;
 const base=edited?{...prev,summaryBy:'manual',summaryAt:new Date().toISOString().slice(0,10),summaryCount:undefined}:prev;
 all[i]={...validateEpisode(v,base),id,createdAt:prev.createdAt};EP.replace(p,all);return all[i]}
export function deleteEpisode(p,id){return forMember(p).tx(()=>deleteEpisodeTx(p,id))}
function deleteEpisodeTx(p,id){const all=listEpisodes(p),i=all.findIndex(e=>e.id===id);if(i<0)return false;all.splice(i,1);EP.replace(p,all);const evs=listEvents(p).filter(e=>e.episodeId!==id);EV.replace(p,evs);return true}
function checkLink(p,e){if(e.link?.type==='upload'&&!IN.list(p).some(x=>x.id===e.link.ref))throw Error('Attached file not found')}
export function addEvent(p,v){const e={id:randomUUID(),...validateEvent(v)};if(e.episodeId&&!listEpisodes(p).some(x=>x.id===e.episodeId))throw Error('Episode not found');checkLink(p,e);const all=listEvents(p);all.push(e);EV.replace(p,all);return e}
export function updateEvent(p,id,v){const all=listEvents(p),i=all.findIndex(e=>e.id===id);if(i<0)return null;const n=validateEvent(v);if(n.episodeId&&!listEpisodes(p).some(x=>x.id===n.episodeId))throw Error('Episode not found');checkLink(p,n);all[i]={...all[i],...n,id};if(!('episodeId' in n))delete all[i].episodeId;if(!('link' in n))delete all[i].link;EV.replace(p,all);return all[i]}
export function deleteEvent(p,id){const all=listEvents(p),i=all.findIndex(e=>e.id===id);if(i<0)return false;all.splice(i,1);EV.replace(p,all);return true}
const pub=({id,category,episodeId,date,title,note,fileName,mimeType,size,createdAt,status})=>({id,category,episodeId,date,title,note,fileName,mimeType,size,createdAt,status});
export const listInbox=p=>IN.list(p).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(pub);
export async function addInbox(p,v){
 if(!v||typeof v!=='object')throw Error('Upload must be an object');
 if(!cats.has(v.category))throw Error('Record type is invalid');
 if(typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date))throw Error('Date is invalid');
 const title=opt(v.title,'Title',120),fileName=opt(v.fileName,'File name',180),note=opt(v.note,'Note',500);
 if(!title)throw Error('Title is required');if(!fileName)throw Error('File name is required');
 if(typeof v.mimeType!=='string'||!mimes.has(v.mimeType))throw Error('Use a JPG, PNG, WebP, HEIC or PDF file');
 if(typeof v.dataBase64!=='string'||!v.dataBase64)throw Error('File data is required');
 const buf=Buffer.from(v.dataBase64,'base64');if(!buf.length||buf.length>MAX_FILE)throw Error('File must be smaller than 8 MB');
 canWriteMember(p); // role and consent are checked before any file is written
 known(p); // unknown profiles are refused before anything is stored
 const id=randomUUID(),stored=id+mimes.get(v.mimeType),key=uploadKey(p,stored);await blobs().put(key,buf,{contentType:v.mimeType});
 const epId=typeof v.episodeId==='string'&&listEpisodes(p).some(x=>x.id===v.episodeId)?v.episodeId:undefined;
 const item={id,category:v.category,episodeId:epId,date:v.date,title,note,fileName,storedFileName:stored,mimeType:v.mimeType,size:buf.length,createdAt:new Date().toISOString(),status:'needs-review'};
 try{const all=IN.list(p);all.push(item);IN.replace(p,all)}catch(e){await blobs().delete(key).catch(()=>{});throw e}
 return pub(item);
}
// The stored file of one inbox item: {key,size,mime,name} or null; stream it with blobs().stream(key).
export async function inboxFile(p,id){
 const it=IN.list(p).find(x=>x.id===id);if(!it)return null;
 let key;try{key=uploadKey(p,it.storedFileName)}catch{return null}
 const st=await blobs().stat(key);return st?{key,size:st.size,mime:it.mimeType,name:it.fileName}:null;
}
export async function deleteInbox(p,id){
 const all=IN.list(p),i=all.findIndex(x=>x.id===id);if(i<0)return false;const [it]=all.splice(i,1);IN.replace(p,all);
 try{await blobs().delete(uploadKey(p,it.storedFileName))}catch{}return true;
}
