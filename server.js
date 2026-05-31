import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import app from "./app.js";
import { shopify } from "./config/shopifyAuth.js";
import Shop from "./models/Shop.js";
import axios from "axios";

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    // Resume previously-connected WhatsApp shops AND re-register their
    // message handlers — so incoming CONFIRM/CANCEL/ADDRESS replies keep
    // working after a server restart.
    try {
      const { resumeConnectedShops } = await import(
        "./controllers/whatsappController.js"
      );
      resumeConnectedShops().catch((e) =>
        console.error("[WA] resume err:", e.message),
      );
    } catch (e) {
      console.warn("[WA] Resume skipped:", e.message);
    }
  })
  .catch((err) => {
    console.error("❌ Mongo Error:", err.message);
    process.exit(1);
  });

const server = express();
server.set("trust proxy", 1);
server.use(cors());
server.use(express.json());

// AUTH
// NOTE: The legacy OAuth grant (shopify.auth.begin / .callback with
// isOnline:false) issues NON-EXPIRING offline tokens, which Shopify's Admin
// API now rejects. This app uses Shopify managed installation + token
// exchange (see /api/auth/token-exchange) which issues EXPIRING tokens.
// So these routes just bounce the merchant into the app; they never mint a
// legacy token anymore.
server.get("/auth", (req, res) => {
  const shop = req.query.shop || "";
  res.redirect(`https://releaseitnow.vercel.app/admin?shop=${shop}`);
});

server.get("/auth/callback", (req, res) => {
  const shop = req.query.shop || "";
  res.redirect(`https://releaseitnow.vercel.app/admin?shop=${shop}`);
});

server.use(app);

const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`🚀 Server running on port ${port}`));

server.get("/test", (req, res) => res.send("AUTH ROUTE ACTIVE"));

server.get("/", (req, res) => {
  const shop = req.query.shop;
  res.redirect(`https://releaseitnow.vercel.app/?shop=${shop}`);
});

