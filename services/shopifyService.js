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

// 🔧 UPDATE ORDER (used to retry/repair a shipping address Shopify dropped).
// Returns { ok, data, errors } — never throws — so the caller can log the
// exact validation message Shopify sends back instead of guessing.
export const updateShopifyOrder = async (shop, orderId, orderFields) => {
  const accessToken = await getValidAccessToken(shop);
  try {
    const response = await axios.put(
      `https://${shop}/admin/api/2024-01/orders/${orderId}.json`,
      { order: { id: orderId, ...orderFields } },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    return { ok: true, data: response.data, errors: null };
  } catch (err) {
    return {
      ok: false,
      data: null,
      errors: err.response?.data?.errors || err.message,
    };
  }
};
