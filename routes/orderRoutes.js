import express from "express";
import {
  createOrder,
  fetchProducts,
  getSettings,
} from "../controllers/orderController.js";

const router = express.Router();

router.post("/create-order", createOrder);
router.get("/products", fetchProducts);
router.get("/settings", getSettings);
router.post("/save-settings", saveSettings);

export default router;
