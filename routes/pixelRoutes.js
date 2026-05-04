import express from "express";
import Pixel from "../models/Pixel.js";

const router = express.Router();

// GET pixels
router.get("/", async (req, res) => {
  const { shop } = req.query;
  const pixels = await Pixel.find({ shop });
  res.json({ success: true, pixels });
});

// SAVE pixels
router.post("/", async (req, res) => {
  const { shop, pixels } = req.body;

  await Pixel.deleteMany({ shop });

  const newPixels = pixels.map((p) => ({ ...p, shop }));
  await Pixel.insertMany(newPixels);

  res.json({ success: true });
});

export default router;
