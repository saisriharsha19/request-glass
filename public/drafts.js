const limits={item:180,merchant:100,purchased:10,amount:20,currency:3,return:10,cancel:10,warranty:10,price:10,reminder:10,reminderLabel:80,notes:3000,category:30,tags:309,leadDays:3};
const memory=new Map();
const storageKey=owner=>`tuckday:drafts:v1:${owner||'guest'}`;
function read(owner){if(memory.has(owner))return structuredClone(memory.get(owner));try{const data=JSON.parse(sessionStorage.getItem(storageKey(owner))||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}}
function write(owner,data){memory.set(owner,structuredClone(data));try{sessionStorage.setItem(storageKey(owner),JSON.stringify(data));return true;}catch{return false;}}
/** @returns {Record<string, string|boolean>} */
export function draftValues(raw){/** @type {Record<string,string|boolean>} */ const values={};for(const [key,max] of Object.entries(limits))if(typeof raw?.[key]==='string')values[key]=raw[key].slice(0,max);values.favorite=raw?.favorite===true;return values;}
export function readDraft(owner,id,version){const draft=read(owner)[id||'new'];if(!draft||draft.version!==version||!Number.isFinite(draft.updated)||Date.now()-draft.updated>7*86400000)return null;return {...draft,values:draftValues(draft.values),touched:Array.isArray(draft.touched)?draft.touched.filter(key=>key in limits):[]};}
export function saveDraft(owner,id,draft){const data=read(owner);data[id||'new']={...draft,values:draftValues(draft.values),updated:Date.now()};const keys=Object.keys(data).sort((a,b)=>data[b].updated-data[a].updated);for(const key of keys.slice(20))delete data[key];return write(owner,data);}
export function removeDraft(owner,id){const data=read(owner);delete data[id||'new'];write(owner,data);}
export function setOpenDraft(owner,id){try{if(id===undefined)sessionStorage.removeItem(storageKey(owner)+':open');else sessionStorage.setItem(storageKey(owner)+':open',id||'new');}catch{}}
export function getOpenDraft(owner){try{return sessionStorage.getItem(storageKey(owner)+':open');}catch{return null;}}
