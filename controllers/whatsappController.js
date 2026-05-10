import WhatsappSession from "../models/WhatsappSession.js";
import Shop from "../models/Shop.js";
import {
  startSession,
  deleteSession,
  getSessionStatus,
  getQRImage,
  sendTextMessage,
  setWebhook,
  formatWaNumber,
  getSessionName,
} from "../services/wahaService.js";
import fetch from "node-fetch";

const BACKEND_URL =
  process.env.BACKEND_URL || "https://releaseit-backend.onrender.com";
const SHOPIFY_API_VERSION = "2024-01";

/* ============================================================
   SHOPIFY HELPER
============================================================ */
const shopifyReq = async (
  shop,
  token,
  endpoint,
  method = "GET",
  body = null,
) => {
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

/* ============================================================
   GET SETTINGS
============================================================ */
export const getWhatsappSettings = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });

    const session = await WhatsappSession.findOne({ shop });
    const waStatus = await getSessionStatus(shop);

    // WAHA status → our status
    const statusMap = {
      WORKING: "connected",
      SCAN_QR_CODE: "waiting_qr",
      STARTING: "connecting",
      STOPPED: "disconnected",
      FAILED: "disconnected",
    };
    const status = statusMap[waStatus] || "disconnected";

    // Sync DB status
    if (session && session.status !== status) {
      await WhatsappSession.findOneAndUpdate({ shop }, { status });
    }

    res.json({
      success: true,
      status,
      whatsappNumber: session?.whatsappNumber || "",
      enabled: session?.enabled ?? true,
      sendOnOrderCreate: session?.sendOnOrderCreate ?? true,
      sendOnFulfillment: session?.sendOnFulfillment ?? true,
      sendOnCancellation: session?.sendOnCancellation ?? false,
      messageTemplate: session?.messageTemplate || "",
    });
  } catch (err) {
    console.error("[WA] getSettings:", err.message);
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   SAVE SETTINGS
============================================================ */
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
        whatsappNumber: whatsappNumber || "",
        enabled: enabled ?? true,
        sendOnOrderCreate: sendOnOrderCreate ?? true,
        sendOnFulfillment: sendOnFulfillment ?? true,
        sendOnCancellation: sendOnCancellation ?? false,
        messageTemplate: messageTemplate || "",
        updatedAt: new Date(),
      },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[WA] saveSettings:", err.message);
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   CONNECT — WAHA session start karo
============================================================ */
export const connectWhatsapp = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });

    // Already connected?
    const waStatus = await getSessionStatus(shop);
    if (waStatus === "WORKING") {
      return res.json({ success: true, status: "connected" });
    }

    // Session start karo
    await startSession(shop);

    // Webhook set karo
    const webhookUrl = `${BACKEND_URL}/api/whatsapp/webhook`;
    await setWebhook(shop, webhookUrl);

    await WhatsappSession.findOneAndUpdate(
      { shop },
      { status: "connecting" },
      { upsert: true },
    );

    res.json({ success: true, status: "starting" });
  } catch (err) {
    console.error("[WA] Connect:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   GET QR — frontend poll karega
============================================================ */
export const getQRCode = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });

    const waStatus = await getSessionStatus(shop);
    console.log(`[WA] QR poll — WAHA status: ${waStatus}`);

    if (waStatus === "WORKING") {
      await WhatsappSession.findOneAndUpdate(
        { shop },
        { status: "connected" },
        { upsert: true },
      );
      return res.json({ success: true, status: "connected" });
    }

    if (waStatus === "SCAN_QR_CODE") {
      const qrImage = await getQRImage(shop);
      if (qrImage) {
        await WhatsappSession.findOneAndUpdate(
          { shop },
          { status: "waiting_qr" },
          { upsert: true },
        );
        return res.json({
          success: true,
          status: "waiting_qr",
          qrCode: qrImage,
        });
      }
    }

    res.json({ success: true, status: "starting" });
  } catch (err) {
    console.error("[WA] getQR:", err.message);
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   CHECK STATUS
============================================================ */
export const checkStatus = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    const waStatus = await getSessionStatus(shop);
    const statusMap = {
      WORKING: "connected",
      SCAN_QR_CODE: "waiting_qr",
      STARTING: "connecting",
      STOPPED: "disconnected",
      FAILED: "disconnected",
    };
    res.json({ success: true, status: statusMap[waStatus] || "disconnected" });
  } catch {
    res.json({ success: true, status: "disconnected" });
  }
};

