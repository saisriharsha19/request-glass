import {test,expect} from '@playwright/test';
test('incoming calendars are the default connection flow and their timed events join the agenda',async({page})=>{
 let connected=false;
 const user={id:'calendar-owner',username:'alex',name:'Alex'};
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user}}));
 await page.route('**/api/purchases',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 await page.route('**/api/calendar/sources**',r=>{if(r.request().method()==='POST')connected=true;if(r.request().method()==='DELETE')connected=false;return r.fulfill({json:{userId:user.id,sources:connected?[{id:'work',name:'Work calendar',last_checked:1,eventCount:1,error:null,events:[{id:'meeting',title:'Design review',start:new Date().toISOString(),end:new Date(Date.now()+3600000).toISOString(),allDay:false,floating:false,location:'Studio'}]}]:[]}})});
 await page.route('**/api/calendar/events?**',r=>r.fulfill({json:{userId:user.id,next:null,events:connected?[{id:'meeting',title:'Design review',start:new Date().toISOString(),end:new Date(Date.now()+3600000).toISOString(),allDay:false,location:'Studio',sourceId:'work',sourceName:'Work calendar',description:'Meeting notes',links:['https://meet.google.com/abc-defg-hij','javascript:alert(1)']}]:[]}}));
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.locator('[data-workspace="planner"]').click();await page.locator('#calendar-connect').click();
 await expect(page.getByRole('heading',{name:'Bring your calendars in'})).toBeVisible();
 await page.locator('#incoming-name').fill('Work calendar');await page.locator('#incoming-url').fill('https://outlook.office365.com/owa/calendar/example/calendar.ics');await page.getByRole('button',{name:'Connect this calendar'}).click();
 await expect(page.locator('#connected-source-list')).toContainText('Work calendar');
 await page.screenshot({path:'/tmp/tuckday-incoming-phone.png'});
 await page.locator('#incoming-close').click();await expect(page.locator('.external-event')).toContainText('Design review');await expect(page.locator('.external-event')).toContainText('Studio');
 await expect(page.getByRole('link',{name:'Join Google Meet'})).toHaveAttribute('href','https://meet.google.com/abc-defg-hij');
 await expect(page.locator('.external-event a')).toHaveCount(1);
 await expect(page.locator('.external-event button')).toHaveCount(0);
 await page.locator('#calendar-source-filter').selectOption('tuckday');await expect(page.locator('.external-event')).toHaveCount(0);
 await page.locator('#calendar-source-filter').selectOption('work');await expect(page.locator('.external-event')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('agenda follows local time, hides events ended today and advances without a reload',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3210',timezoneId:'Asia/Kolkata'});
 const page=await context.newPage();await page.clock.install({time:new Date('2026-09-15T10:30:00Z')});
 const user={id:'time-owner',username:'alex',name:'Alex'};
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/auth/session',r=>r.fulfill({json:{user}}));await page.route('**/api/purchases',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 const event=(id:string,start:string,end:string,allDay=false)=>({id,title:id,start,end,allDay,floating:false,location:''});
 const events=[event('Finished this afternoon','2026-09-15T08:00:00Z','2026-09-15T09:00:00Z'),event('Current meeting','2026-09-15T10:00:00Z','2026-09-15T11:00:00Z'),event('Later meeting','2026-09-15T12:00:00Z','2026-09-15T13:00:00Z'),event('All day today','2026-09-15','2026-09-16',true)];
 await page.route('**/api/calendar/sources**',r=>r.fulfill({json:{userId:user.id,sources:[{id:'work',name:'Work',eventCount:events.length,last_checked:1,error:null}]}}));
 await page.route('**/api/calendar/events?**',r=>r.fulfill({json:{userId:user.id,next:null,events:events.map(e=>({...e,sourceId:'work',sourceName:'Work'}))}}));
 await page.goto('/');await page.locator('[data-workspace="planner"]').click();
 await expect(page.locator('.external-event')).toHaveCount(3);
 await expect(page.locator('#agenda-list')).not.toContainText('Finished this afternoon');
 await expect(page.locator('[data-state="ongoing"]')).toContainText('Current meeting');
 await expect(page.locator('#calendar-timezone')).toContainText('Asia/');
 await page.clock.fastForward(35*60000);
 await expect(page.locator('.external-event')).toHaveCount(2);
 await expect(page.locator('#agenda-list')).not.toContainText('Current meeting');
 await page.locator('#agenda-filter').selectOption('completed');await expect(page.locator('.external-event')).toHaveCount(2);
 await expect(page.locator('#agenda-list')).toContainText('Finished this afternoon');
 await page.clock.fastForward(9*3600000); // Now after local midnight: the all-day entry has ended too.
 await expect(page.locator('.external-event')).toHaveCount(4);
 await context.close();
});

test('calendar pages load on demand and long content fits a narrow phone',async({page})=>{
 const user={id:'paged-owner',username:'alex',name:'Alex'};let requests=0;
 await page.setViewportSize({width:320,height:740});
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user}}));
 await page.route('**/api/purchases',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 await page.route('**/api/calendar/sources**',r=>r.fulfill({json:{userId:user.id,sources:[{id:'work',name:'Work',eventCount:101,last_checked:1}]}}));
 await page.route('**/api/calendar/events?**',r=>{requests++;const after=new URL(r.request().url()).searchParams.get('after');return r.fulfill({json:{userId:user.id,next:after?null:'page-two',events:Array.from({length:after?1:100},(_,i)=>({id:after?'last':String(i),title:'LongCalendarTitle'.repeat(12),start:new Date().toISOString(),end:new Date(Date.now()+3600000).toISOString(),sourceId:'work',sourceName:'Work',description:'Long details '.repeat(100),links:['https://example.com/meeting']}))}});});
 await page.goto('/');await expect(page.locator('[data-workspace="planner"]')).toBeEnabled();
 expect(requests).toBe(0);
 await page.locator('[data-workspace="planner"]').click();await expect(page.locator('.external-event')).toHaveCount(50);
 expect(requests).toBe(1);
 await page.locator('#agenda-more').click();await expect(page.locator('.external-event')).toHaveCount(100);
 expect(requests).toBe(2);
 await page.locator('#agenda-more').click();await expect(page.locator('.external-event')).toHaveCount(101);
 expect(requests).toBe(2);
 await page.locator('.event-details summary').first().click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
 expect(await page.locator('.agenda-event').first().evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.screenshot({path:'/tmp/tuckday-calendar-mobile.png'});
});
