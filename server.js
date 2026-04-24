import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import app from "./app.js";

import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";

const server = express();
server.use(cors());
server.use(express.json());

// 🔥 Shopify config
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ["read_products", "write_orders"],
  hostName: process.env.SHOPIFY_HOST.replace("https://", ""),
  apiVersion: LATEST_API_VERSION,
});

// 🔥 AUTH START
server.get("/auth", async (req, res) => {
  const shop = req.query.shop;

  if (!shop) return res.status(400).send("Missing shop");

  const authRoute = await shopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });

  res.redirect(authRoute);
});

// 🔥 AUTH CALLBACK
server.get("/auth/callback", async (req, res) => {
  try {
    const session = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { shop, accessToken } = session;

    // 👉 TEMP SAVE (for now)
    global.shopData = { shop, accessToken };

    console.log("✅ STORE CONNECTED:", shop);
    console.log("🔑 TOKEN:", accessToken);

    res.send("App Installed Successfully ✅");
  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

// 🔥 YOUR EXISTING ROUTES
server.use(app);

// START SERVER
const port = process.env.PORT || 5000;
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
