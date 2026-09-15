import {accountIdentity,type AuthEnv} from './auth';
import {apiJson,readBody} from './account-api';
import {calendarURL,fetchCalendar} from './calendar-reader';
import type {AccountDatabase} from './database';
export async function refreshSource(db:AccountDatabase, source:any, force=false, fetcher: (input: string, init?: RequestInit) => Promise<Response>=fetch) {
  const now=Date.now();
  const claimed=await db.prepare('UPDATE calendar_sources SET last_attempt=? WHERE id=? AND last_attempt<?').bind(now,source.id,now-(force?60000:15*60000)).run();
  if(!claimed.meta.changes) return;
  try {
    const events=await fetchCalendar(source.url,fetcher);
    await db.prepare('UPDATE calendar_sources SET events=?,last_checked=?,error=NULL WHERE id=? AND last_attempt=?').bind(JSON.stringify(events),Date.now(),source.id,now).run();
  } catch(error) {
    // Keep the last successful snapshot. Never replace it with an empty result on failure.
    const message=error instanceof Error && /^(Calendar|This|The link|Use an|Paste)/.test(error.message)?error.message:'Calendar could not refresh. Check the published ICS link or try again later.';
    await db.prepare('UPDATE calendar_sources SET error=? WHERE id=? AND last_attempt=?').bind(message,source.id,now).run();
  }
}
export async function refreshDueCalendars(env:AuthEnv) {
  if(!env.DB)return;
  const due=await env.DB.prepare('SELECT id,url FROM calendar_sources WHERE last_attempt<? ORDER BY last_attempt LIMIT 10').bind(Date.now()-15*60000).all();
  for(const source of due.results) await refreshSource(env.DB,source);
}
export async function sourceApi(request:Request,env:AuthEnv,fetcher: (input: string, init?: RequestInit) => Promise<Response>=fetch):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/calendar/sources'))return null;
  if(!env.DB)return apiJson({error:'Sign in on the current app to connect calendars.'},503);
  const db=env.DB;
  if(!['GET','POST','DELETE'].includes(request.method))return apiJson({error:'Method not allowed'},405);
  if(request.method!=='GET'&&(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')))return apiJson({error:'Open Tuckday to connect a calendar.'},403);
  const user=await accountIdentity(request,env);if(!user)return apiJson({error:'Sign in to bring your calendars into Tuckday.'},401);
  if(request.headers.get('x-account-id') && request.headers.get('x-account-id') !== user.id) return apiJson({error:'The signed-in account changed. Reopen Connect calendar before making changes.'},409);
  try {
    if(path==='/api/calendar/sources'&&request.method==='POST') {
      const body=await readBody(request,4096);let url;
      try{url=calendarURL(body.url);}catch(error){return apiJson({error:error instanceof Error?error.message:'Use a valid ICS link.'},400);}
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>60)return apiJson({error:'Give this calendar a name of up to 60 characters.'},400);
      const count:any=await db.prepare('SELECT count(*) AS count FROM calendar_sources WHERE user_id=?').bind(user.id).first();
      if(count.count>=10)return apiJson({error:'You can connect up to 10 calendars.'},400);
      await db.prepare('INSERT OR IGNORE INTO calendar_sources(id,user_id,name,url) SELECT ?,?,?,? WHERE (SELECT count(*) FROM calendar_sources WHERE user_id=?)<10').bind(crypto.randomUUID(),user.id,body.name.trim(),url,user.id).run();
      const source=await db.prepare('SELECT id,url FROM calendar_sources WHERE user_id=? AND url=?').bind(user.id,url).first();
      if(!source)return apiJson({error:"You can connect up to 10 calendars."},400);
      await refreshSource(db,source,true,fetcher);
    } else if(path==='/api/calendar/sources/refresh'&&request.method==='POST') {
      const sources=await db.prepare('SELECT id,url FROM calendar_sources WHERE user_id=?').bind(user.id).all();
      await Promise.all(sources.results.map(source=>refreshSource(db,source,true,fetcher)));
    } else if(request.method==='DELETE') {
      const id=path.slice('/api/calendar/sources/'.length);
      await db.prepare('DELETE FROM calendar_sources WHERE id=? AND user_id=?').bind(id,user.id).run();
    } else if(path!=='/api/calendar/sources'||request.method!=='GET') return apiJson({error:'Not found'},404);
    const sources=await db.prepare('SELECT id,name,events,last_checked,last_attempt,error FROM calendar_sources WHERE user_id=? ORDER BY name,id').bind(user.id).all<any>();
    return apiJson({userId:user.id,sources:sources.results.map(row=>({...row,events:JSON.parse(row.events)}))});
  } catch {return apiJson({error:'Could not load connected calendars. Please retry.'},503);}
}
