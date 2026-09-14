# ReturnRadar launch setup

Hosting target: https://return-radar.return-radar.workers.dev on Cloudflare Workers + static assets. Clerk account integration is prepared; configuration and real login verification are still required. D1 is optional later.
No receipt database, object bucket, or file persistence is provisioned by this change.

## Connect the accounts

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. Run `bunx wrangler login` on the development machine, authorize the account, and run `bunx wrangler whoami` to confirm access. For a remote development machine use `bunx wrangler login --device --browser=false`; open the displayed verification page and enter the short-lived code. This avoids localhost callbacks. Do not commit OAuth credentials.
3. Create a Clerk application named ReturnRadar at https://dashboard.clerk.com. Enable email sign-in/sign-up and configure your desired verification method in Clerk. Social sign-in requires the provider configuration appropriate to your environment.
4. Put the Clerk **publishable** key into the ignored local `.env` as `CLERK_PUBLISHABLE_KEY`. No Clerk secret key is needed: server identity checks verify signed session tokens against the instance's public JWKS.
5. For public production, associate a domain you control with Clerk, configure its required DNS records, and use the production `pk_live_...` key. Development instances are capped at 100 users, have different session security, and cannot be used as a 10,000-user launch. A domain registration is a separate cost unless you already own one. A workers.dev test address is not a substitute for Clerk's production domain setup.

## Verify and deploy

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run test:browser
bun run build:cloudflare
bunx wrangler deploy --dry-run
bun run dev:cloudflare
```

`bun run build:cloudflare` builds an explicit static allowlist, including PDF/OCR libraries. It never copies `.env`, source code, or local IndexedDB data. It generates CSP headers using the configured publishable key's frontend host. Rebuild/redeploy when that key/domain changes.

After Cloudflare authorization:

```sh
# Interactive prompts keep values out of command history.
bunx wrangler secret put CLERK_PUBLISHABLE_KEY
bunx wrangler secret put NVIDIA_API_KEY
bun run deploy:cloudflare
```

Use the same Clerk publishable key locally for the build and in the Worker environment. Configure your custom domain for the Worker and Clerk before production sign-in. The existing NVIDIA key can be copied directly from local configuration into the Worker secret without printing it. Do not create a new provider key unnecessarily.

Verify the reported Cloudflare deployment/version and its actual HTTPS address. Check the account page, a real sign-in/sign-out, matching account IDs in two independent browsers/devices, PDF extraction, and a signed-in AI request. Unit/browser mocks do not prove Clerk configuration, email delivery, production DNS, NIM quota, or 10,000-user load capacity.

## Move existing local purchases

Browser storage is isolated by origin. On the existing Render site, export a backup. On the new Cloudflare address, restore it. The old site must remain accessible until the owner has moved their records. Redirecting/deleting Render immediately would make the old browser's export UI inaccessible. Login does not transfer these purchases.

Account linkage is not a privacy boundary for local data: everyone using the same browser profile sees that profile's local purchases, even after signing out or switching accounts. The account screen explains this. This release does not upload, partition, or associate those records with a cloud user. That requires a deliberate data migration when sync is introduced.

## Free tier capacity and upgrade path

Checked 2026-09-14 against official provider documentation:

| Component | Published free allowance | Relevant boundary |
| --- | --- | --- |
| Workers static assets | Free, unlimited static-asset requests | Static-first routing keeps CSS, JS and OCR/PDF assets out of dynamic Worker request usage. |
| Workers dynamic API | 100,000 requests/day; 10 ms CPU/request | Network waits are distinct from CPU. A workload/load test is still needed. |
| Clerk production | 50,000 monthly retained users | Production domain required; development limited to 100 users. |
| D1, not provisioned | 5 GB total, 5 million rows read/day, 100,000 rows written/day | Indexed queries and actual row sizes determine capacity. No sync data is stored yet. |

10,000 registered accounts is a reasonable initial target within these account allowances, not a proven free workload guarantee. For illustration, 1,000 daily active users making 20 dynamic requests each consume 20,000 requests/day; 10,000 daily active users making 10 each reach 100,000/day. Static asset requests are separate. Rate limits and costs can change.

Cloudflare AI assistance requires a verified signed-in account and uses a per-user 5/minute rate-limit binding. Cloudflare's limiter is per location and eventually consistent; it is not a global billing cap. NVIDIA quota/credits are separate from hosting, and free inference for 10,000 users is not established. Keep local extraction available; set a provider spending/quota limit before a broad launch. The legacy Bun server retains its existing 60/hour per-process guard.

When purchase sync is requested, add D1 records keyed by verified Clerk user ID, enforce ownership server-side, and design versioned updates/deletions with explicit local-data import. Do not simply share the current browser database between identities. Uploaded PDFs/images can remain temporary.

Sources:
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://clerk.com/pricing
- https://clerk.com/docs/guides/development/managing-environments
- https://clerk.com/docs/js-frontend/getting-started/quickstart
