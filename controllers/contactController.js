import ContactMessage from "../models/ContactMessage.js";

/* ── POST /api/contact ── merchant submits a support message */
export const submitContact = async (req, res) => {
  try {
    const { shop, name, email, subject, message } = req.body;
    if (!email || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Email and message are required" });
    }
    await ContactMessage.create({ shop, name, email, subject, message });
    console.log(`[Contact] 📨 New message from ${email} (${shop || "n/a"})`);
    res.json({
      success: true,
      message: "Thanks! We'll get back to you within 24 hours.",
    });
  } catch (err) {
    console.error("[Contact] submit error:", err.message);
    res.status(500).json({ success: false, message: "Could not send message" });
  }
};

/* ── GET /api/contact?shop= ── (optional) list a shop's past messages */
export const listContact = async (req, res) => {
  try {
    const shop = req.query.shop;
    const messages = await ContactMessage.find(shop ? { shop } : {})
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
