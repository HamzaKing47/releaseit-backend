import makeWASocket, { DisconnectReason, isJidBroadcast } from "baileys";

import WhatsappSession from "../models/WhatsappSession.js";
import pino from "pino";

/* ============================================================
   IN-MEMORY STORE
============================================================ */
const clients = new Map();

/* ============================================================
   MONGODB AUTH STATE — simple version
============================================================ */
const useMongoAuthState = async (shop) => {
  let doc = (await WhatsappSession.findOne({ shop })) || {};

  const saveAll = async (creds, keys) => {
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { creds, keys, updatedAt: new Date() },
      { upsert: true, new: true },
    );
  };

  const state = {
    creds: doc.creds || {},
    keys: {
      get: (type, ids) => {
        const result = {};
        const store = doc.keys || {};
        for (const id of ids) {
          const val = store?.[type]?.[id];
          if (val !== undefined) result[id] = val;
        }
        return result;
      },
      set: async (data) => {
        const store = { ...(doc.keys || {}) };
        for (const [type, typeData] of Object.entries(data)) {
          store[type] = store[type] || {};
          for (const [id, val] of Object.entries(typeData)) {
            if (val) store[type][id] = val;
            else delete store[type][id];
          }
        }
        doc.keys = store;
        await saveAll(doc.creds || {}, store);
      },
    },
  };

  const saveCreds = async (newCreds) => {
    doc.creds = { ...(doc.creds || {}), ...newCreds };
    await saveAll(doc.creds, doc.keys || {});
  };

  return { state, saveCreds };
};

/* ============================================================
   CREATE CLIENT
============================================================ */
export const getOrCreateClient = async (
  shop,
  onQR,
  onConnected,
  onDisconnected,
) => {
  const existing = clients.get(shop);
  if (existing?.socket && existing.status === "connected") {
    console.log(`[Baileys] Already connected: ${shop}`);
    onConnected?.();
    return existing.socket;
  }

  console.log(`[Baileys] Starting client: ${shop}`);

  let state, saveCreds;
  try {
    const auth = await useMongoAuthState(shop);
    state = auth.state;
    saveCreds = auth.saveCreds;
    console.log(`[Baileys] Auth state loaded for: ${shop}`);
  } catch (err) {
    console.error(`[Baileys] Auth state error: ${err.message}`);
    throw err;
  }

  let sock;
  try {
    sock = makeWASocket({
      version: [2, 3000, 1015901307],
      auth: state,
      printQRInTerminal: true, // Server logs mein QR dikhega
      logger: pino({ level: "warn" }),
      browser: ["ReleaseIt", "Chrome", "1.0.0"],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });
    console.log(`[Baileys] Socket created for: ${shop}`);
  } catch (err) {
    console.error(`[Baileys] Socket creation error: ${err.message}`);
    throw err;
  }

  clients.set(shop, {
    socket: sock,
    status: "connecting",
    qrCode: null,
    msgHandlers: [],
  });

  sock.ev.on("creds.update", async (update) => {
    try {
      await saveCreds(update);
    } catch (err) {
      console.error(`[Baileys] creds.update error: ${err.message}`);
    }
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(
      `[Baileys] connection.update for ${shop}:`,
      JSON.stringify({ connection, qr: !!qr }),
    );

    if (qr) {
      console.log(`[Baileys] ✅ QR generated for: ${shop}`);
      const client = clients.get(shop);
      if (client) {
        client.qrCode = qr;
        client.status = "waiting_qr";
      }
      try {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "waiting_qr" },
          { upsert: true },
        );
      } catch (err) {
        console.error(`[Baileys] DB update error on QR: ${err.message}`);
      }
      onQR?.(qr);
    }

    if (connection === "open") {
      console.log(`[Baileys] ✅ Connected: ${shop}`);
      const client = clients.get(shop);
      if (client) {
        client.status = "connected";
        client.qrCode = null;
      }
      try {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "connected" },
          { upsert: true },
        );
      } catch (err) {
        console.error(`[Baileys] DB update error on connect: ${err.message}`);
      }
      onConnected?.();
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(
        `[Baileys] Closed. Code: ${statusCode}, reconnect: ${shouldReconnect}`,
      );

      clients.delete(shop);
      try {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "disconnected" },
          { upsert: true },
        );
      } catch (err) {
        console.error(`[Baileys] DB update error on close: ${err.message}`);
      }

      if (shouldReconnect) {
        console.log(`[Baileys] Reconnecting in 5s: ${shop}`);
        setTimeout(() => {
          getOrCreateClient(shop, onQR, onConnected, onDisconnected).catch(
            (err) => console.error(`[Baileys] Reconnect error: ${err.message}`),
          );
        }, 5000);
      } else {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { creds: null, keys: {}, status: "disconnected" },
          { upsert: true },
        );
        onDisconnected?.();
      }
    }
  });

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

      const client = clients.get(shop);
      client?.msgHandlers?.forEach((h) => h({ phone, text: text.trim() }));
    }
  });

  return sock;
};

/* ── EXPORTS ── */
export const onMessage = (shop, handler) => {
  const client = clients.get(shop);
  if (!client) return;
  if (!client.msgHandlers) client.msgHandlers = [];
  client.msgHandlers.push(handler);
};

export const sendMessage = async (shop, phone, text) => {
  const client = clients.get(shop);
  if (!client?.socket) throw new Error("WhatsApp not connected");
  await client.socket.sendMessage(formatJid(phone), { text });
  console.log(`[Baileys] ✅ Sent to ${phone}`);
};

export const getClientStatus = (shop) =>
  clients.get(shop)?.status || "disconnected";

export const getClientQR = (shop) => clients.get(shop)?.qrCode || null;

export const disconnectClient = async (shop) => {
  const client = clients.get(shop);
  try {
    if (client?.socket) await client.socket.logout();
  } catch (err) {
    console.error(`[Baileys] logout error: ${err.message}`);
  }
  clients.delete(shop);
  await WhatsappSession.findOneAndUpdate(
    { shop },
    { creds: null, keys: {}, status: "disconnected" },
    { upsert: true },
  );
  console.log(`[Baileys] Disconnected: ${shop}`);
};

export const reconnectAllShops = async () => {
  try {
    const sessions = await WhatsappSession.find({
      status: "connected",
      creds: { $ne: null },
    });
    console.log(`[Baileys] Reconnecting ${sessions.length} shop(s)...`);
    for (const session of sessions) {
      try {
        await getOrCreateClient(
          session.shop,
          null,
          () => console.log(`[Baileys] ✅ Reconnected: ${session.shop}`),
          () => console.log(`[Baileys] ❌ Reconnect failed: ${session.shop}`),
        );
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.error(
          `[Baileys] Reconnect error ${session.shop}: ${err.message}`,
        );
      }
    }
  } catch (err) {
    console.error(`[Baileys] reconnectAllShops: ${err.message}`);
  }
};

export const formatJid = (phone) => {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  if (n.length === 10) n = "92" + n;
  return `${n}@s.whatsapp.net`;
};
