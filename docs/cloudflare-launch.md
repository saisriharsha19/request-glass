# Cloudflare deployment

Live address: https://return-radar.return-radar.workers.dev

ReturnRadar uses Workers, static assets, and one D1 database. Username/password login and purchase sync are built into the app. No external auth or sync service is required. NVIDIA NIM remains the optional receipt-assistance provider.

## Deploy

1. Run `bun install --frozen-lockfile` and `bunx wrangler login` with Workers and D1 access.
2. For a different Cloudflare account, create a database with `bunx wrangler d1 create return-radar` and update the database ID in `wrangler.jsonc`.
3. Apply schema: `bunx wrangler d1 migrations apply return-radar --remote`.
4. Set the server-side AI key using `bunx wrangler secret put NVIDIA_API_KEY`.
5. Run `bun run check`, `bun test`, and `bun run test:browser`, then `bun run deploy:cloudflare`.
6. Verify account creation, sign-in in a second browser, purchase save/edit/delete propagation, and signed-in AI assistance on the deployed address.

Local Bun development uses SQLite at `.local/accounts.sqlite` (override with `ACCOUNT_DB_PATH`). Render remains a guest-only fallback because its filesystem is ephemeral. Export old guest data there and import it on the Cloudflare site; browser storage is separate for each hostname.

## Accounts and sync

Create a username and a password of at least 12 characters. Save the one-time recovery key before continuing. Passwords use salted scrypt hashes; recovery keys and session tokens are stored as hashes. Sessions use Secure, HttpOnly cookies on HTTPS. Password recovery rotates the recovery key and revokes previous sessions. There is no email delivery dependency.

Previous Google/Clerk sign-ins do not become native accounts automatically. Create a new account, then choose **Add device purchases** to copy local purchase details into it. Guest records remain on the device. Account records are not copied into shared guest storage on sign-out.

Sync refreshes every 15 seconds while visible and not editing, on focus/connection return, and with **Sync now**. Version checks reject conflicting edits and stale deletions. Failed saves retain the form and offer an unsaved-version download. There is no offline write queue. Each account supports 500 active purchases; lists are paginated. PDFs and images are temporary processing inputs and are excluded from database sync; extracted text, notes and purchase details are synced.

## Capacity

Free hosting is a starting point, not a guarantee of 10,000 active users. Cloudflare currently lists 100,000 dynamic Worker requests/day, 5 million D1 rows read/day, 100,000 rows written/day, and 500 MB per free database (5 GB total across databases). Polling, sessions, indexes and purchase size all consume resources. Static asset requests are free and unlimited. Measure real traffic and upgrade before reaching limits; no 10,000-user load test has been performed.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
