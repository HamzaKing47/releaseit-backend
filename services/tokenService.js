/* ──────────────────────────────────────────────────────────────
   Expiring offline access tokens

   As of 2026 Shopify rejects non-expiring offline tokens on the Admin
   API. We must request EXPIRING tokens (expiring=1). Those last ~1 hour
   and come with a 90-day refresh token. This service:

     • exchangeSessionToken() — mint an expiring offline token from an
       App Bridge session (id) token.
     • getValidAccessToken()  — return a currently-valid access token for
       a shop, transparently refreshing it with the refresh token when it
       has expired (so customer-facing order/product calls keep working
       even when no merchant is present).
   ────────────────────────────────────────────────────────────── */

import axios from "axios";
import Shop from "../models/Shop.js";

const CLIENT_ID = process.env.SHOPIFY_API_KEY;
const CLIENT_SECRET = process.env.SHOPIFY_API_SECRET;

// Refresh a little before actual expiry to avoid edge-of-expiry failures.
const EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes

const tokenUrl = (shop) => `https://${shop}/admin/oauth/access_token`;

// Persist a token-endpoint response onto the Shop record.
const persistTokens = async (shop, data) => {
  const now = Date.now();
  const update = { accessToken: data.access_token };
  if (data.expires_in) {
    update.accessTokenExpiresAt = new Date(now + data.expires_in * 1000);
  }
  if (data.refresh_token) {
    update.refreshToken = data.refresh_token;
    update.refreshTokenExpiresAt = data.refresh_token_expires_in
      ? new Date(now + data.refresh_token_expires_in * 1000)
      : null;
  }
  await Shop.findOneAndUpdate({ shop }, { shop, ...update }, { upsert: true });
  return update;
};

// Called on every admin load. A fresh token exchange REVOKES the previous
// expiring token + its refresh token (Shopify allows only one active per
// shop). So only exchange when we don't already hold a usable refresh token —
// otherwise we'd revoke the chain the customer-facing flow depends on.
export const ensureToken = async (shop, sessionToken) => {
  const shopData = await Shop.findOne({ shop });
  const atExpiresAt = shopData?.accessTokenExpiresAt
    ? new Date(shopData.accessTokenExpiresAt).getTime()
    : 0;

  // If the current access token is still valid AND we have a refresh token,
  // leave the chain alone (a new exchange would revoke it). Otherwise do a
  // fresh exchange — this also self-heals a stale/revoked chain in one step.
  if (
    shopData?.refreshToken &&
    atExpiresAt - EXPIRY_BUFFER_MS > Date.now()
  ) {
    return { skipped: true };
  }

  await exchangeSessionToken(shop, sessionToken);
  return { skipped: false };
};

// Exchange an App Bridge session token for an EXPIRING offline token.
export const exchangeSessionToken = async (shop, sessionToken) => {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: "1",
  });

  const { data } = await axios.post(tokenUrl(shop), body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  await persistTokens(shop, data);
  return data;
};

// Use the stored refresh token to mint a fresh access + refresh token.
const refreshAccessToken = async (shop, refreshToken) => {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const { data } = await axios.post(tokenUrl(shop), body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  await persistTokens(shop, data);
  return data.access_token;
};

// Return a valid access token, refreshing it if it has (nearly) expired.
export const getValidAccessToken = async (shop) => {
  const shopData = await Shop.findOne({ shop });
  if (!shopData) throw new Error("Shop not found in DB");

  const expiresAt = shopData.accessTokenExpiresAt
    ? new Date(shopData.accessTokenExpiresAt).getTime()
    : 0;

  // Still valid (with buffer) → use as-is.
  if (expiresAt && expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return shopData.accessToken;
  }

  // Expired/unknown but we have a refresh token → refresh it.
  if (shopData.refreshToken) {
    try {
      return await refreshAccessToken(shop, shopData.refreshToken);
    } catch (err) {
      console.error(
        "[Token] refresh failed:",
        err.response?.data || err.message,
      );
      // The refresh token is dead (expired or revoked by a newer exchange).
      // Clear it so the next admin app open performs a fresh token exchange.
      await Shop.findOneAndUpdate(
        { shop },
        { refreshToken: "", refreshTokenExpiresAt: null, accessTokenExpiresAt: null },
      );
      throw new Error(
        "Access token expired and refresh failed. Merchant must re-open the app.",
      );
    }
  }

  // No expiry metadata and no refresh token = legacy/non-expiring token.
  // Returning it will fail on the Admin API; signal that a refresh is needed.
  if (!expiresAt && !shopData.refreshToken) {
    throw new Error(
      "No expiring token stored yet. Merchant must open the app once to authorize.",
    );
  }

  return shopData.accessToken;
};
