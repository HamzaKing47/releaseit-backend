import express from "express";
import { verifyShopifyWebhook } from "../middleware/verifyShopifyWebhook.js";
import {
  customersDataRequest,
  customersRedact,
  shopRedact,
  appUninstalled,
} from "../controllers/complianceController.js";

const router = express.Router();

// All Shopify-fired webhooks — HMAC-verified before the handler runs.
router.post(
  "/webhooks/customers/data_request",
  verifyShopifyWebhook,
  customersDataRequest,
);
router.post("/webhooks/customers/redact", verifyShopifyWebhook, customersRedact);
router.post("/webhooks/shop/redact", verifyShopifyWebhook, shopRedact);
router.post("/webhooks/app/uninstalled", verifyShopifyWebhook, appUninstalled);

export default router;
