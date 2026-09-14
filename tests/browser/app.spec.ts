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
  await page.locator("#receipt-file").setInputFiles({
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
  await expect(page.locator("#receipt-preview img")).toHaveCount(0);
  await expect(page.locator("#receipt-text")).toHaveValue(
    /Wireless Headphones/,
  );
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
  await page.locator("#import").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"purchases":[{"id":"bad"}]}'),
  });
  await expect(page.locator("#toast")).toContainText("Could not restore");
  await expect(page.locator("#purchase-count")).toHaveText("1");
});

test("large purchase collections are paged, OCR is lazy, and animations settle", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("return-radar", 2);
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction("purchases", "readwrite");
        for (let i = 0; i < 500; i++)
          tx.objectStore("purchases").put({
            id: String(i),
            item: "Purchase " + String(i).padStart(3, "0"),
            merchant: "Store",
            purchased: "2026-01-01",
            amount: 20,
            currency: "USD",
            return: "2099-01-12",
            cancel: "",
            warranty: "",
            price: "",
            notes: "",
            text: "Receipt",
            image: null,
            hasImage: false,
            archived: false,
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator("#purchase-count")).toHaveText("500");
  await expect(page.locator(".purchase-card")).toHaveCount(30);
  await page.locator("#load-more").click();
  await expect(page.locator(".purchase-card")).toHaveCount(60);
  await page.locator("#search").fill("Purchase 499");
  await expect(page.locator(".purchase-card")).toHaveCount(1);
  expect(requested.some((url) => url.includes("/ocr/"))).toBe(false);
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    ),
  );
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    ),
  ).toBe(0);
  await page.locator("#new-purchase").click();
  expect(
    await page
      .locator("#purchase-dialog")
      .evaluate((e) => getComputedStyle(e, "::backdrop").backdropFilter),
  ).toBe("none");
});

test("existing image receipts migrate without loss and only load when opened", async ({
  page,
}) => {
  await page.goto("/healthz");
  const data =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await page.evaluate(async (image) => {
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("return-radar", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("purchases", { keyPath: "id" });
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction("purchases", "readwrite");
        t.objectStore("purchases").put({
          id: "old",
          item: "Original purchase",
          merchant: "Store",
          amount: 42,
          currency: "USD",
          purchased: "",
          return: "",
          cancel: "",
          warranty: "",
          price: "",
          notes: "Keep me",
          text: "Original receipt",
          image,
          archived: false,
        });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }, data);
  await page.goto("/");
  await expect(page.locator("#receipt-count")).toHaveText("1");
  const saved = await page.evaluate(
    async () =>
      await new Promise<any>((resolve) => {
        const r = indexedDB.open("return-radar", 2);
        r.onsuccess = () => {
          const db = r.result;
          const t = db.transaction(["purchases", "receipts"], "readonly");
          const p = t.objectStore("purchases").get("old"),
            i = t.objectStore("receipts").get("old");
          t.oncomplete = () => {
            resolve({ metadata: p.result, image: i.result.image });
            db.close();
          };
        };
      }),
  );
  expect(saved.metadata.image).toBeNull();
  expect(saved.metadata.hasImage).toBe(true);
  expect(saved.image).toBe(data);
  await page.getByRole("button", { name: "View / edit" }).click();
  await expect(page.locator("#receipt-preview img")).toHaveAttribute(
    "src",
    data,
  );
});

test("AI is explicit, fills only empty fields, and preserves entries on failure", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/ai/extract", async (route) => {
    calls++;
    await route.fulfill({
      json: {
        fields: {
          item: { value: "AI headphones", evidence: "AI headphones" },
          merchant: { value: "Audio Store", evidence: "Audio Store" },
        },
      },
    });
  });
  await page.goto("/");
  await page.locator("#new-purchase").click();
  await page.locator("#item").fill("My own title");
  await page.locator("#receipt-text").fill("Audio Store\nAI headphones");
  expect(calls).toBe(0);
  await page.locator("#ai-fill").click();
  await expect(page.locator("#merchant")).toHaveValue("Audio Store");
  await expect(page.locator("#item")).toHaveValue("My own title");
  await expect(page.locator("#ai-status")).toContainText(
    "1 suggestions ready for review",
  );
  expect(calls).toBe(1);
  await page.unroute("**/api/ai/extract");
  await page.route("**/api/ai/extract", (route) =>
    route.fulfill({ status: 503, json: { error: "AI is not configured" } }),
  );
  await page.locator("#ai-fill").click();
  await expect(page.locator("#ai-status")).toHaveText("AI is not configured");
  await expect(page.locator("#item")).toHaveValue("My own title");
  await expect(page.locator("#save")).toBeEnabled();
});

