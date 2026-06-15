import express from "express";
import { createOrder, fetchProducts } from "../controllers/orderController.js";
import { sendOrderConfirmation } from "../controllers/whatsappController.js";
import { verifyShopifyWebhook } from "../middleware/verifyShopifyWebhook.js";

const router = express.Router();

router.post("/create-order", createOrder);
router.get("/products", fetchProducts);

// Shopify orders/create webhook — fires WhatsApp confirmation for ALL orders
// (native Shopify checkouts too, not just COD form). HMAC-verified so only
// genuine Shopify requests are processed.
router.post("/orders/webhook", verifyShopifyWebhook, async (req, res) => {
  // Ack fast — Shopify retries on non-2xx
  res.status(200).send("OK");
  try {
    const shop = req.get("X-Shopify-Shop-Domain");
    const order = req.body;
    if (!shop || !order?.id) return;

    // Skip orders we just created via our own COD form (we already messaged them)
    const tags = (order.tags || "").toLowerCase();
    if (tags.includes("order now")) return;

    await sendOrderConfirmation(shop, order);
  } catch (err) {
    console.error("[Shopify Webhook]", err.message);
  }
});

export default router;
