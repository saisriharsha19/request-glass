import { scrypt, timingSafeEqual } from "node:crypto";
import type { AccountDatabase } from "./database";
export interface AuthEnv {
  DB?: AccountDatabase;
  AI_REQUIRES_LOGIN?: boolean;
}
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
// OWASP scrypt parameter set: 16 MiB, N=2^14, r=8, p=5. Native async crypto.
export async function passwordHash(
  password: string,
  salt: string,
): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key.toString("hex"))),
    ),
  );
}
export function equalHash(a: string, b: string) {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export const isLocal = (request: Request) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
export const cookieName = (request: Request) =>
  isLocal(request) ? "rr_session" : "__Host-rr_session";
export function sessionCookie(
  request: Request,
  value: string,
  maxAge = 30 * 86400,
) {
  return `${cookieName(request)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isLocal(request) ? "" : "; Secure"}`;
}
export function sessionToken(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName(request)}=`))
      ?.split("=")[1] || ""
  );
}
export async function accountIdentity(
  request: Request,
  env: AuthEnv,
): Promise<{ id: string; username: string; name: string } | null> {
  const token = sessionToken(request);
  if (!env.DB || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT a.id, a.username, a.name FROM accounts a JOIN sessions s ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await digest(token), Date.now())
    .first();
}
export function securityHeaders(_env?: unknown) {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
