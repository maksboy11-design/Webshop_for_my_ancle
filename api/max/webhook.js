// server/max/productionDeps.ts
import { Pool } from "pg";

// server/max/config.ts
var SECRET_PATTERN = /^[A-Za-z0-9_-]{5,256}$/;
var USER_ID_PATTERN = /^[1-9][0-9]{0,15}$/;
var CHAT_ID_PATTERN = /^-?[1-9][0-9]{0,15}$/;
function secretIsValid(value) {
  return SECRET_PATTERN.test(value);
}
function tokenIsValid(value) {
  return value.length > 0 && !/\s/.test(value);
}
function readModeratorIds(raw) {
  if (raw == null || raw.trim() === "") return { ok: false };
  const ids = /* @__PURE__ */ new Set();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!USER_ID_PATTERN.test(id) || !Number.isSafeInteger(Number(id))) return { ok: false };
    ids.add(id);
  }
  if (ids.size === 0) return { ok: false };
  return { ok: true, ids };
}
function readChatIds(raw) {
  if (raw == null || raw.trim() === "") return { ok: false };
  const ids = /* @__PURE__ */ new Set();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!CHAT_ID_PATTERN.test(id) || !Number.isSafeInteger(Number(id))) return { ok: false };
    ids.add(id);
  }
  if (ids.size === 0) return { ok: false };
  return { ok: true, ids };
}

// server/max/logger.ts
var ALLOWED = /* @__PURE__ */ new Set(["status", "updateType", "duplicate", "configured"]);
function allow(fields) {
  const out = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
function createLogger() {
  return {
    info(event, fields) {
      console.info(JSON.stringify({ scope: "max-reviews", level: "info", event, ...allow(fields) }));
    },
    error(event, fields) {
      console.error(JSON.stringify({ scope: "max-reviews", level: "error", event, ...allow(fields) }));
    }
  };
}

// server/max/maxClient.ts
import https from "node:https";
import { getCACertificates } from "node:tls";

// server/max/rootCa.ts
var russianTrustedRootCa = `-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----
`;

// server/max/maxClient.ts
var MaxTemporaryError = class extends Error {
  status;
  constructor(status) {
    super("max_temporary");
    this.name = "MaxTemporaryError";
    this.status = status;
  }
};
var MaxPermanentError = class extends Error {
  status;
  constructor(status) {
    super("max_permanent");
    this.name = "MaxPermanentError";
    this.status = status;
  }
};
var API_ORIGIN = "https://platform-api2.max.ru";
var USER_ID_PATTERN2 = /^[1-9][0-9]{0,15}$/;
var CHAT_ID_PATTERN2 = /^-?[1-9][0-9]{0,15}$/;
var trustedCas = [...getCACertificates(), russianTrustedRootCa];
function trustedFetch(input, init) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const headerBag = new Headers(init?.headers);
  const headers = {};
  headerBag.forEach((value, key) => {
    headers[key] = value;
  });
  const payload = typeof init?.body === "string" ? init.body : null;
  if (payload != null && headers["content-length"] == null) headers["content-length"] = String(Buffer.byteLength(payload));
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        ca: trustedCas
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") responseHeaders.set(key, value);
            else if (Array.isArray(value)) responseHeaders.set(key, value.join(", "));
          }
          resolve(new Response(body, { status: response.statusCode ?? 500, headers: responseHeaders }));
        });
      }
    );
    request.on("error", reject);
    if (payload != null) request.write(payload);
    request.end();
  });
}
function endpoint(path, query) {
  const url = new URL(path, API_ORIGIN);
  url.search = query.toString();
  if (url.origin !== API_ORIGIN) throw new MaxPermanentError(400);
  return url.toString();
}
function numericUserId(value) {
  if (!value || !USER_ID_PATTERN2.test(value)) return null;
  return value;
}
function numericChatId(value) {
  if (!value || !CHAT_ID_PATTERN2.test(value)) return null;
  return value;
}
async function classify(response) {
  if (response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      await response.arrayBuffer().catch(() => void 0);
      return;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return;
    }
    if (payload && typeof payload === "object" && "success" in payload && payload.success === false) {
      throw new MaxPermanentError(response.status);
    }
    return;
  }
  await response.arrayBuffer().catch(() => void 0);
  if (response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new MaxTemporaryError(response.status);
  }
  throw new MaxPermanentError(response.status);
}
function createMaxClient(token, fetchImpl = trustedFetch) {
  async function post(url, body) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2500),
        headers: {
          authorization: token,
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
      await classify(response);
    } catch (error) {
      if (error instanceof MaxTemporaryError || error instanceof MaxPermanentError) throw error;
      throw new MaxTemporaryError(0);
    }
  }
  return {
    async sendMessage({ chatId, userId, text, attachments }) {
      const params = new URLSearchParams();
      const chat = numericChatId(chatId);
      const user = numericUserId(userId);
      if (chat) params.set("chat_id", chat);
      else if (user) params.set("user_id", user);
      else throw new MaxPermanentError(400);
      params.set("disable_link_preview", "true");
      await post(endpoint("/messages", params), {
        text,
        ...attachments ? { attachments: [attachments] } : {}
      });
    },
    async answerCallback({ callbackId, text, attachments, notification }) {
      if (!callbackId.trim()) throw new MaxPermanentError(400);
      const params = new URLSearchParams({ callback_id: callbackId, disable_link_preview: "true" });
      const body = {};
      if (notification) body.notification = notification;
      if (text) body.message = { text, ...attachments ? { attachments: [attachments] } : {} };
      await post(endpoint("/answers", params), body);
    }
  };
}

// server/max/postgresStore.ts
import { randomUUID } from "node:crypto";

