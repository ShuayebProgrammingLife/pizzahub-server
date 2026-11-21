import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";

const OID = /^[a-f\d]{24}$/i;
const DAY = 24 * 60 * 60 * 1000;

function parseDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

export async function createOrder(req, res, next) {
  try {
    const { itemId, deliveryDate, deliveryAddress, message } = req.body || {};

    if (typeof itemId !== "string" || !OID.test(itemId)) {
      return res.status(400).json({ message: "Invalid item id" });
    }

    const date = parseDate(deliveryDate);
    if (!date) return res.status(400).json({ message: "Choose a valid delivery date" });
    const minDate = new Date(Date.now() - DAY); // one day of slack for time zones
    minDate.setUTCHours(0, 0, 0, 0);
    if (date < minDate) return res.status(400).json({ message: "Delivery date cannot be in the past" });
    if (date > new Date(Date.now() + 60 * DAY)) {
      return res.status(400).json({ message: "Delivery date must be within the next 60 days" });
    }

    const address = typeof deliveryAddress === "string" ? deliveryAddress.trim() : "";
    if (address.length < 5 || address.length > 300) {
      return res.status(400).json({ message: "Delivery address must be 5-300 characters" });
    }

    const note = typeof message === "string" ? message.trim() : "";
    if (note.length > 500) {
      return res.status(400).json({ message: "Message must be 500 characters or fewer" });
    }

    const db = await getDb();
    const item = await db.collection("menuItems").findOne({ _id: new ObjectId(itemId) });
    const vendor = item ? await db.collection("users").findOne({ _id: item.vendorId }) : null;

    // only approved + available items from unblocked vendors can be ordered
    if (!item || item.status !== "approved" || item.isAvailable === false || !vendor || vendor.isBlocked) {
      return res.status(404).json({ message: "This item is not available for ordering" });
    }

    // customer, vendor and item all come from the server, never from the client
    if (item.vendorId.toString() === req.user.id) {
      return res.status(403).json({ message: "You cannot order your own item" });
    }

    const orders = db.collection("orders");
    const customerId = new ObjectId(req.user.id);

    const duplicate = await orders.findOne({
      customerId,
      itemId: item._id,
      deliveryDate: date,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res
        .status(409)
        .json({ message: "You already have an active order for this item on that date" });
    }

    const doc = {
      itemId: item._id,
      vendorId: item.vendorId,
      customerId,
      deliveryDate: date,
      deliveryAddress: address,
      message: note,
      priceAtOrder: item.price,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await orders.insertOne(doc);

    res.status(201).json({ message: "Order placed. The restaurant will review it shortly.", order: { ...doc, _id: insertedId } });
  } catch (err) {
    next(err);
  }
}