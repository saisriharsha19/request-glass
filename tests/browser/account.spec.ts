import { test, expect, type Page } from "@playwright/test";
const password = "a-strong-browser-test-password";
async function register(page: Page, username: string) {
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.locator("#account-display-name").fill("Alex");
  await page.locator("#account-username").fill(username);
  await page.locator("#account-password").fill(password);
  await page.locator("#account-submit").click();
  await expect(page.locator("#recovery-result")).toBeVisible();
  await page.locator("#recovery-saved").check();
  await page.locator("#recovery-done").click();
  await page.getByRole("link", { name: "Go to my purchases" }).click();
  await expect(page.locator("#sync-title")).toContainText("Alex");
}
async function login(page: Page, username: string) {
  await page.goto("/account");
  await page.locator("#account-username").fill(username);
  await page.locator("#account-password").fill(password);
  await page.locator("#account-submit").click();
  await page.getByRole("link", { name: "Go to my purchases" }).click();
  await expect(page.locator("#sync-title")).toContainText("Alex");
}
test("native accounts sync two browsers, reject stale edits, and sync deletion", async ({
  page,
  browser,
}) => {
  const username = "sync-" + crypto.randomUUID().slice(0, 10);
  await register(page, username);
  await page.locator("#new-purchase").click();
  await page.locator('button[data-method="manual"]').click();
  await page.locator("#item").fill("Shared headphones");
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toContainText(
    "Shared headphones",
  );
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:3210" });
  const other = await second.newPage();
  // Explicit base URL for a separately created browser context.
  await other.goto("http://127.0.0.1:3210");
  await login(other, username);
  await expect(other.locator(".purchase-card")).toContainText(
    "Shared headphones",
  );
  await other.getByRole("button", { name: "View / edit" }).click();
  await other.locator("#item").fill("Stale phone edit");
  await page.getByRole("button", { name: "View / edit" }).click();
  await page.locator("#item").fill("New laptop edit");
  await page.locator("#save").click();
  await other.locator("#save").click();
  await expect(other.locator("#form-error")).toContainText("another device");
  await expect(other.locator("#item")).toHaveValue("Stale phone edit");
  await expect(other.locator("#conflict-backup")).toBeVisible();
  await other.locator("#close-dialog").click();
  await other.locator("#sync-now").click();
  await expect(other.locator(".purchase-card")).toContainText(
    "New laptop edit",
  );
  await other.getByRole("button", { name: "View / edit" }).click();
  other.once("dialog", (d) => d.accept());
  await other.locator("#delete").click();
  await expect(other.locator("#purchase-count")).toHaveText("0");
  await page.locator("#sync-now").click();
  await expect(page.locator("#purchase-count")).toHaveText("0");
  await second.close();
});
test("device purchases require explicit import and sign-out does not expose account purchases", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.locator("#save").click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  const thirdParty: string[] = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith("http://127.0.0.1:3210") &&
      !req.url().startsWith("blob:")
    )
      thirdParty.push(new URL(req.url()).hostname);
  });
  await register(page, "claim-" + crypto.randomUUID().slice(0, 10));
  await expect(page.locator("#purchase-count")).toHaveText("0");
  page.once("dialog", (d) => d.accept());
  await page.locator("#claim-local").click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("Account only purchase");
  await page.locator("#save").click();
  await expect(page.locator("#purchase-count")).toHaveText("2");
  await page.getByRole("link", { name: "Your account" }).click();
  await page.locator("#sign-out").click();
  await page.getByRole("link", { name: "Continue with device-only" }).click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  await expect(page.locator(".purchase-card")).not.toContainText(
    "Account only purchase",
  );
  expect(thirdParty).toEqual([]);
});
test("mobile account fields stay fixed while typing and failed cloud saves retain the form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/account");
  await expect(page.locator("#account-username")).toBeVisible();
  const before = await page.locator("#account-password").boundingBox();
  await page
    .locator("#account-password")
    .fill("A long password with many words and symbols!123");
  await page.locator("#show-password").click();
  const after = await page.locator("#account-password").boundingBox();
  expect(after!.width).toBe(before!.width);
  expect(after!.height).toBe(before!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await register(page, "offline-" + crypto.randomUUID().slice(0, 8));
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("Keep this draft");
  await page.route("**/api/purchases/*", (route) => route.abort());
  await page.locator("#save").click();
  await expect(page.locator("#form-error")).toContainText("Connection lost");
  await expect(page.locator("#item")).toHaveValue("Keep this draft");
  await page.unroute("**/api/purchases/*");
  await page.locator("#save").click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
});
