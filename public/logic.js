export const kinds = {
  return: "Return by",
  cancel: "Cancel by",
  warranty: "Warranty ends",
  price: "Check price",
  reminder: "Reminder",
};
export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function daysAway(date, from = today()) {
  return Math.round(
    (Date.parse(date + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) /
      86400000,
  );
}
export function readDate(line) {
  const iso = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && validDate(iso[1])) return iso[1];
  const written = line.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (written) {
    const month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(written[1].slice(0, 3).toLowerCase()) + 1;
    const result = `${written[3]}-${String(month).padStart(2, "0")}-${written[2].padStart(2, "0")}`;
    if (validDate(result)) return result;
  }
  return "";
}
export function extractReceipt(text) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result = {
    item: "",
    merchant: "",
    amount: "",
    currency: "USD",
    purchased: "",
    return: "",
    cancel: "",
    warranty: "",
    price: "",
  };
  for (const line of lines) {
    const item = line.match(/^(?:item|product|description)\s*:\s*(.+)/i);
    if (item) result.item = item[1].slice(0, 180);
    const merchant = line.match(
      /^(?:store|merchant|retailer|sold by)\s*:\s*(.+)/i,
    );
    if (merchant) result.merchant = merchant[1].slice(0, 100);
    if (
      /^(?:grand total|order total|total paid|amount paid|total|paid)\s*[:\s]/i.test(
        line,
      )
    ) {
      const value = line.replace(
        /^(?:grand total|order total|total paid|amount paid|total|paid)\s*:?\s*/i,
        "",
      );
      const amount = value.match(
        /^(?:(?:USD|EUR|GBP|INR|CAD|AUD|JPY|[$€£₹])\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP|INR|CAD|AUD|JPY)?$/i,
      );
      if (amount) result.amount = amount[1].replaceAll(",", "");
      const currency = line.match(/\b(USD|EUR|GBP|INR|CAD|AUD|JPY)\b/i);
      if (currency) result.currency = currency[1].toUpperCase();
      else if (line.includes("€")) result.currency = "EUR";
      else if (line.includes("£")) result.currency = "GBP";
      else if (line.includes("₹")) result.currency = "INR";
    }
    const date = readDate(line);
    if (!date) continue;
    if (
      /^(?:return(?:s)? (?:by|before|until|deadline)|return window (?:ends|closes)|return deadline)\b/i.test(
        line,
      )
    )
      result.return = date;
    else if (
      /^(?:cancel (?:by|before)|cancellation deadline|trial ends)\b/i.test(line)
    )
      result.cancel = date;
    else if (/^warranty (?:ends|until|expires)\b/i.test(line))
      result.warranty = date;
    else if (/^(?:purchase date|order date|purchased|date)\s*:/i.test(line))
      result.purchased = date;
  }
  if (!result.merchant && lines[0] && !/[:@]|\d/.test(lines[0]))
    result.merchant = lines[0].slice(0, 100);
  return result;
}
export function isPurchase(p) {
  return (
    !!p &&
    typeof p.id === "string" &&
    p.id.length <= 100 &&
    typeof p.item === "string" &&
    p.item.trim().length > 0 &&
    p.item.length <= 180 &&
    typeof p.merchant === "string" &&
    p.merchant.length <= 100 &&
    typeof p.notes === "string" &&
    p.notes.length <= 3000 &&
    typeof p.text === "string" &&
    p.text.length <= 50000 &&
    typeof p.archived === "boolean" &&
    ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"].includes(p.currency) &&
    (p.amount === "" ||
      (typeof p.amount === "number" &&
        Number.isFinite(p.amount) &&
        p.amount >= 0 &&
        p.amount <= 999999999)) &&
    ["purchased", ...Object.keys(kinds)].every(
      (k) =>
        (k === "reminder" && p[k] === undefined) ||
        p[k] === "" ||
        validDate(p[k]),
    ) &&
    (p.category === undefined ||
      (typeof p.category === "string" && p.category.length <= 40)) &&
    (p.tags === undefined ||
      (Array.isArray(p.tags) &&
        p.tags.length <= 10 &&
        p.tags.every((t) => typeof t === "string" && t.length <= 30))) &&
    (p.favorite === undefined || typeof p.favorite === "boolean") &&
    (p.reminderLabel === undefined ||
      (typeof p.reminderLabel === "string" && p.reminderLabel.length <= 80)) &&
    (p.leadDays === undefined ||
      (Number.isInteger(p.leadDays) && p.leadDays >= 0 && p.leadDays <= 30)) &&
    (p.completed === undefined ||
      (!!p.completed &&
        typeof p.completed === "object" &&
        !Array.isArray(p.completed) &&
        Object.entries(p.completed).every(
          ([key, date]) => Object.hasOwn(kinds, key) && validDate(date),
        ))) &&
    (p.image === null ||
      (typeof p.image === "string" &&
        p.image.length <= 12 * 1024 * 1024 &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(p.image)))
  );
}
const escapeICS = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function fold(line) {
  const out = [];
  let part = "";
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 74) {
      out.push(part);
      part = " ";
      bytes = 1;
    }
    part += char;
    bytes += size;
  }
  out.push(part);
  return out.join("\r\n");
}
export function calendar(purchases) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tuckday//Purchase reminders//EN",
    "CALSCALE:GREGORIAN",
  ];
  let count = 0;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  for (const purchase of purchases.filter((p) => !p.archived))
    for (const [key, label] of Object.entries(kinds)) {
      const date = purchase[key];
      if (
        !validDate(date) ||
        daysAway(date) < 0 ||
        purchase.completed?.[key] === date
      )
        continue;
      const next = new Date(date + "T12:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeICS(purchase.id)}-${key}@returnradar.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${date.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll("-", "")}`,
        `SUMMARY:${escapeICS(`${key === "reminder" ? purchase.reminderLabel || label : label}: ${purchase.item}`)}`,
        `DESCRIPTION:${escapeICS(`${purchase.merchant}\n${purchase.notes}\nDate reviewed in Tuckday. Check the merchant's exact cutoff time.\nConfirm the selected alert in your calendar, especially for a near deadline.`)}`,
        "BEGIN:VALARM",
        `TRIGGER:-P${Number.isInteger(purchase.leadDays) ? purchase.leadDays : 3}D`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeICS(`${key === "reminder" ? purchase.reminderLabel || label : label}: ${purchase.item}`)}`,
        "END:VALARM",
        "END:VEVENT",
      );
      count++;
    }
  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", count };
}

// Explicit user edits win. AI can correct automated OCR suggestions without overwriting them.
export function mergeSuggestions(current, touched, suggestions) {
  const values = { ...current },
    applied = [];
  for (const [key, field] of Object.entries(suggestions)) {
    if (
      !Object.hasOwn(values, key) ||
      touched.has(key) ||
      !field ||
      typeof field.value !== "string"
    )
      continue;
    if (values[key] !== field.value) {
      values[key] = field.value;
      applied.push(key);
    }
  }
  return { values, applied };
}
