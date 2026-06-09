import Shop from "../models/Shop.js";

// Fields that must NEVER be sent to the client (the public storefront calls
// /api/settings, so leaking these would expose the shop's Admin API access).
const SENSITIVE = [
  "accessToken",
  "refreshToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
];

const stripSensitive = (doc) => {
  const data = { ...(doc || {}) };
  SENSITIVE.forEach((k) => delete data[k]);
  return data;
};

export const saveSettings = async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ success: false });

    // Never let the client overwrite token fields via settings save.
    const body = { ...req.body };
    SENSITIVE.forEach((k) => delete body[k]);

    const updated = await Shop.findOneAndUpdate(
      { shop },
      { ...body },
      { new: true, upsert: true },
    );

    res.json({ success: true, ...stripSensitive(updated._doc) });
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
      ...stripSensitive(shopData?._doc),
    });
  } catch {
    res.status(500).json({ success: false });
  }
};
