import { useState, useEffect } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import Toast from "../components/Toast";

const API = "http://localhost:5000";

const ALL_PREFERENCES = ["vegetarian", "vegan", "jain", "halal", "eggetarian", "gluten-free", "dairy-free"];
const ALL_ALLERGENS   = ["peanuts", "dairy", "gluten", "shellfish", "eggs", "soy", "tree nuts", "fish"];

function Profile() {
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Edit profile state
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone: "", address: "", city: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change state
  const [pwMode, setPwMode] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [savingPw, setSavingPw] = useState(false);

  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/api/users/profile`, { headers })
      .then(r => {
        setUser(r.data);
        setPrefs(r.data.dietaryPreferences || []);
        setAllergies(r.data.allergies || []);
        setEditForm({
          name: r.data.name || "",
          phone: r.data.phone || "",
          address: r.data.address || "",
          city: r.data.city || "",
        });
      }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (list, setList, val) =>
    setList(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);

  const saveDietary = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/api/users/dietary-profile`,
        { dietaryPreferences: prefs, allergies }, { headers });
      setToast({ message: "Dietary profile saved.", type: "success" });
    } catch (err) {
      setToast({ message: err.response?.data?.message || "Save failed", type: "error" });
    } finally { setSaving(false); }
  };

  const saveProfile = async () => {
    if (!editForm.name.trim()) return setToast({ message: "Name cannot be empty", type: "error" });
    setSavingProfile(true);
    try {
      const res = await axios.put(`${API}/api/users/update-profile`, editForm, { headers });
      setUser(prev => ({ ...prev, ...editForm }));
      setEditMode(false);
      setToast({ message: "Profile updated successfully.", type: "success" });
    } catch (err) {
      setToast({ message: err.response?.data?.message || "Update failed", type: "error" });
    } finally { setSavingProfile(false); }
  };

  const changePassword = async () => {
    if (!pwForm.currentPassword || !pwForm.newPassword)
      return setToast({ message: "Fill all password fields", type: "error" });
    if (pwForm.newPassword !== pwForm.confirmPassword)
      return setToast({ message: "Passwords do not match", type: "error" });
    if (pwForm.newPassword.length < 6)
      return setToast({ message: "Password must be at least 6 characters", type: "error" });
    setSavingPw(true);
    try {
      await axios.put(`${API}/api/users/change-password`, {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword
      }, { headers });
      setPwMode(false);
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setToast({ message: "Password changed successfully.", type: "success" });
    } catch (err) {
      setToast({ message: err.response?.data?.message || "Password change failed", type: "error" });
    } finally { setSavingPw(false); }
  };

  if (!user) return <><Navbar /><div className="spinner" /></>;

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 640 }}>

        {/* ── User card ── */}
        <div className="tt-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: editMode ? 20 : 0 }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "var(--accent-dim)", border: "2px solid var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 700, color: "var(--accent)",
              fontFamily: "'Syne', sans-serif", flexShrink: 0
            }}>
              {user.name?.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 17, marginBottom: 2 }}>{user.name}</h3>
              <p style={{ color: "var(--text2)", fontSize: 13 }}>{user.email}</p>
              {user.phone && <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 1 }}>📞 {user.phone}</p>}
              {user.city && <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 1 }}>🏙 {user.city}</p>}
              {user.address && <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 1 }}>📍 {user.address}</p>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn-ghost" style={{ fontSize: 13, padding: "6px 14px" }}
                onClick={() => { setEditMode(p => !p); setPwMode(false); }}>
                {editMode ? "Cancel" : "✏️ Edit"}
              </button>
              <button className="btn-ghost" style={{ fontSize: 13, padding: "6px 14px" }}
                onClick={() => { setPwMode(p => !p); setEditMode(false); }}>
                {pwMode ? "Cancel" : "🔒 Password"}
              </button>
            </div>
          </div>

          {/* Edit profile form */}
          {editMode && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
              <p className="form-label" style={{ marginBottom: 14 }}>Edit profile details</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>NAME</label>
                  <input className="tt-input" value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Your name" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>PHONE</label>
                  <input className="tt-input" value={editForm.phone}
                    onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="Phone number" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>CITY</label>
                  <input className="tt-input" value={editForm.city}
                    onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))}
                    placeholder="City (used for weather recommendations)" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>ADDRESS</label>
                  <input className="tt-input" value={editForm.address}
                    onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))}
                    placeholder="Default delivery address" />
                </div>
                <button className="btn-primary" style={{ padding: "10px 24px", alignSelf: "flex-start" }}
                  disabled={savingProfile} onClick={saveProfile}>
                  {savingProfile ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          )}

          {/* Change password form */}
          {pwMode && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
              <p className="form-label" style={{ marginBottom: 14 }}>Change password</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>CURRENT PASSWORD</label>
                  <input className="tt-input" type="password" value={pwForm.currentPassword}
                    onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
                    placeholder="Current password" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>NEW PASSWORD</label>
                  <input className="tt-input" type="password" value={pwForm.newPassword}
                    onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
                    placeholder="New password (min 6 chars)" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text2)", display: "block", marginBottom: 4 }}>CONFIRM NEW PASSWORD</label>
                  <input className="tt-input" type="password" value={pwForm.confirmPassword}
                    onChange={e => setPwForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    placeholder="Confirm new password" />
                </div>
                <button className="btn-primary" style={{ padding: "10px 24px", alignSelf: "flex-start" }}
                  disabled={savingPw} onClick={changePassword}>
                  {savingPw ? "Changing..." : "Change password"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Dietary preferences ── */}
        <div className="tt-card" style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 15, marginBottom: 4 }}>Dietary preferences</h4>
          <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 16 }}>
            Your menu will filter to show only matching items by default. This goes beyond the basic veg/non-veg toggle — you can specify exactly what works for you.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ALL_PREFERENCES.map(p => (
              <div key={p}
                onClick={() => toggle(prefs, setPrefs, p)}
                className={`tag-pill ${prefs.includes(p) ? "selected" : ""}`}>
                {p}
              </div>
            ))}
          </div>
        </div>

        {/* ── Allergens ── */}
        <div className="tt-card" style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 15, marginBottom: 4 }}>Allergy passport</h4>
          <p style={{ color: "var(--text2)", fontSize: 13, marginBottom: 16 }}>
            Any item containing these ingredients will be flagged with a warning before you add it to your cart.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ALL_ALLERGENS.map(a => (
              <div key={a}
                onClick={() => toggle(allergies, setAllergies, a)}
                style={{
                  padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontSize: 13,
                  border: `1px solid ${allergies.includes(a) ? "var(--danger)" : "var(--border)"}`,
                  background: allergies.includes(a) ? "rgba(192,82,74,0.12)" : "var(--bg3)",
                  color: allergies.includes(a) ? "var(--danger)" : "var(--text2)",
                  transition: "all 0.15s", userSelect: "none"
                }}>
                {a}
              </div>
            ))}
          </div>
        </div>

        <button className="btn-primary" style={{ padding: "12px 32px", fontSize: 15 }}
          disabled={saving} onClick={saveDietary}>
          {saving ? "Saving..." : "Save dietary profile"}
        </button>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}

export default Profile;