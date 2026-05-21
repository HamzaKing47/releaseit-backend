import mongoose from "mongoose";

const shopSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },

  // COD Button Settings
  mode: { type: String, default: "both" },
  buttonText: { type: String, default: "Buy with Cash on Delivery" },
  bgColor: { type: String, default: "#000000" },
  textColor: { type: String, default: "#ffffff" },
  borderRadius: { type: Number, default: 10 },
  position: { type: String, default: "below" },
  formSchema: { type: Array, default: [] },

  // 🔥 Thank You Page Settings
  thankYou: {
    type: Object,
    default: {
      heading: "Order Confirmed!",
      subtext: "Thank you! Your order has been placed successfully.",
      note: "Our team will contact you soon to confirm your order.",
      buttonText: "Back to Store",
      bgColor: "#f3f4f6",
      cardColor: "#ffffff",
      headingColor: "#16a34a",
      textColor: "#374151",
    },
  },

  // 🛡️ Fraud Prevention Settings
  fraud: {
    type: Object,
    default: {
      // Rate limit: max orders from the same customer within a window
      limitOrdersEnabled: false,
      limitOrdersCount: 3,
      limitOrdersHours: 24,
      // Quantity cap
      blockHighQuantity: false,
      maxQuantity: 10,
      // Blocklists (arrays of strings)
      blockedEmails: [],
      blockedPhones: [],
      blockedIPs: [],
      allowedIPs: [],
      // Message shown when an order is blocked
      blockMessage:
        "We're unable to process your order at this time. Please contact support.",
      // Postal code rules
      excludePostalCodesEnabled: false,
      excludedPostalCodes: [],
      allowOnlyPostalCodesEnabled: false,
      allowedPostalCodes: [],
    },
  },
});

export default mongoose.model("Shop", shopSchema);
