import {
  accountIdentity,
  digest,
  equalHash,
  passwordHash,
  randomToken,
  sessionCookie,
  sessionToken,
  type AuthEnv,
} from "./auth";
import { isPurchase, kinds } from "./public/logic.js";
export const apiJson = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
export async function readBody(request: Request, maxBytes = 1500000) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SyntaxError("Expected an object");
  return value;
}
export async function accountApi(
  request: Request,
  env: AuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    !(
      path.startsWith("/api/auth/") ||
      path === "/api/account" ||
      path.startsWith("/api/purchases")
    )
  )
    return null;
  if (path === "/api/auth/config" && request.method === "GET")
    return apiJson({
      configured: !!env.DB,
      primaryOrigin: env.DB
        ? null
        : "https://return-radar.return-radar.workers.dev",
      auth: null,
      sync: env.DB ? "database" : "local-only",
      aiRequiresLogin: env.AI_REQUIRES_LOGIN !== false,
    });
  if (!env.DB)
    return apiJson(
      {
        error:
          "Accounts are available at return-radar.return-radar.workers.dev. Your local purchases are still here.",
      },
      503,
    );
  const db = env.DB;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== url.origin
  )
    return apiJson({ error: "Open ReturnRadar to make this change." }, 403);
  if (
    !["GET", "HEAD"].includes(request.method) &&
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return apiJson({ error: "Use a JSON request." }, 415);
  try {
    if (path === "/api/auth/session" && request.method === "GET")
      return apiJson({
        user: await accountIdentity(request, env),
        configured: true,
      });
    if (
      ["/api/auth/register", "/api/auth/login", "/api/auth/recover"].includes(
        path,
      ) &&
      request.method === "POST"
    ) {
      const body = await readBody(request, 4096);
      const username =
        typeof body.username === "string"
          ? body.username.trim().toLowerCase()
          : "";
      if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
        return apiJson(
          {
            error:
              "Use a username of 3–40 letters, numbers, dots, underscores or dashes.",
          },
          400,
        );
      if (
        typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128
      )
        return apiJson({ error: "Use a password of 12–128 characters." }, 400);
      const bucket = Math.floor(Date.now() / 900000),
        ip = request.headers.get("cf-connecting-ip") || "local";
      const attempts = await db.batch(
        await Promise.all(
          [`ip:${ip}`, `user:${username}`].map(async (key) =>
            db
              .prepare(
                "INSERT INTO auth_attempts(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
              )
              .bind(`${await digest(key)}:${bucket}`, (bucket + 2) * 900000),
          ),
        ),
      );
      if (
        attempts[0].results[0].count > 60 ||
        attempts[1].results[0].count > 15
      )
        return apiJson(
          { error: "Too many attempts. Wait 15 minutes before trying again." },
          429,
        );
      const account: any = await db
        .prepare("SELECT * FROM accounts WHERE username=?")
        .bind(username)
        .first();
      const now = Date.now();
      let credentialHash = account?.password_hash;
      let userId = account?.id;
      let recoveryCode: string | undefined;
      if (path.endsWith("register")) {
        if (account)
          return apiJson(
            {
              error:
                "That username is already taken. Sign in or choose another.",
            },
            409,
          );
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 60)
          return apiJson(
            { error: "Enter your name (up to 60 characters)." },
            400,
          );
        userId = crypto.randomUUID();
        const salt = randomToken();
        recoveryCode = randomToken();
        const hash = await passwordHash(body.password, salt);
        credentialHash = hash;
        const result = await db
          .prepare(
            "INSERT OR IGNORE INTO accounts(id,username,name,password_hash,salt,recovery_hash,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            userId,
            username,
            name,
            hash,
            salt,
            await digest(recoveryCode),
            now,
          )
          .run();
        if (!result.meta.changes)
          return apiJson({ error: "That username is already taken." }, 409);
      } else if (path.endsWith("recover")) {
        const recovery =
          typeof body.recoveryCode === "string" ? body.recoveryCode.trim() : "";
        if (
          !account ||
          !/^[a-f0-9]{64}$/.test(recovery) ||
          !equalHash(await digest(recovery), account.recovery_hash)
        )
          return apiJson(
            { error: "Username or recovery key is incorrect." },
            401,
          );
        const salt = randomToken();
        recoveryCode = randomToken();
        const hash = await passwordHash(body.password, salt);
        credentialHash = hash;
        const newRecoveryHash = await digest(recoveryCode);
        const changed = await db.batch([
          db
            .prepare(
              "UPDATE accounts SET password_hash=?,salt=?,recovery_hash=? WHERE id=? AND recovery_hash=?",
            )
            .bind(hash, salt, newRecoveryHash, userId, account.recovery_hash),
          db
            .prepare(
              "DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM accounts WHERE id=? AND recovery_hash=?)",
            )
            .bind(userId, userId, newRecoveryHash),
        ]);
        if (!changed[0].meta.changes)
          return apiJson({ error: "This recovery key was already used." }, 409);
      } else {
        const hash = await passwordHash(
          body.password,
          account?.salt || "0".repeat(64),
        );
        if (!account || !equalHash(hash, account.password_hash))
          return apiJson({ error: "Username or password is incorrect." }, 401);
      }
      const token = randomToken();
      const sessionResult = await db.batch([
        db.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now),
        db.prepare("DELETE FROM auth_attempts WHERE expires_at<?").bind(now),
        db
          .prepare(
            "INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM accounts WHERE id=? AND password_hash=?)",
          )
          .bind(
            await digest(token),
            userId,
            now + 30 * 86400000,
            userId,
            credentialHash,
          ),
      ]);
      if (!sessionResult[2].meta.changes)
        return apiJson(
          {
            error:
              "Your password changed during sign-in. Please sign in again.",
          },
          409,
        );
      const user = await db
        .prepare("SELECT id,username,name FROM accounts WHERE id=?")
        .bind(userId)
        .first();
      return apiJson({ user, ...(recoveryCode ? { recoveryCode } : {}) }, 200, {
        "Set-Cookie": sessionCookie(request, token),
      });
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      await db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await digest(sessionToken(request)))
        .run();
      return apiJson({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(request, "", 0),
      });
    }
    const user = await accountIdentity(request, env);
    if (!user)
      return apiJson(
        {
          error:
            "Your session has ended. Sign in again; your unsaved form is still here.",
        },
        401,
      );
    if (
      request.headers.get("x-account-id") &&
      request.headers.get("x-account-id") !== user.id
    )
      return apiJson(
        {
          error:
            "The signed-in account changed. Reload before saving anything.",
        },
        409,
      );
    if (path === "/api/account" && request.method === "GET")
      return apiJson({ user, sync: "database" });

    if (path === "/api/purchases" && request.method === "GET") {
      const after = url.searchParams.get("after") || "";
      const results = await db.batch([
        db.prepare("SELECT revision FROM accounts WHERE id=?").bind(user.id),
        db
          .prepare(
            "SELECT id,payload,version FROM purchases WHERE user_id=? AND deleted=0 AND id>? AND (SELECT revision FROM accounts WHERE id=?) != ? ORDER BY id LIMIT 50",
          )
          .bind(
            user.id,
            after,
            user.id,
            !after && /^"\d+"$/.test(request.headers.get("if-none-match") || "")
              ? Number(request.headers.get("if-none-match")!.slice(1, -1))
              : -1,
          ),
      ]);
      const revision = results[0].results[0].revision;
      if (!after && request.headers.get("if-none-match") === `"${revision}"`)
        return new Response(null, {
          status: 304,
          headers: { "Cache-Control": "no-store" },
        });
      const rows = results[1].results;
      return apiJson(
        {
          revision,
          purchases: rows.map((r: any) => ({
            ...JSON.parse(r.payload),
            _version: r.version,
          })),
          next: rows.length === 50 ? rows.at(-1).id : null,
        },
        200,
        { ETag: `"${revision}"` },
      );
    }
    if (path === "/api/auth/delete" && request.method === "POST") {
      const body = await readBody(request, 4096);
      const account: any = await db
        .prepare("SELECT password_hash,salt FROM accounts WHERE id=?")
        .bind(user.id)
        .first();
      if (
        typeof body.password !== "string" ||
        body.password.length > 128 ||
        !equalHash(
          await passwordHash(body.password, account.salt),
          account.password_hash,
        )
      )
        return apiJson(
          { error: "Check your password before deleting this account." },
          401,
        );
      const deleted = await db
        .prepare("DELETE FROM accounts WHERE id=? AND password_hash=?")
        .bind(user.id, account.password_hash)
        .run();
      if (!deleted.meta.changes)
        return apiJson(
          { error: "Your account changed. Sign in again before deleting." },
          409,
        );
      return apiJson({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(request, "", 0),
      });
    }
    const match = path.match(/^\/api\/purchases\/([a-zA-Z0-9._-]{1,100})$/);
    if (match && ["PUT", "DELETE"].includes(request.method)) {
      const body = await readBody(request, 200000),
        id = match[1];
      if (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0)
        return apiJson({ error: "Reload this purchase before saving." }, 400);
      if (request.method === "DELETE") {
        const result = await db
          .prepare(
            "UPDATE purchases SET deleted=1,payload='{}',version=version+1 WHERE user_id=? AND id=? AND version=? AND deleted=0",
          )
          .bind(user.id, id, body.baseVersion)
          .run();
        if (!result.meta.changes) {
          const existing: any = await db
            .prepare("SELECT deleted FROM purchases WHERE user_id=? AND id=?")
            .bind(user.id, id)
            .first();
          if (!existing?.deleted)
            return apiJson(
              {
                error:
                  "This purchase changed on another device. Reload before deleting.",
              },
              409,
            );
        }
        return apiJson({ ok: true });
      }
      const input = body.purchase;
      if (
        !input ||
        input.id !== id ||
        input.image != null ||
        input.hasImage === true
      )
        return apiJson(
          {
            error:
              "Only purchase details can be synced. Original files stay on your device.",
          },
          400,
        );
      const allowed = [
        "id",
        "item",
        "merchant",
        "notes",
        "text",
        "archived",
        "currency",
        "amount",
        "purchased",
        "category",
        "tags",
        "favorite",
        "reminderLabel",
        "leadDays",
        "completed",
        ...Object.keys(kinds),
      ];
      const purchase: any = Object.fromEntries(
        allowed.map((k) => [k, input[k]]),
      );
      purchase.image = null;
      purchase.hasImage = false;
      if (!isPurchase(purchase))
        return apiJson(
          { error: "Check the purchase details and dates before saving." },
          400,
        );
      const payload = JSON.stringify(purchase);
      const result =
        body.baseVersion === 0
          ? await db
              .prepare(
                "INSERT OR IGNORE INTO purchases(user_id,id,payload) SELECT ?,?,? WHERE (SELECT count(*) FROM purchases WHERE user_id=? AND deleted=0)<500",
              )
              .bind(user.id, id, payload, user.id)
              .run()
          : await db
              .prepare(
                "UPDATE purchases SET payload=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND deleted=0",
              )
              .bind(payload, user.id, id, body.baseVersion)
              .run();
      const saved: any = await db
        .prepare(
          "SELECT payload,version,deleted FROM purchases WHERE user_id=? AND id=?",
        )
        .bind(user.id, id)
        .first();
      if (
        !saved ||
        saved.deleted ||
        (!result.meta.changes && saved.payload !== payload)
      )
        return apiJson(
          {
            error:
              !saved && body.baseVersion === 0
                ? "This account has reached its 500-purchase limit. Export a backup to keep a separate archive."
                : "This purchase changed or was deleted on another device. Your edits have not been overwritten. Reload and review both versions.",
          },
          409,
        );
      return apiJson({
        purchase: { ...JSON.parse(saved.payload), _version: saved.version },
      });
    }
    return apiJson({ error: "Not found" }, 404);
  } catch (error) {
    if (
      (error instanceof Error &&
        ["too-large", "empty"].includes(error.message)) ||
      error instanceof SyntaxError
    )
      return apiJson({ error: "The request is too large or invalid." }, 400);
    return apiJson(
      {
        error:
          "Could not complete this request. Your existing purchases are unchanged. Please retry.",
      },
      503,
    );
  }
}
