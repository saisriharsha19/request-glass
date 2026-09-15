import {createViewState} from '/ui-state.js';
import {linkify} from '/links.js';
import { connectedEvents, connectedSources, setCalendarRange, calendarPage, loadCalendarPage } from "/calendar-sources.js";
import { celebrate } from "/celebration.js";
import { icon } from "/icons.js";
import { categories, templates, itemEvents } from "/organize.js";
import { createPlanner } from "/planner.js";
import { PurchaseSync } from "/sync.js";
import {
  kinds,
  today,
  daysAway,
  extractReceipt,
  isPurchase,
  calendar,
  mergeSuggestions,
} from "/logic.js";
const $ = (s) => document.querySelector(s);
const sync = new PurchaseSync();
let documentController = null;
let planner;
const searchIndex = new WeakMap();
function searchable(p) {
  if (!searchIndex.has(p))
    searchIndex.set(
      p,
      `${p.item} ${p.merchant} ${p.notes} ${p.text} ${(p.tags || []).join(" ")} ${p.category || ""}`.toLowerCase(),
    );
  return searchIndex.get(p);
}
let finishAccountLoad;
const accountLoaded = new Promise((resolve) => {
  finishAccountLoad = resolve;
});
let accountReady = false,
  editingVersion = 0,
  draftId = "",
  syncRunning = false,
  syncRequested = false;
const accountUpdates =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("returnradar-account")
    : null;
