import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { validateItem } from "../utils/validateItem.js";
import { isPremium } from "../utils/plan.js";
import { FREE_ACTIVE_LIMIT } from "../utils/constants.js";

const getCol = async () => (await getDb()).collection("menuItems");
const parseId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

const ACTIVE_FILTER = {
  status: { $in: ["pending", "approved"] },
  isAvailable: { $ne: false },
};

async function countActive(vendorId) {
  const col = await getCol();
  return col.countDocuments({ vendorId: new ObjectId(vendorId), ...ACTIVE_FILTER });
}

const limitReached = (user, count) => !isPremium(user) && count >= FREE_ACTIVE_LIMIT;

const limitError = (res) =>
  res.status(403).json({
    message: `Free plan allows ${FREE_ACTIVE_LIMIT} active items. Upgrade to Premium to add more.`,
    code: "PLAN_LIMIT",
  });

// Loads the item and verifies the logged-in vendor owns it
async function getOwned(req, res) {
  const _id = parseId(req.params.id);
  if (!_id) {
    res.status(400).json({ message: "Invalid item id" });
    return null;
  }
  const col = await getCol();
  const item = await col.findOne({ _id });
  if (!item) {
    res.status(404).json({ message: "Item not found" });
    return null;
  }
  if (item.vendorId.toString() !== req.user.id) {
    res.status(403).json({ message: "You can only manage your own items" });
    return null;
  }
  return item;
}

export async function createItem(req, res, next) {
  try {
    const { data, errors } = validateItem(req.body);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    if (limitReached(req.user, await countActive(req.user.id))) return limitError(res);

    const doc = {
      ...data, // only validated fields, so the client can never set status or vendorId
      vendorId: new ObjectId(req.user.id),
      status: "pending",
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const col = await getCol();
    const { insertedId } = await col.insertOne(doc);
    res.status(201).json({ message: "Item submitted for approval", item: { ...doc, _id: insertedId } });
  } catch (err) {
    next(err);
  }
}

export async function myItems(req, res, next) {
  try {
    const col = await getCol();
    const items = await col
      .find({ vendorId: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .toArray();

    const activeCount = items.filter(
      (i) => ["pending", "approved"].includes(i.status) && i.isAvailable !== false
    ).length;

    res.json({
      items,
      activeCount,
      limit: isPremium(req.user) ? null : FREE_ACTIVE_LIMIT, // null = unlimited
    });
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req, res, next) {
  try {
    const item = await getOwned(req, res);
    if (!item) return;

    const { data, errors } = validateItem(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    if (!Object.keys(data).length) return res.status(400).json({ message: "Nothing to update" });

    const set = { ...data, updatedAt: new Date() };

    // A rejected item coming back for review takes an active slot again
    if (item.status === "rejected" && item.isAvailable !== false) {
      if (limitReached(req.user, await countActive(req.user.id))) return limitError(res);
    }
    // Edited content must be reviewed again
    if (["approved", "rejected"].includes(item.status)) set.status = "pending";

    const col = await getCol();
    await col.updateOne({ _id: item._id }, { $set: set });
    res.json({ message: "Item updated", item: { ...item, ...set } });
  } catch (err) {
    next(err);
  }
}

export async function setAvailability(req, res, next) {
  try {
    const item = await getOwned(req, res);
    if (!item) return;

    const { isAvailable } = req.body || {};
    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({ message: "isAvailable must be true or false" });
    }

    if (isAvailable && item.isAvailable === false && ["pending", "approved"].includes(item.status)) {
      if (limitReached(req.user, await countActive(req.user.id))) return limitError(res);
    }

    const col = await getCol();
    await col.updateOne({ _id: item._id }, { $set: { isAvailable, updatedAt: new Date() } });
    res.json({ message: isAvailable ? "Item is now available" : "Item marked unavailable", isAvailable });
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req, res, next) {
  try {
    const item = await getOwned(req, res);
    if (!item) return;
    const col = await getCol();
    await col.deleteOne({ _id: item._id });
    res.json({ message: "Item deleted" });
  } catch (err) {
    next(err);
  }
}