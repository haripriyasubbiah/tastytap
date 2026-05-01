import { useState, useEffect, useRef } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

// ── Two mood sections shown separately in the picker ──
const MOOD_SECTIONS = [
  {
    label: "How are you feeling?",
    subLabel: "We'll match the food to your mood",
    moods: [
      { id: "happy",     emoji: "😄", label: "Happy",     desc: "Celebratory street bites" },
      { id: "sad",       emoji: "😢", label: "Sad",       desc: "Cheesy, warm, indulgent" },
      { id: "stressed",  emoji: "😤", label: "Stressed",  desc: "Hearty comfort food" },
      { id: "bored",     emoji: "😑", label: "Bored",     desc: "Something bold & new" },
      { id: "romantic",  emoji: "🥰", label: "Romantic",  desc: "Date night vibes" },
      { id: "anxious",   emoji: "😰", label: "Anxious",   desc: "Gentle & familiar" },
      { id: "nostalgic", emoji: "🥹", label: "Nostalgic", desc: "Tastes like home" },
      { id: "energetic", emoji: "⚡", label: "Energetic", desc: "Fast fuel, big flavour" },
    ]
  },
  {
    label: "What are you craving?",
    subLabel: "Skip the mood, just pick a vibe",
    moods: [
      { id: "comfort",     emoji: "🍲", label: "Comfort",     desc: "Warm, hearty, familiar" },
      { id: "adventurous", emoji: "🌶️", label: "Adventurous", desc: "Something different tonight" },
      { id: "light",       emoji: "🥗", label: "Light",       desc: "Easy on the stomach" },
      { id: "celebratory", emoji: "🎉", label: "Celebratory", desc: "Treat yourself" },
      { id: "tired",       emoji: "😴", label: "Tired",       desc: "Quick and satisfying" },
    ]
  }
];

// Flat lookup list
const ALL_MOODS = MOOD_SECTIONS.flatMap(s => s.moods);

