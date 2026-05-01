# TastyTap — Intelligent Food Ordering Platform

Full-stack food ordering platform built with Node.js, Express, React, 
MongoDB, and Flutter. Features mood-based recommendations, group ordering,
a gamified Food Passport, scheduled delivery, and Razorpay payments.

---

## Features

- Mood-aware restaurant recommendations (mood + weather + time-of-day scoring)
- Group ordering via room codes with per-member item selection and split payments
- Food Passport — gamified cuisine exploration with milestone discount coupons
- Scheduled delivery up to 2 days ahead with cron-based auto-dispatch
- Reorder window — append items to a placed order within 10 minutes
- Dietary annotation engine flagging allergens and preference conflicts per menu item
- Razorpay integration with HMAC-SHA256 signature verification
- Admin dashboard — order management, delivery partner assignment, revenue stats
- Neighbourhood trending cache refreshed every 15 minutes

---

## Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Backend    | Node.js, Express.js               |
| Database   | MongoDB (native driver)           |
| Frontend   | React.js, React Router, Axios     |
| Mobile     | Flutter (Dart), Provider          |
| Auth       | JWT + bcryptjs                    |
| Payments   | Razorpay                          |
| Scheduling | node-cron                         |

---

## Project Structure

```
tastytap/
├── server/     # Node.js + Express REST API
├── client/     # React.js web app
└── mobile/     # Flutter mobile app
```

## Getting Started

### Prerequisites
- Node.js 20+
- MongoDB (local or Atlas)
- Flutter SDK
- Razorpay account (test mode works)

### Backend
```bash
cd server
npm install
cp .env.example .env   # fill in your values
node server.js
```

### Frontend
```bash
cd client
npm install
npm start
```

### Mobile
```bash
cd mobile
flutter pub get
flutter run
```

---

## Screenshots

[drop 4-5 screenshots here]

---

## Database Design

11 MongoDB collections: `users`, `restaurants`, `menus`, `orders`, `orderitems`,
`deliveries`, `deliverypartners`, `payments`, `grouporders`, `coupons`, `trendingcache`

**Embedding vs. referencing trade-offs**

| Data | Strategy | Reason |
|---|---|---|
| Dietary prefs / allergens | Embedded in `users` | Always read with user, never queried independently |
| Food Passport progress | Embedded sub-doc in `users` | Atomic `$set` on every new cuisine explored |
| Order items | Separate `orderitems` collection | Needs independent inserts for the reorder-window feature |
| Group order members | Embedded `members[]` array | Entire group state always read together |
| Delivery info | Separate `deliveries` collection | Status updated independently; partner ID needed for separate writes |

**Key patterns implemented**

- **Aggregation pipeline** — 3-stage `$match → $group → $sort` pipeline for neighbourhood trending (equivalent to SQL `GROUP BY` with timestamp filter)
- **Materialised view via cron** — `trendingcache` dropped and rebuilt every 15 mins from a 2-hour orders aggregate; endpoint reads cache, falls back to live query on cold start
- **Atomic operators** — `$inc` for reorder totals, `$set/$unset` for partner availability, `$push/$pull` for group order membership — all single-write atomic mutations
- **Query-time annotation** — dietary filter engine computes `containsAllergen` and `matchesPreference` flags on read using a `PREFERENCE_BLOCKLIST` map, without mutating stored documents (equivalent to a SQL view with CASE expressions)
- **Application-level referential integrity** — MongoDB has no FK constraints; enforced in route handlers (restaurant existence check, coupon `used: false` guard, Razorpay HMAC-SHA256 recomputed before any DB write)
- **Order status state machine** — `Placed → Confirmed → Preparing → Out for Delivery → Delivered`, with alternate paths for scheduled and group orders; transitions enforced by admin route with side-effects (partner release, delivery time computation)