function syncMessage(text) {
  $("#sync-message").textContent = sync.primaryOrigin
    ? "Sync is available on the current app. Export a backup here, open the current app, sign in, then restore it there. Your device copies stay safe."
    : text;
}
async function savePurchase(p, version = 0) {
  if (sync.user) {
    const saved = await sync.save(p, version);
    loadSequence++;
    purchases = [...purchases.filter((item) => item.id !== saved.id), saved];
  } else
    await transaction("readwrite", (store, receipts) =>
      putPurchase(store, receipts, p),
    );
}
async function afterWrite() {
  if (sync.user) {
    render();
    syncMessage(
      "Saved to your account. Other devices will pick up the change.",
    );
  } else await reload();
}
let calendarAccountId;
async function updateAccountUI() {
  if (calendarAccountId !== sync.user?.id) { calendarAccountId = sync.user?.id; window.dispatchEvent(new CustomEvent("tuckday-account-changed", {detail: {userId: calendarAccountId}})); }
  $("#sidebar-sync-status").textContent = sync.user
    ? `Signed in as @${sync.user.username}. Saved records stay in your account, even when other devices are offline.`
    : "Guest records stay on this device. Sign in to save them to your account.";
  $("#sync-title").textContent = sync.user
    ? `Hi, ${sync.user.name}. @${sync.user.username}`
    : "On this device";
  $("#storage-state").textContent = sync.user
    ? "Account sync"
    : "Saved on your device";
  $("#sync-now").hidden = !sync.user;
  $("#sync-signin").hidden = !!sync.user;
  if (sync.primaryOrigin) {
    $("#sync-title").textContent = "This is the old, device-only site";
    $("#sync-signin").href = sync.primaryOrigin;
    $("#sync-signin").textContent = "Open the current app ↗";
  }
  const local = db ? await transaction("readonly", (s) => s.getAll()) : [];
  $("#claim-local").hidden =
    !sync.user ||
    !local.some((p) => isPurchase(p) && !purchases.some((c) => c.id === p.id));
}
async function refreshSync({ force = false, session = false } = {}) {
  if (document.hidden) return;
  if (syncRunning) {
    if (force || session) syncRequested = true;
    return;
  }
  if ($("#purchase-dialog").open) {
    if (force || session)
      syncMessage(
        "Your draft is safe. Close the editor to refresh other devices’ changes.",
      );
    return;
  }
  syncRunning = true;
  $("#sync-now").disabled = true;
  $("#sync-now").textContent = "Checking…";
  $("#sync-strip").setAttribute("aria-busy", "true");
  if (force || session || !accountReady) syncMessage("Checking your account and saved records…");
  try {
    if (!accountReady) {
      await sync.initialize();
      await reload(true);
      accountReady = true;
    }
    if (session && (await sync.refreshSession())) {
      loadSequence++;
      purchases = [];
      render();
    }
    if (sync.user || session) await reload(force);
    await updateAccountUI();
    syncMessage(
      sync.user
        ? `@${sync.user.username} · ${purchases.length} ${purchases.length === 1 ? "record" : "records"} confirmed on server · Checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : "Device-only mode. Sign in to the same username on each device to sync.",
    );
  } catch (error) {
    syncMessage(`Sync needs attention: ${error.message}`);
    $("#sync-now").hidden = false;
  } finally {
    syncRunning = false;
    $("#sync-now").disabled = false;
    $("#sync-now").textContent = accountReady ? "Sync now" : "Retry connection";
    $("#sync-strip").removeAttribute("aria-busy");
    if (syncRequested) {
      syncRequested = false;
      void refreshSync({ force: true, session: true });
    }
  }
}
const fields = [
  "item",
  "merchant",
  "purchased",
  "amount",
  "currency",
  ...Object.keys(kinds),
  "notes",
  "reminderLabel",
];
let db,
  purchases = [],
  view = "all",
  filter = "all",
  editing = null,
  receiptImage = null,
  worker = null,
  ocrRun = 0,
  busy = false;
let toastTimeout, workerIdleTimer, tesseractLoading;
let pageLimit = 30,
  renderFrame = 0,
  loadSequence = 0,
  openSequence = 0;
let visionImages = [],
  transientReceipt = false;
let aiController = null,
  pdfController = null;
const touchedFields = new Set();
const updates =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("returnradar-updates")
    : null;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const moneyFormatters = new Map();
function money(p) {
  if (p.amount === "") return "—";
  if (!moneyFormatters.has(p.currency))
    moneyFormatters.set(
      p.currency,
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: p.currency,
      }),
    );
  return moneyFormatters.get(p.currency).format(p.amount);
}
function queueRender() {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    render();
  });
}

const el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(
    () => $("#toast").classList.remove("visible"),
    5000,
  );
}
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("return-radar", 2);
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error("Browser storage did not open.")); }, 5000);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("purchases"))
        database.createObjectStore("purchases", { keyPath: "id" });
      const receipts = database.createObjectStore("receipts", {
        keyPath: "id",
      });
      const cursor = req.transaction.objectStore("purchases").openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const p = entry.value;
        if (p.image) receipts.put({ id: p.id, image: p.image });
        entry.update({ ...p, image: null, hasImage: !!p.image });
        entry.continue();
      };
    };
    req.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) { req.result.close(); return; }
      req.result.onversionchange = () => {
        req.result.close();
        db = null;
        $("#storage-warning").hidden = false;
      };
      resolve(req.result);
    };
    req.onerror = () => { clearTimeout(timeout); reject(req.error); };
    req.onblocked = () => { expired = true; clearTimeout(timeout); reject(new Error("Close another Tuckday tab, then reload.")); };
  });
}
function transaction(mode, action) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("Browser storage is unavailable."));
    const tx = db.transaction(
      mode === "readwrite" ? ["purchases", "receipts"] : ["purchases"],
      mode,
    );
    const result = action(
      tx.objectStore("purchases"),
      mode === "readwrite" ? tx.objectStore("receipts") : null,
    );
    tx.oncomplete = () => {
      if (mode === "readwrite") updates?.postMessage("changed");
      resolve(result?.result);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save."));
  });
}
async function reload(force = false) {
  const sequence = ++loadSequence;
  const result = sync.user
    ? await sync.list(force)
    : await transaction("readonly", (store) => store.getAll());
  if (sequence !== loadSequence) return;
  if (result) {
    if (sync.user && result.some(p => !isPurchase(p)))
      throw new Error("Some saved records could not be read by this version. Reload the app; your records remain on the server.");
    purchases = result.filter(isPurchase);
    render();
  }
}
async function getReceipt(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("Storage unavailable"));
    const tx = db.transaction("receipts", "readonly");
    const req = tx.objectStore("receipts").get(id);
    tx.oncomplete = () => resolve(req.result?.image || null);
    tx.onerror = () => reject(tx.error);
  });
}
function putPurchase(store, receipts, p) {
  store.put({ ...p, hasImage: !!p.image, image: null });
  if (p.image) receipts.put({ id: p.id, image: p.image });
  else receipts.delete(p.id);
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fmtDate = (date) => dateFormatter.format(new Date(date + "T12:00:00"));
function reminders(list) {
  const result = calendar(list);
  if (!result.count)
    return toast("No upcoming dates yet. Add a date to a purchase first.");
  download(
    result.text,
    "text/calendar;charset=utf-8",
    "returnradar-reminders.ics",
  );
  toast(
    "Import the calendar file to enable reminders. For near deadlines, set an extra alert.",
  );
}
function render() {
  planner?.render();
  const active = purchases.filter((p) => !p.archived);
  const next = itemEvents(active)[0];
  $("#next-date-label").textContent =
    next && daysAway(next.date) < 0 ? "OVERDUE" : "NEXT UP";
  $("#next-date-number").textContent = next
    ? String(Number(next.date.slice(8)))
    : "—";
  $("#next-date-month").textContent = next
    ? new Date(next.date + "T12:00:00").toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : "No dates added";
  $("#next-date-item").textContent = next
    ? `${next.p.item} · ${next.label}`
    : "Add a deadline to an item.";
  $("#purchase-count").textContent = active.length;
  $("#nav-count").textContent = active.length;
  $("#deadline-count").textContent = itemEvents(active).filter(
    (e) => daysAway(e.date) >= 0 && daysAway(e.date) <= 7,
  ).length;
  $("#receipt-count").textContent = active.filter(
    (p) => p.hasImage || p.text.trim(),
  ).length;
  const query = $("#search").value.toLowerCase().trim();
  const visible = purchases.filter(
    (p) =>
      (view === "archived" ? p.archived : !p.archived) &&
      (view !== "soon" ||
        itemEvents([p]).some(
          (e) => daysAway(e.date) >= 0 && daysAway(e.date) <= 7,
        )) &&
      (filter === "all" || p[filter]) &&
      ($("#category-filter").value === "all" ||
        (p.category || "General") === $("#category-filter").value) &&
      (!$("#favorites-only").checked || p.favorite) &&
      searchable(p).includes(query),
  );
  const currentDay = today();
  const nearest = (p) =>
    Math.min(
      ...Object.keys(kinds)
        .filter((k) => p[k] && p.completed?.[k] !== p[k] && daysAway(p[k]) >= 0)
        .map((k) => daysAway(p[k])),
      Infinity,
    );
  const ranks = new Map(visible.map((p) => [p.id, nearest(p)]));
  visible.sort(
    (a, b) =>
      Number(!!b.favorite) - Number(!!a.favorite) ||
      ($("#sort").value === "name"
        ? a.item.localeCompare(b.item)
        : $("#sort").value === "recent"
          ? b.purchased.localeCompare(a.purchased)
          : ranks.get(a.id) - ranks.get(b.id)),
  );
  renderTimeline(active, currentDay);
  $("#list-count").textContent = visible.length;
  const list = $("#purchase-list");
  const fragment = document.createDocumentFragment();
  if (!visible.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("div", "receipt-art"),
      el("h3", "", purchases.length ? "No matching items." : "No items yet."),
      el(
        "p",
        "",
        purchases.length
          ? "Try another filter, or add something new to keep an eye on."
          : "Add a receipt, document or reminder. Its details and dates will appear here.",
      ),
    );
    empty.querySelector(".receipt-art").append(icon("pocket"));
    const actions = el("div", "empty-actions");
    const add = el("button", "primary", "＋ Add a purchase");
    add.onclick = () => openPurchase();
    const demo = el("button", "text-button", "Try a sample ↗");
    demo.onclick = sample;
    actions.append(add, demo);
    empty.append(actions);
    const hint = el("div", "empty-hint");
    for (const label of [
      "Receipt images",
      "Calendar reminders",
      "No account needed",
    ])
      hint.append(el("span", "", label));
    empty.append(hint);
    fragment.append(empty);
  }
  for (const p of visible.slice(0, pageLimit)) {
    const card = el("article", "purchase-card");
    const top = el("div", "purchase-top");
    const info = el("div", "purchase-info");
    info.append(
      el("h3", "", p.item),
      el(
        "p",
        "",
        `${p.merchant || "Store not added"}${p.purchased ? " · " + fmtDate(p.purchased) : ""}`,
      ),
    );
    if (p.tags?.length || p.category)
      info.append(
        el(
          "small",
          "item-tags",
          [p.category, ...(p.tags || [])].filter(Boolean).join(" · "),
        ),
      );
    top.append(
      el("div", "purchase-symbol"),
      info,
      el("span", "price-label", money(p)),
    );
    top
      .querySelector(".purchase-symbol")
      .append(
        icon(
          p.favorite
            ? "bookmark"
            : p.category === "Documents"
              ? "document"
              : "folder",
        ),
      );
    card.append(top);
    if (p.notes) card.append(linkify(el("p", "purchase-note"), p.notes));
    const dates = el("div", "deadlines");
    for (const [key, label] of Object.entries(kinds))
      if (p[key]) {
        const days = daysAway(p[key]);
        dates.append(
          el(
            "span",
            `deadline ${days < 0 ? "expired" : days <= 7 ? "urgent" : ""}`,
            `${key === "reminder" ? p.reminderLabel || label : label} · ${fmtDate(p[key])}${p.completed?.[key] === p[key] ? " · Done" : days === 0 ? " · Today" : days > 0 && days <= 7 ? ` · ${days}d left` : days < 0 ? " · Past" : ""}`,
          ),
        );
      }
    if (!dates.childElementCount)
      dates.append(
        el("span", "deadline", "No dates added · Review your receipt"),
      );
    card.append(dates);
    const actions = el("div", "card-actions");
    const edit = el("button", "", "View / edit");
    edit.onclick = () => openPurchase(p);
    const cal = el("button", "", "↓ Calendar");
    cal.onclick = () => reminders([p]);
    const archive = el("button", "", p.archived ? "Restore" : "Archive");
    archive.onclick = async () => {
      try {
        if (sync.user)
          await savePurchase({ ...p, archived: !p.archived }, p._version);
        else
          await transaction("readwrite", (s) =>
            s.put({ ...p, archived: !p.archived }),
          );
        await afterWrite();
        toast(
          p.archived
            ? "Restored from the archive."
            : "Archived. You can restore it anytime.",
        );
      } catch (error) {
        toast(error.message || "Could not save that change. Please try again.");
      }
    };
    actions.append(edit);
    if (!p.archived) actions.append(cal);
    actions.append(archive);
    const favorite = el(
      "button",
      "",
      p.favorite ? "★ Favorited" : "☆ Favorite",
    );
    favorite.onclick = async () => {
      try {
        await savePurchase({ ...p, favorite: !p.favorite }, p._version || 0);
        await afterWrite();
      } catch (error) {
        toast(error.message);
      }
    };
    const duplicate = el("button", "", "Duplicate");
    duplicate.onclick = async () => {
      await openPurchase({ ...p, image: null, hasImage: false, completed: {} });
      editing = null;
      editingVersion = 0;
      $("#delete").hidden = true;
      $("#dialog-title").textContent = "Make a copy";
      $("#item").value = p.item.slice(0, 173) + " (copy)";
    };
    actions.append(favorite, duplicate);
    card.append(actions);
    if (p.hasImage || p.text.trim())
      card.append(
        el(
          "div",
          "receipt-status",
          p.hasImage ? "✓ Original receipt saved" : "✓ Receipt text saved",
        ),
      );
    fragment.append(card);
  }
  list.replaceChildren(fragment);
  $("#load-more").hidden = visible.length <= pageLimit;
}
function renderTimeline(active, currentDay) {
  const events = itemEvents(active)
    .filter((e) => daysAway(e.date, currentDay) >= 0)
    .slice(0, 3);
  const root = $("#upcoming-list");
  root.replaceChildren();
  if (!events.length) {
    const empty = el("div", "timeline-empty");
    const copy = el("div");
    copy.append(
      el("strong", "", "No upcoming dates."),
      el("p", "", "Add a date to an item to list it here."),
    );
    empty.append(el("span", "", "◷"), copy);
    root.append(empty);
  }
  for (const event of events) {
    const date = new Date(event.date + "T12:00:00");
    const row = el("div", "timeline-row");
    const stamp = el("div", "timeline-date");
    stamp.append(
      el("strong", "", date.getDate()),
      el("span", "", date.toLocaleDateString(undefined, { month: "short" })),
    );
    const copy = el("div", "timeline-copy");
    copy.append(
      el("strong", "", event.p.item),
      el(
        "p",
        "",
        `${event.label} · ${daysAway(event.date, currentDay) === 0 ? "Today" : fmtDate(event.date)}`,
      ),
    );
    const button = el("button");
    button.setAttribute("aria-label", `Review ${event.p.item} ${event.label}`);
    button.append(icon("arrow"));
    button.onclick = () => openPurchase(event.p);
    row.append(stamp, copy, button);
    root.append(row);
  }
}
function preview() {
  const root = $("#receipt-preview");
  root.replaceChildren();
  if (!receiptImage) return;
  const img = el("img");
  img.src = receiptImage;
  img.alt = "Attached receipt";
  const remove = el("button", "", "Remove image");
  remove.type = "button";
  remove.onclick = () => {
    receiptImage = null;
    visionImages = [];
    $("#receipt-file").value = "";
    preview();
  };
  root.append(img, remove);
}
async function openPurchase(p = null) {
  await accountLoaded;
  if (!accountReady) {
    syncMessage("Your account is still loading. Please retry in a moment.");
    return;
  }
  visionImages = [];
  transientReceipt = false;
  const sequence = ++openSequence;
  touchedFields.clear();
  if (p) for (const field of fields) if (p[field]) touchedFields.add(field);
  setBusy(false);
  $("#ai-status").textContent =
    "Optional: sends receipt text and prepared page images together to NVIDIA NIM once. Uploads are not saved.";
  $("#ai-evidence").replaceChildren();
  for (const field of document.querySelectorAll(".ai-filled"))
    field.classList.remove("ai-filled");
  setMethod("paste");
  editing = p?.id || null;
  editingVersion = p?._version || 0;
  draftId = crypto.randomUUID();
  $("#conflict-backup").hidden = true;
  receiptImage = p?.image || null;
  $("#purchase-form").reset();
  $("#form-error").textContent = "";
  $("#dialog-title").textContent = p ? "Your purchase" : "Add a purchase";
  $("#delete").hidden = !p;
  $("#receipt-text").value = p?.text || "";
  for (const key of fields)
    $(`#${key}`).value = p?.[key] ?? (key === "currency" ? "USD" : "");
  $("#ocr-status").textContent =
    "Images up to 8 MB. PDF, Office and text documents up to 10 MB (PDF: 10 pages). Original files are not saved.";
  $("#category").value = p?.category || "General";
  $("#tags").value = (p?.tags || []).join(", ");
  $("#favorite").checked = !!p?.favorite;
  $("#reminderLabel").value = p?.reminderLabel || "";
  $("#leadDays").value = String(p?.leadDays ?? 3);
  preview();
  $("#purchase-dialog").showModal();
  if (p?.hasImage) {
    $("#save").disabled = true;
    try {
      const image = await getReceipt(p.id);
      if (sequence !== openSequence) return;
      receiptImage = image;
      preview();
      $("#save").disabled = false;
    } catch {
      if (sequence === openSequence)
        $("#form-error").textContent =
          "Could not load the original receipt. Close and try again before saving.";
    }
  }
}
function setBusy(value) {
  busy = value;
  $("#save").disabled = value;
  $("#extract").disabled = value;
  $("#receipt-file").disabled = value;
  $("#receipt-text").readOnly = value;
  $("#ai-fill").disabled = value;
  $("#stop-ocr").hidden = !value;
  $("#ocr-progress").hidden = !value;
}
function stopWork() {
  ocrRun++;
  openSequence++;
  documentController?.abort();
  documentController = null;
  pdfController?.abort();
  pdfController = null;
  aiController?.abort();
  aiController = null;
  const oldWorker = worker;
  worker = null;
  visionImages = [];
  if (transientReceipt) {
    receiptImage = null;
    preview();
  }
  $("#receipt-file").value = "";
  setBusy(false);
  clearTimeout(workerIdleTimer);
  if (oldWorker) oldWorker.terminate().catch(() => {});
}
function closeDialog() {
  queueMicrotask(() => refreshSync({ force: true, session: true }));
  visionImages = [];
  if (transientReceipt) receiptImage = null;
  $("#receipt-file").value = "";
  openSequence++;
  if (busy) stopWork();
  else {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = setTimeout(() => {
      worker?.terminate().catch(() => {});
      worker = null;
    }, 60000);
  }
}
$("#stop-ocr").onclick = () => {
  stopWork();
  $("#ocr-status").textContent =
    "Stopped. Temporary upload cleared. Any extracted text is still here for manual entry.";
  $("#ai-status").textContent = "Stopped. Your entries are unchanged.";
};
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractLoading)
    tesseractLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/ocr/tesseract.min.js";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => {
        script.remove();
        tesseractLoading = null;
        reject(new Error("OCR unavailable"));
      };
      document.head.append(script);
    });
  return tesseractLoading;
}
$("#purchase-dialog").addEventListener("close", closeDialog);
$("#close-dialog").onclick = $("#cancel-dialog").onclick = () =>
  $("#purchase-dialog").close();
