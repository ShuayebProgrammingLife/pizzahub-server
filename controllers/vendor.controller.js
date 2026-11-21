import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { isPremium } from "../utils/plan.js";
import { FREE_ACTIVE_LIMIT } from "../utils/constants.js";

export async function vendorOverview(req, res, next) {
  try {
    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);
    const items = db.collection("menuItems");
    const orders = db.collection("orders");

    const [totalItems, activeItems, pendingItems, pendingOrders, acceptedOrders, revenue, account] =
      await Promise.all([
        items.countDocuments({ vendorId }),
        items.countDocuments({
          vendorId,
          status: { $in: ["pending", "approved"] },
          isAvailable: { $ne: false },
        }),
        items.countDocuments({ vendorId, status: "pending" }),
        orders.countDocuments({ vendorId, status: "pending" }),
        orders.countDocuments({ vendorId, status: "accepted" }),
        orders
          .aggregate([
            { $match: { vendorId, status: "accepted" } },
            { $group: { _id: null, total: { $sum: "$priceAtOrder" } } },
          ])
          .toArray(),
        db
          .collection("users")
          .findOne({ _id: vendorId }, { projection: { subscriptionCancelAtPeriodEnd: 1, stripeCustomerId: 1 } }),
      ]);

    const premium = isPremium(req.user);
    res.json({
      totalItems,
      activeItems,
      pendingItems,
      pendingOrders,
      acceptedOrders,
      acceptedRevenue: revenue[0]?.total ?? 0,
      plan: premium ? "premium" : "free",
      planExpiresAt: premium ? req.user.subscriptionExpiresAt : null,
      cancelAtPeriodEnd: premium && !!account?.subscriptionCancelAtPeriodEnd,
      canManageBilling: !!account?.stripeCustomerId,
      limit: premium ? null : FREE_ACTIVE_LIMIT, // null = unlimited
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/vendor/analytics (only this vendor's orders)
export async function vendorAnalytics(req, res, next) {
  try {
    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);
    const orders = db.collection("orders");

    // the last 7 days including today (UTC)
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 6);

    const [statusRows, dayRows, topItems] = await Promise.all([
      orders.aggregate([{ $match: { vendorId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
      orders
        .aggregate([
          { $match: { vendorId, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
              n: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      orders
        .aggregate([
          { $match: { vendorId, status: { $in: ["pending", "accepted"] } } },
          { $group: { _id: "$itemId", orders: { $sum: 1 }, value: { $sum: "$priceAtOrder" } } },
          { $sort: { orders: -1, value: -1 } },
          { $limit: 5 },
          { $lookup: { from: "menuItems", localField: "_id", foreignField: "_id", as: "item" } },
          { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              orders: 1,
              value: 1,
              name: "$item.itemName",
              image: { $arrayElemAt: ["$item.images", 0] },
            },
          },
        ])
        .toArray(),
    ]);

    const by = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));
    const perDay = new Map(dayRows.map((r) => [r._id, r.n]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      return { date, orders: perDay.get(date) ?? 0 };
    });

    res.json({
      byStatus: {
        pending: by.pending ?? 0,
        accepted: by.accepted ?? 0,
        rejected: by.rejected ?? 0,
        cancelled: by.cancelled ?? 0,
      },
      days,
      topItems,
    });
  } catch (err) {
    next(err);
  }
}