import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

const STATUS_OPTIONS = ["Placed", "Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];

function AdminOrders() {
  const [tab, setTab] = useState("orders");
  const [orders, setOrders] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [stats, setStats] = useState({ totalUsers: 0, totalOrders: 0, totalRevenue: 0 });
  const [toast, setToast] = useState(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const showToast = (msg, type) => setToast({ message: msg, type });

  const fetchAll = useCallback(async () => {
    try {
      const [s, o, sc] = await Promise.all([
        axios.get(`${API}/api/admin/stats`, { headers }),
        axios.get(`${API}/api/admin/orders`, { headers }),
        axios.get(`${API}/api/admin/scheduled-orders`, { headers }),
      ]);
      setStats(s.data);
      setOrders(o.data);
      setScheduled(sc.data);
    } catch { showToast("Failed to load data", "error"); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateStatus = async (orderId, status) => {
    try {
      await axios.put(`${API}/api/admin/orders/status/${orderId}`, { status }, { headers });
      showToast("Status updated", "success");
      fetchAll();
    } catch { showToast("Update failed", "error"); }
  };

  const StatCard = ({ label, value, color }) => (
    <div className="tt-card" style={{ flex: 1, textAlign: "center" }}>
      <p style={{ color: "var(--text2)", fontSize: 12, marginBottom: 8, fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, color: color || "var(--text)" }}>{value}</p>
    </div>
  );

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      background: tab === id ? "var(--accent)" : "transparent",
      color: tab === id ? "#fff" : "var(--text2)",
      border: "1px solid " + (tab === id ? "var(--accent)" : "var(--border)"),
      borderRadius: "var(--radius)", padding: "8px 18px",
      fontSize: 13, fontFamily: "'Syne', sans-serif",
      fontWeight: 600, cursor: "pointer", transition: "all 0.15s"
    }}>{label}</button>
  );

  const statusColor = (s) => {
    const m = {
      "Placed": "var(--info)", "Confirmed": "var(--accent)",
      "Preparing": "var(--accent2)", "Out for Delivery": "var(--info)",
      "Delivered": "var(--success)", "Cancelled": "var(--danger)"
    };
    return m[s] || "var(--text2)";
  };

  return (
    <>
      <Navbar />
      <div className="page">
        <h2 className="section-title" style={{ marginBottom: 24 }}>Admin Dashboard</h2>

        {/* Stats */}
        <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
          <StatCard label="TOTAL USERS" value={stats.totalUsers} />
          <StatCard label="TOTAL ORDERS" value={stats.totalOrders} />
          <StatCard label="TOTAL REVENUE" value={`₹${stats.totalRevenue.toLocaleString()}`} color="var(--accent)" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <TabBtn id="orders" label="All Orders" />
          <TabBtn id="scheduled" label={`Scheduled (${scheduled.length})`} />
        </div>

        {/* ── All Orders ── */}
        {tab === "orders" && (
          <div>
            {orders.length === 0 ? (
              <div className="empty-state"><div className="icon">📋</div><p>No orders yet</p></div>
            ) : orders.map(order => (
              <div key={order._id} className="tt-card" style={{
                marginBottom: 12,
                borderLeft: `3px solid ${statusColor(order.order_status)}`
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    {order.restaurantName && (
                      <p style={{ fontWeight: 700, color: "var(--accent)", fontSize: 15, marginBottom: 4 }}>
                        🍽️ {order.restaurantName}
                      </p>
                    )}
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>
                      ₹{order.total_amount}
                      {order.discount_amount > 0 && (
                        <span style={{ fontSize: 12, color: "var(--success)", marginLeft: 8 }}>
                          (₹{order.discount_amount} off · {order.coupon_used})
                        </span>
                      )}
                    </p>
                    <p style={{ color: "var(--text2)", fontSize: 13 }}>📍 {order.delivery_address}</p>
                    <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 4 }}>
                      {new Date(order.createdAt).toLocaleString()}
                      {order.orderType === "group" && <span className="badge badge-info" style={{ marginLeft: 8 }}>Group</span>}
                      {order.orderType === "scheduled" && <span className="badge badge-accent" style={{ marginLeft: 8 }}>Scheduled</span>}
                      {order.payment_method === "Razorpay" && <span className="badge badge-success" style={{ marginLeft: 8 }}>Razorpay</span>}
                    </p>
                    {order.delivery && (
                      <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                        🚴 {order.delivery.delivery_person !== "TBD"
                          ? order.delivery.delivery_person
                          : "Partner not yet assigned"}
                        {" · "}
                        <span style={{ color: "var(--text3)" }}>{order.delivery.delivery_status}</span>
                      </p>
                    )}
                    {order.rated && (
                      <p style={{ fontSize: 12, color: "#f5a623", marginTop: 4 }}>
                        ★ Delivery {order.deliveryRating} · Restaurant {order.restaurantRating}
                        {order.ratingComment && <span style={{ color: "var(--text3)" }}> · "{order.ratingComment}"</span>}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                    <select className="tt-select" style={{ width: "auto" }}
                      value={order.order_status}
                      onChange={e => updateStatus(order._id, e.target.value)}>
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 12, color: statusColor(order.order_status), fontWeight: 600 }}>
                      ● {order.order_status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Scheduled Orders ── */}
        {tab === "scheduled" && (
          <div>
            {scheduled.length === 0 ? (
              <div className="empty-state"><div className="icon">🗓️</div><p>No scheduled orders</p></div>
            ) : scheduled.map(order => (
              <div key={order._id} className="tt-card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    {order.restaurantName && (
                      <p style={{ fontWeight: 600, color: "var(--accent)", fontSize: 14, marginBottom: 4 }}>🍽️ {order.restaurantName}</p>
                    )}
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>₹{order.total_amount}</p>
                    <p style={{ color: "var(--text2)", fontSize: 13 }}>📍 {order.delivery_address}</p>
                    <p style={{ color: "var(--accent2)", fontSize: 13, marginTop: 6 }}>
                      🕐 Scheduled for: {new Date(order.scheduledFor).toLocaleString()}
                    </p>
                  </div>
                  <span className="badge badge-accent">Scheduled</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default AdminOrders;