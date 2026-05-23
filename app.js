import express from "express";
import cors from "cors";
import orderRoutes from "./routes/orderRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import pixelRoutes from "./routes/pixelRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import billingRoutes from "./routes/billingRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import { sendOrderConfirmation } from "./controllers/whatsappController.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", orderRoutes);
app.use("/api", settingRoutes);
app.use("/api", pixelRoutes);
app.use("/api", whatsappRoutes);
app.use("/api", billingRoutes);
app.use("/api", contactRoutes);
app.use("/api", sessionRoutes);

// 🧪 DEBUG — Test order confirmation flow without creating a real Shopify order.
// Usage: GET /api/_debug/test-confirm?shop=test-store.myshopify.com&phone=923001234567
// REMOVE THIS ROUTE BEFORE PRODUCTION DEPLOY.
app.get("/api/_debug/test-confirm", async (req, res) => {
  try {
    const shop = req.query.shop;
    const phone = req.query.phone;
    if (!shop || !phone) {
      return res
        .status(400)
        .json({ ok: false, message: "shop & phone query params required" });
    }
    await sendOrderConfirmation(shop, {
      name: "#1001",
      currency: "PKR",
      total_price: "2500",
      shipping_address: {
        first_name: "Test Customer",
        phone,
        address1: "House 12, Street 4",
        city: "Lahore",
      },
    });
    res.json({ ok: true, message: "Order confirmation triggered" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default app;
