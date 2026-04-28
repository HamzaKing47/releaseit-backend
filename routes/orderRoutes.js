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

export default router;
