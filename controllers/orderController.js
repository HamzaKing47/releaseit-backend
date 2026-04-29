import { createShopifyOrder, getProducts } from "../services/shopifyService.js";
import Shop from "../models/Shop.js";

const formatPhone = (phone) => {
  if (!phone) return phone;
  return phone.replace(/\s|-/g, "");
};

export const createOrder = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");

    if (!shop) {
      return res.status(400).json({
        success: false,
        message: "Shop missing",
      });
    } // 🔥 ADD THIS

    const { name, phone, address, city, items } = req.body;

    if (!name || !phone || !address || !city || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone required",
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
        phone: formatPhone(phone),
      },
      shipping_address: {
        first_name: name,
        last_name: "User",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: formatPhone(phone),
      },
      billing_address: {
        first_name: name,
        last_name: "User",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: formatPhone(phone),
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
    const shop = req.query.shop?.replace(/\/$/, "");

    if (!shop) {
      return res.status(400).json({
        success: false,
        message: "Shop missing",
      });
    }

    const data = await getProducts(shop);

    res.json({
      success: true,
      products: data.products,
    });
  } catch (err) {
    console.error("🔥 Product Fetch Error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch products",
      error: err.response?.data || err.message,
    });
  }
};

export const getSettings = async (req, res) => {
  try {
    const shop = req.query.shop;

    if (!shop) {
      return res.status(400).json({ success: false });
    }

    const shopData = await Shop.findOne({ shop });

    res.json({
      success: true,
      mode: shopData?.mode || "both",
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};

export const saveSettings = async (req, res) => {
  try {
    const shop = req.query.shop;
    const { mode } = req.body;

    if (!shop) {
      return res.status(400).json({ success: false });
    }

    await Shop.findOneAndUpdate({ shop }, { mode }, { upsert: true });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
};
