import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";
const STORAGE_KEY = "tastytap_group_room";

// ── Razorpay loader ──
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

function GroupOrder() {
  const [view, setView] = useState("home"); // home | create | join | room
  const [restaurants, setRestaurants] = useState([]);
  const [room, setRoom] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [myUserId, setMyUserId] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [address, setAddress] = useState("");
  const [toast, setToast] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [savedRoom, setSavedRoom] = useState(null); // persisted room from localStorage
  const [createForm, setCreateForm] = useState({
    restaurant_id: "", paymentMode: "split", budgetPerPerson: "", deadline: ""
  });
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const showToast = (msg, type = "default") => setToast({ message: msg, type });

  // ── On mount: load saved room + decode userId ──
  useEffect(() => {
    axios.get(`${API}/api/restaurants`).then(r => setRestaurants(r.data)).catch(() => {});
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      setMyUserId(payload.id);
    } catch {}
    // restore saved room from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedRoom(JSON.parse(stored));
    } catch {}
  }, [token]);

  const persistRoom = (code, restaurantId) => {
    const data = { roomCode: code, restaurantId, joinedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setSavedRoom(data);
  };

  const clearPersistedRoom = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSavedRoom(null);
  };

  const fetchRoom = useCallback(async (code) => {
    try {
      const res = await axios.get(`${API}/api/grouporders/room/${code}`, { headers });
      setRoom(res.data);
      // auto-clear if room is placed/closed
      if (res.data.status !== "open") clearPersistedRoom();
    } catch { showToast("Failed to fetch room", "error"); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (roomCode) {
      fetchRoom(roomCode);
      const interval = setInterval(() => fetchRoom(roomCode), 5000);
      return () => clearInterval(interval);
    }
  }, [roomCode, fetchRoom]);

  // ── Load menu when room is available ──
  useEffect(() => {
    if (room && room.restaurant_id && menu.length === 0) {
      axios.get(`${API}/api/menu/${room.restaurant_id}`, { headers })
        .then(r => setMenu(r.data)).catch(() => {});
    }
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rejoin a saved room ──
  const rejoinSavedRoom = async () => {
    if (!savedRoom) return;
    try {
      // Try to load the room — user may already be a member
      const res = await axios.get(`${API}/api/grouporders/room/${savedRoom.roomCode}`, { headers });
      if (res.data.status !== "open") {
        clearPersistedRoom();
        showToast("That room has already been placed or closed.", "error");
        return;
      }
      setRoomCode(savedRoom.roomCode);
      setRoom(res.data);
      setView("room");
    } catch {
      clearPersistedRoom();
      showToast("Could not find the saved room. It may have expired.", "error");
    }
  };

  const createRoom = async () => {
    if (!createForm.restaurant_id || !createForm.paymentMode)
      return showToast("Select a restaurant and payment mode", "error");
    try {
      const body = { ...createForm };
      if (!body.budgetPerPerson) delete body.budgetPerPerson;
      if (!body.deadline) delete body.deadline;
      const res = await axios.post(`${API}/api/grouporders/create`, body, { headers });
      const code = res.data.roomCode;
      setRoomCode(code);
      persistRoom(code, createForm.restaurant_id);
      const menuRes = await axios.get(`${API}/api/menu/${createForm.restaurant_id}`, { headers });
      setMenu(menuRes.data);
      setView("room");
      showToast(`Room created! Code: ${code}`, "success");
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to create room", "error");
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return showToast("Enter a room code", "error");
    const code = joinCode.toUpperCase().trim();
    try {
      // Try to join — backend returns 400 if already a member, that's OK
      await axios.post(`${API}/api/grouporders/join/${code}`, {}, { headers }).catch((err) => {
        // "already in room" is fine — just proceed
        if (!err.response?.data?.message?.includes("already")) throw err;
      });
      setRoomCode(code);
      await fetchRoom(code);
      persistRoom(code, null);
      setView("room");
      showToast("Joined room!", "success");
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to join", "error");
    }
  };

  const addToCart = (item) => {
    setCart(prev => {
      const ex = prev.find(c => c.menu_id === item._id);
      if (ex) return prev.map(c => c.menu_id === item._id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menu_id: item._id, name: item.item_name, price: item.price, quantity: 1 }];
    });
  };

  const cartQty = (id) => cart.find(c => c.menu_id === id)?.quantity || 0;
  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  const submitItems = async () => {
    if (!cart.length) return showToast("Add items first", "error");
    try {
      await axios.post(`${API}/api/grouporders/add-items/${roomCode}`, { items: cart }, { headers });
      showToast("Items saved!", "success");
      fetchRoom(roomCode);
    } catch (err) {
      showToast(err.response?.data?.message || "Failed", "error");
    }
  };

  const kickMember = async (userId) => {
    try {
      await axios.put(`${API}/api/grouporders/kick/${roomCode}/${userId}`, {}, { headers });
      showToast("Member removed", "success");
      fetchRoom(roomCode);
    } catch (err) { showToast(err.response?.data?.message || "Failed", "error"); }
  };

  // ── Razorpay checkout for group order ──
  const initiateGroupCheckout = async () => {
    if (!address.trim()) return showToast("Enter delivery address", "error");
    const groupTotal = room.members?.reduce((s, m) => s + m.subtotal, 0) || 0;
    if (!groupTotal) return showToast("No items in the group order yet", "error");

    const loaded = await loadRazorpay();
    if (!loaded) return showToast("Payment gateway failed to load", "error");

    setPaymentLoading(true);
    try {
      const orderRes = await axios.post(
        `${API}/api/payments/create-razorpay-order`,
        { amount: groupTotal },
        { headers }
      );
      const { razorpayOrderId, amount, currency, keyId } = orderRes.data;

      let userName = "";
      try { userName = JSON.parse(atob(token.split(".")[1])).name || ""; } catch {}

      const options = {
        key: keyId,
        amount,
        currency,
        name: "TastyTap",
        description: `Group Order — Room ${roomCode}`,
        order_id: razorpayOrderId,
        prefill: { name: userName },
        theme: { color: "#ff6b35" },
        handler: async (response) => {
          try {
            const res = await axios.post(
              `${API}/api/grouporders/checkout/${roomCode}`,
              {
                delivery_address: address,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              },
              { headers }
            );
            showToast("Group order placed! 🎉", "success");
            clearPersistedRoom();
            setView("home"); setRoom(null); setRoomCode(""); setCart([]);
          } catch (err) {
            showToast(err.response?.data?.message || "Checkout failed after payment", "error");
          }
        },
        modal: {
          ondismiss: () => {
            setPaymentLoading(false);
            showToast("Payment cancelled", "default");
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (r) => {
        showToast(`Payment failed: ${r.error.description}`, "error");
        setPaymentLoading(false);
      });
      rzp.open();
    } catch (err) {
      showToast(err.response?.data?.message || "Could not initiate payment", "error");
      setPaymentLoading(false);
    }
  };

  const leaveRoom = () => {
    clearPersistedRoom();
    setView("home"); setRoom(null); setRoomCode(""); setCart([]); setMenu([]);
  };

  const isHost = room && myUserId && room.hostUserId?.toString() === myUserId;

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 800 }}>
        {view === "home" && (
          <>
            <h2 className="section-title" style={{ marginBottom: 8 }}>👥 Group Order</h2>
            <p style={{ color: "var(--text2)", marginBottom: 24 }}>
              Order together — everyone picks their own items, one delivery.
            </p>

            {/* ── Rejoin banner ── */}
            {savedRoom && (
              <div style={{
                background: "var(--accent-dim)", border: "1px solid var(--accent)",
                borderRadius: "var(--radius)", padding: "16px 20px", marginBottom: 24,
                display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12
              }}>
                <div>
                  <p style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
                    🔗 You have an active room
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text2)" }}>
                    Room code: <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.1em" }}>{savedRoom.roomCode}</span>
                  </p>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn-primary" style={{ padding: "8px 20px" }} onClick={rejoinSavedRoom}>
                    Rejoin Room →
                  </button>
                  <button className="btn-ghost" style={{ padding: "8px 14px", fontSize: 13 }} onClick={clearPersistedRoom}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="tt-card" style={{ textAlign: "center", cursor: "pointer", padding: 32 }}
                onClick={() => setView("create")}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🏠</div>
                <h3 style={{ marginBottom: 8 }}>Create a room</h3>
                <p style={{ color: "var(--text2)", fontSize: 13 }}>Start a group order and invite friends</p>
              </div>
              <div className="tt-card" style={{ textAlign: "center", cursor: "pointer", padding: 32 }}
                onClick={() => setView("join")}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
                <h3 style={{ marginBottom: 8 }}>Join a room</h3>
                <p style={{ color: "var(--text2)", fontSize: 13 }}>Got a room code? Enter it here</p>
              </div>
            </div>

            {/* ── Demo tip ── */}
            <div style={{
              marginTop: 24, background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "14px 18px"
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💡 Demo tip — run two logins simultaneously</p>
              <p style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                Open a <strong>normal browser window</strong> (User A) and an <strong>Incognito/Private window</strong> (User B).
                Log in with different accounts in each. User A creates a room, shares the code, User B joins via the join form.
                Both windows will see the group room live — no extra setup needed.
              </p>
            </div>
          </>
        )}

        {view === "create" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
              <button className="btn-ghost" onClick={() => setView("home")}>← Back</button>
              <h2 style={{ fontSize: 22 }}>Create a room</h2>
            </div>
            <div className="tt-card" style={{ maxWidth: 480 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>RESTAURANT</label>
                <select className="tt-select"
                  value={createForm.restaurant_id}
                  onChange={e => setCreateForm({ ...createForm, restaurant_id: e.target.value })}>
                  <option value="">Select a restaurant</option>
                  {restaurants.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>PAYMENT MODE</label>
                <select className="tt-select"
                  value={createForm.paymentMode}
                  onChange={e => setCreateForm({ ...createForm, paymentMode: e.target.value })}>
                  <option value="split">Split — everyone pays their own</option>
                  <option value="host_pays">Host pays for everyone</option>
                </select>
              </div>
              {createForm.paymentMode === "host_pays" && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>BUDGET CAP PER PERSON (optional, ₹)</label>
                  <input className="tt-input" type="number" placeholder="e.g. 300"
                    value={createForm.budgetPerPerson}
                    onChange={e => setCreateForm({ ...createForm, budgetPerPerson: e.target.value })} />
                </div>
              )}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>ORDERING DEADLINE (optional)</label>
                <input className="tt-input" type="datetime-local"
                  value={createForm.deadline}
                  onChange={e => setCreateForm({ ...createForm, deadline: e.target.value })} />
              </div>
              <button className="btn-primary" style={{ width: "100%", padding: 12 }} onClick={createRoom}>
                Create Room →
              </button>
            </div>
          </>
        )}

        {view === "join" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
              <button className="btn-ghost" onClick={() => setView("home")}>← Back</button>
              <h2 style={{ fontSize: 22 }}>Join a room</h2>
            </div>
            <div className="tt-card" style={{ maxWidth: 380 }}>
              <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 6 }}>ROOM CODE</label>
              <input className="tt-input" placeholder="e.g. A3B9XZ"
                value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                style={{ marginBottom: 16, letterSpacing: "0.1em", fontWeight: 600 }} />
              <button className="btn-primary" style={{ width: "100%", padding: 12 }} onClick={joinRoom}>
                Join Room →
              </button>
              <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, textAlign: "center" }}>
                Already in the room? Entering the code again will take you back in.
              </p>
            </div>
          </>
        )}

        {view === "room" && room && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
                <button className="btn-ghost" onClick={leaveRoom}>← Leave room</button>
                <h2 style={{ fontSize: 20 }}>Room</h2>
                <div style={{
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "4px 14px", fontFamily: "'Syne', sans-serif",
                  fontWeight: 700, fontSize: 16, letterSpacing: "0.1em", color: "var(--accent)"
                }}>{roomCode}</div>
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text3)", padding: 0 }}
                  onClick={() => { navigator.clipboard.writeText(roomCode); showToast("Code copied!", "success"); }}>
                  📋 Copy code
                </button>
                {isHost && <span className="badge badge-accent">You are host</span>}
                {room.status !== "open" && (
                  <span className="badge badge-danger">Room closed</span>
                )}
              </div>

              {/* Members */}
              <div className="tt-card" style={{ marginBottom: 20 }}>
                <h4 style={{ marginBottom: 14, fontSize: 14, color: "var(--text2)" }}>MEMBERS ({room.members?.length})</h4>
                {room.members?.map(m => (
                  <div key={m.userId} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 0", borderBottom: "1px solid var(--border)"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span>{m.isHost ? "👑" : "👤"}</span>
                      <span style={{ fontSize: 14 }}>{m.name}</span>
                      {m.hasAddedItems
                        ? <span className="badge badge-success">Added items</span>
                        : <span className="badge badge-gray">Waiting...</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ color: "var(--accent)", fontSize: 14 }}>₹{m.subtotal}</span>
                      {isHost && !m.isHost && (
                        <button className="btn-danger" style={{ padding: "3px 10px", fontSize: 12 }}
                          onClick={() => kickMember(m.userId)}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Menu */}
              {room.status === "open" && (
                <>
                  <h4 style={{ marginBottom: 14, color: "var(--text2)", fontSize: 14 }}>MENU — ADD YOUR ITEMS</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {menu.map(item => (
                      <div key={item._id} className="tt-card" style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center"
                      }}>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: 14 }}>{item.item_name}</p>
                          <p style={{ color: "var(--accent)", fontSize: 13 }}>₹{item.price}</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {cartQty(item._id) > 0 ? (
                            <>
                              <button className="btn-ghost" style={{ padding: "4px 10px" }}
                                onClick={() => setCart(prev => {
                                  const ex = prev.find(c => c.menu_id === item._id);
                                  if (ex?.quantity === 1) return prev.filter(c => c.menu_id !== item._id);
                                  return prev.map(c => c.menu_id === item._id ? { ...c, quantity: c.quantity - 1 } : c);
                                })}>−</button>
                              <span style={{ fontWeight: 600 }}>{cartQty(item._id)}</span>
                              <button className="btn-primary" style={{ padding: "4px 10px" }} onClick={() => addToCart(item)}>+</button>
                            </>
                          ) : (
                            <button className="btn-primary" style={{ padding: "6px 14px" }} onClick={() => addToCart(item)}>Add</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="btn-primary" style={{ marginTop: 16, padding: "10px 24px" }} onClick={submitItems}>
                    Save my items ✓
                  </button>
                </>
              )}
            </div>

            {/* Sidebar */}
            <div style={{ position: "sticky", top: 74 }}>
              <div className="tt-card">
                <h4 style={{ marginBottom: 14, fontSize: 15 }}>My cart</h4>
                {cart.length === 0 ? (
                  <p style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>No items yet</p>
                ) : (
                  <>
                    {cart.map(item => (
                      <div key={item.menu_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                        <span>{item.name} × {item.quantity}</span>
                        <span style={{ color: "var(--accent)" }}>₹{item.price * item.quantity}</span>
                      </div>
                    ))}
                    <hr className="divider" />
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 4 }}>
                      <span>My total</span>
                      <span style={{ color: "var(--accent)" }}>₹{cartTotal}</span>
                    </div>
                    {room.budgetPerPerson && (
                      <p style={{ fontSize: 12, color: cartTotal > room.budgetPerPerson ? "var(--danger)" : "var(--text3)" }}>
                        Budget cap: ₹{room.budgetPerPerson}
                      </p>
                    )}
                  </>
                )}

                {isHost && room.status === "open" && (
                  <div style={{ marginTop: 20 }}>
                    <hr className="divider" />
                    <h4 style={{ marginBottom: 12, fontSize: 14 }}>Checkout (host only)</h4>
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>
                        Group total: ₹{room.members?.reduce((s, m) => s + m.subtotal, 0)}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text2)" }}>
                        Payment: {room.paymentMode === "host_pays" ? "Host pays" : "Split"}
                      </p>
                    </div>
                    <input className="tt-input" placeholder="Delivery address"
                      value={address} onChange={e => setAddress(e.target.value)}
                      style={{ marginBottom: 12 }} />
                    <button className="btn-primary" style={{ width: "100%", padding: 11 }}
                      disabled={paymentLoading}
                      onClick={initiateGroupCheckout}>
                      {paymentLoading ? "Processing..." : "Pay with Razorpay →"}
                    </button>
                    <p style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 6 }}>
                      🔒 Secure payment via Razorpay
                    </p>
                  </div>
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

export default GroupOrder;