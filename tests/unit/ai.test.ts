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
  expect(JSON.parse(request.init.body).max_tokens).toBe(4000);
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
  expect(d.return?.value).toBe("2026-10-12");
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

test('AI document reminders require dated evidence and preserve explicit purpose', () => {
  const text = 'Payment due: October 12, 2026. Pay within 30 days.';
  expect(validateDraft({ reminder: {value: '2026-10-12', evidence: 'Payment due: October 12, 2026'}, reminderLabel: {value: 'Payment due', evidence: 'Payment due: October 12, 2026'} }, text)).toMatchObject({reminder: {value: '2026-10-12'}, reminderLabel: {value: 'Payment due'}});
  expect(validateDraft({ reminder: {value: '2026-11-11', evidence: 'Pay within 30 days.'} }, text)).toEqual({});
});

test('explicit appointment dates survive nearby duration text and preserve exact event notes',()=>{
 const receipt='Appointment: October 12, 2026 (in 30 days).\n10:30 UTC at Studio https://example.com/meeting';
 const d=validateDraft({reminder:{value:'2026-10-12',evidence:'Appointment: October 12, 2026 (in 30 days).'},notes:{value:'10:30 UTC at Studio https://example.com/meeting',evidence:'10:30 UTC at Studio https://example.com/meeting'}},receipt);
 expect(d.reminder?.value).toBe('2026-10-12');expect(d.notes?.value).toContain('https://example.com/meeting');
 expect(validateDraft({notes:{value:'Invented location',evidence:'10:30 UTC at Studio'}},receipt).notes).toBeUndefined();
});

test('exact descriptive strings from NIM are accepted without fabricating date or amount evidence',()=>{
 const receipt='Appointment date: October 12, 2026\nStudio\nTime: 10:30 UTC';
 const d=validateDraft({reminderLabel:'Appointment date',notes:'Time: 10:30 UTC',merchant:'Invented',purchased:{value:'2026-10-12',evidence:'Appointment date: October 12, 2026'},amount:{value:'0.00',evidence:'Time: 10:30 UTC'}},receipt);
 expect(d.reminderLabel?.value).toBe('Appointment date');expect(d.notes?.value).toBe('Time: 10:30 UTC');expect(d.merchant).toBeUndefined();expect(d.purchased).toBeUndefined();expect(d.amount).toBeUndefined();
});

test('a failed image reader falls back to text in the same request and fills date, label and category',async()=>{
 let calls=0;const notices:string[]=[];
 const fields=await extractWithNim('Electricity bill. Payment due: October 12, 2026.','key','model',async(_url,init)=>{calls++;const body=JSON.parse(init.body as string);if(body.messages[0].role==='user')return new Response('unavailable',{status:503});return Response.json({choices:[{message:{content:JSON.stringify({category:{value:'Bills',evidence:'Electricity bill.'},reminder:{value:'2026-10-12',evidence:'Payment due: October 12, 2026.'},reminderLabel:{value:'Payment due',evidence:'Payment due: October 12, 2026.'}})},finish_reason:'stop'}]});},['data:image/jpeg;base64,/9j/AAAA'],'vision',notices);
 expect(calls).toBe(2);expect(fields.category.value).toBe('Bills');expect(fields.reminder.value).toBe('2026-10-12');expect(fields.reminderLabel.value).toBe('Payment due');expect(notices).toHaveLength(1);
});
test('one structured repair recovers rejected date shape without another image upload',async()=>{
 let calls=0;
 const fields=await extractWithNim('Return by October 12, 2026.','key','model',async()=>Response.json({choices:[{message:{content:JSON.stringify(++calls===1?{return:'2026-10-12'}:{return:{value:'2026-10-12',evidence:'Return by October 12, 2026.'}})},finish_reason:'stop'}]}));
 expect(calls).toBe(2);expect(fields.return.value).toBe('2026-10-12');
});

test('inconclusive combined reading is repaired against local text without uploading images again',async()=>{
 const bodies:any[]=[];const notices:string[]=[];const text='Service renewal: October 3, 2026. This is the confirmed renewal notice.';
 const fields=await extractWithNim(text,'key','model',async(_url,init)=>{const body=JSON.parse(init.body as string);bodies.push(body);return Response.json({choices:[{message:{content:bodies.length===1?'Unclear visual reading':bodies.length===2?JSON.stringify({reminderDate:{value:'wrong date',evidence:'Unclear visual reading'}}):JSON.stringify({reminderDate:{value:'2026-10-03',evidence:'Service renewal: October 3, 2026.'},reminderName:{value:'Service renewal',evidence:'Service renewal: October 3, 2026.'}})},finish_reason:'stop'}]});},['data:image/jpeg;base64,/9j/AAAA'],'vision',notices);
 expect(bodies).toHaveLength(3);expect(bodies[2].messages[1].content).toBe(text);expect(JSON.stringify(bodies[2])).not.toContain('data:image');expect(fields.reminder.value).toBe('2026-10-03');expect(fields.reminder.source).toBe('text');expect(notices).toHaveLength(1);
});
