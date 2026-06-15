import express from "express";
import {
  getPlans,
  createSubscription,
  activateSubscription,
  cancelSubscription,
  handleSubscriptionWebhook,
} from "../controllers/billingController.js";
import { verifyShopifyWebhook } from "../middleware/verifyShopifyWebhook.js";

const router = express.Router();

router.get("/billing/plans", getPlans);
router.post("/billing/subscribe", createSubscription);
router.get("/billing/callback", activateSubscription);
router.post("/billing/cancel", cancelSubscription);
// Shopify app_subscriptions/update — HMAC-verified so plan changes can't be spoofed.
router.post(
  "/billing/webhook",
  verifyShopifyWebhook,
  handleSubscriptionWebhook,
);

export default router;