/* ============================================================
   DISCONNECT
============================================================ */
export const disconnectWhatsapp = async (req, res) => {
  try {
    const { shop } = req.body;
    await deleteSession(shop);
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { status: "disconnected" },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   WEBHOOK — WAHA se incoming messages
============================================================ */
export const handleWebhook = async (req, res) => {
  res.status(200).json({ received: true });

  try {
    const body = req.body;
    // WAHA webhook format
    const event = body.event;
    const payload = body.payload;
    const session = body.session; // shop ka session name

    if (event !== "message") return;

    // Session name se shop dhundo
    const sessionDoc = await WhatsappSession.findOne({});
    const allSessions = await WhatsappSession.find({});
    const shopDoc = allSessions.find((s) => getSessionName(s.shop) === session);

    if (!shopDoc) {
      console.log(`[WA] No shop found for session: ${session}`);
      return;
    }

    const shop = shopDoc.shop;
    const phone = payload?.from?.replace("@c.us", "") || "";
    const text = payload?.body?.trim() || "";

    if (!phone || !text) return;
    console.log(`[WA] Message [${shop}] from ${phone}: "${text}"`);

    const msg = text.toUpperCase();
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
    console.error("[WA] Webhook error:", err.message);
  }
};

/* ============================================================
   SEND ORDER CONFIRMATION
============================================================ */
export const sendOrderConfirmation = async (shop, order) => {
  try {
    const session = await WhatsappSession.findOne({ shop });
    if (!session?.enabled || !session?.sendOnOrderCreate) return;

    const waStatus = await getSessionStatus(shop);
    if (waStatus !== "WORKING") return;

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

    const storeNumber = session.whatsappNumber
      ? formatWaNumber(session.whatsappNumber)
      : null;

    const confirmLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=CONFIRM-${orderCode}`
      : null;
    const addressLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=ADDRESS-${orderCode}`
      : null;
    const cancelLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=CANCEL-${orderCode}`
      : null;

    const template = session.messageTemplate || getDefaultTemplate();
    let message = buildMessage(template, {
      name,
      orderName,
      currency,
      total,
      address,
    });

    if (storeNumber) {
      message = message
        .replace("1️⃣ - Confirm Order", `✅ *Confirm Order:*\n${confirmLink}`)
        .replace("2️⃣ - Update Address", `📍 *Update Address:*\n${addressLink}`)
        .replace("3️⃣ - Cancel Order", `❌ *Cancel Order:*\n${cancelLink}`);
    }

    await sendTextMessage(shop, phone, message);
    console.log(`[WA] ✅ Order confirmation sent: ${order.name}`);
  } catch (err) {
    console.error("[WA] sendOrderConfirmation:", err.message);
  }
};

/* ============================================================
   TEST MESSAGE
============================================================ */
export const sendTestMessage = async (req, res) => {
  try {
    const { shop, phone } = req.body;
    if (!shop || !phone) return res.status(400).json({ success: false });

    const waStatus = await getSessionStatus(shop);
    if (waStatus !== "WORKING") {
      return res
        .status(400)
        .json({ success: false, message: "WhatsApp not connected" });
    }

    await sendTextMessage(
      shop,
      phone,
      `✅ *ReleaseIt Test Message*\n\nYour WhatsApp automation is working! 🎉\n\nThis is a test from your Shopify store.`,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   REPLY HANDLERS
============================================================ */
const handleConfirm = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendTextMessage(
      shop,
      phone,
      "❌ Order not found. Please contact support.",
    );
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
  await sendTextMessage(
    shop,
    phone,
    `✅ *Order Confirmed!*\n\nThank you! Your order *${order.name}* is confirmed.\n\nWe will dispatch it soon. 🚚`,
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
  await sendTextMessage(
    shop,
    phone,
    `📍 *Update Delivery Address*\n\nPlease type your new complete address and send it.\n\n_Example: House 12, Street 4, Block B, Lahore_`,
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
  const normalPhone = phone.replace(/\D/g, "");
  const order = data.orders?.find((o) => {
    const oPhone = (
      o.shipping_address?.phone ||
      o.customer?.phone ||
      ""
    ).replace(/\D/g, "");
    return (
      oPhone.slice(-10) === normalPhone.slice(-10) &&
      o.tags?.includes("Pending Address Update")
    );
  });
  if (!order) return;

  const cleanedTags = order.tags
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
        tags: cleanedTags,
        shipping_address: { ...order.shipping_address, address1: newAddress },
      },
    },
  );
  await sendTextMessage(
    shop,
    phone,
    `✅ *Address Updated!*\n\nNew address:\n📍 _${newAddress}_\n\nYour order *${order.name}* is confirmed! 🎉`,
  );
};

const handleCancel = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendTextMessage(
      shop,
      phone,
      "❌ Order not found. Please contact support.",
    );
    return;
  }
  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}/cancel.json`,
    "POST",
    { reason: "customer", email: false },
  );
  await sendTextMessage(
    shop,
    phone,
    `❌ *Order Cancelled*\n\nYour order *${order.name}* has been cancelled.\n\nFeel free to order again! 🛍️`,
  );
};

/* ============================================================
   HELPERS
============================================================ */
const findOrder = async (shop, phone, orderCode) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return { shopData: null, order: null };

  const normalPhone = phone.replace(/\D/g, "");

  if (orderCode) {
    const data = await shopifyReq(
      shop,
      shopData.accessToken,
      `orders.json?name=%23${orderCode}&status=open`,
    );
    if (data.orders?.[0]) return { shopData, order: data.orders[0] };
  }

  const data = await shopifyReq(
    shop,
    shopData.accessToken,
    "orders.json?status=open&limit=10",
  );
  const order =
    data.orders?.find((o) => {
      const oPhone = (
        o.shipping_address?.phone ||
        o.customer?.phone ||
        ""
      ).replace(/\D/g, "");
      return oPhone.slice(-10) === normalPhone.slice(-10);
    }) || null;
  return { shopData, order };
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

const getDefaultTemplate = () =>
  `🛍️ *New Order!*

Hello {{name}}!

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`;
