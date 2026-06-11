import WhatsappSession from "../models/WhatsappSession.js";
import Shop from "../models/Shop.js";
import { getValidAccessToken } from "../services/tokenService.js";

// 🔀 WhatsApp backend selector — set WHATSAPP_PROVIDER=baileys to use the legacy lib
const PROVIDER = (process.env.WHATSAPP_PROVIDER || "waha").toLowerCase();

const waha = await import("../services/wahaService.js");
const baileys =
  PROVIDER === "baileys" ? await import("../services/baileyService.js") : null;
const svc = PROVIDER === "baileys" ? baileys : waha;

const {
  getOrCreateClient,
  sendMessage,
  getClientStatus,
  getClientQR,
  disconnectClient,
  onMessage,
  formatWaNumber,
} = svc;

// WAHA-only: webhook event ingester
const handleWebhookEvent = waha.handleWebhookEvent;

// Live status query (falls back to in-memory for the baileys provider).
// Whenever the session is confirmed connected, (re)register the incoming-reply
// handler — idempotent — so CONFIRM / UPDATE ADDRESS / CANCEL replies keep
// working even after a backend restart (where the in-memory handler was lost).
const getLiveStatus = async (shop) => {
  const status = waha.getLiveStatus
    ? await waha.getLiveStatus(shop)
    : getClientStatus(shop);
  if (status === "connected") registerMessageHandler(shop);
  return status;
};

import fetch from "node-fetch";
import QRCode from "qrcode";
import { configureSender, enqueueMessage } from "../services/messageQueue.js";
import {
  canSendMessage,
  recordMessageSent,
  getUsage,
  markNumberConnected,
  clearNumberConnected,
} from "../services/messageUsage.js";

// Limit-aware sender: checks the shop's monthly quota AND today's
// (possibly warm-up-throttled) daily cap before sending, records the
// send on success. The message queue calls this.
const limitedSender = async (shop, phone, text) => {
  const { allowed, reason } = await canSendMessage(shop);
  if (!allowed) {
    console.log(
      `[Usage] ${shop} hit ${reason} limit — message skipped` +
        (reason === "daily"
          ? " (will resume tomorrow / protects number from bans)"
          : ""),
    );
    return; // silently drop — admin panel shows the limit warning
  }
  await sendMessage(shop, phone, text);
  await recordMessageSent(shop);
};

// Route all queued sends through the limit-aware sender.
configureSender(limitedSender);

const SHOPIFY_API_VERSION = "2024-01";

const shopifyReq = async (
  shop,
  _token, // ignored — we always fetch a fresh (auto-refreshed) token below
  endpoint,
  method = "GET",
  body = null,
) => {
  // Always use a currently-valid token so reply actions (tag/cancel/address)
  // keep working past the ~1h expiry of the stored offline token.
  const token = await getValidAccessToken(shop);
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      ...(body && { body: JSON.stringify(body) }),
    },
  );
  return res.json();
};

const mapStatus = (s) =>
  ({
    connected: "connected",
    waiting_qr: "waiting_qr",
    connecting: "connecting",
    disconnected: "disconnected",
  })[s] || "disconnected";

/* ── GET SETTINGS ── */
export const getWhatsappSettings = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });
    const session = await WhatsappSession.findOne({ shop });
    const status = await getLiveStatus(shop);
    const usage = await getUsage(shop);
    res.json({
      success: true,
      status,
      whatsappNumber: session?.whatsappNumber || "",
      enabled: session?.enabled ?? true,
      sendOnOrderCreate: session?.sendOnOrderCreate ?? true,
      sendOnFulfillment: session?.sendOnFulfillment ?? true,
      sendOnCancellation: session?.sendOnCancellation ?? false,
      messageTemplate: session?.messageTemplate || "",
      usage,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ── GET USAGE (standalone, for polling the usage bar) ── */
export const getWhatsappUsage = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });
    const usage = await getUsage(shop);
    res.json({ success: true, usage });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ── SAVE SETTINGS ── */