// server/max/text.ts
var REVIEW_TEXT_MAX = 2e3;
var AUTHOR_MAX = 80;
var OUTGOING_MAX = 4e3;
var CONTROLS = new RegExp(`[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]`);
var BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
function codePointLength(value) {
  return Array.from(value).length;
}
function fitMessage(text) {
  const chars = Array.from(text);
  if (chars.length <= OUTGOING_MAX) return text;
  return `${chars.slice(0, OUTGOING_MAX - 1).join("")}\u2026`;
}
function normalize(input) {
  return input.replaceAll("\0", "").replace(BIDI, "").replace(/\n{3,}/g, "\n\n").trim();
}
function reviewText(input) {
  const withoutNul = input.replaceAll("\0", "");
  if (CONTROLS.test(withoutNul)) return { ok: false, reason: "controls" };
  const text = normalize(input);
  const length = codePointLength(text);
  if (length === 0) return { ok: false, reason: "empty" };
  if (length > REVIEW_TEXT_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}
function authorName(input) {
  const withoutNul = input.replaceAll("\0", "");
  if (CONTROLS.test(withoutNul)) return { ok: false, reason: "controls" };
  const text = normalize(input);
  const length = codePointLength(text);
  if (length === 0) return { ok: false, reason: "empty" };
  if (length > AUTHOR_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}
function parseCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  const name = (head ?? "").toLowerCase();
  const arg = rest.join(" ").trim();
  if (name === "/start" || name === "/review" || name === "/cancel" || name === "/reviews_pending") {
    return { name, arg: null };
  }
  if (name === "/review_approve" || name === "/review_reject") {
    return { name, arg: arg || null };
  }
  return { name: "/unknown", arg: null };
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reviewId(value) {
  if (!value || !UUID.test(value)) return null;
  return value.toLowerCase();
}

// server/max/postgresStore.ts
function asKeyboard(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}
function textOrNull(value) {
  return typeof value === "string" ? value : null;
}
function attachmentsOf(value) {
  if (!Array.isArray(value)) return [];
  const stored = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item;
    if (row.type !== "image" && row.type !== "video" && row.type !== "unsupported") continue;
    stored.push({
      type: row.type,
      token: textOrNull(row.token),
      photoId: textOrNull(row.photoId),
      width: typeof row.width === "number" ? row.width : null,
      height: typeof row.height === "number" ? row.height : null,
      duration: typeof row.duration === "number" ? row.duration : null,
      size: typeof row.size === "number" ? row.size : null
    });
  }
  return stored;
}
function contentFrom(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageMid: row.message_mid,
    receivedAt: row.received_at,
    kind: row.kind,
    text: textOrNull(row.body_text),
    publicText: textOrNull(row.public_text),
    attachments: attachmentsOf(row.attachments),
    status: row.status,
    publishedReviewId: textOrNull(row.published_review_id)
  };
}
function createPostgresStore(pool2) {
  async function withClient(fn) {
    const client = await pool2.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
  function tx(client) {
    return {
      async claim(key, updateType) {
        const result = await client.query(
          `INSERT INTO max_update_receipts (idempotency_key, update_type)
           VALUES ($1, $2)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING idempotency_key`,
          [key, updateType]
        );
        return result.rows.length > 0 ? "new" : "duplicate";
      },
      async getSession(userId, nowIso) {
        const removed = await client.query(
          `DELETE FROM review_sessions
           WHERE user_id = $1::bigint AND expires_at <= $2::timestamptz
           RETURNING user_id`,
          [userId, nowIso]
        );
        if (removed.rows.length > 0) return { status: "expired" };
        const result = await client.query(
          `SELECT step, product_id, draft_text, author_name, expires_at::text
           FROM review_sessions
           WHERE user_id = $1::bigint AND expires_at > $2::timestamptz`,
          [userId, nowIso]
        );
        const row = result.rows[0];
        if (!row) return { status: "none" };
        return {
          status: "active",
          session: {
            step: row.step,
            productId: row.product_id,
            draftText: row.draft_text,
            authorName: row.author_name,
            expiresAt: row.expires_at
          }
        };
      },
      async putSession(userId, session, nowIso) {
        await client.query(
          `INSERT INTO review_sessions
             (user_id, step, product_id, draft_text, author_name, expires_at, updated_at)
           VALUES ($1::bigint, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
           ON CONFLICT (user_id) DO UPDATE SET
             step = EXCLUDED.step,
             product_id = EXCLUDED.product_id,
             draft_text = EXCLUDED.draft_text,
             author_name = EXCLUDED.author_name,
             expires_at = EXCLUDED.expires_at,
             updated_at = EXCLUDED.updated_at`,
          [userId, session.step, session.productId, session.draftText, session.authorName, session.expiresAt, nowIso]
        );
      },
      async deleteSession(userId) {
        await client.query(`DELETE FROM review_sessions WHERE user_id = $1::bigint`, [userId]);
      },
      async insertPending(review) {
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, idempotency_key, sender_user_id
           ) VALUES (
             $1::uuid, $2, $3, $4, 'pending', 'MAX',
             $5::timestamptz, $6::timestamptz, $7, $8::bigint
           )
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            review.id,
            review.productId,
            review.text,
            review.author,
            review.receivedAt,
            review.consentAt,
            review.idempotencyKey,
            review.senderUserId
          ]
        );
      },
      async listPending(limit) {
        const result = await client.query(
          `SELECT id::text, product_id, body, author_name, received_at::text
           FROM product_reviews
           WHERE status = 'pending'
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit]
        );
        return result.rows.map(
          (row) => ({
            id: row.id,
            productId: row.product_id,
            text: row.body,
            author: row.author_name,
            receivedAt: row.received_at
          })
        );
      },
      async countPending() {
        const result = await client.query(
          `SELECT count(*)::int AS count FROM product_reviews WHERE status = 'pending'`
        );
        return result.rows[0]?.count ?? 0;
      },
      async decide(id, status, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE product_reviews
           SET status = $2, decided_at = $3::timestamptz, moderator_user_id = $4::bigint
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id, status, atIso, moderatorUserId]
        );
        if (result.rows.length > 0) return "updated";
        const existing = await client.query(`SELECT status FROM product_reviews WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_pending" : "missing";
      },
      async enqueue(key, jobs) {
        for (let position = 0; position < jobs.length; position += 1) {
          const job2 = jobs[position];
          if (!job2) continue;
          await client.query(
            `INSERT INTO review_outbox (
               id, idempotency_key, position, kind, chat_id, user_id, callback_id,
               body_text, attachments, notification
             ) VALUES (
               $1::uuid, $2, $3, $4, $5::bigint, $6::bigint, $7, $8, $9::jsonb, $10
             )`,
            [
              randomUUID(),
              key,
              position,
              job2.kind,
              job2.chatId,
              job2.userId,
              job2.callbackId,
              job2.text,
              job2.attachments ? JSON.stringify(job2.attachments) : null,
              job2.notification
            ]
          );
        }
      },
      async countActions(userId, sinceIso) {
        const result = await client.query(
          `SELECT count(*)::int AS count
           FROM review_intake_events
           WHERE user_id = $1::bigint AND created_at >= $2::timestamptz`,
          [userId, sinceIso]
        );
        return result.rows[0]?.count ?? 0;
      },
      async recordAction(userId, atIso) {
        await client.query(
          `INSERT INTO review_intake_events (user_id, created_at) VALUES ($1::bigint, $2::timestamptz)`,
          [userId, atIso]
        );
      },
      async pruneActions(beforeIso) {
        await client.query(`DELETE FROM review_intake_events WHERE created_at < $1::timestamptz`, [beforeIso]);
      },
      async findGroupMessage(chatId, messageMid) {
        const result = await client.query(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind, body_text, public_text,
                  attachments, status, published_review_id::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2`,
          [chatId, messageMid]
        );
        const row = result.rows[0];
        return row ? contentFrom(row) : null;
      },
      async countGroupMessages(chatId, sinceIso) {
        const result = await client.query(
          `SELECT count(*)::int AS count
           FROM incoming_content
           WHERE chat_id = $1::bigint AND received_at >= $2::timestamptz`,
          [chatId, sinceIso]
        );
        return result.rows[0]?.count ?? 0;
      },
      async insertGroupMessage(content) {
        const result = await client.query(
          `INSERT INTO incoming_content (
             id, chat_id, message_mid, received_at, kind, body_text, public_text,
             attachments, status, idempotency_key
           ) VALUES (
             $1::uuid, $2::bigint, $3, $4::timestamptz, $5, $6, $7, $8::jsonb, $9, $10
           )
           ON CONFLICT (chat_id, message_mid) DO NOTHING
           RETURNING id`,
          [
            content.id,
            content.chatId,
            content.messageMid,
            content.receivedAt,
            content.kind,
            content.text,
            content.publicText,
            JSON.stringify(content.attachments),
            content.status,
            content.idempotencyKey
          ]
        );
        return result.rows.length > 0 ? "created" : "duplicate";
      },
      async replaceGroupMessage(content, editedAt) {
        const existing = await client.query(
          `SELECT id::text, status, published_review_id::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2
           FOR UPDATE`,
          [content.chatId, content.messageMid]
        );
        const row = existing.rows[0];
        if (!row) return "missing";
        if (row.status === "removed") return "removed";
        if (row.published_review_id) {
          await client.query(
            `UPDATE product_reviews SET withdrawn_at = $2::timestamptz WHERE id = $1::uuid AND withdrawn_at IS NULL`,
            [row.published_review_id, editedAt]
          );
        }
        await client.query(
          `UPDATE incoming_content
           SET edited_at = $2::timestamptz,
               kind = $3,
               body_text = $4,
               public_text = $5,
               attachments = $6::jsonb,
               status = $7,
               published_review_id = NULL
           WHERE id = $1::uuid`,
          [
            row.id,
            editedAt,
            content.kind,
            content.text,
            content.publicText,
            JSON.stringify(content.attachments),
            content.status === "empty" ? "empty" : "pending"
          ]
        );
        return "updated";
      },
      async removeGroupMessage(chatId, messageMid) {
        const existing = await client.query(
          `SELECT id::text, published_review_id::text, received_at::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2
           FOR UPDATE`,
          [chatId, messageMid]
        );
        const row = existing.rows[0];
        if (!row) return "missing";
        if (row.published_review_id) {
          await client.query(
            `UPDATE product_reviews SET withdrawn_at = COALESCE(withdrawn_at, $2::timestamptz) WHERE id = $1::uuid`,
            [row.published_review_id, row.received_at]
          );
        }
        await client.query(`UPDATE incoming_content SET status = 'removed' WHERE id = $1::uuid`, [row.id]);
        return "removed";
      },
      async listPendingGroup(limit) {
        const result = await client.query(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind, body_text, public_text,
                  attachments, status, published_review_id::text
           FROM incoming_content
           WHERE status = 'pending' AND kind = 'review'
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit]
        );
        return result.rows.map(contentFrom);
      },
      async publishGroupReview(id, productId, moderatorUserId, atIso) {
        const existing = await client.query(
          `SELECT status, kind, public_text, received_at::text
           FROM incoming_content
           WHERE id = $1::uuid
           FOR UPDATE`,
          [id]
        );
        const row = existing.rows[0];
        if (!row) return "missing";
        if (row.status !== "pending" || row.kind !== "review") return "not_pending";
        if (!row.public_text) return "needs_text";
        if (codePointLength(row.public_text) > REVIEW_TEXT_MAX) return "too_long";
        const reviewId2 = randomUUID();
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, decided_at, moderator_user_id, idempotency_key, sender_user_id
           ) VALUES (
             $1::uuid, $2, $3, NULL, 'published', 'MAX',
             $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::bigint, $7, NULL
           )`,
          [reviewId2, productId, row.public_text, row.received_at, atIso, moderatorUserId, `group-review:${reviewId2}`]
        );
        await client.query(
          `UPDATE incoming_content
           SET status = 'published', published_review_id = $2::uuid
           WHERE id = $1::uuid`,
          [id, reviewId2]
        );
        return "published";
      },
      async rejectGroup(id) {
        const result = await client.query(
          `UPDATE incoming_content
           SET status = 'rejected'
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id]
        );
        if (result.rows.length > 0) return "rejected";
        const existing = await client.query(`SELECT id FROM incoming_content WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_pending" : "missing";
      }
    };
  }
  return {
    async transaction(fn) {
      return withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const result = await fn(tx(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
    },
    async listPublished(productId) {
      return withClient(async (client) => {
        const result = await client.query(
          `SELECT id::text, product_id, author_name, body
           FROM product_reviews
           WHERE status = 'published'
             AND withdrawn_at IS NULL
             AND ($1::text IS NULL OR product_id = $1)
           ORDER BY received_at ASC, id ASC
           LIMIT 100`,
          [productId]
        );
        return result.rows.map(
          (row) => ({
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body
          })
        );
      });
    },
    async listPendingOutbox(key) {
      return withClient(async (client) => {
        const result = await client.query(
          `SELECT id::text, kind, chat_id::text, user_id::text, callback_id, body_text, attachments, notification
           FROM review_outbox
           WHERE idempotency_key = $1
           ORDER BY position ASC`,
          [key]
        );
        return result.rows.map(
          (row) => ({
            id: row.id,
            kind: row.kind,
            chatId: textOrNull(row.chat_id),
            userId: textOrNull(row.user_id),
            callbackId: textOrNull(row.callback_id),
            text: textOrNull(row.body_text),
            attachments: asKeyboard(row.attachments),
            notification: textOrNull(row.notification)
          })
        );
      });
    },
    async claimSend(id, now) {
      return withClient(async (client) => {
        const existing = await client.query(
          `SELECT sending_at::text FROM review_outbox WHERE id = $1::uuid`,
          [id]
        );
        if (existing.rows.length === 0) return "missing";
        const result = await client.query(
          `UPDATE review_outbox
           SET sending_at = $2::timestamptz
           WHERE id = $1::uuid
             AND (sending_at IS NULL OR sending_at < $2::timestamptz - interval '20 seconds')
           RETURNING id`,
          [id, now.toISOString()]
        );
        return result.rows.length > 0 ? "claimed" : "busy";
      });
    },
    async deleteOutbox(id) {
      await withClient((client) => client.query(`DELETE FROM review_outbox WHERE id = $1::uuid`, [id]));
    },
    async releaseOutbox(id) {
      await withClient((client) => client.query(`UPDATE review_outbox SET sending_at = NULL WHERE id = $1::uuid`, [id]));
    }
  };
}

// server/max/productionDeps.ts
var pool;
var poolUrl;
function storeFor(databaseUrl) {
  if (!pool || poolUrl !== databaseUrl) {
    pool?.end().catch(() => void 0);
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 5e3,
      connectionTimeoutMillis: 5e3
    });
    poolUrl = databaseUrl;
  }
  const active = pool;
  return createPostgresStore({
    async connect() {
      const client = await active.connect();
      return {
        query: (text, values) => client.query(text, values),
        release: () => client.release()
      };
    }
  });
}
function productionDeps(env = process.env) {
  const secret = env.MAX_WEBHOOK_SECRET ?? "";
  const secretConfigured = secretIsValid(secret);
  const token = env.MAX_BOT_TOKEN?.trim() ?? "";
  const tokenConfigured = tokenIsValid(token);
  const moderators = readModeratorIds(env.MAX_REVIEW_MODERATOR_IDS);
  const chats = readChatIds(env.MAX_ALLOWED_CHAT_IDS);
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  return {
    secret: secretConfigured ? secret : null,
    secretConfigured,
    moderators: moderators.ok ? moderators.ids : /* @__PURE__ */ new Set(),
    moderatorsConfigured: moderators.ok,
    allowedChatIds: chats.ok ? chats.ids : /* @__PURE__ */ new Set(),
    allowedChatsConfigured: chats.ok,
    store: databaseUrl ? storeFor(databaseUrl) : null,
    max: tokenConfigured ? createMaxClient(token) : null,
    now: () => /* @__PURE__ */ new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: createLogger(),
    rateLimit: { max: 20, windowMs: 10 * 60 * 1e3 },
    groupRateLimit: { max: 60, windowMs: 10 * 60 * 1e3 },
    sessionTtlMs: 30 * 60 * 1e3,
    deliveryBudgetMs: 8e3
  };
}

