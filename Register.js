import { useState } from "react";
import axios from "axios";

// Field MUST be outside the component — defining it inside causes React to
// remount it on every render, which drops focus after each keystroke
const Field = ({ label, type = "text", placeholder, value, onChange }) => (
  <div style={{ marginBottom: 14 }}>
    <label className="form-label">{label}</label>
    <input
      className="tt-input"
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      autoComplete="off"
    />
  </div>
);

function Register() {
  const [form, setForm] = useState({
    name: "", email: "", password: "", phone: "", address: "", city: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const validate = () => {
    if (!/^[A-Za-z\s]+$/.test(form.name.trim())) return "Name should only contain letters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Enter a valid email address.";
    if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(form.password))
      return "Password needs 8+ characters, one uppercase, one number, one special character.";
    if (form.phone && !/^\d{10}$/.test(form.phone)) return "Phone must be 10 digits.";
    return null;
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setLoading(true);
    setError("");
    try {
      await axios.post("http://localhost:5000/api/auth/register", form);
      window.location.href = "/";
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            fontSize: 12, fontFamily: "'Syne', sans-serif", fontWeight: 700,
            letterSpacing: "0.14em", color: "var(--accent)", marginBottom: 10,
            textTransform: "uppercase"
          }}>TastyTap</div>
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Create your account</h1>
          <p style={{ color: "var(--text2)", fontSize: 14 }}>
            Get delivery from the best restaurants around you.
          </p>
        </div>

        <div className="tt-card">
          {error && <div className="error-box">{error}</div>}

          <form onSubmit={handleRegister}>
            <Field label="Full name" placeholder="Haripriya S"
              value={form.name} onChange={set("name")} />
            <Field label="Email address" type="email" placeholder="you@example.com"
              value={form.email} onChange={set("email")} />
            <Field label="Password" type="password"
              placeholder="Min 8 chars, uppercase, number, special char"
              value={form.password} onChange={set("password")} />
            <Field label="Phone number (optional)" placeholder="10-digit mobile number"
              value={form.phone} onChange={set("phone")} />
            <Field label="City" placeholder="Bangalore"
              value={form.city} onChange={set("city")} />
            <Field label="Delivery address (optional)"
              placeholder="123, 5th Cross, Koramangala, Bangalore"
              value={form.address} onChange={set("address")} />

            <button className="btn-primary" type="submit" disabled={loading}
              style={{ width: "100%", padding: "12px", fontSize: 15, marginTop: 8 }}>
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 20, color: "var(--text2)", fontSize: 13 }}>
            Already have an account?{" "}
            <a href="/" style={{ color: "var(--accent)", textDecoration: "none" }}>Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;