import "dotenv/config";
import { getDb } from "../config/db.js";

const db = await getDb();
const r = await db.collection("menuItems").updateMany(
  { status: "pending" },
  { $set: { status: "approved" } }
);
console.log(`Approved ${r.modifiedCount} items`);
process.exit(0);