// server/max/http.ts
var MAX_BODY_BYTES = 256 * 1024;
function jsonResponse(status, body, extra) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}
async function readLimitedJson(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415 };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

// server/max/deliver.ts
async function deliverOutbox(jobs, store, max, log, now, sleep, budgetMs) {
  const started = Date.now();
  let sent = 0;
  for (const job2 of jobs) {
    if (Date.now() - started + 3e3 > budgetMs) return "retry";
    const claim = await store.claimSend(job2.id, now());
    if (claim === "missing") continue;
    if (claim === "busy") return "retry";
    if (sent > 0) await sleep(500);
    try {
      if (job2.kind === "callback_answer" && job2.callbackId) {
        await max.answerCallback({
          callbackId: job2.callbackId,
          text: job2.text,
          attachments: job2.attachments,
          notification: job2.notification
        });
      } else {
        await max.sendMessage({
          chatId: job2.chatId,
          userId: job2.userId,
          text: job2.text ?? "",
          attachments: job2.attachments
        });
      }
      await store.deleteOutbox(job2.id);
      sent += 1;
    } catch (error) {
      const status = error instanceof MaxTemporaryError || error instanceof MaxPermanentError ? error.status : 0;
      log.error("max_delivery_failed", { status });
      if (error instanceof MaxTemporaryError) {
        await store.releaseOutbox(job2.id);
        return "retry";
      }
      await store.deleteOutbox(job2.id);
    }
  }
  return "ok";
}

// server/max/groupIntake.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// server/max/classify.ts
var MARKER = /^\s*отзыв(?=$|[\s:=,.;!?—–-])/iu;
var STRIP = /^\s*отзыв[\s:=,.;!?—–-]*/iu;
function normalizedText(value) {
  if (value == null) return null;
  return value.normalize("NFKC");
}
function kindsOf(attachments) {
  let images = 0;
  let videos = 0;
  let unsupported2 = 0;
  for (const item of attachments) {
    if (item.type === "image") images += 1;
    else if (item.type === "video") videos += 1;
    else unsupported2 += 1;
  }
  return { images, videos, unsupported: unsupported2 };
}
function mediaKind(images, videos, unsupported2, hasText) {
  const mediaTypes = Number(images > 0) + Number(videos > 0);
  if (hasText && (mediaTypes > 0 || unsupported2 > 0)) return "mixed";
  if (mediaTypes > 1) return "mixed";
  if (images > 0) return "image";
  if (videos > 0) return "video";
  if (unsupported2 > 0) return "unsupported";
  if (hasText) return "text";
  return "empty";
}
function classifyMessage(text, attachments) {
  const normalized = normalizedText(text);
  const { images, videos, unsupported: unsupported2 } = kindsOf(attachments);
  const substantiveMedia = images + videos > 0;
  if (normalized != null && MARKER.test(normalized)) {
    const stripped = normalized.replace(STRIP, "").trim();
    if (stripped.length === 0 && !substantiveMedia) {
      return { kind: "empty", review: false, publicText: null, text: normalized };
    }
    return {
      kind: "review",
      review: true,
      publicText: stripped.length > 0 ? stripped : null,
      text: normalized
    };
  }
  const hasText = normalized != null && normalized.trim().length > 0;
  return {
    kind: mediaKind(images, videos, unsupported2, hasText),
    review: false,
    publicText: hasText ? normalized.trim() : null,
    text: normalized
  };
}

// server/max/groupIntake.ts
var IntakeDeferred = class extends Error {
  constructor() {
    super("intake_deferred");
    this.name = "IntakeDeferred";
  }
};
function isGroupTraffic(update) {
  if (update.type === "message_removed") return true;
  return (update.type === "message_created" || update.type === "message_edited") && update.chatType === "chat";
}
function allowed(chatId, deps) {
  return chatId != null && deps.allowedChatsConfigured && deps.allowedChatIds.has(chatId);
}
function contentOf(update, chatId, receivedAt) {
  const classified = classifyMessage(update.text, update.attachments);
  return {
    id: randomUUID2(),
    chatId,
    messageMid: update.messageMid,
    receivedAt,
    kind: classified.kind,
    text: classified.text,
    publicText: classified.publicText,
    attachments: update.attachments,
    status: classified.kind === "empty" ? "empty" : "pending",
    idempotencyKey: `group:${chatId}:${update.messageMid}`
  };
}
async function planGroupUpdate(update, tx, deps) {
  const chatId = update.chatId;
  if (!allowed(chatId, deps)) {
    deps.log.info("group_rejected", { configured: deps.allowedChatsConfigured });
    return;
  }
  if (update.type === "message_removed") {
    await tx.removeGroupMessage(chatId, update.messageMid);
    return;
  }
  if (update.type !== "message_created" && update.type !== "message_edited") return;
  const content = contentOf(update, chatId, deps.now().toISOString());
  if (update.type === "message_edited") {
    const edited = await tx.replaceGroupMessage(content, content.receivedAt);
    if (edited === "missing") await tx.insertGroupMessage(content);
    return;
  }
  const existing = await tx.findGroupMessage(chatId, update.messageMid);
  if (existing) return;
  await tx.insertGroupMessage(content);
  deps.log.info("group_stored", { updateType: content.kind });
}

