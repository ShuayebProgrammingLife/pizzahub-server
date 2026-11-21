import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  adminOverview,
  listUsers,
  getUserDetails,
  setUserBlocked,
} from "../controllers/adminUsers.controller.js";
import {
  adminListItems,
  setItemStatus,
  adminDeleteItem,
  listTransactions,
} from "../controllers/adminCatalog.controller.js";

const router = Router();

// every route below needs a valid token AND the admin role
router.use(verifyJWT, requireRole("admin"));

router.get("/overview", adminOverview);

router.get("/users", listUsers);
router.get("/users/:id", getUserDetails);
router.patch("/users/:id/block", setUserBlocked);

router.get("/items", adminListItems);
router.patch("/items/:id/status", setItemStatus);
router.delete("/items/:id", adminDeleteItem);

// Transactions are read-only: deliberately no POST, PATCH or DELETE here.
// Only the verified Stripe webhook (Step 10) writes to this collection.
router.get("/transactions", listTransactions);

export default router;