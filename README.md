# Tuckday

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

Guest purchases stay in browser storage. Native username/password accounts sync purchase details through Cloudflare D1. Original PDFs and images are never uploaded to the sync database. Use Add device purchases to import guest details explicitly. Export/restore JSON backups supports up to 50 MB / 2,000 purchases. Restoring replaces matching IDs and preserves other purchases.

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

Search, sort, archive/restore, and the upcoming-deadline timeline operate locally. Calendar export creates `.ics` files for Apple, Google, or Outlook. Import the file to enable reminders; events use the advance alert selected in the item form (three days by default). Add an extra alert for nearer deadlines. Sample purchases are explicitly fictional and are saved only at the user's request.

## Deployment

The Dockerfile installs locked production dependencies, including local OCR/PDF assets. `/healthz` is the health endpoint. The existing Render service retains its name; do not apply the blueprint as a new service unless a second service is intended. Previous request-inspector capture/admin routes are removed.

Tests cover storage/migration, receipt/PDF extraction, no new file persistence, one image upload followed by text-only inference, manual-edit precedence, conflicting date evidence, provider errors, backups, safe text rendering, calendar files, mobile layout, lazy loading, settled animations, and a 500-record collection. Mocked tests are distinct from live model and deployment checks.

## Account linkage and Cloudflare migration

The Cloudflare deployment and account setup are documented in [docs/cloudflare-launch.md](docs/cloudflare-launch.md). Open https://tuckday.pages.dev. Accounts use native username/password login and one D1 database, with no external identity service. Save the recovery key shown at registration; it replaces email-based password recovery. Previous Google/Clerk users should create a native account and import device purchases once. Cloudflare AI assistance requires sign-in.

## Calendar, documents and organization

The Calendar workspace provides a month view and an agenda with upcoming, overdue and completed reminders. Each event can be opened in Google or Outlook Calendar, downloaded for Apple/other calendars, marked done, reopened, or moved seven days forward. Calendar links open a draft for you to confirm; downloaded calendar files are snapshots and do not subscribe an external calendar to later changes. All dates are day-based; check exact merchant cutoff times. Choose a calendar alert from the same day to 30 days before in the item form.

Use custom reminder dates for bills and document renewals. Categories, tags, favorites, four starter templates and duplication help organize more than purchases. Search includes extracted document text and tags. Insights group saved amounts by currency and category, excluding archives; CSV export is available for spreadsheets.

Upload PDF, PNG/JPEG/WebP, TXT, Markdown, CSV/TSV, HTML, RTF, DOCX, ODT, XLSX or PPTX. Office text is unpacked in a local worker; macros and external links are not executed. Original files are not retained. Limits: 10 MB for documents, 4 MB expanded Office XML, 50,000 extracted characters, and the existing PDF/image limits. Legacy/encrypted/unrecognized formats require a PDF or text export. Spreadsheet dates may appear as serial numbers and need manual review. Calendar import accepts up to 100 all-day, nonrecurring events from a 1 MB ICS file and presents a selection before saving; timed/recurring events are explicitly reported as skipped.

Sync checks mobile visibility/resume, page restoration, focus and reconnect as well as periodic polling. A visible account username, item count and check time help compare devices. Editing suspends refresh to preserve your draft; closing the editor refreshes changes. Failed requests display an error, and stale reads cannot overwrite a newer successful save.

The illustrated folder reacts only to nearby pointers and gives a brief double blink on tap or keyboard activation. Reduced-motion preferences disable these effects and the finite paper-cut celebrations. [Artwork prompt, provenance and interaction references](docs/design/illustration.md).

## Tuckday connections and recovery

Calendar → Connect calendar brings Google, Outlook and iCloud ICS feeds into Tuckday, including recurring and timed events. Add one link per calendar. The secondary sharing option creates an outgoing, revocable subscription URL. Providers fetch updates on their own schedules; this is separate from two-way OAuth access. Signed-in sidebar status and server-confirmed sync counts distinguish account records from guest records. A failed startup connection now recovers automatically or through Retry connection. The receiving device can reconnect after the writer closes. AI assistance can also extract explicitly dated bill/renewal reminders with evidence. [Deployment and connection details](docs/tuckday-release.md).
