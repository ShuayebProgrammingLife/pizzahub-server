import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import { vendorOverview, vendorAnalytics } from "../controllers/vendor.controller.js";

const router = Router();
const vendorOnly = [verifyJWT, requireRole("vendor")];

router.get("/overview", ...vendorOnly, vendorOverview);
router.get("/analytics", ...vendorOnly, vendorAnalytics);

export default router;