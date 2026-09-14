import { test, expect } from "bun:test";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { authConfig, accountIdentity, securityHeaders } from "../../auth";
import worker, { readBody, type Env } from "../../worker";
const env = {
  CLERK_PUBLISHABLE_KEY: `pk_test_${btoa("example.clerk.accounts.dev$")}`,
};
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
const resolver = createLocalJWKSet({
  keys: [{ ...jwk, kid: "test", alg: "RS256" }],
});
async function token(overrides = {}, expiry: number | string = "1h") {
  return new SignJWT({
    sid: "sess_test",
    azp: "https://radar.example",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://example.clerk.accounts.dev")
    .setSubject("user_one")
    .setIssuedAt()
    .setNotBefore(0)
    .setExpirationTime(expiry)
    .sign(privateKey);
}
function request(jwt: string) {
  return new Request("https://radar.example/api/account", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}
test("account configuration rejects invalid domains and keeps secrets out of public config", () => {
  expect(authConfig({})).toBeNull();
  expect(
    authConfig({ CLERK_PUBLISHABLE_KEY: `pk_test_${btoa("evil.test/path$")}` }),
  ).toBeNull();
  expect(authConfig(env)?.issuer).toBe("https://example.clerk.accounts.dev");
  expect(securityHeaders({})["Content-Security-Policy"]).not.toContain(
    "unsafe-inline",
  );
});
test("verified account identity rejects forged, expired, wrong-origin and pending sessions", async () => {
  expect(await accountIdentity(request(await token()), env, resolver)).toEqual({
    id: "user_one",
  });
  expect(
    await accountIdentity(
      request(await token({ azp: "https://attacker.example" })),
      env,
      resolver,
    ),
  ).toBeNull();
  expect(
    await accountIdentity(
      request(await token({ sts: "pending" })),
      env,
      resolver,
    ),
  ).toBeNull();
  expect(
    await accountIdentity(request(await token({}, 1)), env, resolver),
  ).toBeNull();
  expect(
    await accountIdentity(
      request((await token()).replace(/.$/, "!")),
      env,
      resolver,
    ),
  ).toBeNull();
  expect(await accountIdentity(request("invalid"), env, resolver)).toBeNull();
});
test("worker never returns secrets and rejects unauthenticated AI before calling provider", async () => {
  const runtime: Env = {
    ...env,
    NVIDIA_API_KEY: "private-test-value",
    ASSETS: { fetch: async () => new Response("asset") },
  };
  const config = await worker.fetch(
    new Request("https://radar.example/api/auth/config"),
    runtime,
  );
  expect(await config.text()).not.toContain("private-test-value");
  const account = await worker.fetch(
    new Request("https://radar.example/api/account"),
    runtime,
  );
  expect(account.status).toBe(401);
  const ai = await worker.fetch(
    new Request("https://radar.example/api/ai/extract", {
      method: "POST",
      headers: {
        Origin: "https://radar.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    runtime,
  );
  expect(ai.status).toBe(401);
  const crossOrigin = await worker.fetch(
    new Request("https://radar.example/api/ai/extract", { method: "POST" }),
    runtime,
  );
  expect(crossOrigin.status).toBe(403);
});
test("worker bounds streamed request bodies even without Content-Length", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(32));
      controller.close();
    },
  });
  const input = new Request("https://radar.example", {
    method: "POST",
    body: stream,
  });
  await expect(readBody(input, 16)).rejects.toThrow("too-large");
  expect(
    await readBody(
      new Request("https://radar.example", {
        method: "POST",
        body: '{"text":"receipt"}',
      }),
    ),
  ).toEqual({ text: "receipt" });
});
