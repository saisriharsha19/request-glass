import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export type AuthEnv = { CLERK_PUBLISHABLE_KEY?: string };
export function authConfig(env: AuthEnv) {
  const key = env.CLERK_PUBLISHABLE_KEY || "";
  if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(key)) return null;
  try {
    const decoded = atob(key.split("_")[2]);
    if (!decoded.endsWith("$")) return null;
    const domain = decoded.slice(0, -1);
    if (
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
      !domain.includes(".")
    )
      return null;
    return { publishableKey: key, domain, issuer: `https://${domain}` };
  } catch {
    return null;
  }
}
const keysets = new Map<string, JWTVerifyGetKey>();
export async function accountIdentity(
  request: Request,
  env: AuthEnv,
  resolver?: JWTVerifyGetKey,
) {
  const config = authConfig(env);
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([^ ]+)$/)?.[1];
  if (!config || !token || token.length > 12000) return null;
  try {
    let keys = resolver || keysets.get(config.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${config.issuer}/.well-known/jwks.json`),
        { timeoutDuration: 5000 },
      );
      keysets.set(config.issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nbf", "sid", "azp"],
    });
    if (
      payload.azp !== new URL(request.url).origin ||
      typeof payload.sub !== "string" ||
      !payload.sub.startsWith("user_") ||
      typeof payload.sid !== "string" ||
      payload.sts === "pending"
    )
      return null;
    return { id: payload.sub };
  } catch {
    return null;
  }
}
export function securityHeaders(env: AuthEnv) {
  const config = authConfig(env);
  const host = config?.issuer || "";
  const authScripts = config
    ? ` ${host} https://challenges.cloudflare.com https://*.protect.clerk.com`
    : "";
  return {
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${authScripts}; style-src 'self'${config ? " 'unsafe-inline'" : ""}; img-src 'self' data: blob:${config ? " https://img.clerk.com" : ""}; connect-src 'self'${config ? ` ${host} https://*.protect.clerk.com` : ""}; frame-src 'self'${config ? " https://challenges.cloudflare.com https://*.protect.clerk.com" : ""}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
