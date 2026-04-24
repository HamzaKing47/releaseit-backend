import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";

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
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: false,
});