$("#new-purchase").onclick = () => openPurchase();
function extract() {
  const text = $("#receipt-text").value.trim();
  if (!text) return toast("Paste receipt text or add an image first.");
  const details = extractReceipt(text);
  let count = 0;
  for (const [key, value] of Object.entries(details))
    if (value !== "" && (key !== "currency" || details.amount)) {
      $(`#${key}`).value = value;
      count++;
    }
  $("#ocr-status").textContent =
    `${count} suggested fields filled. Review every detail below. Dates without a year or with ambiguous numeric formats are left blank.`;
}
$("#extract").onclick = extract;
$("#receipt-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    await importPdf(file);
    event.target.value = "";
    return;
  }
  if (!file.type.startsWith("image/")) {
    const run = ++ocrRun;
    documentController = new AbortController();
    setBusy(true);
    $("#ocr-status").textContent = "Reading your document on this device…";
    try {
      const { readDocument } = await import("/documents.js");
      const result = await readDocument(file, {
        signal: documentController.signal,
      });
      if (run !== ocrRun) return;
      receiptImage = null;
      visionImages = [];
      transientReceipt = true;
      preview();
      $("#receipt-text").value = result.text;
      extract();
      $("#ocr-status").textContent =
        `${result.format} text read. Review the details below. The original file is not saved.`;
    } catch (error) {
      if (run === ocrRun) $("#ocr-status").textContent = error.message;
    } finally {
      if (run === ocrRun) setBusy(false);
      event.target.value = "";
    }
    return;
  }
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    event.target.value = "";
    return toast("Choose a PNG, JPG, or WebP image smaller than 8 MB.");
  }
  const run = ++ocrRun;
  setBusy(true);
  $("#ocr-status").textContent =
    "Reading your receipt… Everything stays on your device.";
  let currentWorker;
  try {
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    if (run !== ocrRun) return;
    const img = new Image();
    img.src = data;
    await img.decode();
    if (run !== ocrRun) return;
    if (img.naturalWidth * img.naturalHeight > 24000000)
      throw new Error("Image too large");
    receiptImage = data;
    transientReceipt = true;
    visionImages = [];
    preview();
    clearTimeout(workerIdleTimer);
    const Tesseract = await loadTesseract();
    if (run !== ocrRun) return;
    currentWorker =
      worker ||
      (await Tesseract.createWorker("eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr",
        workerBlobURL: false,
        logger: (m) => {
          if (busy && $("#purchase-dialog").open) {
            $("#ocr-progress").value = Math.round((m.progress || 0) * 100);
            $("#ocr-status").textContent =
              `Reading on your device: ${m.status}${m.progress ? " " + Math.round(m.progress * 100) + "%" : ""}`;
          }
        },
      }));
    if (run !== ocrRun) {
      await currentWorker.terminate();
      return;
    }
    worker = currentWorker;
    // OCR only needs a readable working copy; preserve the original image separately.
    const scale = Math.min(
      1,
      2200 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    visionImages = [canvas.toDataURL("image/jpeg", 0.75)];
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const result = await currentWorker.recognize(blob);
    if (run !== ocrRun) return;
    if (result.data.text.length > 50000) throw new Error("Too much text");
    $("#receipt-text").value = result.data.text;
    extract();
  } catch {
    if (currentWorker) await currentWorker.terminate().catch(() => {});
    if (worker === currentWorker) worker = null;
    if (run === ocrRun)
      $("#ocr-status").textContent =
        "Could not read this image. Try a clearer or smaller image, or paste the text and enter details manually.";
  } finally {
    if (run === ocrRun) {
      setBusy(false);
    }
  }
};
$("#purchase-form").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  $("#form-error").textContent = "";
  const p = {
    id: editing || draftId,
    image: transientReceipt ? null : receiptImage,
    text: $("#receipt-text").value,
    archived: purchases.find((p) => p.id === editing)?.archived || false,
  };
  for (const key of fields) p[key] = $(`#${key}`).value.trim();
  p.amount = p.amount === "" ? "" : Number(p.amount);
  p.category = $("#category").value;
  p.tags = [
    ...new Set(
      $("#tags")
        .value.split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  p.favorite = $("#favorite").checked;
  p.reminderLabel = $("#reminderLabel").value.trim();
  p.leadDays = Number($("#leadDays").value);
  p.completed = purchases.find((item) => item.id === editing)?.completed || {};
  if (!isPurchase(p)) {
    $("#form-error").textContent =
      "Check the item, amount, dates, and receipt size before saving.";
    return;
  }
  const saveButton = $("#save").getBoundingClientRect();
  const successPoint = {
    x: saveButton.x + saveButton.width / 2,
    y: saveButton.y,
  };
  const isNew = !editing;
  $("#save").disabled = true;
  try {
    await savePurchase(p, editingVersion);
    await afterWrite();
    $("#purchase-dialog").close();
    if (isNew) celebrate(successPoint);
    toast(
      editing
        ? "Changes saved."
        : "Saved. You can add the date to your calendar.",
    );
  } catch (error) {
    $("#form-error").textContent = sync.user
      ? error.message
      : "Could not save to this browser. Storage may be full or disabled. Your form is still here.";
    if (sync.user) {
      $("#conflict-backup").hidden = false;
      $("#conflict-backup").onclick = () =>
        download(
          JSON.stringify({ version: 1, purchases: [p] }, null, 2),
          "application/json",
          "returnradar-unsaved-purchase.json",
        );
    }
  } finally {
    $("#save").disabled = false;
  }
};
$("#delete").onclick = async () => {
  if (
    !editing ||
    !confirm("Permanently delete this purchase and its saved receipt?")
  )
    return;
  try {
    if (sync.user) {
      await sync.remove({ id: editing, _version: editingVersion });
      loadSequence++;
      purchases = purchases.filter((p) => p.id !== editing);
    } else
      await transaction("readwrite", (s, receipts) => {
        s.delete(editing);
        receipts.delete(editing);
      });
    await afterWrite();
    $("#purchase-dialog").close();
    toast("Purchase deleted.");
  } catch (error) {
    $("#form-error").textContent =
      error.message || "Could not delete. Try again.";
  }
};
for (const btn of document.querySelectorAll("[data-view]"))
  btn.onclick = () => {
    const changed=view!==btn.dataset.view;
    if(changed)saveView();
    view = btn.dataset.view;
    for (const b of document.querySelectorAll("[data-view]"))
      b.classList.toggle("selected", b === btn);
    $("#view-name").textContent =
      view === "all" ? "Overview" : view === "soon" ? "Coming up" : "Archived";
    $("#list-title").firstChild.textContent =
      view === "archived"
        ? "Archived purchases "
        : view === "soon"
          ? "Coming up this week "
          : "Your purchases ";
    selectWorkspace("items");
    render();
    if(changed)saveView(true);
  };
for (const btn of document.querySelectorAll("[data-filter]"))
  btn.onclick = () => {
    filter = btn.dataset.filter;
    for (const b of document.querySelectorAll("[data-filter]"))
      b.classList.toggle("active", b === btn);
    render();
  };
$("#search").oninput = () => {
  pageLimit = 30;
  queueRender();
};
$("#sort").onchange = () => {
  pageLimit = 30;
  queueRender();
};
$("#load-more").onclick = () => {
  pageLimit += 30;
  queueRender();
};
$("#calendar-all").onclick = () => reminders(purchases);
$("#export").onclick = async () => {
  if (!db && !sync.user)
    return toast("Storage is unavailable; no backup can be read.");
  $("#export").disabled = true;
  try {
    const full = [];
    for (const p of purchases)
      full.push({ ...p, image: p.hasImage ? await getReceipt(p.id) : null });
    download(
      JSON.stringify({ version: 1, purchases: full }, null, 2),
      "application/json",
      `returnradar-backup-${today()}.json`,
    );
    toast(
      "Backup exported, including your receipt images. Keep it somewhere private.",
    );
  } catch {
    toast("Could not read the full backup. Please try again.");
  } finally {
    $("#export").disabled = false;
  }
};
$("#import").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error();
    const data = JSON.parse(await file.text());
    if (
      data.version !== 1 ||
      !Array.isArray(data.purchases) ||
      data.purchases.length > 2000 ||
      !data.purchases.every(isPurchase) ||
      new Set(data.purchases.map((p) => p.id)).size !== data.purchases.length
    )
      throw new Error();
    if (
      !confirm(
        `Restore ${data.purchases.length} purchases? Matching purchases will be replaced; other purchases will remain.`,
      )
    )
      return;
    if (sync.user) {
      for (const p of data.purchases)
        await savePurchase(
          p,
          purchases.find((item) => item.id === p.id)?._version || 0,
        );
    } else
      await transaction("readwrite", (s, receipts) => {
        for (const p of data.purchases) putPurchase(s, receipts, p);
      });
    await afterWrite();
    toast("Backup restored.");
  } catch (error) {
    if (sync.user) {
      render();
      toast(
        `Restore stopped: ${error.message} Purchases already confirmed remain saved; your backup file is unchanged.`,
      );
    } else
      toast(
        "Could not restore. Check the backup format (version 1, up to 50 MB) and available storage.",
      );
  } finally {
    event.target.value = "";
  }
};
async function sample() {
  await openPurchase();
  if (!accountReady) return;
  const date = new Date();
  date.setDate(date.getDate() + 6);
  const future = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  $("#receipt-text").value =
    `SAMPLE RECEIPT — fictional purchase\nStore: Sound & Sunday\nItem: Cloud Nine Headphones (sample)\nPurchase date: ${today()}\nTotal paid: USD 129.00\nReturn by: ${future}`;
  extract();
  $("#notes").value =
    "Sample purchase for trying Tuckday. Not a real receipt.";
}
for (const category of categories) {
  for (const id of ["#category", "#category-filter"]) {
    const option = el("option", "", category);
    option.value = category;
    $(id).append(option);
  }
}
$("#category-filter").onchange = $("#favorites-only").onchange = () => {
  pageLimit = 30;
  render();
};
$("#template-select").onchange = async (event) => {
  const template = templates[event.target.value];
  event.target.value = "";
  if (!template) return;
  await openPurchase();
  for (const [key, value] of Object.entries(template))
    $(`#${key}`).value = value;
  setMethod("manual");
};
let activeWorkspace="items", viewReady=false, applyingView=false, savedScroll={}, restoreFrame=0;
const viewStore=createViewState();
function snapshotView(){return {workspace:activeWorkspace,view,filter,query:$("#search").value,sort:$("#sort").value,category:$("#category-filter").value,favorites:$("#favorites-only").checked,limit:pageLimit,scroll:savedScroll,calendar:planner.getState()};}
function saveView(push=false){if(viewReady&&!applyingView)viewStore.save(snapshotView(),push);}
function selectWorkspace(selected) {
  const changed=selected!==activeWorkspace;
  if(viewReady&&changed&&!applyingView){savedScroll[activeWorkspace]=scrollY;saveView();}
  activeWorkspace=selected;
  for (const button of document.querySelectorAll("[data-workspace]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.workspace === selected),
    );
  for (const name of ["items", "planner", "insights"])
    $(`#${name}-workspace`).hidden = name !== selected;
  $(".intro").hidden = selected !== "items";
  $(".stats").hidden = selected !== "items";
  $("#view-name").textContent=selected==='planner'?'Calendar':selected==='insights'?'Insights':view==='soon'?'Records / Coming up':view==='archived'?'Records / Archived':'Records';
  document.title=`${selected==='planner'?'Calendar':selected==='insights'?'Insights':'Records'} — Tuckday`;
  for(const button of document.querySelectorAll('[data-workspace]')){if(button.dataset.workspace===selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  planner?.render();
  if(viewReady&&changed&&!applyingView){saveView(true);cancelAnimationFrame(restoreFrame);restoreFrame=requestAnimationFrame(()=>scrollTo({top:savedScroll[selected]||0,behavior:'instant'}));}
}
for (const button of document.querySelectorAll("[data-workspace]")) {
  button.onclick = () => selectWorkspace(button.dataset.workspace);
}
$("#planner-new").onclick = async () => {
  await openPurchase();
  setMethod("manual");
  $("#reminderLabel").value = "Reminder";
};
planner = createPlanner({
  setCalendarRange, calendarPage, loadCalendarPage,
  getExternalEvents: () => connectedEvents(sync.user?.id),
  getSources: () => connectedSources(sync.user?.id),
  getPurchases: () => purchases,
  edit: openPurchase,
  download,
  toast,
  exportCalendar: reminders,
  save: async (p, version) => {
    await savePurchase(p, version);
    await afterWrite();
  },
  create: async (event) => {
    const p = {
      id: event.id,
      item: event.title,
      merchant: "",
      purchased: "",
      amount: "",
      currency: "USD",
      notes: event.notes,
      text: "",
      image: null,
      archived: false,
      category: "Documents",
      reminderLabel: "Reminder",
      leadDays: 3,
    };
    for (const key of Object.keys(kinds))
      p[key] = key === "reminder" ? event.date : "";
    await savePurchase(p, 0);
    await afterWrite();
  },
});
// Useful keyboard access; input and document editing are never intercepted.
function focusSearch() {
  selectWorkspace("items");
  $("#search").focus();
}
$("#focus-search").onclick = focusSearch;
$("#next-date-open").onclick = () =>
  selectWorkspace("planner");
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing &&
    !event.target.closest("input, textarea, select, [contenteditable], dialog")
  ) {
    event.preventDefault();
    focusSearch();
  }
});

