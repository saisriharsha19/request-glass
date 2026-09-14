import { test, expect } from "@playwright/test";
test("receipt review, persistence, edit, search, calendar, archive and restore", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Your future self says thanks.")).toBeVisible();
  await page.getByRole("button", { name: "Try a sample" }).click();
  await expect(page.locator("#item")).toHaveValue(
    "Cloud Nine Headphones (sample)",
  );
  await page.locator("#return").fill("2099-01-12");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  await page.reload();
  await expect(page.locator(".purchase-card")).toContainText(
    "Cloud Nine Headphones",
  );
  await page.getByRole("button", { name: "View / edit" }).click();
  await page.locator("#item").fill("<script>alert(1)</script> headphones");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.locator(".purchase-card h3")).toHaveText(
    "<script>alert(1)</script> headphones",
  );
  await page.locator("#search").fill("no match");
  await expect(page.locator(".purchase-card")).toHaveCount(0);
  await page.locator("#search").fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ Calendar", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "returnradar-reminders.ics",
  );
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#purchase-count")).toHaveText("0");
  await page.locator('[data-view="archived"]').click();
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator(".purchase-card")).toHaveCount(0);
  await page.locator('[data-view="all"]').click();
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("mobile layout and keyboard dialog dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#new-purchase")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator("#new-purchase").click();
  await expect(page.locator("#purchase-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#purchase-dialog")).not.toBeVisible();
  await page.screenshot({
    path: "/tmp/returnradar-mobile.png",
    fullPage: true,
  });
});
test("reads an image locally and saves its receipt", async ({ page }) => {
  test.setTimeout(90000);
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().startsWith("http") &&
      !r.url().startsWith("http://127.0.0.1:3210")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.locator("#new-purchase").click();
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 450;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "black";
    x.font = "32px Arial";
    [
      "Store: Audio World",
      "Item: Wireless Headphones",
      "Total paid: USD 129.00",
      "Return by: 2099-01-12",
    ].forEach((s, i) => x.fillText(s, 40, 65 + i * 75));
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator("#receipt-file")
    .setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(page.locator("#ocr-status")).toContainText(
    "suggested fields filled",
    { timeout: 60000 },
  );
  await expect(page.locator("#item")).toHaveValue("Wireless Headphones");
  await expect(page.locator("#return")).toHaveValue("2099-01-12");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.locator("#receipt-count")).toHaveText("1");
  await page.reload();
  await page.getByRole("button", { name: "View / edit" }).click();
  await expect(page.locator("#receipt-preview img")).toBeVisible();
  expect(external).toEqual([]);
});
test("backup round trip restores receipts and rejects malformed data", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.getByRole("button", { name: "Save purchase" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "View / edit" }).click();
  page.on("dialog", (d) => d.accept());
  await page.locator("#delete").click();
  await expect(page.locator("#purchase-count")).toHaveText("0");
  await page.locator("#import").setInputFiles(path!);
  await expect(page.locator("#purchase-count")).toHaveText("1");
  await page
    .locator("#import")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"purchases":[{"id":"bad"}]}'),
    });
  await expect(page.locator("#toast")).toContainText("Could not restore");
  await expect(page.locator("#purchase-count")).toHaveText("1");
});
