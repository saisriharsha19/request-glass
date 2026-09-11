type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type CapturedRequest = {
  id: string;
  receivedAt: string;
  method: string;
  url: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  client: { address: string | null; forwardedFor: string | null; userAgent: string | null };
  body: { kind: string; bytes: number; truncated: boolean; value: JsonValue };
};

const isRender = process.env.RENDER === "true";
const host = process.env.HOST ?? (isRender ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3000);
const maxEvents = positiveInteger(process.env.MAX_EVENTS, 250);
const maxBodyBytes = positiveInteger(process.env.MAX_BODY_BYTES, 1024 * 1024);
const showSecrets = process.env.SHOW_SECRETS === "1";
const publicMode = process.env.PUBLIC_MODE === "1";
const captureToken = process.env.CAPTURE_TOKEN ?? "";
const adminToken = process.env.ADMIN_TOKEN ?? "";
const maxRequestsPerMinute = positiveInteger(process.env.MAX_REQUESTS_PER_MINUTE, 120);
const logRequests = process.env.LOG_REQUESTS !== "0";
const captureBase = publicMode ? `/capture/${captureToken}` : "";
const adminBase = publicMode ? `/admin/${adminToken}` : "";
const apiBase = publicMode ? `${adminBase}/api` : "/api";
const events: CapturedRequest[] = [];
const subscribers = new Set<ReadableStreamDefaultController<string>>();
let rateWindowStartedAt = Date.now();
let requestsInWindow = 0;

if (showSecrets && !publicMode && !["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("SHOW_SECRETS=1 is allowed only when HOST is loopback (127.0.0.1, localhost, or ::1)."
  );
}
if (publicMode && (captureToken.length < 32 || adminToken.length < 32 || captureToken === adminToken)) {
  throw new Error("PUBLIC_MODE=1 requires different CAPTURE_TOKEN and ADMIN_TOKEN values of at least 32 characters.");
}

const sensitiveKey = /(^|[-_.])(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|passwd|secret|token)([-_.]|$)/i;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function redactText(value: string): string {
  if (showSecrets) return value;
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[^\s,;]+/gi, "Basic [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}

function redact(value: unknown, key = ""): JsonValue {
  if (!showSecrets && sensitiveKey.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey),
      ]),
    );
  }
  return String(value);
}

function redactHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of headers.entries()) safe[name] = !showSecrets && sensitiveKey.test(name) ? "[REDACTED]" : redactText(value);
  return safe;
}

function queryObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key).map((value) => !showSecrets && sensitiveKey.test(key) ? "[REDACTED]" : redactText(value));
    result[key] = values.length === 1 ? values[0]! : values;
  }
  return result;
}

async function captureBody(request: Request): Promise<CapturedRequest["body"]> {
  if (request.method === "GET" || request.method === "HEAD") return { kind: "empty", bytes: 0, truncated: false, value: null };
  const declaredBytes = Number(request.headers.get("content-length") ?? 0);
  if (declaredBytes > maxBodyBytes) {
    return { kind: "omitted", bytes: declaredBytes, truncated: true, value: `[BODY OMITTED: exceeds ${maxBodyBytes} bytes]` };
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let keptBytes = 0;
  let truncated = false;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      const remaining = maxBodyBytes - keptBytes;
      if (remaining > 0) {
        const chunk = value.byteLength <= remaining ? value : value.slice(0, remaining);
        chunks.push(chunk);
        keptBytes += chunk.byteLength;
      }
      if (bytesRead > maxBodyBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  }
  const kept = new Uint8Array(keptBytes);
  let offset = 0;
  for (const chunk of chunks) { kept.set(chunk, offset); offset += chunk.byteLength; }
  const bodyBytes = declaredBytes > 0 ? declaredBytes : bytesRead;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/octet-stream") || contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/")) {
    return { kind: "binary", bytes: bodyBytes, truncated, value: `[BINARY BODY: ${bodyBytes} bytes]` };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(kept);
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return { kind: "json", bytes: bodyBytes, truncated, value: redact(JSON.parse(text)) };
    } catch {
      return { kind: "invalid-json", bytes: bodyBytes, truncated, value: redactText(text) };
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return { kind: "form", bytes: bodyBytes, truncated, value: redact(Object.fromEntries(new URLSearchParams(text))) };
  }
  if (contentType.includes("multipart/form-data")) {
    return { kind: "multipart", bytes: bodyBytes, truncated, value: "[MULTIPART BODY OMITTED: filenames and byte count retained only]" };
  }
  return { kind: "text", bytes: bodyBytes, truncated, value: redactText(text) };
}

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - rateWindowStartedAt >= 60_000) {
    rateWindowStartedAt = now;
    requestsInWindow = 0;
  }
  requestsInWindow += 1;
  return requestsInWindow <= maxRequestsPerMinute;
}

