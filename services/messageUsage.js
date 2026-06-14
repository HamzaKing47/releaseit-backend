/* ──────────────────────────────────────────────────────────────
   Message Usage, Plan Limits, Daily Caps & Warm-up

   THREE layers of protection:

   1. MONTHLY LIMIT — the billing tier (Free/Starter/Growth/Pro).
      Resets every 30 days. This is what the customer pays for.

   2. DAILY CAP — a per-day ceiling, set ABOVE the monthly average
      so merchants can burst on sale days, but low enough that one
      day never floods the WhatsApp number. Resets every calendar
      day. This is the #1 ban-prevention lever.

   3. WARM-UP RAMP — a brand-new WhatsApp number is fragile. For its
      first ~3 weeks the daily cap is throttled and ramps up
      gradually, mimicking organic usage. After ~21 days the number
      is "warm" and uses the full plan daily cap.

   A message is allowed only if it passes ALL three checks.
   ────────────────────────────────────────────────────────────── */

import WhatsappSession from "../models/WhatsappSession.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * DAY_MS;

// Monthly message allowance per plan. The FREE limit is env-overridable so we
// can drop it to e.g. 10 for testing the paywall without a code change
// (set FREE_MESSAGE_LIMIT=10 in the backend env); defaults to 50 in production.
export const PLAN_LIMITS = {
  free: Number(process.env.FREE_MESSAGE_LIMIT) || 50,
  starter: 1000,
  growth: 3000,
  pro: 7500,
};

// Monthly COD order allowance per plan. Pro is effectively unlimited.
// Free limit is env-overridable (ORDER_FREE_LIMIT) for quick paywall testing.
export const PLAN_ORDER_LIMITS = {
  free: Number(process.env.ORDER_FREE_LIMIT) || 60,
  starter: 420,
  growth: 10000,
  pro: Infinity,
};

// Per-day ceiling per plan. Deliberately set ABOVE the monthly
// average (limit / 30) so merchants can handle sale-day spikes,
// but capped to stay in the "usually safe" zone for unofficial
// WhatsApp APIs.
//   free   50/mo  (avg ~2/day)   → 25/day
//   starter 1000  (avg ~33/day)  → 80/day
//   growth  3000  (avg ~100/day) → 200/day
//   pro     7500  (avg ~250/day) → 350/day
export const PLAN_DAILY_CAPS = {
  free: 25,
  starter: 80,
  growth: 200,
  pro: 350,
};

// Warm-up ramp for a freshly connected number.
// daysConnected < untilDay  →  cap is `cap` (further limited by the plan cap).
const WARMUP_SCHEDULE = [
  { untilDay: 7, cap: 30 }, // week 1
  { untilDay: 14, cap: 60 }, // week 2
  { untilDay: 21, cap: 120 }, // week 3
  // day 21+ → no warm-up throttle, use the full plan daily cap
];

/* ── internal helpers ── */

// Roll the 30-day billing cycle if it has elapsed.
const rollCycleIfNeeded = (session) => {
  const start = session.cycleStartDate
    ? new Date(session.cycleStartDate).getTime()
    : 0;
  if (Date.now() - start >= CYCLE_MS) {
    session.messagesSent = 0;
    session.cycleStartDate = new Date();
    return true;
  }
  return false;
};

// Roll the 30-day ORDER cycle if it has elapsed.
const rollOrderCycleIfNeeded = (session) => {
  const start = session.orderCycleStartDate
    ? new Date(session.orderCycleStartDate).getTime()
    : 0;
  if (Date.now() - start >= CYCLE_MS) {
    session.ordersUsed = 0;
    session.orderCycleStartDate = new Date();
    return true;
  }
  return false;
};

// Roll the daily counter if the calendar day changed.
const rollDayIfNeeded = (session) => {
  const last = session.dailyResetDate
    ? new Date(session.dailyResetDate)
    : new Date(0);
  const now = new Date();
  const sameDay =
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate();
  if (!sameDay) {
    session.dailySent = 0;
    session.dailyResetDate = now;
    return true;
  }
  return false;
};

