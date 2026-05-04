import Pixel from "../models/Pixel.js";

/* =========================
   GET PIXELS
========================= */
export const getPixels = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");

    if (!shop) {
      return res.status(400).json({
        success: false,
        message: "Shop missing",
      });
    }

    const pixels = await Pixel.find({ shop });

    res.json({
      success: true,
      pixels,
    });
  } catch (err) {
    console.error("PIXEL GET ERROR:", err.message);
    res.status(500).json({ success: false });
  }
};

/* =========================
   SAVE PIXELS
========================= */
export const savePixels = async (req, res) => {
  try {
    const { shop, pixels } = req.body;

    if (!shop) {
      return res.status(400).json({
        success: false,
        message: "Shop missing",
      });
    }

    await Pixel.deleteMany({ shop });

    const formatted = pixels.map((p) => ({
      shop,
      type: p.type,
      pixelId: p.pixelId,
      label: p.label,
    }));

    await Pixel.insertMany(formatted);

    res.json({ success: true });
  } catch (err) {
    console.error("PIXEL SAVE ERROR:", err.message);
    res.status(500).json({ success: false });
  }
};