export const saveWhatsappSettings = async (req, res) => {
  try {
    const {
      shop,
      whatsappNumber,
      enabled,
      sendOnOrderCreate,
      sendOnFulfillment,
      sendOnCancellation,
      messageTemplate,
    } = req.body;
    if (!shop) return res.status(400).json({ success: false });
    await WhatsappSession.findOneAndUpdate(
      { shop },
      {
        whatsappNumber,
        enabled,
        sendOnOrderCreate,
        sendOnFulfillment,
        sendOnCancellation,
        messageTemplate,
        updatedAt: new Date(),
      },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ── CONNECT ── */
export const connectWhatsapp = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });

    if (getClientStatus(shop) === "connected") {
      return res.json({ success: true, status: "connected" });
    }

    const existingQR = getClientQR(shop);
    if (existingQR) {
      const qrImage = await QRCode.toDataURL(existingQR);
      return res.json({ success: true, status: "waiting_qr", qrCode: qrImage });
    }

    // Start async — immediately return
    getOrCreateClient(
      shop,
      async (qr) => {
        console.log(`[WA] QR ready for: ${shop}`);
      },
      () => {
        registerMessageHandler(shop);
        markNumberConnected(shop); // starts the warm-up clock (idempotent)
      },
      () => {
        console.log(`[WA] Disconnected: ${shop}`);
      },
    ).catch((e) => console.error(`[WA] Client error: ${e.message}`));

    res.json({ success: true, status: "starting" });
  } catch (err) {
    console.error("[WA] Connect:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── GET QR (poll) ── */
export const getQRCode = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    const status = getClientStatus(shop);

    if (status === "connected") {
      return res.json({ success: true, status: "connected" });
    }

    const qr = getClientQR(shop);
    if (qr) {
      const qrImage = qr.startsWith("data:image")
        ? qr
        : await QRCode.toDataURL(qr);
      return res.json({ success: true, status: "waiting_qr", qrCode: qrImage });
    }

    res.json({ success: true, status: "starting" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ── STATUS ── */
export const checkStatus = async (req, res) => {
  const shop = req.query.shop?.replace(/\/$/, "");
  res.json({ success: true, status: await getLiveStatus(shop) });
};

/* ── DISCONNECT ── */
export const disconnectWhatsapp = async (req, res) => {
  try {
    const { shop } = req.body;
    await disconnectClient(shop);
    // Reset the warm-up clock — connecting a different number later
    // should restart the gradual ramp from scratch.
    await clearNumberConnected(shop);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ── TEST MESSAGE ── */
export const sendTestMessage = async (req, res) => {
  try {
    const { shop, phone } = req.body;
    if (!shop || !phone) return res.status(400).json({ success: false });
    if ((await getLiveStatus(shop)) !== "connected") {
      return res
        .status(400)
        .json({ success: false, message: "WhatsApp not connected" });
    }
    await sendMessage(
      shop,
      phone,
      `✅ *ReleaseIt Test*\n\nWhatsApp automation is working! 🎉`,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── ORDER CONFIRMATION ── */
export const sendOrderConfirmation = async (shop, order) => {
  try {
    const session = await WhatsappSession.findOne({ shop });
    if (!session?.enabled || !session?.sendOnOrderCreate) return;
    // Use the LIVE WAHA status — the in-memory status is empty after a restart
    // even though the WAHA session is still paired, which silently dropped
    // confirmation messages.
    const liveStatus = await getLiveStatus(shop);
    if (liveStatus !== "connected") {
      console.error(
        `[WA] order confirm skipped — WhatsApp not connected (status=${liveStatus})`,
      );
      return;
    }

    const phone = order.shipping_address?.phone || order.customer?.phone;
    if (!phone) return;

    const name =
      order.shipping_address?.first_name ||
      order.customer?.first_name ||
      "Customer";
    const orderName = order.name || "";
    const currency = order.currency || "PKR";
    const total = order.total_price || "0";
    const address = [
      order.shipping_address?.address1,
      order.shipping_address?.city,
    ]
      .filter(Boolean)
      .join(", ");
    const orderCode = orderName.replace("#", "").trim();
    const storeNum = session.whatsappNumber
      ? formatWaNumber(session.whatsappNumber)
      : null;

    const confirmLink = storeNum
      ? `https://wa.me/${storeNum}?text=CONFIRM-${orderCode}`
      : null;
    const addressLink = storeNum
      ? `https://wa.me/${storeNum}?text=ADDRESS-${orderCode}`
      : null;
    const cancelLink = storeNum
      ? `https://wa.me/${storeNum}?text=CANCEL-${orderCode}`
      : null;

    const template = session.messageTemplate || getDefaultTemplate();
    let message = buildMessage(template, {
      name,
      orderName,
      currency,
      total,
      address,
    });

    if (storeNum) {
      message = message
        .replace("1️⃣ - Confirm Order", `✅ *Confirm Order:*\n${confirmLink}`)
        .replace("2️⃣ - Update Address", `📍 *Update Address:*\n${addressLink}`)
        .replace("3️⃣ - Cancel Order", `❌ *Cancel Order:*\n${cancelLink}`);
    }

    // Queue it — paced sending protects the WhatsApp number under bursts
    enqueueMessage(shop, phone, message, { order: order.name });
    console.log(`[WA] 📥 Queued: ${order.name}`);
  } catch (err) {
    console.error("[WA] sendOrderConfirmation:", err.message);
  }
};

/* ── MESSAGE HANDLER ── */
// Track which shops already have a handler so we never register twice
// (would cause every reply to be processed N times).
const handlerRegistered = new Set();

export const registerMessageHandler = (shop) => {
  if (handlerRegistered.has(shop)) return;
  handlerRegistered.add(shop);

  onMessage(shop, async ({ phone, text }) => {
    try {
      const msg = text.trim().toUpperCase();
      if (msg.startsWith("CONFIRM-"))
        await handleConfirm(shop, phone, msg.replace("CONFIRM-", "").trim());
      else if (msg.startsWith("ADDRESS-"))
        await handleAddressRequest(
          shop,
          phone,
          msg.replace("ADDRESS-", "").trim(),
        );
      else if (msg.startsWith("CANCEL-"))
        await handleCancel(shop, phone, msg.replace("CANCEL-", "").trim());
      else await handleAddressReceived(shop, phone, text);
    } catch (err) {
      console.error("[WA] Handler:", err.message);
    }
  });
};

/* ── RESUME ON BOOT ──
   Called from server.js after MongoDB connects. Resumes every connected
   shop's WhatsApp session AND re-registers its message handler — so
   incoming CONFIRM / CANCEL / ADDRESS replies keep working after a restart. */
export const resumeConnectedShops = async () => {
  try {
    const sessions = await WhatsappSession.find({
      status: { $in: ["connected", "waiting_qr", "connecting", "starting"] },
    });
    console.log(`[WA] Resuming ${sessions.length} shop(s) + handlers...`);
    for (const s of sessions) {
      // Register the handler FIRST so no early message is missed
      registerMessageHandler(s.shop);
      try {
        await getOrCreateClient(
          s.shop,
          null,
          () => {
            registerMessageHandler(s.shop); // idempotent — safe
            markNumberConnected(s.shop); // idempotent — safe
            console.log(`[WA] ✅ Resumed: ${s.shop}`);
          },
          () => console.log(`[WA] ❌ Resume failed: ${s.shop}`),
        );
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        console.error(`[WA] resume ${s.shop}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`[WA] resumeConnectedShops: ${e.message}`);
  }
};

/* ── REPLY HANDLERS ── */
const handleConfirm = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendMessage(shop, phone, "❌ Order not found.");
    return;
  }
  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}.json`,
    "PUT",
    {
      order: {
        id: order.id,
        tags: mergeTags(order.tags, ["Order Confirmed", "COD Confirmed"]),
      },
    },
  );
  await sendMessage(
    shop,
    phone,
    `✅ *Order Confirmed!*\n\nYour order *${order.name}* is confirmed. We'll dispatch soon! 🚚`,
  );
  console.log(`[WA] ✅ Confirmed: ${order.name}`);
};

const handleAddressRequest = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (order) {
    await shopifyReq(
      shop,
      shopData.accessToken,
      `orders/${order.id}.json`,
      "PUT",
      {
        order: {
          id: order.id,
          tags: mergeTags(order.tags, ["Pending Address Update"]),
        },
      },
    );
  }
  const currentAddress = order
    ? [order.shipping_address?.address1, order.shipping_address?.city]
        .filter(Boolean)
        .join(", ")
    : "";
  await sendMessage(
    shop,
    phone,
    `📍 *Update Address*\n\nYour current address:\n_${currentAddress || "—"}_\n\nReply with your *new complete address* and we'll update it instantly. ✏️`,
  );
};

const handleAddressReceived = async (shop, phone, newAddress) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return;
  const data = await shopifyReq(
    shop,
    shopData.accessToken,
    "orders.json?status=open&limit=10",
  );
  const np = phone.replace(/\D/g, "");
  const order = data.orders?.find((o) => {
    const op = (o.shipping_address?.phone || o.customer?.phone || "").replace(
      /\D/g,
      "",
    );
    return (
      op.slice(-10) === np.slice(-10) &&
      o.tags?.includes("Pending Address Update")
    );
  });
  if (!order) return;
  const tags = order.tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "Pending Address Update")
    .concat(["Address Updated", "Order Confirmed", "COD Confirmed"])
    .join(", ");
  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}.json`,
    "PUT",
    {
      order: {
        id: order.id,
        tags,
        shipping_address: { ...order.shipping_address, address1: newAddress },
      },
    },
  );
  await sendMessage(
    shop,
    phone,
    `✅ *Address Updated!*\n📍 _${newAddress}_\n\nOrder *${order.name}* confirmed! 🎉`,
  );
};

const handleCancel = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendMessage(shop, phone, "❌ Order not found.");
    return;
  }
  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}/cancel.json`,
    "POST",
    { reason: "customer", email: false },
  );
  await sendMessage(
    shop,
    phone,
    `❌ *Order Cancelled*\n\nOrder *${order.name}* cancelled. Feel free to order again! 🛍️`,
  );
};

const findOrder = async (shop, phone, orderCode) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return { shopData: null, order: null };
  const np = phone.replace(/\D/g, "");
  if (orderCode) {
    const d = await shopifyReq(
      shop,
      shopData.accessToken,
      `orders.json?name=%23${orderCode}&status=open`,
    );
    if (d.orders?.[0]) return { shopData, order: d.orders[0] };
  }
  const d = await shopifyReq(
    shop,
    shopData.accessToken,
    "orders.json?status=open&limit=10",
  );
  return {
    shopData,
    order:
      d.orders?.find((o) => {
        const op = (
          o.shipping_address?.phone ||
          o.customer?.phone ||
          ""
        ).replace(/\D/g, "");
        return op.slice(-10) === np.slice(-10);
      }) || null,
  };
};

const mergeTags = (existing, newTags) => {
  const arr = (existing || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set([...arr, ...newTags])].join(", ");
};

const buildMessage = (template, vars) =>
  template
    .replace(/{{name}}/g, vars.name)
    .replace(/{{orderName}}/g, vars.orderName)
    .replace(/{{currency}}/g, vars.currency)
    .replace(/{{total}}/g, vars.total)
    .replace(/{{address}}/g, vars.address);

const getDefaultTemplate = () => `🛍️ *New Order!*

Hello {{name}}!

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`;

/* ── WEBHOOK (WAHA → us) ── */
export const handleWebhook = async (req, res) => {
  // Ack fast — WAHA retries on non-2xx
  res.status(200).json({ received: true });
  try {
    if (PROVIDER === "waha" && handleWebhookEvent) {
      handleWebhookEvent(req.body);
    }
  } catch (err) {
    console.error("[WA Webhook]", err.message);
  }
};
