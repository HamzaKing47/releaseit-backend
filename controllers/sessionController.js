/* ──────────────────────────────────────────────────────────────
   Token Exchange

   Shopify's Admin API now rejects legacy non-expiring offline tokens.
   The modern way to get a valid (expiring) offline token is "Token
   Exchange": the embedded app obtains a short-lived session token from
   App Bridge and sends it here; we exchange it for an offline access
   token and store it on the Shop record. All other API routes then use
   that stored (valid) token.

   The merchant's embedded admin refreshes this token each time it loads,
   keeping it fresh for background/customer-facing operations.
   ────────────────────────────────────────────────────────────── */

import { exchangeSessionToken } from "../services/tokenService.js";

/* ── POST /api/auth/token-exchange ──
   Body: { shop, sessionToken } */
export const tokenExchange = async (req, res) => {
  try {
    let { shop, sessionToken } = req.body;

    // Allow the session token via Authorization: Bearer <token> too.
    if (!sessionToken) {
      const auth = req.headers.authorization || "";
      if (auth.startsWith("Bearer ")) sessionToken = auth.slice(7);
    }
    if (!shop || !sessionToken) {
      return res
        .status(400)
        .json({ success: false, message: "shop and sessionToken required" });
    }
    shop = shop.replace(/\/$/, "");

    // Mint an EXPIRING offline token (expiring=1) + store its refresh token.
    await exchangeSessionToken(shop, sessionToken);

    console.log(`[TokenExchange] ✅ expiring token stored: ${shop}`);
    // COD button is injected via the theme app embed extension — no ScriptTag.
    res.json({ success: true });
  } catch (err) {
    console.error(
      "[TokenExchange] error:",
      err?.response?.data || err.message,
    );
    res
      .status(500)
      .json({ success: false, message: err.message || "Token exchange failed" });
  }
};
