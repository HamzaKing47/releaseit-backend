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
    process.exit(1); // crash clearly instead of silent fail
  });

const server = express();

server.set("trust proxy", 1);

server.use(cors());
server.use(express.json());

// 🔥 AUTH START
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
    if (!res.headersSent) {
      res.status(500).send("Auth start failed");
    }
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

    // 🔥 Inject script (safe)
    try {
      await axios.post(
        `https://${shop}/admin/api/2024-01/script_tags.json`,
        {
          script_tag: {
            event: "onload",
            src: "https://releaseitnow.vercel.app/inject.js",
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("✅ Script injected");
    } catch (e) {
      console.error("❌ Script inject failed:", e.response?.data || e.message);
    }

    await Shop.findOneAndUpdate({ shop }, { accessToken }, { upsert: true });

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

server.get("/test", (req, res) => {
  res.send("AUTH ROUTE ACTIVE");
});

server.get("/", (req, res) => {
  res.send("ReleaseIt App Running 🚀");
});