function publish(event: CapturedRequest): void {
  const message = `event: request\ndata: ${JSON.stringify(event)}\n\n`;
  for (const controller of subscribers) {
    try { controller.enqueue(message); } catch { subscribers.delete(controller); }
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

const dashboard = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Request Glass</title>
  <style>
    :root{color-scheme:dark;--bg:#0a0d12;--panel:#111722;--line:#253044;--muted:#8d9aae;--text:#edf3fb;--accent:#52e0ae;--blue:#70a7ff;--warn:#f7c46c}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#162339 0,transparent 34%),var(--bg);color:var(--text);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.shell{max-width:1500px;margin:auto;padding:30px}.top{display:flex;gap:22px;align-items:flex-end;justify-content:space-between;margin-bottom:22px}h1{font:700 30px/1.1 system-ui;margin:0 0 7px;letter-spacing:-.04em}.sub{color:var(--muted)}.status{display:flex;align-items:center;gap:9px;color:var(--muted)}.dot{width:9px;height:9px;border-radius:99px;background:var(--accent);box-shadow:0 0 15px var(--accent)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px}.stat,.panel{background:color-mix(in srgb,var(--panel) 94%,transparent);border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 50px #0003}.stat{padding:15px 17px}.stat b{display:block;font:700 23px system-ui}.stat span{color:var(--muted);font-size:12px}.toolbar{display:flex;gap:10px;padding:12px;margin-bottom:12px}.toolbar input{flex:1}.toolbar input,.toolbar button{background:#090d14;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:10px 12px;font:inherit}.toolbar button{cursor:pointer}.toolbar button:hover{border-color:var(--blue)}.grid{display:grid;grid-template-columns:minmax(360px,.8fr) minmax(0,1.4fr);gap:12px;height:calc(100vh - 250px);min-height:480px}.panel{overflow:auto}.empty{display:grid;place-items:center;height:100%;color:var(--muted);text-align:center;padding:30px}.row{padding:13px 15px;border-bottom:1px solid var(--line);cursor:pointer}.row:hover,.row.active{background:#182235}.row-head{display:flex;align-items:center;gap:10px}.method{color:var(--accent);font-weight:800;width:55px}.path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.time{color:var(--muted);font-size:11px}.meta{color:var(--muted);font-size:11px;margin-top:5px}.detail{padding:20px}.detail h2{font:700 19px system-ui;margin:0 0 4px;overflow-wrap:anywhere}.detail h3{font:650 12px system-ui;color:var(--blue);text-transform:uppercase;letter-spacing:.12em;margin:24px 0 8px}.detail pre{background:#090d14;border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.badge{display:inline-block;color:#172116;background:var(--warn);padding:3px 7px;border-radius:5px;font-size:11px;font-weight:800;margin-top:12px}.redaction{color:var(--warn)}@media(max-width:800px){.shell{padding:16px}.grid{grid-template-columns:1fr;height:auto}.panel{min-height:300px;max-height:58vh}.stats{grid-template-columns:1fr 1fr}.stats .stat:last-child{grid-column:1/-1}.top{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body><main class="shell">
  <div class="top"><div><h1>Request Glass</h1><div class="sub">Live internal HTTP request inspector · ${showSecrets ? "⚠ secrets are visible in this local session" : "secrets are redacted"}</div></div><div class="status"><i class="dot"></i><span id="connection">connecting</span></div></div>
  <section class="stats"><div class="stat"><b id="total">0</b><span>captured requests</span></div><div class="stat"><b id="last">—</b><span>latest method</span></div><div class="stat"><b id="bytes">0 B</b><span>payload captured</span></div></section>
  <section class="panel toolbar"><input id="filter" aria-label="Filter requests" placeholder="Filter method, path, content…"><button id="clear">Clear captured requests</button></section>
  <section class="grid"><div id="list" class="panel"><div class="empty">Send a request to the configured capture URL.<br>Optional path suffixes are supported.</div></div><div id="detail" class="panel"><div class="empty">Select a request to inspect it.</div></div></section>
</main><script>
const state={events:[],selected:null,filter:''};const $=s=>document.querySelector(s);const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmt(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';return(n/1048576).toFixed(1)+' MB'}
function render(){
  const visible=state.events.filter(e=>JSON.stringify(e).toLowerCase().includes(state.filter));
  $('#total').textContent=state.events.length;$('#last').textContent=state.events[0]?.method||'—';$('#bytes').textContent=fmt(state.events.reduce((n,e)=>n+e.body.bytes,0));
  $('#list').innerHTML=visible.length?visible.map(e=>'<article class="row '+(e.id===state.selected?'active':'')+'" data-id="'+e.id+'"><div class="row-head"><span class="method">'+esc(e.method)+'</span><span class="path">'+esc(e.path)+'</span><time class="time">'+new Date(e.receivedAt).toLocaleTimeString()+'</time></div><div class="meta">'+esc(e.body.kind)+' · '+fmt(e.body.bytes)+' · '+esc(e.client.address||'unknown client')+'</div></article>').join(''):'<div class="empty">No matching requests.</div>';
  document.querySelectorAll('.row').forEach(r=>r.onclick=()=>{state.selected=r.dataset.id;render()});
  const e=state.events.find(x=>x.id===state.selected);
  $('#detail').innerHTML=e?'<div class="detail"><h2>'+esc(e.method)+' '+esc(e.path)+'</h2><div class="sub">'+esc(e.receivedAt)+' · '+esc(e.client.address||'unknown client')+'</div>'+(e.body.truncated?'<span class="badge">TRUNCATED</span>':'')+'<h3>Query</h3><pre>'+esc(JSON.stringify(e.query,null,2))+'</pre><h3>Headers</h3><pre class="redaction">'+esc(JSON.stringify(e.headers,null,2))+'</pre><h3>Body · '+esc(e.body.kind)+' · '+fmt(e.body.bytes)+'</h3><pre>'+esc(typeof e.body.value==='string'?e.body.value:JSON.stringify(e.body.value,null,2))+'</pre><h3>Client</h3><pre>'+esc(JSON.stringify(e.client,null,2))+'</pre></div>':'<div class="empty">Select a request to inspect it.</div>'
}
$('#filter').oninput=e=>{state.filter=e.target.value.toLowerCase();render()};$('#clear').onclick=async()=>{await fetch('${apiBase}/events',{method:'DELETE'});state.events=[];state.selected=null;render()};
async function boot(){state.events=await fetch('${apiBase}/events').then(r=>r.json());render();const stream=new EventSource('${apiBase}/stream');stream.onopen=()=>$('#connection').textContent='live';stream.onerror=()=>$('#connection').textContent='reconnecting';stream.addEventListener('request',msg=>{const e=JSON.parse(msg.data);state.events.unshift(e);if(!state.selected)state.selected=e.id;render()})}boot();
</script></body></html>`;

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: 30,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") return json({ status: "ok" });
    const dashboardPath = publicMode ? adminBase : "/";
    if ((url.pathname === dashboardPath || url.pathname === `${dashboardPath}/`) && request.method === "GET") {
      return new Response(dashboard, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" } });
    }
    if (url.pathname === `${apiBase}/events` && request.method === "GET") return json(events);
    if (url.pathname === `${apiBase}/events` && request.method === "DELETE") {
      events.length = 0;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `${apiBase}/stream` && request.method === "GET") {
      let ownController: ReadableStreamDefaultController<string>;
      const stream = new ReadableStream<string>({
        start(controller) { ownController = controller; subscribers.add(controller); controller.enqueue(": connected\n\n"); },
        cancel() { subscribers.delete(ownController); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-store", connection: "keep-alive" } });
    }
    if (publicMode && !(url.pathname === captureBase || url.pathname.startsWith(`${captureBase}/`))) return json({ error: "Not found" }, 404);
    if (!publicMode && url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (publicMode && !withinRateLimit()) return json({ error: "Capture rate limit exceeded" }, 429);

    const body = await captureBody(request);
    const socket = server.requestIP(request);
    const visiblePath = publicMode ? url.pathname.slice(captureBase.length) || "/" : url.pathname;
    const event: CapturedRequest = {
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      method: request.method,
      url: `${visiblePath}${url.search}`,
      path: visiblePath,
      query: queryObject(url),
      headers: redactHeaders(request.headers),
      client: {
        address: socket?.address ?? null,
        forwardedFor: redactText(request.headers.get("x-forwarded-for") ?? "") || null,
        userAgent: request.headers.get("user-agent"),
      },
      body,
    };
    events.unshift(event);
    if (events.length > maxEvents) events.length = maxEvents;
    if (logRequests) console.log(JSON.stringify({ type: "captured_request", ...event }));
    publish(event);
    return json({ ok: true, captured: true, id: event.id, secretsVisible: showSecrets }, 202);
  },
});

const baseUrl = server.url.toString().replace(/\/$/, "");
console.log(`Request Glass listening on ${server.url}`);
console.log(`Capture endpoint: ${baseUrl}${publicMode ? `${captureBase}/<optional-path>` : "/<any-path> (dashboard and /api/* are excluded)"}`);
if (publicMode) console.log(`Dashboard endpoint: ${baseUrl}${adminBase}`);
console.log(`Retention: latest ${maxEvents} requests in memory; max body: ${maxBodyBytes} bytes`);
console.log(`Sensitive values: ${showSecrets ? "VISIBLE (memory only)" : "REDACTED"}`);
console.log(`Request console logging: ${logRequests ? "ENABLED" : "DISABLED"}`);
