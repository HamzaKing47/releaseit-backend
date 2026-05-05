import mongoose from "mongoose";

const pixelSchema = new mongoose.Schema({
  shop: String,
  type: String,
  pixelId: String,
});

export default mongoose.model("Pixel", pixelSchema);
