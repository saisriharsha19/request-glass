import { extractWithNim, validImages } from "./ai";
const host =
  process.env.HOST ?? (process.env.RENDER === "true" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3000);
const assets: Record<string, string> = {
  "/": "public/index.html",
  "/app.js": "public/app.js",
  "/logic.js": "public/logic.js",
  "/pdf.js": "public/pdf.js",
  "/pdf/pdf.min.mjs": "node_modules/pdfjs-dist/build/pdf.min.mjs",
  "/pdf/pdf.worker.min.mjs": "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "/style.css": "public/style.css",
  "/ocr/tesseract.min.js": "node_modules/tesseract.js/dist/tesseract.min.js",
  "/ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "/ocr/eng.traineddata.gz":
    "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
};
let aiWindow = Date.now(),
  aiCalls = 0,
  aiInFlight = 0;
const configuredLimit = Number(process.env.NIM_REQUESTS_PER_HOUR || 60);
const aiLimit =
  Number.isSafeInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : 60;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
Bun.serve({
  maxRequestBodySize: 1500000,
  idleTimeout: 55,
  hostname: host,
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const headers = {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    if (path === "/api/ai/extract" && request.method === "POST") {
      const origin = request.headers.get("origin");
      if (
        !origin ||
        (() => {
          try {
            const o = new URL(origin);
            return (
              o.host !== new URL(request.url).host ||
              !["http:", "https:"].includes(o.protocol)
            );
          } catch {
            return true;
          }
        })()
      )
        return json({ error: "Open the app to use receipt assistance." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "Send receipt text as JSON." }, 415);
      const key = process.env.NVIDIA_API_KEY;
      if (!key)
        return json(
          {
            error:
              "AI assistance isn’t connected yet. Local receipt scanning and manual entry still work.",
          },
          503,
        );
      if (Date.now() - aiWindow > 3600000) {
        aiWindow = Date.now();
        aiCalls = 0;
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Could not read the receipt text." }, 400);
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
      if (aiCalls >= aiLimit || aiInFlight >= 2)
        return json(
          {
            error: "AI assistance is busy. Try later, or use local extraction.",
          },
          429,
        );
      aiCalls++;
      aiInFlight++;
      try {
        const fields = await extractWithNim(
          body.text,
          key,
          process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
          fetch,
          body.images ?? [],
          process.env.NVIDIA_VISION_MODEL ||
            "meta/llama-3.2-11b-vision-instruct",
        );
        return json({ fields });
      } catch {
        return json(
          {
            error:
              "AI assistance couldn’t read this receipt right now. Your entries are unchanged. Try local extraction or enter the details.",
          },
          502,
        );
      } finally {
        aiInFlight--;
      }
    }
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...headers, Allow: "GET, HEAD" },
      });
    if (path === "/healthz")
      return new Response(request.method === "HEAD" ? null : "ok", { headers });
    let asset = assets[path];
    if (
      /^\/ocr\/tesseract-core(?:-(?:relaxedsimd|simd))?(?:-lstm)?\.wasm(?:\.js)?$/.test(
        path,
      )
    )
      asset = `node_modules/tesseract.js-core/${path.split("/").pop()}`;
    if (/^\/pdf\/cmaps\/[A-Za-z0-9_.-]+\.bcmap$/.test(path))
      asset = `node_modules/pdfjs-dist/cmaps/${path.split("/").pop()}`;
    if (/^\/pdf\/fonts\/[A-Za-z0-9_.-]+\.(?:pfb|ttf)$/.test(path))
      asset = `node_modules/pdfjs-dist/standard_fonts/${path.split("/").pop()}`;
    if (!asset) return new Response("Not found", { status: 404, headers });
    const file = Bun.file(new URL(asset, import.meta.url));
    if (!(await file.exists()))
      return new Response("Not found", { status: 404, headers });
    const type = /\.m?js$/.test(asset)
      ? "text/javascript; charset=utf-8"
      : file.type;
    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        ...headers,
        "Content-Type": type,
        "Cache-Control":
          path.startsWith("/ocr/") || path.startsWith("/pdf/")
            ? "public, max-age=86400"
            : "no-cache",
      },
    });
  },
});
console.log(`ReturnRadar is listening on http://${host}:${port}`);
