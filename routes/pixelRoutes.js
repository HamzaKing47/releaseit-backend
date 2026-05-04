import express from "express";
import { getPixels, savePixels } from "../controllers/pixelController.js";

const router = express.Router();

router.get("/pixels", getPixels);
router.post("/pixels", savePixels);

export default router;
