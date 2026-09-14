# ReturnRadar

Purchase details, reviewed deadlines, calendar reminders, and optional NVIDIA NIM receipt assistance. Built with Bun and a responsive browser UI.

## Run and check

```sh
bun install --frozen-lockfile
bun run start
# http://127.0.0.1:3000
bun run check
bun test
bunx playwright install chromium
bun run test:browser
```

`HOST` and `PORT` control the listener. Hosted deployments require HTTPS.

## Receipt flow

1. Paste receipt text, upload an image, upload a PDF, or enter details manually.
2. Local PDF.js/Tesseract processing prepares text. These libraries load only when needed.
3. Optionally click **Read with AI**. One app request sends the extracted text and a prepared receipt image to the server. Multiple PDF pages become one numbered overview sheet, with full extracted text from all pages.
4. NVIDIA's vision model reads that image **once**. Its reading and local OCR text are reconciled by Nemotron into typed suggestions. The second inference receives **text only**, not the file/image again.
5. Review suggestions and their sources. Explicit manual edits win; AI may correct automated OCR values. Uncertain or conflicting fields are omitted. Save the reviewed purchase.

Images: PNG/JPEG/WebP up to 8 MB and 24 megapixels. PDFs: up to 10 MB / 10 pages, including scanned pages. Password-protected PDFs need an unlocked copy. Extracted text is capped at 50,000 characters; AI input is capped at 20,000. The prepared vision sheet is capped at 1.2 MB. For long PDFs, the overview loses small visual detail; the full extracted text supplements it. Use shorter receipts when fine print matters.

## Files and privacy

**New original uploads are not saved.** Only extracted text and reviewed purchase details enter IndexedDB. PDF/image processing buffers are temporary. Prepared images are discarded after an AI attempt, cancellation, dialog close, or saving. The PDF document is destroyed after local extraction. No PDF bytes are sent to NVIDIA; only the prepared image sheet and text are sent when the user clicks AI. The server does not persist request content or log receipt/provider payloads.

NVIDIA processes submitted material under its own service terms; the app cannot guarantee deletion from NVIDIA systems. Receipts saved by the previous version remain available and are migrated without loss. Newly uploaded replacements follow the temporary-file behavior. Backups can contain legacy receipt images, so keep them private.

Clearing browser storage removes saved purchases. There is no account or cross-device sync. Export/restore JSON backups supports up to 50 MB / 2,000 purchases. Restoring replaces matching IDs and preserves other purchases.

## NVIDIA NIM configuration

Server-side environment only; never put keys in browser code or Git:

```dotenv
NVIDIA_API_KEY=your-key
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_VISION_MODEL=meta/llama-3.2-11b-vision-instruct
NIM_REQUESTS_PER_HOUR=60
```

Set these under the existing Render service's Environment settings. Local `.env` files are ignored by Git and excluded from Docker images. Missing keys leave local extraction and manual entry usable. The deployment uses models verified with the supplied account; Gemma 4 timed out during validation, so it is not the default.

Provider references: [NVIDIA NIM vision input](https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-11b-vision-instruct-infer), [Nemotron structured output and thinking controls](https://docs.nvidia.com/nim/large-language-models/2.0.10/get-started/advanced/get-started-nemotron-3.5-lightning.html).

The server caps two concurrent analyses and defaults to 60 analyses/hour per process. An image analysis uses two inference calls; text-only analysis uses one. Counters reset on process restart and are not a persistent billing cap. A shared 45-second provider timeout bounds each analysis; failed/incomplete results do not overwrite user entries. There are no automatic retries or silent model fallbacks.

## Interpretation boundaries

AI output must fit the field schema and limits. Text evidence must be quoted from a supplied reading. Dates must be real ISO dates with an explicit year in their evidence; relative policy calculations and reuse of the same undifferentiated quote for different date purposes are rejected. Visual readings are identified separately and must be reviewed against the original. These checks do not prove that an AI interpretation is factually correct.

The local parser is a conservative convenience for labeled receipts, not the main interpretation engine. There are no merchant-specific policies or invented deadlines, savings, price checks, or unsupported date calculations. Price-check dates are user-chosen calendar reminders. There is no automatic email import, background notification service, or offline PWA.

## Performance and organizer features

IndexedDB v2 separates lightweight purchase metadata from legacy receipt images. Existing v1 receipts migrate transactionally. Lists do not reload all images on focus; cross-tab updates use BroadcastChannel. The first 30 matching records render initially with Show more, search updates are coalesced to animation frames, and date/price formatters are reused. Decorative motion settles after entry; no animation loops or backdrop blur. Reduced-motion preferences are respected.

Search, sort, archive/restore, and the upcoming-deadline timeline operate locally. Calendar export creates `.ics` files for Apple, Google, or Outlook. Import the file to enable reminders; events request an alert three days before. Add an extra alert for nearer deadlines. Sample purchases are explicitly fictional and are saved only at the user's request.

## Deployment

The Dockerfile installs locked production dependencies, including local OCR/PDF assets. `/healthz` is the health endpoint. The existing Render service retains its name; do not apply the blueprint as a new service unless a second service is intended. Previous request-inspector capture/admin routes are removed.

Tests cover storage/migration, receipt/PDF extraction, no new file persistence, one image upload followed by text-only inference, manual-edit precedence, conflicting date evidence, provider errors, backups, safe text rendering, calendar files, mobile layout, lazy loading, settled animations, and a 500-record collection. Mocked tests are distinct from live model and deployment checks.
