import mongoose from "mongoose";

const whatsappSessionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },

  // Baileys session data
  creds: { type: Object, default: null },
  keys: { type: Object, default: {} },

  // Store ka WhatsApp number — wa.me links mein use hota hai
  // Merchant dashboard mein enter karega (e.g. 923001234567)
  whatsappNumber: { type: String, default: "" },

  // Connection status
  status: {
    type: String,
    enum: ["disconnected", "connected", "connecting", "waiting_qr"],
    default: "disconnected",
  },

  // Dashboard settings
  enabled: { type: Boolean, default: true },
  sendOnOrderCreate: { type: Boolean, default: true },
  sendOnFulfillment: { type: Boolean, default: true },
  sendOnCancellation: { type: Boolean, default: false },

  messageTemplate: {
    type: String,
    default: `🛍️ *New Order!*

Hello {{name}}!

Your order has been placed successfully.

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`,
  },

  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("WhatsappSession", whatsappSessionSchema);
