# Request Glass

A dependency-free Bun server for inspecting HTTP requests in real time. It keeps only the latest requests in memory. Credentials are redacted by default, or can be shown for a loopback-only local session.

## Run

```bash
bun run start
```

To show complete sensitive values locally:

```bash
SHOW_SECRETS=1 bun run start
```

Open <http://127.0.0.1:3000>, then send requests to any non-`/api/*` path:

```bash
curl http://127.0.0.1:3000/debug/example?source=local \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer example-secret' \
  -d '{"message":"hello","password":"also-secret"}'
```

Requests are not written to disk. The server binds to `127.0.0.1` unless `HOST` is explicitly changed. If sensitive values are visible on a public host, always enable `PUBLIC_MODE` with separate high-entropy capture and dashboard tokens.

## Deploy on Render

The included `render.yaml` and `Dockerfile` define a free Render web service. During service creation, provide different random values of at least 32 characters for `CAPTURE_TOKEN` and `ADMIN_TOKEN`.

Hosted mode exposes only these paths:

- `/capture/<CAPTURE_TOKEN>/<optional-path>` accepts captured requests.
- `/admin/<ADMIN_TOKEN>` opens the dashboard.
- `/healthz` is a metadata-free health check.

All other paths return `404`. Captures remain in memory and disappear whenever the free instance sleeps or restarts.
