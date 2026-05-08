import mongoose from "mongoose";

// Baileys session data MongoDB mein store hoti hai
// Restart ke baad automatically reconnect hota hai
const whatsappSessionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },

  // Baileys session — creds.json ka content
  creds: { type: Object, default: null },

  // Baileys keys store — Map ke instead Array use karte hain MongoDB ke liye
  keys: { type: Object, default: {} },

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

  // Message template
  messageTemplate: {
    type: String,
    default: `🛍️ *New Order!*

Hello {{name}}!

Your order has been placed successfully.

📦 *Order:* {{orderName}}
💰 *Amount:* {{currency}} {{total}}
📍 *Address:* {{address}}

Please reply:

1️⃣ - Confirm Order
2️⃣ - Update Address
3️⃣ - Cancel Order`,
  },

  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("WhatsappSession", whatsappSessionSchema);
