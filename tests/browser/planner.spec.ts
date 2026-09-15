import { test, expect } from "@playwright/test";
test("templates, tags, favorites, copies, spending and custom reminders work together on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.locator("#template-select").selectOption("subscription");
  await expect(page.locator("#item")).toHaveValue("Subscription renewal");
  await page.locator("#reminder").fill("2099-01-31");
  await page.locator("#amount").fill("12");
  await page.locator("#tags").fill("household, streaming");
  await page.locator("#favorite").check();
  await page.locator("#leadDays").selectOption("7");
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toContainText("household");
  await page.locator("#search").fill("streaming");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.locator("#search").fill("");
  await page.locator("#favorites-only").check();
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  await page.locator("#favorites-only").uncheck();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator("#item")).toHaveValue(
    "Subscription renewal (copy)",
  );
  await page.locator("#save").click();
  await expect(page.locator(".purchase-card")).toHaveCount(2);
  await page.locator('[data-workspace="insights"]').click();
  await expect(page.locator("#spending-summary")).toContainText("$24.00");
  const csvDownload = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  expect((await csvDownload).suggestedFilename()).toBe("returnradar-items.csv");
  await page.locator('[data-workspace="planner"]').click();
  await expect(page.locator(".agenda-event")).toHaveCount(2);
  const first = page.locator(".agenda-event").first();
  await expect(
    first.getByRole("link", { name: "Google Calendar" }),
  ).toHaveAttribute("href", /dates=20990131%2F20990201/);
  await first.getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator(".agenda-event")).toHaveCount(1);
  await page.locator("#agenda-filter").selectOption("completed");
  await expect(page.locator(".agenda-event")).toHaveCount(1);
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.locator(".agenda-event")).toHaveCount(0);
  await page.locator("#agenda-filter").selectOption("upcoming");
  await page
    .locator(".agenda-event")
    .first()
    .getByRole("button", { name: "Snooze 7 days" })
    .click();
  await expect(page.locator("#agenda-list")).toContainText("Feb 7");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
test("calendar import is explicitly reviewed and does not repeat confirmed items", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-workspace="planner"]').click();
  await page
    .locator("#calendar-import")
    .setInputFiles({
      name: "dates.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20990131\r\nSUMMARY:Passport renewal\r\nEND:VEVENT\r\nEND:VCALENDAR",
      ),
    });
  await expect(page.locator("#calendar-import-preview")).toContainText(
    "Passport renewal",
  );
  await expect(page.locator("#purchase-count")).toHaveText("0");
  await page.locator("#confirm-calendar-import").click();
  await expect(page.locator("#purchase-count")).toHaveText("1");
  await expect(page.locator(".agenda-event")).toContainText("Passport renewal");
  await page.reload();
  await page.locator('[data-workspace="planner"]').click();
  await expect(page.locator(".agenda-event")).toContainText("Passport renewal");
});
