/* ──────────────────────────────────────────────────────────────
   GDPR / compliance + app-lifecycle webhooks.

   Shopify REQUIRES these three GDPR webhooks for App Store apps:
     • customers/data_request — a shopper asked the merchant for their data
     • customers/redact        — erase a specific shopper's data
     • shop/redact             — erase ALL data for a shop (48h after uninstall)

   Plus app/uninstalled — fired when a merchant removes the app, so we can
   immediately revoke stored tokens and stop WhatsApp for that shop.

   All routes are HMAC-verified (see verifyShopifyWebhook middleware), so only
   genuine Shopify requests reach these handlers. Each acks 200 quickly —
   Shopify retries on any non-2xx.

   What customer data we actually store: nothing beyond lightweight OrderLog
   rows (phone/email/ip) used for fraud rate-limiting, which also auto-expire
   after 30 days. We hold no shopper profiles.
   ────────────────────────────────────────────────────────────── */

import Shop from "../models/Shop.js";
import WhatsappSession from "../models/WhatsappSession.js";
import Pixel from "../models/Pixel.js";
import OrderLog from "../models/OrderLog.js";
import ContactMessage from "../models/ContactMessage.js";

/* POST /api/webhooks/customers/data_request
   We don't build shopper profiles — only short-lived fraud order-logs. There's
   nothing to hand back automatically; the merchant fulfils the request. Log + ack. */
export const customersDataRequest = (req, res) => {
  const shop = req.get("X-Shopify-Shop-Domain");
  const customerId = req.body?.customer?.id;
  console.log(
    `[GDPR] customers/data_request — shop=${shop} customer=${customerId} (no stored profile data)`,
  );
  res.status(200).send("OK");
};

/* POST /api/webhooks/customers/redact
   Erase any data we hold about this specific shopper (fraud order-logs keyed
   by their email / phone). */
export const customersRedact = async (req, res) => {
  res.status(200).send("OK"); // ack first — Shopify retries on non-2xx
  try {
    const shop = req.get("X-Shopify-Shop-Domain");
    const c = req.body?.customer || {};
    const or = [];
    if (c.email) or.push({ email: c.email });
    if (Array.isArray(c.phone) ? c.phone.length : c.phone)
      or.push({ phone: c.phone });
    if (!shop || or.length === 0) return;

    const r = await OrderLog.deleteMany({ shop, $or: or });
    console.log(
      `[GDPR] customers/redact — shop=${shop} removed ${r.deletedCount} order log(s)`,
    );
  } catch (err) {
    console.error("[GDPR] customers/redact error:", err.message);
  }
};

/* POST /api/webhooks/shop/redact
   Fired ~48h after a shop uninstalls. Wipe EVERYTHING we store for that shop. */
export const shopRedact = async (req, res) => {
  res.status(200).send("OK");
  try {
    const shop = req.get("X-Shopify-Shop-Domain") || req.body?.shop_domain;
    if (!shop) return;
    const results = await Promise.allSettled([
      Shop.deleteOne({ shop }),
      WhatsappSession.deleteOne({ shop }),
      Pixel.deleteMany({ shop }),
      OrderLog.deleteMany({ shop }),
      ContactMessage.deleteMany({ shop }),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length)
      console.error(`[GDPR] shop/redact partial failure for ${shop}:`, failed);
    console.log(`[GDPR] shop/redact — wiped all data for ${shop}`);
  } catch (err) {
    console.error("[GDPR] shop/redact error:", err.message);
  }
};

/* POST /api/webhooks/app/uninstalled
   Merchant removed the app. The stored offline token is now invalid, so revoke
   it immediately and stop WhatsApp. (Full data wipe happens later via shop/redact.) */
export const appUninstalled = async (req, res) => {
  res.status(200).send("OK");
  try {
    const shop = req.get("X-Shopify-Shop-Domain") || req.body?.domain;
    if (!shop) return;
    await Shop.findOneAndUpdate(
      { shop },
      {
        accessToken: "",
        refreshToken: "",
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    );
    await WhatsappSession.deleteOne({ shop });
    console.log(`[App] uninstalled — cleared tokens + WhatsApp session for ${shop}`);
  } catch (err) {
    console.error("[App] app/uninstalled error:", err.message);
  }
};
