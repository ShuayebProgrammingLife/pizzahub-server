import { getDb } from "../config/db.js";
import { CATEGORIES } from "../utils/constants.js";

import { ObjectId } from "mongodb";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SORTS = {
  featured: { vendorIsPremium: -1, createdAt: -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
};

// Premium only while the subscription has not expired
const PREMIUM_EXPR = {
  $and: [
    { $eq: ["$vendor.subscriptionPlan", "premium"] },
    {
      $or: [
        { $eq: [{ $ifNull: ["$vendor.subscriptionExpiresAt", null] }, null] },
        { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] },
      ],
    },
  ],
};

// Only approved + available items from vendors that are not blocked
const visibleStages = (extraMatch = {}) => [
  { $match: { status: "approved", isAvailable: { $ne: false }, ...extraMatch } },
  { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
  { $unwind: "$vendor" },
  { $match: { "vendor.isBlocked": { $ne: true } } },
];

const clean = (v, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v) => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function parseQuery(q) {
  return {
    search: clean(q.search),
    category: CATEGORIES.includes(q.category) ? q.category : "",
    location: clean(q.location),
    minPrice: num(q.minPrice),
    maxPrice: num(q.maxPrice),
    sort: typeof q.sort === "string" && Object.hasOwn(SORTS, q.sort) ? q.sort : "featured",
    page: Math.max(1, parseInt(q.page) || 1),
    limit: Math.min(24, Math.max(1, parseInt(q.limit) || 9)),
  };
}

async function runQuery({ search, category, location, minPrice, maxPrice, sort, page, limit }) {
  const db = await getDb();

  const match = {};
  if (category) match.category = category;
  if (location) match.location = new RegExp(`^${escapeRegex(location)}$`, "i");
  if (minPrice !== null || maxPrice !== null) {
    match.price = {};
    if (minPrice !== null) match.price.$gte = minPrice;
    if (maxPrice !== null) match.price.$lte = maxPrice;
  }

  // every word must match somewhere (name, description, category, location, vendor)
  const terms = search.split(/\s+/).filter(Boolean).slice(0, 5);
  const termMatch = terms.map((t) => {
    const rx = new RegExp(escapeRegex(t.slice(0, 50)), "i");
    return {
      $or: [
        { itemName: rx },
        { description: rx },
        { category: rx },
        { location: rx },
        { "vendor.businessName": rx },
        { "vendor.name": rx },
      ],
    };
  });

  const pipeline = [
    ...visibleStages(match),
    ...(termMatch.length ? [{ $match: { $and: termMatch } }] : []),
    { $addFields: { vendorIsPremium: PREMIUM_EXPR } },
    { $sort: SORTS[sort] },
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
              createdAt: 1,
              vendor: {
                id: "$vendor._id",
                name: { $ifNull: ["$vendor.businessName", "$vendor.name"] },
                image: "$vendor.image",
                isPremium: "$vendorIsPremium",
              },
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ];

  const [result] = await db.collection("menuItems").aggregate(pipeline).toArray();
  const total = result?.total?.[0]?.n ?? 0;
  return { items: result?.items ?? [], total, page, pages: Math.max(1, Math.ceil(total / limit)), limit };
}

// GET /api/items?search=&category=&location=&minPrice=&maxPrice=&sort=&page=&limit=
export async function browseItems(req, res, next) {
  try {
    res.json(await runQuery(parseQuery(req.query)));
  } catch (err) {
    next(err);
  }
}

// GET /api/items/featured?limit=6 (premium vendors first, then newest)
export async function featuredItems(req, res, next) {
  try {
    const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
    res.json(await runQuery({ ...parseQuery({}), sort: "featured", limit }));
  } catch (err) {
    next(err);
  }
}

// GET /api/items/meta (category counts + covers, and location list for filters)
export async function itemsMeta(req, res, next) {
  try {
    const db = await getDb();
    const col = db.collection("menuItems");

    const cats = await col
      .aggregate([
        ...visibleStages(),
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            cover: { $first: { $arrayElemAt: ["$images", 0] } },
          },
        },
      ])
      .toArray();
    const byName = new Map(cats.map((c) => [c._id, c]));

    const locs = await col.aggregate([...visibleStages(), { $group: { _id: "$location" } }]).toArray();
    const seen = new Map();
    for (const l of locs) if (l._id && !seen.has(l._id.toLowerCase())) seen.set(l._id.toLowerCase(), l._id);

    res.json({
      categories: CATEGORIES.map((name) => ({
        name,
        count: byName.get(name)?.count ?? 0,
        cover: byName.get(name)?.cover ?? null,
      })),
      locations: [...seen.values()].sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/items/:id (only approved, available items from unblocked vendors)
export async function getItem(req, res, next) {
  try {
    const { id } = req.params;
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ message: "Invalid item id" });

    const db = await getDb();
    const [item] = await db
      .collection("menuItems")
      .aggregate([
        ...visibleStages({ _id: new ObjectId(id) }),
        { $addFields: { vendorIsPremium: PREMIUM_EXPR } },
        {
          $project: {
            itemName: 1,
            category: 1,
            description: 1,
            price: 1,
            location: 1,
            images: 1,
            createdAt: 1,
            vendor: {
              id: "$vendor._id",
              name: { $ifNull: ["$vendor.businessName", "$vendor.name"] },
              image: "$vendor.image",
              isPremium: "$vendorIsPremium",
            },
          },
        },
      ])
      .toArray();

    if (!item) return res.status(404).json({ message: "This item is not available" });
    res.json({ item });
  } catch (err) {
    next(err);
  }
}