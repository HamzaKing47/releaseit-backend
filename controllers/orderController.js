import { createShopifyOrder, getProducts } from "../services/shopifyService.js";
import Shop from "../models/Shop.js";
import Pixel from "../models/Pixel.js";
import { fireServerSideEvents } from "../services/conversionsService.js";
import { checkFraud, logOrder } from "../services/fraudService.js";

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

    const { name, phone, address, city, items, email, postalCode } = req.body;

    if (!name || !phone || !address || !city || !items?.length) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    // 🛡️ Fraud Prevention — run merchant-configured checks first.
    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "";
    const fraud = await checkFraud(shop, {
      email,
      phone: formatPhone(phone),
      ip: clientIp,
      items,
      postalCode,
    });
    if (fraud.blocked) {
      console.log(`[Fraud] 🚫 Blocked order (${shop}): ${fraud.reason}`);
      return res.status(403).json({
        success: false,
        blocked: true,
        message: fraud.message,
      });
    }

    const lineItems = items.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    // 🚀 Sales Booster — add-ons + quantity discount (server-validated)
    let discountCodes = [];
    let boosterTags = [];
    try {
      const shopRecord = await Shop.findOne({ shop });
      const sb = shopRecord?.salesBooster;
      const { addons: selectedAddons } = req.body;

      // Order add-ons → custom line items (use SERVER-side price, never trust client)
      if (sb?.addonsEnabled && Array.isArray(selectedAddons) && selectedAddons.length) {
        const configured = sb.addons || [];
        selectedAddons.forEach((sel) => {
          const match = configured.find(
            (a) => a.id === sel.id || a.title === sel.title,
          );
          if (match) {
            lineItems.push({
              title: match.title,
              price: Number(match.price) || 0,
              quantity: 1,
            });
            boosterTags.push("Addon");
          }
        });
      }

      // Quantity offer → order-level percentage discount based on total qty
      if (sb?.quantityOffersEnabled && Array.isArray(sb.quantityOffers)) {
        const totalQty = items.reduce(
          (sum, it) => sum + (Number(it.quantity) || 0),
          0,
        );
        const best = sb.quantityOffers
          .filter((o) => totalQty >= (Number(o.minQty) || 0))
          .sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0))[0];
        if (best && best.discountPercent > 0) {
          discountCodes = [
            {
              code: `QTY${best.discountPercent}`,
              amount: String(best.discountPercent),
              type: "percentage",
            },
          ];
          boosterTags.push("Qty Offer");
        }
      }
    } catch (sbErr) {
      console.error("[SalesBooster] order build error:", sbErr.message);
    }

    const orderData = {
      line_items: lineItems,
      ...(discountCodes.length ? { discount_codes: discountCodes } : {}),
      // NOTE: we intentionally do NOT set customer.phone here. Shopify enforces
      // a unique phone per customer, so reusing a phone throws
      // "customer.phone_number has already been taken". The phone is still
      // captured in shipping/billing address below for COD contact.
      customer: {
        first_name: name,
        last_name: ".",
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
      tags: ["COD", "ReleaseIt", ...boosterTags].join(", "),
      note: "Order placed via ReleaseIt COD form",
    };

    // 1️⃣ Shopify order create karo
    const result = await createShopifyOrder(shop, orderData);
    const order = result.order;

    // 1.5️⃣ Log the order for fraud rate-limiting (non-blocking)
    logOrder(shop, {
      email,
      phone: formatPhone(phone),
      ip: clientIp,
    }).catch(() => {});

    // 2️⃣ Server-side pixels fire karo (non-blocking)
    try {
      const pixels = await Pixel.find({ shop });

      if (pixels.length > 0) {
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
        // Shopify's official order-status / "Thank you" page (token-based,
        // viewable by the customer without logging in).
        order_status_url: order.order_status_url || "",
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
