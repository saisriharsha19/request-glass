import {api} from '/auth-client.js';
let owner = null, sources = [], running = false, generation = 0, pending = false, mutation = null;
let events=[], range='', next=null, eventBusy=false, eventError='', eventGeneration=0, snapshot='';
export function calendarPage(){return {next,busy:eventBusy,error:eventError};}
export function setCalendarRange(from,to){const value=`from=${from}&to=${to}`;if(value===range)return;range=value;resetEvents();}
function resetEvents(){eventGeneration++;events=[];next=null;eventBusy=false;eventError='';if(range&&owner)void loadCalendarPage();}
export async function loadCalendarPage(){
 if(eventBusy||!owner||!range)return;
 const current=eventGeneration, account=owner;eventBusy=true;eventError='';
 try{const result=await api('/api/calendar/events?'+range+(next?'&after='+encodeURIComponent(next):''));
 if(current!==eventGeneration||result.userId!==account)return;
 const seen=new Set(events.map(e=>e.sourceId+':'+e.id));events.push(...result.events.filter(e=>!seen.has(e.sourceId+':'+e.id)));next=result.next;
 }catch(error){if(current===eventGeneration)eventError=error.message;}
 finally{if(current===eventGeneration){eventBusy=false;notify();}}
}
const $ = s => document.querySelector(s);
export function connectedSources(userId) { return owner === userId ? sources : []; }
export function connectedEvents(userId) {
  return owner !== userId ? [] : events.map(event=>{
    const start = event.allDay ? null : new Date(event.floating ? event.start.replace(/Z$/,'') : event.start);
    const end = event.allDay ? null : new Date(event.floating ? event.end.replace(/Z$/,'') : event.end);
    const day = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const date = event.allDay ? event.start : day(start);
    const last = event.allDay ? (event.end > event.start ? new Date(new Date(event.end+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10) : date) : day(new Date(Math.max(start.getTime(),end.getTime()-1)));
    const now = Date.now();
    const completed = event.allDay ? last < day(new Date(now)) : end.getTime() <= now;
    const ongoing = !event.allDay && start.getTime() <= now && !completed;
    const time = event.allDay ? 'All day' : `${start.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} – ${end.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}${event.floating?' (calendar local time)':''}`;
    return {external:true,sourceId:event.sourceId,sourceName:event.sourceName,description:event.description,links:event.links,location:event.location,date,endDate:last,sort:event.start,key:event.id,completed,ongoing,label:(ongoing ? "Now · " : "") + time,p:{item:event.title}};
  });
}
function notify() {window.dispatchEvent(new Event('tuckday-calendars-changed'));}
function renderSources() {
  const list=$('#connected-source-list');list.replaceChildren();
  for(const source of sources) {
    const row=document.createElement('article');row.className='connected-source';
    const title=document.createElement('strong');title.textContent=source.name;
    const status=document.createElement('p');status.textContent=source.error || `${source.eventCount} ${source.eventCount === 1 ? "event" : "events"} · Updated ${source.last_checked ? new Date(source.last_checked).toLocaleString():'not yet'}`;
    if(source.error)status.className='error';
    const remove=document.createElement('button');remove.className='secondary';remove.textContent='Disconnect';remove.type='button';
    remove.onclick=()=>load('DELETE',`/${source.id}`);
    row.append(title,status,remove);list.append(row);
  }
  $('#incoming-empty').hidden=!!sources.length;
}
async function load(method='GET',path='',data) {
  if(running){if(method === "GET")pending=true;else mutation={method,path,data,generation};return;}
  const current = generation;
  running=true;
  $('#incoming-status').textContent=method==='GET'?'Loading connected calendars…':'Updating calendars…';
  for(const button of document.querySelectorAll('#incoming-calendar-dialog button:not([data-close])'))button.disabled=true;
  try {
    const result=await api('/api/calendar/sources'+path,{method,...(method==='GET'?{}:{headers:{'Content-Type':'application/json',...(owner ? {'X-Account-ID':owner} : {})},body:JSON.stringify(data||{})})});
    if(current !== generation)return;
    owner=result.userId;sources=result.sources;
    const version=owner+JSON.stringify(sources.map(s=>[s.id,s.last_checked]));if(version!==snapshot){snapshot=version;resetEvents();}
    $('#incoming-signin').hidden=true;$('#incoming-form').hidden=false;
    $('#incoming-status').textContent=sources.some(s=>s.error)?'Some calendars need attention. Their last successful events are kept.':'Calendars are read into Tuckday. Background refresh keeps checking for changes.';
    if(method==='POST'&&!path)$('#incoming-form').reset();
    renderSources();notify();
  } catch(error) {
    if(current !== generation)return;
    $('#incoming-status').textContent=error.message;
    if(error.status===401) {owner=null;sources=[];snapshot="";resetEvents();renderSources();notify();$('#incoming-signin').hidden=false;$('#incoming-form').hidden=true;}
  } finally {
    running=false;
    if(mutation){const next=mutation;mutation=null;if(next.generation===generation)queueMicrotask(()=>void load(next.method,next.path,next.data));}
    else if(pending){pending=false;queueMicrotask(()=>void load());}
    for(const button of document.querySelectorAll('#incoming-calendar-dialog button:not([data-close])'))button.disabled=false;
  }
}
$('#calendar-connect').onclick=()=>{$('#incoming-calendar-dialog').showModal();void load();};
$('#incoming-close').onclick=()=>$('#incoming-calendar-dialog').close();
$('#incoming-refresh').onclick=()=>load('POST','/refresh');
$('#incoming-form').onsubmit=event=>{event.preventDefault();void load('POST','',{name:$('#incoming-name').value,url:$('#incoming-url').value});};
$('#calendar-share').onclick=()=>{$('#incoming-calendar-dialog').close();window.dispatchEvent(new Event('tuckday-share-calendar'));};
void load();
setInterval(()=>{if(!document.hidden && !$('#incoming-calendar-dialog').open)void load();},60000);
window.addEventListener('focus',()=>{if(!$('#incoming-calendar-dialog').open)void load();});
window.addEventListener('tuckday-account-changed',event=>{if(owner===event.detail?.userId)return;generation++;if(owner)$('#incoming-form').reset();owner=null;sources=[];snapshot="";resetEvents();renderSources();notify();void load();});
window.addEventListener('online',()=>void load());
window.addEventListener('pageshow',()=>void load());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});
