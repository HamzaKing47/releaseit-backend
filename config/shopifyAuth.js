import "@shopify/shopify-api/adapters/node";

import dotenv from "dotenv";
dotenv.config();

import { shopifyApi } from "@shopify/shopify-api";

export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: [
    "write_orders",
    "read_products",
    "write_script_tags",
    "read_script_tags",
    "write_themes",
  ],
  hostName: process.env.SHOPIFY_HOST.replace("https://", ""),
  apiVersion: "2024-04",
  // Embedded app → uses Token Exchange (expiring tokens) instead of the
  // legacy OAuth grant (which issues non-expiring tokens that Shopify's
  // Admin API now rejects).
  isEmbeddedApp: true,
});
