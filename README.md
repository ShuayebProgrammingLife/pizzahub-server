# PizzaHub — Server API

The backend server for **PizzaHub** is built with **Node.js**, **Express.js**, **MongoDB native driver**, and **Stripe SDK**. It provides strict role-based access control, JWT session token verification, catalog moderation, an order state machine, and asynchronous Stripe webhook processing.

---

## Live Links & Repositories

* **Live Server API**: `https://pizzahub-server-n1u2.onrender.com`
* **Client GitHub Repository**: `https://github.com/ShuayebProgrammingLife/pizzahub-client`
* **Server GitHub Repository**: `https://github.com/ShuayebProgrammingLife/PizzaHub-Pizza-Ordering-Delivery-Platform`

---

## Core Capabilities & Architecture

### 1. Database Collections
The database relies on four primary business collections within MongoDB:
* `users`: Maintained by Better Auth with custom schema extensions (`role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`, `stripeCustomerId`, `stripeSubscriptionId`).
* `menuItems`: Vendor-submitted pizzas and items (`vendorId`, `itemName`, `category`, `description`, `price`, `location`, `images`, `status`, `createdAt`, `updatedAt`).
* `orders`: Customer pizza order documents (`itemId`, `vendorId`, `customerId`, `deliveryDate`, `deliveryAddress`, `message`, `priceAtOrder`, `status`, `createdAt`, `updatedAt`).
* `transactions`: Vendor subscription upgrade payments recorded from verified Stripe events (`vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt`, `paidAt`).

### 2. Business Rules & Enforcement
* **Free vs. Premium Quota**: Non-premium vendors are capped at **3 active items** (`status === 'approved' && isAvailable === true`). Creating or re-activating items beyond this threshold returns HTTP 403 unless upgraded to Premium.
* **Order Ownership**: Rejects orders when a vendor attempts to purchase their own menu items (`item.vendorId === req.user.id`).
* **Duplicate Active Orders**: Blocks duplicate pending/accepted orders for the identical customer, item, and delivery date.
* **Order State Machine**: Enforces valid transitions from `pending` to `accepted`, `rejected`, or `cancelled`. Orders can only be modified while in `pending` status.
* **Payment Security**: Subscriptions are **never** activated from client-side redirects. Premium upgrades are only triggered upon receiving a cryptographic Stripe webhook event (`checkout.session.completed` / `invoice.payment_succeeded`).

---

## Technology Stack (Server)

| Package | Version | Purpose |
| :--- | :--- | :--- |
| **express** | ^5.3.0 | Modern HTTP server routing and controller lifecycle |
| **mongodb** | ^7.9.1 | High-efficiency native MongoDB driver with connection pooling |
| **stripe** | ^23.2.0 | Stripe Checkout sessions, customers, and webhook signature verification |
| **jose** | ^6.2.18 | Cryptographic JWT token decoding and signature verification |
| **helmet** | ^8.3.0 | Secure HTTP response headers |
| **cors** | ^2.8.6 | Cross-Origin Resource Sharing with credentials support |
| **morgan** | ^1.12.1 | HTTP request logging for development telemetry |
| **dotenv** | ^18.0.10 | Environment variable loader |

---

## API Endpoints Overview

### Public & Menu Endpoints
* `GET /api/items` — Browse menu items with search, category, location, and price sorting.
* `GET /api/items/featured` — Retrieve approved items from active and premium vendors.
* `GET /api/items/meta` — Aggregate catalog categories, locations, and pricing bounds.
* `GET /api/items/:id` — Fetch complete details for a single menu item.

### Vendor Protected Routes (`requireRole("vendor")`)
* `GET /api/vendor/overview` — Aggregated counts of menu items, pending orders, and plan quota.
* `GET /api/vendor/analytics` — Status distribution, weekly order frequency, and top-selling pizzas.
* `GET /api/items/mine` — List all items created by the authenticated vendor.
* `POST /api/items` — Submit a new item for admin approval (ImgBB image required).
* `PATCH /api/items/:id` — Update item details or toggle availability.
* `DELETE /api/items/:id` — Remove an item (blocks deletion if active orders exist).
* `GET /api/orders/vendor` — List incoming customer orders with tab filtering.
* `PATCH /api/orders/:id/status` — Accept or reject a pending order.

