// Pages owns the public address and static assets; the existing Worker owns accounts,
// D1 and NIM. Cookies remain host-only at the address opened by the user.
const backend = 'https://return-radar.return-radar.workers.dev';
export function createFrontend(fetcher: (request: Request) => Promise<Response> = fetch) {
  return {
    async fetch(request: Request, env: {ASSETS: {fetch(request: Request): Promise<Response>}}) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') return env.ASSETS.fetch(request);
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin)
        return Response.json({error: 'Open Tuckday to make this change.'}, {status: 403});
      const target = new URL(url.pathname + url.search, backend);
      const headers = new Headers(request.headers);
      headers.delete('host');
      // Validate the real browser origin above before translating this trusted hop.
      if (headers.has('origin')) headers.set('origin', backend);
      const response = await fetcher(new Request(target, {
        method: request.method, headers, body: request.body,
        redirect: 'manual', signal: request.signal,
      }));
      if (url.pathname === '/api/calendar/subscription' && response.ok) {
        const result = await response.json() as {url: string | null};
        if (result.url) result.url = result.url.replace(backend, url.origin);
        return Response.json(result, {status: response.status, headers: response.headers});
      }
      return response;
    },
  };
}
export default createFrontend();
