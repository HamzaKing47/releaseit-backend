import express from "express";
import {
  getWhatsappSettings,
  saveWhatsappSettings,
  connectWhatsapp,
  getQRCode,
  checkStatus,
  disconnectWhatsapp,
  sendTestMessage,
  handleWebhook,
} from "../controllers/whatsappController.js";

const router = express.Router();

router.get("/whatsapp/settings", getWhatsappSettings);
router.post("/whatsapp/settings", saveWhatsappSettings);
router.get("/whatsapp/connect", connectWhatsapp);
router.get("/whatsapp/qr", getQRCode);
router.get("/whatsapp/status", checkStatus);
router.post("/whatsapp/disconnect", disconnectWhatsapp);
router.post("/whatsapp/test", sendTestMessage);
router.post("/whatsapp/webhook", handleWebhook); // WAHA se incoming messages

export default router;
