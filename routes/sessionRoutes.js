import express from "express";
import { tokenExchange } from "../controllers/sessionController.js";

const router = express.Router();

router.post("/auth/token-exchange", tokenExchange);

export default router;
