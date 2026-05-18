/* ──────────────────────────────────────────────────────────────
   Shopify Billing — Recurring Application Charges

   Flow:
     1. Merchant clicks "Upgrade" on the frontend pricing page.
     2. POST /api/billing/subscribe  → we create a recurring charge
        via the Shopify Admin API and return its confirmation_url.
     3. Frontend redirects the merchant to confirmation_url.
     4. Merchant approves on Shopify → Shopify redirects them back
        to GET /api/billing/callback?charge_id=...&shop=...
     5. We activate the charge, set the shop's plan, redirect to
        the admin panel with ?upgraded=1.
   ────────────────────────────────────────────────────────────── */

import Shop from "../models/Shop.js";
import fetch from "node-fetch";
import { setPlan, PLAN_LIMITS } from "../services/messageUsage.js";

const API_VERSION = "2024-01";

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
   Returns: { success, confirmationUrl } */
export const createSubscription = async (req, res) => {
  try {
    const { shop, plan } = req.body;
    if (!shop || !plan) {
      return res
        .status(400)
        .json({ success: false, message: "shop and plan required" });
    }
    const planDef = PLANS[plan];
    if (!planDef) {
      return res.status(400).json({ success: false, message: "Unknown plan" });
    }

    // Free plan → no charge needed, just update locally.
    if (planDef.key === "free" || planDef.price === 0) {
      await setPlan(shop, "free");
      return res.json({
        success: true,
        confirmationUrl: `${FRONTEND_URL}/admin?shop=${shop}&upgraded=1`,
      });
    }

    const shopData = await Shop.findOne({ shop });
    if (!shopData) {
      return res
        .status(404)
        .json({ success: false, message: "Shop not installed" });
    }

    // Build the recurring charge payload.
    const returnUrl =
      `${BACKEND_URL}/api/billing/callback?shop=${encodeURIComponent(shop)}` +
      `&plan=${encodeURIComponent(plan)}`;

    const body = {
      recurring_application_charge: {
        name: `ReleaseIt — ${planDef.name} Plan`,
        price: planDef.price,
        return_url: returnUrl,
        trial_days: 0,
        test: IS_TEST,
      },
    };

    const r = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": shopData.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await r.json();
    if (!r.ok || !data?.recurring_application_charge) {
      console.error("[Billing] create charge failed:", data);
      return res
        .status(500)
        .json({ success: false, message: "Could not create charge" });
    }

    return res.json({
      success: true,
      confirmationUrl: data.recurring_application_charge.confirmation_url,
    });
  } catch (err) {
    console.error("[Billing] subscribe error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── GET /api/billing/callback ──
   Shopify redirects the merchant here after they approve the charge.
   Query: shop, plan, charge_id */
export const activateSubscription = async (req, res) => {
  try {
    const shop = req.query.shop;
    const plan = req.query.plan;
    const chargeId = req.query.charge_id;
    if (!shop || !plan || !chargeId) {
      return res.status(400).send("Missing shop / plan / charge_id");
    }

    const shopData = await Shop.findOne({ shop });
    if (!shopData) return res.status(404).send("Shop not found");

    // Verify the charge is accepted, then activate it.
    const verify = await fetch(
      `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges/${chargeId}.json`,
      {
        headers: { "X-Shopify-Access-Token": shopData.accessToken },
      },
    );
    const charge = (await verify.json())?.recurring_application_charge;
    if (!charge || charge.status === "declined") {
      return res.redirect(
        `${FRONTEND_URL}/admin?shop=${shop}&billing_error=declined`,
      );
    }

    if (charge.status === "accepted") {
      await fetch(
        `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges/${chargeId}/activate.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": shopData.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recurring_application_charge: charge }),
        },
      );
    }

    // Persist the new plan on our side and start a fresh billing cycle.
    await setPlan(shop, plan, true);
    console.log(`[Billing] ✅ ${shop} → ${plan} (charge ${chargeId})`);

    return res.redirect(
      `${FRONTEND_URL}/admin?shop=${shop}&upgraded=${plan}`,
    );
  } catch (err) {
    console.error("[Billing] callback error:", err.message);
    res.status(500).send("Billing activation failed");
  }
};

/* ── POST /api/billing/cancel ──
   Downgrades the shop back to free and cancels the active charge. */
export const cancelSubscription = async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) return res.status(400).json({ success: false });

    const shopData = await Shop.findOne({ shop });
    if (!shopData) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    // Find active charges and cancel them.
    try {
      const list = await fetch(
        `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges.json`,
        { headers: { "X-Shopify-Access-Token": shopData.accessToken } },
      );
      const data = await list.json();
      const active = (data?.recurring_application_charges || []).filter(
        (c) => c.status === "active",
      );
      for (const c of active) {
        await fetch(
          `https://${shop}/admin/api/${API_VERSION}/recurring_application_charges/${c.id}.json`,
          {
            method: "DELETE",
            headers: { "X-Shopify-Access-Token": shopData.accessToken },
          },
        );
      }
    } catch (e) {
      console.warn("[Billing] cancel cleanup warn:", e.message);
    }

    await setPlan(shop, "free", true);
    res.json({ success: true });
  } catch (err) {
    console.error("[Billing] cancel error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
