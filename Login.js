import { useState } from "react";
import axios from "axios";

function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await axios.post("http://localhost:5000/api/auth/login", form);
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("role", res.data.role);
      window.location.href = res.data.role === "admin" ? "/admin" : "/home";
    } catch (err) {
      setError(err.response?.data?.message || "Incorrect email or password.");
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
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            fontSize: 12, fontFamily: "'Syne', sans-serif", fontWeight: 700,
            letterSpacing: "0.14em", color: "var(--accent)", marginBottom: 10,
            textTransform: "uppercase"
          }}>TastyTap</div>
          <h1 style={{ fontSize: 30, marginBottom: 6 }}>Welcome back</h1>
          <p style={{ color: "var(--text2)", fontSize: 14 }}>Sign in to continue ordering</p>
        </div>

        <div className="tt-card">
          {error && <div className="error-box">{error}</div>}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Email address</label>
              <input className="tt-input" type="email" placeholder="you@example.com"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label className="form-label">Password</label>
              <input className="tt-input" type="password" placeholder="Your password"
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}
              style={{ width: "100%", padding: "12px", fontSize: 15 }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 20, color: "var(--text2)", fontSize: 13 }}>
            New here?{" "}
            <a href="/register" style={{ color: "var(--accent)", textDecoration: "none" }}>Create an account</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;