try {
  db = await openDB();
} catch {
  $("#storage-warning").hidden = false;
}
try {
  await sync.initialize();
  await reload();
  accountReady = true;
  await updateAccountUI();
  syncMessage(
    sync.user
      ? `@${sync.user.username} · ${purchases.length} ${purchases.length === 1 ? "record" : "records"} confirmed on server. Other devices may be offline.`
      : "Sign in to sync. Device-only purchases stay in this browser.",
  );
} catch (error) {
  syncMessage(error.message);
  $("#sync-now").hidden = false;
  $("#sync-now").textContent = "Retry connection";
} finally {
  finishAccountLoad();
}
$("#sync-now").onclick = () => refreshSync({ force: true, session: true });
$("#claim-local").onclick = async () => {
  if (!sync.user || syncRunning) return;
  const local = (await transaction("readonly", (s) => s.getAll())).filter(
    (p) => isPurchase(p) && !purchases.some((c) => c.id === p.id),
  );
  if (
    !local.length ||
    !confirm(
      `Add ${local.length} device purchases to your account? Text and dates will sync. Original files stay on this device. Existing account purchases will not be replaced.`,
    )
  )
    return;
  syncRunning = true;
  $("#claim-local").disabled = true;
  let count = 0;
  try {
    for (const p of local) {
      await savePurchase(p, 0);
      count++;
      syncMessage(`Adding device purchases: ${count} of ${local.length}…`);
    }
    syncMessage(
      `${count} purchases added to your account. Device copies are kept.`,
    );
  } catch (error) {
    syncMessage(
      `${count} added. ${error.message} All device copies are still kept.`,
    );
  } finally {
    syncRunning = false;
    $("#claim-local").disabled = false;
    render();
    await updateAccountUI();
  }
};
if (accountUpdates)
  accountUpdates.onmessage = () => refreshSync({ force: true, session: true });