### Customer Protected Routes (`requireRole("customer")`)
* `POST /api/orders` — Place a new pizza order with delivery date, address, and special notes.
* `GET /api/orders/mine` — Retrieve customer order history with status timeline.
* `GET /api/orders/mine/summary` — Overview counts of pending, accepted, rejected, and cancelled orders.
* `PATCH /api/orders/:id/cancel` — Cancel a pending order.

### Administrator Protected Routes (`requireRole("admin")`)
* `GET /api/admin/overview` — High-level platform telemetry (users, vendors, menu count, transactions).
* `GET /api/admin/users` — Search and filter registered accounts with role breakdown.
* `GET /api/admin/users/:id` — Retrieve comprehensive user profile and activity audit.
* `PATCH /api/admin/users/:id/block` — Toggle block/unblock status.
* `GET /api/admin/items` — Catalog moderation list with status tabs.
* `PATCH /api/admin/items/:id/status` — Approve or reject vendor submissions.
* `DELETE /api/admin/items/:id` — Delete inappropriate catalog items.
* `GET /api/admin/transactions` — Audit log of all Stripe subscription charges (read-only).

### Payment & Webhook Routes
* `POST /api/payments/checkout-session` — Create a Stripe Checkout session for Vendor Premium upgrade.
* `GET /api/payments/status` — Read-only verification query checking if Stripe webhook updated payment status.
* `POST /api/webhooks/stripe` — Cryptographically verified webhook handler using raw payload.

---

## Environment Variables

Create a `.env` file in the `pizzahub-server` directory:

```env
PORT=3002
CLIENT_URL=http://localhost:3000
AUTH_URL=http://localhost:3000

MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/?retryWrites=true&w=majority
DB_NAME=pizzahub

# Stripe API Keys (Test Mode)
STRIPE_SECRET_KEY=sk_test_51...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

---

## Challenge Implementations

### Challenge 1: Advanced Search, Query Parameters & Sorting
Handled in `publicItems.controller.js`:
* `search`: Regex match across `itemName`, `description`, and `category`.
* `category`: Exact match filter.
* `location`: Case-insensitive regex match against vendor restaurant location.
* `sort`:
  * `price_asc`: Sorts by `{ price: 1 }`.
  * `price_desc`: Sorts by `{ price: -1 }`.
  * `featured`: Multi-tier sort prioritizing `{ "vendor.subscriptionPlan": -1, createdAt: -1 }`.
  * `newest`: Sorts by `{ createdAt: -1 }`.

### Challenge 2: Strict JWT Verification Middleware
Handled via `middleware/verifyJWT.js` and `middleware/requireRole.js`:
1. Extracts `Authorization: Bearer <token>` from incoming request headers.
2. Decodes and verifies the token against Better Auth session records or JWT payload using `jose`.
3. Validates that the associated user exists in the `users` collection and confirms that `isBlocked !== true`.
4. Attaches the verified user profile (`id`, `email`, `role`, `subscriptionPlan`) to `req.user`.
5. The `requireRole(roles...)` guard verifies that `req.user.role` matches the route requirement, returning HTTP 403 Forbidden on role mismatch.

---

## Local Setup & Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ShuayebProgrammingLife/PizzaHub-Pizza-Ordering-Delivery-Platform.git
   cd PizzaHub-Pizza-Ordering-Delivery-Platform
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   # Populate MongoDB and Stripe keys
   ```

4. **Seed Administrator**:
   ```bash
   node scripts/seed-admin.js
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```

---

## Testing Instructions & Credentials

* **Admin Email**: `admin@pizzahub.com`
* **Admin Password**: `Admin1234`
* **Stripe Test Card**: `4242 4242 4242 4242` (Expiry: Any future date, CVC: `123`, ZIP: `10001`)
* **Stripe Webhook CLI (Local Testing)**:
  ```bash
  stripe listen --forward-to localhost:5000/api/webhooks/stripe
  ```
