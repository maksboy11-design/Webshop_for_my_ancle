import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

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
var ALLOWED = /* @__PURE__ */ new Set(["status", "updateType", "duplicate", "configured", "kind", "allowed", "attachments", "errorClass", "chatType", "chatSign", "notified", "apiCode", "apiMessage", "webApp"]);
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
function outgoingAttachments(keyboard) {
  if (!keyboard) return [];
  const out = [];
  for (const item of keyboard.media ?? []) {
    if (item.type === "image" && item.url) out.push({ type: "image", payload: { url: item.url } });
    else if (item.type === "image" && item.token) out.push({ type: "image", payload: { token: item.token } });
    else if (item.type === "video" && item.token) out.push({ type: "video", payload: { token: item.token } });
  }
  out.push({ type: "inline_keyboard", payload: keyboard.payload });
  return out;
}
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
  /** Безопасные поля ошибки MAX (code/message), без токенов и текста пользователя. */
  apiCode = null;
  apiMessage = null;
  constructor(status) {
    super("max_permanent");
    this.name = "MaxPermanentError";
    this.status = status;
  }
};
function safeApiField(value, max) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\p{L}\p{N} _.:,()'"/-]/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}
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
  let errorBody;
  try {
    errorBody = JSON.parse(await response.text());
  } catch {
    errorBody = null;
  }
  if (response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new MaxTemporaryError(response.status);
  }
  const error = new MaxPermanentError(response.status);
  if (errorBody && typeof errorBody === "object") {
    error.apiCode = safeApiField(errorBody.code, 80);
    error.apiMessage = safeApiField(errorBody.message, 200);
  }
  throw error;
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
  async function getJson(url) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(2500),
        headers: { authorization: token, accept: "application/json" }
      });
      if (!response.ok) {
        await response.arrayBuffer().catch(() => void 0);
        if (response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new MaxTemporaryError(response.status);
        }
        return null;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json")) {
        await response.arrayBuffer().catch(() => void 0);
        return null;
      }
      return await response.json();
    } catch (error) {
      if (error instanceof MaxTemporaryError || error instanceof MaxPermanentError) throw error;
      throw new MaxTemporaryError(0);
    }
  }
  let botUsername = null;
  return {
    getBotUsername() {
      botUsername ??= getJson(endpoint("/me", new URLSearchParams())).then((me) => {
        const name = me && typeof me === "object" ? me.username : null;
        return typeof name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? name : null;
      }).catch(() => {
        botUsername = null;
        return null;
      });
      return botUsername;
    },
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
        ...attachments ? { attachments: outgoingAttachments(attachments) } : {}
      });
    },
    async answerCallback({ callbackId, text, attachments, notification }) {
      if (!callbackId.trim()) throw new MaxPermanentError(400);
      const params = new URLSearchParams({ callback_id: callbackId, disable_link_preview: "true" });
      const body = {};
      if (notification) body.notification = notification;
      if (text) body.message = { text, ...attachments ? { attachments: [{ type: "inline_keyboard", payload: attachments.payload }] } : {} };
      await post(endpoint("/answers", params), body);
    },
    async getMessage(messageMid) {
      const mid = messageMid.trim();
      if (!mid || mid.length > 300) throw new MaxPermanentError(400);
      const params = new URLSearchParams({ message_ids: mid });
      const payload = await getJson(endpoint("/messages", params));
      if (!payload || typeof payload !== "object") return null;
      const messages = "messages" in payload && Array.isArray(payload.messages) ? payload.messages : null;
      const first = messages?.[0];
      if (!first || typeof first !== "object") return null;
      const body = "body" in first && first.body && typeof first.body === "object" ? first.body : null;
      if (!body) return null;
      return { attachments: "attachments" in body ? body.attachments : null };
    }
  };
}

// server/max/postgresStore.ts
import { randomUUID } from "node:crypto";

// server/max/mediaHosts.ts
function isAllowedPublicMediaSrc(value) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === "blob.vercel-storage.com" || host.endsWith(".blob.vercel-storage.com");
}

// server/max/attachments.ts
var MAX_MEDIA_BYTES = 20 * 1024 * 1024;
function publicMediaOf(items) {
  const media = [];
  for (const item of items) {
    if (item.type !== "image" && item.type !== "video" || !item.persistedSrc) continue;
    media.push({
      type: item.type,
      src: item.persistedSrc,
      poster: null,
      alt: null,
      ...item.type === "image" && item.thumbnailSrc ? { thumbnailSrc: item.thumbnailSrc } : {}
    });
  }
  return media;
}

// server/max/text.ts
var REVIEW_TEXT_MAX = 2e3;
var CONTROLS = new RegExp(`[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]`);
function codePointLength(value) {
  return Array.from(value).length;
}

// server/max/youtubeImport.ts
var YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
function blocksPublication(status) {
  return status === "not_found" || status === "not_public";
}

// server/max/webinars.ts
var BLOB_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.blob\.vercel-storage\.com$/;
function isAllowedRecordingSrc(src) {
  if (!src) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && BLOB_HOST.test(url.hostname);
  } catch {
    return false;
  }
}
function publishCheck(record) {
  if (record.status !== "pending") return "not_pending";
  if (!record.title || record.title.trim().length === 0) return "needs_title";
  if (record.sourceType === "youtube") {
    if (!record.youtubeVideoId || !YOUTUBE_ID.test(record.youtubeVideoId) || record.recordingSrc) return "blocked_source";
    if (blocksPublication(record.metadataStatus)) return "blocked_source";
    return null;
  }
  if (!isAllowedRecordingSrc(record.recordingSrc)) return "blocked_source";
  return null;
}
function toPublicWebinar(record) {
  if (record.status !== "published" || record.withdrawnAt != null || !record.title) return null;
  if (record.sourceType === "youtube" && (!record.youtubeVideoId || !YOUTUBE_ID.test(record.youtubeVideoId))) return null;
  if (record.sourceType === "hosted" && !isAllowedRecordingSrc(record.recordingSrc)) return null;
  return {
    id: record.id,
    title: record.title,
    speaker: record.speaker,
    date: record.eventDate,
    sourceType: record.sourceType,
    youtubeVideoId: record.sourceType === "youtube" ? record.youtubeVideoId : null,
    startSeconds: record.sourceType === "youtube" ? record.startSeconds : null,
    recordingSrc: record.sourceType === "hosted" ? record.recordingSrc : null
  };
}
function newWebinarRecord(input, nowIso) {
  return {
    ...input,
    status: "pending",
    updatedAt: nowIso,
    publishedAt: null,
    withdrawnAt: null,
    moderatorUserId: null
  };
}
function reopenedRecord(existing, input, nowIso) {
  return {
    ...existing,
    title: input.title,
    speaker: input.speaker,
    eventDate: input.eventDate,
    startSeconds: input.startSeconds,
    youtubeTitle: input.youtubeTitle,
    youtubePublishedAt: input.youtubePublishedAt,
    metadataStatus: input.metadataStatus,
    contentId: input.contentId,
    sourceChatId: input.sourceChatId,
    sourceMessageMid: input.sourceMessageMid,
    status: "pending",
    updatedAt: nowIso,
    publishedAt: null,
    withdrawnAt: null,
    moderatorUserId: null
  };
}

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
  formUnavailable: "\u0424\u043E\u0440\u043C\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430 \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.",
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