setInterval(() => refreshSync(), 15000);
const resumeSync = () => refreshSync({ force: true, session: true });
window.addEventListener("online", resumeSync);
window.addEventListener("focus", resumeSync);
window.addEventListener("pageshow", resumeSync);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) resumeSync();
});
window.addEventListener("offline", () =>
  syncMessage(
    "Offline. Account saves need a connection; keep your draft open until you reconnect.",
  ),
);
if (updates)
  updates.onmessage = () => {
    if (db && !sync.user)
      reload().catch(() => toast("Could not refresh saved purchases."));
  };
let renderedDay = today();
window.addEventListener("focus", () => {
  if (today() !== renderedDay) {
    renderedDay = today();
    queueRender();
  }
});
$("#today-label").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
function setMethod(method) {
  $(".capture-section").dataset.method = method;
  for (const b of document.querySelectorAll("button[data-method]"))
    b.setAttribute("aria-pressed", String(b.dataset.method === method));
  // Input methods change the source panel, never move focus or jump down the form.
}
for (const b of document.querySelectorAll("button[data-method]"))
  b.onclick = () => setMethod(b.dataset.method);

for (const label of document.querySelectorAll('label[role="button"]'))
  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      label.querySelector('input[type="file"]').click();
    }
  });

$("#ai-fill").onclick = async () => {
  const text = $("#receipt-text").value.trim();
  if ((!text && !visionImages.length) || text.length > 50000) {
    $("#ai-status").textContent =
      "Add a receipt file or paste up to 50,000 characters of text first.";
    return;
  }
  if (busy) return;
  const run = ++ocrRun;
  const controller = new AbortController();
  aiController = controller;
  const timeout = setTimeout(() => controller.abort(), 50000);
  setBusy(true);
  $("#ocr-progress").hidden = true;
  $(".ai-assist").setAttribute("aria-busy", "true");
  $("#ai-status").textContent =
    "Reading the text and available receipt pages together with NVIDIA NIM… You can stop at any time.";
  $("#ai-evidence").replaceChildren();
  try {
    const { getAuthConfig, getSession } = await import("/auth-client.js");
    const config = await getAuthConfig();
    const session = config.aiRequiresLogin ? await getSession() : null;
    if (config.aiRequiresLogin && !session?.user)
      throw new Error(
        "Sign in from Your account to use AI assistance. Local scanning still works.",
      );
    if (run !== ocrRun) return;
    const response = await fetch("/api/ai/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        images: await prepareVisionSheet(visionImages),
      }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (run !== ocrRun) return;
    if (!response.ok)
      throw new Error(result.error || "AI assistance is unavailable.");
    const current = Object.fromEntries(
      fields.map((key) => [key, $(`#${key}`).value]),
    );
    const merged = mergeSuggestions(
      current,
      touchedFields,
      result.fields || {},
    );
    const evidence = el("details");
    evidence.append(
      el("summary", "", "Review the suggested details & sources"),
    );
    for (const key of merged.applied) {
      const field = result.fields[key];
      $(`#${key}`).value = merged.values[key];
      $(`#${key}`).classList.add("ai-filled");
      evidence.append(
        el(
          "p",
          "",
          `${key} · ${field.source === "image" ? `Visual reading — check your original` : "Receipt text"}: ${field.evidence}`,
        ),
      );
    }
    if (merged.applied.length) $("#ai-evidence").append(evidence);
    const calendarDates=merged.applied.filter(key=>Object.hasOwn(kinds,key));
    if(calendarDates.length){
      const summary=el("p","ai-date-summary",calendarDates.map(key=>`${key === "reminder" ? $("#reminderLabel").value || "Reminder" : kinds[key]}: ${fmtDate(merged.values[key])}`).join(" · "));
      $("#ai-evidence").prepend(summary);
    }
    $("#ai-status").textContent = merged.applied.length
      ? `${merged.applied.length} suggestions ready for review. Your manual edits were kept. Temporary upload cleared.`
      : "No new supported details. Your entries were kept. Temporary upload cleared.";
  } catch (error) {
    if (run === ocrRun)
      $("#ai-status").textContent =
        error.name === "AbortError"
          ? "That took too long. Your entries are unchanged; local extraction still works."
          : error.message;
  } finally {
    clearTimeout(timeout);
    if (run === ocrRun) {
      visionImages = [];
      if (transientReceipt) {
        receiptImage = null;
        preview();
      }
      $("#receipt-file").value = "";
      aiController = null;
      setBusy(false);
    }
    if (run === ocrRun) $(".ai-assist").setAttribute("aria-busy", "false");
  }
};

