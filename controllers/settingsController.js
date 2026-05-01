import Shop from "../models/Shop.js";

// 🔥 SAVE SETTINGS
export const saveSettings = async (req, res) => {
  try {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).json({ success: false });
    }

    const { mode, buttonText, bgColor, textColor, borderRadius, position } =
      req.body;

    const updated = await Shop.findOneAndUpdate(
      { shop },
      {
        mode,
        buttonText,
        bgColor,
        textColor,
        borderRadius,
        position,
      },
      { new: true, upsert: true },
    );

    res.json({ success: true, settings: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

// 🔥 GET SETTINGS
export const getSettings = async (req, res) => {
  try {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).json({ success: false });
    }

    const shopData = await Shop.findOne({ shop });

    res.json({
      success: true,
      mode: shopData?.mode || "both",
      buttonText: shopData?.buttonText || "Buy with Cash on Delivery",
      bgColor: shopData?.bgColor || "#000000",
      textColor: shopData?.textColor || "#ffffff",
      borderRadius: shopData?.borderRadius || 10,
      position: shopData?.position || "below",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
