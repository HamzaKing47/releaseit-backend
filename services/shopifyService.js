import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { SHOPIFY_CONFIG } from "../config/shopify.js";

export const createShopifyOrder = async (data) => {
  try {
    const response = await axios.post(
      `https://${SHOPIFY_CONFIG.storeUrl}/admin/api/2024-01/orders.json`,
      { order: data },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_CONFIG.accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    return response.data;
  } catch (error) {
    console.error(error.response?.data || error.message);
    throw new Error("Shopify order failed");
  }
};

export const getProducts = async () => {
  const response = await axios.get(
    `https://${process.env.SHOP}.myshopify.com/admin/api/2024-04/products.json`,
    {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      },
    },
  );

  return response.data;
};
