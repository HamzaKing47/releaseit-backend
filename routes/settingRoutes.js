import express from "express";
import { getSettings, saveSettings } from "../controllers/settingsController";

const router = express.Router();

router.get("/settings", getSettings);
router.post("/settings", saveSettings); // 🔥 ye missing tha

export default router;
