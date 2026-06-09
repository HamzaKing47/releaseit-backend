import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import orderRoutes from "./routes/orderRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import pixelRoutes from "./routes/pixelRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import billingRoutes from "./routes/billingRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";

const app = express();

// Behind Caddy (reverse proxy) — trust the first proxy so req.ip is the
// real client IP (needed for correct rate-limiting).
app.set("trust proxy", 1);

// ── Security headers ──
// crossOriginResourcePolicy is relaxed because the storefront (a different
// origin) legitimately fetches from this API.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // this is a JSON API, not an HTML site
  }),
);

// ── CORS ── open, because the COD button/form runs on many storefront domains.
app.use(cors());

// ── Body parsing ── cap size to avoid abuse.
app.use(express.json({ limit: "1mb" }));

// ── Rate limiting ── generous per-IP cap to stop abuse without blocking real traffic.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, slow down." },
});
app.use("/api", apiLimiter);

// ── Health check (for uptime monitoring / load balancers) ──
app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "ok", time: new Date().toISOString() });
});

// ── Routes ──
app.use("/api", orderRoutes);
app.use("/api", settingRoutes);
app.use("/api", pixelRoutes);
app.use("/api", whatsappRoutes);
app.use("/api", billingRoutes);
app.use("/api", contactRoutes);
app.use("/api", sessionRoutes);

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── Global error handler ── last safety net; any thrown/next(err) lands here
// so a single bad request can never crash the whole server.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Unhandled Route Error]", err?.stack || err?.message || err);
  if (res.headersSent) return;
  res
    .status(err.status || 500)
    .json({ success: false, message: "Something went wrong on the server." });
});

export default app;
