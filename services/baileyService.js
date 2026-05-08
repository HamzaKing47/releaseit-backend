import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
} from "baileys";

import WhatsappSession from "../models/WhatsappSession.js";
import pino from "pino";

/* ============================================================
   IN-MEMORY STORE
   shop → { socket, qrCode, status, msgHandlers }
============================================================ */
const clients = new Map();

/* ============================================================
   MONGODB AUTH STATE
   Baileys ka useMultiFileAuthState MongoDB version
============================================================ */
const useMongoAuthState = async (shop) => {
  const getSession = async () => {
    const doc = await WhatsappSession.findOne({ shop });
    return doc || {};
  };

  const saveSession = async (creds, keys) => {
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { creds, keys, updatedAt: new Date() },
      { upsert: true, new: true },
    );
  };

  const doc = await getSession();

  const state = {
    creds: doc.creds || {},
    keys: {
      get: (type, ids) => {
        const data = {};
        const keyStore = doc.keys || {};
        for (const id of ids) {
          const val = keyStore?.[type]?.[id];
          if (val) data[id] = val;
        }
        return data;
      },
      set: async (data) => {
        const keyStore = doc.keys || {};
        for (const [type, typeData] of Object.entries(data)) {
          keyStore[type] = keyStore[type] || {};
          for (const [id, val] of Object.entries(typeData)) {
            if (val) keyStore[type][id] = val;
            else delete keyStore[type][id];
          }
        }
        await saveSession(doc.creds || {}, keyStore);
      },
    },
  };

  const saveCreds = async (newCreds) => {
    const updated = { ...(doc.creds || {}), ...newCreds };
    const keyStore = doc.keys || {};
    await saveSession(updated, keyStore);
    // Update in-memory doc
    doc.creds = updated;
  };

  return { state, saveCreds };
};

/* ============================================================
   CREATE / RECONNECT CLIENT FOR A SHOP
============================================================ */
export const getOrCreateClient = async (
  shop,
  onQR,
  onConnected,
  onDisconnected,
) => {
  // Already connected? Return existing
  const existing = clients.get(shop);
  if (existing?.socket && existing.status === "connected") {
    onConnected?.();
    return existing.socket;
  }

  console.log(`[Baileys] Starting client for shop: ${shop}`);

  const { state, saveCreds } = await useMongoAuthState(shop);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["ReleaseIt", "Chrome", "1.0.0"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  // Store client
  clients.set(shop, { socket: sock, status: "connecting", qrCode: null });

  /* ── CREDS UPDATE ── */
  sock.ev.on("creds.update", saveCreds);

  /* ── CONNECTION EVENTS ── */
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR code aaya
    if (qr) {
      console.log(`[Baileys] QR ready for shop: ${shop}`);
      const client = clients.get(shop);
      if (client) client.qrCode = qr;
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "waiting_qr" },
        { upsert: true },
      );
      onQR?.(qr);
    }

    // Connected
    if (connection === "open") {
      console.log(`[Baileys] ✅ Connected for shop: ${shop}`);
      const client = clients.get(shop);
      if (client) {
        client.status = "connected";
        client.qrCode = null;
      }
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "connected" },
        { upsert: true },
      );
      onConnected?.();
    }

    // Disconnected
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[Baileys] Disconnected (${statusCode}) for shop: ${shop} — reconnect: ${shouldReconnect}`,
      );

      clients.delete(shop);
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "disconnected" },
        { upsert: true },
      );

      if (shouldReconnect) {
        // Auto reconnect after 3 seconds
        setTimeout(() => {
          getOrCreateClient(shop, onQR, onConnected, onDisconnected);
        }, 3000);
      } else {
        // Logged out — session clear karo
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { creds: null, keys: {}, status: "disconnected" },
          { upsert: true },
        );
        onDisconnected?.();
      }
    }
  });

  /* ── INCOMING MESSAGES ── */
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (isJidBroadcast(msg.key.remoteJid || "")) continue;

      const phone = msg.key.remoteJid?.replace("@s.whatsapp.net", "") || "";
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (!phone || !text) continue;

      console.log(`[Baileys] Message from ${phone}: "${text}"`);

      // Message handlers ko call karo
      const client = clients.get(shop);
      client?.msgHandlers?.forEach((handler) =>
        handler({ phone, text: text.trim() }),
      );
    }
  });

  return sock;
};

/* ============================================================
   MESSAGE HANDLER REGISTER
============================================================ */
export const onMessage = (shop, handler) => {
  const client = clients.get(shop);
  if (!client) return;
  if (!client.msgHandlers) client.msgHandlers = [];
  client.msgHandlers.push(handler);
};

/* ============================================================
   SEND MESSAGE
============================================================ */
export const sendMessage = async (shop, phone, text) => {
  const client = clients.get(shop);
  if (!client?.socket) {
    throw new Error("WhatsApp not connected for this shop");
  }

  const jid = formatJid(phone);
  await client.socket.sendMessage(jid, { text });
  console.log(`[Baileys] ✅ Message sent to ${phone}`);
};

/* ============================================================
   GET STATUS
============================================================ */
export const getClientStatus = (shop) => {
  return clients.get(shop)?.status || "disconnected";
};

/* ============================================================
   GET QR
============================================================ */
export const getClientQR = (shop) => {
  return clients.get(shop)?.qrCode || null;
};

/* ============================================================
   DISCONNECT
============================================================ */
export const disconnectClient = async (shop) => {
  const client = clients.get(shop);
  if (client?.socket) {
    await client.socket.logout();
    clients.delete(shop);
  }
  await WhatsappSession.findOneAndUpdate(
    { shop },
    { creds: null, keys: {}, status: "disconnected" },
    { upsert: true },
  );
  console.log(`[Baileys] Disconnected and session cleared: ${shop}`);
};

/* ============================================================
   STARTUP — sab connected shops ko reconnect karo
   Server restart pe call hota hai
============================================================ */
export const reconnectAllShops = async () => {
  try {
    const sessions = await WhatsappSession.find({
      status: "connected",
      enabled: true,
      creds: { $ne: null },
    });

    console.log(`[Baileys] Reconnecting ${sessions.length} shop(s)...`);

    for (const session of sessions) {
      try {
        await getOrCreateClient(
          session.shop,
          null, // QR nahi chahiye on reconnect
          () => console.log(`[Baileys] ✅ Auto-reconnected: ${session.shop}`),
          () =>
            console.log(`[Baileys] ❌ Could not reconnect: ${session.shop}`),
        );
        // Small delay between reconnects
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(
          `[Baileys] Reconnect failed for ${session.shop}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("[Baileys] reconnectAllShops error:", err.message);
  }
};

/* ============================================================
   HELPER — phone to WhatsApp JID
============================================================ */
export const formatJid = (phone) => {
  let cleaned = phone.replace(/\D/g, "");

  // Pakistan: 03001234567 → 923001234567
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = "92" + cleaned.slice(1);
  }

  // 10 digit → add 92
  if (cleaned.length === 10) {
    cleaned = "92" + cleaned;
  }

  return `${cleaned}@s.whatsapp.net`;
};
