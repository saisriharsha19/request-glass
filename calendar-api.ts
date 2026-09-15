import { accountIdentity, randomToken, type AuthEnv } from './auth';
import { calendar } from './public/logic.js';
import { apiJson } from './account-api';

export async function calendarApi(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/calendar/')) return null;
  if (!env.DB) return apiJson({ error: 'Sign in on the current Cloudflare app to connect calendars.' }, 503);
  const db = env.DB;
  const feed = url.pathname.match(/^\/api\/calendar\/feed\/([a-f0-9]{64})\.ics$/);
  try {
    if (feed && ['GET', 'HEAD'].includes(request.method)) {
      const subscription: any = await db.prepare('SELECT user_id FROM calendar_subscriptions WHERE token=?').bind(feed[1]).first();
      if (!subscription) return apiJson({error: 'This calendar link is unavailable or has been disconnected.'}, 404);
      const rows = await db.prepare('SELECT payload,version FROM purchases WHERE user_id=? AND deleted=0').bind(subscription.user_id).all<any>();
      // A subscription exposes only reminder titles/dates, never receipt text or notes.
      const purchases = rows.results.map(row => ({...JSON.parse(row.payload), notes: '', merchant: '', text: '', _version: row.version}));
      const text = calendar(purchases).text.replace('CALSCALE:GREGORIAN\r\n', 'CALSCALE:GREGORIAN\r\nX-WR-CALNAME:ReturnRadar reminders\r\n');
      return new Response(request.method === 'HEAD' ? null : text, { headers: {
        'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="returnradar.ics"', 'X-Content-Type-Options': 'nosniff',
      }});
    }
    if (url.pathname !== '/api/calendar/subscription') return apiJson({error: 'Not found'}, 404);
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) return apiJson({error: 'Method not allowed'}, 405);
    if (request.method !== 'GET' && (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')))
      return apiJson({error: 'Open ReturnRadar to change calendar sharing.'}, 403);
    const user = await accountIdentity(request, env);
    if (!user) return apiJson({error: 'Sign in to connect your saved reminders to a calendar.'}, 401);
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM calendar_subscriptions WHERE user_id=?').bind(user.id).run();
      return apiJson({url: null});
    }
    if (request.method === 'POST') await db.prepare('INSERT OR IGNORE INTO calendar_subscriptions(user_id,token,created_at) VALUES (?,?,?)').bind(user.id, randomToken(), Date.now()).run();
    const row: any = await db.prepare('SELECT token FROM calendar_subscriptions WHERE user_id=?').bind(user.id).first();
    return apiJson({url: row ? `${url.origin}/api/calendar/feed/${row.token}.ics` : null});
  } catch {
    return apiJson({error: 'Could not reach your calendar. Please retry.'}, 503);
  }
}
