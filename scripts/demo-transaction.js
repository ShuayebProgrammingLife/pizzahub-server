import "dotenv/config";
import { getDb } from "../config/db.js";

const db = await getDb();
const col = db.collection("transactions");

if (process.argv[2] === "clean") {
  const r = await col.deleteMany({ isDemo: true });
  console.log(`Removed ${r.deletedCount} demo transactions`);
} else {
  const vendor = await db.collection("users").findOne({ role: "vendor" });
  if (!vendor) {
    console.log("Create a vendor account first");
    process.exit(1);
  }
  await col.insertMany([
    { vendorId: vendor._id, plan: "premium", amount: 39, currency: "usd", stripeSessionId: "cs_test_demo_paid", stripeSubscriptionId: "sub_demo_1", status: "paid", createdAt: new Date(), isDemo: true },
    { vendorId: vendor._id, plan: "premium", amount: 39, currency: "usd", stripeSessionId: "cs_test_demo_failed", stripeSubscriptionId: null, status: "failed", createdAt: new Date(Date.now() - 864e5), isDemo: true },
  ]);
  console.log("Demo transactions added");
}
process.exit(0);