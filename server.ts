const host =
  process.env.HOST ?? (process.env.RENDER === "true" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3000);
const assets: Record<string, string> = {
  "/": "public/index.html",
  "/app.js": "public/app.js",
  "/logic.js": "public/logic.js",
  "/style.css": "public/style.css",
  "/ocr/tesseract.min.js": "node_modules/tesseract.js/dist/tesseract.min.js",
  "/ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "/ocr/eng.traineddata.gz":
    "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
};
Bun.serve({
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
    if (!asset) return new Response("Not found", { status: 404, headers });
    const file = Bun.file(new URL(asset, import.meta.url));
    if (!(await file.exists()))
      return new Response("Not found", { status: 404, headers });
    const type = asset.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : file.type;
    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        ...headers,
        "Content-Type": type,
        "Cache-Control": path.startsWith("/ocr/")
          ? "public, max-age=86400"
          : "no-cache",
      },
    });
  },
});
console.log(`ReturnRadar is listening on http://${host}:${port}`);
