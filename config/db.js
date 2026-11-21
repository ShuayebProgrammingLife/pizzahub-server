import { MongoClient } from "mongodb";

let client;
let db;

export async function getDb() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.DB_NAME || "pizzahub");

  // one transaction per Stripe session, even if a webhook is delivered twice
  try {
    await db.collection("transactions").createIndex(
      { stripeSessionId: 1 },
      { unique: true, partialFilterExpression: { stripeSessionId: { $type: "string" } } }
    );
  } catch (err) {
    console.warn("Transactions index setup skipped:", err.message);
  }
  return db;
}