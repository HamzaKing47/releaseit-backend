import express from "express";
import {
  getPlans,
  createSubscription,
  activateSubscription,
  cancelSubscription,
} from "../controllers/billingController.js";

const router = express.Router();

router.get("/billing/plans", getPlans);
router.post("/billing/subscribe", createSubscription);
router.get("/billing/callback", activateSubscription);
router.post("/billing/cancel", cancelSubscription);

export default router;
