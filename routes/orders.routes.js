import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import { createOrder, vendorOrders, updateOrderStatus } from "../controllers/orders.controller.js";

const router = Router();

router.post("/", verifyJWT, requireRole("customer"), createOrder);
router.get("/vendor", verifyJWT, requireRole("vendor"), vendorOrders);
router.patch("/:id/status", verifyJWT, requireRole("vendor"), updateOrderStatus);

export default router;