import express from "express";
import {
  createOrder,
  fetchProducts,
  getSettings,
  saveSettings,
} from "../controllers/orderController.js";

const router = express.Router();

router.post("/create-order", createOrder);
router.get("/products", fetchProducts);

export default router;
