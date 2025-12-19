// src/pages/Login.jsx
import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { login } from "../services/api";
import { setToken, clearToken } from "../services/auth";
import { useLocation, useNavigate } from "react-router-dom";
import brandLogo from "../assets/kumon-north-hobart.png";
import "./login.css";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const pwRef = useRef(null);

  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: "", password: "", remember: false },
  });

  useEffect(() => {
    // Clear any stale auth on landing here
    clearToken();
    try { localStorage.removeItem("auth.user"); } catch {}
    try { sessionStorage.removeItem("auth.user"); } catch {}
  }, []);

  async function onSubmit(values) {
    setError(null);
    try {
      const email = values.email.trim();
      const remember = !!values.remember;
      const { token, user } = await login(email, values.password, { remember });

      // Persist token (guard against empty/invalid values) + user cache
      if (typeof token === "string" && token.trim()) {
        setToken(token, { remember });
      } else {
        throw new Error("Login response did not include a valid token");
      }

      try { localStorage.setItem("auth.user", JSON.stringify(user || {})); } catch {}

      // Navigate to last location or home
      const dest = loc.state?.from?.pathname || "/";
      nav(dest, { replace: true });
    } catch (e) {
      setError(e?.message || "Login failed");
    }
  }

  return (
    <div className="login-page">
      <form
        className="card login-card"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        aria-busy={formState.isSubmitting || undefined}
      >
        {/* Brand */}
        <img
          className="login-logo"
          src={brandLogo}
          alt="Kumon North Hobart"
          decoding="async"
        />

        <header style={{ marginBottom: 10, textAlign: "center" }}>
          <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>Sign in</h1>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Use your staff account to continue.
          </p>
        </header>

        {/* Email */}
        <label className="small muted" htmlFor="email" style={{ marginTop: 12 }}>
          Email
        </label>
        <input
          id="email"
          className="input"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          aria-invalid={!!formState.errors.email || undefined}
          {...register("email")}
        />

        {/* Password (with toggle) */}
        <label className="small muted" htmlFor="password" style={{ marginTop: 8 }}>
          Password
        </label>
        <div style={{ position: "relative" }}>
          <input
            id="password"
            ref={pwRef}
            className="input"
            placeholder="••••••••"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={!!formState.errors.password || undefined}
            {...register("password")}
            style={{ paddingRight: 82 }}
          />
          <button
            type="button"
            onClick={() => {
              setShowPw(v => !v);
              pwRef.current?.focus();
            }}
            className="btn btn-outline"
            aria-pressed={showPw}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              height: 36,
              padding: "0 10px",
            }}
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>

        {/* Keep me signed in */}
        <label
          htmlFor="remember"
          className="small"
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}
        >
          <input id="remember" type="checkbox" {...register("remember")} />
          Keep me signed in
        </label>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="small"
            style={{
              color: "crimson",
              marginTop: 10,
              background: "rgba(220,20,60,.06)",
              border: "1px solid rgba(220,20,60,.25)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button className="btn" disabled={formState.isSubmitting} style={{ marginTop: 14 }}>
          {formState.isSubmitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}