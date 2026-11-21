import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { getDb } from "./config/db.js";

import meRoutes from "./routes/me.routes.js";
import itemRoutes from "./routes/items.routes.js";
import orderRoutes from "./routes/orders.routes.js";
import vendorRoutes from "./routes/vendor.routes.js";
import adminRoutes from "./routes/admin.routes.js";

import paymentRoutes from "./routes/payments.routes.js";
import { stripeWebhook } from "./controllers/webhook.controller.js";

const app = express();

app.use(helmet());

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.CLIENT_URL?.replace(/\/+$/, ""),
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/+$/, "");
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes(clean) ||
        origin.endsWith(".vercel.app") ||
        process.env.CLIENT_URL === "*"
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Allow all to prevent any production CORS disruption
    },
    credentials: true,
  })
);

// NOTE: the Stripe webhook route (express.raw) will be added HERE later,
// Stripe needs the RAW body to verify the signature, so this goes BEFORE express.json()
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);

// BEFORE express.json(), so the signature check works.

app.use(express.json());
app.use(morgan("dev"));

app.use("/api/items", itemRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api/payments", paymentRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "PizzaHub API is running" });
});

app.get("/api/health", async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ status: "OK", db: "connected" });
  } catch (err) {
    console.error("DB ERROR:", err.message);
    res.status(500).json({
      status: "error",
      message: "Database connection failed",
      ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
    });
  }
});

app.use("/api", meRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT || 3002;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;