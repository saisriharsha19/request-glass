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

test("mobile resume refreshes the same account without pressing Sync now", async ({
  page,
  browser,
}) => {
  const username = "resume-" + crypto.randomUUID().slice(0, 8);
  await register(page, username);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3210",
    viewport: { width: 390, height: 844 },
  });
  try {
    const phone = await context.newPage();
    await login(phone, username);
    await page.locator("#new-purchase").click();
    await page.locator("#item").fill("Appears when phone resumes");
    await page.locator("#save").click();
    await expect(page.locator("#purchase-count")).toHaveText("1");
    await phone.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(phone.locator(".purchase-card")).toContainText(
      "Appears when phone resumes",
    );
    await expect(phone.locator("#sync-message")).toContainText(`@${username}`);
    await expect(phone.locator("#sync-message")).toContainText("1 saved items");
    await phone.getByRole("button", { name: "View / edit" }).click();
    await phone.locator("#notes").fill("Keep my typing");
    await phone.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(phone.locator("#notes")).toHaveValue("Keep my typing");
    await expect(phone.locator("#sync-message")).toContainText("draft is safe");
  } finally {
    await context.close();
  }
});

test("session changes made in another tab cannot leave stale account records visible", async ({
  page,
}) => {
  const first = "session-" + crypto.randomUUID().slice(0, 8);
  await register(page, first);
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("Private first account item");
  await page.locator("#save").click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  // Change the cookie without BroadcastChannel: this also exercises browsers where it is unavailable.
  await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://127.0.0.1:3210" },
    data: {},
  });
  await page.request.post("/api/auth/register", {
    headers: { Origin: "http://127.0.0.1:3210" },
    data: {
      username: "second-" + crypto.randomUUID().slice(0, 8),
      name: "Other account",
      password,
    },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.locator("#sync-title")).toContainText("Other account");
  await expect(page.locator("#purchase-count")).toHaveText("0");
  await expect(page.locator(".purchase-card")).toHaveCount(0);
});

test("a delayed sync response cannot overwrite a purchase saved while it was in flight", async ({
  page,
}) => {
  await register(page, "race-" + crypto.randomUUID().slice(0, 8));
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("Before race");
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toContainText("Before race");
  await expect(page.locator("#sync-now")).toBeEnabled();
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let intercepted: () => void = () => {};
  const ready = new Promise<void>((resolve) => (intercepted = resolve));
  await page.route(
    "**/api/purchases",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      intercepted();
      await blocked;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.locator("#sync-now").click();
  await ready;
  await page.getByRole("button", { name: "View / edit" }).click();
  await page.locator("#item").fill("Newer saved version");
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toContainText(
    "Newer saved version",
  );
  release();
  await expect(page.locator("#sync-now")).toBeEnabled();
  await expect(page.locator(".purchase-card")).toContainText(
    "Newer saved version",
  );
  await page.locator("#sync-now").click();
  await expect(page.locator(".purchase-card")).toContainText(
    "Newer saved version",
  );
});
