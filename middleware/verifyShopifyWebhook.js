import crypto from "crypto";

/* ──────────────────────────────────────────────────────────────
   Shopify webhook HMAC verification.

   Every genuine Shopify webhook carries an `X-Shopify-Hmac-Sha256`
   header — a base64 HMAC-SHA256 of the RAW request body, keyed with
   the app's API secret. We recompute it and compare in constant time.
   Requests that don't match are rejected (401), so nobody can spoof
   GDPR / uninstall / order webhooks.

   Requires:
     • req.rawBody — the raw request buffer (captured by the
       express.json({ verify }) hook in app.js).
     • process.env.SHOPIFY_API_SECRET — the app's API secret.
   ────────────────────────────────────────────────────────────── */
export const verifyShopifyWebhook = (req, res, next) => {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      console.error("[Webhook] SHOPIFY_API_SECRET not set — rejecting webhook");
      return res.status(401).send("Unauthorized");
    }

    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    if (!hmacHeader || !req.rawBody) {
      return res.status(401).send("Unauthorized");
    }

    const digest = crypto
      .createHmac("sha256", secret)
      .update(req.rawBody)
      .digest("base64");

    const a = Buffer.from(digest);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn(`[Webhook] ✋ invalid HMAC for ${req.originalUrl}`);
      return res.status(401).send("Unauthorized");
    }

    next();
  } catch (err) {
    console.error("[Webhook] HMAC verify error:", err.message);
    return res.status(401).send("Unauthorized");
  }
};
