import { test, expect } from "bun:test";
import { localDatabase } from "../../local-db";
import { accountApi, readBody } from "../../account-api";
import { accountIdentity, securityHeaders } from "../../auth";
const schema = await Bun.file(
  new URL("../../migrations/0001_accounts.sql", import.meta.url),
).text();
const password = "a-long-test-password-123";
function setup() {
  const env = { DB: localDatabase(":memory:", schema) };
  async function call(
    path: string,
    data?: unknown,
    cookie = "",
    method = data === undefined ? "GET" : "POST",
    headers = {},
  ) {
    return (await accountApi(
      new Request(`https://radar.example${path}`, {
        method,
        headers: {
          Origin: "https://radar.example",
          "Content-Type": "application/json",
          Cookie: cookie,
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      env,
    ))!;
  }
  async function register(username: string) {
    const response = await call("/api/auth/register", {
      username,
      name: username,
      password,
    });
    expect(response.status).toBe(200);
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      ...(await response.json()),
    };
  }
  return { env, call, register };
}
function purchase(id = "receipt-1") {
  return {
    id,
    item: "Headphones",
    merchant: "Test Store",
    amount: 25,
    currency: "USD",
    purchased: "2026-09-14",
    return: "",
    cancel: "",
    warranty: "",
    price: "",
    text: "Receipt text",
    notes: "",
    archived: false,
    image: null,
  };
}
test("native registration stores password hashes and uses revocable HttpOnly sessions", async () => {
  const { env, call, register } = setup();
  const one = await register("alex");
  expect(one.recoveryCode).toHaveLength(64);
  const row: any = await env.DB.prepare("SELECT * FROM accounts").first();
  expect(row.password_hash).not.toBe(password);
  expect(row.password_hash).toHaveLength(64);
  expect(row.recovery_hash).not.toBe(one.recoveryCode);
  const login = await call("/api/auth/login", { username: "alex", password });
  expect(login.status).toBe(200);
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect(
    (await (await call("/api/auth/session", undefined, one.cookie)).json()).user
      .username,
  ).toBe("alex");
  expect(
    (
      await call("/api/auth/login", {
        username: "alex",
        password: "incorrect-password",
      })
    ).status,
  ).toBe(401);
  await call("/api/auth/logout", {}, one.cookie);
  expect(
    (await (await call("/api/auth/session", undefined, one.cookie)).json())
      .user,
  ).toBeNull();
  expect(
    await accountIdentity(
      new Request("https://radar.example", {
        headers: { Cookie: "__Host-rr_session=forged" },
      }),
      env,
    ),
  ).toBeNull();
  expect(securityHeaders()["Content-Security-Policy"]).not.toContain("clerk");
});
test("recovery rotates its key, revokes previous sessions, and invalidates the old password", async () => {
  const { call, register } = setup();
  const one = await register("alex");
  const reset = await call("/api/auth/recover", {
    username: "alex",
    password: "new-long-password-456",
    recoveryCode: one.recoveryCode,
  });
  expect(reset.status).toBe(200);
  expect((await reset.json()).recoveryCode).not.toBe(one.recoveryCode);
  expect(
    (await (await call("/api/auth/session", undefined, one.cookie)).json())
      .user,
  ).toBeNull();
  expect(
    (await call("/api/auth/login", { username: "alex", password })).status,
  ).toBe(401);
  expect(
    (
      await call("/api/auth/recover", {
        username: "alex",
        password,
        recoveryCode: one.recoveryCode,
      })
    ).status,
  ).toBe(401);
});
test("purchase sync isolates accounts, rejects stale writes, propagates deletion and forbids files", async () => {
  const { call, register } = setup();
  const a = await register("alice"),
    b = await register("bob");
  const create = await call(
    "/api/purchases/receipt-1",
    { purchase: purchase(), baseVersion: 0 },
    a.cookie,
    "PUT",
  );
  expect(create.status).toBe(200);
  const list = await (await call("/api/purchases", undefined, a.cookie)).json();
  expect(list.purchases).toHaveLength(1);
  expect(list.purchases[0]._version).toBe(1);
  expect(
    (await (await call("/api/purchases", undefined, b.cookie)).json())
      .purchases,
  ).toEqual([]);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { purchase: purchase(), baseVersion: 1 },
        b.cookie,
        "PUT",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { purchase: { ...purchase(), item: "New name" }, baseVersion: 1 },
        a.cookie,
        "PUT",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { purchase: { ...purchase(), item: "Stale edit" }, baseVersion: 1 },
        a.cookie,
        "PUT",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { baseVersion: 1 },
        a.cookie,
        "DELETE",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { baseVersion: 2 },
        a.cookie,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(
    (await (await call("/api/purchases", undefined, a.cookie)).json())
      .purchases,
  ).toEqual([]);
  expect(
    (
      await call(
        "/api/purchases/receipt-1",
        { purchase: purchase(), baseVersion: 0 },
        a.cookie,
        "PUT",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        "/api/purchases/photo",
        {
          purchase: {
            ...purchase("photo"),
            image: "data:image/png;base64,aA==",
          },
          baseVersion: 0,
        },
        a.cookie,
        "PUT",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/api/purchases", undefined, a.cookie, "GET", {
        "X-Account-ID": b.user.id,
      })
    ).status,
  ).toBe(409);
});
test("cross-origin writes and oversized streams are rejected", async () => {
  const { env } = setup();
  const response = await accountApi(
    new Request("https://radar.example/api/auth/register", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: "{}",
    }),
    env,
  );
  expect(response!.status).toBe(403);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(32));
      c.close();
    },
  });
  await expect(
    readBody(
      new Request("https://radar.example", { method: "POST", body: stream }),
      16,
    ),
  ).rejects.toThrow("too-large");
});
test("deleting an account removes its sessions and purchases but not other accounts", async () => {
  const { env, call, register } = setup();
  const a = await register("alice"),
    b = await register("bob");
  await call(
    "/api/purchases/receipt-1",
    { purchase: purchase(), baseVersion: 0 },
    a.cookie,
    "PUT",
  );
  expect((await call("/api/auth/delete", { password }, a.cookie)).status).toBe(
    200,
  );
  expect(
    (await env.DB.prepare("SELECT count(*) AS n FROM purchases").first<any>())
      .n,
  ).toBe(0);
  expect(
    (await (await call("/api/auth/session", undefined, b.cookie)).json()).user
      .username,
  ).toBe("bob");
});

test("organization and reminder metadata round trips through versioned account sync", async () => {
  const { call, register } = setup();
  const user = await register("organized");
  const p = {
    ...purchase(),
    category: "Documents",
    tags: ["family", "travel"],
    favorite: true,
    reminder: "2099-01-31",
    reminderLabel: "Renew passport",
    leadDays: 7,
    completed: { reminder: "2099-01-31" },
  };
  const saved = await call(
    "/api/purchases/receipt-1",
    { purchase: p, baseVersion: 0 },
    user.cookie,
    "PUT",
  );
  expect(saved.status).toBe(200);
  const records = await (
    await call("/api/purchases", undefined, user.cookie)
  ).json();
  expect(records.purchases[0]).toMatchObject(p);
  const invalid = await call(
    "/api/purchases/receipt-1",
    { purchase: { ...p, leadDays: 999 }, baseVersion: 1 },
    user.cookie,
    "PUT",
  );
  expect(invalid.status).toBe(400);
});
