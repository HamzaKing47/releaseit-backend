import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import app from "./app.js";
import { shopify } from "./config/shopifyAuth.js";

const server = express();

server.set("trust proxy", 1);

server.use(cors());
server.use(express.json());

// 🔥 AUTH START
server.get("/auth", async (req, res) => {
  try {
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
  } catch (err) {
    console.error("AUTH ERROR:", err);
    res.status(500).send("Auth start failed");
  }
});

// 🔥 AUTH CALLBACK
server.get("/auth/callback", async (req, res) => {
  try {
    const session = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { shop, accessToken } = session;

    global.shopData = { shop, accessToken };

    console.log("✅ STORE CONNECTED:", shop);
    console.log("🔑 TOKEN:", accessToken);

    res.send("App Installed Successfully ✅");
  } catch (err) {
    console.error("CALLBACK ERROR:", err);
    res.status(500).send("Auth failed");
  }
});

// 🔥 API ROUTES
server.use(app);

const port = process.env.PORT || 5000;
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
