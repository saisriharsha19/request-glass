import {api} from '/auth-client.js';
let owner = null, sources = [], running = false, generation = 0, pending = false;
const $ = s => document.querySelector(s);
export function connectedSources(userId) { return owner === userId ? sources : []; }
export function connectedEvents(userId) {
  return connectedSources(userId).flatMap(source=>source.events.map(event=>{
    const start = event.allDay ? null : new Date(event.floating ? event.start.replace(/Z$/,'') : event.start);
    const end = event.allDay ? null : new Date(event.floating ? event.end.replace(/Z$/,'') : event.end);
    const day = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const date = event.allDay ? event.start : day(start);
    const last = event.allDay ? (event.end > event.start ? new Date(new Date(event.end+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10) : date) : day(new Date(Math.max(start.getTime(),end.getTime()-1)));
    const time = event.allDay ? 'All day' : `${start.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} – ${end.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}${event.floating?' (calendar local time)':''}`;
    return {external:true,sourceId:source.id,sourceName:source.name,location:event.location,date,endDate:last,sort:event.start,key:event.id,completed:false,label:time,p:{item:event.title}};
  }));
}
function notify() {window.dispatchEvent(new Event('tuckday-calendars-changed'));}
function renderSources() {
  const list=$('#connected-source-list');list.replaceChildren();
  for(const source of sources) {
    const row=document.createElement('article');row.className='connected-source';
    const title=document.createElement('strong');title.textContent=source.name;
    const status=document.createElement('p');status.textContent=source.error || `${source.events.length} ${source.events.length === 1 ? "event" : "events"} · Updated ${source.last_checked ? new Date(source.last_checked).toLocaleString():'not yet'}`;
    if(source.error)status.className='error';
    const remove=document.createElement('button');remove.className='secondary';remove.textContent='Disconnect';remove.type='button';
    remove.onclick=()=>load('DELETE',`/${source.id}`);
    row.append(title,status,remove);list.append(row);
  }
  $('#incoming-empty').hidden=!!sources.length;
}
async function load(method='GET',path='',data) {
  if(running){pending=true;return;}
  const current = generation;
  running=true;
  $('#incoming-status').textContent=method==='GET'?'Loading connected calendars…':'Updating calendars…';
  for(const button of document.querySelectorAll('#incoming-calendar-dialog button:not([data-close])'))button.disabled=true;
  try {
    const result=await api('/api/calendar/sources'+path,{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json',...(owner ? {'X-Account-ID':owner} : {})},body:JSON.stringify(data||{})})});
    if(current !== generation)return;
    owner=result.userId;sources=result.sources;
    $('#incoming-signin').hidden=true;$('#incoming-form').hidden=false;
    $('#incoming-status').textContent=sources.some(s=>s.error)?'Some calendars need attention. Their last successful events are kept.':'Calendars are read into Tuckday. Background refresh keeps checking for changes.';
    if(method==='POST'&&!path)$('#incoming-form').reset();
    renderSources();notify();
  } catch(error) {
    if(current !== generation)return;
    $('#incoming-status').textContent=error.message;
    if(error.status===401) {owner=null;sources=[];renderSources();notify();$('#incoming-signin').hidden=false;$('#incoming-form').hidden=true;}
  } finally {
    running=false;
    if(pending){pending=false;queueMicrotask(()=>void load());}
    for(const button of document.querySelectorAll('#incoming-calendar-dialog button:not([data-close])'))button.disabled=false;
  }
}
$('#calendar-connect').onclick=()=>{$('#incoming-calendar-dialog').showModal();void load();};
$('#incoming-close').onclick=()=>$('#incoming-calendar-dialog').close();
$('#incoming-refresh').onclick=()=>load('POST','/refresh');
$('#incoming-form').onsubmit=event=>{event.preventDefault();void load('POST','',{name:$('#incoming-name').value,url:$('#incoming-url').value});};
$('#calendar-share').onclick=()=>{$('#incoming-calendar-dialog').close();window.dispatchEvent(new Event('tuckday-share-calendar'));};
void load();
setInterval(()=>{if(!document.hidden)void load();},60000);
window.addEventListener('focus',()=>void load());
window.addEventListener('tuckday-account-changed',()=>{generation++;owner=null;sources=[];$('#incoming-form').reset();renderSources();notify();void load();});
window.addEventListener('online',()=>void load());
window.addEventListener('pageshow',()=>void load());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
