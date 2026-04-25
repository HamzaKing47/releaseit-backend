import axios from "axios";
import Shop from "../models/Shop.js";

// 🔥 GET PRODUCTS
export const getProducts = async (shop) => {
  console.log("🔍 SHOP REQUEST:", shop);

  const shopData = await Shop.findOne({ shop });

  console.log("🧠 DB RESULT:", shopData);

  if (!shopData) throw new Error("Shop not found in DB");

  const response = await axios.get(
    `https://${shop}/admin/api/2024-04/products.json`,
    {
      headers: {
        "X-Shopify-Access-Token": shopData.accessToken,
      },
    },
  );

  return response.data;
};

// 🔥 CREATE ORDER
export const createShopifyOrder = async (shop, data) => {
  const shopData = await Shop.findOne({ shop });

  if (!shopData) throw new Error("Shop not found");

  const response = await axios.post(
    `https://${shop}/admin/api/2024-01/orders.json`,
    { order: data },
    {
      headers: {
        "X-Shopify-Access-Token": shopData.accessToken,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data;
};
