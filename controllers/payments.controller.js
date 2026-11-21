import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { getStripe } from "../utils/stripe.js";
import { isPremium } from "../utils/plan.js";

const PLAN_NAME = "PizzaHub Premium";
const PLAN_AMOUNT_CENTS = 3900; // $39/month, used only when STRIPE_PRICE_ID is not set

const providerError = (res, err, message) => {
  console.error("Stripe error:", err?.message);
  return res.status(502).json({ message });
};

// POST /api/payments/checkout-session
// The vendor comes ONLY from the verified token. Anything in the body is ignored.
export async function createCheckoutSession(req, res, next) {
  try {
    if (isPremium(req.user)) {
      return res.status(409).json({ message: "You are already on the Premium plan" });
    }
    const stripe = getStripe();
    const db = await getDb();
    const vendorId = new ObjectId(req.user.id);

    const account = await db
      .collection("users")
      .findOne({ _id: vendorId }, { projection: { stripeCustomerId: 1 } });

    const validPriceId =
      typeof process.env.STRIPE_PRICE_ID === "string" &&
      process.env.STRIPE_PRICE_ID.trim().startsWith("price_") &&
      !process.env.STRIPE_PRICE_ID.includes("...");

    const lineItem = validPriceId
      ? { price: process.env.STRIPE_PRICE_ID.trim(), quantity: 1 }
      : {
        price_data: {
          currency: "usd",
          product_data: { name: PLAN_NAME, description: "Unlimited menu items, Premium badge and featured placement" },
          unit_amount: PLAN_AMOUNT_CENTS,
          recurring: { interval: "month" },
        },
        quantity: 1,
      };

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [lineItem],
        client_reference_id: req.user.id,
        metadata: { vendorId: req.user.id },
        subscription_data: { metadata: { vendorId: req.user.id } },
        ...(account?.stripeCustomerId
          ? { customer: account.stripeCustomerId }
          : { customer_email: req.user.email }),
        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
      });
    } catch (err) {
      return providerError(res, err, "Could not start the payment. Please try again.");
    }

    // saved as pending now; only the verified webhook can turn it into "paid"
    await db.collection("transactions").insertOne({
      vendorId,
      plan: "premium",
      amount: (session.amount_total ?? PLAN_AMOUNT_CENTS) / 100,
      currency: session.currency ?? "usd",
      stripeSessionId: session.id,
      stripeSubscriptionId: null,
      status: "pending",
      createdAt: new Date(),
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/status?session_id=cs_test_...
// Read-only. It reports what the webhook recorded and never activates anything.
export async function paymentStatus(req, res, next) {
  try {
    const sid = typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) {
      return res.status(400).json({ message: "Invalid payment session" });
    }

    const db = await getDb();
    const tx = await db
      .collection("transactions")
      .findOne({ stripeSessionId: sid, vendorId: new ObjectId(req.user.id) }); // own payments only
    if (!tx) return res.status(404).json({ message: "Payment not found" });

    res.json({ status: tx.status, plan: tx.plan, amount: tx.amount, currency: tx.currency });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/portal (Stripe Billing Portal: update card, cancel)
export async function createPortalSession(req, res, next) {
  try {
    const stripe = getStripe();
    const db = await getDb();
    const account = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.user.id) }, { projection: { stripeCustomerId: 1 } });

    if (!account?.stripeCustomerId) {
      return res.status(400).json({ message: "No billing account yet. Upgrade to Premium first." });
    }

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: account.stripeCustomerId,
        return_url: `${process.env.CLIENT_URL}/dashboard/vendor/subscription`,
      });
      res.json({ url: portal.url });
    } catch (err) {
      return providerError(res, err, "The billing portal is not available right now.");
    }
  } catch (err) {
    next(err);
  }
}