function Recommendations() {
  const [selectedMood, setSelectedMood] = useState(null);
  const [result, setResult]             = useState(null);
  const [patterns, setPatterns]         = useState([]);
  const [trending, setTrending]         = useState(null);
  const [loading, setLoading]           = useState(false);
  const [toast, setToast]               = useState(null);
  const token    = localStorage.getItem("token");
  // keep token in a ref so useEffect doesn't re-run on every render
  const tokenRef = useRef(token);

  useEffect(() => {
    const headers = { Authorization: `Bearer ${tokenRef.current}` };
    axios.get(`${API}/api/recommendations/patterns`, { headers })
      .then(r => setPatterns(r.data.patterns || [])).catch(() => {});
    axios.get(`${API}/api/trending/neighbourhood`, { headers })
      .then(r => setTrending(r.data)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getRecommendations = async () => {
    if (!selectedMood) return;
    setLoading(true);
    setResult(null);
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const res = await axios.post(`${API}/api/recommendations`, { mood: selectedMood }, { headers });
      setResult(res.data);
    } catch (err) {
      setToast({ message: err.response?.data?.message || "Failed to get recommendations", type: "error" });
    } finally { setLoading(false); }
  };

  // Navigate to the Restaurants page and open the correct restaurant's menu.
  // We pass the restaurant via sessionStorage so Restaurants.js can auto-open it.
  const openRestaurant = (restaurant) => {
    sessionStorage.setItem("openRestaurantId", restaurant._id);
    window.location.href = "/home";
  };

  const selectedMoodData = ALL_MOODS.find(m => m.id === selectedMood);

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 760 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>For You</h2>
        <p style={{ color: "var(--text2)", marginBottom: 32, fontSize: 14 }}>
          Pick your mood — we factor in the time, weather, and what you've been ordering.
        </p>

        {/* ── Mood picker ── */}
        <div className="tt-card" style={{ marginBottom: 20 }}>
          {MOOD_SECTIONS.map((section, si) => (
            <div key={section.label} style={{ marginBottom: si < MOOD_SECTIONS.length - 1 ? 28 : 0 }}>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, color: "var(--text)" }}>
                {section.label}
              </p>
              <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 12 }}>
                {section.subLabel}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {section.moods.map(m => {
                  const active = selectedMood === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedMood(active ? null : m.id)}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "var(--radius)",
                        cursor: "pointer",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        background: active ? "var(--accent-dim)" : "var(--bg3)",
                        transition: "all 0.15s",
                        minWidth: 110,
                        userSelect: "none"
                      }}>
                      <p style={{ fontSize: 20, marginBottom: 4 }}>{m.emoji}</p>
                      <p style={{
                        fontWeight: 600, fontSize: 13, marginBottom: 2,
                        color: active ? "var(--accent)" : "var(--text)"
                      }}>{m.label}</p>
                      <p style={{ color: "var(--text3)", fontSize: 11 }}>{m.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Selected mood preview chip */}
          {selectedMoodData && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", marginTop: 20,
              background: "var(--accent-dim)", borderRadius: "var(--radius)",
              border: "1px solid var(--accent)"
            }}>
              <span style={{ fontSize: 22 }}>{selectedMoodData.emoji}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 14, color: "var(--accent)", marginBottom: 1 }}>
                  {selectedMoodData.label} selected
                </p>
                <p style={{ fontSize: 12, color: "var(--text2)" }}>{selectedMoodData.desc}</p>
              </div>
              <button
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--text3)", padding: 0
                }}
                onClick={() => setSelectedMood(null)}>✕ Clear</button>
            </div>
          )}

          <button
            className="btn-primary"
            style={{ padding: "10px 28px", marginTop: 16 }}
            disabled={!selectedMood || loading}
            onClick={getRecommendations}>
            {loading ? "Finding options..." : "Show recommendations"}
          </button>
        </div>

        {/* ── Recommendation results ── */}
        {result && (
          <div className="tt-card" style={{ marginBottom: 20, borderColor: "var(--accent)" }}>
            {/* Mood message + food note */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              {selectedMoodData && (
                <span style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>{selectedMoodData.emoji}</span>
              )}
              <div>
                <p style={{ color: "var(--accent2)", fontSize: 15, lineHeight: 1.6, marginBottom: 6 }}>
                  {result.message}
                </p>
                {result.foodNote && (
                  <p style={{
                    fontSize: 13, color: "var(--text2)", fontStyle: "italic",
                    borderLeft: "3px solid var(--accent)", paddingLeft: 10, margin: 0
                  }}>
                    {result.foodNote}
                  </p>
                )}
              </div>
            </div>

            {/* Context badges */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {result.context?.weather && (
                <span className="badge badge-info">
                  {result.context.weather.condition} · {Math.round(result.context.weather.temp)}°C
                </span>
              )}
              <span className="badge badge-gray">{result.context?.timeSlot}</span>
              {result.context?.mood && (
                <span className="badge badge-accent">
                  {selectedMoodData?.emoji} {result.context.mood}
                </span>
              )}
            </div>

            {/* Recommended cuisines */}
            {result.recommendedCuisines?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p className="form-label" style={{ marginBottom: 8 }}>Cuisines that match</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {result.recommendedCuisines.map(c => (
                    <span key={c} className="badge badge-accent">{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Restaurant cards */}
            {result.restaurants?.length > 0 && (
              <>
                <p className="form-label" style={{ marginBottom: 10 }}>Top picks — tap to order</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {result.restaurants.slice(0, 6).map(r => (
                    <div
                      key={r._id}
                      onClick={() => openRestaurant(r)}
                      style={{ cursor: "pointer", textDecoration: "none" }}>
                      <div style={{
                        background: "var(--bg3)", borderRadius: "var(--radius)",
                        padding: "12px 14px", border: "1px solid var(--border)",
                        transition: "border-color 0.15s"
                      }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
                        <p style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>{r.name}</p>
                        {r.cuisine && <span className="badge badge-accent" style={{ fontSize: 10 }}>{r.cuisine}</span>}
                        <p style={{ fontSize: 11, color: "var(--accent)", marginTop: 6 }}>Tap to order →</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Your ordering patterns ── */}
        {patterns.length > 0 && (
          <div className="tt-card" style={{ marginBottom: 20 }}>
            <p className="form-label" style={{ marginBottom: 14 }}>Your patterns</p>
            {patterns.map((p, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                borderBottom: i < patterns.length - 1 ? "1px solid var(--border)" : "none"
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>{p}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Neighbourhood trending ── */}
        {trending ? (
          <div className="tt-card">
            <p className="form-label" style={{ marginBottom: 4 }}>🔥 Trending near you</p>
            <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 16 }}>{trending.message}</p>
            {trending.topCuisine && (
              <p style={{ marginBottom: 14, fontSize: 14 }}>
                Most ordered: <span style={{ color: "var(--accent)", fontWeight: 600 }}>{trending.topCuisine}</span>
              </p>
            )}
            {trending.topRestaurants?.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {trending.topRestaurants.slice(0, 5).map((r, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "9px 12px", background: "var(--bg3)", borderRadius: 8,
                    cursor: "pointer", transition: "border-color 0.15s",
                    border: "1px solid var(--border)"
                  }}
                    onClick={() => {
                      if (r.restaurantId) {
                        sessionStorage.setItem("openRestaurantId", r.restaurantId);
                        window.location.href = "/home";
                      }
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: "var(--text3)", fontSize: 12, minWidth: 20, fontWeight: 600 }}>#{i + 1}</span>
                      <span style={{ fontSize: 14 }}>{r.restaurantName}</span>
                      {r.cuisine && <span className="badge badge-gray" style={{ fontSize: 10 }}>{r.cuisine}</span>}
                    </div>
                    <span style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600 }}>{r.orderCount} orders</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text3)", fontSize: 13 }}>No trending data yet for your area.</p>
            )}
          </div>
        ) : (
          <div className="tt-card">
            <p className="form-label" style={{ marginBottom: 4 }}>🔥 Trending near you</p>
            <p style={{ color: "var(--text3)", fontSize: 13, marginTop: 8 }}>
              Set your address in Profile to see what's trending in your neighbourhood.
            </p>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default Recommendations;