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
  .then(() => console.log("✅ MongoDB Connected"))
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

server.get("/test-script", async (req, res) => {
  try {
    const shop = req.query.shop;
    const shopData = await Shop.findOne({ shop });
    const response = await axios.post(
      `https://${shop}/admin/api/2024-01/script_tags.json`,
      {
        script_tag: {
          event: "onload",
          src: "https://releaseitnow.vercel.app/inject.js",
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": shopData.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});
