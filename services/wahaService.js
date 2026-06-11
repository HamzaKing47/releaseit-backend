import fetch from "node-fetch";
import WhatsappSession from "../models/WhatsappSession.js";

/* ──────────────────────────────────────────────
   WAHA Config
   ────────────────────────────────────────────── */
const WAHA_URL = (process.env.WAHA_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const WAHA_APIKEY = process.env.WAHA_APIKEY || "releaseit123";
const BACKEND_URL = (
  process.env.BACKEND_URL || "http://localhost:5000"
).replace(/\/$/, "");

// WAHA Core (free) only supports a single session named "default".
// Set WAHA_CORE=true for local/dev testing on the free image.
// Leave it false (or unset) for WAHA Plus where per-shop sessions work.
const SINGLE_SESSION =
  (process.env.WAHA_CORE || "").toLowerCase() === "true" ||
  !!process.env.WAHA_SESSION_NAME;
const FORCED_SESSION_NAME = process.env.WAHA_SESSION_NAME || "default";

const wahaHeaders = {
  "Content-Type": "application/json",
  "X-Api-Key": WAHA_APIKEY,
};

/* ──────────────────────────────────────────────
   In-memory per-shop registry
   ────────────────────────────────────────────── */
// shop → { status, qrCode, msgHandlers, pollTimer, onConnected, onDisconnected }
const clients = new Map();

/* ──────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */

// Each Shopify shop gets its own WAHA session — derive name from shop domain.
// On WAHA Core (single-session mode), all shops share the "default" session.
export const getSessionName = (shop) =>
  SINGLE_SESSION
    ? FORCED_SESSION_NAME
    : `s_${shop.replace(/[^a-zA-Z0-9]/g, "_")}`;

// Reverse: session name → shop. We can't reliably reverse, so we keep a map.
const sessionToShop = new Map();

// Map WAHA status → app status (connected | waiting_qr | starting | connecting | disconnected)
const mapWahaStatus = (s) => {
  switch ((s || "").toUpperCase()) {
    case "WORKING":
      return "connected";
    case "SCAN_QR_CODE":
      return "waiting_qr";
    case "STARTING":
      return "starting";
    case "PAIRING":
    case "CONNECTING":
      return "connecting";
    case "STOPPED":
    case "FAILED":
    default:
      return "disconnected";
  }
};

const wahaFetch = async (path, method = "GET", body = null) => {
  const res = await fetch(`${WAHA_URL}${path}`, {
    method,
    headers: wahaHeaders,
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(
      `WAHA ${method} ${path} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
};

const ensureClient = (shop) => {
  if (!clients.has(shop)) {
    clients.set(shop, {
      status: "disconnected",
      qrCode: null,
      msgHandlers: [],
      pollTimer: null,
    });
  }
  sessionToShop.set(getSessionName(shop), shop);
  return clients.get(shop);
};

/* ──────────────────────────────────────────────
   Session lifecycle
   ────────────────────────────────────────────── */

const createSession = async (shop) => {
  const session = getSessionName(shop);
  const webhookUrl = `${BACKEND_URL}/api/whatsapp/webhook`;

  // Try update-or-create. WAHA Core: POST /api/sessions creates.
  try {
    return await wahaFetch("/api/sessions", "POST", {
      name: session,
      start: true,
      config: {
        webhooks: [
          {
            url: webhookUrl,
            events: ["message", "session.status"],
            hmac: null,
            retries: { delaySeconds: 2, attempts: 15 },
          },
        ],
        noweb: { store: { enabled: true, fullSync: false } },
      },
    });
  } catch (err) {
    // 422: already exists → update it
    if (err.status === 422 || (err.body && /exists/i.test(JSON.stringify(err.body)))) {
      try {
        await wahaFetch(`/api/sessions/${session}`, "PUT", {
          config: {
            webhooks: [
              { url: webhookUrl, events: ["message", "session.status"] },
            ],
            noweb: { store: { enabled: true, fullSync: false } },
          },
        });
      } catch (e) {
        console.warn(`[WAHA] Update session warn: ${e.message}`);
      }
      try {
        await wahaFetch(`/api/sessions/${session}/start`, "POST");
      } catch (e) {
        if (!/already/i.test(e.message)) console.warn(`[WAHA] Start warn: ${e.message}`);
      }
      return;
    }
    throw err;
  }
};

const startPolling = (shop) => {
  const client = ensureClient(shop);
  if (client.pollTimer) return;

  const tick = async () => {
    try {
      const session = getSessionName(shop);
      const data = await wahaFetch(`/api/sessions/${session}`);
      const newStatus = mapWahaStatus(data.status);
      const c = clients.get(shop);
      if (!c) return;

      const prev = c.status;
      c.status = newStatus;

      if (newStatus === "waiting_qr" && !c.qrCode) {
        c.qrCode = await fetchQR(shop);
      }
      if (newStatus === "connected") {
        c.qrCode = null;
        if (prev !== "connected") {
          await WhatsappSession.findOneAndUpdate(
            { shop },
            { status: "connected" },
            { upsert: true },
          );
          c.onConnected?.();
          // Slow poll once connected — every 30s
          clearInterval(c.pollTimer);
          c.pollTimer = setInterval(tick, 30000);
        }
      } else if (newStatus === "disconnected" && prev !== "disconnected") {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "disconnected" },
          { upsert: true },
        );
        c.onDisconnected?.();
      } else if (prev !== newStatus) {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: newStatus },
          { upsert: true },
        );
      }
    } catch (err) {
      console.warn(`[WAHA] poll[${shop}]: ${err.message}`);
    }
  };

  // Fast poll while pairing — every 3s
  client.pollTimer = setInterval(tick, 3000);
  // Immediate first tick
  tick();
};

const stopPolling = (shop) => {
  const c = clients.get(shop);
  if (c?.pollTimer) {
    clearInterval(c.pollTimer);
    c.pollTimer = null;
  }
};

const fetchQR = async (shop) => {
  const session = getSessionName(shop);
  // Prefer raw text → controller wraps via QRCode.toDataURL
  try {
    const data = await wahaFetch(`/api/${session}/auth/qr?format=raw`);
    if (data?.value) return data.value;
    if (typeof data === "string") return data;
  } catch (err) {
    console.warn(`[WAHA] QR raw fetch: ${err.message}`);
  }
  // Fallback: get PNG as data URL — controller will pass through
  try {
    const res = await fetch(`${WAHA_URL}/api/${session}/auth/qr.png`, {
      headers: { "X-Api-Key": WAHA_APIKEY },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
};

/* ──────────────────────────────────────────────
   Public API — mirrors baileyService
   ────────────────────────────────────────────── */

export const getOrCreateClient = async (
  shop,
  onQR,
  onConnected,
  onDisconnected,
) => {
  const client = ensureClient(shop);
  client.onConnected = onConnected;
  client.onDisconnected = onDisconnected;

  console.log(`[WAHA] Starting: ${shop}`);
  try {
    await createSession(shop);
  } catch (err) {
    console.error(`[WAHA] Create session error: ${err.message}`);
    throw err;
  }

  startPolling(shop);
  // Note: onQR is invoked via polling once QR is ready (status === waiting_qr)
  return client;
};

export const sendMessage = async (shop, phone, text) => {
  const session = getSessionName(shop);
  const chatId = formatChatId(phone);
  await wahaFetch("/api/sendText", "POST", {
    session,
    chatId,
    text,
  });
  console.log(`[WAHA] ✅ Sent to ${phone}`);
};

export const getClientStatus = (shop) =>
  clients.get(shop)?.status || "disconnected";

// Query WAHA for the REAL session state. The in-memory `clients` map is wiped
// on every backend restart, so it falsely reports "disconnected" even when the
// WAHA session is still paired (the session persists in the WAHA volume). This
// asks WAHA directly, re-syncs the in-memory state, and resumes polling — so
// both the admin UI and order-message sending reflect the truth after restarts.
export const getLiveStatus = async (shop) => {
  try {
    const session = getSessionName(shop);
    const data = await wahaFetch(`/api/sessions/${session}`);
    const mapped = mapWahaStatus(data.status);
    const c = ensureClient(shop);
    c.status = mapped;
    if (mapped === "connected") {
      if (!c.pollTimer) startPolling(shop);
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "connected" },
        { upsert: true },
      ).catch(() => {});
    }
    return mapped;
  } catch {
    return clients.get(shop)?.status || "disconnected";
  }
};

export const getClientQR = (shop) => clients.get(shop)?.qrCode || null;

export const onMessage = (shop, handler) => {
  const c = ensureClient(shop);
  c.msgHandlers.push(handler);
};

export const disconnectClient = async (shop) => {
  const session = getSessionName(shop);
  stopPolling(shop);
  try {
    await wahaFetch(`/api/sessions/${session}/logout`, "POST");
  } catch (e) {
    console.warn(`[WAHA] logout: ${e.message}`);
  }
  try {
    await wahaFetch(`/api/sessions/${session}`, "DELETE");
  } catch (e) {
    console.warn(`[WAHA] delete: ${e.message}`);
  }
  clients.delete(shop);
  sessionToShop.delete(session);
  await WhatsappSession.findOneAndUpdate(
    { shop },
    { status: "disconnected" },
    { upsert: true },
  );
  console.log(`[WAHA] Disconnected: ${shop}`);
};

/* ──────────────────────────────────────────────
   Webhook ingest — call this from the /webhook route
   ────────────────────────────────────────────── */
export const handleWebhookEvent = (body) => {
  try {
    const sessionName = body?.session;
    const event = body?.event;
    const payload = body?.payload || {};

    const shop = sessionToShop.get(sessionName);
    if (!shop) {
      console.log(`[WAHA] webhook for unknown session: ${sessionName}`);
      return;
    }

    if (event === "session.status") {
      const newStatus = mapWahaStatus(payload.status);
      const c = clients.get(shop);
      if (c) c.status = newStatus;
      console.log(`[WAHA] status[${shop}]: ${newStatus}`);
      return;
    }

    if (event === "message") {
      if (payload.fromMe) return;
      const from = payload.from || "";
      // Skip groups, broadcasts, and channel/newsletter messages
      if (
        !from ||
        from.endsWith("@g.us") ||
        from.endsWith("@broadcast") ||
        from.endsWith("@newsletter")
      )
        return;

      // Prefer the real phone number — WhatsApp sometimes delivers
      // a LID (Linked Device ID) instead of @c.us. Try payload.author or
      // payload._data.notifyName fallbacks where WAHA exposes them.
      let phone =
        payload.participant?.replace(/@.*$/, "") ||
        payload.author?.replace(/@.*$/, "") ||
        from.replace(/@.*$/, "");

      // LIDs are >12 digits and end with @lid in newer WAHA versions.
      // We still pass them through so handlers can match on last 10 digits,
      // but log a clear hint.
      const isLid = from.endsWith("@lid") || phone.length > 13;
      const text = (payload.body || "").toString().trim();
      if (!phone || !text) return;
      console.log(
        `[WAHA] msg[${shop}] from ${phone}${isLid ? " (LID)" : ""}: "${text}"`,
      );
      const c = clients.get(shop);
      c?.msgHandlers?.forEach((h) => {
        try {
          h({ phone, text });
        } catch (e) {
          console.error(`[WAHA] handler err: ${e.message}`);
        }
      });
    }
  } catch (err) {
    console.error(`[WAHA] webhook parse: ${err.message}`);
  }
};

/* ──────────────────────────────────────────────
   Resume all previously-connected shops on boot
   ────────────────────────────────────────────── */
export const reconnectAllShops = async () => {
  try {
    const sessions = await WhatsappSession.find({
      status: { $in: ["connected", "waiting_qr", "connecting", "starting"] },
    });
    console.log(`[WAHA] Resuming ${sessions.length} shop(s)...`);
    for (const s of sessions) {
      try {
        await getOrCreateClient(
          s.shop,
          null,
          () => console.log(`[WAHA] ✅ Resumed: ${s.shop}`),
          () => console.log(`[WAHA] ❌ Resume failed: ${s.shop}`),
        );
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        console.error(`[WAHA] resume ${s.shop}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[WAHA] reconnectAll: ${e.message}`);
  }
};

/* ──────────────────────────────────────────────
   Phone helpers (same as baileyService)
   ────────────────────────────────────────────── */
export const formatChatId = (phone) => {
  let n = (phone || "").toString().replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  if (n.length === 10) n = "92" + n;
  return `${n}@c.us`;
};

export const formatWaNumber = (phone) => {
  let n = (phone || "").toString().replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  return n;
};
