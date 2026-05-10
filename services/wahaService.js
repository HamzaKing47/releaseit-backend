/**
 * wahaService.js
 * WAHA (WhatsApp HTTP API) ke saath communicate karta hai
 * Railway pe deployed WAHA instance se HTTP calls karta hai
 */

import fetch from "node-fetch";

const WAHA_URL =
  process.env.WAHA_URL || "https://waha-production-4f34.up.railway.app";
const WAHA_APIKEY = process.env.WAHA_APIKEY || "releaseit123";

const wahaHeaders = {
  "Content-Type": "application/json",
  "X-Api-Key": WAHA_APIKEY,
};

/* ============================================================
   HELPER
============================================================ */
const wahaFetch = async (path, method = "GET", body = null) => {
  const res = await fetch(`${WAHA_URL}${path}`, {
    method,
    headers: wahaHeaders,
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WAHA ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
};

/* ============================================================
   SESSION MANAGEMENT
   Har merchant ka alag session — session name = shop domain
============================================================ */

// Session name safe banana (dots/special chars hata do)
export const getSessionName = (shop) =>
  shop.replace(/\./g, "-").replace(/[^a-zA-Z0-9-_]/g, "");

// Session start karo (ya already running hai check karo)
export const startSession = async (shop) => {
  const sessionName = getSessionName(shop);
  try {
    // Check karo session already hai?
    const existing = await wahaFetch(`/api/sessions/${sessionName}`);
    console.log(
      `[WAHA] Session exists: ${sessionName} — status: ${existing.status}`,
    );
    return existing;
  } catch {
    // Session nahi hai — create karo
    console.log(`[WAHA] Creating session: ${sessionName}`);
    return await wahaFetch("/api/sessions", "POST", {
      name: sessionName,
      config: {
        noweb: { store: { enabled: true, fullSync: false } },
      },
    });
  }
};

// Session delete karo (disconnect)
export const deleteSession = async (shop) => {
  const sessionName = getSessionName(shop);
  try {
    await wahaFetch(`/api/sessions/${sessionName}`, "DELETE");
    console.log(`[WAHA] Session deleted: ${sessionName}`);
  } catch (err) {
    console.log(`[WAHA] Delete session error (ok): ${err.message}`);
  }
};

// Session status
export const getSessionStatus = async (shop) => {
  const sessionName = getSessionName(shop);
  try {
    const data = await wahaFetch(`/api/sessions/${sessionName}`);
    return data.status; // STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED
  } catch {
    return "STOPPED";
  }
};

/* ============================================================
   QR CODE LENA
============================================================ */
export const getQRCode = async (shop) => {
  const sessionName = getSessionName(shop);
  try {
    const data = await wahaFetch(`/api/screenshot?session=${sessionName}`);
    return data; // base64 image
  } catch {
    // QR endpoint try karo
    try {
      const data = await wahaFetch(`/api/${sessionName}/auth/qr`);
      return data;
    } catch (err) {
      console.error(`[WAHA] QR error: ${err.message}`);
      return null;
    }
  }
};

// QR as image (png)
export const getQRImage = async (shop) => {
  const sessionName = getSessionName(shop);
  try {
    const res = await fetch(`${WAHA_URL}/api/${sessionName}/auth/qr.png`, {
      headers: { "X-Api-Key": WAHA_APIKEY },
    });
    if (!res.ok) return null;
    const buffer = await res.buffer();
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error(`[WAHA] QR image error: ${err.message}`);
    return null;
  }
};

/* ============================================================
   MESSAGE BHEJNA
============================================================ */
export const sendTextMessage = async (shop, phone, text) => {
  const sessionName = getSessionName(shop);
  const chatId = formatChatId(phone);

  await wahaFetch(`/api/sendText`, "POST", {
    session: sessionName,
    chatId,
    text,
  });
  console.log(`[WAHA] ✅ Message sent to ${phone}`);
};

/* ============================================================
   WEBHOOK SET KARNA
   WAHA incoming messages hamare backend pe bhejega
============================================================ */
export const setWebhook = async (shop, webhookUrl) => {
  const sessionName = getSessionName(shop);
  try {
    await wahaFetch(`/api/sessions/${sessionName}`, "PUT", {
      config: {
        webhooks: [
          {
            url: webhookUrl,
            events: ["message"],
          },
        ],
        noweb: { store: { enabled: true, fullSync: false } },
      },
    });
    console.log(`[WAHA] Webhook set: ${webhookUrl}`);
  } catch (err) {
    console.error(`[WAHA] Webhook error: ${err.message}`);
  }
};

/* ============================================================
   HELPER — phone to WhatsApp chatId
============================================================ */
export const formatChatId = (phone) => {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  if (n.length === 10) n = "92" + n;
  return `${n}@c.us`;
};

// wa.me link format
export const formatWaNumber = (phone) => {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  return n;
};