// server/max/reviewFlow.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/content/copy.ts
var COPY = {
  pricePending: "\u0426\u0435\u043D\u0430 \u0443\u0442\u043E\u0447\u043D\u044F\u0435\u0442\u0441\u044F",
  valuePending: "\u0423\u0442\u043E\u0447\u043D\u044F\u0435\u0442\u0441\u044F \u043F\u043E \u043F\u0430\u0441\u043F\u043E\u0440\u0442\u0443",
  textPending: "\u0422\u0435\u043A\u0441\u0442 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u043F\u043E\u0441\u043B\u0435 \u0441\u043E\u0433\u043B\u0430\u0441\u043E\u0432\u0430\u043D\u0438\u044F \u0441 \u0437\u0430\u043A\u0430\u0437\u0447\u0438\u043A\u043E\u043C.",
  linkPending: "\u0421\u0441\u044B\u043B\u043A\u0430 \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430",
  filePending: "\u0424\u0430\u0439\u043B \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D",
  photoPending: "\u0424\u043E\u0442\u043E \u0431\u0443\u0434\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E",
  datePending: "\u0414\u0430\u0442\u0430 \u0443\u0442\u043E\u0447\u043D\u044F\u0435\u0442\u0441\u044F",
  speakerPending: "\u0421\u043F\u0438\u043A\u0435\u0440 \u0443\u0442\u043E\u0447\u043D\u044F\u0435\u0442\u0441\u044F",
  disclaimer: "\u041D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u043B\u0435\u043A\u0430\u0440\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u043E\u043C. \u041F\u0435\u0440\u0435\u0434 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u0435\u043C \u043D\u0443\u0436\u043D\u0430 \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u044F \u0441\u043E \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442\u043E\u043C.",
  supplementNote: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438 \u0441\u043E\u0441\u0442\u0430\u0432 \u043F\u0440\u0438\u0432\u0435\u0434\u0435\u043D\u044B \u043F\u043E \u0434\u0430\u043D\u043D\u044B\u043C \u0443\u043F\u0430\u043A\u043E\u0432\u043A\u0438. \u041F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u2014 \u043F\u043E \u0434\u0430\u043D\u043D\u044B\u043C \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F.",
  deviceNote: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0438 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438 \u0431\u0443\u0434\u0443\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B \u043F\u043E \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u043C \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u0430\u043C \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438.",
  aboutLead: "SILKWAY \u2014 \u043C\u0430\u0433\u0430\u0437\u0438\u043D \u043F\u0440\u0438\u0431\u043E\u0440\u043E\u0432 \u0434\u043B\u044F \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0438 \u0411\u0410\u0414\u043E\u0432 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438-\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044F. \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0438 \u0444\u0430\u043A\u0442\u044B \u043E \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438 \u0431\u0443\u0434\u0443\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B \u043F\u043E \u043E\u0444\u0438\u0446\u0438\u0430\u043B\u044C\u043D\u044B\u043C \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u0430\u043C.",
  consentLabel: "\u042F \u0441\u043E\u0433\u043B\u0430\u0441\u0435\u043D(\u043D\u0430) \u043D\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445 \u0432 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u0438 \u0441 \u041F\u043E\u043B\u0438\u0442\u0438\u043A\u043E\u0439 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438",
  formUnavailable: "\u0424\u043E\u0440\u043C\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430 \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443. \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0432 Telegram \u0438\u043B\u0438 MAX, \u043A\u043E\u0433\u0434\u0430 \u0441\u0441\u044B\u043B\u043A\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F.",
  invite: "\u041E\u0441\u0442\u0430\u043B\u0438\u0441\u044C \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u2014 \u043E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0442\u043E\u043C\u0443, \u043A\u0442\u043E \u0432\u0430\u0441 \u043F\u0440\u0438\u0433\u043B\u0430\u0441\u0438\u043B.",
  emptyCatalog: "\u041F\u043E \u044D\u0442\u0438\u043C \u0443\u0441\u043B\u043E\u0432\u0438\u044F\u043C \u0442\u043E\u0432\u0430\u0440\u043E\u0432 \u043D\u0435\u0442.",
  resetFilters: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B"
};
var FAQ = [
  { id: "choose", q: "\u041A\u0430\u043A \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043F\u0440\u0438\u0431\u043E\u0440?", a: COPY.textPending },
  { id: "order", q: "\u041A\u0430\u043A \u043E\u0444\u043E\u0440\u043C\u0438\u0442\u044C \u0437\u0430\u043A\u0430\u0437?", a: COPY.textPending },
  { id: "consult", q: "\u041A\u0430\u043A \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u044E?", a: COPY.textPending },
  { id: "docs", q: "\u0413\u0434\u0435 \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u043D\u0430 \u043F\u0440\u043E\u0434\u0443\u043A\u0446\u0438\u044E?", a: COPY.textPending },
  { id: "delivery", q: "\u041A\u0430\u043A\u0438\u0435 \u0441\u043F\u043E\u0441\u043E\u0431\u044B \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B?", a: COPY.textPending }
];

