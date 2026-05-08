import WhatsappSession from "../models/WhatsappSession.js";
import Shop from "../models/Shop.js";
import {
  getOrCreateClient,
  sendMessage,
  getClientStatus,
  getClientQR,
  disconnectClient,
  onMessage,
  formatJid,
} from "../services/baileyService.js";
import fetch from "node-fetch";
import QRCode from "qrcode";

const SHOPIFY_API_VERSION = "2024-01";

/* ============================================================
   SHOPIFY API HELPER
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
    const liveStatus = getClientStatus(shop);

    res.json({
      success: true,
      status: liveStatus,
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
        enabled: enabled ?? true,
        sendOnOrderCreate: sendOnOrderCreate ?? true,
        sendOnFulfillment: sendOnFulfillment ?? true,
        sendOnCancellation: sendOnCancellation ?? false,
        messageTemplate: messageTemplate || "",
        updatedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    res.json({ success: true });
  } catch (err) {
    console.error("[WA] saveSettings:", err.message);
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   CONNECT — QR generate karo
============================================================ */
export const connectWhatsapp = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) return res.status(400).json({ success: false });

    // Already connected?
    const liveStatus = getClientStatus(shop);
    if (liveStatus === "connected") {
      return res.json({ success: true, status: "connected" });
    }

    // QR already waiting?
    const existingQR = getClientQR(shop);
    if (existingQR) {
      const qrImage = await QRCode.toDataURL(existingQR);
      return res.json({ success: true, status: "waiting_qr", qrCode: qrImage });
    }

    // New connection start karo
    let qrResolved = false;

    const qrPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!qrResolved) reject(new Error("QR timeout"));
      }, 20000);

      getOrCreateClient(
        shop,
        async (qr) => {
          if (!qrResolved) {
            qrResolved = true;
            clearTimeout(timeout);
            const qrImage = await QRCode.toDataURL(qr);
            resolve({ status: "waiting_qr", qrCode: qrImage });
          }
        },
        () => {
          if (!qrResolved) {
            qrResolved = true;
            clearTimeout(timeout);
            resolve({ status: "connected" });
          }
          // Message handler register karo
          registerMessageHandler(shop);
        },
        () => console.log(`[WA] Disconnected: ${shop}`),
      ).then((sock) => {
        // Agar creds already hain to directly connected ho sakta hai
        if (!qrResolved) {
          const checkConnected = setInterval(() => {
            const s = getClientStatus(shop);
            if (s === "connected") {
              qrResolved = true;
              clearInterval(checkConnected);
              resolve({ status: "connected" });
              registerMessageHandler(shop);
            }
          }, 500);
          setTimeout(() => clearInterval(checkConnected), 15000);
        }
      });
    });

    const result = await qrPromise;
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[WA] Connect:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ============================================================
   CHECK STATUS
============================================================ */
export const checkStatus = async (req, res) => {
  const shop = req.query.shop?.replace(/\/$/, "");
  const status = getClientStatus(shop);
  res.json({ success: true, status });
};

