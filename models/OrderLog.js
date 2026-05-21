import mongoose from "mongoose";

/* Lightweight log of placed COD orders — used for fraud rate-limiting
   ("max N orders from the same customer in X hours"). Auto-expires after
   30 days so the collection stays small. */
const orderLogSchema = new mongoose.Schema({
  shop: { type: String, required: true, index: true },
  ip: { type: String, default: "" },
  email: { type: String, default: "" },
  phone: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

orderLogSchema.index({ shop: 1, createdAt: -1 });

export default mongoose.model("OrderLog", orderLogSchema);