test("PDF receipts extract locally without saving the PDF", async ({
  page,
  context,
}) => {
  const source = await context.newPage();
  await source.setContent(
    '<html><body style="font:20px Arial"><p>Store: Paper Trail</p><p>Item: Travel Headphones</p><p>Total paid: USD 79.00</p><p>Return by: October 12, 2099</p></body></html>',
  );
  const pdf = await source.pdf();
  await source.close();
  const outside: string[] = [];
  page.on("request", (r) => {
    if (
      r.url().startsWith("http") &&
      !r.url().startsWith("http://127.0.0.1:3210")
    )
      outside.push(r.url());
  });
  await page.goto("/");
  await page.locator("#new-purchase").click();
  await page.locator("#receipt-file").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.locator("#ocr-status")).toContainText(
    "PDF file is not stored",
    { timeout: 30000 },
  );
  await expect(page.locator("#item")).toHaveValue("Travel Headphones");
  await expect(page.locator("#return")).toHaveValue("2099-10-12");
  await page.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.locator("#receipt-count")).toHaveText("1");
  const stored = await page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("return-radar", 2);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction(["purchases", "receipts"], "readonly"),
            p = t.objectStore("purchases").getAll(),
            i = t.objectStore("receipts").getAll();
          t.oncomplete = () => {
            resolve({ p: p.result, i: i.result });
            db.close();
          };
        };
      }),
  );
  expect(stored.i).toHaveLength(0);
  expect(stored.p[0].image).toBeNull();
  expect(stored.p[0].text).toContain("Travel Headphones");
  expect(JSON.stringify(stored)).not.toContain("%PDF");
  expect(outside).toEqual([]);
});

test("scanned PDFs fall back to OCR and corrupt PDFs leave the form usable", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const source = await context.newPage();
  await source.setContent('<canvas width="1000" height="400"></canvas>');
  await source.evaluate(() => {
    const c = document.querySelector("canvas")!,
      x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, 1000, 400);
    x.fillStyle = "black";
    x.font = "30px Arial";
    [
      "Store: Paper Trail",
      "Item: Desk Lamp",
      "Total paid: USD 49.00",
      "Return by: 2099-10-12",
    ].forEach((s, i) => x.fillText(s, 30, 60 + i * 70));
    const img = document.createElement("img");
    img.src = c.toDataURL();
    img.style.width = "600px";
    c.replaceWith(img);
  });
  const pdf = await source.pdf();
  await source.close();
  await page.goto("/");
  await page.locator("#new-purchase").click();
  await page.locator("#receipt-file").setInputFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.locator("#ocr-status")).toContainText("(1 scanned)", {
    timeout: 45000,
  });
  await expect(page.locator("#item")).toHaveValue("Desk Lamp");
  await page.locator("#receipt-file").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.locator("#save")).toBeEnabled();
  await expect(page.locator("#item")).toHaveValue("Desk Lamp");
});

test("multimodal sends prepared pages once and clears temporary images after AI", async ({
  page,
  context,
}) => {
  const source = await context.newPage();
  await source.setContent("<p>Store: Paper Trail</p><p>Item: Paper Lamp</p>");
  const pdf = await source.pdf();
  await source.close();
  let calls = 0,
    images = 0;
  await page.route("**/api/ai/extract", async (route) => {
    calls++;
    images = route.request().postDataJSON().images.length;
    await route.fulfill({
      json: {
        fields: {
          item: {
            value: "Corrected Lamp",
            evidence: "Corrected Lamp",
            source: "image",
            page: 1,
          },
        },
      },
    });
  });
  await page.goto("/");
  await page.locator("#new-purchase").click();
  await page
    .locator("#receipt-file")
    .setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
  await expect(page.locator("#ocr-status")).toContainText(
    "PDF file is not stored",
  );
  await page.locator("#ai-fill").click();
  await expect(page.locator("#item")).toHaveValue("Corrected Lamp");
  expect(calls).toBe(1);
  expect(images).toBe(1);
  await page.locator("#ai-fill").click();
  await expect.poll(() => calls).toBe(2);
  expect(images).toBe(0);
});
