import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";

let jwks;
function getJwks() {
  // lazy, so .env is loaded first. Keys are cached after the first fetch
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${process.env.AUTH_URL}/api/auth/jwks`));
  return jwks;
}

const idFilter = (id) =>
  ObjectId.isValid(id) ? { $or: [{ _id: new ObjectId(id) }, { id }] } : { id };

export async function verifyJWT(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const token = header.slice(7);

    // 1) signature, expiry, issuer, audience
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: process.env.AUTH_URL,
      audience: process.env.AUTH_URL,
    });

    // 2) load the real user, never trust role/blocked inside the token
    const db = await getDb();
    const user = await db.collection("users").findOne(idFilter(payload.sub));
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isBlocked) return res.status(403).json({ message: "Your account is blocked" });

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      image: user.image || null,
      role: user.role || "customer",
      subscriptionPlan: user.subscriptionPlan || "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };
    next();
  } catch (err) {
    if (err?.code === "ERR_JWT_EXPIRED") {
      return res.status(401).json({ message: "Token expired, please sign in again" });
    }
    if (err?.code === "ERR_JWKS_TIMEOUT") {
      return res.status(503).json({ message: "Auth service unavailable" });
    }
    if (err?.code?.startsWith?.("ERR_J")) {
      return res.status(401).json({ message: "Invalid token" });
    }
    next(err);
  }
}