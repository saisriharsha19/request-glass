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
const fields = [
  "item",
  "merchant",
  "purchased",
  "amount",
  "currency",
  ...Object.keys(kinds),
  "notes",
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
      req.result.onversionchange = () => {
        req.result.close();
        db = null;
        $("#storage-warning").hidden = false;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Close another ReturnRadar tab, then reload."));
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
async function reload() {
  const sequence = ++loadSequence;
  const result = await transaction("readonly", (store) => store.getAll());
  if (sequence !== loadSequence) return;
  purchases = result.filter(isPurchase);
  render();
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
  const active = purchases.filter((p) => !p.archived);
  $("#purchase-count").textContent = active.length;
  $("#nav-count").textContent = active.length;
  $("#deadline-count").textContent = active.reduce(
    (sum, p) =>
      sum +
      Object.keys(kinds).filter(
        (k) => p[k] && daysAway(p[k]) >= 0 && daysAway(p[k]) <= 7,
      ).length,
    0,
  );
  $("#receipt-count").textContent = active.filter(
    (p) => p.hasImage || p.text.trim(),
  ).length;
  const query = $("#search").value.toLowerCase().trim();
  const visible = purchases.filter(
    (p) =>
      (view === "archived" ? p.archived : !p.archived) &&
      (view !== "soon" ||
        Object.keys(kinds).some(
          (k) => p[k] && daysAway(p[k]) >= 0 && daysAway(p[k]) <= 7,
        )) &&
      (filter === "all" || p[filter]) &&
      `${p.item} ${p.merchant} ${p.notes}`.toLowerCase().includes(query),
  );
  const currentDay = today();
  const nearest = (p) =>
    Math.min(
      ...Object.keys(kinds)
        .filter((k) => p[k] && daysAway(p[k]) >= 0)
        .map((k) => daysAway(p[k])),
      Infinity,
    );
  const ranks = new Map(visible.map((p) => [p.id, nearest(p)]));
  visible.sort((a, b) =>
    $("#sort").value === "name"
      ? a.item.localeCompare(b.item)
      : $("#sort").value === "recent"
        ? b.purchased.localeCompare(a.purchased)
        : ranks.get(a.id) - ranks.get(b.id),
  );
  renderTimeline(active, currentDay);
  $("#list-count").textContent = visible.length;
  const list = $("#purchase-list");
  const fragment = document.createDocumentFragment();
  if (!visible.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("div", "receipt-art", "≋"),
      el(
        "h3",
        "",
        purchases.length
          ? "Nothing in this corner of the radar."
          : "Your future self says thanks.",
      ),
      el(
        "p",
        "",
        purchases.length
          ? "Try another filter, or add something new to keep an eye on."
          : "That receipt in your inbox? Give it a home. We’ll help you keep the important dates close.",
      ),
    );
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
    top.append(
      el("div", "purchase-symbol", p.cancel ? "↻" : "▣"),
      info,
      el("span", "price-label", money(p)),
    );
    card.append(top);
    if (p.notes) card.append(el("p", "purchase-note", p.notes));
    const dates = el("div", "deadlines");
    for (const [key, label] of Object.entries(kinds))
      if (p[key]) {
        const days = daysAway(p[key]);
        dates.append(
          el(
            "span",
            `deadline ${days < 0 ? "expired" : days <= 7 ? "urgent" : ""}`,
            `${label} · ${fmtDate(p[key])}${days === 0 ? " · Today" : days > 0 && days <= 7 ? ` · ${days}d left` : days < 0 ? " · Past" : ""}`,
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
        await transaction("readwrite", (s) =>
          s.put({ ...p, archived: !p.archived }),
        );
        await reload();
        toast(
          p.archived
            ? "Back on your radar."
            : "Archived. You can restore it anytime.",
        );
      } catch {
        toast("Could not save that change. Please try again.");
      }
    };
    actions.append(edit);
    if (!p.archived) actions.append(cal);
    actions.append(archive);
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
  const events = active
    .flatMap((p) =>
      Object.entries(kinds)
        .filter(([key]) => p[key] && daysAway(p[key], currentDay) >= 0)
        .map(([key, label]) => ({ p, key, label, date: p[key] })),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  const root = $("#upcoming-list");
  root.replaceChildren();
  if (!events.length) {
    const empty = el("div", "timeline-empty");
    const copy = el("div");
    copy.append(
      el("strong", "", "A clear horizon."),
      el(
        "p",
        "",
        "Add a date to a purchase. Your next reminders will land here.",
      ),
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
  receiptImage = p?.image || null;
  $("#purchase-form").reset();
  $("#form-error").textContent = "";
  $("#dialog-title").textContent = p ? "Your purchase" : "Add a purchase";
  $("#delete").hidden = !p;
  $("#receipt-text").value = p?.text || "";
  for (const key of fields)
    $(`#${key}`).value = p?.[key] ?? (key === "currency" ? "USD" : "");
  $("#ocr-status").textContent =
    "Images up to 8 MB. PDFs up to 10 MB / 10 pages. Read on your device; Uploaded files are not saved.";
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
    id: editing || crypto.randomUUID(),
    image: transientReceipt ? null : receiptImage,
    text: $("#receipt-text").value,
    archived: purchases.find((p) => p.id === editing)?.archived || false,
  };
  for (const key of fields) p[key] = $(`#${key}`).value.trim();
  p.amount = p.amount === "" ? "" : Number(p.amount);
  if (!isPurchase(p)) {
    $("#form-error").textContent =
      "Check the item, amount, dates, and receipt size before saving.";
    return;
  }
  $("#save").disabled = true;
  try {
    await transaction("readwrite", (s, receipts) =>
      putPurchase(s, receipts, p),
    );
    await reload();
    $("#purchase-dialog").close();
    celebrate();
    toast(
      editing
        ? "Purchase updated. Future you is in the loop."
        : "On your radar! Add a calendar reminder to get a heads-up.",
    );
  } catch {
    $("#form-error").textContent =
      "Could not save to this browser. Storage may be full or disabled. Your form is still here.";
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
    await transaction("readwrite", (s, receipts) => {
      s.delete(editing);
      receipts.delete(editing);
    });
    await reload();
    $("#purchase-dialog").close();
    toast("Purchase deleted.");
  } catch {
    $("#form-error").textContent = "Could not delete. Try again.";
  }
};
for (const btn of document.querySelectorAll("[data-view]"))
  btn.onclick = () => {
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
    render();
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
  if (!db) return toast("Storage is unavailable; no backup can be read.");
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
    await transaction("readwrite", (s, receipts) => {
      for (const p of data.purchases) putPurchase(s, receipts, p);
    });
    await reload();
    toast("Backup restored. Welcome back.");
  } catch {
    toast(
      "Could not restore. Check the backup format (version 1, up to 50 MB) and available storage.",
    );
  } finally {
    event.target.value = "";
  }
};
function sample() {
  openPurchase();
  const date = new Date();
  date.setDate(date.getDate() + 6);
  const future = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  $("#receipt-text").value =
    `SAMPLE RECEIPT — fictional purchase\nStore: Sound & Sunday\nItem: Cloud Nine Headphones (sample)\nPurchase date: ${today()}\nTotal paid: USD 129.00\nReturn by: ${future}`;
  extract();
  $("#notes").value =
    "Sample purchase for trying ReturnRadar. Not a real receipt.";
}
function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelector(".celebration")?.remove();
  const burst = el("div", "celebration", "✦  ✧  ✹  ✧  ✦");
  burst.setAttribute("aria-hidden", "true");
  document.body.append(burst);
  setTimeout(() => burst.remove(), 1400);
}
try {
  db = await openDB();
  await reload();
} catch {
  $("#storage-warning").hidden = false;
  render();
}
if (updates)
  updates.onmessage = () => {
    if (db) reload().catch(() => toast("Could not refresh saved purchases."));
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
  if (method === "manual") $("#item").focus();
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
  if ((!text && !visionImages.length) || text.length > 20000) {
    $("#ai-status").textContent =
      "Add a receipt file or paste up to 20,000 characters of text first.";
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
    const response = await fetch("/api/ai/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// Delight is event-driven: no animation loops, scroll tracking, or saved state.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const playfulAnimations = new WeakMap();
function wiggle(node, frames, duration = 500) {
  playfulAnimations.get(node)?.cancel();
  if (reducedMotion.matches) return;
  const animation = node.animate(frames, { duration, easing: "ease-out" });
  playfulAnimations.set(node, animation);
}
let greetings = 0;
const buddyMessages = [
  "Oh, hi. I’m Radar. Tiny body, excellent memory aid.",
  "My hobbies? Keeping an eye on things. Both eyes, actually.",
  "You found my good side. It’s every side.",
  "Secret unlocked: you’re officially a friend of future you. ✦",
];
$("#radar-buddy").addEventListener("click", () => {
  toast(buddyMessages[greetings % buddyMessages.length]);
  greetings++;
  wiggle($("#radar-buddy"), [
    { transform: "rotate(-9deg)" },
    { transform: "translateY(-12px) rotate(12deg)", offset: 0.35 },
    { transform: "rotate(-18deg)", offset: 0.7 },
    { transform: "rotate(-9deg)" },
  ]);
  if (greetings % buddyMessages.length === 0) celebrate();
});
const futureNotes = [
  "A tiny bit of order. A little more room for life.",
  "Keep the receipt. Lose the mental tab.",
  "Future you called. They said: excellent work.",
  "Less rummaging. More getting on with your day.",
  "Receipts are boring. Keeping your options? Pretty great.",
];
let noteIndex = 0;
$("#note-shuffle").addEventListener("click", () => {
  const note = $("#future-note");
  note.textContent = futureNotes[noteIndex++ % futureNotes.length];
  wiggle(
    note,
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    220,
  );
});
$("#future-note").setAttribute("aria-live", "polite");
$("#little-secret").addEventListener("click", () => {
  celebrate();
  toast(
    "A very unofficial award for having your life a little more together. ✦",
  );
});
// Hidden word works only outside editors; typing into receipts stays untouched.
let secretWord = "",
  lastSecretKey = 0;
document.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    event.target.closest("input, textarea, select, [contenteditable], dialog")
  )
    return;
  if (event.key.length !== 1) {
    secretWord = "";
    return;
  }
  const now = Date.now();
  if (now - lastSecretKey > 1500) secretWord = "";
  lastSecretKey = now;
  secretWord = (secretWord + event.key.toLowerCase()).slice(-5);
  if (secretWord === "radar") {
    secretWord = "";
    $("#radar-buddy").click();
    celebrate();
    toast("Radar reports: good human detected. Carry on. ✦");
  }
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    for (const node of [$("#radar-buddy"), $("#future-note")])
      playfulAnimations.get(node)?.cancel();
    document.querySelectorAll(".celebration").forEach((node) => node.remove());
  }
});
