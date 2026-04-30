import mongoose from "mongoose";

const shopSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  mode: { type: String, default: "both" },
  buttonText: { type: String, default: "Buy with Cash on Delivery" },
  bgColor: { type: String, default: "#000000" },
  textColor: { type: String, default: "#ffffff" },
  borderRadius: { type: Number, default: 10 },
  position: { type: String, default: "below" }, // above | below
});

export default mongoose.model("Shop", shopSchema);
