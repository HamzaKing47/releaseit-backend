import WhatsappSession from "../models/WhatsappSession.js";
import Shop from "../models/Shop.js";
import {
  getOrCreateClient,
  sendMessage,
  getClientStatus,
  getClientQR,
  disconnectClient,
  onMessage,
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

    const liveStatus = getClientStatus(shop);
    if (liveStatus === "connected") {
      return res.json({ success: true, status: "connected" });
    }

    const existingQR = getClientQR(shop);
    if (existingQR) {
      const qrImage = await QRCode.toDataURL(existingQR);
      return res.json({ success: true, status: "waiting_qr", qrCode: qrImage });
    }

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
          registerMessageHandler(shop);
        },
        () => console.log(`[WA] Disconnected: ${shop}`),
      ).then(() => {
        if (!qrResolved) {
          const check = setInterval(() => {
            if (getClientStatus(shop) === "connected") {
              qrResolved = true;
              clearInterval(check);
              resolve({ status: "connected" });
              registerMessageHandler(shop);
            }
          }, 500);
          setTimeout(() => clearInterval(check), 15000);
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
  res.json({ success: true, status: getClientStatus(shop) });
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
   SEND ORDER CONFIRMATION
   wa.me clickable links ke saath
============================================================ */
export const sendOrderConfirmation = async (shop, order) => {
  try {
    const session = await WhatsappSession.findOne({ shop });
    if (!session?.enabled || !session?.sendOnOrderCreate) return;
    if (getClientStatus(shop) !== "connected") return;

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

    // Order code — links mein embed hoga (e.g. 1001 from #1001)
    const orderCode = orderName.replace("#", "").trim();

    // Store ka WhatsApp number — links mein use hoga
    const storeNumber = session.whatsappNumber
      ? formatWaNumber(session.whatsappNumber)
      : null;

    // wa.me links banao
    const confirmLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=CONFIRM-${orderCode}`
      : null;
    const addressLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=ADDRESS-${orderCode}`
      : null;
    const cancelLink = storeNumber
      ? `https://wa.me/${storeNumber}?text=CANCEL-${orderCode}`
      : null;

    // Message build karo
    const template = session.messageTemplate || getDefaultTemplate();
    let message = buildMessage(template, {
      name,
      orderName,
      currency,
      total,
      address,
    });

    // Agar store number available hai to links inject karo
    if (storeNumber) {
      message = message
        .replace("1️⃣ - Confirm Order", `✅ *Confirm Order:*\n${confirmLink}`)
        .replace("2️⃣ - Update Address", `📍 *Update Address:*\n${addressLink}`)
        .replace("3️⃣ - Cancel Order", `❌ *Cancel Order:*\n${cancelLink}`);
    }

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
   REGISTER MESSAGE HANDLER
   CONFIRM-1001 / ADDRESS-1001 / CANCEL-1001 handle karo
============================================================ */
export const registerMessageHandler = (shop) => {
  onMessage(shop, async ({ phone, text }) => {
    try {
      const msg = text.trim().toUpperCase();

      if (msg.startsWith("CONFIRM-")) {
        const orderCode = msg.replace("CONFIRM-", "").trim();
        await handleConfirm(shop, phone, orderCode);
      } else if (msg.startsWith("ADDRESS-")) {
        const orderCode = msg.replace("ADDRESS-", "").trim();
        await handleAddressRequest(shop, phone, orderCode);
      } else if (msg.startsWith("CANCEL-")) {
        const orderCode = msg.replace("CANCEL-", "").trim();
        await handleCancel(shop, phone, orderCode);
      } else {
        // Free text — check karo kya address update pending hai
        await handleAddressReceived(shop, phone, text);
      }
    } catch (err) {
      console.error("[WA] Message handler:", err.message);
    }
  });
};

/* ============================================================
   REPLY HANDLERS
============================================================ */

// ✅ CONFIRM
const handleConfirm = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendMessage(
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

  await sendMessage(
    shop,
    phone,
    `✅ *Order Confirmed!*\n\nThank you! Your order *${order.name}* is confirmed.\n\nWe will dispatch it soon. 🚚`,
  );
  console.log(`[WA] ✅ Confirmed: ${order.name}`);
};

// 📍 ADDRESS REQUEST
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

  await sendMessage(
    shop,
    phone,
    `📍 *Update Delivery Address*\n\nPlease type your new complete address and send it.\n\n_Example: House 12, Street 4, Block B, Lahore_`,
  );
};

// 📍 ADDRESS RECEIVED (free text)
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

  await sendMessage(
    shop,
    phone,
    `✅ *Address Updated!*\n\nNew address saved:\n📍 _${newAddress}_\n\nYour order *${order.name}* is confirmed! 🎉`,
  );
  console.log(`[WA] ✅ Address updated: ${order.name}`);
};

// ❌ CANCEL
const handleCancel = async (shop, phone, orderCode) => {
  const { shopData, order } = await findOrder(shop, phone, orderCode);
  if (!order) {
    await sendMessage(
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
  console.log(`[WA] ✅ Cancelled: ${order.name}`);
};

/* ============================================================
   HELPERS
============================================================ */

// Order dhundo — pehle orderCode se, phir phone se
const findOrder = async (shop, phone, orderCode) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) return { shopData: null, order: null };

  const normalPhone = phone.replace(/\D/g, "");

  // Pehle specific order code se dhundo
  if (orderCode) {
    const data = await shopifyReq(
      shop,
      shopData.accessToken,
      `orders.json?name=%23${orderCode}&status=open`,
    );
    const order = data.orders?.[0] || null;
    if (order) return { shopData, order };
  }

  // Fallback: phone se latest order dhundo
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

// WhatsApp number format: 923001234567 (no + no spaces)
const formatWaNumber = (num) =>
  num.replace(/\D/g, "").replace(/^0(\d{10})$/, "92$1"); // 03001234567 → 923001234567

const getDefaultTemplate = () =>
  `🛍️ *New Order!*

Hello {{name}}!

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`;
