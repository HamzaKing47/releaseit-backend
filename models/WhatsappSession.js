import mongoose from "mongoose";

const whatsappSessionSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },

  // Baileys auth files — /tmp se MongoDB backup
  authFiles: { type: Object, default: {} },

  // Store ka WhatsApp number
  whatsappNumber: { type: String, default: "" },

  status: {
    type: String,
    enum: ["disconnected", "connected", "connecting", "waiting_qr"],
    default: "disconnected",
  },

  enabled: { type: Boolean, default: true },
  sendOnOrderCreate: { type: Boolean, default: true },
  sendOnFulfillment: { type: Boolean, default: true },
  sendOnCancellation: { type: Boolean, default: false },

  // ── Plan & message usage (tiered pricing like WhatFlow) ──
  plan: {
    type: String,
    enum: ["free", "starter", "growth", "pro"],
    default: "free",
  },
  messageLimit: { type: Number, default: 50 }, // messages allowed per 30-day cycle
  messagesSent: { type: Number, default: 0 }, // messages sent in current cycle
  cycleStartDate: { type: Date, default: Date.now }, // when current cycle began

  // ── Daily cap + warm-up (protects the WhatsApp number from bans) ──
  dailySent: { type: Number, default: 0 }, // messages sent today
  dailyResetDate: { type: Date, default: Date.now }, // start of the current day-window
  numberConnectedDate: { type: Date, default: null }, // when the WA number first connected — drives warm-up ramp

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