// src/data/products.ts
var img = (file, width = 600, height = 600) => ({
  src: `/products/catalog/${file}.webp`,
  width,
  height
});
var PRODUCTS = [
  {
    id: "flagship",
    slug: "flagship-device",
    brandId: "halos",
    name: "\u0424\u043B\u0430\u0433\u043C\u0430\u043D\u0441\u043A\u0438\u0439 \u043F\u0440\u0438\u0431\u043E\u0440 SILKWAY",
    pack: null,
    category: "devices",
    form: null,
    kind: "device",
    image: { src: "/products/device.png", width: 601, height: 873 },
    gallery: [
      { src: "/products/device.png", width: 601, height: 873 },
      img("flagship-device-photo")
    ],
    price: null,
    description: null
  },
  {
    id: "astaxanthin",
    slug: "chan-astaxanthin",
    brandId: "chan",
    name: "\u0420\u0430\u0441\u0442\u0432\u043E\u0440\u0438\u043C\u044B\u0439 \u043D\u0430\u043F\u0438\u0442\u043E\u043A \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB",
    pack: "60 \u0433 (2 \u0433 \xD7 30 \u043F\u0430\u043A\u0435\u0442\u0438\u043A\u043E\u0432)",
    category: "supplements",
    form: "powder",
    kind: "supplement",
    image: img("chan-astaxanthin"),
    gallery: [img("chan-astaxanthin")],
    price: null,
    description: null
  },
  {
    id: "probiotic",
    slug: "chan-probiotic",
    brandId: "chan",
    name: "\u041F\u0440\u043E\u0431\u0438\u043E\u0442\u0438\u043A \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB",
    pack: null,
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-probiotic"),
    gallery: [img("chan-probiotic")],
    price: null,
    description: null
  },
  {
    id: "zinc",
    slug: "chan-zinc-bao",
    brandId: "chan",
    name: "\u0422\u0430\u0431\u043B\u0435\u0442\u043A\u0438 \xAB\u0426\u0438\u043D\u043A \u0411\u0430\u043E\xBB",
    pack: null,
    category: "supplements",
    form: "tablets",
    kind: "supplement",
    image: img("chan-zinc-bao"),
    gallery: [img("chan-zinc-bao")],
    price: null,
    description: null
  },
  {
    id: "calcium",
    slug: "chan-calcium-d",
    brandId: "chan",
    name: "\u041A\u0430\u043F\u0441\u0443\u043B\u044B \u043A\u0430\u043B\u044C\u0446\u0438\u044F \u0441 \u0432\u0438\u0442\u0430\u043C\u0438\u043D\u043E\u043C D",
    pack: null,
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-calcium-d"),
    gallery: [img("chan-calcium-d")],
    price: null,
    description: null
  },
  {
    id: "iron",
    slug: "chan-iron",
    brandId: "chan",
    name: "\u0416\u0435\u043B\u0435\u0437\u043E \u0432 \u043A\u0430\u043F\u0441\u0443\u043B\u0430\u0445",
    pack: null,
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-iron"),
    gallery: [img("chan-iron")],
    price: null,
    description: null
  },
  {
    id: "cordyceps",
    slug: "chan-cordyceps",
    brandId: "chan",
    name: "\u041A\u0430\u043F\u0441\u0443\u043B\u044B \u043A\u043E\u0440\u0434\u0438\u0446\u0435\u043F\u0441\u0430",
    pack: null,
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-cordyceps"),
    gallery: [img("chan-cordyceps")],
    price: null,
    description: null
  },
  {
    id: "chitosan",
    slug: "chan-chitosan",
    brandId: "chan",
    name: "\u041A\u0430\u043F\u0441\u0443\u043B\u044B \u0445\u0438\u0442\u043E\u0437\u0430\u043D",
    pack: null,
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-chitosan"),
    gallery: [img("chan-chitosan")],
    price: null,
    description: null
  },
  {
    id: "tea",
    slug: "chan-tea",
    brandId: "chan",
    name: "\u0427\u0430\u0439",
    pack: null,
    category: "drinks",
    form: "powder",
    kind: "supplement",
    image: img("chan-tea"),
    gallery: [img("chan-tea")],
    price: null,
    description: null
  },
  {
    id: "coffee",
    slug: "chan-collagen-coffee",
    brandId: "chan",
    name: "\u041A\u043E\u0444\u0435 \u0441 \u043A\u043E\u043B\u043B\u0430\u0433\u0435\u043D\u043E\u0432\u044B\u043C \u043F\u0435\u043F\u0442\u0438\u0434\u043E\u043C",
    pack: null,
    category: "drinks",
    form: "powder",
    kind: "supplement",
    image: img("chan-collagen-coffee"),
    gallery: [img("chan-collagen-coffee")],
    price: null,
    description: null
  },
  {
    id: "yangyuan",
    slug: "chan-yangyuan",
    brandId: "chan",
    name: "\u517B\u5143\u4E39",
    pack: "48 \u0433 (0,8 \u0433 \xD7 60)",
    category: "supplements",
    form: "capsules",
    kind: "supplement",
    image: img("chan-collagen-drink"),
    gallery: [img("chan-collagen-drink")],
    price: null,
    description: null
  },
  {
    id: "era-gel",
    slug: "era-gel",
    brandId: "era",
    name: "\u0413\u0435\u043B\u044C \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-gel"),
    gallery: [img("era-gel")],
    price: null,
    description: null
  },
  {
    id: "era-lotion",
    slug: "era-lotion",
    brandId: "era",
    name: "\u041B\u043E\u0441\u044C\u043E\u043D \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-lotion"),
    gallery: [img("era-lotion")],
    price: null,
    description: null
  },
  {
    id: "era-toner",
    slug: "era-toner",
    brandId: "era",
    name: "\u0422\u043E\u043D\u0438\u043A \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-toner"),
    gallery: [img("era-toner")],
    price: null,
    description: null
  },
  {
    id: "era-essence",
    slug: "era-essence",
    brandId: "era",
    name: "\u042D\u0441\u0441\u0435\u043D\u0446\u0438\u044F \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: "35 \u043C\u043B",
    category: "care",
    form: "oil",
    kind: "goods",
    image: img("era-essence"),
    gallery: [img("era-essence")],
    price: null,
    description: null
  },
  {
    id: "era-oil",
    slug: "era-face-oil",
    brandId: "era",
    name: "\u041C\u0430\u0441\u043B\u043E \u0434\u043B\u044F \u043B\u0438\u0446\u0430 \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: "35 \u043C\u043B",
    category: "care",
    form: "oil",
    kind: "goods",
    image: img("era-face-oil"),
    gallery: [img("era-face-oil")],
    price: null,
    description: null
  },
  {
    id: "era-foam",
    slug: "era-foam",
    brandId: "era",
    name: "\u0413\u0435\u043B\u044C-\u043F\u0435\u043D\u043A\u0430 \u042D\u0420\u0410 \u0411\u041E\u0422\u0410\u041D\u0418\u041A\u0410",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-foam", 900, 600),
    gallery: [img("era-foam", 900, 600)],
    price: null,
    description: null
  },
  {
    id: "era-massage",
    slug: "era-zhicui-oil",
    brandId: "era",
    name: "\u041C\u0430\u0441\u0441\u0430\u0436\u043D\u043E\u0435 \u0431\u0430\u0437\u043E\u0432\u043E\u0435 \u043C\u0430\u0441\u043B\u043E \xAB\u0427\u0436\u0438\u0446\u0443\u0439\xBB",
    pack: "100 \u043C\u043B",
    category: "care",
    form: "oil",
    kind: "goods",
    image: img("era-massage-oil"),
    gallery: [img("era-massage-oil")],
    price: null,
    description: null
  },
  {
    id: "rosemary",
    slug: "jilanzhi-rosemary-bath-oil",
    brandId: "jilanzhi",
    name: "\u041C\u0430\u0441\u043B\u043E \u0434\u043B\u044F \u0432\u0430\u043D\u043D\u044B \u0441 \u0440\u043E\u0437\u043C\u0430\u0440\u0438\u043D\u043E\u043C JILANZHI",
    pack: "250 \u043C\u043B",
    category: "bath",
    form: "oil",
    kind: "goods",
    image: img("jilanzhi-rosemary-oil"),
    gallery: [img("jilanzhi-rosemary-oil")],
    price: null,
    description: null
  },
  {
    id: "lavender",
    slug: "jilanzhi-lavender-bath-oil",
    brandId: "jilanzhi",
    name: "\u041C\u0430\u0441\u043B\u043E \u0434\u043B\u044F \u0432\u0430\u043D\u043D\u044B JILANZHI",
    pack: "250 \u043C\u043B",
    category: "bath",
    form: "oil",
    kind: "goods",
    image: img("jilanzhi-lavender-oil", 600, 599),
    gallery: [img("jilanzhi-lavender-oil", 600, 599)],
    price: null,
    description: null
  },
  {
    id: "bath-oil",
    slug: "jilanzhi-bath-oil",
    brandId: "jilanzhi",
    name: "\u041C\u0430\u0441\u043B\u043E \u0434\u043B\u044F \u0432\u0430\u043D\u043D\u044B JILANZHI",
    pack: "250 \u043C\u043B",
    category: "bath",
    form: "oil",
    kind: "goods",
    image: img("jilanzhi-bath-oil"),
    gallery: [img("jilanzhi-bath-oil")],
    price: null,
    description: null
  },
  {
    id: "foundation",
    slug: "jilanzhi-foundation",
    brandId: "jilanzhi",
    name: "\u0422\u043E\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u043E\u0441\u043D\u043E\u0432\u0430 JILANZHI",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("jilanzhi-foundation"),
    gallery: [img("jilanzhi-foundation")],
    price: null,
    description: null
  },
  {
    id: "sheets",
    slug: "jilanzhi-laundry-sheets",
    brandId: "jilanzhi",
    name: "\u041F\u043B\u0430\u0441\u0442\u0438\u043D\u044B \u0434\u043B\u044F \u0441\u0442\u0438\u0440\u043A\u0438 JILANZHI",
    pack: null,
    category: "home",
    form: null,
    kind: "goods",
    image: img("jilanzhi-laundry-sheets"),
    gallery: [img("jilanzhi-laundry-sheets")],
    price: null,
    description: null
  },
  {
    id: "oxygen",
    slug: "jilanzhi-oxygen-powder",
    brandId: "jilanzhi",
    name: "\u041A\u0438\u0441\u043B\u043E\u0440\u043E\u0434\u043D\u044B\u0439 \u043F\u043E\u0440\u043E\u0448\u043E\u043A JILANZHI",
    pack: null,
    category: "bath",
    form: "powder",
    kind: "goods",
    image: img("jilanzhi-oxygen-powder"),
    gallery: [img("jilanzhi-oxygen-powder")],
    price: null,
    description: null
  },
  {
    id: "kc7688",
    slug: "silkway-kc-7688",
    brandId: "silkway",
    name: "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043F\u0440\u0438\u0431\u043E\u0440 KC-7688",
    pack: null,
    category: "devices",
    form: null,
    kind: "device",
    image: img("silkway-kc7688"),
    gallery: [img("silkway-kc7688")],
    price: null,
    description: null
  },
  {
    id: "pot",
    slug: "silkway-pot",
    brandId: "silkway",
    name: "\u041A\u0430\u0441\u0442\u0440\u044E\u043B\u044F SILKWAY",
    pack: null,
    category: "home",
    form: null,
    kind: "goods",
    image: img("silkway-pot"),
    gallery: [img("silkway-pot")],
    price: null,
    description: null
  },
  {
    id: "saucepan",
    slug: "silkway-saucepan",
    brandId: "silkway",
    name: "\u0421\u043E\u0442\u0435\u0439\u043D\u0438\u043A SILKWAY",
    pack: null,
    category: "home",
    form: null,
    kind: "goods",
    image: img("silkway-saucepan"),
    gallery: [img("silkway-saucepan")],
    price: null,
    description: null
  },
  {
    id: "filter",
    slug: "silkway-filter",
    brandId: "silkway",
    name: "\u0424\u0438\u043B\u044C\u0442\u0440 SILKWAY",
    pack: null,
    category: "accessories",
    form: null,
    kind: "goods",
    image: img("silkway-filter"),
    gallery: [img("silkway-filter")],
    price: null,
    description: null
  },
  {
    id: "reagent",
    slug: "jeudao-hydrogen-reagent",
    brandId: "jeudao",
    name: "\u0420\u0435\u0430\u0433\u0435\u043D\u0442 JEUDAO \u0434\u043B\u044F \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F \u0440\u0430\u0441\u0442\u0432\u043E\u0440\u0451\u043D\u043D\u043E\u0433\u043E \u0432\u043E\u0434\u043E\u0440\u043E\u0434\u0430",
    pack: "10 \u043C\u043B",
    category: "accessories",
    form: null,
    kind: "goods",
    image: img("jeudao-hydrogen-reagent"),
    gallery: [img("jeudao-hydrogen-reagent")],
    price: null,
    description: null
  }
];

// server/max/catalog.ts
var PRODUCT_PAGE_SIZE = 6;
function findProduct(id) {
  return PRODUCTS.find((item) => item.id === id) ?? null;
}
function productPage(page) {
  const pageCount = Math.max(1, Math.ceil(PRODUCTS.length / PRODUCT_PAGE_SIZE));
  const safe = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    page: safe,
    pageCount,
    items: PRODUCTS.slice(safe * PRODUCT_PAGE_SIZE, safe * PRODUCT_PAGE_SIZE + PRODUCT_PAGE_SIZE)
  };
}
function buttonLabel(name, id) {
  const flat = (name.trim() || id).replace(/\s+/g, " ");
  const chars = Array.from(flat);
  if (chars.length <= 120) return chars.join("");
  return `${chars.slice(0, 119).join("")}\u2026`;
}

// server/max/contentRegistry.ts
var contentHandlers = {
  review: {
    kind: "review",
    permission: "dialog-participant",
    publication: "explicit-consent-and-moderator",
    acceptsAttachments: false
  }
};

