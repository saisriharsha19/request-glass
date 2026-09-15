import { sourceApi, refreshDueCalendars } from "./calendar-sources";
import { calendarApi } from "./calendar-api";
import { extractWithNim, validImages } from "./ai";
import { accountIdentity, securityHeaders, type AuthEnv } from "./auth";
import { accountApi, readBody } from "./account-api";
export interface Env extends AuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  NVIDIA_VISION_MODEL?: string;
  AI_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export default {
  async scheduled(_controller: unknown, env: Env) { await refreshDueCalendars(env); },
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      url.protocol = "https:";
      return Response.redirect(url.href, 308);
    }
    if (url.pathname === "/healthz")
      return new Response("ok", { headers: securityHeaders(env) });
    const sourceResponse = await sourceApi(request, env);
    if(sourceResponse) return sourceResponse;
    const calendarResponse = await calendarApi(request, env);
    if (calendarResponse) return calendarResponse;
    const accountResponse = await accountApi(request, env);
    if (accountResponse) return accountResponse;
    if (url.pathname === "/api/ai/extract" && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin)
        return json({ error: "Open the app to use receipt assistance." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "Send receipt text as JSON." }, 415);
      if (!env.DB || !env.NVIDIA_API_KEY)
        return json(
          {
            error:
              "AI assistance isn’t connected yet. Local scanning still works.",
          },
          503,
        );
      const user = await accountIdentity(request, env);
      if (!user)
        return json(
          {
            error:
              "Sign in from Your account before using AI assistance. Local scanning still works.",
          },
          401,
        );
      if(request.headers.get('x-account-id') && request.headers.get('x-account-id')!==user.id)return json({error:'Your account changed. Reopen the form before using AI.'},409);
      // Cloudflare's per-location limiter is an abuse guard, not a billing cap.
      if (
        !env.AI_RATE_LIMITER ||
        !(await env.AI_RATE_LIMITER.limit({ key: user.id })).success
      )
        return json(
          { error: "AI assistance is busy. Please try again in a minute." },
          429,
        );
      let body;
      try {
        body = await readBody(request);
      } catch (error) {
        return json(
          { error: "Use a receipt under 1.5 MB." },
          error instanceof Error && error.message === "too-large" ? 413 : 400,
        );
      }
      if (
        !body ||
        typeof body.text !== "string" ||
        (!body.text.trim() && !body.images?.length) ||
        body.text.length > 50000 ||
        !validImages(body.images ?? [])
      )
        return json(
          {
            error:
              "Use up to 50,000 characters and one prepared receipt image under 1.2 MB.",
          },
          400,
        );
      try {
        const notices: string[]=[];
        const fields = await extractWithNim(
          body.text,
          env.NVIDIA_API_KEY,
          env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b",
          fetch,
          body.images ?? [],
          env.NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct",
          notices,
        );
        return json({ fields, notices });
      } catch {
        return json(
          {
            error:
              "AI assistance couldn’t read this receipt right now. Your entries are unchanged.",
          },
          502,
        );
      }
    }
    if (url.pathname.startsWith("/api/"))
      return json({ error: "Not found" }, 404);
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(securityHeaders(env)))
      response.headers.set(name, value);
    return response;
  },
};
