import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createCheckoutSession,
  createPortalSession,
  paymentStatus,
} from "../controllers/payments.controller.js";

const router = Router();
const vendorOnly = [verifyJWT, requireRole("vendor")];

router.post("/checkout-session", ...vendorOnly, createCheckoutSession);
router.post("/portal", ...vendorOnly, createPortalSession);
router.get("/status", ...vendorOnly, paymentStatus);

export default router;