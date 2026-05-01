import { useState, useEffect } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

// Milestone definitions — what offer unlocks at each cuisine count
const MILESTONES = [
  { count: 3,  badge: "Explorer",         offer: "10% off your next order",    code: null, discount: null, type: "percent", value: 10 },
  { count: 6,  badge: "Foodie",           offer: "₹50 off on orders above ₹300", code: null, discount: null, type: "flat",    value: 50  },
  { count: 12, badge: "Passport Complete", offer: "₹100 off — any order!",       code: null, discount: null, type: "flat",    value: 100 },
];

function FoodPassport() {
  const [passport, setPassport] = useState(null);
  const [coupons, setCoupons] = useState([]);   // user's claimable coupons
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [copied, setCopied] = useState(null);
  const [toast, setToast] = useState(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const showToast = (msg, type = "default") => setToast({ message: msg, type });

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/passport`, { headers }),
      axios.get(`${API}/api/passport/my-coupons`, { headers })
    ])
      .then(([pRes, cRes]) => {
        setPassport(pRes.data);
        setCoupons(cRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const claimOffer = async (badge) => {
    setClaiming(badge);
    try {
      const res = await axios.post(`${API}/api/passport/claim-offer`, { badge }, { headers });
      setCoupons(prev => [...prev, res.data.coupon]);
      showToast(`🎉 Offer claimed! Code: ${res.data.coupon.code}`, "success");
    } catch (err) {
      showToast(err.response?.data?.message || "Could not claim offer", "error");
    } finally { setClaiming(null); }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  if (loading) return <><Navbar /><div className="spinner" /></>;
  if (!passport) return <><Navbar /><div className="empty-state"><p>Could not load passport.</p></div></>;

  const progress = (passport.totalExplored / passport.totalCuisines) * 100;

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 680 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>Food Passport</h2>
        <p style={{ color: "var(--text2)", marginBottom: 32, fontSize: 14 }}>
          Order from new cuisines to explore the map and unlock real discounts.
        </p>

        {/* ── Progress card ── */}
        <div className="tt-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 36, fontWeight: 700, lineHeight: 1 }}>
                {passport.totalExplored}
                <span style={{ fontSize: 18, color: "var(--text3)", fontWeight: 400 }}>/{passport.totalCuisines}</span>
              </p>
              <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 4 }}>cuisines explored</p>
            </div>
            {passport.nextBadge && (
              <div style={{ textAlign: "right" }}>
                <p className="form-label">Next milestone</p>
                <p style={{ fontWeight: 600, fontSize: 14 }}>{passport.nextBadge.badge}</p>
                <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{passport.progressToNextBadge} cuisines</p>
              </div>
            )}
          </div>
          <div style={{ height: 5, background: "var(--bg3)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${progress}%`,
              background: "linear-gradient(90deg, var(--accent), var(--accent2))",
              borderRadius: 3, transition: "width 0.6s ease"
            }} />
          </div>
        </div>

        {/* ── Milestone offers ── */}
        <div className="tt-card" style={{ marginBottom: 16 }}>
          <p className="form-label" style={{ marginBottom: 16 }}>Milestone offers</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {MILESTONES.map(m => {
              const unlocked = passport.totalExplored >= m.count;
              const alreadyClaimed = coupons.some(c => c.badge === m.badge && !c.used);
              const usedCoupon = coupons.find(c => c.badge === m.badge && c.used);
              const activeCoupon = coupons.find(c => c.badge === m.badge && !c.used);

              return (
                <div key={m.badge} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px", borderRadius: "var(--radius)",
                  background: unlocked ? "var(--accent-dim)" : "var(--bg3)",
                  border: `1px solid ${unlocked ? "var(--accent)" : "var(--border)"}`,
                  flexWrap: "wrap", gap: 12
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 22 }}>{usedCoupon ? "✅" : unlocked ? "🎁" : "🔒"}</span>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 14, color: unlocked ? "var(--accent)" : "var(--text3)", marginBottom: 2 }}>
                        {m.badge} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text3)" }}>· {m.count} cuisines</span>
                      </p>
                      <p style={{ fontSize: 13, color: unlocked ? "var(--text)" : "var(--text3)" }}>{m.offer}</p>
                      {usedCoupon && (
                        <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Used · {new Date(usedCoupon.usedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    {!unlocked && (
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>
                        {m.count - passport.totalExplored} more to unlock
                      </span>
                    )}
                    {unlocked && !alreadyClaimed && !usedCoupon && (
                      <button
                        className="btn-primary"
                        style={{ padding: "7px 18px", fontSize: 13 }}
                        disabled={claiming === m.badge}
                        onClick={() => claimOffer(m.badge)}>
                        {claiming === m.badge ? "Claiming..." : "Claim offer →"}
                      </button>
                    )}
                    {activeCoupon && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          background: "var(--bg)", border: "1px dashed var(--accent)",
                          borderRadius: 8, padding: "6px 14px",
                          fontFamily: "'Syne', sans-serif", fontWeight: 700,
                          fontSize: 16, letterSpacing: "0.12em", color: "var(--accent)"
                        }}>
                          {activeCoupon.code}
                        </div>
                        <button
                          className="btn-ghost"
                          style={{ padding: "6px 12px", fontSize: 12 }}
                          onClick={() => copyCode(activeCoupon.code)}>
                          {copied === activeCoupon.code ? "Copied ✓" : "Copy"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 14 }}>
            💡 Enter your coupon code at checkout to apply the discount automatically.
          </p>
        </div>

        {/* ── Active coupons wallet ── */}
        {coupons.filter(c => !c.used).length > 0 && (
          <div className="tt-card" style={{ marginBottom: 16, borderColor: "var(--success)" }}>
            <p style={{ fontWeight: 600, color: "var(--success)", marginBottom: 12 }}>🎟 Your active coupons</p>
            {coupons.filter(c => !c.used).map(c => (
              <div key={c.code} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px", background: "var(--bg3)", borderRadius: "var(--radius)",
                marginBottom: 8, flexWrap: "wrap", gap: 8
              }}>
                <div>
                  <p style={{
                    fontFamily: "'Syne', sans-serif", fontWeight: 700,
                    fontSize: 18, letterSpacing: "0.1em", color: "var(--success)"
                  }}>{c.code}</p>
                  <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                    {c.type === "percent" ? `${c.discount}% off` : `₹${c.discount} off`}
                    {c.minOrder ? ` · Min order ₹${c.minOrder}` : " · Any order"}
                  </p>
                </div>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, padding: "6px 14px" }}
                  onClick={() => copyCode(c.code)}>
                  {copied === c.code ? "Copied ✓" : "Copy code"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Cuisine map ── */}
        <div className="tt-card">
          <p className="form-label" style={{ marginBottom: 16 }}>Cuisine map</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {[
              ...passport.explored.map(c => ({ name: c, done: true })),
              ...passport.unexplored.map(c => ({ name: c, done: false }))
            ].map(c => (
              <div key={c.name} style={{
                padding: "14px", borderRadius: "var(--radius)",
                background: c.done ? "var(--accent-dim)" : "var(--bg3)",
                border: `1px solid ${c.done ? "var(--accent)" : "var(--border)"}`,
                textAlign: "center"
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: c.done ? "var(--accent)" : "var(--border)",
                  margin: "0 auto 8px"
                }} />
                <p style={{ fontSize: 13, fontWeight: c.done ? 600 : 400, color: c.done ? "var(--accent)" : "var(--text3)" }}>
                  {c.name}
                </p>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 14, textAlign: "center" }}>
            Order from an unexplored cuisine to unlock it
          </p>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default FoodPassport;