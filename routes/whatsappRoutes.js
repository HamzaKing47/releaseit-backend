import express from "express";
import {
  getWhatsappSettings,
  saveWhatsappSettings,
  connectWhatsapp,
  getQRCode,
  checkStatus,
  disconnectWhatsapp,
  sendTestMessage,
} from "../controllers/whatsappController.js";

const router = express.Router();

router.get("/whatsapp/settings", getWhatsappSettings);
router.post("/whatsapp/settings", saveWhatsappSettings);
router.get("/whatsapp/connect", connectWhatsapp); // Start connection (returns immediately)
router.get("/whatsapp/qr", getQRCode); // Poll for QR
router.get("/whatsapp/status", checkStatus);
router.post("/whatsapp/disconnect", disconnectWhatsapp);
router.post("/whatsapp/test", sendTestMessage);

export default router;
