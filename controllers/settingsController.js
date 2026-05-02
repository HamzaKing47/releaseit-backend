import Shop from "../models/Shop.js";

export const saveSettings = async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ success: false });

    const updated = await Shop.findOneAndUpdate(
      { shop },
      { ...req.body },
      { new: true, upsert: true },
    );

    res.json({ success: true, ...updated._doc });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

export const getSettings = async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ success: false });

    const shopData = await Shop.findOne({ shop });

    res.json({
      success: true,
      ...(shopData?._doc || {}),
    });
  } catch {
    res.status(500).json({ success: false });
  }
};
