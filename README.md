# ReturnRadar

A playful, private place to turn receipts into purchase reminders. Built with Bun and a responsive browser UI, without a server database or account.

## What works

- Paste an order confirmation, add a purchase manually, or read an English receipt image using Tesseract.js on your device.
- Review and edit extracted product, merchant, total, purchase date, and explicit return/cancellation/warranty dates.
- Store original text, receipt images, notes, and dates in IndexedDB.
- Search purchases, filter by deadline type, see dates coming up within seven days, and archive/restore purchases.
- Export upcoming dates as an `.ics` file for importing into Apple, Google, or Outlook Calendar. Events include a three-day reminder; calendar client settings govern notification behavior. For deadlines fewer than three days away, set an additional alert.
- Export and restore JSON backups, including receipt images. Restoring replaces matching purchase IDs and preserves other purchases.

## Run

```sh
bun install --frozen-lockfile
bun run start
```

Open http://127.0.0.1:3000. `HOST` and `PORT` control the listener. A production deployment must use HTTPS so browser features such as secure UUID generation are available.

## Checks

```sh
bun run check
bun test
bunx playwright install chromium
bun run test:browser
```

Browser checks cover image OCR, purchase persistence, editing, literal rendering of HTML-like input, search, calendar download, archive/restore, backups, and mobile layout.

## Boundaries

The app never invents merchant policies. The conservative parser recognizes labeled fields, ISO dates, and English month-name dates with explicit years. Relative periods and ambiguous numeric dates remain blank for manual review. OCR can be wrong; users must review extracted details. OCR supports PNG, JPEG, and WebP up to 8 MB and 24 megapixels, in English. PDFs are not supported. The image, OCR engine, and English language model are processed/served locally without sending receipt content to an outside service. [Tesseract local installation documentation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) describes the worker/core/language configuration.

Data lives only in this browser and origin; it does not sync across devices. Clearing browser data removes it. Keep exported backups private. Backup import accepts up to 50 MB and 2,000 purchases. Sample data is explicitly labeled and only becomes a saved purchase if the user saves it.

Calendar files must be imported to receive reminders. There are no automatic price checks, email integrations, background notifications, or claimed savings. A price-check date is a user-selected calendar reminder. This version is not an offline PWA.

## Render / Docker

The Dockerfile installs locked production dependencies, including OCR assets, and serves the UI at `/`. `/healthz` is the health endpoint. The blueprint describes a new `return-radar` service; an existing Render service can keep its name and use this Dockerfile. Avoid applying the blueprint as a new service unless a second service is intended.

Previous request-inspector capture/admin routes have been removed. Old inspector environment variables are ignored; only `HOST` and `PORT` are used. No receipt data is accepted or stored by the server.
