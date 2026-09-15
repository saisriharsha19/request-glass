import {test,expect} from 'bun:test';
import {calendarURL,readCalendar,fetchCalendar} from '../../calendar-reader';
const now=new Date('2026-09-15T00:00:00Z');
const wrap=(body:string)=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body.replaceAll('\n','\r\n')}\r\nEND:VCALENDAR\r\n`;
test('incoming calendars include timed, all-day and recurring events with exclusions and moved instances',()=>{
 const events=readCalendar(wrap(`BEGIN:VEVENT
UID:weekly
DTSTART:20260915T090000Z
DTEND:20260915T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20260922T090000Z
SUMMARY:Team meeting
END:VEVENT
BEGIN:VEVENT
UID:weekly
RECURRENCE-ID:20260929T090000Z
DTSTART:20260929T110000Z
DTEND:20260929T120000Z
SUMMARY:Moved meeting
END:VEVENT
BEGIN:VEVENT
UID:day
DTSTART;VALUE=DATE:20260916
DTEND;VALUE=DATE:20260918
SUMMARY:Two-day trip
END:VEVENT`),now);
 expect(events).toHaveLength(4);
 expect(events.find(e=>e.title==='Moved meeting')!.start).toBe('2026-09-29T11:00:00.000Z');
 expect(events.find(e=>e.title==='Two-day trip')).toMatchObject({allDay:true,start:'2026-09-16',end:'2026-09-18'});
 expect(events.some(e=>e.start.startsWith('2026-09-22'))).toBe(false);
});
test('IANA zones without VTIMEZONE keep local appointment times across daylight changes',()=>{
 const events=readCalendar(wrap(`BEGIN:VEVENT
UID:zone
DTSTART;TZID=America/New_York:20261030T090000
DTEND;TZID=America/New_York:20261030T100000
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Morning
END:VEVENT`),now);
 expect(events[0].start).toBe('2026-10-30T13:00:00.000Z');
 expect(events[3].start).toBe('2026-11-02T14:00:00.000Z');
});
test('unsafe targets and Outlook HTML sharing links are rejected',()=>{
 for(const url of ['http://127.0.0.1/test.ics','https://localhost/test.ics','https://calendar.google.com.evil.example/calendar/ical/x','https://outlook.office365.com/owa/calendar/foo/calendar.html','https://user:pass@calendar.google.com/calendar/ical/x'])expect(()=>calendarURL(url)).toThrow();
 expect(calendarURL('https://outlook.office365.com/owa/calendar/example/calendar.ics')).toContain('calendar.ics');
 expect(()=>readCalendar('<html>Sign in</html>',now)).toThrow('ICS calendar');
});
test('cancelled occurrences disappear without losing other reminders',()=>{
 const events=readCalendar(wrap(`BEGIN:VEVENT
UID:recur
DTSTART:20260915T090000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Meeting
END:VEVENT
BEGIN:VEVENT
UID:recur
RECURRENCE-ID:20260916T090000Z
DTSTART:20260916T090000Z
STATUS:CANCELLED
SUMMARY:Meeting
END:VEVENT`),now);
 expect(events).toHaveLength(1);
});
test('provider redirects are handled manually and never followed to an untrusted target',async()=>{
 let calls=0;
 await expect(fetchCalendar('https://calendar.google.com/calendar/ical/example',async (_url,init)=>{calls++;expect(init?.redirect).toBe("manual");return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}})})).rejects.toThrow('redirected');
 expect(calls).toBe(1);
});