// Effective daily cap = min(warm-up cap for current age, plan daily cap).
const getEffectiveDailyCap = (session) => {
  const planCap = PLAN_DAILY_CAPS[session.plan] || PLAN_DAILY_CAPS.free;
  if (!session.numberConnectedDate) {
    // Unknown connection date → be conservative (treat as brand new).
    return Math.min(WARMUP_SCHEDULE[0].cap, planCap);
  }
  const daysConnected =
    (Date.now() - new Date(session.numberConnectedDate).getTime()) / DAY_MS;
  for (const stage of WARMUP_SCHEDULE) {
    if (daysConnected < stage.untilDay) {
      return Math.min(stage.cap, planCap);
    }
  }
  return planCap; // fully warmed
};

// Apply any pending rolls and persist if something changed.
const refreshSession = async (session) => {
  let changed = false;
  if (rollCycleIfNeeded(session)) changed = true;
  if (rollOrderCycleIfNeeded(session)) changed = true;
  if (rollDayIfNeeded(session)) changed = true;
  // Lazy-set the connection date so warm-up always has a baseline.
  if (!session.numberConnectedDate) {
    session.numberConnectedDate = new Date();
    changed = true;
  }
  if (changed) await session.save();
  return session;
};

/* ── public API ── */

/**
 * Can this shop send another message right now?
 * Passes only if BELOW monthly limit AND below today's effective cap.
 * Fails OPEN on DB errors so a transient hiccup never drops messages.
 * Returns { allowed, reason } — reason ∈ "ok" | "monthly" | "daily".
 */
export const canSendMessage = async (shop) => {
  try {
    let session = await WhatsappSession.findOne({ shop });
    if (!session) return { allowed: true, reason: "ok" };
    session = await refreshSession(session);

    const monthlyLimit =
      session.messageLimit || PLAN_LIMITS[session.plan] || PLAN_LIMITS.free;
    if ((session.messagesSent || 0) >= monthlyLimit) {
      return { allowed: false, reason: "monthly" };
    }

    const dailyCap = getEffectiveDailyCap(session);
    if ((session.dailySent || 0) >= dailyCap) {
      return { allowed: false, reason: "daily" };
    }

    return { allowed: true, reason: "ok" };
  } catch (err) {
    console.error(`[Usage] canSendMessage error (${shop}): ${err.message}`);
    return { allowed: true, reason: "ok" }; // fail open
  }
};

/**
 * Record one successful send — bumps both the monthly and daily counters.
 */
export const recordMessageSent = async (shop) => {
  try {
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { $inc: { messagesSent: 1, dailySent: 1 } },
    );
  } catch (err) {
    console.error(`[Usage] recordMessageSent error (${shop}): ${err.message}`);
  }
};

/**
 * Can this shop create another COD order this cycle?
 * Passes if BELOW the plan's monthly order limit (Pro = unlimited).
 * Fails OPEN on DB errors so a transient hiccup never blocks a sale.
 * Returns { allowed, used, limit, plan }.
 */
export const canCreateOrder = async (shop) => {
  try {
    let session = await WhatsappSession.findOne({ shop });
    if (!session) {
      // No session yet → treat as free tier, allow (counter starts on first order).
      return {
        allowed: true,
        used: 0,
        limit: PLAN_ORDER_LIMITS.free,
        plan: "free",
      };
    }
    session = await refreshSession(session);
    const plan = session.plan || "free";
    const limit = PLAN_ORDER_LIMITS[plan] ?? PLAN_ORDER_LIMITS.free;
    const used = session.ordersUsed || 0;
    return { allowed: used < limit, used, limit, plan };
  } catch (err) {
    console.error(`[Usage] canCreateOrder error (${shop}): ${err.message}`);
    return { allowed: true, used: 0, limit: PLAN_ORDER_LIMITS.free, plan: "free" }; // fail open
  }
};

/**
 * Record one COD order — bumps the order counter for the cycle.
 */
export const recordOrder = async (shop) => {
  try {
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { $inc: { ordersUsed: 1 } },
      { upsert: true },
    );
  } catch (err) {
    console.error(`[Usage] recordOrder error (${shop}): ${err.message}`);
  }
};

/**
 * Mark the moment a number connected — starts the warm-up clock.
 * Idempotent: only sets the date if it isn't already set.
 * Call this from the WhatsApp "connected" handler.
 */
