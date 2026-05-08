import crypto from "crypto";
import fetch from "node-fetch";

/* ============================================================
   HELPER — hash karna (SHA256) for PII data
============================================================ */
const hash = (val) => {
  if (!val) return undefined;
  return crypto
    .createHash("sha256")
    .update(val.trim().toLowerCase())
    .digest("hex");
};

/* ============================================================
   1. FACEBOOK CONVERSIONS API
   Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
============================================================ */
export const fireFacebookCAPI = async ({
  pixelId,
  accessToken,
  testCode,
  eventName = "Purchase",
  orderId,
  value,
  currency = "PKR",
  phone,
  clientIp,
  clientUserAgent,
}) => {
  if (!pixelId || !accessToken) return;

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;

  const userData = {
    ...(phone && { ph: [hash(phone)] }),
    ...(clientIp && { client_ip_address: clientIp }),
    ...(clientUserAgent && { client_user_agent: clientUserAgent }),
  };

  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_id: String(orderId || Date.now()),
        user_data: userData,
        custom_data: {
          currency,
          value: parseFloat(value) || 0,
          order_id: String(orderId || ""),
        },
      },
    ],
    ...(testCode && { test_event_code: testCode }),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) {
      console.error("[Facebook CAPI Error]", data.error.message);
    } else {
      console.log(
        `[Facebook CAPI] ✅ ${eventName} fired — events_received: ${data.events_received}`,
      );
    }
  } catch (err) {
    console.error("[Facebook CAPI]", err.message);
  }
};

/* ============================================================
   2. TIKTOK EVENTS API
   Docs: https://business-api.tiktok.com/portal/docs
============================================================ */
export const fireTikTokAPI = async ({
  pixelId,
  accessToken,
  eventName = "PlaceAnOrder",
  orderId,
  value,
  currency = "PKR",
  phone,
}) => {
  if (!pixelId || !accessToken) return;

  const url = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

  const body = {
    pixel_code: pixelId,
    event: eventName,
    event_id: String(orderId || Date.now()),
    timestamp: new Date().toISOString(),
    context: {
      user: {
        ...(phone && { phone_number: hash(phone) }),
      },
    },
    properties: {
      currency,
      value: parseFloat(value) || 0,
      order_id: String(orderId || ""),
      content_type: "product",
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": accessToken,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.code !== 0) {
      console.error("[TikTok API Error]", data.message);
    } else {
      console.log(`[TikTok API] ✅ ${eventName} fired`);
    }
  } catch (err) {
    console.error("[TikTok API]", err.message);
  }
};

/* ============================================================
   3. SNAPCHAT CONVERSIONS API
   Docs: https://marketingapi.snapchat.com/docs/conversion.html
============================================================ */
export const fireSnapchatCAPI = async ({
  pixelId,
  accessToken,
  eventName = "PURCHASE",
  orderId,
  value,
  currency = "PKR",
  phone,
}) => {
  if (!pixelId || !accessToken) return;

  const url = "https://tr.snapchat.com/v2/conversion";

  const body = {
    pixel_id: pixelId,
    event_type: eventName,
    event_conversion_type: "WEB",
    timestamp: Date.now(),
    event_tag: String(orderId || ""),
    hashed_phone_number: phone ? hash(phone) : undefined,
    price: parseFloat(value) || 0,
    currency,
    transaction_id: String(orderId || ""),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(`[Snapchat CAPI] ✅ ${eventName} fired`, data.status);
  } catch (err) {
    console.error("[Snapchat CAPI]", err.message);
  }
};

/* ============================================================
   4. PINTEREST CONVERSIONS API
   Docs: https://developers.pinterest.com/docs/conversions/conversions/
============================================================ */
export const firePinterestCAPI = async ({
  pixelId,
  accessToken,
  eventName = "checkout",
  orderId,
  value,
  currency = "PKR",
  phone,
}) => {
  if (!pixelId || !accessToken) return;

  const url = `https://api.pinterest.com/v5/ad_accounts/${pixelId}/events`;

  const body = {
    data: [
      {
        event_name: eventName,
        action_source: "web",
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(orderId || Date.now()),
        user_data: {
          ...(phone && { ph: hash(phone) }),
        },
        custom_data: {
          currency,
          value: String(parseFloat(value) || 0),
          order_id: String(orderId || ""),
        },
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log(
      `[Pinterest CAPI] ✅ ${eventName} fired`,
      data.num_events_received,
    );
  } catch (err) {
    console.error("[Pinterest CAPI]", err.message);
  }
};

/* ============================================================
   MASTER FUNCTION — order place hone pe call karo
   Sab enabled pixels pe server-side event fire karta hai
============================================================ */
export const fireServerSideEvents = async ({
  pixels = [],
  eventName, // "Purchase" | "PlaceAnOrder" etc — platform per override hoga
  orderId,
  value,
  currency = "PKR",
  phone,
  clientIp,
  clientUserAgent,
}) => {
  const promises = pixels
    .filter((p) => p.pixelId && p.accessToken)
    .map((p) => {
      switch (p.type) {
        case "facebook":
          return fireFacebookCAPI({
            pixelId: p.pixelId,
            accessToken: p.accessToken,
            testCode: p.testCode,
            eventName: "Purchase",
            orderId,
            value,
            currency,
            phone,
            clientIp,
            clientUserAgent,
          });

        case "tiktok":
          return fireTikTokAPI({
            pixelId: p.pixelId,
            accessToken: p.accessToken,
            eventName: "PlaceAnOrder",
            orderId,
            value,
            currency,
            phone,
          });

        case "snapchat":
          return fireSnapchatCAPI({
            pixelId: p.pixelId,
            accessToken: p.accessToken,
            eventName: "PURCHASE",
            orderId,
            value,
            currency,
            phone,
          });

        case "pinterest":
          return firePinterestCAPI({
            pixelId: p.pixelId,
            accessToken: p.accessToken,
            eventName: "checkout",
            orderId,
            value,
            currency,
            phone,
          });

        default:
          return Promise.resolve();
      }
    });

  // Sab parallel fire karo — ek fail ho to baaki rok mat
  await Promise.allSettled(promises);
};
