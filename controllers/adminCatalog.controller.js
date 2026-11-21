import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { isPremium } from "../utils/plan.js";
import { CATEGORIES, FREE_ACTIVE_LIMIT } from "../utils/constants.js";
import { OID, clean, rx, paging, pageInfo } from "../utils/query.js";

const ITEM_STATUSES = ["pending", "approved", "rejected", "inactive"];
const TX_STATUSES = ["paid", "pending", "failed", "expired"];
const ACTIVE = ["pending", "approved"];

const vendorStages = [
  { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
];

// GET /api/admin/items?search=&status=&category=&page=&limit=
export async function adminListItems(req, res, next) {
  try {
    const search = clean(req.query.search);
    const status = ITEM_STATUSES.includes(req.query.status) ? req.query.status : "";
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : "";
    const { page, limit } = paging(req.query);

    const match = {};
    if (status) match.status = status;
    if (category) match.category = category;

    const col = (await getDb()).collection("menuItems");

    const pipeline = [
      { $match: match },
      ...vendorStages,
      ...(search
        ? [
          {
            $match: {
              $or: [
                { itemName: rx(search) },
                { location: rx(search) },
                { category: rx(search) },
                { "vendor.name": rx(search) },
                { "vendor.businessName": rx(search) },
              ],
            },
          },
        ]
        : []),
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                itemName: 1,
                category: 1,
                description: 1,
                price: 1,
                location: 1,
                images: 1,
                status: 1,
                isAvailable: 1,
                createdAt: 1,
                vendor: {
                  id: "$vendor._id",
                  name: { $ifNull: ["$vendor.businessName", "$vendor.name"] },
                  email: "$vendor.email",
                  isBlocked: "$vendor.isBlocked",
                },
              },
            },
          ],
          total: [{ $count: "n" }],
        },
      },
    ];

    const [result] = await col.aggregate(pipeline).toArray();
    const total = result?.total?.[0]?.n ?? 0;

    // counts for the status tabs (not affected by the current filters)
    const rows = await col.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
    const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const counts = {
      all: rows.reduce((a, r) => a + r.n, 0),
      pending: by.pending ?? 0,
      approved: by.approved ?? 0,
      rejected: by.rejected ?? 0,
      inactive: by.inactive ?? 0,
    };

    res.json({ items: result?.items ?? [], counts, ...pageInfo(total, page, limit) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/items/:id/status  { status: "approved" | "rejected" | "inactive" | "pending" }
export async function setItemStatus(req, res, next) {
  try {
    const { id } = req.params;
    if (!OID.test(id)) return res.status(400).json({ message: "Invalid item id" });

    const status = req.body?.status;
    if (!ITEM_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Status must be pending, approved, rejected or inactive" });
    }

    const db = await getDb();
    const items = db.collection("menuItems");
    const item = await items.findOne({ _id: new ObjectId(id) });
    if (!item) return res.status(404).json({ message: "Item not found" });
    if (item.status === status) return res.json({ message: "No change", status });

    // moving an item into an active status uses one of the vendor's slots
    const wasActive = ACTIVE.includes(item.status);
    const willBeActive = ACTIVE.includes(status);
    if (!wasActive && willBeActive && item.isAvailable !== false) {
      const vendor = await db.collection("users").findOne({ _id: item.vendorId });
      if (vendor && !isPremium(vendor)) {
        const active = await items.countDocuments({
          vendorId: item.vendorId,
          status: { $in: ACTIVE },
          isAvailable: { $ne: false },
        });
        if (active >= FREE_ACTIVE_LIMIT) {
          return res.status(409).json({
            message: `This vendor is on the Free plan and already has ${FREE_ACTIVE_LIMIT} active items`,
            code: "PLAN_LIMIT",
          });
        }
      }
    }

    await items.updateOne(
      { _id: item._id },
      {
        $set: {
          status,
          reviewedAt: new Date(),
          reviewedBy: new ObjectId(req.user.id),
          updatedAt: new Date(),
        },
      }
    );
    res.json({ message: `Item ${status}`, status });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/admin/items/:id
export async function adminDeleteItem(req, res, next) {
  try {
    const { id } = req.params;
    if (!OID.test(id)) return res.status(400).json({ message: "Invalid item id" });

    const db = await getDb();
    const _id = new ObjectId(id);
    const item = await db.collection("menuItems").findOne({ _id });
    if (!item) return res.status(404).json({ message: "Item not found" });

    await db.collection("menuItems").deleteOne({ _id });

    // pending orders for a removed item would hang forever, so close them
    const closed = await db.collection("orders").updateMany(
      { itemId: _id, status: "pending" },
      { $set: { status: "rejected", respondedAt: new Date(), updatedAt: new Date(), closedByAdmin: true } }
    );

    res.json({ message: "Item deleted", ordersClosed: closed.modifiedCount });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/transactions?search=&status=&page=&limit=  (read-only)
export async function listTransactions(req, res, next) {
  try {
    const search = clean(req.query.search);
    const status = TX_STATUSES.includes(req.query.status) ? req.query.status : "";
    const { page, limit } = paging(req.query);

    const col = (await getDb()).collection("transactions");

    const pipeline = [
      { $match: status ? { status } : {} },
      ...vendorStages,
      ...(search
        ? [
          {
            $match: {
              $or: [
                { "vendor.name": rx(search) },
                { "vendor.businessName": rx(search) },
                { "vendor.email": rx(search) },
                { stripeSessionId: rx(search) },
              ],
            },
          },
        ]
        : []),
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          transactions: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                plan: 1,
                amount: 1,
                currency: 1,
                status: 1,
                stripeSessionId: 1,
                createdAt: 1,
                vendor: {
                  name: { $ifNull: ["$vendor.businessName", "$vendor.name"] },
                  email: "$vendor.email",
                },
              },
            },
          ],
          total: [{ $count: "n" }],
          paid: [{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }],
        },
      },
    ];

    const [result] = await col.aggregate(pipeline).toArray();
    const total = result?.total?.[0]?.n ?? 0;

    res.json({
      transactions: result?.transactions ?? [],
      paidRevenue: result?.paid?.[0]?.total ?? 0,
      ...pageInfo(total, page, limit),
    });
  } catch (err) {
    next(err);
  }
}