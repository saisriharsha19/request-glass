import { expect, test } from "bun:test";
import { extractWithNim, validateDraft } from "../../ai";
test("NIM suggestions require evidence and reject fabricated or relative dates", () => {
  const text =
    "Item: Headphones\nTotal paid: USD 129.00\nReturn by: October 12, 2026\nWarranty: 30 days from 2026-09-14";
  const result = validateDraft(
    {
      item: { value: "Headphones", evidence: "Item: Headphones" },
      return: { value: "2026-10-12", evidence: "Return by: October 12, 2026" },
      warranty: {
        value: "2026-09-14",
        evidence: "Warranty: 30 days from 2026-09-14",
      },
      merchant: { value: "Invented", evidence: "Item: Headphones" },
      cancel: { value: "2026-10-12", evidence: "Cancel by: October 12, 2026" },
      currency: { value: "INR", evidence: "Total paid: USD 129.00" },
    },
    text,
  );
  expect(Object.keys(result).sort()).toEqual(["item", "return"]);
});
test("server sends a bounded non-streaming request and filters returned data", async () => {
  let request: any;
  const mock = async (url: any, init: any) => {
    request = { url, init };
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              item: { value: "Headphones", evidence: "Item: Headphones" },
            }),
          },
        },
      ],
    });
  };
  const result = await extractWithNim(
    "Item: Headphones",
    "test-key",
    "test-model",
    mock,
  );
  expect(request.url).toBe(
    "https://integrate.api.nvidia.com/v1/chat/completions",
  );
  expect(request.init.headers.Authorization).toBe("Bearer test-key");
  expect(JSON.parse(request.init.body).max_tokens).toBe(1200);
  expect(result.item?.value).toBe("Headphones");
});
test("provider error does not include provider response or credential", async () => {
  const mock = async () => new Response("test-key", { status: 401 });
  await expect(
    extractWithNim("Receipt", "test-key", "test-model", mock),
  ).rejects.toThrow("Provider unavailable");
});

test("vision suggestions need a valid supplied page, not a fabricated text quote", () => {
  const d = validateDraft(
    {
      item: { value: "Lamp", evidence: "Desk Lamp", source: "image", page: 1 },
      merchant: { value: "Store", evidence: "Store", source: "image", page: 2 },
      return: {
        value: "2026-10-12",
        evidence: "Return by 12 October 2026",
        source: "image",
        page: 1,
      },
    },
    "OCR failed",
    1,
  );
  expect(d.item?.source).toBe("image");
  expect(d.merchant).toBeUndefined();
  expect(d.return?.value).toBe("2026-10-12");
});

test("one date quote cannot establish both a purchase and a return date", () => {
  const field = {
    value: "2026-10-12",
    evidence: "Return by October 12, 2026",
    source: "text",
  };
  const d = validateDraft({ purchased: field, return: field }, field.evidence);
  expect(d.purchased).toBeUndefined();
  expect(d.return).toBeUndefined();
});
test("vision is sent once and only readings go to structured extraction", async () => {
  const bodies: any[] = [];
  const mock = async (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string);
    bodies.push(b);
    return Response.json({
      choices: [
        {
          message: {
            content:
              bodies.length === 1
                ? "Merchant: Store\nItem: Lamp"
                : '{"item":{"value":"Lamp","evidence":"Item: Lamp","source":"text"}}',
          },
          finish_reason: "stop",
        },
      ],
    });
  };
  const d = await extractWithNim(
    "Unclear local OCR",
    "test-key",
    "text-model",
    mock,
    ["data:image/jpeg;base64,/9j/abc="],
  );
  expect(bodies).toHaveLength(2);
  expect(
    bodies[0].messages[0].content.filter((p: any) => p.type === "image_url"),
  ).toHaveLength(1);
  expect(JSON.stringify(bodies[1])).not.toContain("base64");
  expect(d.item?.source).toBe("image");
});
