import { extractWithNim, validImages } from "./ai";
import {
  accountIdentity,
  authConfig,
  securityHeaders,
  type AuthEnv,
} from "./auth";
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
// Bound streamed bodies as well as Content-Length; files never reach storage.
export async function readBody(request: Request, maxBytes = 1500000) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export default {
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
    if (url.pathname === "/api/auth/config" && request.method === "GET")
      return json({
        auth: authConfig(env),
        sync: "local-only",
        aiRequiresLogin: true,
      });
    if (url.pathname === "/api/account" && request.method === "GET") {
      const user = await accountIdentity(request, env);
      return user
        ? json({ user, sync: "local-only" })
        : json({ error: "Sign in to view your account." }, 401);
    }
    if (url.pathname === "/api/ai/extract" && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin)
        return json({ error: "Open the app to use receipt assistance." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "Send receipt text as JSON." }, 415);
      if (!authConfig(env) || !env.NVIDIA_API_KEY)
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
        body.text.length > 20000 ||
        !validImages(body.images ?? [])
      )
        return json(
          {
            error:
              "Use up to 20,000 characters and one prepared receipt image under 1.2 MB.",
          },
          400,
        );
      try {
        const fields = await extractWithNim(
          body.text,
          env.NVIDIA_API_KEY,
          env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
          fetch,
          body.images ?? [],
          env.NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct",
        );
        return json({ fields });
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
