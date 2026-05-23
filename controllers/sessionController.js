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

import { RequestedTokenType } from "@shopify/shopify-api";
import { shopify } from "../config/shopifyAuth.js";
import Shop from "../models/Shop.js";
import axios from "axios";

const INJECT_SRC = "https://releaseitnow.vercel.app/inject.js";

// Register the storefront COD-button script tag (idempotent).
const ensureScriptTag = async (shop, accessToken) => {
  try {
    const headers = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };
    const existing = await axios.get(
      `https://${shop}/admin/api/2024-01/script_tags.json`,
      { headers },
    );
    const already = (existing.data?.script_tags || []).some(
      (t) => t.src === INJECT_SRC,
    );
    if (already) return;
    await axios.post(
      `https://${shop}/admin/api/2024-01/script_tags.json`,
      { script_tag: { event: "onload", src: INJECT_SRC } },
      { headers },
    );
    console.log("[ScriptTag] ✅ registered:", shop);
  } catch (err) {
    console.error(
      "[ScriptTag] register failed:",
      err.response?.data || err.message,
    );
  }
};

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

    const { session } = await shopify.auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });

    if (!session?.accessToken) {
      return res
        .status(500)
        .json({ success: false, message: "No access token returned" });
    }

    await Shop.findOneAndUpdate(
      { shop },
      { shop, accessToken: session.accessToken },
      { upsert: true },
    );

    console.log(`[TokenExchange] ✅ fresh token stored: ${shop}`);
    // Now that we have a valid token, ensure the COD button script tag exists.
    await ensureScriptTag(shop, session.accessToken);
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
