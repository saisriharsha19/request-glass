import ICAL from 'ical.js';
export type ExternalEvent = {id:string; title:string; start:string; end:string; allDay:boolean; floating:boolean; location:string};
// Provider feeds only: private network targets, arbitrary redirect destinations and credentials are rejected.
export function calendarURL(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste the calendar’s ICS subscription URL.');
  const url = new URL(value.trim().replace(/^webcal:/i,'https:'));
  const host = url.hostname.toLowerCase();
  const allowed = (host === 'calendar.google.com' && url.pathname.startsWith('/calendar/ical/')) ||
    (['outlook.office365.com','outlook.office.com','outlook.live.com'].includes(host) && url.pathname.startsWith('/owa/calendar/')) ||
    (/^p\d+-caldav\.icloud\.com$/.test(host) && url.pathname.startsWith('/published/'));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed || /\.html$/i.test(url.pathname))
    throw new Error('Use an HTTPS ICS feed from Google Calendar, Outlook or iCloud. For Outlook, copy ICS rather than HTML.');
  url.hash = '';
  return url.href;
}
function instant(time: any, zone: string | null) {
  if (time.isDate) return time.toString();
  if (time.zone.tzid !== 'floating' || !zone) return time.toJSDate().toISOString();
  // Some feeds use an IANA TZID without embedding VTIMEZONE. Resolve its wall time with Intl.
  let estimate = Date.UTC(time.year,time.month-1,time.day,time.hour,time.minute,time.second);
  const target = estimate;
  const format = new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++) {
    const parts:any = Object.fromEntries(format.formatToParts(new Date(estimate)).map(p=>[p.type,p.value]));
    const displayed = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    const correction = target-displayed;
    estimate += correction;
    if(!correction) break;
  }
  return new Date(estimate).toISOString();
}
export function readCalendar(text: string, now = new Date()) {
  if (!/^BEGIN:VCALENDAR\s*$/im.test(text) || !/^END:VCALENDAR\s*$/im.test(text)) throw new Error('The link did not return an ICS calendar. Check its sharing settings.');
  const root = new ICAL.Component(ICAL.parse(text));
  const components = root.getAllSubcomponents('vevent');
  if (components.length > 3000) throw new Error('This calendar has over 3,000 entries. Publish a smaller date range.');
  const events = components.map(c=>new ICAL.Event(c,{exceptions: []}));
  const exceptions = new Map<string, any[]>();
  for(const event of events) if(event.isRecurrenceException()) exceptions.set(event.uid,[...(exceptions.get(event.uid)||[]),event]);
  const from = new Date(now.getTime()-31*86400000).toISOString();
  const until = new Date(now.getTime()+366*86400000).toISOString();
  const result: ExternalEvent[] = [];
  let iterations = 0;
  function add(event:any, start:any, end:any, recurrenceID:string) {
    if(event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const zone = event.component.getFirstProperty('dtstart')?.getParameter('tzid') || null;
    const beginning = instant(start,zone), ending = instant(end,zone);
    if(ending < from.slice(0,beginning.length===10?10:24) || beginning > until.slice(0,beginning.length===10?10:24)) return;
    result.push({id:`${event.uid}:${recurrenceID}`,title:(event.summary||'Untitled event').slice(0,300),start:beginning,end:ending,allDay:start.isDate,floating:!start.isDate&&!zone&&start.zone.tzid==='floating',location:(event.location||'').slice(0,300)});
    if(result.length>1500) throw new Error('This calendar has over 1,500 occurrences in the coming year. Publish a smaller calendar.');
  }
  for(const event of events) {
    if(event.isRecurrenceException()) continue;
    if(!event.startDate || !event.uid) continue;
    if(event.isRecurring()) {
      for(const exception of exceptions.get(event.uid)||[]) event.relateException(exception);
      const iterator = event.iterator();
      let next;
      while((next=iterator.next())) {
        if(++iterations>20000) throw new Error('This recurrence is too large to expand safely. Narrow the published calendar range.');
        if(next.toString().slice(0,10)>until.slice(0,10)) break;
        const details = event.getOccurrenceDetails(next);
        add(details.item,details.startDate,details.endDate,next.toString());
      }
    } else add(event,event.startDate,event.endDate,event.startDate.toString());
  }
  return result.sort((a,b)=>a.start.localeCompare(b.start));
}
export async function fetchCalendar(url:string, fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch) {
  let response;
  try {response = await fetcher(calendarURL(url), {redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'text/calendar'}});} catch(error) {throw new Error(error instanceof Error && /Timeout|Abort/.test(error.name) ? 'Calendar provider timed out. Retry in a moment.' : 'Calendar provider connection failed. Check the HTTPS subscription link.');}
  if(response.status >= 300 && response.status < 400) throw new Error('Calendar provider redirected the link. Copy its direct HTTPS ICS subscription address.');
  if(!response.ok) throw new Error(`Calendar provider returned HTTP ${response.status}. Check that the ICS link is still published.`);
  if(Number(response.headers.get('content-length'))>1000000) throw new Error('Calendar exceeds the 1 MB limit. Publish a smaller range.');
  const reader=response.body?.getReader();if(!reader) throw new Error('Calendar provider returned an empty response.');
  const decoder=new TextDecoder();let size=0,text='';
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();throw new Error('Calendar exceeds the 1 MB limit. Publish a smaller range.');}text+=decoder.decode(value,{stream:true});}} finally {reader.releaseLock();}
  text+=decoder.decode();
  try {return readCalendar(text);} catch(error) {
    if(error instanceof Error && /^(This|The link)/.test(error.message)) throw error;
    throw new Error('Calendar contents could not be parsed. Check that this is a supported ICS feed.');
  }
}
