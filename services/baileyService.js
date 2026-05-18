import baileys from "baileys";

const makeWASocket = baileys.default || baileys;
const DisconnectReason = baileys.DisconnectReason;
const isJidBroadcast = baileys.isJidBroadcast;
const useMultiFileAuthState = baileys.useMultiFileAuthState;

import WhatsappSession from "../models/WhatsappSession.js";
import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clients = new Map();

/* ── AUTH DIR ── */
const getAuthDir = (shop) => {
  const dir = path.join(
    __dirname,
    "..",
    "wa_sessions",
    shop.replace(/\./g, "_"),
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/* ── CREATE CLIENT ── */
export const getOrCreateClient = async (
  shop,
  onQR,
  onConnected,
  onDisconnected,
) => {
  const existing = clients.get(shop);
  if (existing?.socket && existing.status === "connected") {
    onConnected?.();
    return existing.socket;
  }

  console.log(`[Baileys] Starting: ${shop}`);
  const authDir = getAuthDir(shop);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  console.log(`[Baileys] Auth loaded: ${shop}`);

  const sock = makeWASocket({
    version: [2, 3000, 1015901307],
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: "warn" }),
    browser: ["ReleaseIt", "Chrome", "1.0.0"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 15000,
  });

  console.log(`[Baileys] Socket created: ${shop}`);
  clients.set(shop, {
    socket: sock,
    status: "connecting",
    qrCode: null,
    msgHandlers: [],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`[Baileys] update [${shop}]:`, { connection, hasQR: !!qr });

    if (qr) {
      console.log(`[Baileys] ✅ QR ready: ${shop}`);
      const client = clients.get(shop);
      if (client) {
        client.qrCode = qr;
        client.status = "waiting_qr";
      }
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "waiting_qr" },
        { upsert: true },
      );
      onQR?.(qr);
    }

    if (connection === "open") {
      console.log(`[Baileys] ✅ Connected: ${shop}`);
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

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        code !== DisconnectReason.loggedOut &&
        code !== 405 &&
        code !== 401 &&
        code !== 403;
      console.log(
        `[Baileys] Closed [${shop}] code: ${code}, reconnect: ${shouldReconnect}`,
      );

      clients.delete(shop);
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "disconnected" },
        { upsert: true },
      );

      if (shouldReconnect) {
        setTimeout(() => {
          getOrCreateClient(shop, onQR, onConnected, onDisconnected).catch(
            (e) => console.error(`[Baileys] Reconnect err: ${e.message}`),
          );
        }, 5000);
      } else {
        // Clear auth on logout
        try {
          fs.rmSync(getAuthDir(shop), { recursive: true, force: true });
        } catch {}
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "disconnected" },
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
      console.log(`[Baileys] Msg from ${phone}: "${text}"`);
      clients
        .get(shop)
        ?.msgHandlers?.forEach((h) => h({ phone, text: text.trim() }));
    }
  });

  return sock;
};

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
  } catch {}
  clients.delete(shop);
  try {
    fs.rmSync(getAuthDir(shop), { recursive: true, force: true });
  } catch {}
  await WhatsappSession.findOneAndUpdate(
    { shop },
    { status: "disconnected" },
    { upsert: true },
  );
  console.log(`[Baileys] Disconnected: ${shop}`);
};

export const reconnectAllShops = async () => {
  try {
    const sessions = await WhatsappSession.find({ status: "connected" });
    console.log(`[Baileys] Reconnecting ${sessions.length} shop(s)...`);
    for (const s of sessions) {
      try {
        await getOrCreateClient(
          s.shop,
          null,
          () => console.log(`[Baileys] ✅ Reconnected: ${s.shop}`),
          () => console.log(`[Baileys] ❌ Failed: ${s.shop}`),
        );
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        console.error(`[Baileys] ${s.shop}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[Baileys] reconnectAll: ${e.message}`);
  }
};

export const formatJid = (phone) => {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  if (n.length === 10) n = "92" + n;
  return `${n}@s.whatsapp.net`;
};

export const formatWaNumber = (phone) => {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0") && n.length === 11) n = "92" + n.slice(1);
  return n;
};
