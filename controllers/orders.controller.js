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

const STATUSES = ["pending", "accepted", "rejected", "cancelled"];

// GET /api/orders/vendor?status=pending (only this vendor's orders)
export async function vendorOrders(req, res, next) {
  try {
    const db = await getDb();
    const match = { vendorId: new ObjectId(req.user.id) };
    if (typeof req.query.status === "string" && STATUSES.includes(req.query.status)) {
      match.status = req.query.status;
    }

    const orders = await db
      .collection("orders")
      .aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
        { $lookup: { from: "menuItems", localField: "itemId", foreignField: "_id", as: "item" } },
        { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer" } },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            status: 1,
            deliveryDate: 1,
            deliveryAddress: 1,
            message: 1,
            createdAt: 1,
            priceAtOrder: 1,
            customer: { name: "$customer.name", email: "$customer.email", image: "$customer.image" },
            item: {
              _id: "$item._id",
              itemName: "$item.itemName",
              image: { $arrayElemAt: ["$item.images", 0] },
              price: "$item.price",
            },
          },
        },
      ])
      .toArray();

    res.json({ orders });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/orders/:id/status  { status: "accepted" | "rejected" }
export async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    if (!OID.test(id)) return res.status(400).json({ message: "Invalid order id" });

    const newStatus = req.body?.status;
    if (!["accepted", "rejected"].includes(newStatus)) {
      return res.status(400).json({ message: "Status must be accepted or rejected" });
    }

    const db = await getDb();
    const orders = db.collection("orders");
    const order = await orders.findOne({ _id: new ObjectId(id) });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ownership: vendors can only touch their own orders
    if (order.vendorId.toString() !== req.user.id) {
      return res.status(403).json({ message: "You can only manage your own orders" });
    }
    if (order.status !== "pending") {
      return res.status(409).json({ message: "Only pending orders can be accepted or rejected" });
    }

    // the status filter makes this atomic: a second click can never change it again
    const result = await orders.updateOne(
      { _id: order._id, vendorId: order.vendorId, status: "pending" },
      { $set: { status: newStatus, respondedAt: new Date(), updatedAt: new Date() } }
    );
    if (result.modifiedCount === 0) {
      return res.status(409).json({ message: "This order was already updated" });
    }

    res.json({ message: `Order ${newStatus}`, status: newStatus });
  } catch (err) {
    next(err);
  }
}