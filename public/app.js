import {
  kinds,
  today,
  daysAway,
  extractReceipt,
  isPurchase,
  calendar,
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
let toastTimeout;
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
    const req = indexedDB.open("return-radar", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("purchases", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Close another ReturnRadar tab, then reload."));
  });
}
function transaction(mode, action) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("Browser storage is unavailable."));
    const tx = db.transaction("purchases", mode);
    const result = action(tx.objectStore("purchases"));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save."));
  });
}
async function reload() {
  purchases = (await transaction("readonly", (store) => store.getAll())).filter(
    isPurchase,
  );
  render();
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fmtDate = (date) =>
  new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
    (p) => p.image || p.text.trim(),
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
  const nearest = (p) =>
    Math.min(
      ...Object.keys(kinds)
        .filter((k) => p[k] && daysAway(p[k]) >= 0)
        .map((k) => daysAway(p[k])),
      Infinity,
    );
  visible.sort((a, b) => nearest(a) - nearest(b));
  $("#list-count").textContent = visible.length;
  const list = $("#purchase-list");
  list.replaceChildren();
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
    list.append(empty);
  }
  for (const p of visible) {
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
      el(
        "span",
        "price-label",
        p.amount === ""
          ? "—"
          : new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: p.currency,
            }).format(p.amount),
      ),
    );
    card.append(top);
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
    if (p.image || p.text.trim())
      card.append(
        el("div", "receipt-status", "✓ Receipt saved on this device"),
      );
    list.append(card);
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
    $("#receipt-file").value = "";
    preview();
  };
  root.append(img, remove);
}
function openPurchase(p = null) {
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
    "English image text is read on your device. PNG, JPG or WebP, up to 8 MB.";
  preview();
  $("#purchase-dialog").showModal();
}
function setBusy(value) {
  busy = value;
  $("#save").disabled = value;
  $("#extract").disabled = value;
  $("#receipt-file").disabled = value;
  $("#receipt-text").readOnly = value;
}
async function closeDialog() {
  ocrRun++;
  if (worker) {
    await worker.terminate();
    worker = null;
  }
  setBusy(false);
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
    if (img.naturalWidth * img.naturalHeight > 24000000)
      throw new Error("Image too large");
    receiptImage = data;
    preview();
    currentWorker = await Tesseract.createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      workerBlobURL: false,
      logger: (m) => {
        if (run === ocrRun)
          $("#ocr-status").textContent =
            `Reading on your device: ${m.status}${m.progress ? " " + Math.round(m.progress * 100) + "%" : ""}`;
      },
    });
    if (run !== ocrRun) {
      await currentWorker.terminate();
      return;
    }
    worker = currentWorker;
    const result = await currentWorker.recognize(data);
    if (run !== ocrRun) return;
    if (result.data.text.length > 50000) throw new Error("Too much text");
    $("#receipt-text").value = result.data.text;
    extract();
  } catch {
    if (run === ocrRun)
      $("#ocr-status").textContent =
        "Could not read this image. Try a clearer or smaller image, or paste the text and enter details manually.";
  } finally {
    if (currentWorker) await currentWorker.terminate();
    if (run === ocrRun) {
      worker = null;
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
    image: receiptImage,
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
    await transaction("readwrite", (s) => s.put(p));
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
    await transaction("readwrite", (s) => s.delete(editing));
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
$("#search").oninput = render;
$("#calendar-all").onclick = () => reminders(purchases);
$("#export").onclick = () => {
  if (!db) return toast("Storage is unavailable; no backup can be read.");
  download(
    JSON.stringify({ version: 1, purchases }, null, 2),
    "application/json",
    `returnradar-backup-${today()}.json`,
  );
  toast(
    "Backup exported, including your receipt images. Keep it somewhere private.",
  );
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
    await transaction("readwrite", (s) => {
      for (const p of data.purchases) s.put(p);
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
window.addEventListener("focus", () => {
  if (db) reload().catch(() => toast("Could not refresh saved purchases."));
});

for (const label of document.querySelectorAll('label[role="button"]'))
  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      label.querySelector('input[type="file"]').click();
    }
  });
