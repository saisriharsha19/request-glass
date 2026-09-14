import { test, expect } from "@playwright/test";
test("account page is honest when login is unconfigured and guest purchases remain usable", async ({
  page,
}) => {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { auth: null, sync: "local-only" } }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: "Your account" }).click();
  await expect(page.locator("#account-status")).toContainText(
    "isn’t connected yet",
  );
  await expect(
    page.getByText("Purchase sync isn’t enabled yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue on this device" }).click();
  await expect(page.locator("#new-purchase")).toBeVisible();
});
test("account UI handles session changes and sign-out without uploading local receipts", async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") uploads.push(request.url());
  });
  await page.route("https://example.clerk.accounts.dev/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: route.request().url().includes("@clerk/ui")
        ? "window.__internal_ClerkUICtor = function(){};"
        : `
    let listener;
    window.Clerk = {
      user: null, session: null, load: async () => {},
      addListener(fn) { listener = fn; return () => {}; },
      unmountSignIn(node) { node.replaceChildren(); },
      unmountUserButton(node) { node.replaceChildren(); },
      mountSignIn(node) { const b = document.createElement('button'); b.textContent = 'Test sign in'; b.onclick = () => { this.user = { id: 'user_one', fullName: 'Alex Test' }; this.session = {}; listener(); }; node.replaceChildren(b); },
      mountUserButton(node) { const b = document.createElement('button'); b.textContent = 'Test sign out'; b.onclick = () => { this.user = null; this.session = null; listener(); }; node.replaceChildren(b); }
    };`,
    }),
  );
  await page.goto("/account");
  await page.getByRole("button", { name: "Test sign in" }).click();
  await expect(page.locator("#account-id")).toContainText("user_one");
  await expect(page.locator("#account-status")).toContainText(
    "Purchases remain on this device",
  );
  await page.getByRole("button", { name: "Test sign out" }).click();
  await expect(page.locator("#account-details")).toBeHidden();
  await expect(page.locator("#account-id")).toHaveText("");
  expect(uploads).toEqual([]);
});
test("blocked authentication scripts offer retry and do not trap mobile users", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://example.clerk.accounts.dev/**", (route) =>
    route.abort(),
  );
  await page.goto("/account");
  await expect(page.locator("#account-retry")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Continue on this device" }).click();
  await expect(page.locator("#new-purchase")).toBeVisible();
});
