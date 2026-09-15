import { cp, mkdir } from 'node:fs/promises';
await import('./build-cloudflare');
// Only the allowlisted public assets enter this output directory.
await mkdir('dist-cloudflare', {recursive: true});
const result = await Bun.build({entrypoints: ['pages-worker.ts'], target: 'browser', minify: true});
if (!result.success) throw new Error('Pages frontend build failed');
await Bun.write('dist-cloudflare/_worker.js', result.outputs[0]);
await Bun.write('dist-cloudflare/_routes.json', JSON.stringify({version: 1, include: ['/api/*', '/healthz'], exclude: []}));
console.log('Tuckday Pages frontend ready; database and NIM stay in the existing Worker.');
