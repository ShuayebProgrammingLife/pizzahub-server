import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";
import { requireRole } from "../middleware/requireRole.js";

import { browseItems, featuredItems, itemsMeta, getItem } from "../controllers/publicItems.controller.js";

import {
  createItem,
  myItems,
  updateItem,
  setAvailability,
  deleteItem,
} from "../controllers/items.controller.js";

const router = Router();
const vendorOnly = [verifyJWT, requireRole("vendor")];

// Public (no login needed)
router.get("/", browseItems);
router.get("/featured", featuredItems);
router.get("/meta", itemsMeta);

// Vendor only ("/mine" must stay above "/:id" routes)
router.get("/mine", ...vendorOnly, myItems);
router.get("/:id", getItem);

router.post("/", ...vendorOnly, createItem);
router.patch("/:id", ...vendorOnly, updateItem);
router.patch("/:id/availability", ...vendorOnly, setAvailability);
router.delete("/:id", ...vendorOnly, deleteItem);

export default router;