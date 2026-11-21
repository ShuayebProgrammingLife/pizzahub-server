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

    const [totalItems, activeItems, pendingItems, pendingOrders, acceptedOrders, revenue] =
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
      limit: premium ? null : FREE_ACTIVE_LIMIT, // null = unlimited
    });
  } catch (err) {
    next(err);
  }
}