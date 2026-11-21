import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { getStripe } from "../utils/stripe.js";

const OID = /^[a-f\d]{24}$/i;

// newer Stripe API versions moved current_period_end onto the subscription item
const periodEnd = (sub) => {
  const s = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return s ? new Date(s * 1000) : null;
};
const idOf = (v) => (typeof v === "string" ? v : v?.id ?? null);

export async function onCheckoutCompleted(session, db) {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;

  const vendorId = session.client_reference_id;
  if (!vendorId || !OID.test(vendorId)) {
    console.warn("Checkout without a valid vendor reference:", session.id);
    return;
  }

  const transactions = db.collection("transactions");
  const users = db.collection("users");

  // only trust sessions our own server created for this exact vendor
  const tx = await transactions.findOne({ stripeSessionId: session.id });
  if (!tx || tx.vendorId.toString() !== vendorId) {
    console.warn("Ignoring a checkout session we did not create:", session.id);
    return;
  }

  const vendor = await users.findOne({ _id: new ObjectId(vendorId), role: "vendor" });
  if (!vendor) {
    console.warn("Vendor not found for session:", session.id);
    return;
  }

  const subId = idOf(session.subscription);
  const sub = subId ? await getStripe().subscriptions.retrieve(subId) : null;
  const expiresAt = periodEnd(sub) ?? new Date(Date.now() + 31 * 864e5);

  await transactions.updateOne(
    { _id: tx._id },
    {
      $set: {
        status: "paid",
        stripeSubscriptionId: subId,
        amount: (session.amount_total ?? tx.amount * 100) / 100,
        currency: session.currency ?? tx.currency,
        paidAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  // the ONLY place a vendor becomes Premium
  await users.updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: expiresAt,
        subscriptionCancelAtPeriodEnd: !!sub?.cancel_at_period_end,
        stripeCustomerId: idOf(session.customer),
        stripeSubscriptionId: subId,
        updatedAt: new Date(),
      },
    }
  );
}

async function onSessionClosed(session, db, status) {
  await db
    .collection("transactions")
    .updateOne(
      { stripeSessionId: session.id, status: "pending" },
      { $set: { status, updatedAt: new Date() } }
    );
}

// monthly renewal: extend the expiry and record the payment
async function onInvoicePaid(invoice, db) {
  const subId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  if (!subId || invoice.billing_reason !== "subscription_cycle") return; // first payment = checkout event

  const vendor = await db.collection("users").findOne({ stripeSubscriptionId: idOf(subId) });
  if (!vendor) return;

  const end = invoice.lines?.data?.[0]?.period?.end;
  await db.collection("transactions").updateOne(
    { stripeSessionId: invoice.id },
    {
      $setOnInsert: {
        vendorId: vendor._id,
        plan: "premium",
        amount: (invoice.amount_paid ?? 0) / 100,
        currency: invoice.currency ?? "usd",
        stripeSessionId: invoice.id, // renewals are referenced by invoice id
        stripeSubscriptionId: idOf(subId),
        status: "paid",
        kind: "renewal",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  await db.collection("users").updateOne(
    { _id: vendor._id },
    {
      $set: {
        subscriptionPlan: "premium",
        ...(end ? { subscriptionExpiresAt: new Date(end * 1000) } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

async function onSubscriptionUpdated(sub, db) {
  const users = db.collection("users");
  const vendor = await users.findOne({ stripeSubscriptionId: sub.id });
  if (!vendor) return; // checkout.session.completed will set everything up

  if (["active", "trialing"].includes(sub.status)) {
    const end = periodEnd(sub);
    await users.updateOne(
      { _id: vendor._id },
      {
        $set: {
          subscriptionPlan: "premium",
          subscriptionCancelAtPeriodEnd: !!sub.cancel_at_period_end, // cancelled but active until period end
          ...(end ? { subscriptionExpiresAt: end } : {}),
          updatedAt: new Date(),
        },
      }
    );
  } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
    await downgrade(vendor._id, db);
  }
}

async function onSubscriptionDeleted(sub, db) {
  const vendor = await db.collection("users").findOne({ stripeSubscriptionId: sub.id });
  if (vendor) await downgrade(vendor._id, db);
}

function downgrade(vendorId, db) {
  return db.collection("users").updateOne(
    { _id: vendorId },
    {
      $set: { subscriptionPlan: "free", subscriptionCancelAtPeriodEnd: false, updatedAt: new Date() },
      $unset: { subscriptionExpiresAt: "", stripeSubscriptionId: "" },
    }
  );
}

async function handleEvent(event) {
  const db = await getDb();
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckoutCompleted(obj, db);
    case "checkout.session.expired":
      return onSessionClosed(obj, db, "expired");
    case "checkout.session.async_payment_failed":
      return onSessionClosed(obj, db, "failed");
    case "invoice.paid":
      return onInvoicePaid(obj, db);
    case "customer.subscription.updated":
      return onSubscriptionUpdated(obj, db);
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(obj, db);
    default:
      return; // other events are acknowledged and ignored
  }
}

// POST /api/webhooks/stripe (mounted with express.raw BEFORE express.json)
export async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body, // raw Buffer
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature check failed:", err.message);
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    await handleEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error(`Webhook handler failed for ${event.type}:`, err);
    res.status(500).json({ message: "Webhook handler failed" }); // Stripe will retry
  }
}