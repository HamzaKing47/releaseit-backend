import { createShopifyOrder, getProducts } from "../services/shopifyService.js";

export const createOrder = async (req, res) => {
  try {
    const shop = req.query.shop; // 🔥 ADD THIS

    const { name, phone, address, city, items } = req.body;

    if (!name || !phone || !address || !city || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const lineItems = items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const orderData = {
      line_items: lineItems,
      customer: {
        first_name: name,
        last_name: "User",
        phone: phone,
      },
      shipping_address: {
        first_name: name,
        last_name: "User",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: phone,
      },
      billing_address: {
        first_name: name,
        last_name: "User",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: phone,
      },
      financial_status: "pending",
      tags: "COD, Custom Form",
      note: "Order created from custom frontend form",
    };

    // 🔥 FIX HERE
    const result = await createShopifyOrder(shop, orderData);

    res.status(200).json({
      success: true,
      order: result.order,
    });
  } catch (err) {
    console.error("🔥 Shopify Error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: "Shopify order failed",
    });
  }
};

export const fetchProducts = async (req, res) => {
  try {
    const shop = req.query.shop; // 🔥 ADD THIS

    const data = await getProducts(shop); // 🔥 FIX

    res.json({
      success: true,
      products: data.products,
    });
  } catch (err) {
    console.error("🔥 Product Fetch Error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};
