import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { OID, clean, rx, paging, pageInfo } from "../utils/query.js";

const ROLES = ["vendor", "customer", "admin"];

// never return anything beyond these fields
const USER_FIELDS = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  businessName: 1,
  isBlocked: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

export async function adminOverview(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection("users");
    const items = db.collection("menuItems");
    const tx = db.collection("transactions");

    const [totalUsers, vendors, customers, blockedUsers, totalItems, pendingItems, totalTransactions, revenue, itemRows] =
      await Promise.all([
        users.countDocuments({}),
        users.countDocuments({ role: "vendor" }),
        users.countDocuments({ role: "customer" }),
        users.countDocuments({ isBlocked: true }),
        items.countDocuments({}),
        items.countDocuments({ status: "pending" }),
        tx.countDocuments({}),
        tx.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
        items.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
      ]);

    const by = Object.fromEntries(itemRows.map((r) => [r._id, r.n]));
    res.json({
      totalUsers,
      vendors,
      customers,
      admins: Math.max(0, totalUsers - vendors - customers),
      blockedUsers,
      totalItems,
      pendingItems,
      totalTransactions,
      revenue: revenue[0]?.total ?? 0,
      itemsByStatus: {
        pending: by.pending ?? 0,
        approved: by.approved ?? 0,
        rejected: by.rejected ?? 0,
        inactive: by.inactive ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/users?search=&role=&status=&page=&limit=
export async function listUsers(req, res, next) {
  try {
    const search = clean(req.query.search);
    const role = ROLES.includes(req.query.role) ? req.query.role : "";
    const status = ["active", "blocked"].includes(req.query.status) ? req.query.status : "";
    const { page, limit } = paging(req.query);

    const match = {};
    if (role) match.role = role;
    if (status === "blocked") match.isBlocked = true;
    if (status === "active") match.isBlocked = { $ne: true };
    if (search) match.$or = [{ name: rx(search) }, { email: rx(search) }];

    const col = (await getDb()).collection("users");
    const [users, total] = await Promise.all([
      col
        .find(match, { projection: USER_FIELDS })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      col.countDocuments(match),
    ]);

    res.json({ users, ...pageInfo(total, page, limit) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/users/:id
export async function getUserDetails(req, res, next) {
  try {
    const { id } = req.params;
    if (!OID.test(id)) return res.status(400).json({ message: "Invalid user id" });
    const _id = new ObjectId(id);

    const db = await getDb();
    const user = await db.collection("users").findOne({ _id }, { projection: USER_FIELDS });
    if (!user) return res.status(404).json({ message: "User not found" });

    let stats = {};
    if (user.role === "vendor") {
      const [menuItems, ordersReceived, transactions] = await Promise.all([
        db.collection("menuItems").countDocuments({ vendorId: _id }),
        db.collection("orders").countDocuments({ vendorId: _id }),
        db.collection("transactions").countDocuments({ vendorId: _id }),
      ]);
      stats = { menuItems, ordersReceived, transactions };
    } else if (user.role === "customer") {
      stats = { ordersPlaced: await db.collection("orders").countDocuments({ customerId: _id }) };
    }

    res.json({ user, stats });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/users/:id/block  { isBlocked: true | false }
export async function setUserBlocked(req, res, next) {
  try {
    const { id } = req.params;
    if (!OID.test(id)) return res.status(400).json({ message: "Invalid user id" });

    const { isBlocked } = req.body || {};
    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be true or false" });
    }
    if (id === req.user.id) {
      return res.status(400).json({ message: "You cannot block your own account" });
    }

    const users = (await getDb()).collection("users");
    const target = await users.findOne({ _id: new ObjectId(id) });
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.role === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be blocked" });
    }

    await users.updateOne({ _id: target._id }, { $set: { isBlocked, updatedAt: new Date() } });
    res.json({ message: isBlocked ? "User blocked" : "User unblocked", isBlocked });
  } catch (err) {
    next(err);
  }
}