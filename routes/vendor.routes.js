import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import { vendorOverview } from "../controllers/vendor.controller.js";

const router = Router();

router.get("/overview", verifyJWT, requireRole("vendor"), vendorOverview);

export default router;