for (const field of fields)
  document
    .getElementById(field)
    .addEventListener("input", () => touchedFields.add(field));

async function importPdf(file) {
  if (file.size > 10 * 1024 * 1024) {
    toast("Choose a PDF smaller than 10 MB.");
    return;
  }
  const run = ++ocrRun;
  const controller = new AbortController();
  pdfController = controller;
  setBusy(true);
  clearTimeout(workerIdleTimer);
  $("#ocr-status").textContent = "Opening PDF on your device…";
  try {
    const { readPdf } = await import("/pdf.js");
    const result = await readPdf(file, {
      signal: controller.signal,
      onProgress: (message, progress) => {
        if (run === ocrRun) {
          $("#ocr-status").textContent = message;
          $("#ocr-progress").value = progress;
        }
      },
      recognize: async (blob) => {
        const Tesseract = await loadTesseract();
        if (run !== ocrRun) throw new DOMException("Stopped", "AbortError");
        const current =
          worker ||
          (await Tesseract.createWorker("eng", 1, {
            workerPath: "/ocr/worker.min.js",
            corePath: "/ocr",
            langPath: "/ocr",
            workerBlobURL: false,
          }));
        if (run !== ocrRun) {
          await current.terminate();
          throw new DOMException("Stopped", "AbortError");
        }
        worker = current;
        const response = await current.recognize(blob);
        return response.data.text;
      },
    });
    if (run !== ocrRun) return;
    receiptImage = null;
    transientReceipt = true;
    visionImages = result.images;
    preview();
    $("#receipt-text").value = result.text;
    extract();
    setMethod("paste");
    $("#ocr-status").textContent =
      `Read ${result.pages} PDF page${result.pages === 1 ? "" : "s"}${result.scanned ? ` (${result.scanned} scanned)` : ""}. Review the details. Only extracted text is kept; the PDF file is not stored.`;
  } catch (error) {
    if (run === ocrRun)
      $("#ocr-status").textContent =
        error.message ||
        "Could not read this PDF. Try another file or paste the receipt text.";
  } finally {
    if (run === ocrRun) {
      pdfController = null;
      setBusy(false);
    }
  }
}

