import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { getDb } from "./config/db.js";

import meRoutes from "./routes/me.routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// NOTE: the Stripe webhook route (express.raw) will be added HERE later,
// BEFORE express.json(), so the signature check works.

app.use(express.json());
app.use(morgan("dev"));

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