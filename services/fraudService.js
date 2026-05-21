/* ──────────────────────────────────────────────────────────────
   Fraud Prevention

   Runs a set of merchant-configured checks before a COD order is
   created. Returns { blocked, reason } — if blocked is true, the
   order is rejected and the merchant's custom message is shown.

   Checks (in order):
     1. Allowed IP    → if the customer's IP is whitelisted, ALWAYS allow.
     2. Blocked email / phone / IP.
     3. Quantity cap.
     4. Postal-code rules (exclude list OR allow-only list).
     5. Rate limit (max N orders from same customer in X hours).
   ────────────────────────────────────────────────────────────── */

import Shop from "../models/Shop.js";
import OrderLog from "../models/OrderLog.js";

// Normalize: lowercase + trim for emails, digits-only for phones.
const normEmail = (e) => (e || "").toString().trim().toLowerCase();
const normPhone = (p) => (p || "").toString().replace(/\D/g, "");
const normList = (arr) => (Array.isArray(arr) ? arr : []).map((x) => x.trim()).filter(Boolean);

/**
 * @returns {Promise<{ blocked: boolean, reason?: string, message?: string }>}
 */
export const checkFraud = async (shop, { email, phone, ip, items, postalCode }) => {
  try {
    const shopData = await Shop.findOne({ shop });
    const f = shopData?.fraud;
    if (!f) return { blocked: false };

    const customMessage =
      f.blockMessage ||
      "We're unable to process your order at this time. Please contact support.";
    const block = (reason) => ({ blocked: true, reason, message: customMessage });

    const cEmail = normEmail(email);
    const cPhone = normPhone(phone);
    const cIp = (ip || "").toString().trim();

    // 1. Whitelisted IP → always allow, skip every other check.
    const allowedIPs = normList(f.allowedIPs);
    if (cIp && allowedIPs.includes(cIp)) {
      return { blocked: false, reason: "ip_allowlisted" };
    }

    // 2. Blocklists
    const blockedEmails = normList(f.blockedEmails).map(normEmail);
    if (cEmail && blockedEmails.includes(cEmail)) return block("email_blocked");

    const blockedPhones = normList(f.blockedPhones).map(normPhone);
    if (cPhone && blockedPhones.some((p) => p && cPhone.endsWith(p.slice(-10))))
      return block("phone_blocked");

    const blockedIPs = normList(f.blockedIPs);
    if (cIp && blockedIPs.includes(cIp)) return block("ip_blocked");

    // 3. Quantity cap
    if (f.blockHighQuantity) {
      const totalQty = (items || []).reduce(
        (sum, it) => sum + (Number(it.quantity) || 0),
        0,
      );
      if (totalQty > (Number(f.maxQuantity) || 0)) return block("quantity_exceeded");
    }

    // 4. Postal-code rules
    const pc = (postalCode || "").toString().trim();
    if (f.allowOnlyPostalCodesEnabled) {
      const allowed = normList(f.allowedPostalCodes);
      if (allowed.length && (!pc || !allowed.includes(pc)))
        return block("postal_not_allowed");
    }
    if (f.excludePostalCodesEnabled) {
      const excluded = normList(f.excludedPostalCodes);
      if (pc && excluded.includes(pc)) return block("postal_excluded");
    }

    // 5. Rate limit
    if (f.limitOrdersEnabled) {
      const hours = Number(f.limitOrdersHours) || 24;
      const max = Number(f.limitOrdersCount) || 3;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const last10 = cPhone.slice(-10);

      const recent = await OrderLog.find({
        shop,
        createdAt: { $gte: since },
        $or: [
          ...(cEmail ? [{ email: cEmail }] : []),
          ...(cIp ? [{ ip: cIp }] : []),
          ...(last10 ? [{ phone: { $regex: last10 + "$" } }] : []),
        ],
      }).limit(max + 1);

      if (recent.length >= max) return block("rate_limited");
    }

    return { blocked: false };
  } catch (err) {
    // Fail OPEN — a fraud-check error should never block a legitimate sale.
    console.error(`[Fraud] check error (${shop}): ${err.message}`);
    return { blocked: false, reason: "error_failed_open" };
  }
};

/** Log a successful order for rate-limiting purposes. */
export const logOrder = async (shop, { email, phone, ip }) => {
  try {
    await OrderLog.create({
      shop,
      email: normEmail(email),
      phone: normPhone(phone),
      ip: (ip || "").toString().trim(),
    });
  } catch (err) {
    console.error(`[Fraud] logOrder error (${shop}): ${err.message}`);
  }
};
