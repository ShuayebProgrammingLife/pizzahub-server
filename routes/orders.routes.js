import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import { createOrder } from "../controllers/orders.controller.js";

const router = Router();

router.post("/", verifyJWT, requireRole("customer"), createOrder);

export default router;