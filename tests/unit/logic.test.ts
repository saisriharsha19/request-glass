import { describe, expect, test } from "bun:test";
import {
  extractReceipt,
  validDate,
  daysAway,
  calendar,
  isPurchase,
} from "../../public/logic.js";
const purchase = {
  id: "test",
  item: "Headphones",
  merchant: "Store",
  amount: 120,
  currency: "USD",
  purchased: "",
  return: "2099-01-12",
  cancel: "",
  warranty: "",
  price: "",
  notes: "Keep receipt",
  text: "",
  image: null,
  archived: false,
};
describe("receipt extraction boundaries", () => {
  test("extracts explicit terms and the total rather than subtotal", () => {
    const r = extractReceipt(
      "Store: Example\nItem: Headphones\nSubtotal: 100.00\nTotal paid: EUR 120.00\nPurchase date: 2026-09-14\nReturn by: October 12, 2026\nWarranty until: 2027-09-14",
    );
    expect(r.amount).toBe("120.00");
    expect(r.currency).toBe("EUR");
    expect(r.return).toBe("2026-10-12");
    expect(r.warranty).toBe("2027-09-14");
  });
  test("does not invent a policy, year, or ambiguous locale", () => {
    const r = extractReceipt(
      "Return within 30 days\nReturn by: Oct 12\nWarranty until: 09/10/2027",
    );
    expect(r.return).toBe("");
    expect(r.warranty).toBe("");
  });
  test("does not treat negative or unrelated return language as a deadline", () => {
    expect(
      extractReceipt(
        "No returns after purchase on 2026-09-14\nReturn label generated: 2026-09-14",
      ).return,
    ).toBe("");
  });
  test("validates real dates and DST independent arithmetic", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2028-02-29")).toBe(true);
    expect(daysAway("2026-03-09", "2026-03-07")).toBe(2);
  });
});
describe("calendar and backup safety", () => {
  test("exports all-day events and escaped text with a three day alarm", () => {
    const c = calendar([
      { ...purchase, item: "Thing; with, punctuation\nand newline" },
    ]);
    expect(c.count).toBe(1);
    expect(c.text).toContain("DTEND;VALUE=DATE:20990113");
    expect(c.text).toContain("TRIGGER:-P3D");
    expect(c.text).toContain("Thing\\; with\\, punctuation\\nand newline");
  });
  test("excludes archived purchases and past dates", () => {
    expect(
      calendar([
        { ...purchase, archived: true },
        { ...purchase, return: "2000-01-01" },
      ]).count,
    ).toBe(0);
  });
  test("rejects unsafe images and malformed imports", () => {
    expect(isPurchase(purchase)).toBe(true);
    expect(
      isPurchase({ ...purchase, image: "data:image/svg+xml;base64,foo" }),
    ).toBe(false);
    expect(isPurchase({ ...purchase, amount: Infinity })).toBe(false);
    expect(isPurchase({ ...purchase, return: "2099-02-30" })).toBe(false);
  });
});

test("AI can correct automated guesses while explicit user edits win", async () => {
  const { mergeSuggestions } = await import("../../public/logic.js");
  const result = mergeSuggestions(
    { item: "OCR typo", amount: "12.00", merchant: "My store" },
    new Set(["merchant"]),
    {
      item: { value: "Correct item" },
      amount: { value: "129.00" },
      merchant: { value: "Different store" },
      unknown: { value: "x" },
    },
  );
  expect(result.values).toEqual({
    item: "Correct item",
    amount: "129.00",
    merchant: "My store",
  });
  expect(result.applied).toEqual(["item", "amount"]);
});