async function prepareVisionSheet(images) {
  if (images.length < 2) return images;
  // One upload to the vision model. Local OCR retains the full text from every page.
  const columns = images.length > 3 ? 2 : 1,
    width = 900,
    header = 38;
  const decoded = await Promise.all(
    images.map(
      (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        }),
    ),
  );
  const heights = decoded.map(
    (i) => Math.round((i.naturalHeight * width) / i.naturalWidth) + header,
  );
  const rowHeights = [];
  for (let i = 0; i < heights.length; i += columns)
    rowHeights.push(Math.max(...heights.slice(i, i + columns)));
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0),
    scale = Math.min(1, 4800 / totalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = columns * width * scale;
  canvas.height = totalHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, columns * width, totalHeight);
  ctx.font = "bold 22px Arial";
  let top = 0;
  for (let i = 0; i < decoded.length; i++) {
    if (i && i % columns === 0) top += rowHeights[Math.floor(i / columns) - 1];
    const left = (i % columns) * width;
    ctx.fillStyle = "black";
    ctx.fillText(`PAGE ${i + 1}`, left + 18, top + 27);
    ctx.drawImage(decoded[i], left, top + header, width, heights[i] - header);
  }
  let result = canvas.toDataURL("image/jpeg", 0.7);
  if (result.length > 1200000) result = canvas.toDataURL("image/jpeg", 0.4);
  canvas.width = 0;
  canvas.height = 0;
  if (result.length > 1200000)
    throw new Error(
      "This receipt sheet is too large for AI. Use fewer PDF pages or text only.",
    );
  return [result];
}

