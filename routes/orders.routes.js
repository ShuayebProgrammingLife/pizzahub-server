import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createOrder,
  vendorOrders,
  updateOrderStatus,
  customerOrders,
  customerSummary,
  cancelOrder,
} from "../controllers/orders.controller.js";

const router = Router();
const customerOnly = [verifyJWT, requireRole("customer")];
const vendorOnly = [verifyJWT, requireRole("vendor")];

// Customer
router.post("/", ...customerOnly, createOrder);
router.get("/mine/summary", ...customerOnly, customerSummary);
router.get("/mine", ...customerOnly, customerOrders);
router.patch("/:id/cancel", ...customerOnly, cancelOrder);

// Vendor
router.get("/vendor", ...vendorOnly, vendorOrders);
router.patch("/:id/status", ...vendorOnly, updateOrderStatus);

export default router;