/* ──────────────────────────────────────────────────────────────
   WhatsApp Message Queue — per-shop, rate-limited, in-memory.

   WHY THIS EXISTS:
   Without a queue, a burst of orders (e.g. a flash sale) fires N
   concurrent WAHA calls at once. That:
     1. can overwhelm the WAHA container,
     2. floods the WhatsApp number → much higher ban risk,
     3. can crash the backend on memory/socket exhaustion.

   This queue paces sends to a safe rate PER SHOP, retries failures,
   and isolates shops from each other (one busy shop can't block
   another).

   LIMITATIONS (be honest about these):
   - In-memory: queued messages are LOST on server restart.
   - Single-instance only: does not coordinate across multiple
     backend instances behind a load balancer.
   - For true high scale, swap this for Redis + BullMQ. The public
     API (enqueueMessage / configureSender) is intentionally kept
     small so that swap is a drop-in.
   ────────────────────────────────────────────────────────────── */

const queues = new Map(); // shop -> { items: [], processing: boolean }

// Minimum gap between two messages for the SAME shop.
// ~3s ≈ 20 messages/min/shop — a deliberately safe pace for
// unofficial WhatsApp APIs (lower = higher ban risk).
const SEND_INTERVAL_MS = Number(process.env.WA_SEND_INTERVAL_MS || 3000);

// Max retry attempts per message before giving up.
const MAX_ATTEMPTS = 3;

let sendFn = null; // injected actual sender: (shop, phone, text) => Promise

/** Wire up the real send implementation (called once at startup). */
export const configureSender = (fn) => {
  sendFn = fn;
};

/** Add a message to a shop's queue. Returns immediately (non-blocking). */
export const enqueueMessage = (shop, phone, text, meta = {}) => {
  if (!shop || !phone || !text) return;
  if (!queues.has(shop)) {
    queues.set(shop, { items: [], processing: false });
  }
  const q = queues.get(shop);
  q.items.push({ phone, text, meta, attempts: 0 });
  // Kick the processor (no-op if already running for this shop)
  processQueue(shop);
};

const processQueue = async (shop) => {
  const q = queues.get(shop);
  if (!q || q.processing) return;
  q.processing = true;

  while (q.items.length > 0) {
    const job = q.items.shift();
    try {
      if (!sendFn) throw new Error("messageQueue sender not configured");
      await sendFn(shop, job.phone, job.text);
    } catch (err) {
      job.attempts++;
      console.error(
        `[MsgQueue] send failed (${shop} → ${job.phone}) ` +
          `attempt ${job.attempts}/${MAX_ATTEMPTS}: ${err.message}`,
      );
      if (job.attempts < MAX_ATTEMPTS) {
        q.items.push(job); // re-queue at the back for another try
      } else {
        console.error(
          `[MsgQueue] giving up on message to ${job.phone} (${shop})`,
        );
      }
    }
    // Pace the sends — this gap is what protects the WhatsApp number.
    await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS));
  }

  q.processing = false;
};

/** Pending message count — for a single shop, or all shops if no arg. */
export const getQueueDepth = (shop) => {
  if (shop) return queues.get(shop)?.items.length || 0;
  let total = 0;
  for (const q of queues.values()) total += q.items.length;
  return total;
};
