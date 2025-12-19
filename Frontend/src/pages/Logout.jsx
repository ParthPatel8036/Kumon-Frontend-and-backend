import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { clearToken } from "../services/auth";
// import { request } from "../services/api"; // optional: call backend /auth/logout

export default function Logout() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    (async () => {
      try {
        // Optional server-side invalidate:
        // await request("/auth/logout", { method: "POST" });
      } catch (_) {
        // ignore; client-side logout still proceeds
      } finally {
        // Clear auth token(s) and broadcast auth change
        clearToken();

        // Clear any cached user objects some views read for role/UI
        try {
          const KEYS = ["auth.user", "user", "currentUser"];
          for (const k of KEYS) {
            localStorage.removeItem(k);
            sessionStorage.removeItem(k);
          }
        } catch {}

        // Send to login (guarded apps) or home for public apps
        const dest = "/login";
        // Defer navigation to ensure storage events propagate
        setTimeout(() => {
          nav(dest, { replace: true, state: { from: loc } });
        }, 0);
      }
    })();
  }, [nav, loc]);

  return null; // or return <div className="muted small">Logging out…</div>
}