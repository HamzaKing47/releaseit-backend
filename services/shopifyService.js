import axios from "axios";
import { getValidAccessToken } from "./tokenService.js";

// 🔥 GET PRODUCTS
export const getProducts = async (shop) => {
  console.log("🔍 SHOP REQUEST:", shop);

  const accessToken = await getValidAccessToken(shop);

  const response = await axios.get(
    `https://${shop}/admin/api/2024-04/products.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
    },
  );

  return response.data;
};

// 🔥 CREATE ORDER
export const createShopifyOrder = async (shop, data) => {
  const accessToken = await getValidAccessToken(shop);

  const response = await axios.post(
    `https://${shop}/admin/api/2024-01/orders.json`,
    { order: data },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data;
};
