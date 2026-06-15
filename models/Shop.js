import mongoose from "mongoose";

const shopSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },

  // Expiring offline token metadata (Shopify requires expiring tokens).
  // accessToken expires in ~1h; refreshToken lasts 90 days and is used to
  // mint new tokens without merchant interaction.
  refreshToken: { type: String, default: "" },
  accessTokenExpiresAt: { type: Date, default: null },
  refreshTokenExpiresAt: { type: Date, default: null },

  // COD Button Settings
  mode: { type: String, default: "both" },
  buttonText: { type: String, default: "Buy with Cash on Delivery" },
  bgColor: { type: String, default: "#000000" },
  textColor: { type: String, default: "#ffffff" },
  borderRadius: { type: Number, default: 10 },
  position: { type: String, default: "below" },
  formSchema: { type: Array, default: [] },

  // 🔥 Thank You Page Settings
  // When false (default) → after a COD order the customer sees Shopify's own
  // official order-status page. When true → they see our custom page below.
  thankYouEnabled: { type: Boolean, default: false },
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

  // 🚀 Sales Booster Settings
  salesBooster: {
    type: Object,
    default: {
      // Quantity offers — buy more, save more (shown on the COD form)
      quantityOffersEnabled: false,
      quantityOffers: [
        // { minQty: 2, discountPercent: 10 }
      ],
      // One-tick order add-ons — shipping protection, gift wrap, etc.
      addonsEnabled: false,
      addons: [
        // { id, title, price, description }
      ],
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