// src/data/priceList.ts
var PRICE_LIST = [
  { id: "MF01", name: "\u0413\u0435\u043B\u044C \u0441 \u043C\u043D\u043E\u0433\u043E\u0441\u0442\u043E\u0440\u043E\u043D\u043D\u0438\u043C \u044D\u0444\u0444\u0435\u043A\u0442\u043E\u043C \u0434\u043B\u044F \u0443\u0445\u043E\u0434\u0430 \u0437\u0430 \u043A\u043E\u0436\u0435\u0439 \u0427\u0436\u0438\u0446\u0443 \u0434\u043B\u044F \u043B\u0438\u0446\u0430", pv: 42, bv: 100, rub: 3528 },
  { id: "MF02", name: "\u0426\u0437\u0438\u043D\u0438\u043D \u0421\u044F\u043D\u0446\u0437\u044D \u043A\u0440\u0435\u043C \u0434\u043B\u044F \u0443\u043F\u0440\u0443\u0433\u043E\u0441\u0442\u0438 \u0438 \u0443\u0432\u0435\u043B\u0438\u0447\u0435\u043D\u0438\u044F \u043F\u043B\u043E\u0442\u043D\u043E\u0441\u0442\u0438 \u043A\u043E\u0436\u0438 \u0434\u043B\u044F \u0442\u0435\u043B\u0430", pv: 48, bv: 100, rub: 4032 },
  { id: "MF03", name: "\u0423\u0441\u043F\u043E\u043A\u0430\u0438\u0432\u0430\u044E\u0449\u0435\u0435 \u043C\u0430\u0441\u0441\u0430\u0436\u043D\u043E\u0435 \u0431\u0430\u0437\u043E\u0432\u043E\u0435 \u043C\u0430\u0441\u043B\u043E \u0427\u0436\u0438\u0446\u0443\u0439 \u0434\u043B\u044F \u0442\u0435\u043B\u0430", pv: 30, bv: 100, rub: 2520 },
  { id: "MF04", name: "\u042D\u0441\u0441\u0435\u043D\u0446\u0438\u044F \u0434\u043B\u044F \u043F\u0438\u0442\u0430\u043D\u0438\u044F \u0438 \u0443\u0445\u043E\u0434\u0430 \u0437\u0430 \u043A\u043E\u0436\u0435\u0439 \u0438\u0437 \u0436\u0438\u0432\u044B\u0445 \u0434\u0440\u043E\u0436\u0436\u0435\u0439 \u0434\u043B\u044F \u043B\u0438\u0446\u0430", pv: 35, bv: 100, rub: 2940 },
  { id: "MF05", name: "\u0423\u0432\u043B\u0430\u0436\u043D\u044F\u044E\u0449\u0438\u0439 \u043B\u043E\u0441\u044C\u043E\u043D \u0441 \u0433\u0438\u0430\u043B\u0443\u0440\u043E\u043D\u043E\u0432\u043E\u0439 \u043A\u0438\u0441\u043B\u043E\u0442\u043E\u0439 \u0434\u043B\u044F \u043B\u0438\u0446\u0430", pv: 35, bv: 100, rub: 2940 },
  { id: "MF06", name: "\u041F\u0440\u0438\u0434\u0430\u044E\u0449\u0435\u0435 \u0441\u0438\u044F\u043D\u0438\u0435 \u043A\u043E\u0436\u0435 \u043E\u0447\u0438\u0449\u0430\u044E\u0449\u0435\u0435 \u043C\u043E\u043B\u043E\u0447\u043A\u043E \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 22, bv: 100, rub: 1848 },
  { id: "MF07", name: "\u041F\u0440\u0438\u0434\u0430\u044E\u0449\u0438\u0439 \u0441\u0438\u044F\u043D\u0438\u0435 \u043A\u043E\u0436\u0435 \u043F\u0438\u0442\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0442\u043E\u043D\u0438\u043A \u0434\u043B\u044F \u043B\u0438\u0446\u0430 \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 30, bv: 100, rub: 2520 },
  { id: "MF08", name: "\u041F\u0440\u0438\u0434\u0430\u044E\u0449\u0430\u044F \u0441\u0438\u044F\u043D\u0438\u0435 \u043A\u043E\u0436\u0435 \u0443\u0432\u043B\u0430\u0436\u043D\u044F\u044E\u0449\u0430\u044F \u044D\u043C\u0443\u043B\u044C\u0441\u0438\u044F \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 30, bv: 100, rub: 2520 },
  { id: "MF12", name: "\u0422\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u0440\u0435\u043C", pv: 40, bv: 100, rub: 3360 },
  { id: "MF13", name: "\u041B\u0438\u0444\u0442\u0438\u043D\u0433-\u043C\u0430\u0441\u043A\u0430 \u0434\u043B\u044F \u043B\u0438\u0446\u0430 JILANZHI", pv: 10, bv: 100, rub: 840 },
  { id: "MF14", name: "\u041B\u0438\u0444\u0442\u0438\u043D\u0433 \u043A\u0440\u0435\u043C \u0434\u043B\u044F \u0432\u0435\u043A \u0441 \u0440\u0430\u0441\u0442\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C\u0438 \u0444\u0435\u0440\u043C\u0435\u043D\u0442\u0430\u043C\u0438 \u043F\u0440\u043E\u0442\u0438\u0432 \u043C\u043E\u0440\u0449\u0438\u043D", pv: 42, bv: 100, rub: 3528 },
  { id: "MF15", name: "\u0421\u043F\u0440\u0435\u0439 \u0441 \u0433\u0438\u0434\u0440\u043E\u0437\u043E\u043B\u0435\u043C \u0440\u043E\u0437\u044B", pv: 20, bv: 100, rub: 1680 },
  { id: "RH06", name: "\u0414\u043D\u0435\u0432\u043D\u044B\u0435 \u0433\u0438\u0433\u0438\u0435\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0440\u043E\u043A\u043B\u0430\u0434\u043A\u0438 \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 7, bv: 100, rub: 588 },
  { id: "RH07", name: "\u041D\u043E\u0447\u043D\u044B\u0435 \u0433\u0438\u0433\u0438\u0435\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0440\u043E\u043A\u043B\u0430\u0434\u043A\u0438 \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 7, bv: 100, rub: 588 },
  { id: "RH08", name: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u0433\u0438\u0433\u0438\u0435\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0440\u043E\u043A\u043B\u0430\u0434\u043A\u0438 \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB", pv: 9, bv: 100, rub: 756 },
  { id: "RH11", name: "\u0410\u0440\u043C\u0430\u0442\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043F\u043B\u0430\u0441\u0442\u0438\u043D\u044B \u0434\u043B\u044F \u0441\u0442\u0438\u0440\u043A\u0438", pv: 13, bv: 100, rub: 1092 },
  { id: "RH12", name: "\u0417\u0443\u0431\u043D\u0430\u044F \u043F\u0430\u0441\u0442\u0430 \u0441 \u043F\u0440\u043E\u0431\u0438\u043E\u0442\u0438\u043A\u043E\u043C", pv: 10, bv: 100, rub: 840 },
  { id: "RH13", name: "\u041A\u043E\u043D\u0434\u0438\u0446\u0438\u043E\u043D\u0435\u0440 \u0434\u043B\u044F \u0432\u043E\u043B\u043E\u0441 \u0441 \u043C\u0430\u0441\u043B\u043E\u043C \u0410\u0440\u0433\u0430\u043D\u044B", pv: 10, bv: 100, rub: 840 },
  { id: "RH26", name: "\u041A\u0438\u0441\u043B\u043E\u0440\u043E\u0434\u043D\u044B\u0439 \u043F\u0443\u0437\u044B\u0440\u044C \u0441 \u043C\u0443\u043B\u044C\u0442\u0438\u044D\u0444\u0444\u0435\u043A\u0442\u043E\u043C", pv: 13, bv: 100, rub: 1092 },
  { id: "RH28", name: "\u0418\u043D\u0442\u0438\u043C\u043D\u044B\u0439 \u0433\u0435\u043B\u044C", pv: 3, bv: 100, rub: 252 },
  { id: "RH29", name: "\u0423\u0432\u043B\u0430\u0436\u043D\u044F\u044E\u0449\u0438\u0439 \u0438 \u043F\u0438\u0442\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0433\u0435\u043B\u044C \u0434\u043B\u044F \u0434\u0443\u0448\u0430", pv: 11, bv: 100, rub: 924 },
  { id: "RH30", name: "\u0423\u0432\u043B\u0430\u0436\u043D\u044F\u044E\u0449\u0438\u0439 \u0438 \u043F\u0438\u0442\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043A\u0440\u0435\u043C \u0434\u043B\u044F \u0432\u043E\u043B\u043E\u0441", pv: 11, bv: 100, rub: 924 },
  { id: "RH31", name: "\u041E\u0447\u0438\u0449\u0430\u044E\u0449\u0438\u0439 \u043F\u0443\u0448\u0438\u0441\u0442\u044B\u0439 \u0448\u0430\u043C\u043F\u0443\u043D\u044C \u0441 \u043C\u0430\u0441\u043B\u043E\u043C", pv: 11, bv: 100, rub: 924 },
  { id: "RH32", name: "\u041E\u0441\u0432\u0435\u0436\u0430\u044E\u0449\u0438\u0439 \u0448\u0430\u043C\u043F\u0443\u043D\u044C \u043F\u0440\u043E\u0442\u0438\u0432 \u043F\u0435\u0440\u0445\u043E\u0442\u0438", pv: 11, bv: 100, rub: 924 },
  { id: "BS01", name: "\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u043D\u044B\u0439 \u043D\u0430\u043F\u0438\u0442\u043E\u043A \u0441 \u0441\u043E\u0441\u0441\u043E\u0440\u0435\u0435\u0439 \u041F\u043B\u044E\u0441 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 50, bv: 100, rub: 4200 },
  { id: "BS02", name: "\u0420\u0430\u0441\u0442\u0432\u043E\u0440\u0438\u043C\u044B\u0439 \u043D\u0430\u043F\u0438\u0442\u043E\u043A \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 70, bv: 100, rub: 5880 },
  { id: "BS04", name: "\u041A\u0430\u043F\u0441\u0443\u043B\u044B \u043A\u043E\u0440\u0434\u0438\u0446\u0435\u043F\u0441\u0430 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 40, bv: 100, rub: 3360 },
  { id: "BS05", name: "\u041A\u0430\u043F\u0441\u0443\u043B\u044B \u0425\u0438\u0442\u043E\u0437\u0430\u043D \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 36, bv: 100, rub: 3024 },
  { id: "BS06", name: "\u0422\u0430\u0431\u043B\u0435\u0442\u043A\u0438 \u0426\u0438\u043D\u043A \u0411\u0430\u043E \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 25, bv: 100, rub: 2100 },
  { id: "BS07", name: "\u041C\u044F\u0433\u043A\u0438\u0435 \u043A\u0430\u043F\u0441\u0443\u043B\u044B \u043A\u0430\u043B\u044C\u0446\u0438\u0439 \u0441 \u0432\u0438\u0442\u0430\u043C\u0438\u043D\u043E\u043C D \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 33, bv: 100, rub: 2772 },
  { id: "BS08", name: "\u0416\u0435\u043B\u0435\u0437\u043E \u0432 \u043A\u0430\u043F\u0441\u0443\u043B\u0430\u0445 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 31, bv: 100, rub: 2604 },
  { id: "BS09", name: "\u0427\u0430\u0439 \u0432 \u043F\u0430\u043A\u0435\u0442\u0438\u043A\u0430\u0445 \xAB\u0427\u0435\u0442\u044B\u0440\u0435 \u0441\u0435\u0437\u043E\u043D\u0430\xBB \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 24, bv: 100, rub: 2016 },
  { id: "BS14", name: "\u041F\u0440\u043E\u0431\u0438\u043E\u0442\u0438\u043A \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 60, bv: 100, rub: 5040 },
  { id: "BS27", name: "\u041A\u043E\u0444\u0435 \u0441 \u043A\u043E\u043B\u043B\u0430\u0433\u0435\u043D\u043E\u0432\u044B\u043C \u043F\u0435\u043F\u0442\u0438\u0434\u043E\u043C \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB", pv: 30, bv: 80, rub: 2520 },
  { id: "MY03", name: "\u041A\u043E\u0441\u043C\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0430\u043F\u043F\u0430\u0440\u0430\u0442 1 \u0448\u0442. + \u0442\u0438\u0442\u0430\u043D\u043E\u0432\u0430\u044F \u043D\u0430\u0441\u0430\u0434\u043A\u0430 1 \u0448\u0442", pv: 350, bv: 100, rub: 29400 },
  { id: "MY04", name: "\u041C\u0430\u0441\u0441\u0430\u0436\u0435\u0440 \u0434\u043B\u044F \u0448\u0435\u0438 SKG", pv: 130, bv: 80, rub: 10920 },
  { id: "MY05", name: "\u041C\u0430\u0441\u0441\u0430\u0436\u0435\u0440 \u0434\u043B\u044F \u0433\u043B\u0430\u0437 SKG", pv: 190, bv: 80, rub: 15960 },
  { id: "MY07", name: "\u041C\u0438\u043D\u0438 \u043C\u0430\u0441\u0441\u0430\u0436\u0435\u0440 \u0434\u043B\u044F \u0433\u043E\u043B\u043E\u0432\u044B Breo", pv: 200, bv: 80, rub: 16800 },
  { id: "MY08", name: "\u041C\u0430\u0441\u0441\u0430\u0436\u0435\u0440 \u0434\u043B\u044F \u0433\u043B\u0430\u0437 Breo", pv: 360, bv: 80, rub: 30240 },
  { id: "MY09", name: "\u0423\u043B\u044C\u0442\u0440\u0430\u0437\u0432\u0443\u043A\u043E\u0432\u043E\u0439 \u043C\u0430\u0441\u0441\u0430\u0436\u0435\u0440 \u0434\u043B\u044F \u043A\u043E\u043B\u0435\u043D\u0435\u0439 Breo", pv: 230, bv: 80, rub: 19320 },
  { id: "MY11", name: "\u041D\u0430\u0441\u0430\u0434\u043A\u0430 \u0442\u0438\u0442\u0430\u043D\u043E\u0432\u0430\u044F", pv: 120, bv: 80, rub: 10080 },
  { id: "MY14", name: "\u0413\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0432\u043E\u0434\u043E\u0440\u043E\u0434\u043D\u043E\u0439 \u0432\u043E\u0434\u044B \u0434\u043B\u044F \u0432\u0430\u043D\u043D\u044B Silkway (\u042D\u043B\u0435\u043A\u0442\u0440\u043E\u0431\u044B\u0442\u043E\u0432\u043E\u0439 \u043F\u0440\u0438\u0431\u043E\u0440)", pv: 4200, bv: 100, rub: 352800 },
  { id: "MY15", name: "\u041A\u0430\u0441\u0442\u0440\u044E\u043B\u044F \u0438\u0437 \u043D\u0435\u0440\u0436\u0430\u0432\u0435\u044E\u0449\u0435\u0439 \u0441\u0442\u0430\u043B\u0438", pv: 300, bv: 100, rub: 25200 },
  { id: "MY16", name: "\u0421\u043A\u043E\u0432\u043E\u0440\u043E\u0434\u0430 \u0438\u0437 \u043D\u0435\u0440\u0436\u0430\u0432\u0435\u044E\u0449\u0435\u0439 \u0441\u0442\u0430\u043B\u0438", pv: 300, bv: 100, rub: 25200 },
  { id: "MY19", name: "\u041F\u0435\u0440\u0435\u043C\u0435\u0448\u0438\u0432\u0430\u044F \u0447\u0430\u0448\u043A\u0430", pv: 14, bv: 80, rub: 1176 },
  { id: "MY20", name: "\u041F\u043E\u0440\u0442\u0430\u0442\u0438\u0432\u043D\u044B\u0439 \u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0432\u043E\u0434\u043E\u0440\u043E\u0434\u043D\u043E\u0439 \u0432\u043E\u0434\u044B Silkway", pv: 270, bv: 100, rub: 22680 }
];
function priceListItem(id) {
  return PRICE_LIST.find((item) => item.id === id);
}
function priceFromList(id) {
  const item = priceListItem(id);
  if (!item) throw new Error(`\u041D\u0435\u0442 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u043F\u0440\u0430\u0439\u0441\u0430 ${id}`);
  return { rub: item.rub, pv: item.pv };
}

// src/data/productDescriptions.ts
var ASTAXANTHIN_DESCRIPTION = [
  {
    heading: "\u0414\u041E\u041B\u0413\u041E\u041B\u0415\u0422\u0418\u0415 \u0412\u041C\u0415\u0421\u0422\u0415 \u0421 \u0420\u0410\u0421\u0422\u0412\u041E\u0420\u0418\u041C\u042B\u041C \u041D\u0410\u041F\u0418\u0422\u041A\u041E\u041C \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D",
    list: [
      "\u0421\u0423\u041F\u0415\u0420\u041C\u041E\u0429\u041D\u042B\u0419 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422",
      "\u0421\u041D\u0418\u0416\u0410\u0415\u0422 \u0423\u0420\u041E\u0412\u0415\u041D\u042C \u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0425 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u041E\u0412. \u0412\u0418\u0414\u0418\u041C\u042B\u0415 \u0423\u041B\u0423\u0427\u0428\u0415\u041D\u0418\u042F \u041A\u041E\u0416\u0418",
      "\u0423\u0421\u0418\u041B\u0418\u0412\u0410\u0415\u0422 \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422"
    ]
  },
  {
    heading: "\u0413\u041B\u0410\u0412\u041D\u0410\u042F \u041F\u0420\u0418\u0427\u0418\u041D\u0410 \xAB\u0421\u0422\u0410\u0420\u0415\u041D\u0418\u042F\xBB \u041A\u041E\u0416\u0418- \u041E\u041A\u0418\u0421\u041B\u0415\u041D\u0418\u0415 \u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0425 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u041E\u0412",
    paragraphs: [
      "\u0410 \u0422\u0410\u041A \u0416\u0415 \u041D\u0415 \u0421\u041E\u0411\u041B\u042E\u0414\u0415\u041D\u0418\u0415 \u041D\u041E\u0427\u041D\u041E\u0413\u041E \u0420\u0415\u0416\u0418\u041C\u0410 / \u0412\u041E\u0417\u0420\u0410\u0421\u0422\u041D\u042B\u0415 \u0418\u0417\u041C\u0415\u041D\u0415\u041D\u0418\u042F / \u041F\u041B\u041E\u0425\u0410\u042F \u042D\u041A\u041E\u041B\u041E\u0413\u0418\u042F / \u0410\u0413\u0420\u0415\u0421\u0421\u0418\u0412\u041D\u042B\u0415 \u0423\u041B\u042C\u0422\u0420\u0410\u0424\u0418\u041E\u041B\u0415\u0422\u041E\u0412\u042B\u0415 \u041B\u0423\u0427\u0418 \u0418 \u041C\u041D\u041E\u0413\u0418\u0415 \u0414\u0420\u0423\u0413\u0418\u0415 \u041D\u0415 \u0411\u041B\u0410\u0413\u041E\u041F\u0420\u0418\u042F\u0422\u041D\u042B\u0415 \u0424\u0410\u041A\u0422\u041E\u0420\u042B",
      "\u0412\u0421\u0415 \u042D\u0422\u041E \u0412\u041B\u0415\u0427\u0415\u0422 \u0417\u0410 \u0421\u041E\u0411\u041E\u0419 \u0427\u0420\u0415\u0417\u041C\u0415\u0420\u041D\u0423\u042E \u0412\u042B\u0420\u0410\u0411\u041E\u0422\u041A\u0423 \u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0425 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u041E\u0412, \u041A\u041E\u0422\u041E\u0420\u042B\u0415 \u041A\u0420\u0410\u0419\u041D\u0415 \u041D\u0415\u0413\u0410\u0422\u0418\u0412\u041D\u041E \u0412\u041B\u0418\u042F\u042E\u0422 \u041D\u0410 \u041A\u041E\u0416\u0423, \u041F\u041E\u0412\u0420\u0415\u0416\u0414\u0410\u042F \u0415\u0415"
    ],
    list: [
      "\u041E\u0411\u0420\u0410\u0417\u041E\u0412\u0410\u041D\u0418\u0415 \u041F\u0418\u0413\u041C\u0415\u041D\u0422\u0410\u0426\u0418\u0418",
      "\u041F\u041E\u0422\u0415\u0420\u042F \u041A\u041E\u041B\u041B\u0410\u0413\u0415\u041D\u0410",
      "\u041F\u041E\u0412\u0420\u0415\u0416\u0414\u0415\u041D\u0418\u0415 \u041A\u041E\u0416\u041D\u041E\u0413\u041E \u0411\u0410\u0420\u042C\u0415\u0420\u0410",
      "\u0421\u041D\u0418\u0416\u0415\u041D\u0418\u0415 \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422\u0410"
    ]
  },
  {
    heading: "\u0427\u0442\u043E \u0442\u0430\u043A\u043E\u0435 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u044B?",
    paragraphs: [
      "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u044B - \u044D\u0442\u043E \u043E\u0434\u043D\u0430 \u0438\u0437 \u0444\u043E\u0440\u043C \u0445\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430. \u042D\u0442\u043E \u0430\u0442\u043E\u043C\u044B \u0438\u043B\u0438 \u0433\u0440\u0443\u043F\u043F\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043E\u0431\u0440\u0430\u0437\u0443\u044E\u0442\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u043C\u043E\u043B\u0435\u043A\u0443\u043B\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u0440\u0430\u0437\u0440\u044B\u0432\u0430\u0435\u0442 \u0441\u0432\u043E\u0438 \u043A\u043E\u0432\u0430\u043B\u0435\u043D\u0442\u043D\u044B\u0435 \u0441\u0432\u044F\u0437\u0438 \u043F\u043E\u0434 \u0432\u043E\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435\u043C \u0432\u043D\u0435\u0448\u043D\u0438\u0445 \u0444\u0430\u043A\u0442\u043E\u0440\u043E\u0432, \u0442\u0430\u043A\u0438\u0445 \u043A\u0430\u043A \u0441\u0432\u0435\u0442 \u0438 \u0442\u0435\u043F\u043B\u043E, \u0438 \u043E\u0431\u0440\u0430\u0437\u0443\u0435\u0442 \u043D\u0435\u0441\u0438\u043C\u043C\u0435\u0442\u0440\u0438\u0447\u043D\u0443\u044E \u043F\u0430\u0440\u0443 \u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043E\u0432. \u041E\u043D\u0438 \u044F\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0441\u043E\u0441\u0442\u0430\u0432\u043D\u044B\u043C\u0438 \u0447\u0430\u0441\u0442\u044F\u043C\u0438 \u043A\u043E\u0436\u0438, \u0438 \u043A\u043E\u0433\u0434\u0430 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u044B \u043A\u043E\u0436\u0438 \u0438\u0437\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F, \u043E\u043D\u0438 \u043C\u043E\u0433\u0443\u0442 \u0432\u044B\u0437\u044B\u0432\u0430\u0442\u044C \u0440\u0430\u0437\u043B\u0438\u0447\u043D\u044B\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B. \u041F\u043E\u0434 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435\u043C \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u043E\u0432 \u043A\u043E\u043B\u043B\u0430\u0433\u0435\u043D \u0432\u0441\u0442\u0443\u043F\u0430\u0435\u0442 \u0432 \u0440\u0435\u0430\u043A\u0446\u0438\u044E, \u0432 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0435 \u0447\u0435\u0433\u043E \u043A\u043E\u0436\u0430 \u043D\u0435 \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u043F\u0438\u0442\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0432\u0435\u0449\u0435\u0441\u0442\u0432, \u0447\u0442\u043E \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442 \u043A \u0441\u043D\u0438\u0436\u0435\u043D\u0438\u044E \u0436\u0438\u0437\u043D\u0435\u0441\u043F\u043E\u0441\u043E\u0431\u043D\u043E\u0441\u0442\u0438 \u043A\u043E\u0436\u043D\u043E\u0439 \u0442\u043A\u0430\u043D\u0438, \u043F\u043E\u0442\u0435\u0440\u0435 \u044D\u043B\u0430\u0441\u0442\u0438\u0447\u043D\u043E\u0441\u0442\u0438, \u043F\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u044E \u043C\u043E\u0440\u0449\u0438\u043D, \u0432\u044B\u0437\u0432\u0430\u043D\u043D\u044B\u0445 \u0441\u0442\u0430\u0440\u0435\u043D\u0438\u0435\u043C \u043A\u043E\u0436\u0438, \u0442\u0443\u0441\u043A\u043B\u043E\u043C\u0443 \u0446\u0432\u0435\u0442\u0443 \u043B\u0438\u0446\u0430 \u0438 \u0434\u0440\u0443\u0433\u0438\u043C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F\u043C.",
      "\u0411\u043E\u043B\u0435\u0435 \u0442\u043E\u0433\u043E, \u0441 \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u043E\u043C, \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u0443\u0432\u0435\u043B\u0438\u0447\u0435\u043D\u0438\u044F \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u043E\u0432 \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044F, \u0447\u0442\u043E \u0432\u043B\u0435\u0447\u0435\u0442 \u0437\u0430 \u0441\u043E\u0431\u043E\u0439 \u0440\u0430\u0437\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u0431\u0435\u043B\u043A\u043E\u0432\u044B\u0445 \u0438 \u0436\u0438\u0440\u043E\u0432\u044B\u0445 \u043A\u043B\u0435\u0442\u043E\u043A \u0432 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0435, \u044D\u0442\u043E \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442 \u043A \u0431\u043E\u043B\u044C\u0448\u0435\u043C\u0443 \u043D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u044E \u043C\u0435\u043B\u0430\u043D\u0438\u043D\u0430, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442 \u043A \u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E\u043C\u0443 \u043E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u043D\u0438\u044E \u043F\u0438\u0433\u043C\u0435\u043D\u0442\u0430\u0446\u0438\u0438."
    ]
  },
  {
    level: "minor",
    heading: "\u0410\u0422\u0410\u041A\u0410 \u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0425 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u041E\u0412 \u0420\u0410\u0417\u0420\u0423\u0428\u0410\u042E\u0422 \u041A\u041B\u0415\u0422\u041A\u0418 \u041A\u041E\u0416\u0418",
    paragraphs: [
      "\u043E\u0441\u0442\u0430\u0442\u043A\u0438 \u043F\u0435\u0441\u0442\u0438\u0446\u0438\u0434\u043E\u0432, \u043F\u0438\u0449\u0435\u0432\u044B\u0435 \u0434\u043E\u0431\u0430\u0432\u043A\u0438, \u043F\u043E\u0431\u043E\u0447\u043D\u044B\u0435 \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u043B\u0435\u043A\u0430\u0440\u0441\u0442\u0432, \u0443\u0441\u0442\u0430\u043B\u043E\u0441\u0442\u044C \u043E\u0442 \u043D\u0435\u0434\u043E\u0441\u044B\u043F\u0430, \u0441\u0442\u0440\u0435\u0441\u0441, \u043A\u0443\u0440\u0435\u043D\u0438\u0435, \u0443\u043F\u043E\u0442\u0440\u0435\u0431\u043B\u0435\u043D\u0438\u0435 \u0430\u043B\u043A\u043E\u0433\u043E\u043B\u044F \u0438 \u0442. \u0434."
    ]
  },
  {
    level: "minor",
    heading: "\u0421\u041E\u0421\u0422\u041E\u042F\u041D\u0418\u0415 \u041D\u0415\u0414\u041E\u041C\u041E\u0413\u0410\u041D\u0418\u042F \u041F\u041E\u0413\u0420\u0410\u041D\u0418\u0427\u041D\u041E\u0415 \u0421\u041E\u0421\u0422\u041E\u042F\u041D\u0418\u0415 \u041C\u0415\u0416\u0414\u0423 \u0417\u0414\u041E\u0420\u041E\u0412\u042C\u0415\u041C \u0418 \u0411\u041E\u041B\u0415\u0417\u041D\u042C\u042E",
    paragraphs: [
      "\u0437\u0430\u043F\u043E\u0440\u044B, \u0430\u043B\u043B\u0435\u0440\u0433\u0438\u044F, \u043F\u043E\u043D\u0438\u0436\u0435\u043D\u043D\u044B\u0439 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442, \u0431\u0435\u0441\u0441\u043E\u043D\u043D\u0438\u0446\u0430, \u0433\u043E\u043B\u043E\u0432\u043E\u043A\u0440\u0443\u0436\u0435\u043D\u0438\u0435, \u0448\u0443\u043C \u0432 \u0443\u0448\u0430\u0445, \u0442\u0435\u043C\u043D\u043E-\u0436\u0435\u043B\u0442\u044B\u0439 \u0446\u0432\u0435\u0442 \u043A\u043E\u0436\u0438"
    ]
  },
  {
    level: "minor",
    heading: "\u0412\u041E\u0417\u041D\u0418\u041A\u041D\u041E\u0412\u0415\u041D\u0418\u0415 \u0411\u041E\u041B\u0415\u0417\u041D\u0415\u0419",
    paragraphs: [
      "\u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F \u043F\u0435\u0447\u0435\u043D\u0438, \u0434\u0438\u0430\u0431\u0435\u0442, \u0438\u0448\u0435\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0431\u043E\u043B\u0435\u0437\u043D\u044C \u0441\u0435\u0440\u0434\u0446\u0430, \u043A\u0430\u0442\u0430\u0440\u0430\u043A\u0442\u0430, \u0442\u0440\u043E\u043C\u0431\u043E\u0437, \u0438\u043D\u0441\u0443\u043B\u044C\u0442 \u0438 \u0434\u0440."
    ]
  },
  {
    heading: "\u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u0421\u0423\u041F\u0415\u0420\u041C\u041E\u0429\u041D\u0410\u042F \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u0426\u0418\u042F"
  },
  {
    level: "minor",
    number: "01",
    heading: "\u0423\u041B\u0423\u0427\u0428\u0410\u0415\u0422 \u0421\u041E\u0421\u0422\u041E\u042F\u041D\u0418\u0415 \u0421\u0415\u0420\u0414\u0415\u0427\u041D\u041E-\u0421\u041E\u0421\u0423\u0414\u0418\u0421\u0422\u041E\u0419 \u0421\u0418\u0421\u0422\u0415\u041C\u042B",
    paragraphs: [
      "\u041F\u043E\u043C\u043E\u0433\u0430\u0435\u0442 \u0440\u0435\u0433\u0443\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0445\u043E\u043B\u0435\u0441\u0442\u0435\u0440\u0438\u043D\u0430, \u0441\u043D\u0438\u0436\u0430\u0435\u0442 \u0432\u044F\u0437\u043A\u043E\u0441\u0442\u044C \u043A\u0440\u043E\u0432\u0438 \u0438 \u0443\u043B\u0443\u0447\u0448\u0430\u0435\u0442 \u043A\u0440\u043E\u0432\u043E\u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435."
    ]
  },
  {
    level: "minor",
    number: "02",
    heading: "\u0417\u0410\u0429\u0418\u0429\u0410\u0415\u0422 \u0426\u0415\u041D\u0422\u0420\u0410\u041B\u042C\u041D\u0423\u042E \u041D\u0415\u0420\u0412\u041D\u0423\u042E \u0421\u0418\u0421\u0422\u0415\u041C\u0423",
    paragraphs: [
      "\u0417\u0430\u0449\u0438\u0449\u0430\u0435\u0442 \u043D\u0435\u0440\u0432\u043D\u044B\u0435 \u043A\u043B\u0435\u0442\u043A\u0438, \u0441\u043F\u043E\u0441\u043E\u0431\u0441\u0442\u0432\u0443\u0435\u0442 \u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u044E \u043A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0430\u0446\u0438\u0438 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u044F, \u043F\u0430\u043C\u044F\u0442\u0438 \u0438 \u0432\u043E\u0441\u043F\u0440\u0438\u044F\u0442\u0438\u044F."
    ]
  },
  {
    level: "minor",
    number: "03",
    heading: "\u0423\u041B\u0423\u0427\u0428\u0410\u0415\u0422 \u0421\u041E\u0421\u0422\u041E\u042F\u041D\u0418\u0415 \u041A\u041E\u0421\u0422\u0415\u0419 \u0418 \u0421\u0423\u0421\u0422\u0410\u0412\u041E\u0412",
    paragraphs: [
      "\u0421\u043D\u0438\u043C\u0430\u0435\u0442 \u043F\u043E\u0434\u0430\u0433\u0440\u0443 \u0438 \u0440\u0435\u0432\u043C\u0430\u0442\u043E\u0438\u0434\u043D\u044B\u0439 \u0430\u0440\u0442\u0440\u0438\u0442, \u0430 \u0442\u0430\u043A\u0436\u0435 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u0441\u043A\u043E\u0432\u0430\u043D\u043D\u043E\u0441\u0442\u044C \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u0439 \u0438 \u043E\u0442\u0435\u043A\u0438."
    ]
  },
  {
    level: "minor",
    number: "04",
    heading: "\u0417\u0410\u041C\u0415\u0414\u041B\u042F\u0415\u0422 \u041F\u0420\u041E\u0426\u0415\u0421\u0421 \u0421\u0422\u0410\u0420\u0415\u041D\u0418\u042F \u041A\u041E\u0416\u0418",
    paragraphs: [
      "\u042D\u0444\u0444\u0435\u043A\u0442\u0438\u0432\u043D\u043E \u0443\u0434\u0430\u043B\u044F\u0435\u0442 \u0438\u0437 \u043A\u043B\u0435\u0442\u043E\u043A \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u044B \u043A\u0438\u0441\u043B\u043E\u0440\u043E\u0434\u0430 \u0438 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u043D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u0438\u0435 \u0441\u0442\u0430\u0440\u0435\u044E\u0449\u0438\u0445 \u043A\u043B\u0435\u0442\u043E\u043A."
    ]
  },
  {
    level: "minor",
    number: "05",
    heading: "\u041F\u041E\u0412\u042B\u0428\u0410\u0415\u0422 \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422 \u041E\u0420\u0413\u0410\u041D\u0418\u0417\u041C\u0410",
    paragraphs: [
      "\u0421\u043F\u043E\u0441\u043E\u0431\u0435\u043D \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0442\u044C \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0438\u043C\u043C\u0443\u043D\u043D\u044B\u0445 \u043A\u043B\u0435\u0442\u043E\u043A \u0438 \u0443\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0438\u043C\u043C\u0443\u043D\u043D\u0443\u044E \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0430."
    ]
  },
  {
    level: "minor",
    number: "06",
    heading: "\u0423\u041B\u0423\u0427\u0428\u0415\u041D\u0418\u0415 \u0417\u0420\u0415\u041D\u0418\u042F",
    paragraphs: [
      "\u0420\u0430\u0441\u0441\u043B\u0430\u0431\u043B\u044F\u0435\u0442 \u0446\u0438\u043B\u0438\u0430\u0440\u043D\u0443\u044E \u043C\u044B\u0448\u0446\u0443, \u0443\u0441\u0438\u043B\u0438\u0432\u0430\u0435\u0442 \u043A\u0440\u043E\u0432\u043E\u0442\u043E\u043A \u0432 \u0441\u0435\u0442\u0447\u0430\u0442\u043A\u0435 \u0438 \u0441\u043D\u0438\u043C\u0430\u0435\u0442 \u0443\u0441\u0442\u0430\u043B\u043E\u0441\u0442\u044C \u0433\u043B\u0430\u0437."
    ]
  },
  {
    heading: '\u041D\u0410\u0422\u0423\u0420\u0410\u041B\u042C\u041D\u042B\u0419 \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u201C\u042D\u0412\u0415\u0420\u0415\u0421\u0422" \u0412 \u041A\u041B\u0410\u0421\u0421\u0415 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422\u041E\u0412',
    paragraphs: [
      "\u21161 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422\u041D\u0410\u042F \u0421\u041F\u041E\u0421\u041E\u0411\u041D\u041E\u0421\u0422\u042C"
    ],
    list: [
      "\u0412\u0418\u0422\u0410\u041C\u0418\u041D \u0421",
      "\u0410\u041D\u0422\u041E\u0426\u0418\u0410\u041D\u042B",
      "\u0411\u0415\u0422\u0410-\u041A\u0410\u0420\u041E\u0422\u0418\u041D",
      "\u041D\u0410\u0422\u0422\u041E",
      "\u041F\u041E\u041B\u0418\u0424\u0415\u041D\u041E\u041B\u042B \u0427\u0410\u042F"
    ]
  },
  {
    paragraphs: [
      "\u0412\u043F\u0435\u0440\u0432\u044B\u0435 \u043E\u043D \u0431\u044B\u043B \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D \u0432 \u0442\u0430\u043A\u0438\u0445 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0430\u0445, \u043A\u0430\u043A \u043A\u0440\u0435\u0432\u0435\u0442\u043A\u0438, \u043A\u0440\u0430\u0431\u044B \u0438 \u043B\u043E\u0441\u043E\u0441\u044C. \u0415\u0433\u043E \u0445\u0438\u043C\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0441\u0445\u043E\u0436\u0430 \u0441 \u0431\u0435\u0442\u0430-\u043A\u0430\u0440\u043E\u0442\u0438\u043D\u043E\u043C, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0432 \u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0441\u0430\u043C\u044B\u043C \u043C\u043E\u0449\u043D\u044B\u043C \u043F\u0440\u0438\u0440\u043E\u0434\u043D\u044B\u043C \u0430\u043D\u0442\u0438\u043E\u043A\u0441\u0438\u0434\u0430\u043D\u0442\u043E\u043C, \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u043E\u043C."
    ]
  },
  {
    heading: "\u041C\u041D\u041E\u0413\u041E\u041C\u0415\u0420\u041D\u042B\u0419 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422",
    paragraphs: [
      "\u043C\u043E\u043B\u043E\u0434\u0435\u0439\u0442\u0435 \u0441 \u043A\u0430\u0436\u0434\u044B\u043C \u0434\u043D\u0435\u043C"
    ]
  },
  {
    heading: "\u0420\u0410\u0421\u0422\u0412\u041E\u0420\u0418\u041C\u042B\u0419 \u041D\u0410\u041F\u0418\u0422\u041E\u041A \u0421 \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D\u041E\u041C \xAB\u0427\u0410\u041D \u0428\u042D\u041D \u0427\u0416\u042D\xBB",
    paragraphs: [
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D, \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0449\u0438\u0439\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u0435, \u043F\u043E\u043B\u0443\u0447\u0430\u044E\u0442 \u0438\u0437 \u043A\u0440\u0430\u0441\u043D\u044B\u0445 \u0432\u043E\u0434\u043E\u0440\u043E\u0441\u043B\u0435\u0439, \u0432\u044B\u0440\u043E\u0441\u0448\u0438\u0445 \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0434\u043E\u0436\u0434\u044F, \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u044F \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u043E\u0439 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438 \u044D\u043A\u0441\u0442\u0440\u0430\u043A\u0446\u0438\u0438, \u0443\u0441\u043E\u0432\u0435\u0440\u0448\u0435\u043D\u0441\u0442\u0432\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F \u043C\u0438\u043A\u0440\u043E\u043A\u0430\u043F\u0441\u0443\u043B \u0438 \u0443\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u043E\u0439 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0438 \u0440\u0430\u0441\u0442\u0432\u043E\u0440\u0435\u043D\u0438\u044F \u0432 \u0432\u043E\u0434\u0435."
    ]
  },
  {
    heading: "\u041A\u0420\u0410\u0421\u041D\u042B\u0415 \u0412\u041E\u0414\u041E\u0420\u041E\u0421\u041B\u0418 \u0413\u0415\u041C\u0410\u0422\u041E\u041A\u041E\u041A\u041A \u0414\u041E\u0416\u0414\u0415\u0412\u041E\u0419",
    list: [
      "1. \u041E\u043D \u043F\u0440\u0438\u0437\u043D\u0430\u043D \u0441\u0430\u043C\u044B\u043C \u0438\u0434\u0435\u0430\u043B\u044C\u043D\u044B\u043C \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u043C \u043D\u0430\u0442\u0443\u0440\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430 \u0432 \u043F\u0440\u0438\u0440\u043E\u0434\u0435.",
      "2.\u042D\u0442\u043E \u043C\u0438\u043A\u0440\u043E\u0432\u043E\u0434\u043E\u0440\u043E\u0441\u043B\u0438 \u0441 \u0441\u0430\u043C\u044B\u043C \u0432\u044B\u0441\u043E\u043A\u0438\u043C \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435\u043C \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430, \u0430 \u0442\u0430\u043A\u0436\u0435 \u0432\u0438\u0434\u044B \u0441 \u0441\u0430\u043C\u044B\u043C \u0432\u044B\u0441\u043E\u043A\u0438\u043C \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435\u043C \u0432\u0441\u0435\u0445 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0445 \u0441\u0438\u043D\u0442\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u043E\u0432, \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0449\u0438\u0445 \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D.",
      "3.\u0421\u0440\u0435\u0434\u0438 \u043D\u0438\u0445 \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430 \u0441\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442 1,5 - 10,0%, \u0447\u0442\u043E \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \xAB\u043A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u043C \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u043E\u043C\xBB \u0438\u0437 \u043D\u0430\u0442\u0443\u0440\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D\u0430."
    ],
    listStyle: "none"
  },
  {
    heading: "\u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \xAB\u0427\u0410\u041D \u0428\u042D\u041D \u0427\u0416\u042D\xBB",
    paragraphs: [
      { label: "\u0422\u0438\u043F \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u0430:", text: "\u0421\u0443\u0445\u043E\u0439 (\u0440\u0430\u0441\u0442\u0432\u043E\u0440\u0438\u043C\u044B\u0439) \u043D\u0430\u043F\u0438\u0442\u043E\u043A" },
      { label: "\u0421\u043E\u0441\u0442\u0430\u0432:", text: "\u041F\u043E\u0440\u043E\u0448\u043E\u043A \u043E\u043B\u0438\u0433\u043E\u043C\u0435\u0440\u043D\u043E\u0439 \u0438\u0437\u043E\u043C\u0430\u043B\u044C\u0442\u043E\u0437\u044B, \u043C\u043E\u0434\u0438\u0444\u0438\u0446\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043A\u0440\u0430\u0445\u043C\u0430\u043B. (\u043A\u0440\u0430\u0445\u043C\u0430\u043B \u043D\u0430\u0442\u0440\u0438\u044F \u043E\u043A\u0442\u0435\u043D\u0438\u043B\u044C\u043D\u044B\u0439 \u0441\u0443\u043A\u0446\u0438\u043D\u0430\u0442), \u0433\u0435\u043C\u0430\u0442\u043E\u043A\u043E\u043A\u043A \u0434\u043E\u0436\u0434\u0435\u0432\u043E\u0439, \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u043C\u0438\u043A\u0440\u043E\u0446\u0438\u0441\u0442\u0430, \u0430\u0440\u0430\u0432\u0438\u0439\u0441\u043A\u0430\u044F \u043A\u0430\u043C\u0435\u0434\u044C, \u0444\u043E\u0441\u0444\u043E\u043B\u0438\u043F\u0438\u0434\u044B, \u0432\u0438\u0442\u0430\u043C\u0438\u043D \u0421, \u0442\u0440\u043E\u0441\u0442\u043D\u0438\u043A\u043E\u0432\u044B\u0439 \u0441\u0430\u0445\u0430\u0440, \u0436\u0438\u0440\u043D\u044B\u0435 \u043A\u0438\u0441\u043B\u043E\u0442\u044B, \u043B\u0438\u043C\u043E\u043D\u043D\u0430\u044F \u043A\u0438\u0441\u043B\u043E\u0442\u0430." },
      { label: "\u041D\u043E\u0440\u043C\u0430 \u043F\u043E\u0442\u0440\u0435\u0431\u043B\u0435\u043D\u0438\u044F \u0432 \u043F\u0438\u0449\u0443 \u0433\u0435\u043C\u0430\u0442\u043E\u043A\u043E\u043A\u043A\u0430 \u0434\u043E\u0436\u0434\u0435\u0432\u043E\u0433\u043E:", text: "0,8 \u0433 \u0432 \u0434\u0435\u043D\u044C" },
      { label: "\u0421\u043F\u0435\u0446\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F:", text: "60 \u0433\u0440\u0430\u043C\u043C\u043E\u0432 (2 \u0433\u0440\u0430\u043C\u043C\u0430 * 30 \u043F\u0430\u043A\u0435\u0442\u0438\u043A\u043E\u0432)" },
      { label: "\u0423\u0441\u043B\u043E\u0432\u0438\u044F \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F:", text: "\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0432 \u0441\u0443\u0445\u043E\u043C, \u0442\u0435\u043C\u043D\u043E\u043C \u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u043C \u0434\u043B\u044F \u0434\u0435\u0442\u0435\u0439 \u043C\u0435\u0441\u0442\u0435 \u043F\u0440\u0438 \u0442\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u0435 \u043D\u0435 \u0432\u044B\u0448\u0435 25\xB0C \u0438 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u043D\u0435\u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E \u0443\u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u044C \u043F\u043E\u0441\u043B\u0435 \u0432\u0441\u043A\u0440\u044B\u0442\u0438\u044F \u043F\u0430\u043A\u0435\u0442\u0438\u043A\u0430." },
      "\u0414\u0430\u043D\u043D\u044B\u0439 \u043F\u0440\u043E\u0434\u0443\u043A\u0442 \u043D\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u0434\u043B\u044F \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u0435\u0439: \u043C\u043B\u0430\u0434\u0435\u043D\u0446\u044B \u0438 \u0431\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0435 \u0436\u0435\u043D\u0449\u0438\u043D\u044B.",
      { label: "\u0421\u043F\u043E\u0441\u043E\u0431 \u0443\u043F\u043E\u0442\u0440\u0435\u0431\u043B\u0435\u043D\u0438\u044F:", text: "\u0437\u0430\u0432\u0430\u0440\u0438\u0442\u0435 \u0432 \u0441\u0442\u0430\u043A\u0430\u043D\u0435 (\u043E\u043A\u043E\u043B\u043E 100 \u043C\u043B) \u0442\u0435\u043F\u043B\u043E\u0439 \u0438\u043B\u0438 \u0445\u043E\u043B\u043E\u0434\u043D\u043E\u0439 \u0432\u043E\u0434\u044B \u0438 \u043F\u0435\u0439\u0442\u0435 \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u043F\u0430\u043A\u0435\u0442\u0438\u043A\u0443 \u0432 \u0434\u0435\u043D\u044C." },
      { label: "\u0421\u0440\u043E\u043A \u0433\u043E\u0434\u043D\u043E\u0441\u0442\u0438:", text: "24 \u043C\u0435\u0441\u044F\u0446\u0430" },
      { label: "\u041B\u0438\u0446\u0435\u043D\u0437\u0438\u044F \u043D\u0430 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u043E:", text: "SC10642011400171" },
      { label: "\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442:", text: "GB/T 29602" }
    ]
  },
  {
    paragraphs: [
      "\u0411\u0443\u0434\u044C\u0442\u0435 \u0437\u0434\u043E\u0440\u043E\u0432\u044B!"
    ]
  },
  {
    level: "group",
    heading: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F"
  },
  {
    heading: "\u0424\u0410\u041A\u0422\u041E\u0420\u042B \u0412\u041B\u0418\u042F\u042E\u0429\u0418\u0415 \u041D\u0410 \u0417\u0414\u041E\u0420\u041E\u0412\u042C\u0415",
    list: [
      "\u042D\u041A\u041E\u041B\u041E\u0413\u0418\u042F",
      "\u041F\u041E\u0411\u041E\u0427\u041D\u042B\u0415 \u0414\u0415\u0419\u0421\u0422\u0412\u0418\u042F \u041E\u0422 \u041B\u0415\u041A\u0410\u0420\u0421\u0422\u0412",
      "\u041D\u0410\u0421\u041B\u0415\u0414\u0421\u0422\u0412\u0415\u041D\u041D\u041E\u0421\u0422\u042C",
      "\u041F\u0418\u0422\u0410\u041D\u0418\u0415 \u0418 \u041E\u0411\u0420\u0410\u0417 \u0416\u0418\u0417\u041D\u0418"
    ]
  },
  {
    heading: "\u041A\u0410\u0417\u0410\u0425\u0421\u0422\u0410\u041D \u0412 \u0426\u0418\u0424\u0420\u0410\u0425",
    list: [
      "11,5% \u0436\u0438\u0442\u0435\u043B\u0435\u0439 \u041A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0430 \u0431\u043E\u043B\u044C\u043D\u044B \u0434\u0438\u0430\u0431\u0435\u0442\u043E\u043C",
      "58,7% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0438\u043C\u0435\u044E\u0442 \u0438\u0437\u0431\u044B\u0442\u043E\u0447\u043D\u044B\u0439 \u0432\u0435\u0441",
      "23,5% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0441\u0442\u0440\u0430\u0434\u0430\u044E\u0442 \u043E\u0436\u0438\u0440\u0435\u043D\u0438\u0435\u043C",
      "20% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0432\u0435\u0434\u0443\u0442 \u043C\u0430\u043B\u043E\u043F\u043E\u0434\u0432\u0438\u0436\u043D\u044B\u0439 \u043E\u0431\u0440\u0430\u0437 \u0436\u0438\u0437\u043D\u0438",
      "54% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0443\u043C\u0438\u0440\u0430\u0435\u0442 \u043E\u0442 \u0441\u0435\u0440\u0434\u0435\u0447\u043D\u043E-\u0441\u043E\u0441\u0443\u0434\u0438\u0441\u0442\u044B\u0445 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u0439",
      "15% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0443\u043C\u0438\u0440\u0430\u0435\u0442 \u043E\u0442 \u0440\u0430\u043A\u0430",
      "1% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0443\u043C\u0438\u0440\u0430\u0435\u0442 \u043E\u0442 \u0434\u0438\u0430\u0431\u0435\u0442\u0430",
      "10% \u043A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0446\u0435\u0432 \u0443\u043C\u0438\u0440\u0430\u044E\u0442 \u043E\u0442 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0445 \u0442\u0440\u0430\u0432\u043C"
    ],
    listStyle: "none"
  },
  {
    heading: "\u0427\u0422\u041E \u041D\u0423\u0416\u041D\u041E \u0414\u0415\u041B\u0410\u0422\u042C?",
    list: [
      "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0432\u043E\u0439 \u0440\u0430\u0446\u0438\u043E\u043D \u043F\u0438\u0442\u0430\u043D\u0438\u044F! \u041F\u0440\u0438\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u043F\u0440\u0438\u043D\u0446\u0438\u043F\u043E\u0432 \u041F\u041F!",
      "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0432\u043E\u0439 \u043E\u0431\u0440\u0430\u0437 \u0436\u0438\u0437\u043D\u0438 \u0438 \u0437\u0430\u0431\u044B\u0442\u044C \u043F\u0440\u043E \u0432\u0440\u0435\u0434\u043D\u044B\u0435 \u043F\u0440\u0438\u0432\u044B\u0447\u043A\u0438!",
      "\u041E\u0447\u0438\u0449\u0435\u043D\u0438\u0435 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0430- \u0447\u0438\u0441\u0442\u044B\u0439 \u043A\u0438\u0448\u0435\u0447\u043D\u0438\u043A, \u0437\u0430\u043B\u043E\u0433 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F!",
      "\u0427\u0438\u0441\u0442\u044B\u0439 \u043A\u0438\u0448\u0435\u0447\u043D\u0438\u043A- \u044D\u0442\u043E \u0445\u043E\u0440\u043E\u0448\u0438\u0439 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442!"
    ]
  },
  {
    heading: "\u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422\u042B",
    paragraphs: [
      "\u044D\u0442\u043E \u0432\u0435\u0449\u0435\u0441\u0442\u0432\u0430, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0431\u043E\u0440\u044E\u0442\u0441\u044F \u0441 \u043E\u043A\u0438\u0441\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C\u0438 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430\u043C\u0438 \u0432 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0435, \u0432\u044B\u0437\u0432\u0430\u043D\u043D\u044B\u043C\u0438 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u043C\u0438 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u0430\u043C\u0438 \u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u044E\u0442 \u0438\u0445"
    ]
  },
  {
    heading: "\u0427\u0422\u041E \u0422\u0410\u041A\u041E\u0415 \u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422\u042B (\u041E\u041A\u0418\u0421\u041B\u0418\u0422\u0415\u041B\u0418) \u041F\u0420\u041E\u0421\u0422\u042B\u041C\u0418 \u0421\u041B\u041E\u0412\u0410\u041C\u0418?",
    paragraphs: [
      "\u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0415 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u042B\u2014 \u042D\u0422\u041E \u041D\u0415\u0423\u0421\u0422\u041E\u0419\u0427\u0418\u0412\u042B\u0415 \u0410\u0422\u041E\u041C\u042B, \u041C\u041E\u041B\u0415\u041A\u0423\u041B\u042B , \u0418\u041E\u041D\u042B, \u041A\u041E\u0422\u041E\u0420\u042B\u0415 \u0421\u041E\u0414\u0415\u0420\u0416\u0410\u0422 \u041E\u0414\u0418\u041D \u0418\u041B\u0418 \u041D\u0415\u0421\u041A\u041E\u041B\u042C\u041A\u041E \u041D\u0415\u0421\u041F\u0410\u0420\u0415\u041D\u041D\u042B\u0425 \u042D\u041B\u0415\u041A\u0422\u0420\u041E\u041D\u041E\u0412 \u041D\u0410 \u0412\u041D\u0415\u0428\u041D\u0415\u0419 \u042D\u041B\u0415\u041A\u0422\u0420\u041E\u041D\u041D\u041E\u0419 \u041E\u0411\u041E\u041B\u041E\u0427\u041A\u0415, \u041F\u041E\u042D\u0422\u041E\u041C\u0423 \u0418\u0425 \u041C\u041E\u041B\u0415\u041A\u0423\u041B\u042B \u041E\u0411\u041B\u0410\u0414\u0410\u042E\u0422 \u041D\u0415\u0412\u0415\u0420\u041E\u042F\u0422\u041D\u041E\u0419 \u0425\u0418\u041C\u0418\u0427\u0415\u0421\u041A\u041E\u0419 \u0410\u041A\u0422\u0418\u0412\u041D\u041E\u0421\u0422\u042C\u042E \u0418 \u041E\u041D\u0418 \u041E\u0427\u0415\u041D\u042C \u0410\u0413\u0420\u0415\u0421\u0421\u0418\u0412\u041D\u042B\u0415.",
      "\u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0415 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u042B \u041C\u041E\u0413\u0423\u0422 \u0411\u042B\u0422\u042C \u0422\u0412\u0415\u0420\u0414\u042B\u041C\u0418, \u0416\u0418\u0414\u041A\u0418\u041C\u0418 \u0418\u041B\u0418 \u0413\u0410\u0417\u041E\u041E\u0411\u0420\u0410\u0417\u041D\u042B\u041C\u0418 \u041D\u0415\u0421\u0422\u0410\u0411\u0418\u041B\u042C\u041D\u042B\u041C\u0418 \u0427\u0410\u0421\u0422\u0418\u0426\u0410\u041C\u0418.",
      "\u041E\u041D\u0418 \u041E\u0411\u0420\u0410\u0417\u0423\u042E\u0422\u0421\u042F \u0412 \u0420\u0415\u0417\u0423\u041B\u042C\u0422\u0410\u0422\u0415 \u041E\u0411\u041C\u0415\u041D\u041D\u042B\u0425 \u041F\u0420\u041E\u0426\u0415\u0421\u0421\u041E\u0412 \u0418\u041B\u0418 \u041F\u041E\u041F\u0410\u0414\u0410\u042E\u0422 \u0412 \u041E\u0420\u0413\u0410\u041D\u0418\u0417\u041C \u0418\u0417\u0412\u041D\u0415, \u041D\u0410\u041F\u0420\u0418\u041C\u0415\u0420, \u0421 \u0412\u042B\u0425\u041B\u041E\u041F\u041D\u042B\u041C\u0418 \u0413\u0410\u0417\u0410\u041C\u0418, \u041A\u041E\u0413\u0414\u0410 \u0427\u0415\u041B\u041E\u0412\u0415\u041A \u0427\u0410\u0421\u0422\u041E \u0411\u041E\u041B\u0415\u0415\u0422, \u0421\u0422\u0420\u0415\u0421\u0421\u0423\u0415\u0422 \u0418 \u0422\u0414."
    ]
  },
  {
    heading: "\u0427\u0422\u041E \u0416\u0415 \u0414\u0415\u041B\u0410\u0415\u0422 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422?",
    paragraphs: [
      "\u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422 \u041E\u0422\u0414\u0410\u0415\u0422 \u0421\u0412\u041E\u0419 \u042D\u041B\u0415\u041A\u0422\u0420\u041E\u041D \u0421\u0412\u041E\u0411\u041E\u0414\u041D\u041E\u041C\u0423 \u0420\u0410\u0414\u0418\u041A\u0410\u041B\u0423, \u0422\u0415\u041C \u0421\u0410\u041C\u042B\u041C \u041D\u0415\u0419\u0422\u0420\u0410\u041B\u0418\u0417\u0423\u042F \u0415\u0413\u041E \u0418 \u041E\u0421\u0422\u0410\u041D\u0410\u0412\u041B\u0418\u0412\u0410\u042F \u0426\u0415\u041F\u041D\u0423\u042E \u0420\u0415\u0410\u041A\u0426\u0418\u042E \u041F\u041E\u0412\u0420\u0415\u0416\u0414\u0415\u041D\u0418\u042F \u041A\u041B\u0415\u0422\u041E\u041A"
    ]
  },
  {
    heading: "\u0427\u0422\u041E \u0422\u0410\u041A\u041E\u0415 \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D?",
    list: [
      "\u043C\u043E\u0449\u043D\u044B\u0439 \u043F\u0440\u0438\u0440\u043E\u0434\u043D\u044B\u0439 \u0430\u043D\u0442\u0438\u043E\u043A\u0441\u0438\u0434\u0430\u043D\u0442",
      "\u043A\u0443\u043F\u0438\u0440\u0443\u0435\u0442 \u0440\u0430\u0437\u0432\u0438\u0442\u0438\u0435 \u043E\u043F\u0443\u0445\u043E\u043B\u0435\u0439",
      "\u043E\u0447\u0438\u0449\u0430\u0435\u0442 \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C \u043E\u0442 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u043E\u0432",
      "\u0443\u0441\u0438\u043B\u0438\u0432\u0430\u0435\u0442 \u0438\u043C\u043C\u0443\u043D\u0438\u0442\u0435\u0442",
      "\u0437\u0430\u0442\u043E\u0440\u043C\u0430\u0436\u0438\u0432\u0430\u0435\u0442 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 \u043F\u0435\u0440\u0438\u043A\u0438\u0441\u043D\u043E\u0433\u043E \u043E\u043A\u0438\u0441\u043B\u0435\u043D\u0438\u044F \u043B\u0438\u043F\u0438\u0434\u043E\u0432"
    ]
  },
  {
    heading: "\u041A\u0410\u041A\u0418\u0415 \u0410\u041D\u0422\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u041D\u0422\u042B \u0421\u0423\u0429\u0415\u0421\u0422\u0412\u0423\u042E\u0422 \u0412 \u041F\u0420\u0418\u0420\u041E\u0414\u0415 ?",
    paragraphs: [
      "\u041D\u0430\u0438\u0431\u043E\u043B\u0435\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0435 \u043D\u0435\u0444\u0435\u0440\u043C\u0435\u043D\u0442\u043D\u044B\u0435 \u0430\u043D\u0442\u0438\u043E\u043A\u0441\u0438\u0434\u0430\u043D\u0442\u044B:"
    ],
    list: [
      "\u0430\u0441\u043A\u043E\u0440\u0431\u0438\u043D\u043E\u0432\u0430\u044F \u043A\u0438\u0441\u043B\u043E\u0442\u0430 (\u0432\u0438\u0442\u0430\u043C\u0438\u043D \u0421);",
      "\u0442\u043E\u043A\u043E\u0444\u0435\u0440\u043E\u043B (\u0432\u0438\u0442\u0430\u043C\u0438\u043D \u0415);",
      "\xDF-\u043A\u0430\u0440\u043E\u0442\u0438\u043D (\u043F\u0440\u043E\u0432\u0438\u0442\u0430\u043C\u0438\u043D \u0410) \u0438 \u043B\u0438\u043A\u043E\u043F\u0438\u043D (\u0432 \u0442\u043E\u043C\u0430\u0442\u0430\u0445);",
      "\u043F\u043E\u043B\u0438\u0444\u0435\u043D\u043E\u043B\u044B: \u0444\u043B\u0430\u0432\u0438\u043D \u0438 \u0444\u043B\u0430\u0432\u043E\u043D\u043E\u0438\u0434\u044B (\u0447\u0430\u0441\u0442\u043E \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u044E\u0442\u0441\u044F \u0432 \u043E\u0432\u043E\u0449\u0430\u0445),",
      "\u0442\u0430\u043D\u0438\u043D\u044B (\u0432 \u043A\u0430\u043A\u0430\u043E, \u043A\u043E\u0444\u0435, \u0447\u0430\u0435);",
      "\u0430\u043D\u0442\u043E\u0446\u0438\u0430\u043D\u044B (\u0432 \u043A\u0440\u0430\u0441\u043D\u044B\u0445 \u044F\u0433\u043E\u0434\u0430\u0445)."
    ]
  },
  {
    heading: "\u041C\u042B \u041F\u0420\u0415\u0414\u0421\u0422\u0410\u0412\u041B\u042F\u0415\u041C \u0423\u041D\u0418\u041A\u0410\u041B\u042C\u041D\u042B\u0419 \u041D\u0410\u041F\u0418\u0422\u041E\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D",
    list: [
      "1.\u042D\u0424\u0424\u0415\u041A\u0422\u0418\u0412\u041D\u0415\u0415 \u0412\u0418\u0422\u0410\u041C\u0418\u041D\u0410 \xAB\u0421\xBB \u0412 6000 \u0420\u0410\u0417;",
      "2.\u042D\u0424\u0424\u0415\u041A\u0422\u0418\u0412\u041D\u0415\u0415 \u0412\u0418\u0422\u0410\u041C\u0418\u041D\u0410 \xAB\u0415\xBB \u0412 1000 \u0420\u0410\u0417;",
      "3.\u042D\u0424\u0424\u0415\u041A\u0422\u0418\u0412\u041D\u0415\u0415 \u041A\u041E\u042D\u041D\u0417\u0418\u041C\u0410 Q 10 \u0412 800 \u0420\u0410\u0417;",
      "4.\u042D\u0424\u0424\u0415\u041A\u0422\u0418\u0412\u041D\u0415\u0415 \u041F\u041E\u041B\u0418\u0424\u0415\u041D\u041E\u041B\u041E\u0412 \u0412 \u0417\u0415\u041B\u0415\u041D\u041E\u041C \u0427\u0410\u0415 \u0412 300 \u0420\u0410\u0417."
    ],
    listStyle: "none"
  },
  {
    heading: "\u041A\u0410\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u0412\u041B\u0418\u042F\u0415\u0422 \u041D\u0410 \u0417\u0420\u0415\u041D\u0418\u0415?",
    paragraphs: [
      "\u0418\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442, \u0447\u0442\u043E \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u043F\u0440\u0435\u0434\u043E\u0442\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435 \u0431\u043E\u043B\u044C\u0448\u0438\u043D\u0441\u0442\u0432\u0430 \u0442\u043A\u0430\u043D\u0435\u0439 \u0438 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440 \u0433\u043B\u0430\u0437 \u0438 \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u043F\u043E\u043B\u0435\u0437\u043D\u044B\u043C \u0434\u043B\u044F \u043F\u0440\u0435\u0434\u043E\u0442\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u043D\u044B\u0445 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u0433\u043B\u0430\u0437, \u0442\u0430\u043A\u0438\u0445 \u043A\u0430\u043A \u0440\u0435\u0442\u0438\u043D\u043E\u043F\u0430\u0442\u0438\u044F, \u0433\u043B\u0430\u0443\u043A\u043E\u043C\u0430 \u0438 \u043D\u0435\u0432\u0440\u043E\u043F\u0430\u0442\u0438\u044F, \u0438 \u0440\u0430\u0437\u043B\u0438\u0447\u043D\u044B\u0435 \u0434\u0440\u0443\u0433\u0438\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F."
    ],
    list: [
      "\u0441\u043F\u043E\u0441\u043E\u0431\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u043D\u0438\u0436\u0435\u043D\u0438\u044E \u0443\u0442\u043E\u043C\u043B\u044F\u0435\u043C\u043E\u0441\u0442\u0438 \u0433\u043B\u0430\u0437;",
      "\u043F\u043E\u0434\u0430\u0432\u043B\u044F\u0435\u0442 \u0432\u043E\u0441\u043F\u0430\u043B\u0435\u043D\u0438\u0435 \u0432 \u043A\u043B\u0435\u0442\u043A\u0430\u0445, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u0432\u043E\u0437\u043D\u0438\u043A\u0430\u0435\u0442 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E\u043C \u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u043C \u0441\u0442\u0440\u0435\u0441\u0441\u0435;",
      "\u0443\u043B\u0443\u0447\u0448\u0430\u0435\u0442 \u043A\u0440\u043E\u0432\u043E\u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0432 \u043A\u0430\u043F\u0438\u043B\u043B\u044F\u0440\u0430\u0445 \u0433\u043B\u0430\u0437;",
      "\u0443\u0441\u0438\u043B\u0438\u0432\u0430\u0435\u0442 \u0430\u043A\u043A\u043E\u043C\u043E\u0434\u0430\u0446\u0438\u044E."
    ]
  },
  {
    heading: "\u041A\u0410\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u0412\u041B\u0418\u042F\u0415\u0422 \u041D\u0410 \u041A\u041E\u0416\u0423?",
    paragraphs: [
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u0443\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0432\u043B\u0430\u0433\u0443 \u0438 \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0442 \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u043A\u043E\u0436\u0443 \u0443\u043F\u0440\u0443\u0433\u043E\u0439 \u0438 \u043F\u043E\u0434\u0442\u044F\u043D\u0443\u0442\u043E\u0439, \u0440\u0430\u0437\u0433\u043B\u0430\u0434\u0438\u0442\u044C \u043C\u043E\u0440\u0449\u0438\u043D\u043A\u0438 \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0437\u0434\u043E\u0440\u043E\u0432\u044B\u0439 \u0446\u0432\u0435\u0442 \u043B\u0438\u0446\u0430.",
      "\u0421\u043E\u043B\u043D\u0435\u0447\u043D\u044B\u0435 \u043B\u0443\u0447\u0438 \u0432\u043E\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0442 \u043D\u0430 \u043A\u043E\u0436\u0443 \u0438 \u0432\u044B\u0437\u044B\u0432\u0430\u044E\u0442 \u0432\u043E\u0441\u043F\u0430\u043B\u0435\u043D\u0438\u0435. \u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u0441\u043D\u0438\u043C\u0430\u0435\u0442 \u0432\u043E\u0441\u043F\u0430\u043B\u0435\u043D\u0438\u0435 \u0434\u0430\u0436\u0435 \u0432 \u0433\u043B\u0443\u0431\u043E\u043A\u0438\u0445 \u0441\u043B\u043E\u044F\u0445 \u044D\u043F\u0438\u0434\u0435\u0440\u043C\u0438\u0441\u0430 \u0438 \u043F\u0440\u0435\u0434\u043E\u0442\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043E\u0436\u043E\u0433\u0438."
    ]
  },
  {
    heading: "\u041A\u0410\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u0412\u041B\u0418\u042F\u0415\u0422 \u041D\u0410 \u0413\u041E\u041B\u041E\u0412\u041D\u041E\u0419 \u041C\u041E\u0417\u0413?",
    paragraphs: [
      "\u0418\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442, \u0447\u0442\u043E \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u043C\u043E\u0436\u0435\u0442 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0442\u044C \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u043E\u043A\u0438\u0441\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u0432 \u043C\u043E\u0437\u0433\u0435, \u0447\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u0441\u043F\u043E\u0441\u043E\u0431\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u044C \u0441\u043D\u0438\u0436\u0435\u043D\u0438\u044E \u0440\u0438\u0441\u043A\u0430 \u043D\u0435\u0439\u0440\u043E\u0434\u0435\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u0438\u0432\u043D\u044B\u0445 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u0439, \u0442\u0430\u043A\u0438\u0445 \u043A\u0430\u043A \u0431\u043E\u043B\u0435\u0437\u043D\u044C \u0410\u043B\u044C\u0446\u0433\u0435\u0439\u043C\u0435\u0440\u0430 \u0438 \u041F\u0430\u0440\u043A\u0438\u043D\u0441\u043E\u043D\u0430, \u0430 \u0442\u0430\u043A\u0436\u0435 \u043E\u0431\u043B\u0430\u0434\u0430\u0435\u0442 \u043A\u043E\u0433\u043D\u0438\u0442\u0438\u0432\u043D\u044B\u043C\u0438 \u0438 \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u0432\u043E\u0441\u043F\u0430\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F\u043C\u0438."
    ]
  },
  {
    heading: "\u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u041F\u0420\u0418 \u0421\u0410\u0425\u0410\u0420\u041D\u041E\u041C \u0414\u0418\u0410\u0411\u0415\u0422\u0415",
    list: [
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u0438\u0437\u0443\u0435\u0442 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0430\u0434\u0438\u043A\u0430\u043B\u044B \u0438 \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u043E\u043A\u0438\u0441\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u0442\u0440\u0435\u0441\u0441;",
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u0432\u043E\u0441\u043F\u0430\u043B\u0435\u043D\u0438\u0435, \u0441\u043D\u0438\u0436\u0430\u044F \u0443\u0440\u043E\u0432\u043D\u0438 \u0432\u043E\u0441\u043F\u0430\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u043C\u0430\u0440\u043A\u0435\u0440\u043E\u0432, \u0447\u0442\u043E \u0441\u043F\u043E\u0441\u043E\u0431\u0441\u0442\u0432\u0443\u0435\u0442 \u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u044E \u043E\u0431\u0449\u0435\u0433\u043E \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F \u0438 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u044E \u0443\u0440\u043E\u0432\u043D\u044F \u0433\u043B\u044E\u043A\u043E\u0437\u044B \u0432 \u043A\u0440\u043E\u0432\u0438;",
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u0437\u0430\u0449\u0438\u0449\u0430\u0435\u0442 \u043A\u043B\u0435\u0442\u043A\u0438 \u043F\u043E\u0434\u0436\u0435\u043B\u0443\u0434\u043E\u0447\u043D\u043E\u0439 \u0436\u0435\u043B\u0435\u0437\u044B \u043E\u0442 \u043E\u043A\u0438\u0441\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u0438 \u0432\u043E\u0441\u043F\u0430\u043B\u0435\u043D\u0438\u044F, \u0447\u0442\u043E \u0441\u043F\u043E\u0441\u043E\u0431\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044E \u0444\u0443\u043D\u043A\u0446\u0438\u0438 \u0431\u0435\u0442\u0430-\u043A\u043B\u0435\u0442\u043E\u043A, \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0445 \u0437\u0430 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u043E \u0438\u043D\u0441\u0443\u043B\u0438\u043D\u0430."
    ]
  },
  {
    heading: "\u041A\u0410\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D \u0412\u041B\u0418\u042F\u0415\u0422 \u041D\u0410 \u0421\u0415\u0420\u0414\u0426\u0415?",
    paragraphs: [
      "\u0423\u0447\u0451\u043D\u044B\u0435 \u0438\u043D\u0441\u0442\u0438\u0442\u0443\u0442\u0430 \u0442\u0435\u043E\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u0438 \u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u0430\u043B\u044C\u043D\u043E\u0439 \u0431\u0438\u043E\u0444\u0438\u0437\u0438\u043A\u0438 \u0420\u0410\u041D \u0432 \u044D\u043A\u0441\u043F\u0435\u0440\u0438\u043C\u0435\u043D\u0442\u0430\u0445 \u043F\u043E\u043A\u0430\u0437\u0430\u043B\u0438, \u0447\u0442\u043E \u043F\u0440\u0438\u0440\u043E\u0434\u043D\u044B\u0439 \u043A\u043E\u043C\u043F\u043E\u043D\u0435\u043D\u0442 \u2013 \u0430\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D \u0437\u043D\u0430\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442 \u0434\u0435\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E \u0438 \u043E\u0442\u0435\u043A \u0432\u043E\u043B\u043E\u043A\u043E\u043D \u0441\u0435\u0440\u0434\u0435\u0447\u043D\u043E\u0439 \u043C\u044B\u0448\u0446\u044B, \u0430 \u0442\u0430\u043A\u0436\u0435 \u0441\u043D\u0438\u0436\u0430\u0435\u0442 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u044F \u043C\u0438\u043E\u043A\u0430\u0440\u0434\u0430 \u043F\u0440\u0438 \u0441\u0435\u0440\u044C\u0435\u0437\u043D\u044B\u0445 \u043F\u0430\u0442\u043E\u043B\u043E\u0433\u0438\u044F\u0445.",
      "\u0410\u0441\u0442\u0430\u043A\u0441\u0430\u043D\u0442\u0438\u043D - \u044D\u0442\u043E \u043F\u0440\u043E\u0444\u0438\u043B\u0430\u043A\u0442\u0438\u043A\u0430 \u0438\u043D\u0444\u0430\u0440\u043A\u0442\u043E\u0432 \u0438 \u0438\u043D\u0441\u0443\u043B\u044C\u0442\u043E\u0432."
    ]
  },
  {
    heading: "\u0420\u0410\u0421\u0422\u0412\u041E\u0420\u0418\u041C\u042B\u0419 \u041D\u0410\u041F\u0418\u0422\u041E\u041A \u0410\u0421\u0422\u0410\u041A\u0421\u0410\u041D\u0422\u0418\u041D\u0410 \u201C\u0427\u0410\u041D \u0428\u042D\u041D \u0427\u0416\u042D\u201D",
    list: [
      "\u041F\u0420\u041E\u0418\u0417\u0412\u0415\u0414\u0415\u041D \u0418\u0417 \u041A\u0420\u0410\u0421\u041D\u042B\u0425 \u0412\u041E\u0414\u041E\u0420\u041E\u0421\u041B\u0415\u0419;",
      "\u0423\u041D\u0418\u041A\u0410\u041B\u042C\u041D\u0410\u042F \u0422\u0415\u0425\u041D\u041E\u041B\u041E\u0413\u0418\u042F \u041E\u0411\u0420\u0410\u0411\u041E\u0422\u041A\u0418;",
      "\u0423\u041D\u0418\u041A\u0410\u041B\u042C\u041D\u0410\u042F \u0422\u0415\u0425\u041D\u041E\u041B\u041E\u0413\u0418\u042F \u0424\u041E\u0420\u041C\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u042F \u041C\u0418\u041A\u0420\u041E\u0426\u0418\u0421\u0422\u042B (\u041A\u041B\u0415\u0422\u041A\u0418, \u041E\u041A\u0420\u0423\u0416\u0415\u041D\u041D\u042B\u0425 \u041E\u0411\u041E\u041B\u041E\u0427\u041A\u041E\u0419);",
      "\u041E\u0421\u041E\u0411\u0410\u042F \u041E\u0411\u0420\u0410\u0411\u041E\u0422\u041A\u0410 \u0414\u041B\u042F \u0412\u041E\u0414\u041E\u0420\u0410\u0421\u0422\u0412\u041E\u0420\u0418\u041C\u041E\u0419 \u0424\u041E\u0420\u041C\u042B;",
      "\u041F\u041E\u0420\u041E\u0428\u041A\u041E\u0412\u042B\u0419 \u041F\u0420\u0415\u041F\u0410\u0420\u0410\u0422 \u041B\u0415\u0413\u041A\u041E \u0423\u0421\u0412\u0410\u0418\u0412\u0410\u0415\u0422\u0421\u042F."
    ]
  }
];
var SOSSYUREYA_DESCRIPTION = [
  {
    heading: "\u0424\u0410\u041A\u0422\u041E\u0420\u042B \u0412\u041B\u0418\u042F\u042E\u0429\u0418\u0415 \u041D\u0410 \u0417\u0414\u041E\u0420\u041E\u0412\u042C\u0415",
    list: [
      "\u044D\u043A\u043E\u043B\u043E\u0433\u0438\u044F",
      "\u043B\u0435\u043A\u0430\u0440\u0441\u0442\u0432\u0430",
      "\u0441\u0442\u0440\u0435\u0441\u0441",
      "\u043D\u0430\u0441\u043B\u0435\u0434\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0441\u0442\u044C",
      "\u043A\u0443\u0440\u0435\u043D\u0438\u0435",
      "\u0430\u043B\u043A\u043E\u0433\u043E\u043B\u044C",
      "\u043F\u0438\u0442\u0430\u043D\u0438\u0435",
      "0 \u0441\u043F\u043E\u0440\u0442\u0430"
    ]
  },
  {
    heading: "7 \u0421\u0422\u0415\u041F\u0415\u041D\u0415\u0419 \u0417\u0410\u0428\u041B\u0410\u041A\u041E\u0412\u0410\u041D\u041D\u041E\u0421\u0422\u0418 \u041E\u0420\u0413\u0410\u041D\u0418\u0417\u041C\u0410",
    list: [
      "1 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u0423\u0441\u0442\u0430\u043B\u043E\u0441\u0442\u044C",
      "2 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u0413\u043E\u043B\u043E\u0432\u043D\u044B\u0435 \u0431\u043E\u043B\u0438",
      "3 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u0410\u043B\u043B\u0435\u0440\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u043C\u044B",
      "4 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u041A\u0430\u043C\u043D\u0438, \u043B\u0438\u043F\u043E\u043C\u044B, \u043C\u0438\u043E\u043C\u044B, \u0444\u0438\u0431\u0440\u043E\u043C\u044B, \u043A\u0438\u0441\u0442\u044B, \u043F\u043E\u043B\u0438\u043A\u0438\u0441\u0442\u043E\u0437\u044B.",
      "5 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u041E\u0436\u0438\u0440\u0435\u043D\u0438\u0435, \u043F\u043E\u043B\u0438\u0430\u0440\u0442\u0440\u0438\u0442\u044B, \u0430\u0440\u0442\u0440\u0438\u0442\u044B, \u0440\u0435\u0432\u043C\u0430\u0442\u0438\u0437\u043C.",
      "6 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u0418\u043D\u0444\u0430\u0440\u043A\u0442\u044B, \u0438\u043D\u0441\u0443\u043B\u044C\u0442\u044B, \u0433\u0430\u043D\u0433\u0440\u0435\u043D\u044B",
      "7 \u0441\u0442\u0435\u043F\u0435\u043D\u044C \u2013 \u041E\u043D\u043A\u043E\u043B\u043E\u0433\u0438\u044F"
    ],
    listStyle: "none"
  },
  {
    heading: "\u0427\u0422\u041E \u041D\u0423\u0416\u041D\u041E \u0414\u0415\u041B\u0410\u0422\u042C?",
    list: [
      "1. \u0418\u0417\u041C\u0415\u041D\u0418\u0422\u042C \u0421\u0412\u041E\u0419 \u0420\u0410\u0426\u0418\u041E\u041D \u041F\u0418\u0422\u0410\u041D\u0418\u042F! \u041F\u0420\u0418\u0414\u0415\u0420\u0416\u0418\u0412\u0410\u0422\u042C\u0421\u042F \u041F\u0420\u0418\u041D\u0426\u0418\u041F\u041E\u0412 \u041F\u041F!",
      "2. \u0418\u0417\u041C\u0415\u041D\u0418\u0422\u042C \u0421\u0412\u041E\u0419 \u041E\u0411\u0420\u0410\u0417 \u0416\u0418\u0417\u041D\u0418 \u0418 \u0417\u0410\u0411\u042B\u0422\u042C \u041F\u0420\u041E \u0412\u0420\u0415\u0414\u041D\u042B\u0415 \u041F\u0420\u0418\u0412\u042B\u0427\u041A\u0418!",
      "3. \u041E\u0427\u0418\u0429\u0415\u041D\u0418\u0415 \u041E\u0420\u0413\u0410\u041D\u0418\u0417\u041C\u0410- \u0427\u0418\u0421\u0422\u042B\u0419 \u041A\u0418\u0428\u0415\u0427\u041D\u0418\u041A,\u0417\u0410\u041B\u041E\u0413 \u0417\u0414\u041E\u0420\u041E\u0412\u042C\u042F!",
      "4. \u0427\u0418\u0421\u0422\u042B\u0419 \u041A\u0418\u0428\u0415\u0427\u041D\u0418\u041A- \u042D\u0422\u041E \u0425\u041E\u0420\u041E\u0428\u0418\u0419 \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422!"
    ],
    listStyle: "none"
  },
  {
    heading: "\u0412\u041E\u041B\u0428\u0415\u0411\u041D\u042B\u0415 \u0421\u0412\u041E\u0419\u0421\u0422\u0412\u0410 \u041D\u0410\u041F\u0418\u0422\u041A\u0410 \u0421 \u0421\u041E\u0421\u0421\u042E\u0420\u0415\u0415\u0419:",
    list: [
      "1. \u0414\u0423\u0411\u0418\u041B\u042C\u041D\u042B\u0415 \u0412\u0415\u0429\u0415\u0421\u0422\u0412\u0410, \u041A\u041E\u0422\u041E\u0420\u042B\u0415 \u0421\u041F\u041E\u0421\u041E\u0411\u0421\u0422\u0412\u0423\u042E\u0422 \u0420\u0410\u0417\u041C\u041D\u041E\u0416\u0415\u041D\u0418\u042E \u041F\u041E\u041B\u0415\u0417\u041D\u041E\u0419 \u041C\u0418\u041A\u0420\u041E\u0424\u041B\u041E\u0420\u042B;",
      "2. \u041A\u0423\u0420\u041A\u0423\u041C\u0418\u041D \u2013 \u041E\u0427\u0418\u0429\u0415\u041D\u0418\u0415 \u041A\u041B\u0415\u0422\u041E\u041A \u041F\u0415\u0427\u0415\u041D\u0418, \u0416\u0415\u041B\u0427\u041D\u042B\u0425 \u041F\u0420\u041E\u0422\u041E\u041A\u041E\u0412 \u0418 \u0416\u0415\u041B\u0427\u041D\u041E\u0413\u041E \u041F\u0423\u0417\u042B\u0420\u042F;",
      "3. \u0411\u0420\u041E\u041A\u041E\u041B\u041B\u0418- \u041E\u0411\u041B\u0410\u0414\u0410\u0415\u0422 \u0410\u041D\u0422\u0418\u0411\u0410\u041A\u0422\u0415\u0420\u0418\u0410\u041B\u042C\u041D\u042B\u041C \u0418 \u041F\u0420\u041E\u0422\u0418\u0412\u041E\u0412\u041E\u0421\u041F\u0410\u041B\u0418\u0422\u0415\u041B\u042C\u041D\u042B\u041C \u0414\u0415\u0419\u0421\u0422\u0412\u0418\u0415\u041C;",
      "4. \u0418\u041C\u041C\u0423\u041D\u041E\u0413\u041B\u0423\u0411\u0423\u041B\u0418\u041D \u2013 \u042D\u0422\u041E \u0424\u0410\u041A\u0422\u041E\u0420 \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422\u0410, \u041F\u041E\u041C\u041E\u0413\u0410\u0415\u0422 \u041E\u0420\u0413\u0410\u041D\u0418\u0417\u041C\u0423 \u0414\u041B\u042F \u0418\u041C\u041C\u0423\u041D\u0418\u0422\u0415\u0422\u0410;",
      "5. \u0420\u0410\u0421\u0429\u0415\u041F\u041B\u0415\u041D\u0418\u0415 \u041B\u0418\u041F\u0418\u0414\u041E\u0412 (\u0416\u0418\u0420\u041E\u0412) \u2013 \u0412\u0418\u0421\u0426\u0415\u0420\u0410\u041B\u042C\u041D\u042B\u0419 \u0416\u0418\u0420."
    ],
    listStyle: "none"
  },
  {
    list: [
      "\u0412\u0438\u0441\u0446\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u0436\u0438\u0440",
      "\u041F\u043E\u0434\u043A\u043E\u0436\u043D\u044B\u0439 \u0436\u0438\u0440"
    ]
  },
  {
    heading: "\u041A\u0410\u041A \u0412\u042B\u0413\u041B\u042F\u0414\u0418\u0422 \u0421\u0415\u0420\u0414\u0426\u0415",
    list: [
      "\u0421\u0435\u0440\u0434\u0446\u0435 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 \u0441 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u043C \u0432\u0435\u0441\u043E\u043C",
      "\u0421\u0435\u0440\u0434\u0446\u0435 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430 \u0441 \u0438\u0437\u0431\u044B\u0442\u043E\u0447\u043D\u044B\u043C \u0432\u0435\u0441\u043E\u043C",
      "\u0421\u0435\u0440\u0434\u0446\u0435 \u041E\u0427\u0415\u041D\u042C \u043F\u043E\u043B\u043D\u043E\u0433\u043E \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0430"
    ]
  },
  {
    heading: "\u041A\u0410\u041A \u0412\u042B\u0413\u041B\u042F\u0414\u0418\u0422 \u041F\u0415\u0427\u0415\u041D\u042C",
    list: [
      "\u0437\u0434\u043E\u0440\u043E\u0432\u0430\u044F \u043F\u0435\u0447\u0435\u043D\u044C",
      "\u0436\u0438\u0440\u043E\u0432\u043E\u0439 \u0433\u0435\u043F\u0430\u0442\u043E\u0437"
    ]
  },
  {
    heading: "50 \u0413 \u041F\u0420\u041E\u0414\u0423\u041A\u0422\u0410 \u041F\u041E\u0417\u0412\u041E\u041B\u042F\u042E\u0422 \u0418\u0417\u0411\u0410\u0412\u0418\u0422\u042C\u0421\u042F \u041E\u0422 90 \u0413 \u0412\u041D\u0423\u0422\u0420\u0415\u041D\u041D\u0415\u0413\u041E \u0416\u0418\u0420\u0410"
  },
  {
    heading: "\u041A\u041E\u041C\u041F\u041B\u0415\u041A\u0421\u041D\u042B\u0419 \u041D\u0410\u041F\u0418\u0422\u041E\u041A \u0421 \u0421\u041E\u0421\u0421\u042E\u0420\u0415\u0415\u0419",
    paragraphs: [
      "\u042D\u0422\u041E \u041F\u041E\u041B\u041D\u041E\u0426\u0415\u041D\u041D\u041E\u0415 \u041F\u0418\u0422\u0410\u041D\u0418\u0415 \u041D\u0410 \u041C\u041E\u041B\u0415\u041A\u0423\u041B\u042F\u0420\u041D\u041E\u041C \u0423\u0420\u041E\u0412\u041D\u0415.\u041E\u0422\u041B\u0418\u0427\u041D\u041E\u0415 \u0416\u0415\u041B\u0427\u0415\u0413\u041E\u041D\u041D\u041E\u0415 \u0421\u0420\u0415\u0414\u0421\u0422\u0412\u041E, \u0421\u0422\u0418\u041C\u0423\u041B\u0418\u0420\u0423\u042E\u0429\u0415\u0415 \u0412\u042B\u0420\u0410\u0411\u041E\u0422\u041A\u0423 \u0418 \u0412\u042B\u0414\u0415\u041B\u0415\u041D\u0418\u0415 \u0416\u0415\u041B\u0427\u0418 \u0418 \u0423\u0421\u041A\u041E\u0420\u042F\u042E\u0429\u0415\u0415 \u0415\u0401 \u041E\u0422\u0422\u041E\u041A.",
      { label: "\u0421\u043E\u0441\u0442\u0430\u0432:", text: "\u0418\u0437\u043E\u043C\u0430\u043B\u044C\u0442\u043E\u043E\u043B\u0438\u0433\u043E\u0441\u0430\u0445\u0430\u0440\u0438\u0434, \u0438\u0437\u043E\u043B\u044F\u0442 \u0441\u043E\u0435\u0432\u043E\u0433\u043E \u0431\u0435\u043B\u043A\u0430, \u0441\u0435\u043C\u0435\u043D\u0430 \u043F\u043E\u0434\u043E\u0440\u043E\u0436\u043D\u0438\u043A\u0430, \u0434\u0435\u043A\u0441\u0442\u0440\u0438\u043D, \u0438\u043D\u0443\u043B\u0438\u043D, \u0441\u044B\u0432\u043E\u0440\u043E\u0442\u043E\u0447\u043D\u044B\u0439 \u0430\u043B\u044C\u0431\u0443\u043C\u0438\u043D, \u043F\u043E\u0440\u043E\u0448\u043E\u043A \u044F\u0431\u043B\u043E\u043A\u0430, \u0441\u0435\u043C\u0435\u043D\u0430 \u0447\u0438\u0430, \u0442\u0440\u0438\u0433\u043B\u0438\u0446\u0435\u0440\u0438\u0434\u044B \u0441\u0440\u0435\u0434\u043D\u0435\u0439 \u0446\u0435\u043F\u0438, \u043A\u0441\u0438\u043B\u0438\u0442, \u043F\u043E\u0440\u043E\u0448\u043E\u043A \u0431\u0435\u043B\u043E\u0433\u043E \u0447\u0430\u044F, \u044D\u043A\u0441\u0442\u0440\u0430\u043A\u0442 \u0433\u0443\u0430\u0440\u0430\u043D\u044B, \u0432\u0438\u0442\u0430\u043C\u0438\u043D \u0421, \u0441\u043E\u0441\u0441\u044E\u0440\u0435\u044F \u043E\u0431\u0435\u0440\u043D\u0443\u0442\u0430\u044F." }
    ]
  },
  {
    level: "minor",
    heading: "\u041F\u043E\u043A\u0430\u0437\u0430\u043D \u043A \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044E:",
    list: [
      "\u043F\u043E\u043B\u043D\u0430\u044F \u0434\u0435\u0442\u043E\u043A\u0441\u0438\u043A\u0430\u0446\u0438\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043C\u0430;",
      "\u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435 \u0444\u0443\u043D\u043A\u0446\u0438\u0439 \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0445 \u043E\u0440\u0433\u0430\u043D\u043E\u0432;",
      "\u044D\u043D\u0434\u043E\u043A\u0440\u0438\u043D\u043D\u044B\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F \u0438 \u0433\u043E\u0440\u043C\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u044F;",
      "\u0443\u043B\u0443\u0447\u0448\u0435\u043D\u0438\u0435 \u043E\u0431\u043C\u0435\u043D\u0430 \u0432\u0435\u0449\u0435\u0441\u0442\u0432;",
      "\u0432\u043E\u0441\u043F\u0430\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F \u043E\u0440\u0433\u0430\u043D\u043E\u0432 \u0434\u044B\u0445\u0430\u043D\u0438\u044F;",
      "\u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F \u043E\u0440\u0433\u0430\u043D\u043E\u0432 \u043F\u0438\u0449\u0435\u0432\u0430\u0440\u0435\u043D\u0438\u044F;",
      "\u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F\u0445 \u043E\u043F\u043E\u0440\u043D\u043E-\u0434\u0432\u0438\u0433\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0430\u043F\u043F\u0430\u0440\u0430\u0442\u0430;",
      "\u0434\u0435\u0440\u043C\u0430\u0442\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F;",
      "\u043C\u043E\u0447\u0435\u043F\u043E\u043B\u043E\u0432\u044B\u0435 \u0437\u0430\u0431\u043E\u043B\u0435\u0432\u0430\u043D\u0438\u044F \u043C\u0443\u0436\u0447\u0438\u043D \u0438 \u0436\u0435\u043D\u0449\u0438\u043D."
    ]
  },
  {
    level: "group",
    heading: "\u0420\u0410\u0417\u041B\u0418\u0427\u0418\u0415 \u0412\u0418\u0414\u0410 \u0421\u041E\u0421\u0421\u042E\u0420\u0415\u0418"
  },
  {
    level: "minor",
    heading: "\u0421\u041E\u0421\u0421\u042E\u0420\u0415\u042F \u041E\u0411\u0401\u0420\u041D\u0423\u0422\u0410\u042F:",
    list: [
      "\u0420\u0415\u0414\u041A\u041E\u0415 \u0412\u042B\u0421\u041E\u041A\u041E\u0413\u041E\u0420\u041D\u041E\u0415 \u0420\u0410\u0421\u0422\u0415\u041D\u0418\u0415.",
      "\u041F\u0420\u041E\u0418\u0417\u0420\u0410\u0421\u0422\u0410\u0415\u0422 \u0412 \u0410\u041B\u042C\u041F\u0418\u0419\u0421\u041A\u0418\u0425 \u0417\u041E\u041D\u0410\u0425 \u0422\u042F\u041D\u042C-\u0428\u0410\u041D\u042F, \u0413\u0418\u041C\u0410\u041B\u0410\u0415\u0412.",
      "\u0412\u041A\u041B\u042E\u0427\u0415\u041D\u0410 \u0412 \u041A\u0420\u0410\u0421\u041D\u0423\u042E \u041A\u041D\u0418\u0413\u0423 \u0412 \u0420\u042F\u0414\u0415 \u0420\u0415\u0413\u0418\u041E\u041D\u041E\u0412.",
      "\u0427\u0410\u0421\u0422\u041E \u041D\u0410\u0417\u042B\u0412\u0410\u0415\u0422\u0421\u042F \xAB\u0421\u041D\u0415\u0416\u041D\u042B\u0419 \u041B\u041E\u0422\u041E\u0421\xBB \u2014 \u0421\u0418\u041C\u0412\u041E\u041B \u0414\u041E\u041B\u0413\u041E\u041B\u0415\u0422\u0418\u042F \u0418 \u0421\u0418\u041B\u042B \u0412 \u0412\u041E\u0421\u0422\u041E\u0427\u041D\u041E\u0419 \u041C\u0415\u0414\u0418\u0426\u0418\u041D\u0415.",
      "\u0418\u0421\u041F\u041E\u041B\u042C\u0417\u0423\u0415\u0422\u0421\u042F \u0412 \u0422\u0418\u0411\u0415\u0422\u0421\u041A\u041E\u0419, \u041A\u0418\u0422\u0410\u0419\u0421\u041A\u041E\u0419 \u041C\u0415\u0414\u0418\u0426\u0418\u041D\u0415 \u041A\u0410\u041A \u0410\u0414\u0410\u041F\u0422\u041E\u0413\u0415\u041D, \u041F\u0420\u041E\u0422\u0418\u0412\u041E\u0412\u041E\u0421\u041F\u0410\u041B\u0418\u0422\u0415\u041B\u042C\u041D\u041E\u0415 \u0418 \u041E\u0411\u0429\u0415\u0423\u041A\u0420\u0415\u041F\u041B\u042F\u042E\u0429\u0415\u0415 \u0421\u0420\u0415\u0414\u0421\u0422\u0412\u041E."
    ]
  },
  {
    level: "minor",
    heading: "\u0421\u041E\u0421\u0421\u042E\u0420\u0415\u042F \u0418\u0412\u041E\u041B\u0418\u0421\u0422\u0410\u042F:",
    list: [
      "\u0411\u041E\u041B\u0415\u0415 \u0428\u0418\u0420\u041E\u041A\u041E \u0420\u0410\u0421\u041F\u0420\u041E\u0421\u0422\u0420\u0410\u041D\u0415\u041D\u0410 \u0412 \u0423\u041C\u0415\u0420\u0415\u041D\u041D\u042B\u0425 \u0417\u041E\u041D\u0410\u0425 \u0415\u0412\u0420\u0410\u0417\u0418\u0418.",
      "\u0412\u0421\u0422\u0420\u0415\u0427\u0410\u0415\u0422\u0421\u042F \u0412 \u0421\u0418\u0411\u0418\u0420\u0418, \u041D\u0410 \u0410\u041B\u0422\u0410\u0415, \u0412 \u041C\u041E\u041D\u0413\u041E\u041B\u0418\u0418.",
      "\u041D\u0415\u0422\u0420\u0415\u0411\u041E\u0412\u0410\u0422\u0415\u041B\u042C\u041D\u0410 \u041A \u0423\u0421\u041B\u041E\u0412\u0418\u042F\u041C \u041F\u0420\u041E\u0418\u0417\u0420\u0410\u0421\u0422\u0410\u041D\u0418\u042F.",
      "\u041F\u0420\u0418\u041C\u0415\u041D\u042F\u0415\u0422\u0421\u042F \u0412 \u041D\u0410\u0420\u041E\u0414\u041D\u041E\u0419 \u041C\u0415\u0414\u0418\u0426\u0418\u041D\u0415, \u041E\u0411\u041B\u0410\u0414\u0410\u0415\u0422 \u041C\u0415\u041D\u0415\u0415 \u0412\u042B\u0420\u0410\u0416\u0415\u041D\u041D\u042B\u041C \u042D\u0424\u0424\u0415\u041A\u0422\u041E\u041C."
    ]
  },
  {
    heading: "\u041F\u041E\u0421\u041B\u0415 \u041F\u0420\u0418\u0415\u041C\u0410 \u041D\u0410\u041F\u0418\u0422\u041A\u0410 \u0427\u0415\u0420\u0415\u0417 45 \u0414\u041D\u0415\u0419:",
    list: [
      "1. \u0421\u041D\u0418\u0417\u0418\u0422\u0421\u042F \u041A\u041E\u041B-\u0412\u041E \u0412\u0418\u0421\u0426\u0415\u0420\u0410\u041B\u042C\u041D\u041E\u0413\u041E \u0416\u0418\u0420\u0410 \u041D\u0410 20-30%!",
      "2. \u0421\u041D\u0418\u0417\u0418\u0422\u0421\u042F \u0425\u041E\u041B\u0415\u0421\u0422\u0418\u0420\u0418\u041D, \u0421\u0410\u0425\u0410\u0420 \u0412 \u041A\u0420\u041E\u0412\u0418, \u0410\u0420\u0422\u0415\u0420\u0418\u0410\u041B\u042C\u041D\u041E\u0415 \u0414\u0410\u0412\u041B\u0415\u041D\u0418\u0415.",
      "3. \u041F\u0418\u0413\u041C\u0415\u041D\u0422\u041D\u042B\u0415 \u041F\u042F\u0422\u041D\u0410 \u041D\u0410 \u041A\u041E\u0416\u0415 \u0421\u0422\u0410\u041D\u0423\u0422 \u0421\u0412\u0415\u0422\u041B\u0415\u0415 \u041D\u0410 50%!",
      "4. \u0412\u041E\u0417\u0420\u0410\u0421\u0422 \u0412\u041D\u0423\u0422\u0420\u0415\u041D\u041D\u0418\u0425 \u041E\u0420\u0413\u0410\u041D\u041E\u0412 \u0423\u041C\u0415\u041D\u042C\u0428\u0418\u0422\u0421\u042F \u041D\u0410 5 \u041B\u0415\u0422!"
    ],
    listStyle: "none"
  },
  {
    paragraphs: [
      "\u0411\u0423\u0414\u042C\u0422\u0415 \u0417\u0414\u041E\u0420\u041E\u0412\u042B"
    ]
  }
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
    image: { src: "/products/catalog/flagship-device.webp", width: 601, height: 873 },
    gallery: [
      { src: "/products/catalog/flagship-device.webp", width: 601, height: 873 },
      img("flagship-device-photo")
    ],
    priceListId: "MY14",
    price: priceFromList("MY14"),
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
    priceListId: "BS02",
    price: priceFromList("BS02"),
    description: ASTAXANTHIN_DESCRIPTION
  },
  {
    id: "sossyureya",
    slug: "chan-sossyureya",
    brandId: "chan",
    name: "\u041A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u043D\u044B\u0439 \u043D\u0430\u043F\u0438\u0442\u043E\u043A \u0441 \u0441\u043E\u0441\u0441\u044E\u0440\u0435\u0435\u0439 \xAB\u0427\u0430\u043D \u0428\u044D\u043D \u0427\u0436\u044D\xBB",
    pack: null,
    category: "supplements",
    form: "powder",
    kind: "supplement",
    image: img("chan-sossyureya"),
    gallery: [img("chan-sossyureya")],
    priceListId: "BS01",
    price: priceFromList("BS01"),
    description: SOSSYUREYA_DESCRIPTION
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
    priceListId: "BS14",
    price: priceFromList("BS14"),
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
    priceListId: "BS06",
    price: priceFromList("BS06"),
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
    priceListId: "BS07",
    price: priceFromList("BS07"),
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
    priceListId: "BS08",
    price: priceFromList("BS08"),
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
    priceListId: "BS04",
    price: priceFromList("BS04"),
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
    priceListId: "BS05",
    price: priceFromList("BS05"),
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
    priceListId: "BS09",
    price: priceFromList("BS09"),
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
    priceListId: "BS27",
    price: priceFromList("BS27"),
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
    priceListId: null,
    price: null,
    description: null
  },
  {
    id: "era-gel",
    slug: "era-gel",
    brandId: "era",
    name: "\u041F\u0440\u0438\u0434\u0430\u044E\u0449\u0435\u0435 \u0441\u0438\u044F\u043D\u0438\u0435 \u043A\u043E\u0436\u0435 \u043E\u0447\u0438\u0449\u0430\u044E\u0449\u0435\u0435 \u043C\u043E\u043B\u043E\u0447\u043A\u043E \xAB\u0411\u043E\u0442\u0430\u043D\u0438\u043A\u0430 \u042D\u0440\u0430\xBB",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-gel"),
    gallery: [img("era-gel")],
    priceListId: "MF06",
    price: priceFromList("MF06"),
    description: null
  },
  {
    id: "era-lotion",
    slug: "era-lotion",
    brandId: "era",
    name: "\u0426\u0437\u0438\u043D\u0438\u043D \u0421\u044F\u043D\u0446\u0437\u044D \u043A\u0440\u0435\u043C \u0434\u043B\u044F \u0443\u043F\u0440\u0443\u0433\u043E\u0441\u0442\u0438 \u0438 \u0443\u0432\u0435\u043B\u0438\u0447\u0435\u043D\u0438\u044F \u043F\u043B\u043E\u0442\u043D\u043E\u0441\u0442\u0438 \u043A\u043E\u0436\u0438 \u0434\u043B\u044F \u0442\u0435\u043B\u0430",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-lotion"),
    gallery: [img("era-lotion")],
    priceListId: "MF02",
    price: priceFromList("MF02"),
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
    priceListId: "MF07",
    price: priceFromList("MF07"),
    description: null
  },
  {
    id: "era-essence",
    slug: "era-essence",
    brandId: "era",
    name: "\u0423\u0432\u043B\u0430\u0436\u043D\u044F\u044E\u0449\u0438\u0439 \u043B\u043E\u0441\u044C\u043E\u043D \u0441 \u0433\u0438\u0430\u043B\u0443\u0440\u043E\u043D\u043E\u0432\u043E\u0439 \u043A\u0438\u0441\u043B\u043E\u0442\u043E\u0439 \u0434\u043B\u044F \u043B\u0438\u0446\u0430",
    pack: "35 \u043C\u043B",
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-essence"),
    gallery: [img("era-essence")],
    priceListId: "MF05",
    price: priceFromList("MF05"),
    description: null
  },
  {
    id: "era-oil",
    slug: "era-face-oil",
    brandId: "era",
    name: "\u042D\u0441\u0441\u0435\u043D\u0446\u0438\u044F \u0434\u043B\u044F \u043F\u0438\u0442\u0430\u043D\u0438\u044F \u0438 \u0443\u0445\u043E\u0434\u0430 \u0437\u0430 \u043A\u043E\u0436\u0435\u0439 \u0438\u0437 \u0436\u0438\u0432\u044B\u0445 \u0434\u0440\u043E\u0436\u0436\u0435\u0439 \u0434\u043B\u044F \u043B\u0438\u0446\u0430",
    pack: "35 \u043C\u043B",
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-face-oil"),
    gallery: [img("era-face-oil")],
    priceListId: "MF04",
    price: priceFromList("MF04"),
    description: null
  },
  {
    id: "era-foam",
    slug: "era-foam",
    brandId: "era",
    name: "\u0413\u0435\u043B\u044C \u0441 \u043C\u043D\u043E\u0433\u043E\u0441\u0442\u043E\u0440\u043E\u043D\u043D\u0438\u043C \u044D\u0444\u0444\u0435\u043A\u0442\u043E\u043C \u0434\u043B\u044F \u0443\u0445\u043E\u0434\u0430 \u0437\u0430 \u043A\u043E\u0436\u0435\u0439 \u0427\u0436\u0438\u0446\u0443\u0439 \u0434\u043B\u044F \u043B\u0438\u0446\u0430",
    pack: null,
    category: "care",
    form: null,
    kind: "goods",
    image: img("era-foam", 900, 600),
    gallery: [img("era-foam", 900, 600)],
    priceListId: "MF01",
    price: priceFromList("MF01"),
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
    priceListId: "MF03",
    price: priceFromList("MF03"),
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
    priceListId: "MF12",
    price: priceFromList("MF12"),
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
    priceListId: "RH11",
    price: priceFromList("RH11"),
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
    priceListId: "RH26",
    price: priceFromList("RH26"),
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
    priceListId: "MY03",
    price: priceFromList("MY03"),
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
    priceListId: "MY15",
    price: priceFromList("MY15"),
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
    priceListId: "MY16",
    price: priceFromList("MY16"),
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
    priceListId: null,
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
    priceListId: null,
    price: null,
    description: null
  }
];

// server/max/catalog.ts
function findProduct(id) {
  return PRODUCTS.find((item) => item.id === id) ?? null;
}

// server/max/publishedReviewSearch.ts
var TEXT_PREVIEW_MAX = 150;
function normalizeSearchQuery(raw) {
  return raw.trim().replace(/\s+/g, " ");
}
function searchWords(q) {
  const normalized = normalizeSearchQuery(q).toLowerCase();
  if (!normalized) return [];
  return normalized.split(" ").filter((w) => w.length > 0);
}
function productIdsMatchingWord(word) {
  const needle = word.toLowerCase();
  return PRODUCTS.filter((p) => p.name.toLowerCase().includes(needle)).map((p) => p.id);
}
function previewText(text, limit = TEXT_PREVIEW_MAX) {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return `${chars.slice(0, limit).join("")}\u2026`;
}
function countMediaByType(media) {
  const safeMedia = [];
  let photosCount = 0;
  let videosCount = 0;
  for (const raw of media) {
    if (!isAllowedPublicMediaSrc(raw.src)) continue;
    let item = raw;
    if (item.thumbnailSrc != null && !isAllowedPublicMediaSrc(item.thumbnailSrc)) {
      const { thumbnailSrc: _drop, ...rest } = item;
      void _drop;
      item = rest;
    }
    if (item.poster != null && !isAllowedPublicMediaSrc(item.poster)) {
      if (item.type === "image") continue;
      safeMedia.push({ ...item, poster: null });
    } else {
      safeMedia.push(item);
    }
    if (item.type === "image") photosCount += 1;
    else if (item.type === "video") videosCount += 1;
  }
  return { photosCount, videosCount, mediaCount: photosCount + videosCount, safeMedia };
}
function toAdminItem(row) {
  const { photosCount, videosCount, mediaCount, safeMedia } = countMediaByType(row.media);
  const product = findProduct(row.productId);
  return {
    id: row.id,
    productId: row.productId,
    productName: product?.name ?? row.productId,
    author: row.author,
    text: row.text,
    textPreview: previewText(row.text),
    photosCount,
    videosCount,
    mediaCount,
    media: safeMedia,
    publishedAt: row.publishedAt
  };
}

// server/max/postgresStore.ts
function asKeyboard(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}
function textOrNull(value) {
  return typeof value === "string" ? value : null;
}
function publicMediaFromJson(value) {
  if (!Array.isArray(value)) return [];
  const media = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item;
    if (row.type !== "image" && row.type !== "video") continue;
    if (typeof row.src !== "string" || row.src.length === 0) continue;
    media.push({
      type: row.type,
      src: row.src,
      poster: typeof row.poster === "string" ? row.poster : null,
      alt: typeof row.alt === "string" ? row.alt : null,
      ...typeof row.thumbnailSrc === "string" && row.thumbnailSrc.length > 0 ? { thumbnailSrc: row.thumbnailSrc } : {}
    });
  }
  return media;
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
      size: typeof row.size === "number" ? row.size : null,
      sourceUrl: null,
      persistedSrc: textOrNull(row.persistedSrc),
      ...typeof row.thumbnailSrc === "string" && row.thumbnailSrc.length > 0 ? { thumbnailSrc: row.thumbnailSrc } : {}
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
var WEBINAR_COLUMNS = `id::text, title, speaker, to_char(event_date, 'YYYY-MM-DD') AS event_date, source_type,
  youtube_video_id, start_seconds, recording_src, youtube_title, youtube_published_at::text, metadata_status, status,
  created_at::text, updated_at::text, published_at::text, withdrawn_at::text, moderator_user_id::text,
  content_id::text, source_chat_id::text, source_message_mid`;
function webinarFrom(row) {
  return {
    id: row.id,
    title: textOrNull(row.title),
    speaker: textOrNull(row.speaker),
    eventDate: textOrNull(row.event_date),
    sourceType: row.source_type,
    youtubeVideoId: textOrNull(row.youtube_video_id),
    startSeconds: typeof row.start_seconds === "number" ? row.start_seconds : null,
    recordingSrc: textOrNull(row.recording_src),
    youtubeTitle: textOrNull(row.youtube_title),
    youtubePublishedAt: textOrNull(row.youtube_published_at),
    metadataStatus: row.metadata_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: textOrNull(row.published_at),
    withdrawnAt: textOrNull(row.withdrawn_at),
    moderatorUserId: textOrNull(row.moderator_user_id),
    contentId: textOrNull(row.content_id),
    sourceChatId: textOrNull(row.source_chat_id),
    sourceMessageMid: textOrNull(row.source_message_mid)
  };
}
function webinarValues(record) {
  return [
    record.id,
    record.title,
    record.speaker,
    record.eventDate,
    record.sourceType,
    record.youtubeVideoId,
    record.startSeconds,
    record.recordingSrc,
    record.youtubeTitle,
    record.youtubePublishedAt,
    record.metadataStatus,
    record.status,
    record.createdAt,
    record.updatedAt,
    record.publishedAt,
    record.withdrawnAt,
    record.moderatorUserId,
    record.contentId,
    record.sourceChatId,
    record.sourceMessageMid
  ];
}
var WEBINAR_WRITE_SET = `title = $2, speaker = $3, event_date = $4::date, source_type = $5, youtube_video_id = $6,
  start_seconds = $7, recording_src = $8, youtube_title = $9, youtube_published_at = $10::timestamptz,
  metadata_status = $11, status = $12, created_at = $13::timestamptz, updated_at = $14::timestamptz,
  published_at = $15::timestamptz, withdrawn_at = $16::timestamptz, moderator_user_id = $17::bigint,
  content_id = $18::uuid, source_chat_id = $19::bigint, source_message_mid = $20`;
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
          const job = jobs[position];
          if (!job) continue;
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
              job.kind,
              job.chatId,
              job.userId,
              job.callbackId,
              job.text,
              job.attachments ? JSON.stringify(job.attachments) : null,
              job.notification
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
      async listPendingGroup(limit, scope = "review") {
        const result = await client.query(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind, body_text, public_text,
                  attachments, status, published_review_id::text
           FROM incoming_content
           WHERE status = 'pending' AND (($2 = 'review' AND kind = 'review') OR ($2 = 'other' AND kind NOT IN ('review', 'webinar')))
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit, scope]
        );
        return result.rows.map(contentFrom);
      },
      async publishGroupReview(id, productId, moderatorUserId, atIso) {
        const existing = await client.query(
          `SELECT status, kind, public_text, received_at::text, attachments
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
        const reviewId = randomUUID();
        const media = publicMediaOf(attachmentsOf(row.attachments));
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, decided_at, moderator_user_id, idempotency_key, sender_user_id, media
           ) VALUES (
             $1::uuid, $2, $3, NULL, 'published', 'MAX',
             $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::bigint, $7, NULL, $8::jsonb
           )`,
          [reviewId, productId, row.public_text, row.received_at, atIso, moderatorUserId, `group-review:${reviewId}`, JSON.stringify(media)]
        );
        await client.query(
          `UPDATE incoming_content
           SET status = 'published', published_review_id = $2::uuid
           WHERE id = $1::uuid`,
          [id, reviewId]
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
      },
      async listPublishedReviews(limit, offset) {
        const result = await client.query(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE status = 'published' AND withdrawn_at IS NULL
           ORDER BY decided_at DESC NULLS LAST, id ASC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        return result.rows.map((row) => {
          const media = publicMediaFromJson(row.media);
          const photosCount = media.filter((m) => m.type === "image").length;
          const videosCount = media.filter((m) => m.type === "video").length;
          return {
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body,
            mediaCount: photosCount + videosCount,
            photosCount,
            videosCount,
            publishedAt: row.decided_at
          };
        });
      },
      async countPublishedReviews() {
        const result = await client.query(
          `SELECT count(*)::text AS count FROM product_reviews WHERE status = 'published' AND withdrawn_at IS NULL`
        );
        return Number(result.rows[0]?.count ?? 0);
      },
      async searchPublishedReviews(query) {
        const words = searchWords(query.q);
        const values = [];
        const where = [`status = 'published'`, `withdrawn_at IS NULL`];
        const photosExpr = `(SELECT count(*)::int FROM jsonb_array_elements(COALESCE(media, '[]'::jsonb)) elem WHERE elem->>'type' = 'image')`;
        const videosExpr = `(SELECT count(*)::int FROM jsonb_array_elements(COALESCE(media, '[]'::jsonb)) elem WHERE elem->>'type' = 'video')`;
        if (query.photos != null) {
          values.push(query.photos);
          where.push(`${photosExpr} = $${values.length}`);
        }
        if (query.videos != null) {
          values.push(query.videos);
          where.push(`${videosExpr} = $${values.length}`);
        }
        for (const word of words) {
          const productIds = productIdsMatchingWord(word);
          values.push(word);
          const wordParam = values.length;
          if (productIds.length > 0) {
            values.push(productIds);
            const productsParam = values.length;
            where.push(
              `(strpos(lower(body), lower($${wordParam})) > 0 OR strpos(lower(COALESCE(author_name, '')), lower($${wordParam})) > 0 OR product_id = ANY($${productsParam}::text[]))`
            );
          } else {
            where.push(
              `(strpos(lower(body), lower($${wordParam})) > 0 OR strpos(lower(COALESCE(author_name, '')), lower($${wordParam})) > 0)`
            );
          }
        }
        const whereSql = where.join(" AND ");
        const countResult = await client.query(
          `SELECT count(*)::text AS count FROM product_reviews WHERE ${whereSql}`,
          values
        );
        const total = Number(countResult.rows[0]?.count ?? 0);
        values.push(query.limit);
        const limitParam = values.length;
        values.push(query.offset);
        const offsetParam = values.length;
        const result = await client.query(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE ${whereSql}
           ORDER BY decided_at DESC NULLS LAST, id ASC
           LIMIT $${limitParam} OFFSET $${offsetParam}`,
          values
        );
        const items = result.rows.map(
          (row) => toAdminItem({
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body,
            media: publicMediaFromJson(row.media),
            publishedAt: row.decided_at
          })
        );
        return { total, items };
      },
      async getPublishedReview(id) {
        const result = await client.query(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE id = $1::uuid AND status = 'published' AND withdrawn_at IS NULL`,
          [id]
        );
        const row = result.rows[0];
        if (!row) return null;
        return toAdminItem({
          id: row.id,
          productId: row.product_id,
          author: row.author_name,
          text: row.body,
          media: publicMediaFromJson(row.media),
          publishedAt: row.decided_at
        });
      },
      async withdrawReview(id, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE product_reviews
           SET withdrawn_at = $3::timestamptz, withdrawn_by_user_id = $2::bigint
           WHERE id = $1::uuid AND status = 'published' AND withdrawn_at IS NULL
           RETURNING id`,
          [id, moderatorUserId, atIso]
        );
        if (result.rows.length > 0) return "withdrawn";
        const existing = await client.query(`SELECT id FROM product_reviews WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_published" : "missing";
      },
      async editPublishedReview(id, patch) {
        const found = await client.query(
          `SELECT status, withdrawn_at::text, media FROM product_reviews WHERE id = $1::uuid FOR UPDATE`,
          [id]
        );
        const row = found.rows[0];
        if (!row) return { result: "missing" };
        if (row.status !== "published" || row.withdrawn_at != null) return { result: "not_published" };
        const remove = new Set(patch.removeMediaSrc ?? []);
        const raw = Array.isArray(row.media) ? row.media : [];
        const kept = raw.filter((item) => {
          if (!item || typeof item !== "object") return true;
          const src = item.src;
          return !(typeof src === "string" && remove.has(src));
        });
        await client.query(
          `UPDATE product_reviews
           SET body = COALESCE($2::text, body),
               author_name = CASE WHEN $3::boolean THEN $4::text ELSE author_name END,
               product_id = COALESCE($5::text, product_id),
               media = $6::jsonb
           WHERE id = $1::uuid`,
          [
            id,
            patch.text ?? null,
            patch.author !== void 0,
            patch.author ?? null,
            patch.productId ?? null,
            JSON.stringify(kept)
          ]
        );
        return { result: "updated", removedMedia: raw.length - kept.length };
      },
      async upsertWebinar(input, nowIso) {
        if (input.youtubeVideoId) {
          const found = await client.query(
            `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE youtube_video_id = $1 FOR UPDATE`,
            [input.youtubeVideoId]
          );
          const row = found.rows[0];
          if (row) {
            const existing = webinarFrom(row);
            if (existing.status === "pending" || existing.status === "published") return { result: "duplicate", webinar: existing };
            const reopened = reopenedRecord(existing, input, nowIso);
            await client.query(`UPDATE webinars SET ${WEBINAR_WRITE_SET} WHERE id = $1::uuid`, webinarValues(reopened));
            return { result: "reopened", webinar: reopened };
          }
        }
        const created = newWebinarRecord(input, nowIso);
        const inserted = await client.query(
          `INSERT INTO webinars (
             id, title, speaker, event_date, source_type, youtube_video_id, start_seconds, recording_src,
             youtube_title, youtube_published_at, metadata_status, status, created_at, updated_at,
             published_at, withdrawn_at, moderator_user_id, content_id, source_chat_id, source_message_mid
           ) VALUES (
             $1::uuid, $2, $3, $4::date, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12, $13::timestamptz,
             $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::bigint, $18::uuid, $19::bigint, $20
           )
           ON CONFLICT (youtube_video_id) DO NOTHING
           RETURNING id`,
          webinarValues(created)
        );
        if (inserted.rows.length === 0 && input.youtubeVideoId) {
          const raced = await client.query(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE youtube_video_id = $1`, [input.youtubeVideoId]);
          const row = raced.rows[0];
          if (row) return { result: "duplicate", webinar: webinarFrom(row) };
        }
        return { result: "created", webinar: created };
      },
      async getWebinar(id) {
        const result = await client.query(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE id = $1::uuid`, [id]);
        const row = result.rows[0];
        return row ? webinarFrom(row) : null;
      },
      async findWebinarByContent(contentId) {
        const result = await client.query(
          `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE content_id = $1::uuid ORDER BY updated_at DESC LIMIT 1`,
          [contentId]
        );
        const row = result.rows[0];
        return row ? webinarFrom(row) : null;
      },
      async listWebinars(status, limit, offset) {
        const order = status === "pending" ? "created_at ASC, id ASC" : status === "published" ? "published_at DESC, id ASC" : "updated_at DESC, id ASC";
        const result = await client.query(
          `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE status = $1 ORDER BY ${order} LIMIT $2 OFFSET $3`,
          [status, limit, offset]
        );
        return result.rows.map(webinarFrom);
      },
      async countWebinars(status) {
        const result = await client.query(`SELECT count(*)::text AS count FROM webinars WHERE status = $1`, [status]);
        return Number(result.rows[0]?.count ?? 0);
      },
      async updatePendingWebinar(id, fields, nowIso) {
        const result = await client.query(
          `UPDATE webinars
           SET title = $2, speaker = $3, event_date = $4::date, youtube_title = $5,
               youtube_published_at = $6::timestamptz, metadata_status = $7, updated_at = $8::timestamptz
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id, fields.title, fields.speaker, fields.eventDate, fields.youtubeTitle, fields.youtubePublishedAt, fields.metadataStatus, nowIso]
        );
        if (result.rows.length > 0) return "updated";
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_pending" : "missing";
      },
      async publishWebinar(id, moderatorUserId, atIso) {
        const found = await client.query(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE id = $1::uuid FOR UPDATE`, [id]);
        const row = found.rows[0];
        if (!row) return "missing";
        const record = webinarFrom(row);
        const blocked = publishCheck(record);
        if (blocked) return blocked;
        await client.query(
          `UPDATE webinars
           SET status = 'published', published_at = $3::timestamptz, withdrawn_at = NULL,
               moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid`,
          [id, moderatorUserId, atIso]
        );
        if (record.contentId) {
          await client.query(`UPDATE incoming_content SET status = 'published' WHERE id = $1::uuid AND status = 'pending'`, [record.contentId]);
        }
        return "published";
      },
      async rejectWebinar(id, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE webinars
           SET status = 'rejected', moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING content_id::text`,
          [id, moderatorUserId, atIso]
        );
        const row = result.rows[0];
        if (row) {
          if (row.content_id) {
            await client.query(`UPDATE incoming_content SET status = 'rejected' WHERE id = $1::uuid AND status = 'pending'`, [row.content_id]);
          }
          return "rejected";
        }
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_pending" : "missing";
      },
      async withdrawWebinar(id, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE webinars
           SET status = 'withdrawn', withdrawn_at = $3::timestamptz, moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid AND status = 'published'
           RETURNING id`,
          [id, moderatorUserId, atIso]
        );
        if (result.rows.length > 0) return "withdrawn";
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id]);
        return existing.rows.length > 0 ? "not_published" : "missing";
      },
      async withdrawWebinarsForContent(contentId, atIso) {
        const result = await client.query(
          `UPDATE webinars
           SET status = 'withdrawn', withdrawn_at = $2::timestamptz, updated_at = $2::timestamptz
           WHERE content_id = $1::uuid AND status IN ('pending', 'published')
           RETURNING id`,
          [contentId, atIso]
        );
        return result.rows.length;
      },
      async searchWebinars(query) {
        const where = [];
        const values = [];
        if (query.status) {
          values.push(query.status);
          where.push(`status = $${values.length}`);
        }
        for (const word of query.q.split(/\s+/).filter(Boolean).slice(0, 8)) {
          values.push(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
          const n = values.length;
          where.push(`(coalesce(title, '') ILIKE $${n} OR coalesce(speaker, '') ILIKE $${n} OR coalesce(youtube_video_id, '') ILIKE $${n} OR coalesce(youtube_title, '') ILIKE $${n})`);
        }
        const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const total = await client.query(`SELECT count(*)::text AS count FROM webinars ${cond}`, values);
        const rows = await client.query(
          `SELECT ${WEBINAR_COLUMNS} FROM webinars ${cond}
           ORDER BY (status = 'pending') DESC, coalesce(published_at, updated_at) DESC, id ASC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, query.limit, query.offset]
        );
        return { total: Number(total.rows[0]?.count ?? 0), items: rows.rows.map(webinarFrom) };
      },
      async lockWebinar(id) {
        const result = await client.query(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE id = $1::uuid FOR UPDATE`, [id]);
        const row = result.rows[0];
        return row ? webinarFrom(row) : null;
      },
      async saveWebinarEdit(record) {
        if (record.youtubeVideoId) {
          const taken = await client.query(`SELECT id FROM webinars WHERE youtube_video_id = $1 AND id <> $2::uuid`, [
            record.youtubeVideoId,
            record.id
          ]);
          if (taken.rows.length > 0) return "conflict";
        }
        await client.query(`UPDATE webinars SET ${WEBINAR_WRITE_SET} WHERE id = $1::uuid`, webinarValues(record));
        return "updated";
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
          `SELECT id::text, product_id, author_name, body, media
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
            text: row.body,
            media: publicMediaFromJson(row.media)
          })
        );
      });
    },
    async listPublicWebinars() {
      return withClient(async (client) => {
        const result = await client.query(
          `SELECT ${WEBINAR_COLUMNS}
           FROM webinars
           WHERE status = 'published' AND withdrawn_at IS NULL
           ORDER BY COALESCE(event_date::timestamptz, published_at) DESC, id ASC
           LIMIT 100`
        );
        return result.rows.map(webinarFrom).map(toPublicWebinar).filter((item) => item != null);
      });
    },
    async getGroupContent(id) {
      return withClient(async (client) => {
        const result = await client.query(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind,
                  body_text, public_text, attachments, status, published_review_id::text
           FROM incoming_content
           WHERE id = $1::uuid`,
          [id]
        );
        const row = result.rows[0];
        return row ? contentFrom(row) : null;
      });
    },
    async updateGroupAttachments(id, attachments) {
      await withClient(async (client) => {
        await client.query(`UPDATE incoming_content SET attachments = $2::jsonb WHERE id = $1::uuid`, [
          id,
          JSON.stringify(attachments)
        ]);
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

// server/max/miniAppOpen.ts
function readMiniAppOpenConfig(env = process.env) {
  const contactRaw = env.MAX_BOT_CONTACT_ID?.trim() ?? "";
  let contactId = null;
  if (/^[1-9][0-9]{0,15}$/.test(contactRaw) && Number.isSafeInteger(Number(contactRaw))) {
    contactId = Number(contactRaw);
  }
  const webApp = env.MAX_WEB_APP_ID?.trim() || null;
  const publicUrl = env.MAX_MINI_APP_URL?.trim() || null;
  return { contactId, webApp, publicUrl: publicUrl && /^https:\/\//i.test(publicUrl) ? publicUrl : null };
}

// server/max/productionDeps.ts
var pool;
var poolUrl;
function sqlPoolFor(databaseUrl) {
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
  return {
    async connect() {
      const client = await active.connect();
      return {
        query: (text, values) => client.query(text, values),
        release: () => client.release()
      };
    }
  };
}
function storeFor(databaseUrl) {
  return createPostgresStore(sqlPoolFor(databaseUrl));
}
function productionDeps(env = process.env) {
  const secret = env.MAX_WEBHOOK_SECRET ?? "";
  const secretConfigured = secretIsValid(secret);
  const token = env.MAX_BOT_TOKEN?.trim() ?? "";
  const tokenConfigured = tokenIsValid(token);
  const moderators = readModeratorIds(env.MAX_REVIEW_MODERATOR_IDS);
  const chats = readChatIds(env.MAX_ALLOWED_CHAT_IDS);
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const blobToken = env.BLOB_READ_WRITE_TOKEN?.trim() || null;
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
    deliveryBudgetMs: 8e3,
    blobToken,
    youtubeApiKey: env.YOUTUBE_API_KEY?.trim() || null,
    miniApp: readMiniAppOpenConfig(env)
  };
}

// server/max/http.ts
var MAX_BODY_BYTES = 256 * 1024;
function jsonResponse(status, body, extra) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

// server/max/reviewsHttp.ts
async function handleReviewsRequest(request, deps) {
  if (request.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "GET" });
  if (!deps.store) return jsonResponse(503, { error: "unavailable" });
  let productId;
  try {
    productId = new URL(request.url).searchParams.get("productId");
  } catch {
    return jsonResponse(400, { error: "bad_request" });
  }
  if (productId !== null && !findProduct(productId)) return jsonResponse(400, { error: "unknown_product" });
  try {
    const reviews = await deps.store.listPublished(productId);
    return jsonResponse(
      200,
      {
        reviews: reviews.map((review) => ({
          id: review.id,
          productId: review.productId,
          author: review.author,
          text: review.text,
          media: review.media
        }))
      },
      { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" }
    );
  } catch {
    deps.log.error("storage_failed");
    return jsonResponse(503, { error: "unavailable" });
  }
}

// server/entries/reviews.ts
var reviews_default = {
  async fetch(request) {
    const deps = productionDeps();
    return handleReviewsRequest(request, { store: deps.store, log: deps.log });
  }
};
export {
  reviews_default as default
};
