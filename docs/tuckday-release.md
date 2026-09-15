# Tuckday deployment and calendar connections

Tuckday is the new public name. Existing internal IndexedDB keys, account database, record IDs and calendar event IDs are preserved so a name change does not destroy or duplicate saved data.

The prepared clean frontend is `tuckday.pages.dev`. It requires Cloudflare Pages authorization. `bun run deploy:pages` builds the allowlisted static frontend and a same-origin API gateway. The existing `return-radar` Worker remains the backend for native accounts, D1 and NIM; no second account database or authentication provider is introduced. Existing workers.dev and Render addresses remain reachable. Signing in at the new origin uses the same username/password, but browser cookies and guest storage are origin-specific. Export/import guest records before moving if needed.

Deploy the backend first (`bun run deploy:cloudflare`), then the frontend (`bun run deploy:pages`). Apply `0002_calendar_subscriptions.sql` to D1 before enabling subscriptions. The Pages gateway rejects cross-origin writes before translating the validated origin for the backend. It forwards host-only session cookies, does not expose provider credentials and keeps private subscription URLs on the frontend origin.

Calendar → Connect calendar creates a private read-only subscription link, with provider-specific steps for Google, Outlook and Apple. Future reminders are fetched from D1, independent of whether either device is online. The link exposes reminder titles/dates, not receipt text, notes or source files. Disconnect revokes future access; calendar applications may keep previously fetched events until the subscription is removed. Updates follow the provider's refresh schedule and may take hours. This is not OAuth account linking or two-way calendar editing.

Official setup references: [Google Calendar](https://support.google.com/calendar/answer/37100?hl=en), [Outlook](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web), [Cloudflare Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/).

Sync now displays an in-progress state and a server-confirmed record count. Failed initial account loading retries without requiring a page reload. The sidebar reflects the signed-in account rather than showing guest instructions. A bounded browser-storage open prevents account startup from hanging forever behind IndexedDB. A receiving browser can reconnect and retrieve a save after the writer has closed; tests cover this sequence as well as failed startup recovery.

AI document assistance additionally recognizes explicitly dated bill payments and document renewal/expiry reminders, with quoted evidence. Relative periods and unsupported dates are still omitted for review.
