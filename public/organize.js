import { kinds, validDate, daysAway, today } from "./logic.js";
export const categories = [
  "General",
  "Electronics",
  "Home",
  "Clothing",
  "Subscriptions",
  "Bills",
  "Travel",
  "Documents",
  "Health",
  "Other",
];
export const templates = {
  subscription: {
    item: "Subscription renewal",
    category: "Subscriptions",
    reminderLabel: "Review renewal",
    notes:
      "Check the renewal price and cancellation cutoff. Add the confirmed date.",
  },
  bill: {
    item: "Bill payment",
    category: "Bills",
    reminderLabel: "Payment due",
    notes: "Add the confirmed due date, amount and payment reference.",
  },
  warranty: {
    item: "Warranty record",
    category: "Electronics",
    reminderLabel: "Warranty review",
    notes: "Keep the serial number, seller and warranty terms here.",
  },
  document: {
    item: "Document renewal",
    category: "Documents",
    reminderLabel: "Renew document",
    notes: "Record the expiry date and any required renewal steps.",
  },
};
export function itemEvents(purchases, { includeCompleted = false } = {}) {
  return purchases
    .filter((p) => !p.archived)
    .flatMap((p) =>
      Object.entries(kinds)
        .filter(([key]) => validDate(p[key]))
        .map(([key, label]) => ({
          p,
          key,
          date: p[key],
          label: key === "reminder" ? p.reminderLabel || label : label,
          completed: p.completed?.[key] === p[key],
        })),
    )
    .filter((e) => includeCompleted || !e.completed)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.p.item.localeCompare(b.p.item),
    );
}
export function addDays(date, days) {
  if (!validDate(date) || !Number.isInteger(days))
    throw Error("Choose a valid date.");
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function eventLink(event, provider) {
  const title = `${event.label}: ${event.p.item}`,
    details = [
      event.p.merchant,
      event.p.notes,
      "Review exact cutoff times in the original document.",
    ]
      .filter(Boolean)
      .join("\n");
  if (provider === "google") {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.search = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates:
        event.date.replaceAll("-", "") +
        "/" +
        addDays(event.date, 1).replaceAll("-", ""),
      details,
    }).toString();
    return url.href;
  }
  const url = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  url.search = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: title,
    startdt: event.date,
    enddt: addDays(event.date, 1),
    allday: "true",
    body: details,
  }).toString();
  return url.href;
}
export function spending(purchases) {
  const groups = new Map();
  for (const p of purchases.filter(
    (p) => !p.archived && typeof p.amount === "number",
  )) {
    const key = p.currency + "\0" + (p.category || "General"),
      group = groups.get(key) || {
        currency: p.currency,
        category: p.category || "General",
        amount: 0,
        count: 0,
      };
    group.amount += p.amount;
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount,
  );
}
export function csvExport(purchases) {
  const columns = [
    "item",
    "merchant",
    "category",
    "tags",
    "amount",
    "currency",
    "purchased",
    ...Object.keys(kinds),
    "reminderLabel",
    "notes",
  ];
  const quote = (value) =>
    '"' +
    String(value ?? "")
      .replace(/^[\s]*[=+\-@]/, (m) => "'" + m)
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      columns,
      ...purchases.map((p) =>
        columns.map((k) => (Array.isArray(p[k]) ? p[k].join("; ") : p[k])),
      ),
    ]
      .map((row) => row.map(quote).join(","))
      .join("\r\n")
  );
}
export function parseCalendar(text) {
  if (text.length > 1000000)
    throw Error("Use a calendar file smaller than 1 MB.");
  if (!/BEGIN:VCALENDAR/.test(text))
    throw Error("Choose a valid .ics calendar file.");
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/),
    events = [];
  let current = null,
    skipped = 0;
  const unescape = (s) =>
    s.replace(/\\([nN,;\\])/g, (_, c) => (/[nN]/.test(c) ? "\n" : c));
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.date && current.title && !current.recurring) {
        events.push({
          title: current.title.slice(0, 180),
          date: current.date,
          notes: (current.notes || "").slice(0, 3000),
        });
      } else skipped++;
      current = null;
      if (events.length > 100)
        throw Error("Import up to 100 events at a time.");
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const property = line.slice(0, colon).split(";")[0],
      value = line.slice(colon + 1);
    if (property === "RRULE" || property === "RECURRENCE-ID")
      current.recurring = true;
    if (property === "SUMMARY") current.title = unescape(value);
    if (property === "DESCRIPTION") current.notes = unescape(value);
    if (property === "DTSTART") {
      // Only import all-day dates. Timed/TZ events require a time-zone capable calendar.
      if (/^\d{8}$/.test(value)) {
        const date =
          value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8);
        if (validDate(date)) current.date = date;
      }
    }
  }
  return { events, skipped };
}
