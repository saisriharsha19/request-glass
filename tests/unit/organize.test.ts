import { test, expect } from "bun:test";
import { calendar, isPurchase } from "../../public/logic.js";
import {
  itemEvents,
  addDays,
  eventLink,
  spending,
  csvExport,
  parseCalendar,
} from "../../public/organize.js";
const p = {
  id: "one",
  item: "Subscription",
  merchant: "Store",
  notes: "Notes",
  text: "",
  image: null,
  archived: false,
  amount: 10,
  currency: "USD",
  purchased: "",
  return: "",
  cancel: "",
  warranty: "",
  price: "",
  reminder: "2099-01-31",
  reminderLabel: "Review renewal",
  category: "Subscriptions",
  tags: ["home"],
  favorite: true,
  leadDays: 7,
  completed: {},
};
test("custom reminders, completion and rescheduling stay coherent in calendars", () => {
  expect(isPurchase(p)).toBe(true);
  expect(itemEvents([p])[0].label).toBe("Review renewal");
  expect(calendar([p]).text).toContain("TRIGGER:-P7D");
  expect(calendar([p]).text).toContain("Review renewal: Subscription");
  const done = { ...p, completed: { reminder: p.reminder } };
  expect(itemEvents([done])).toHaveLength(0);
  expect(calendar([done]).count).toBe(0);
  expect(
    itemEvents([{ ...done, reminder: addDays(p.reminder, 7) }]),
  ).toHaveLength(1);
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(isPurchase({ ...p, leadDays: -1 })).toBe(false);
  expect(isPurchase({ ...p, tags: ["x".repeat(31)] })).toBe(false);
});
test("calendar links encode user text and exclusive all-day end dates", () => {
  const event = itemEvents([{ ...p, item: "Coffee & tea + sugar" }])[0];
  const google = new URL(eventLink(event, "google"));
  expect(google.hostname).toBe("calendar.google.com");
  expect(google.searchParams.get("text")).toContain("Coffee & tea + sugar");
  expect(google.searchParams.get("dates")).toBe("20990131/20990201");
  expect(new URL(eventLink(event, "outlook")).searchParams.get("enddt")).toBe(
    "2099-02-01",
  );
});
test("spending never combines currencies and CSV prevents formula execution", () => {
  const totals = spending([
    p,
    { ...p, currency: "EUR", amount: 20 },
    { ...p, archived: true, amount: 999 },
  ]);
  expect(totals.map((t) => [t.currency, t.amount])).toEqual([
    ["EUR", 20],
    ["USD", 10],
  ]);
  expect(
    csvExport([
      { ...p, item: '=HYPERLINK("evil")', notes: "Line one\nLine two" },
    ]),
  ).toContain('"\'=HYPERLINK(""evil"")"');
});
test("calendar import unfolds and unescapes text and reports unsupported events", () => {
  const result = parseCalendar(
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20990131\r\nSUMMARY:Renew\\,\r\n  review\r\nDESCRIPTION:First\\nSecond\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20990131T120000Z\r\nSUMMARY:Timed\r\nEND:VEVENT\r\nEND:VCALENDAR",
  );
  expect(result.events).toEqual([
    { title: "Renew, review", date: "2099-01-31", notes: "First\nSecond" },
  ]);
  expect(result.skipped).toBe(1);
  expect(() => parseCalendar("not a calendar")).toThrow();
});
