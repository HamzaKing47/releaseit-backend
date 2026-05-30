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
server.get("/auth", async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) return res.status(400).send("Missing shop");
    await shopify.auth.begin({
      shop,
      callbackPath: "/auth/callback",
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });
  } catch (err) {
    console.error("AUTH ERROR:", err);
    if (!res.headersSent) res.status(500).send("Auth start failed");
  }
});

server.get("/auth/callback", async (req, res) => {
  try {
    const session = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    const shop = session.shop || session?.session?.shop;
    const accessToken = session.accessToken || session?.session?.accessToken;
    if (!shop || !accessToken)
      return res.status(500).send("Shop or token missing");
    await Shop.findOneAndUpdate(
      { shop },
      { shop, accessToken },
      { upsert: true },
    );
    console.log("✅ STORE CONNECTED:", shop);
    // COD button is now injected via the theme app embed extension
    // (no Admin API ScriptTag needed).
    res.send("App Installed Successfully ✅");
  } catch (err) {
    console.error("CALLBACK ERROR:", err);
    res.status(500).send("Auth failed");
  }
});

server.use(app);

const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`🚀 Server running on port ${port}`));

server.get("/test", (req, res) => res.send("AUTH ROUTE ACTIVE"));

server.get("/", (req, res) => {
  const shop = req.query.shop;
  res.redirect(`https://releaseitnow.vercel.app/?shop=${shop}`);
});

