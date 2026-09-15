import {test, expect} from 'bun:test';
import {createFrontend} from '../../pages-worker';
test('Pages rejects foreign-origin writes before forwarding cookies and preserves authentication', async () => {
  const forwarded: Request[] = [];
  const frontend = createFrontend(async (request: any) => {forwarded.push(request);return new Response('{}', {headers: {'Set-Cookie':'session=test; Secure; HttpOnly; Path=/'}})});
  const env = {ASSETS:{fetch: async () => new Response('asset')}};
  const bad = await frontend.fetch(new Request('https://tuckday.pages.dev/api/auth/login', {method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}), env);
  expect(bad.status).toBe(403);expect(forwarded).toHaveLength(0);
  const good = await frontend.fetch(new Request('https://tuckday.pages.dev/api/auth/login', {method:'POST',headers:{Origin:'https://tuckday.pages.dev',Cookie:'session=existing'},body:'{}'}), env);
  expect(forwarded[0].url).toBe('https://return-radar.return-radar.workers.dev/api/auth/login');
  expect(forwarded[0].headers.get('origin')).toBe('https://return-radar.return-radar.workers.dev');
  expect(forwarded[0].headers.get('cookie')).toBe('session=existing');
  expect(good.headers.get('set-cookie')).toContain('HttpOnly');
});
test('Pages rewrites subscription URLs without retaining stale body encoding or length', async () => {
  const frontend = createFrontend(async () => new Response(JSON.stringify({url:'https://return-radar.return-radar.workers.dev/api/calendar/feed/example.ics'}),{headers:{'Content-Type':'application/json','Content-Length':'999','Content-Encoding':'gzip',ETag:'old'}}));
  const response = await frontend.fetch(new Request('https://tuckday.pages.dev/api/calendar/subscription'),{ASSETS:{fetch:async()=>new Response('asset')}});
  expect((await response.json()).url).toBe('https://tuckday.pages.dev/api/calendar/feed/example.ics');
  expect(response.headers.get('content-length')).toBeNull();
  expect(response.headers.get('content-encoding')).toBeNull();
  expect(response.headers.get('etag')).toBeNull();
});
