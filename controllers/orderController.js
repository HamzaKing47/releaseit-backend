import { createShopifyOrder, getProducts } from "../services/shopifyService.js";
import Shop from "../models/Shop.js";
import Pixel from "../models/Pixel.js";
import { fireServerSideEvents } from "../services/conversionsService.js";

const formatPhone = (phone) => {
  if (!phone) return phone;
  return phone.replace(/\s|-/g, "");
};

export const createOrder = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) {
      return res.status(400).json({ success: false, message: "Shop missing" });
    }

    const { name, phone, address, city, items } = req.body;

    if (!name || !phone || !address || !city || !items?.length) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const lineItems = items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const orderData = {
      line_items: lineItems,
      customer: {
        first_name: name,
        last_name: ".",
        phone: formatPhone(phone),
      },
      shipping_address: {
        first_name: name,
        last_name: ".",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: formatPhone(phone),
      },
      billing_address: {
        first_name: name,
        last_name: ".",
        address1: address,
        city: city,
        province: "Punjab",
        country: "Pakistan",
        country_code: "PK",
        phone: formatPhone(phone),
      },
      financial_status: "pending",
      tags: "COD, ReleaseIt",
      note: "Order placed via ReleaseIt COD form",
    };

    // 1️⃣ Shopify order create karo
    const result = await createShopifyOrder(shop, orderData);
    const order = result.order;

    // 2️⃣ Server-side pixels fire karo (non-blocking)
    try {
      const pixels = await Pixel.find({ shop });

      if (pixels.length > 0) {
        // Client info headers se lo
        const clientIp =
          req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        const clientUserAgent = req.headers["user-agent"] || "";

        // Fire karo — await nahi karte taake response slow na ho
        fireServerSideEvents({
          pixels,
          orderId: order.id,
          value: order.total_price,
          currency: order.currency || "PKR",
          phone: formatPhone(phone),
          clientIp,
          clientUserAgent,
        }).catch((err) => {
          console.error("[Server-Side Pixels] Error:", err.message);
        });
      }
    } catch (pixelErr) {
      // Pixel error se order fail nahi hona chahiye
      console.error("[Pixel Fetch Error]", pixelErr.message);
    }

    // 3️⃣ Response
    res.status(200).json({
      success: true,
      order: {
        id: order.id,
        name: order.name,
        total_price: order.total_price,
        currency: order.currency,
      },
    });
  } catch (err) {
    console.error("🔥 Order Error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Order creation failed" });
  }
};

export const fetchProducts = async (req, res) => {
  try {
    const shop = req.query.shop?.replace(/\/$/, "");
    if (!shop) {
      return res.status(400).json({ success: false, message: "Shop missing" });
    }
    const data = await getProducts(shop);
    res.json({ success: true, products: data.products });
  } catch (err) {
    console.error("🔥 Product Fetch Error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch products",
    });
  }
};