// server/max/reviewFlow.ts
var HELP = "\u042D\u0442\u043E \u0431\u043E\u0442 \u043E\u0442\u0437\u044B\u0432\u043E\u0432 SILKWAY. \u041A\u043E\u043C\u0430\u043D\u0434\u0430 /review \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u044B\u0439 \u043E\u0442\u0437\u044B\u0432 \u043E \u0442\u043E\u0432\u0430\u0440\u0435 \u0438\u0437 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430. \u041D\u0430 \u0441\u0430\u0439\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u0432\u0430\u0448\u0435\u0433\u043E \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u044F \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u043C. /cancel \u043F\u0440\u0435\u0440\u044B\u0432\u0430\u0435\u0442 \u043D\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0439 \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0439.";
function expiresAt(deps) {
  return new Date(deps.now().getTime() + deps.sessionTtlMs).toISOString();
}
function keyboard(rows) {
  return {
    type: "inline_keyboard",
    payload: {
      buttons: rows.map((row) => row.map((button) => ({ type: "callback", text: button.text, payload: button.payload })))
    }
  };
}
function cancelRow() {
  return [{ text: "\u041E\u0442\u043C\u0435\u043D\u0430", payload: "cancel" }];
}
function productKeyboard(page) {
  const view = productPage(page);
  const rows = view.items.map((item) => [{ text: buttonLabel(item.name, item.id), payload: `p:${item.id}` }]);
  const nav = [];
  if (view.page > 0) nav.push({ text: "\u041D\u0430\u0437\u0430\u0434", payload: `n:${view.page - 1}` });
  if (view.page + 1 < view.pageCount) nav.push({ text: "\u0414\u0430\u043B\u044C\u0448\u0435", payload: `n:${view.page + 1}` });
  nav.push({ text: "\u041E\u0442\u043C\u0435\u043D\u0430", payload: "cancel" });
  rows.push(nav);
  return keyboard(rows);
}
function nameKeyboard() {
  return keyboard([[{ text: "\u041D\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0438\u043C\u044F", payload: "skip" }], cancelRow()]);
}
function consentKeyboard() {
  return keyboard([
    [{ text: "\u0421\u043E\u0433\u043B\u0430\u0441\u0435\u043D \u043D\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044E", payload: "yes" }],
    [{ text: "\u041D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C", payload: "no" }],
    cancelRow()
  ]);
}
function job(update, text, attachments = null, callbackId = null) {
  return {
    kind: callbackId ? "callback_answer" : "message",
    chatId: update.chatId,
    userId: update.userId,
    callbackId,
    text: fitMessage(text),
    attachments,
    notification: callbackId ? "\u041F\u0440\u0438\u043D\u044F\u0442\u043E" : null
  };
}
function targetOf(update) {
  if (update.type === "message_callback") return { chatId: update.chatId, userId: update.userId, callbackId: update.callbackId };
  if (update.type === "bot_started") return { chatId: update.chatId, userId: update.userId, callbackId: null };
  return { chatId: update.chatId, userId: update.userId, callbackId: null };
}
async function startChoice(update, tx, deps) {
  const target = targetOf(update);
  await tx.putSession(
    update.userId,
    { step: "choose_product", productId: null, draftText: null, authorName: null, expiresAt: expiresAt(deps) },
    deps.now().toISOString()
  );
  return [job(target, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043A\u043D\u043E\u043F\u043A\u043E\u0439. \u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u043C\u043E\u0436\u043D\u043E \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \xAB\u041E\u0442\u043C\u0435\u043D\u0430\xBB \u0438\u043B\u0438 \u043A\u043E\u043C\u0430\u043D\u0434\u043E\u0439 /cancel.", productKeyboard(0))];
}
async function rememberProduct(update, tx, deps, productId) {
  const target = targetOf(update);
  await tx.putSession(
    update.userId,
    { step: "enter_text", productId, draftText: null, authorName: null, expiresAt: expiresAt(deps) },
    deps.now().toISOString()
  );
  return [job(target, "\u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043E\u0442\u0437\u044B\u0432\u0430 \u043E\u0434\u043D\u0438\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C, \u0431\u0435\u0437 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0439. \u041D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 2000 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432.", keyboard([cancelRow()]))];
}
async function askConsent(update, tx, deps, session, author) {
  const target = targetOf(update);
  await tx.putSession(
    update.userId,
    { ...session, step: "consent", authorName: author, expiresAt: expiresAt(deps) },
    deps.now().toISOString()
  );
  return [
    job(
      target,
      "\u0422\u0435\u043A\u0441\u0442 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 SILKWAY \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u043C. \u0411\u0435\u0437 \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u044F \u043E\u043D \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0438 \u043D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u0443\u0435\u0442\u0441\u044F. \u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0442\u0430\u043A\u0443\u044E \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044E?",
      consentKeyboard()
    )
  ];
}
function assertReviewPolicy() {
  if (contentHandlers.review.publication !== "explicit-consent-and-moderator") throw new Error("unsupported_publication_policy");
  if (contentHandlers.review.permission !== "dialog-participant") throw new Error("unsupported_permission");
  if (contentHandlers.review.acceptsAttachments) throw new Error("unsupported_attachments");
}
async function planCommand(update, tx, deps, name, arg) {
  const target = targetOf(update);
  if (name === "/cancel") {
    await tx.deleteSession(update.userId);
    return [job(target, "\u0421\u0446\u0435\u043D\u0430\u0440\u0438\u0439 \u043E\u0442\u043C\u0435\u043D\u0451\u043D. \u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u0443\u0434\u0430\u043B\u0451\u043D \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D.")];
  }
  if (name === "/start") {
    await tx.deleteSession(update.userId);
    return [job(target, HELP)];
  }
  if (name === "/review") return startChoice(update, tx, deps);
  if (name === "/reviews_pending" || name === "/review_approve" || name === "/review_reject") {
    return moderate(update, tx, deps, name, arg);
  }
  return [job(target, "\u0422\u0430\u043A\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F. \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B /start, /review \u0438 /cancel.")];
}
function attachmentSummary(items) {
  const images = items.filter((item) => item.type === "image").length;
  const videos = items.filter((item) => item.type === "video").length;
  const other = items.filter((item) => item.type === "unsupported").length;
  if (images + videos + other === 0) return "\u043D\u0435\u0442";
  return `image ${images}, video ${videos}, other ${other}`;
}
function commandTarget(arg) {
  if (!arg) return { id: null, productId: null };
  const [head, productId] = arg.trim().split(/\s+/);
  return { id: reviewId(head ?? null), productId: productId ?? null };
}
async function moderate(update, tx, deps, name, arg) {
  const target = targetOf(update);
  if (!deps.moderatorsConfigured || !deps.moderators.has(update.userId)) {
    deps.log.info("moderation_denied", { configured: deps.moderatorsConfigured });
    return [job(target, "\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430.")];
  }
  if (name === "/reviews_pending") {
    const group2 = await tx.listPendingGroup(3);
    const rows = await tx.listPending(3);
    if (group2.length === 0 && rows.length === 0) return [job(target, "\u041D\u0435\u0442 \u043E\u0442\u0437\u044B\u0432\u043E\u0432, \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0438\u0445 \u0440\u0435\u0448\u0435\u043D\u0438\u044F.")];
    const jobs = group2.map(
      (row) => job(
        target,
        [
          "\u0413\u0440\u0443\u043F\u043F\u0430, \u043E\u0436\u0438\u0434\u0430\u0435\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F",
          `id: ${row.id}`,
          `\u0447\u0430\u0442: ${row.chatId}`,
          `\u0432\u043B\u043E\u0436\u0435\u043D\u0438\u044F: ${attachmentSummary(row.attachments)}`,
          "\u0442\u0435\u043A\u0441\u0442:",
          row.publicText ?? "\u043D\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u0430"
        ].join("\n")
      )
    );
    jobs.push(
      ...rows.map((row) => {
        const product = findProduct(row.productId);
        return job(
          target,
          ["\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u0440\u0435\u0448\u0435\u043D\u0438\u044F", `id: ${row.id}`, `\u0442\u043E\u0432\u0430\u0440: ${product?.name ?? row.productId}`, `\u0438\u043C\u044F: ${row.author ?? "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E"}`, "\u0442\u0435\u043A\u0441\u0442:", row.text].join("\n")
        );
      })
    );
    const total = await tx.countPending() + group2.length;
    if (total > jobs.length) jobs.push(job(target, "\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u043F\u0435\u0440\u0432\u044B\u0435 \u0437\u0430\u043F\u0438\u0441\u0438. \u041F\u043E\u0441\u043B\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u044F \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 /reviews_pending."));
    return jobs;
  }
  const { id, productId } = commandTarget(arg);
  if (!id) return [job(target, "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440.")];
  if (name === "/review_reject") {
    const dialog = await tx.decide(id, "rejected", update.userId, deps.now().toISOString());
    if (dialog === "updated") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D.")];
    if (dialog === "not_pending") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D.")];
    const group2 = await tx.rejectGroup(id);
    if (group2 === "rejected") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D.")];
    return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D.")];
  }
  if (productId) {
    if (!findProduct(productId)) return [job(target, "\u042D\u0442\u043E\u0442 \u0442\u043E\u0432\u0430\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0435.")];
    const published = await tx.publishGroupReview(id, productId, update.userId, deps.now().toISOString());
    if (published === "published") {
      return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u043D\u0430 \u0441\u0430\u0439\u0442\u0435. \u041C\u0435\u0434\u0438\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0432 \u0437\u0430\u043F\u0438\u0441\u0438 \u0433\u0440\u0443\u043F\u043F\u044B \u0438 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0435 \u0432\u044B\u0432\u043E\u0434\u0438\u0442\u0441\u044F.")];
    }
    if (published === "needs_text") return [job(target, "\u0423 \u043E\u0442\u0437\u044B\u0432\u0430 \u043D\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u0430 \u0434\u043B\u044F \u0441\u0430\u0439\u0442\u0430. \u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0431\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430 \u043D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u0443\u0435\u0442\u0441\u044F.")];
    if (published === "too_long") return [job(target, "\u0422\u0435\u043A\u0441\u0442 \u0434\u043B\u0438\u043D\u043D\u0435\u0435 2000 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432. \u041F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044F \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430.")];
    if (published === "not_pending") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D.")];
  }
  const result = await tx.decide(id, "published", update.userId, deps.now().toISOString());
  if (result === "updated") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u043D\u0430 \u0441\u0430\u0439\u0442\u0435.")];
  if (result === "not_pending") return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D.")];
  const group = await tx.listPendingGroup(20);
  if (group.some((item) => item.id === id)) return [job(target, "\u0414\u043B\u044F \u043E\u0442\u0437\u044B\u0432\u0430 \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B \u0443\u043A\u0430\u0436\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440: /review_approve <id> <productId>.")];
  return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0438\u043B\u0438 \u0443\u0436\u0435 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D.")];
}
async function planMessage(update, tx, deps) {
  const target = targetOf(update);
  const command = update.text == null ? null : parseCommand(update.text);
  if (command) return planCommand(update, tx, deps, command.name, command.arg);
  if (update.hasAttachments && !contentHandlers.review.acceptsAttachments) {
    return [job(target, "\u0412 \u044D\u0442\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435\u043A\u0441\u0442, \u0431\u0435\u0437 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0439. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u0442\u0435\u043A\u0441\u0442\u043E\u043C \u0438\u043B\u0438 /cancel.")];
  }
  const found = await tx.getSession(update.userId, deps.now().toISOString());
  if (found.status === "expired") return [job(target, "\u0412\u0440\u0435\u043C\u044F \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u044F \u0432\u044B\u0448\u043B\u043E. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E.")];
  if (found.status === "none") return [job(target, "\u0427\u0442\u043E\u0431\u044B \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043E\u0442\u0437\u044B\u0432, \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u043A\u043E\u043C\u0430\u043D\u0434\u0443 /review.")];
  if (update.text == null) return [job(target, "\u0422\u0435\u043A\u0441\u0442 \u043E\u0442\u0437\u044B\u0432\u0430 \u043F\u0443\u0441\u0442\u043E\u0439 \u0438\u043B\u0438 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B. \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u0441\u043B\u043E\u0432\u0430\u043C\u0438.")];
  const session = found.session;
  if (session.step === "choose_product") {
    const product = findProduct(update.text.trim());
    if (!product) return [job(target, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430.", productKeyboard(0))];
    return rememberProduct(update, tx, deps, product.id);
  }
  if (session.step === "enter_text") {
    const parsed = reviewText(update.text);
    if (!parsed.ok && parsed.reason === "too_long") {
      return [job(target, "\u0422\u0435\u043A\u0441\u0442 \u0434\u043B\u0438\u043D\u043D\u0435\u0435 2000 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432. \u0421\u043E\u043A\u0440\u0430\u0442\u0438\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.")];
    }
    if (!parsed.ok) return [job(target, "\u0422\u0435\u043A\u0441\u0442 \u043E\u0442\u0437\u044B\u0432\u0430 \u043F\u0443\u0441\u0442\u043E\u0439 \u0438\u043B\u0438 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B. \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043E\u0442\u0437\u044B\u0432 \u0441\u043B\u043E\u0432\u0430\u043C\u0438.")];
    await tx.putSession(update.userId, { ...session, step: "enter_name", draftText: parsed.text, expiresAt: expiresAt(deps) }, deps.now().toISOString());
    return [job(target, "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0438\u043C\u044F \u0434\u043B\u044F \u0441\u0430\u0439\u0442\u0430 \u0438\u043B\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041D\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0438\u043C\u044F\xBB. \u0422\u0435\u043B\u0435\u0444\u043E\u043D \u0438 \u0430\u0434\u0440\u0435\u0441 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B.", nameKeyboard())];
  }
  if (session.step === "enter_name") {
    const parsed = authorName(update.text);
    if (!parsed.ok && parsed.reason === "too_long") return [job(target, "\u0418\u043C\u044F \u0434\u043B\u0438\u043D\u043D\u0435\u0435 80 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432. \u0421\u043E\u043A\u0440\u0430\u0442\u0438\u0442\u0435 \u0435\u0433\u043E \u0438\u043B\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041D\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0438\u043C\u044F\xBB.", nameKeyboard())];
    if (!parsed.ok) return [job(target, "\u0418\u043C\u044F \u043F\u0443\u0441\u0442\u043E\u0435. \u041D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0435\u0433\u043E \u0438\u043B\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041D\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0438\u043C\u044F\xBB.", nameKeyboard())];
    return askConsent(update, tx, deps, session, parsed.text);
  }
  return [job(target, "\u041D\u0443\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \xAB\u0421\u043E\u0433\u043B\u0430\u0441\u0435\u043D \u043D\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044E\xBB \u0438\u043B\u0438 \xAB\u041D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C\xBB.", consentKeyboard())];
}
async function planCallback(update, tx, deps) {
  const target = targetOf(update);
  if (update.payload === "cancel") {
    await tx.deleteSession(update.userId);
    return [job(target, "\u0421\u0446\u0435\u043D\u0430\u0440\u0438\u0439 \u043E\u0442\u043C\u0435\u043D\u0451\u043D. \u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A \u0443\u0434\u0430\u043B\u0451\u043D \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D.", null, update.callbackId)];
  }
  const found = await tx.getSession(update.userId, deps.now().toISOString());
  if (found.status !== "active") {
    const text = found.status === "expired" ? "\u0412\u0440\u0435\u043C\u044F \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u044F \u0432\u044B\u0448\u043B\u043E. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E." : "\u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C.";
    return [job(target, text, null, update.callbackId)];
  }
  const session = found.session;
  if (update.payload.startsWith("n:")) {
    if (session.step !== "choose_product") return [job(target, "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0448\u0430\u0433 \u0438\u043B\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /cancel.", null, update.callbackId)];
    const page = Number(update.payload.slice(2));
    if (!Number.isInteger(page) || page < 0 || page > 50) return [job(target, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043A\u043D\u043E\u043F\u043A\u043E\u0439.", productKeyboard(0), update.callbackId)];
    return [job(target, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043A\u043D\u043E\u043F\u043A\u043E\u0439.", productKeyboard(page), update.callbackId)];
  }
  if (update.payload.startsWith("p:")) {
    if (session.step !== "choose_product") return [job(target, "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0435 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0448\u0430\u0433 \u0438\u043B\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /cancel.", null, update.callbackId)];
    const product = findProduct(update.payload.slice(2));
    if (!product) return [job(target, "\u042D\u0442\u043E\u0442 \u0442\u043E\u0432\u0430\u0440 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0435. \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440 \u043A\u043D\u043E\u043F\u043A\u043E\u0439.", productKeyboard(0), update.callbackId)];
    const next = await rememberProduct(update, tx, deps, product.id);
    return next.map((item, index) => index === 0 ? { ...item, kind: "callback_answer", callbackId: update.callbackId, notification: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E" } : item);
  }
  if (update.payload === "skip") {
    if (session.step !== "enter_name" || !session.draftText || !session.productId) {
      return [job(target, "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043E\u0442\u0437\u044B\u0432\u0430.", null, update.callbackId)];
    }
    const next = await askConsent(update, tx, deps, session, null);
    return next.map((item) => ({ ...item, kind: "callback_answer", callbackId: update.callbackId, notification: "\u041F\u0440\u0438\u043D\u044F\u0442\u043E" }));
  }
  if (update.payload === "yes" || update.payload === "no") {
    if (session.step !== "consent" || !session.draftText || !session.productId || !findProduct(session.productId)) {
      return [job(target, "\u0421\u0446\u0435\u043D\u0430\u0440\u0438\u0439 \u0443\u0441\u0442\u0430\u0440\u0435\u043B. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E.", null, update.callbackId)];
    }
    if (update.payload === "no") {
      await tx.deleteSession(update.userId);
      return [job(target, "\u0421\u043E\u0433\u043B\u0430\u0441\u0438\u0435 \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E. \u041E\u0442\u0437\u044B\u0432 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D.", null, update.callbackId)];
    }
    assertReviewPolicy();
    const nowIso = deps.now().toISOString();
    await tx.insertPending({
      id: randomUUID3(),
      productId: session.productId,
      text: session.draftText,
      author: session.authorName,
      receivedAt: nowIso,
      consentAt: nowIso,
      idempotencyKey: update.key,
      senderUserId: update.userId
    });
    await tx.deleteSession(update.userId);
    return [job(target, "\u041E\u0442\u0437\u044B\u0432 \u043F\u0440\u0438\u043D\u044F\u0442 \u043D\u0430 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u044E. \u041D\u0430 \u0441\u0430\u0439\u0442\u0435 \u0435\u0433\u043E \u0435\u0449\u0451 \u043D\u0435\u0442: \u043E\u043D \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u043C.", null, update.callbackId)];
  }
  return [job(target, "\u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442. \u041E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E.", null, update.callbackId)];
}
async function planReviewEvent(update, tx, deps) {
  if (update.type === "bot_started") {
    await tx.deleteSession(update.userId);
    return [job(update, HELP)];
  }
  if (update.type === "message_created") return planMessage(update, tx, deps);
  if (update.type === "message_callback") return planCallback(update, tx, deps);
  return [];
}

// server/max/secret.ts
import { createHash, timingSafeEqual } from "node:crypto";
function secretsMatch(expected, received) {
  const actual = received ?? "";
  const left = createHash("sha256").update(expected, "utf8").digest();
  const right = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(left, right);
}

// server/max/attachments.ts
var MAX_ATTACHMENTS = 12;
var MAX_MEDIA_BYTES = 20 * 1024 * 1024;
var TOKEN_MAX = 512;
function hasControl(value) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function tokenOf(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > TOKEN_MAX) return null;
  if (hasControl(trimmed)) return null;
  return trimmed;
}
function safeInt(value, max) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return null;
  return value;
}
function photoIdOf(value) {
  const id = safeInt(value, Number.MAX_SAFE_INTEGER);
  if (id == null || id <= 0) return null;
  return String(id);
}
function dimension(value) {
  const parsed = safeInt(value, 2e4);
  if (parsed == null || parsed <= 0) return null;
  return parsed;
}
function unsupported(size = null) {
  return { type: "unsupported", token: null, photoId: null, width: null, height: null, duration: null, size };
}
function readImage(payload) {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER);
  if (size != null && size > MAX_MEDIA_BYTES) return unsupported(size);
  return {
    type: "image",
    token: tokenOf(payload.token),
    photoId: photoIdOf(payload.photo_id),
    width: null,
    height: null,
    duration: null,
    size
  };
}
function readVideo(payload) {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER);
  if (size != null && size > MAX_MEDIA_BYTES) return unsupported(size);
  const duration = safeInt(payload.duration, 60 * 60);
  if (payload.duration != null && duration == null) return unsupported(size);
  return {
    type: "video",
    token: tokenOf(payload.token),
    photoId: null,
    width: dimension(payload.width),
    height: dimension(payload.height),
    duration,
    size
  };
}
function readOne(value) {
  if (!isRecord(value) || typeof value.type !== "string") return unsupported();
  const payload = isRecord(value.payload) ? value.payload : null;
  if (value.type === "image" && payload) return readImage(payload);
  if (value.type === "video" && payload) return readVideo(payload);
  return unsupported();
}
function readAttachments(value) {
  if (!Array.isArray(value)) return [];
  const stored = value.slice(0, MAX_ATTACHMENTS).map(readOne);
  if (value.length > MAX_ATTACHMENTS) stored.push(unsupported());
  return stored;
}

// server/max/update.ts
var SUPPORTED = /* @__PURE__ */ new Set(["message_created", "message_callback", "message_edited", "message_removed", "bot_started"]);
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function readId(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return String(value);
}
function readChatId(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value === 0) return null;
  return String(value);
}
function readTimestamp(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return String(value);
}
function isChatType(value) {
  return value === "dialog" || value === "chat" || value === "channel";
}
function bounded(value, max = 300) {
  if (value.length === 0 || value.length > max) return null;
  return value;
}
function parseUpdate(value) {
  if (!isRecord2(value) || typeof value.update_type !== "string") return { action: "reject" };
  if (!SUPPORTED.has(value.update_type)) return { action: "ignore" };
  const timestamp = readTimestamp(value.timestamp);
  if (!timestamp) return { action: "reject" };
  if (value.update_type === "bot_started") return parseStarted(value, timestamp);
  if (value.update_type === "message_removed") return parseRemoved(value, timestamp);
  if (value.update_type === "message_created" || value.update_type === "message_edited") {
    return parseMessage(value, timestamp, value.update_type);
  }
  return parseCallback(value, timestamp);
}
function parseStarted(value, timestamp) {
  const chatId = readChatId(value.chat_id);
  if (!isRecord2(value.user)) return { action: "reject" };
  if (value.user.is_bot === true) return { action: "ignore" };
  const userId = readId(value.user.user_id);
  if (!chatId || !userId) return { action: "reject" };
  return { action: "accept", update: { type: "bot_started", key: `bot_started:${timestamp}:${chatId}:${userId}`, chatId, userId } };
}
function parseRemoved(value, timestamp) {
  const chatId = readChatId(value.chat_id);
  const userId = readId(value.user_id);
  const messageMid = typeof value.message_id === "string" ? bounded(value.message_id) : readId(value.message_id);
  if (!chatId || !userId || !messageMid) return { action: "reject" };
  return {
    action: "accept",
    update: {
      type: "message_removed",
      key: `message_removed:${timestamp}:${chatId}:${messageMid}`,
      userId,
      chatId,
      messageMid
    }
  };
}
function parseMessage(value, timestamp, type) {
  if (!isRecord2(value.message)) return { action: "reject" };
  const message = value.message;
  if (message.sender == null) return { action: "ignore" };
  if (!isRecord2(message.sender)) return { action: "reject" };
  if (message.sender.is_bot === true) return { action: "ignore" };
  const userId = readId(message.sender.user_id);
  if (!userId) return { action: "reject" };
  if (!isRecord2(message.recipient) || !isChatType(message.recipient.chat_type)) return { action: "reject" };
  if (!isRecord2(message.body) || typeof message.body.mid !== "string") return { action: "reject" };
  const mid = bounded(message.body.mid);
  if (!mid) return { action: "reject" };
  const text = typeof message.body.text === "string" ? message.body.text : null;
  const rawAttachments = message.body.attachments;
  const attachments = readAttachments(rawAttachments);
  const hasAttachments = attachments.length > 0 || rawAttachments != null && !Array.isArray(rawAttachments);
  return {
    action: "accept",
    update: {
      type,
      key: `${type}:${timestamp}:${mid}`,
      userId,
      messageMid: mid,
      chatId: readChatId(message.recipient.chat_id),
      chatType: message.recipient.chat_type,
      text,
      hasAttachments,
      attachments
    }
  };
}
function parseCallback(value, timestamp) {
  if (!isRecord2(value.callback)) return { action: "reject" };
  if (!isRecord2(value.callback.user)) return { action: "reject" };
  if (value.callback.user.is_bot === true) return { action: "ignore" };
  const userId = readId(value.callback.user.user_id);
  const callbackId = typeof value.callback.callback_id === "string" ? bounded(value.callback.callback_id) : null;
  if (!userId || !callbackId) return { action: "reject" };
  const payload = typeof value.callback.payload === "string" ? value.callback.payload.slice(0, 1024) : "";
  if (value.message == null) {
    return {
      action: "accept",
      update: {
        type: "message_callback",
        key: `message_callback:${timestamp}:${callbackId}`,
        userId,
        chatId: null,
        chatType: null,
        callbackId,
        payload
      }
    };
  }
  if (!isRecord2(value.message) || !isRecord2(value.message.recipient) || !isChatType(value.message.recipient.chat_type)) {
    return { action: "reject" };
  }
  return {
    action: "accept",
    update: {
      type: "message_callback",
      key: `message_callback:${timestamp}:${callbackId}`,
      userId,
      chatId: readChatId(value.message.recipient.chat_id),
      chatType: value.message.recipient.chat_type,
      callbackId,
      payload
    }
  };
}
function isPrivateDialog(update) {
  if (update.type === "bot_started") return true;
  if (update.type === "message_removed" || update.type === "message_edited") return false;
  return update.chatType === "dialog";
}

// server/max/webhookHandler.ts
function shouldDeferGroup(update, deps) {
  return update.type === "message_created" && update.chatType === "chat" && update.chatId != null && deps.allowedChatsConfigured && deps.allowedChatIds.has(update.chatId);
}
async function handleMaxWebhook(request, deps) {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "POST" });
  if (!deps.secretConfigured || !deps.secret || !secretsMatch(deps.secret, request.headers.get("x-max-bot-api-secret"))) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  const body = await readLimitedJson(request);
  if (!body.ok) return jsonResponse(body.status, { error: body.status === 413 ? "payload_too_large" : "bad_request" });
  const parsed = parseUpdate(body.value);
  if (parsed.action === "reject") {
    deps.log.info("invalid_update");
    return jsonResponse(400, { error: "bad_request" });
  }
  if (parsed.action === "ignore") return jsonResponse(200, { ok: true });
  if (!deps.store || !deps.max) {
    deps.log.error("storage_failed");
    return jsonResponse(503, { error: "unavailable" });
  }
  const update = parsed.update;
  const store = deps.store;
  const max = deps.max;
  if (isGroupTraffic(update)) {
    try {
      await store.transaction(async (tx) => {
        if (shouldDeferGroup(update, deps)) {
          const existing = await tx.findGroupMessage(update.chatId, update.messageMid);
          if (!existing) {
            const since = new Date(deps.now().getTime() - deps.groupRateLimit.windowMs).toISOString();
            const count = await tx.countGroupMessages(update.chatId, since);
            if (count >= deps.groupRateLimit.max) throw new IntakeDeferred();
          }
        }
        const claim = await tx.claim(update.key, update.type);
        if (claim === "duplicate") return;
        await planGroupUpdate(update, tx, deps);
      });
    } catch (error) {
      if (error instanceof IntakeDeferred) {
        deps.log.info("group_deferred");
        return jsonResponse(503, { error: "unavailable" });
      }
      deps.log.error("storage_failed");
      return jsonResponse(503, { error: "unavailable" });
    }
    return jsonResponse(200, { ok: true });
  }
  if (update.type === "message_edited") {
    try {
      await store.transaction(async (tx) => {
        await tx.claim(update.key, update.type);
      });
    } catch {
      deps.log.error("storage_failed");
      return jsonResponse(503, { error: "unavailable" });
    }
    return jsonResponse(200, { ok: true });
  }
  try {
    await store.transaction(async (tx) => {
      const claim = await tx.claim(update.key, update.type);
      if (claim === "duplicate") return;
      if (!isPrivateDialog(update)) return;
      const nowIso = deps.now().toISOString();
      await tx.pruneActions(new Date(deps.now().getTime() - 24 * 60 * 60 * 1e3).toISOString());
      const since = new Date(deps.now().getTime() - deps.rateLimit.windowMs).toISOString();
      const count = await tx.countActions(update.userId, since);
      if (count >= deps.rateLimit.max) {
        await tx.recordAction(update.userId, nowIso);
        const callbackId = update.type === "message_callback" ? update.callbackId : null;
        await tx.enqueue(update.key, [
          {
            kind: callbackId ? "callback_answer" : "message",
            chatId: update.chatId,
            userId: update.userId,
            callbackId,
            text: "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u044C\u0442\u0435 /review \u0441\u043D\u043E\u0432\u0430.",
            attachments: null,
            notification: callbackId ? "\u041F\u0440\u0438\u043D\u044F\u0442\u043E" : null
          }
        ]);
        return;
      }
      await tx.recordAction(update.userId, nowIso);
      const jobs = await planReviewEvent(update, tx, deps);
      await tx.enqueue(update.key, jobs);
    });
  } catch {
    deps.log.error("storage_failed");
    return jsonResponse(503, { error: "unavailable" });
  }
  try {
    const pending = await store.listPendingOutbox(update.key);
    const delivery = await deliverOutbox(pending, store, max, deps.log, deps.now, deps.sleep, deps.deliveryBudgetMs);
    if (delivery === "retry") return jsonResponse(503, { error: "unavailable" });
  } catch {
    deps.log.error("storage_failed");
    return jsonResponse(503, { error: "unavailable" });
  }
  return jsonResponse(200, { ok: true });
}

// server/entries/webhook.ts
var webhook_default = {
  async fetch(request) {
    return handleMaxWebhook(request, productionDeps());
  }
};
export {
  webhook_default as default
};
