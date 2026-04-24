import axios from "axios";

// 🔥 GET PRODUCTS (dynamic store)
export const getProducts = async () => {
  const { shop, accessToken } = global.shopData;

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

// 🔥 CREATE ORDER (dynamic store)
export const createShopifyOrder = async (data) => {
  const { shop, accessToken } = global.shopData;

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