export const markNumberConnected = async (shop) => {
  try {
    const session = await WhatsappSession.findOne({ shop });
    if (session && !session.numberConnectedDate) {
      session.numberConnectedDate = new Date();
      await session.save();
      console.log(`[Usage] Warm-up started for ${shop}`);
    }
  } catch (err) {
    console.error(`[Usage] markNumberConnected error (${shop}): ${err.message}`);
  }
};

/**
 * Clear the warm-up clock — call on disconnect so that connecting a
 * DIFFERENT number later restarts the warm-up ramp from scratch.
 */
export const clearNumberConnected = async (shop) => {
  try {
    await WhatsappSession.findOneAndUpdate(
      { shop },
      { numberConnectedDate: null, dailySent: 0 },
    );
  } catch (err) {
    console.error(
      `[Usage] clearNumberConnected error (${shop}): ${err.message}`,
    );
  }
};

/**
 * Usage summary for the admin panel.
 */
export const getUsage = async (shop) => {
  let session = await WhatsappSession.findOne({ shop });
  if (!session) {
    return {
      plan: "free",
      limit: PLAN_LIMITS.free,
      sent: 0,
      remaining: PLAN_LIMITS.free,
      cycleStart: new Date(),
      cycleEnd: new Date(Date.now() + CYCLE_MS),
      percentUsed: 0,
      dailySent: 0,
      dailyCap: PLAN_DAILY_CAPS.free,
      warmingUp: false,
      warmupDaysLeft: 0,
      orderLimit: PLAN_ORDER_LIMITS.free,
      ordersUsed: 0,
      ordersRemaining: PLAN_ORDER_LIMITS.free,
    };
  }
  session = await refreshSession(session);

  const limit =
    session.messageLimit || PLAN_LIMITS[session.plan] || PLAN_LIMITS.free;
  const sent = session.messagesSent || 0;
  const start = session.cycleStartDate
    ? new Date(session.cycleStartDate)
    : new Date();
  const dailyCap = getEffectiveDailyCap(session);
  const planCap = PLAN_DAILY_CAPS[session.plan] || PLAN_DAILY_CAPS.free;

  // Warm-up status
  let warmingUp = false;
  let warmupDaysLeft = 0;
  if (session.numberConnectedDate) {
    const daysConnected =
      (Date.now() - new Date(session.numberConnectedDate).getTime()) / DAY_MS;
    const lastStage = WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1];
    if (daysConnected < lastStage.untilDay) {
      warmingUp = true;
      warmupDaysLeft = Math.ceil(lastStage.untilDay - daysConnected);
    }
  }

  return {
    plan: session.plan || "free",
    limit,
    sent,
    remaining: Math.max(0, limit - sent),
    cycleStart: start,
    cycleEnd: new Date(start.getTime() + CYCLE_MS),
    percentUsed: limit > 0 ? Math.min(100, Math.round((sent / limit) * 100)) : 0,
    dailySent: session.dailySent || 0,
    dailyCap, // effective cap right now (may be warm-up throttled)
    planDailyCap: planCap, // the cap once fully warmed
    warmingUp,
    warmupDaysLeft,
    // COD order usage for this cycle
    orderLimit: PLAN_ORDER_LIMITS[session.plan] ?? PLAN_ORDER_LIMITS.free,
    ordersUsed: session.ordersUsed || 0,
    ordersRemaining: Math.max(
      0,
      (PLAN_ORDER_LIMITS[session.plan] ?? PLAN_ORDER_LIMITS.free) -
        (session.ordersUsed || 0),
    ),
  };
};

/**
 * Change a shop's plan (e.g. after a Shopify billing upgrade).
 */
export const setPlan = async (shop, plan, resetCycle = false) => {
  const limit = PLAN_LIMITS[plan];
  if (!limit) throw new Error(`Unknown plan: ${plan}`);
  const update = { plan, messageLimit: limit };
  if (resetCycle) {
    update.messagesSent = 0;
    update.cycleStartDate = new Date();
    update.ordersUsed = 0;
    update.orderCycleStartDate = new Date();
  }
  await WhatsappSession.findOneAndUpdate({ shop }, update, { upsert: true });
  console.log(`[Usage] ${shop} → plan: ${plan} (limit ${limit})`);
};
