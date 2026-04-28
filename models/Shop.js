import mongoose from "mongoose";

const shopSchema = new mongoose.Schema({
  shop: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  mode: { type: String, default: "both" },
});

export default mongoose.model("Shop", shopSchema);
