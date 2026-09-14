import { cp, mkdir, rm } from "node:fs/promises";
import { assets } from "../assets";
import { securityHeaders } from "../auth";
import { dirname } from "node:path";
// Dedicated generated directory; never copy .env, source files, or local data.
await rm("dist-cloudflare", { recursive: true, force: true });
for (const [route, source] of Object.entries(assets)) {
  if (route === "/account") continue;
  const destination = `dist-cloudflare${route === "/" ? "/index.html" : route}`;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}
const core = new Bun.Glob("tesseract-core*.wasm*");
for await (const file of core.scan("node_modules/tesseract.js-core"))
  await cp(
    `node_modules/tesseract.js-core/${file}`,
    `dist-cloudflare/ocr/${file}`,
  );
await cp("node_modules/pdfjs-dist/cmaps", "dist-cloudflare/pdf/cmaps", {
  recursive: true,
});
await cp(
  "node_modules/pdfjs-dist/standard_fonts",
  "dist-cloudflare/pdf/fonts",
  { recursive: true },
);
const headers = Object.entries(securityHeaders())
  .map(([key, value]) => `  ${key}: ${value}`)
  .join("\n");
await Bun.write(
  "dist-cloudflare/_headers",
  `/*\n${headers}\n  Cache-Control: no-cache\n/ocr/*\n  Cache-Control: public, max-age=86400\n/pdf/*\n  Cache-Control: public, max-age=86400\n`,
);
console.log(
  "Cloudflare assets built with first-party authentication and purchase sync.",
);
