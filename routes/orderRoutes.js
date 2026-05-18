import express from "express";
import { createOrder, fetchProducts } from "../controllers/orderController.js";
import { sendOrderConfirmation } from "../controllers/whatsappController.js";

const router = express.Router();

router.post("/create-order", createOrder);
router.get("/products", fetchProducts);

// Shopify orders/create webhook — fires WhatsApp confirmation for ALL orders
// (native Shopify checkouts too, not just COD form). Register this URL in your
// Shopify Partner dashboard → App webhooks → orders/create.
router.post("/orders/webhook", async (req, res) => {
  // Ack fast — Shopify retries on non-2xx
  res.status(200).send("OK");
  try {
    const shop = req.get("X-Shopify-Shop-Domain");
    const order = req.body;
    if (!shop || !order?.id) return;

    // Skip orders we just created via our own COD form (we already messaged them)
    const tags = (order.tags || "").toLowerCase();
    if (tags.includes("releaseit")) return;

    await sendOrderConfirmation(shop, order);
  } catch (err) {
    console.error("[Shopify Webhook]", err.message);
  }
});

export default router;
