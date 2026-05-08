import mongoose from "mongoose";

const pixelSchema = new mongoose.Schema({
  shop: { type: String, required: true },
  type: { type: String, required: true },
  pixelId: { type: String, default: "" },
  label: { type: String, default: "" },
  accessToken: { type: String, default: "" }, // Server-side API token
  testCode: { type: String, default: "" }, // Facebook test event code
});

export default mongoose.model("Pixel", pixelSchema);
