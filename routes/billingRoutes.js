import express from "express";
import {
  getPlans,
  createSubscription,
  activateSubscription,
  cancelSubscription,
  handleSubscriptionWebhook,
} from "../controllers/billingController.js";

const router = express.Router();

router.get("/billing/plans", getPlans);
router.post("/billing/subscribe", createSubscription);
router.get("/billing/callback", activateSubscription);
router.post("/billing/cancel", cancelSubscription);
router.post("/billing/webhook", handleSubscriptionWebhook); // Shopify app_subscriptions/update

export default router;