/* ============================================================
   DISCONNECT
============================================================ */
export const disconnectWhatsapp = async (req, res) => {
  try {
    const { shop } = req.body;
    await disconnectClient(shop);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

/* ============================================================
   SEND ORDER CONFIRMATION — orderController se call hota hai
============================================================ */
export const sendOrderConfirmation = async (shop, order) => {
  try {
    const session = await WhatsappSession.findOne({ shop });
    if (!session?.enabled || !session?.sendOnOrderCreate) return;
    if (getClientStatus(shop) !== "connected") return;

    const phone = order.shipping_address?.phone || order.customer?.phone;
    if (!phone) return;

    const template = session.messageTemplate || getDefaultTemplate();
    const message = buildMessage(template, {
      name:
        order.shipping_address?.first_name ||
        order.customer?.first_name ||
        "Customer",
      orderName: order.name || "",
      currency: order.currency || "PKR",
      total: order.total_price || "0",
      address: [order.shipping_address?.address1, order.shipping_address?.city]
        .filter(Boolean)
        .join(", "),
    });

    await sendMessage(shop, phone, message);
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

    if (getClientStatus(shop) !== "connected") {
      return res
        .status(400)
        .json({ success: false, message: "WhatsApp not connected" });
    }

    await sendMessage(
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
   REGISTER MESSAGE HANDLER — customer replies handle karna
============================================================ */
export const registerMessageHandler = (shop) => {
  onMessage(shop, async ({ phone, text }) => {
    try {
      const reply = text.trim();
      if (reply === "1") await handleConfirm(shop, phone);
      else if (reply === "2") await handleAddressRequest(shop, phone);
      else if (reply === "3") await handleCancel(shop, phone);
      else await handleAddressReceived(shop, phone, text);
    } catch (err) {
      console.error("[WA] Message handler:", err.message);
    }
  });
};

/* ============================================================
   REPLY HANDLERS
============================================================ */

// 1️⃣ Order Confirm
const handleConfirm = async (shop, phone) => {
  const { shopData, order } = await findOrderByPhone(shop, phone);
  if (!order) {
    await sendMessage(
      shop,
      phone,
      "❌ No pending order found for your number.",
    );
    return;
  }

  const tags = mergeTags(order.tags, ["Order Confirmed", "COD Confirmed"]);
  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}.json`,
    "PUT",
    {
      order: { id: order.id, tags },
    },
  );

  await sendMessage(
    shop,
    phone,
    `✅ *Order Confirmed!*\n\nThank you! Your order *${order.name}* is confirmed.\n\nWe will dispatch it soon. 🚚`,
  );
  console.log(`[WA] ✅ Order confirmed: ${order.name}`);
};

// 2️⃣ Address Update Request
const handleAddressRequest = async (shop, phone) => {
  const { shopData, order } = await findOrderByPhone(shop, phone);

  if (order) {
    const tags = mergeTags(order.tags, ["Pending Address Update"]);
    await shopifyReq(
      shop,
      shopData.accessToken,
      `orders/${order.id}.json`,
      "PUT",
      {
        order: { id: order.id, tags },
      },
    );
  }

  await sendMessage(
    shop,
    phone,
    `📍 *Update Address*\n\nPlease send your new complete delivery address.\n\n_Example: House 12, Street 4, Block B, Lahore_`,
  );
};

// Address received
const handleAddressReceived = async (shop, phone, newAddress) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return;

  const ordersData = await shopifyReq(
    shop,
    shopData.accessToken,
    "orders.json?status=open&limit=10",
  );

  const order = ordersData.orders?.find((o) => {
    const oPhone = (
      o.shipping_address?.phone ||
      o.customer?.phone ||
      ""
    ).replace(/\D/g, "");
    const cPhone = phone.replace(/\D/g, "");
    return (
      oPhone.slice(-10) === cPhone.slice(-10) &&
      o.tags?.includes("Pending Address Update")
    );
  });

  if (!order) return;

  // Address update
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

  await sendMessage(
    shop,
    phone,
    `✅ *Address Updated!*\n\nNew address saved:\n📍 _${newAddress}_\n\nYour order *${order.name}* is confirmed! 🎉`,
  );
  console.log(`[WA] ✅ Address updated: ${order.name}`);
};

// 3️⃣ Cancel Order
const handleCancel = async (shop, phone) => {
  const { shopData, order } = await findOrderByPhone(shop, phone);
  if (!order) {
    await sendMessage(
      shop,
      phone,
      "❌ No pending order found for your number.",
    );
    return;
  }

  await shopifyReq(
    shop,
    shopData.accessToken,
    `orders/${order.id}/cancel.json`,
    "POST",
    {
      reason: "customer",
      email: false,
    },
  );

  await sendMessage(
    shop,
    phone,
    `❌ *Order Cancelled*\n\nYour order *${order.name}* has been cancelled.\n\nFeel free to order again anytime! 🛍️`,
  );
  console.log(`[WA] ✅ Order cancelled: ${order.name}`);
};

/* ============================================================
   HELPERS
============================================================ */
const findOrderByPhone = async (shop, phone) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return { shopData: null, order: null };

  const data = await shopifyReq(
    shop,
    shopData.accessToken,
    "orders.json?status=open&limit=10",
  );

  const normalPhone = phone.replace(/\D/g, "");
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

const getDefaultTemplate = () => `🛍️ *New Order!*

Hello {{name}}!

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

Please reply:
1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`;
