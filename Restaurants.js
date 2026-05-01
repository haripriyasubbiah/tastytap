import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (t) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const isOpenNow = (opening_time, closing_time) => {
  if (!opening_time || !closing_time) return null;
  const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
  const open = toMinutes(opening_time); const close = toMinutes(closing_time);
  if (close > open) return cur >= open && cur < close;
  return cur >= open || cur < close;
};

function HoursBadge({ opening_time, closing_time }) {
  if (!opening_time || !closing_time) return null;
  const open = isOpenNow(opening_time, closing_time);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text2)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: open ? "var(--success)" : "var(--danger)" }} />
      <span style={{ color: open ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{open ? "Open" : "Closed"}</span>
      <span>· {fmt(opening_time)} – {fmt(closing_time)}</span>
    </span>
  );
}

function StarBadge({ rating, count }) {
  if (!rating) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: "#f5a623", fontWeight: 600 }}>
      ★ {rating.toFixed(1)}
      {count > 0 && <span style={{ color: "var(--text3)", fontWeight: 400 }}>({count})</span>}
    </span>
  );
}

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [liveCounts, setLiveCounts] = useState({});
  const [filterDiet, setFilterDiet] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [address, setAddress] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuLoading, setMenuLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // ── Nearby feature ──────────────────────────────────────────────────────────
  // nearbyMode: toggle state
  // nearbyList: restaurants sorted by distance (from API)
  // nearbyLoading: spinner while fetching
  // userCoords: { lat, lng } resolved from browser geolocation
  // locationLabel: human-readable label shown in the UI
  const [nearbyMode, setNearbyMode] = useState(false);
  const [nearbyList, setNearbyList] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [userCoords, setUserCoords] = useState(null);
  const [locationLabel, setLocationLabel] = useState("");
  const coordsRef = useRef(null); // stable ref so fetchNearby doesn't stale-close

  // Coupon state
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);

  const token = localStorage.getItem("token");
  const showToast = (message, type = "default") => setToast({ message, type });

  // ── Fetch all restaurants (normal listing) ──────────────────────────────────
  const fetchRestaurants = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/restaurants`);
      setRestaurants(res.data);
      const counts = {};
      await Promise.all(res.data.map(async (r) => {
        try {
          const c = await axios.get(`${API}/api/orders/live-count/${r._id}`);
          counts[r._id] = c.data;
        } catch { counts[r._id] = { activeOrders: 0, busynessLabel: "normal" }; }
      }));
      setLiveCounts(counts);
    } catch { showToast("Failed to load restaurants", "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRestaurants(); }, [fetchRestaurants]);

  // ── Auto-open from sessionStorage (Recommendations → Restaurants deep-link) ─
  useEffect(() => {
    if (loading) return;
    const targetId = sessionStorage.getItem("openRestaurantId");
    if (!targetId) return;
    sessionStorage.removeItem("openRestaurantId");
    const match = restaurants.find(r => r._id === targetId || r._id?.toString() === targetId);
    if (match) openMenu(match);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch nearby restaurants from backend ───────────────────────────────────
  const fetchNearby = useCallback(async (lat, lng) => {
    setNearbyLoading(true);
    try {
      const res = await axios.get(`${API}/api/restaurants/nearby`, {
        params: { lat, lng, radiusKm: 25 },
      });

      // Backfill live counts for any restaurant not already cached
      const counts = { ...liveCounts };
      await Promise.all(
        res.data.map(async (r) => {
          if (counts[r._id]) return;
          try {
            const c = await axios.get(`${API}/api/orders/live-count/${r._id}`);
            counts[r._id] = c.data;
          } catch { counts[r._id] = { activeOrders: 0, busynessLabel: "normal" }; }
        })
      );
      setLiveCounts(counts);
      setNearbyList(res.data);
    } catch {
      showToast("Could not load nearby restaurants", "error");
      setNearbyMode(false);
    } finally {
      setNearbyLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle handler: asks for geolocation then fetches ──────────────────────
  const handleNearbyToggle = () => {
    const turningOn = !nearbyMode;
    setNearbyMode(turningOn);

    if (!turningOn) return; // toggled OFF — nothing more to do

    // If we already have coords from a previous toggle, reuse them
    if (coordsRef.current) {
      fetchNearby(coordsRef.current.lat, coordsRef.current.lng);
      return;
    }

    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser", "error");
      setNearbyMode(false);
      return;
    }

    setNearbyLoading(true); // show spinner while waiting for browser prompt

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        coordsRef.current = coords;
        setUserCoords(coords);
        setLocationLabel("your location");
        fetchNearby(coords.lat, coords.lng);
      },
      (err) => {
        // User denied or timed out
        setNearbyLoading(false);
        setNearbyMode(false);
        if (err.code === err.PERMISSION_DENIED) {
          showToast("Location permission denied. Please allow location access and try again.", "error");
        } else {
          showToast("Could not determine your location. Please try again.", "error");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // ── Which list to render ────────────────────────────────────────────────────
  const displayList = nearbyMode ? nearbyList : restaurants;

  // ── Open a restaurant's menu ────────────────────────────────────────────────
  const openMenu = async (restaurant) => {
    setSelected(restaurant);
    setCart([]);
    setAppliedCoupon(null);
    setCouponInput("");
    setMenuLoading(true);
    try {
      const res = await axios.get(`${API}/api/menu/${restaurant._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMenu(res.data);
    } catch { showToast("Failed to load menu", "error"); }
    finally { setMenuLoading(false); }
  };

  const toggleFilter = () => setFilterDiet(prev => !prev);

  const isBlocked = (item) => {
    if (!filterDiet) return false;
    if (item.containsAllergen === undefined && item.matchesPreference === undefined) return false;
    return item.containsAllergen === true || item.matchesPreference === false;
  };

  const addToCart = (item) => {
    if (isBlocked(item)) {
      showToast(
        item.containsAllergen
          ? "⚠️ Contains your allergens — filter is ON"
          : "⚠️ Doesn't match your dietary preferences — filter is ON",
        "error"
      );
      return;
    }
    setAppliedCoupon(null);
    setCart(prev => {
      const ex = prev.find(c => c.menu_id === item._id);
      if (ex) return prev.map(c => c.menu_id === item._id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menu_id: item._id, name: item.item_name, price: item.price, quantity: 1 }];
    });
  };

  const removeFromCart = (menuId) => {
    setAppliedCoupon(null);
    setCart(prev => {
      const ex = prev.find(c => c.menu_id === menuId);
      if (ex?.quantity === 1) return prev.filter(c => c.menu_id !== menuId);
      return prev.map(c => c.menu_id === menuId ? { ...c, quantity: c.quantity - 1 } : c);
    });
  };

  const cartQty = (menuId) => cart.find(c => c.menu_id === menuId)?.quantity || 0;
  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const finalTotal = appliedCoupon ? Math.max(0, cartTotal - appliedCoupon.discountAmount) : cartTotal;

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    if (!cart.length) return showToast("Add items to cart first", "error");
    setCouponLoading(true);
    try {
      const res = await axios.post(
        `${API}/api/passport/apply-coupon`,
        { code: couponInput.trim(), orderTotal: cartTotal },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAppliedCoupon({
        code: res.data.code,
        discountAmount: res.data.discountAmount,
        description: res.data.description
      });
      showToast(`Coupon applied! ${res.data.description}`, "success");
    } catch (err) {
      showToast(err.response?.data?.message || "Invalid coupon", "error");
    } finally { setCouponLoading(false); }
  };

  const removeCoupon = () => { setAppliedCoupon(null); setCouponInput(""); };

  const initiateRazorpayPayment = async () => {
    if (!cart.length) return showToast("Add items to cart first", "error");
    if (!address.trim()) return showToast("Please enter delivery address", "error");

    const loaded = await loadRazorpay();
    if (!loaded) return showToast("Payment gateway failed to load. Check internet.", "error");

    setPaymentLoading(true);
    try {
      const orderRes = await axios.post(
        `${API}/api/payments/create-razorpay-order`,
        { amount: finalTotal },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { razorpayOrderId, amount, currency, keyId } = orderRes.data;

      let userName = "", userEmail = "";
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        userName = payload.name || "";
        userEmail = payload.email || "";
      } catch {}

      const options = {
        key: keyId,
        amount,
        currency,
        name: "TastyTap",
        description: `Order from ${selected.name}`,
        order_id: razorpayOrderId,
        prefill: { name: userName, email: userEmail },
        theme: { color: "#E8621A" },
        handler: async (response) => {
          try {
            const result = await axios.post(
              `${API}/api/orders`,
              {
                restaurant_id: selected._id,
                total_amount: cartTotal,
                payment_method: "Razorpay",
                delivery_address: address,
                items: cart,
                scheduledFor: showSchedule && scheduledFor ? scheduledFor : undefined,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
                couponCode: appliedCoupon ? appliedCoupon.code : undefined
              },
              { headers: { Authorization: `Bearer ${token}` } }
            );

            // ── Build a rich success message using the response ──────────────
            const data = result.data;
            let msg = showSchedule ? "Order scheduled! 🗓️" : "Order placed! 🎉";

            // Show delivery partner name immediately if one was assigned
            if (!showSchedule && data.delivery) {
              if (data.delivery.delivery_person && data.delivery.delivery_person !== "TBD") {
                msg += ` ${data.delivery.delivery_person} is your delivery partner (ETA ${data.delivery.estimated_time}).`;
              } else {
                msg += " Finding a delivery partner for you...";
              }
            }

            // Show coupon savings
            if (data.discountApplied) {
              msg += ` ₹${data.discountApplied.saved} saved with coupon ${data.discountApplied.code}.`;
            }

            // Show reorder window notice
            if (data.reorderWindow) {
              msg += " Reorder window open for 10 minutes!";
            }

            showToast(msg, "success");

            // Reset cart state
            setCart([]); setAddress(""); setScheduledFor("");
            setShowSchedule(false); setAppliedCoupon(null); setCouponInput("");

            // Redirect to My Orders after a short delay so user can read the toast
            setTimeout(() => { window.location.href = "/myorders"; }, 2200);
          } catch (err) {
            showToast(err.response?.data?.message || "Order placement failed", "error");
          } finally { setPaymentLoading(false); }
        },
        modal: { ondismiss: () => setPaymentLoading(false) }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      showToast(err.response?.data?.message || "Payment initiation failed", "error");
      setPaymentLoading(false);
    }
  };

  const busynessText = (label, count) => {
    if (label === "very_busy") return `🔥 Very busy · ${count} active orders`;
    if (label === "busy") return `⚡ Busy · ${count} active orders`;
    return `✓ Accepting orders`;
  };

  if (loading) return <><Navbar /><div className="spinner" /></>;

  return (
    <>
      <Navbar />
      <div className="page">
        {!selected ? (
          <>
            {/* ── Header + Nearby toggle ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
              <h2 className="section-title" style={{ marginBottom: 0 }}>Restaurants</h2>

              {/* Nearby toggle pill */}
              <button
                onClick={handleNearbyToggle}
                disabled={nearbyLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderRadius: 24,
                  border: `1px solid ${nearbyMode ? "var(--accent)" : "var(--border)"}`,
                  background: nearbyMode ? "var(--accent-dim)" : "var(--bg3)",
                  color: nearbyMode ? "var(--accent)" : "var(--text2)",
                  cursor: nearbyLoading ? "wait" : "pointer",
                  fontSize: 13, fontWeight: 600,
                  transition: "all 0.2s",
                }}
              >
                {nearbyLoading ? (
                  <>
                    <span style={{ width: 14, height: 14, border: "2px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                    Locating...
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 16 }}>📍</span>
                    {nearbyMode ? `Nearby (${locationLabel})` : "Show nearby"}
                    {/* Toggle track */}
                    <span style={{
                      width: 28, height: 16, borderRadius: 8, position: "relative",
                      background: nearbyMode ? "var(--accent)" : "var(--bg)",
                      border: "1px solid var(--border)", flexShrink: 0,
                      transition: "background 0.2s",
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%", background: "#fff",
                        position: "absolute", top: 2,
                        left: nearbyMode ? 14 : 2, transition: "left 0.2s",
                      }} />
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* ── Nearby context bar ── */}
            {nearbyMode && !nearbyLoading && (
              <div style={{
                marginBottom: 16, padding: "10px 14px", borderRadius: "var(--radius)",
                background: "var(--accent-dim)", border: "1px solid var(--accent)",
                fontSize: 13, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>📍</span>
                <span>
                  Showing <strong>{nearbyList.length}</strong> restaurant{nearbyList.length !== 1 ? "s" : ""} within 25 km of {locationLabel}, sorted by distance
                </span>
              </div>
            )}

            {displayList.length === 0 && !nearbyLoading ? (
              <div className="empty-state">
                <div className="icon">🍽️</div>
                <p>{nearbyMode ? "No restaurants found within 25 km of your location" : "No restaurants yet"}</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {displayList.map(r => {
                  const lc = liveCounts[r._id] || { activeOrders: 0, busynessLabel: "normal" };
                  return (
                    <div key={r._id} className="tt-card" style={{ cursor: "pointer" }}
                      onClick={() => openMenu(r)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <h3 style={{ fontSize: 17, fontWeight: 700 }}>{r.name}</h3>
                        {r.cuisine && <span className="badge badge-accent">{r.cuisine}</span>}
                      </div>

                      {r.avgRating > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <StarBadge rating={r.avgRating} count={r.totalRatings} />
                        </div>
                      )}

                      {r.address && (
                        <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 8 }}>📍 {r.address}</p>
                      )}

                      {/* Distance badge — only shown in nearby mode */}
                      {nearbyMode && r.distanceKm !== undefined && (
                        <p style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, marginBottom: 6 }}>
                          🗺 {r.distanceKm} km away
                        </p>
                      )}

                      <HoursBadge opening_time={r.opening_time} closing_time={r.closing_time} />

                      <p style={{
                        fontSize: 12, marginTop: 10,
                        color: lc.busynessLabel === "very_busy" ? "var(--danger)"
                          : lc.busynessLabel === "busy" ? "var(--accent2)" : "var(--success)"
                      }}>
                        {busynessText(lc.busynessLabel, lc.activeOrders)}
                      </p>
                      {lc.busynessLabel === "very_busy" && (
                        <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                          Expect delays during peak hours
                        </p>
                      )}
                      <p style={{ fontSize: 12, color: "var(--accent)", marginTop: 10, fontWeight: 600 }}>
                        Tap to order →
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* ── Restaurant menu + cart view (unchanged) ── */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
            {/* ── Menu ── */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
                <button className="btn-ghost" onClick={() => setSelected(null)}>← Back</button>
                <h2 style={{ fontSize: 22 }}>{selected.name}</h2>
                {selected.cuisine && <span className="badge badge-accent">{selected.cuisine}</span>}
                <HoursBadge opening_time={selected.opening_time} closing_time={selected.closing_time} />
              </div>
              {selected.avgRating > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <StarBadge rating={selected.avgRating} count={selected.totalRatings} />
                  <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: 6 }}>restaurant rating</span>
                </div>
              )}

              {/* Dietary filter toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                  <div onClick={toggleFilter} style={{
                    width: 36, height: 20, borderRadius: 10,
                    background: filterDiet ? "var(--accent)" : "var(--bg3)",
                    border: "1px solid var(--border)", position: "relative",
                    transition: "background 0.2s", cursor: "pointer", flexShrink: 0
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%", background: "#fff",
                      position: "absolute", top: 2,
                      left: filterDiet ? 18 : 2, transition: "left 0.2s"
                    }} />
                  </div>
                  <span style={{ color: filterDiet ? "var(--accent)" : "var(--text2)" }}>
                    Dietary filter {filterDiet ? "ON" : "OFF"}
                  </span>
                </label>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {filterDiet
                    ? "🔒 Allergen / preference-conflicting items are locked"
                    : "All items shown · toggle ON to lock unsuitable items"}
                </span>
              </div>

              {menuLoading ? <div className="spinner" /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {menu.length === 0 && (
                    <div className="empty-state"><div className="icon">🥗</div><p>No menu items found</p></div>
                  )}
                  {menu.map(item => {
                    const blocked = isBlocked(item);
                    return (
                      <div key={item._id} className="tt-card" style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        opacity: blocked ? 0.55 : 1,
                        borderColor: item.containsAllergen ? "var(--danger)" : "var(--border)",
                        transition: "opacity 0.2s"
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{item.item_name}</span>
                            {item.containsAllergen && (
                              <span className="badge badge-danger" title="Contains your allergens">⚠ Allergen</span>
                            )}
                            {item.dietaryTags?.map(t => (
                              <span key={t} className="badge badge-success" style={{ fontSize: 10 }}>{t}</span>
                            ))}
                            {filterDiet && item.matchesPreference === false && !item.containsAllergen && (
                              <span className="badge badge-gray" style={{ fontSize: 10 }}>🔒 Not your preference</span>
                            )}
                          </div>
                          <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 4 }}>{item.description}</p>
                          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <span style={{ color: "var(--accent)", fontWeight: 600 }}>₹{item.price}</span>
                            {item.calories && <span style={{ color: "var(--text3)", fontSize: 12 }}>{item.calories} cal</span>}
                            {item.prepTimeMinutes && <span style={{ color: "var(--text3)", fontSize: 12 }}>⏱ {item.prepTimeMinutes} min</span>}
                            {item.avgRating > 0 && (
                              <span style={{ fontSize: 12, color: "#f5a623" }}>★ {item.avgRating.toFixed(1)}</span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 16 }}>
                          {cartQty(item._id) > 0 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <button className="btn-ghost" style={{ padding: "4px 10px" }}
                                onClick={() => removeFromCart(item._id)}>−</button>
                              <span style={{ fontWeight: 600, minWidth: 20, textAlign: "center" }}>{cartQty(item._id)}</span>
                              <button className="btn-primary" style={{ padding: "4px 10px" }}
                                disabled={blocked} onClick={() => addToCart(item)}>+</button>
                            </div>
                          ) : (
                            <button
                              className={blocked ? "btn-ghost" : "btn-primary"}
                              style={{ padding: "6px 16px", cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.5 : 1 }}
                              disabled={blocked}
                              title={blocked
                                ? item.containsAllergen
                                  ? "Contains your allergens (filter is ON)"
                                  : "Doesn't match your dietary preferences (filter is ON)"
                                : undefined}
                              onClick={() => addToCart(item)}>
                              {blocked ? "Locked 🔒" : "Add"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Cart ── */}
            <div style={{ position: "sticky", top: 74 }}>
              <div className="tt-card">
                <h3 style={{ marginBottom: 16, fontSize: 17 }}>🛒 Your cart</h3>
                {cart.length === 0 ? (
                  <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                    Add items to get started
                  </p>
                ) : (
                  <>
                    {cart.map(item => (
                      <div key={item.menu_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }}>
                        <span>{item.name} × {item.quantity}</span>
                        <span style={{ color: "var(--accent)" }}>₹{item.price * item.quantity}</span>
                      </div>
                    ))}
                    <hr className="divider" />

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, color: "var(--text2)" }}>
                      <span>Subtotal</span><span>₹{cartTotal}</span>
                    </div>

                    {/* Coupon */}
                    {!appliedCoupon ? (
                      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                        <input
                          className="tt-input"
                          placeholder="Coupon code"
                          value={couponInput}
                          onChange={e => setCouponInput(e.target.value.toUpperCase())}
                          style={{ flex: 1, fontSize: 13 }}
                          onKeyDown={e => e.key === "Enter" && applyCoupon()}
                        />
                        <button className="btn-ghost" style={{ fontSize: 12, padding: "0 12px", whiteSpace: "nowrap" }}
                          disabled={couponLoading} onClick={applyCoupon}>
                          {couponLoading ? "..." : "Apply"}
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        background: "rgba(62,207,142,0.1)", border: "1px solid var(--success)",
                        borderRadius: 8, padding: "8px 12px", marginBottom: 12
                      }}>
                        <div>
                          <p style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>🎟 {appliedCoupon.code}</p>
                          <p style={{ fontSize: 11, color: "var(--text2)" }}>{appliedCoupon.description}</p>
                        </div>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={removeCoupon}>✕</button>
                      </div>
                    )}

                    {appliedCoupon && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, color: "var(--success)" }}>
                        <span>Discount</span><span>−₹{appliedCoupon.discountAmount}</span>
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 16 }}>
                      <span>Total</span>
                      <span style={{ color: "var(--accent)" }}>₹{finalTotal}</span>
                    </div>

                    <input className="tt-input" placeholder="Delivery address"
                      value={address} onChange={e => setAddress(e.target.value)}
                      style={{ marginBottom: 12 }} />

                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer", fontSize: 13 }}>
                      <input type="checkbox" checked={showSchedule} onChange={e => setShowSchedule(e.target.checked)} />
                      <span style={{ color: "var(--text2)" }}>Schedule this order</span>
                    </label>
                    {showSchedule && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>
                          DELIVER AT (min 30 mins from now)
                        </label>
                        <input className="tt-input" type="datetime-local"
                          value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
                      </div>
                    )}

                    <button className="btn-primary" style={{ width: "100%", padding: "12px", fontSize: 15 }}
                      disabled={paymentLoading} onClick={initiateRazorpayPayment}>
                      {paymentLoading ? "Processing..." : showSchedule ? "Pay & Schedule 🗓️" : `Pay ₹${finalTotal} →`}
                    </button>
                    <p style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 8 }}>
                      🔒 Secure payment via Razorpay
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default Restaurants;