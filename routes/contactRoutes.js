import express from "express";
import { submitContact, listContact } from "../controllers/contactController.js";

const router = express.Router();

router.post("/contact", submitContact);
router.get("/contact", listContact);

export default router;
