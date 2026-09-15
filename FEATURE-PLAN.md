# ReturnRadar expansion and verification

User goal: repair real cross-device sync, broaden document support, provide useful calendar integration and more than ten substantive features, retaining stable mobile UI and temporary uploaded files. The full UI must feel lively and polished, with aligned controls, complete loading/empty/error states, and no growing, blurry or distracting interactions. Latest direction: keep sophisticated, brief celebrations tied to successful actions; replace novelty popups and quote cards with useful details, and make every component visually cohesive.

Delivery checklist (each needs implementation and relevant tests/live checks):
- [x] Reliable account sync: automatic refresh on mobile resume, account changes, explicit status and recovery, and no dropped edits.
- [x] Clear migration from old Render/device-only data to the primary account site.
- [x] Common document import: PDF/images plus text, Markdown, CSV, HTML, RTF, DOCX, ODT, XLSX and PPTX; unsupported/encrypted/corrupt files get actionable errors.
- [x] Built-in month calendar with date navigation and event details.
- [x] Agenda with overdue/upcoming filters.
- [x] Google Calendar event links.
- [x] Outlook Calendar event links.
- [x] Apple/other calendar downloads with configurable advance reminders.
- [x] Calendar file import with review before saving.
- [x] Custom reminders beyond return/warranty dates.
- [x] Categories and tags with filtering.
- [x] Favorites and pinned important items.
- [x] Templates for subscriptions, bills, warranties and documents.
- [x] Duplicate an item without losing the original.
- [x] Mark deadlines completed and reopen them.
- [x] Snooze/reschedule a reminder explicitly.
- [x] CSV export for spreadsheets.
- [x] Spending summaries grouped by currency and category.
- [x] Better search across notes, tags, merchants and reference text.
- [x] Mobile navigation/forms/calendar at 320px and wider; no input zoom/growth or motion blur.
- [x] Publish and verify live account isolation, cross-device changes, document flows and calendars.

Capacity remains measured, not promised: free-tier quotas do not prove support for 10,000 active users. Uploaded source files are not retained in the database. Calendar links/downloads require user action; no claim of external calendar write access without a real authorized integration.

Verification, 2026-09-15: TypeScript check, 24 unit tests, 32 core browser tests and 2 new character interaction tests passed. Docker fallback image built. Production Cloudflare version `251bcd97-9c67-4d71-9153-b373549e2c8c` serves 100% traffic. Two isolated live browser sessions verified DOCX extraction, metadata, automatic polling, resume refresh, completion sync, calendar links/downloads, spending summaries and mobile overflow. Synthetic accounts were deleted. Local screenshots were reviewed at 320, 390 and 1440 pixels. Live illustration/gaze/blink checks passed after initial deployment propagation. Browser mobile tests use Chromium emulation; physical iOS was not tested.

Playfulness: original illustrated folder with nearby-pointer gaze, touch/keyboard double blink, and finite paper-cut celebrations. See docs/design/illustration.md for the asset, generation prompt and references.
