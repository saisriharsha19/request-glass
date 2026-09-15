import {test,expect} from 'bun:test';
import {localDatabase} from '../../local-db';
import {accountApi} from '../../account-api';
import {sourceApi,refreshSource} from '../../calendar-sources';
const schema=(await Promise.all(['0001_accounts.sql','0002_calendar_subscriptions.sql','0003_calendar_sources.sql'].map(file=>Bun.file('migrations/'+file).text()))).join('\n');
test('incoming sources sync snapshots, keep data on failure, deduplicate and isolate accounts',async()=>{
 const env={DB:localDatabase(':memory:',schema)},origin='https://test.example';
 async function register(username:string){const res=(await accountApi(new Request(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,name:username,password:'test-password-123456'})}),env))!;return res.headers.get('set-cookie')!.split(';')[0];}
 const alice=await register('alice'),bob=await register('bob');
 let title='Original meeting';
 const fake=(async()=>new Response(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:${new Date().toISOString().slice(0,10).replaceAll('-','')}T120000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`));
 async function call(cookie:string,method='GET',suffix='',body={}){return (await sourceApi(new Request(origin+'/api/calendar/sources'+suffix,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})}),env,fake))!;}
 expect((await call('')).status).toBe(401);
 const body={name:'Work',url:'https://outlook.office365.com/owa/calendar/example/calendar.ics'};
 const added=await (await call(alice,'POST','',body)).json();
 expect(added.sources).toHaveLength(1);expect(added.sources[0].events[0].title).toBe('Original meeting');expect(added.sources[0].url).toBeUndefined();
 const id=added.sources[0].id;
 const stale=(await sourceApi(new Request(origin+"/api/calendar/sources/"+id,{method:"DELETE",headers:{Cookie:bob,Origin:origin,"Content-Type":"application/json","X-Account-ID":added.userId},body:"{}"}),env,fake))!;
 expect(stale.status).toBe(409);
 expect((await (await call(bob)).json()).sources).toHaveLength(0);
 await call(bob,'DELETE','/'+id);expect((await (await call(alice)).json()).sources).toHaveLength(1);
 await call(alice,'POST','',body);expect((await (await call(alice)).json()).sources).toHaveLength(1);
 title='Updated meeting';await env.DB.prepare('UPDATE calendar_sources SET last_attempt=0 WHERE id=?').bind(id).run();
 const updated=await (await call(alice,'POST','/refresh')).json();expect(updated.sources[0].events[0].title).toBe(title);
 await env.DB.prepare('UPDATE calendar_sources SET last_attempt=0 WHERE id=?').bind(id).run();
 await refreshSource(env.DB,{id,url:body.url},true,(async()=>{throw new Error('network failure with secret URL');}));
 const failed=await (await call(alice)).json();expect(failed.sources[0].events[0].title).toBe(title);expect(failed.sources[0].error).not.toContain('secret URL');
 await call(alice,'DELETE','/'+id);expect((await (await call(alice)).json()).sources).toHaveLength(0);
});
