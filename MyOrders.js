import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

const STATUS_COLORS = {
  "Placed":             "var(--info)",
  "Scheduled":          "var(--accent2)",
  "Confirmed":          "var(--accent)",
  "Preparing":          "var(--accent2)",
  "pending_additions":  "var(--success)",
  "Out for Delivery":   "var(--info)",
  "Delivered":          "var(--success)",
  "Cancelled":          "var(--danger)",
};

const DELIVERY_STEPS = [
  { key: "Placed",           label: "Order placed",       icon: "📋" },
  { key: "Confirmed",        label: "Order confirmed",     icon: "✅" },
  { key: "Preparing",        label: "Preparing food",      icon: "👨‍🍳" },
  { key: "Out for Delivery", label: "Out for delivery",    icon: "🚴" },
  { key: "Delivered",        label: "Delivered",           icon: "🎉" },
];

const STEP_INDEX = Object.fromEntries(DELIVERY_STEPS.map((s, i) => [s.key, i]));

// ── Delivery progress tracker ─────────────────────────────────────────────────
function DeliveryTracker({ order }) {
  // pending_additions is visually shown as "Placed" in the tracker
  const statusForTracker =
    order.order_status === "pending_additions" ? "Placed" : order.order_status;
  const currentIdx = STEP_INDEX[statusForTracker] ?? 0;

  return (
    <div style={{ margin: "14px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {DELIVERY_STEPS.map((step, i) => {
          const done   = i <= currentIdx;
          const active = i === currentIdx;
          return (
            <div
              key={step.key}
              style={{
                display: "flex",
                alignItems: "center",
                flex: i < DELIVERY_STEPS.length - 1 ? 1 : 0,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 48 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: done ? "var(--accent)" : "var(--bg3)",
                  border: `2px solid ${active ? "var(--accent)" : done ? "var(--accent)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, transition: "all 0.3s",
                  boxShadow: active ? "0 0 0 3px var(--accent-dim)" : "none",
                }}>
                  {step.icon}
                </div>
                <p style={{
                  fontSize: 9, color: done ? "var(--accent)" : "var(--text3)",
                  marginTop: 4, textAlign: "center", maxWidth: 52, lineHeight: 1.2,
                }}>
                  {step.label}
                </p>
              </div>
              {i < DELIVERY_STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, marginBottom: 20,
                  background: i < currentIdx ? "var(--accent)" : "var(--border)",
                  transition: "background 0.3s",
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Live countdown for the reorder window ─────────────────────────────────────
function ReorderCountdown({ expiresAt, onExpire }) {
  const calcRemaining = () => {
    const diff = new Date(expiresAt) - Date.now();
    return diff > 0 ? diff : 0;
  };

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    if (remaining <= 0) { onExpire(); return; }
    const id = setInterval(() => {
      const r = calcRemaining();
      setRemaining(r);
      if (r <= 0) { clearInterval(id); onExpire(); }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const urgent = remaining < 60000; // last minute → red pulse

  return (
    <span style={{
      fontWeight: 700,
      color: urgent ? "var(--danger)" : "var(--success)",
      fontFamily: "'Syne', sans-serif",
    }}>
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}

// ── Star rating picker ────────────────────────────────────────────────────────
function StarPicker({ value, onChange, label }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ marginBottom: 8 }}>
      {label && <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>{label}</p>}
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map(star => (
          <span
            key={star}
            style={{
              fontSize: 22, cursor: "pointer",
              color: star <= (hover || value) ? "#f5a623" : "var(--border)",
              transition: "color 0.1s",
            }}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(star)}
          >★</span>
        ))}
      </div>
    </div>
  );
}

// ── Rating modal ──────────────────────────────────────────────────────────────
function RatingModal({ order, onClose, onSubmit }) {
  const [deliveryRating,    setDeliveryRating]    = useState(0);
  const [restaurantRating,  setRestaurantRating]  = useState(0);
  const [itemRatings,       setItemRatings]        = useState({});
  const [comment,           setComment]            = useState("");
  const [submitting,        setSubmitting]         = useState(false);

  const handleSubmit = async () => {
    if (!deliveryRating)   return alert("Please rate the delivery.");
    if (!restaurantRating) return alert("Please rate the restaurant.");
    setSubmitting(true);
    await onSubmit({ deliveryRating, restaurantRating, itemRatings, comment });
    setSubmitting(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="tt-card" style={{ maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontSize: 17 }}>Rate your experience</h3>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>

        {order.restaurantName && (
          <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 16 }}>🍽️ {order.restaurantName}</p>
        )}

        <StarPicker value={deliveryRating}   onChange={setDeliveryRating}   label="DELIVERY RATING" />
        <StarPicker value={restaurantRating} onChange={setRestaurantRating} label="RESTAURANT / FOOD QUALITY" />

        {order.items?.length > 0 && (
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8 }}>RATE INDIVIDUAL ITEMS (optional)</p>
            {order.items.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>{item.item_name}</span>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <span
                      key={star}
                      style={{ fontSize: 16, cursor: "pointer", color: star <= (itemRatings[item.item_name] || 0) ? "#f5a623" : "var(--border)" }}
                      onClick={() => setItemRatings(p => ({ ...p, [item.item_name]: star }))}
                    >★</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>COMMENT (optional)</label>
          <textarea
            className="tt-input"
            rows={3}
            style={{ resize: "vertical" }}
            placeholder="How was your experience?"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        </div>

        <button className="btn-primary" style={{ width: "100%", padding: "12px" }}
          disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Submitting..." : "Submit rating"}
        </button>
      </div>
    </div>
  );
}

// ── Delivery info banner ──────────────────────────────────────────────────────
// Shows immediately after order placement using either fetched data or the
// delivery object returned directly in the place-order API response.
function DeliveryBanner({ delivery, orderStatus }) {
  if (!delivery) return null;

  const isAssigned = delivery.delivery_person && delivery.delivery_person !== "TBD";
  const isDelivered = orderStatus === "Delivered";

  if (isDelivered) return null; // don't show once delivered

  return (
    <div style={{
      background: isAssigned ? "rgba(116,148,140,0.12)" : "var(--bg3)",
      border: `1px solid ${isAssigned ? "var(--success)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      padding: "10px 14px",
      fontSize: 13,
      marginBottom: 12,
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
    }}>
      {isAssigned ? (
        <>
          {/* Partner name — visible as soon as order is placed */}
          <span style={{ fontSize: 18 }}>🚴</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, color: "var(--success)", marginBottom: 2 }}>
              {delivery.delivery_person}
            </p>
            <p style={{ color: "var(--text2)", fontSize: 12 }}>
              Your delivery partner · ETA {delivery.estimated_time || "~30 mins"}
              {delivery.delivery_status && (
                <span style={{ marginLeft: 8, color: "var(--text3)" }}>
                  · {delivery.delivery_status}
                </span>
              )}
            </p>
          </div>
          {delivery.area_matched === false && (
            <span className="badge badge-gray" style={{ fontSize: 10 }}>
              Area: best available
            </span>
          )}
        </>
      ) : (
        <span style={{ color: "var(--text3)" }}>
          ⏳ Finding a delivery partner for you...
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function MyOrders() {
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [ratingOrder, setRatingOrder] = useState(null);
  const token = localStorage.getItem("token");

  // Track which orders have had their window expire locally
  // so we don't wait for the next server fetch to update the UI
  const [expiredWindows, setExpiredWindows] = useState(new Set());

  const showToast = (message, type = "default") => setToast({ message, type });

  const fetchOrders = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/orders/myorders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOrders(res.data);
    } catch {
      showToast("Failed to fetch orders", "error");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Auto-refresh every 8 seconds while any order is still active
  // (catches delivery partner assignment if the first fetch was instant)
  useEffect(() => {
    const interval = setInterval(() => {
      const hasActive = orders.some(
        o => !["Delivered", "Cancelled"].includes(o.order_status)
      );
      if (hasActive) fetchOrders();
    }, 8000);
    return () => clearInterval(interval);
  }, [orders, fetchOrders]);

  // ── Reorder window: open manually (e.g. for Delivered orders) ───────────────
  const openReorderWindow = async (orderId) => {
    try {
      const res = await axios.put(
        `${API}/api/orders/open-reorder-window/${orderId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showToast("Reorder window open for 10 minutes! Add items now.", "success");
      // Remove from local expired set in case it was there
      setExpiredWindows(prev => { const s = new Set(prev); s.delete(orderId.toString()); return s; });
      fetchOrders();
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to open window", "error");
    }
  };

  // ── Rating submission ────────────────────────────────────────────────────────
  const submitRating = async ({ deliveryRating, restaurantRating, itemRatings, comment }) => {
    try {
      await axios.post(
        `${API}/api/orders/rate/${ratingOrder._id}`,
        { deliveryRating, restaurantRating, itemRatings, comment },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showToast("Thanks for your rating! 🎉", "success");
      setRatingOrder(null);
      fetchOrders();
    } catch (err) {
      showToast(err.response?.data?.message || "Rating submission failed", "error");
    }
  };

  const statusColor  = (s) => STATUS_COLORS[s] || "var(--text2)";
  const canRate      = (order) => order.order_status === "Delivered" && !order.rated;

  // Show reorder button only on Delivered orders where the window is not already open
  const canOpenReorder = (order) =>
    order.order_status === "Delivered" &&
    (!order.reorderWindowExpiresAt ||
      new Date(order.reorderWindowExpiresAt) < Date.now() ||
      expiredWindows.has(order._id.toString()));

  // Check if this order still has an active reorder window
  const hasActiveWindow = (order) =>
    order.order_status === "pending_additions" &&
    order.reorderWindowExpiresAt &&
    new Date(order.reorderWindowExpiresAt) > Date.now() &&
    !expiredWindows.has(order._id.toString());

  if (loading) return <><Navbar /><div className="spinner" /></>;

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 700 }}>
        <h2 className="section-title" style={{ marginBottom: 24 }}>My Orders</h2>

        {orders.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📦</div>
            <p>No orders yet. Go explore some restaurants!</p>
          </div>
        ) : (
          orders.map(order => (
            <div key={order._id} className="tt-card" style={{ marginBottom: 16 }}>

              {/* ── Order header ── */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  {order.restaurantName && (
                    <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 4 }}>
                      🍽️ {order.restaurantName}
                      {order.restaurantRating > 0 && (
                        <span style={{ fontSize: 12, color: "#f5a623", marginLeft: 8 }}>
                          ★ {order.restaurantRating.toFixed(1)}
                        </span>
                      )}
                    </p>
                  )}
                  <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                    {new Date(order.createdAt).toLocaleString()}
                    {order.orderType === "scheduled" && (
                      <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                        🗓 Scheduled: {new Date(order.scheduledFor).toLocaleString()}
                      </span>
                    )}
                    {order.orderType === "group" && (
                      <span className="badge badge-info" style={{ marginLeft: 8 }}>👥 Group</span>
                    )}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text2)" }}>📍 {order.delivery_address}</p>
                </div>

                <div style={{ textAlign: "right" }}>
                  <p style={{ fontWeight: 700, fontSize: 17, color: "var(--accent)" }}>
                    ₹{order.total_amount}
                  </p>
                  {order.discount_amount > 0 && (
                    <p style={{ fontSize: 11, color: "var(--success)", marginTop: 2 }}>
                      −₹{order.discount_amount} saved
                      {order.coupon_used && ` (${order.coupon_used})`}
                    </p>
                  )}
                  <span style={{ fontSize: 12, color: statusColor(order.order_status), fontWeight: 600 }}>
                    ●{" "}
                    {order.order_status === "pending_additions"
                      ? "Reorder window open"
                      : order.order_status}
                  </span>
                </div>
              </div>

              {/* ── Delivery tracker ── */}
              {order.orderType !== "scheduled" && order.order_status !== "Cancelled" && (
                <DeliveryTracker order={order} />
              )}

              {/* ── Order items ── */}
              {order.items?.length > 0 && (
                <div style={{ margin: "12px 0" }}>
                  {order.items.map((item, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      fontSize: 13, color: "var(--text2)", marginBottom: 4,
                    }}>
                      <span>
                        {item.item_name} × {item.quantity}
                        {order.itemRatings?.[item.item_name] && (
                          <span style={{ color: "#f5a623", marginLeft: 6, fontSize: 11 }}>
                            ★ {order.itemRatings[item.item_name]}
                          </span>
                        )}
                      </span>
                      <span>₹{item.subtotal}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Delivery partner banner ── */}
              <DeliveryBanner delivery={order.delivery} orderStatus={order.order_status} />

              {/* ── Reorder window countdown ── */}
              {hasActiveWindow(order) && (
                <div style={{
                  background: "rgba(62,207,142,0.08)",
                  border: "1px solid var(--success)",
                  borderRadius: "var(--radius)",
                  padding: "12px 16px",
                  marginBottom: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <p style={{ color: "var(--success)", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                        ✅ Reorder window is open!
                      </p>
                      <p style={{ color: "var(--text2)", fontSize: 13 }}>
                        Closes in{" "}
                        <ReorderCountdown
                          expiresAt={order.reorderWindowExpiresAt}
                          onExpire={() => {
                            setExpiredWindows(prev => new Set([...prev, order._id.toString()]));
                            fetchOrders();
                          }}
                        />
                        {" "}— go to a restaurant to add more items
                      </p>
                    </div>
                    <span className="badge badge-success" style={{ fontSize: 11 }}>
                      Expires {new Date(order.reorderWindowExpiresAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Action buttons ── */}
              {(canRate(order) || canOpenReorder(order)) && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                  {canRate(order) && (
                    <button className="btn-primary" style={{ fontSize: 13, padding: "8px 18px" }}
                      onClick={() => setRatingOrder(order)}>
                      ⭐ Rate this order
                    </button>
                  )}
                  {order.rated && (
                    <span style={{ fontSize: 12, color: "var(--success)", padding: "8px 0" }}>
                      ✓ Rated · Delivery {order.deliveryRating}★ · Restaurant {order.restaurantRating}★
                    </span>
                  )}
                  {canOpenReorder(order) && (
                    <button className="btn-ghost" style={{ fontSize: 13 }}
                      onClick={() => openReorderWindow(order._id)}>
                      + Add more items (10 min window)
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {ratingOrder && (
        <RatingModal
          order={ratingOrder}
          onClose={() => setRatingOrder(null)}
          onSubmit={submitRating}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default MyOrders;