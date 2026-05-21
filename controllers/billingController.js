/* ──────────────────────────────────────────────────────────────
   Shopify Billing — MANAGED PRICING

   Why managed pricing (not the charge-creation API):
   Apps created in Shopify's new Dev Dashboard issue *expiring* offline
   tokens, and the legacy non-expiring tokens are rejected by the Admin
   API. Creating charges via the API therefore fails. Shopify's
   recommended modern approach is "Managed Pricing": you configure the
   plans in the Partner Dashboard, Shopify hosts the secure pricing /
   checkout page, and tells us about plan changes via a webhook. No
   token, no charge-creation API call needed from us.

   Flow:
     1. Merchant clicks "Upgrade" → POST /api/billing/subscribe.
     2. We return Shopify's hosted managed-pricing URL.
     3. Frontend redirects merchant there; they pick & approve a plan
        on Shopify's own page (test charge in dev — no real money).
     4. Shopify fires an `app_subscriptions/update` webhook →
        POST /api/billing/webhook → we update the shop's plan in Mongo.
     5. Our app reads the plan from our own DB (never needs the token).
   ────────────────────────────────────────────────────────────── */

import Shop from "../models/Shop.js";
import { setPlan, PLAN_LIMITS } from "../services/messageUsage.js";

const API_VERSION = "2024-01";

// The app's handle (slug) — used to build the managed-pricing URL.
// Find it in your Partner Dashboard app URL, e.g. ".../apps/<handle>".
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "releaseit-plus";

// Billing mode:
//   "direct"  → activate the plan instantly in our DB (used during
//               development / before App Store publication, where the
//               Shopify Billing API isn't available).
//   "managed" → redirect to Shopify's hosted managed-pricing page
//               (used once the app is published with managed pricing
//               configured in the Partner Dashboard).
const BILLING_MODE = (process.env.BILLING_MODE || "direct").toLowerCase();

// Plan catalog — single source of truth for prices and display info.
export const PLANS = {
  free: {
    key: "free",
    name: "Free",
    price: 0,
    interval: "EVERY_30_DAYS",
    messageLimit: PLAN_LIMITS.free,
  },
  starter: {
    key: "starter",
    name: "Starter",
    price: 9.99,
    interval: "EVERY_30_DAYS",
    messageLimit: PLAN_LIMITS.starter,
  },
  growth: {
    key: "growth",
    name: "Growth",
    price: 19.99,
    interval: "EVERY_30_DAYS",
    messageLimit: PLAN_LIMITS.growth,
  },
  pro: {
    key: "pro",
    name: "Pro",
    price: 34.99,
    interval: "EVERY_30_DAYS",
    messageLimit: PLAN_LIMITS.pro,
  },
};

// In dev/test mode Shopify accepts charges with `test: true` —
// merchant sees the confirmation flow but no real money moves.
const IS_TEST = (process.env.SHOPIFY_BILLING_TEST || "true") === "true";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://releaseitnow.vercel.app";
const BACKEND_URL = (
  process.env.BACKEND_URL || "http://localhost:5000"
).replace(/\/$/, "");

/* ── GET /api/billing/plans ── public plan catalog for the UI */
export const getPlans = (req, res) => {
  res.json({
    success: true,
    plans: Object.values(PLANS),
    testMode: IS_TEST,
  });
};

/* ── POST /api/billing/subscribe ──
   Body: { shop, plan }
   Returns: { success, confirmationUrl } → Shopify's hosted managed-pricing page.
   No Admin API call, no token needed — avoids the expiring-token issue. */
export const createSubscription = async (req, res) => {
  try {
    const { shop, plan } = req.body;
    if (!shop || !plan) {
      return res
        .status(400)
        .json({ success: false, message: "shop and plan required" });
    }
    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: "Unknown plan" });
    }

    // Free plan → always handled locally.
    if (plan === "free") {
      await setPlan(shop, "free", true);
      return res.json({
        success: true,
        confirmationUrl: `${FRONTEND_URL}/admin?shop=${shop}&upgraded=free`,
      });
    }

    // ── Managed mode (production): hosted Shopify pricing page ──
    if (BILLING_MODE === "managed") {
      const storeHandle = shop.replace(".myshopify.com", "");
      const managedPricingUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
      return res.json({ success: true, confirmationUrl: managedPricingUrl });
    }

    // ── Direct mode (default): activate immediately ──
    // The Shopify Billing API requires a published public app with managed
    // pricing configured. Until then, we activate the plan directly so the
    // full plan/usage/limit system is testable and demoable.
    await setPlan(shop, plan, true);
    console.log(`[Billing] ✅ direct activate: ${shop} → ${plan}`);
    return res.json({
      success: true,
      confirmationUrl: `${FRONTEND_URL}/admin?shop=${shop}&upgraded=${plan}`,
    });
  } catch (err) {
    console.error("[Billing] subscribe error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── GET /api/billing/callback ──
   Managed pricing returns the merchant to our App URL, not here, so this
   is a lightweight safety net if Shopify ever redirects with params. */
export const activateSubscription = async (req, res) => {
  const shop = req.query.shop;
  const plan = req.query.plan;
  if (shop && plan && PLANS[plan]) {
    try {
      await setPlan(shop, plan, true);
    } catch (e) {
      console.warn("[Billing] callback warn:", e.message);
    }
  }
  return res.redirect(
    `${FRONTEND_URL}/admin?shop=${shop || ""}&upgraded=${plan || "1"}`,
  );
};

/* ── POST /api/billing/webhook ──
   Shopify sends app_subscriptions/update when a plan is created, changed,
   or cancelled on the managed-pricing page. We map the subscription name
   to our plan key and persist it. This is how our DB stays in sync —
   no token, no polling.

   Register this webhook in the Partner Dashboard:
     Topic: app_subscriptions/update
     URL:   https://releaseit-backend.onrender.com/api/billing/webhook */
export const handleSubscriptionWebhook = async (req, res) => {
  // Ack immediately — Shopify retries on non-2xx.
  res.status(200).send("OK");
  try {
    const shop = req.get("X-Shopify-Shop-Domain");
    const sub = req.body?.app_subscription;
    if (!shop || !sub) return;

    const name = (sub.name || "").toLowerCase();
    const status = (sub.status || "").toUpperCase();

    if (status === "ACTIVE") {
      let planKey = "free";
      if (name.includes("pro")) planKey = "pro";
      else if (name.includes("growth")) planKey = "growth";
      else if (name.includes("starter")) planKey = "starter";
      await setPlan(shop, planKey, true);
      console.log(`[Billing] ✅ webhook: ${shop} → ${planKey} ("${sub.name}")`);
    } else if (["CANCELLED", "EXPIRED", "DECLINED", "FROZEN"].includes(status)) {
      await setPlan(shop, "free", true);
      console.log(`[Billing] ↩ webhook: ${shop} → free (${status})`);
    }
  } catch (err) {
    console.error("[Billing] webhook error:", err.message);
  }
};

/* ── POST /api/billing/cancel ──
   Downgrade locally. The merchant cancels the actual subscription from
   Shopify's managed-pricing page; the webhook then confirms it. */
export const cancelSubscription = async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) return res.status(400).json({ success: false });

    // Downgrade to free in our DB.
    await setPlan(shop, "free", true);

    // In managed mode, also send them to Shopify's page to cancel the
    // actual charge. In direct mode, the local downgrade is enough.
    if (BILLING_MODE === "managed") {
      const storeHandle = shop.replace(".myshopify.com", "");
      const manageUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
      return res.json({ success: true, manageUrl });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Billing] cancel error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
