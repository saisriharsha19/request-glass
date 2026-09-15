import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
const receipt =
  "Store: Document Shop\nItem: Imported document\nPurchase date: 2026-09-15\nTotal paid: USD 12.00";
const paragraph =
  "<w:p><w:r><w:t>Store: Document Shop</w:t></w:r></w:p><w:p><w:r><w:t>Item: Imported document</w:t></w:r></w:p>";
const cases: [string, Buffer][] = [
  ["txt", Buffer.from(receipt)],
  ["md", Buffer.from(receipt)],
  ["csv", Buffer.from(receipt)],
  ["tsv", Buffer.from(receipt)],
  [
    "html",
    Buffer.from(
      '<script>throw Error("must never execute")</script><img src="https://never-fetch.invalid/pixel"><p>Store: Document Shop</p><p>Item: Imported document</p>',
    ),
  ],
  [
    "rtf",
    Buffer.from(
      "{\\rtf1\\ansi Store: Document Shop\\par Item: Imported document}",
    ),
  ],
  [
    "docx",
    Buffer.from(
      zipSync({
        "word/document.xml": strToU8(
          `<w:document xmlns:w="urn:test"><w:body>${paragraph}</w:body></w:document>`,
        ),
      }),
    ),
  ],
  [
    "odt",
    Buffer.from(
      zipSync({
        "content.xml": strToU8(
          '<doc xmlns:text="urn:test"><text:p>Store: Document Shop</text:p><text:p>Item: Imported document</text:p></doc>',
        ),
      }),
    ),
  ],
  [
    "pptx",
    Buffer.from(
      zipSync({
        "ppt/slides/slide1.xml": strToU8(
          `<w:document xmlns:w="urn:test">${paragraph}</w:document>`,
        ),
      }),
    ),
  ],
  [
    "xlsx",
    Buffer.from(
      zipSync({
        "xl/sharedStrings.xml": strToU8(
          "<sst><si><t>Store: Document Shop</t></si><si><t>Item: Imported document</t></si></sst>",
        ),
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet><sheetData><row><c t="s"><v>0</v></c></row><row><c t="s"><v>1</v></c></row></sheetData></worksheet>',
        ),
      }),
    ),
  ],
];
for (const [extension, buffer] of cases)
  test(`imports ${extension} text locally and stores only reviewed details`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("never-fetch")) requests.push(r.url());
    });
    await page.goto("/");
    await page.locator("#new-purchase").click();
    await page
      .locator("#receipt-file")
      .setInputFiles({
        name: `receipt.${extension}`,
        mimeType: "application/octet-stream",
        buffer,
      });
    await expect(page.locator("#item")).toHaveValue("Imported document");
    await expect(page.locator("#merchant")).toHaveValue("Document Shop");
    await expect(page.locator("#ocr-status")).toContainText(
      "original file is not saved",
    );
    await page.locator("#save").click();
    await expect(page.locator(".purchase-card")).toContainText(
      "Imported document",
    );
    await page.getByRole("button", { name: "View / edit" }).click();
    await expect(page.locator("#receipt-text")).toHaveValue(/Document Shop/);
    await expect(page.locator("#receipt-preview img")).toHaveCount(0);
    expect(requests).toEqual([]);
  });
test("corrupt, oversized and unsupported documents retain the current draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("Keep this");
  for (const [name, buffer] of [
    ["bad.docx", Buffer.from("not zip")],
    ["old.doc", Buffer.from("old format")],
    ["huge.txt", Buffer.alloc(10 * 1024 * 1024 + 1, 65)],
  ] as const) {
    await page
      .locator("#receipt-file")
      .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
    await expect(page.locator("#save")).toBeEnabled();
    await expect(page.locator("#item")).toHaveValue("Keep this");
  }
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toContainText("Keep this");
});
