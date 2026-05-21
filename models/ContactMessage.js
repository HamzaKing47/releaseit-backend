import mongoose from "mongoose";

/* Support / contact messages submitted by merchants from the admin panel. */
const contactMessageSchema = new mongoose.Schema({
  shop: { type: String, default: "" },
  name: { type: String, default: "" },
  email: { type: String, required: true },
  subject: { type: String, default: "" },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ["new", "read", "resolved"],
    default: "new",
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("ContactMessage", contactMessageSchema);
