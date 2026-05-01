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