window.addEventListener("tuckday-calendars-changed", () => planner?.render());

function applyView(state){
 applyingView=true;
 savedScroll=state.scroll;view=state.view;filter=state.filter;pageLimit=state.limit;
 $("#search").value=state.query;$("#sort").value=state.sort;$("#category-filter").value=state.category;
 if(!$("#category-filter").value)$("#category-filter").value='all';
 $("#favorites-only").checked=state.favorites;
 for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b.dataset.view===view);
 for(const b of document.querySelectorAll('[data-filter]'))b.classList.toggle('active',b.dataset.filter===filter);
 $("#view-name").textContent=view==='all'?'Overview':view==='soon'?'Coming up':'Archived';
 $("#list-title").firstChild.textContent=view==='archived'?'Archived purchases ':view==='soon'?'Coming up this week ':'Your purchases ';
 planner.restore(state.calendar);selectWorkspace(state.workspace);render();
 applyingView=false;
 cancelAnimationFrame(restoreFrame);restoreFrame=requestAnimationFrame(()=>scrollTo({top:savedScroll[activeWorkspace]||0,behavior:'instant'}));
}
accountLoaded.then(()=>{viewReady=true;applyView(viewStore.bind(sync.user?.id,true));for(const button of document.querySelectorAll("[data-workspace]"))button.disabled=false;});
window.addEventListener('tuckday-account-changed',event=>{if(!viewReady)return;applyView(viewStore.bind(event.detail?.userId));});
window.addEventListener('popstate',()=>{if(!viewReady)return;for(const d of document.querySelectorAll('dialog[open]'))d.close();applyView(viewStore.restoreHistory());});
const viewControls='#search,#sort,#category-filter,#favorites-only,#agenda-filter,#calendar-source-filter,#month-jump,[data-view],[data-filter],#month-grid,#month-prev,#month-next,#month-today,#clear-day,#load-more,#agenda-more';
for(const name of ['input','change','click'])document.addEventListener(name,event=>{if(event.target.closest?.(viewControls))queueMicrotask(()=>saveView());});
let scrollTimer;
window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(viewReady&&!document.querySelector('dialog[open]')){savedScroll[activeWorkspace]=scrollY;saveView();}},150);},{passive:true});
window.addEventListener('pagehide',()=>{if(viewReady){savedScroll[activeWorkspace]=scrollY;saveView();}});
