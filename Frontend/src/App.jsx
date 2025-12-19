// src/App.jsx
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import AppShell from "./components/AppShell";
import "./styles/globals.css";
import { isAuthed, clearToken, getRole, addAuthStorageListener } from "./services/auth";
import { initAuthSession } from "./services/authSession"; // NEW

// Staff is allowed limited top-level areas + read-only on Students/Guardians.
function isStaffAllowedPath(pathname) {
  // Blocked first (explicit disallows)
  const blocked = [
    /^\/templates(\/|$)/,
    /^\/users(\/|$)/,
    /^\/import(\/|$)/,

    // Students/Guardians edit/create/delete routes
    /^\/students\/(new|create)(\/|$)/,
    /^\/students\/[^/]+\/(edit|delete)(\/|$)/,
    /^\/guardians\/(new|create)(\/|$)/,
    /^\/guardians\/[^/]+\/(edit|delete)(\/|$)/,

    // Any Settings subsection other than "preferences"
    /^\/settings\/(?!preferences)(.+)/,
  ];
  if (blocked.some((rx) => rx.test(pathname))) return false;

  // Allowed bases
  const allowed = [
    /^\/dashboard(\/|$)/,
    /^\/scan(\/|$)/,
    /^\/messages(\/|$)/,
    /^\/students(\/|$)/,  // read-only enforced by UI + blocked patterns above
    /^\/guardians(\/|$)/, // read-only enforced by UI + blocked patterns above
  ];

  // Settings: allow root or /settings/preferences only
  if (/^\/settings(\/|$)/.test(pathname)) {
    return pathname === "/settings" || /^\/settings\/preferences(\/|$)/.test(pathname);
  }

  return allowed.some((rx) => rx.test(pathname));
}

export default function App() {
  const loc = useLocation();
  const authed = isAuthed();
  const [role, setRole] = useState(() => getRole());

  const onLoginRoute = loc.pathname.startsWith("/login");
  const onLogoutRoute = loc.pathname.startsWith("/logout");

  // Keep role fresh if storage changes (login/logout in another tab, etc.)
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);

  // NEW: start silent/rolling session refresh on app mount
  useEffect(() => {
    if (onLoginRoute || onLogoutRoute) return; // don't refresh tokens on login/logout pages
    const stop = initAuthSession();
    return stop;
  }, [onLoginRoute, onLogoutRoute]);

  // Apply global accessibility prefs as CSS classes on <html>
  useEffect(() => {
    const root = document.documentElement;

    const getBool = (k, def = false) => {
      try {
        const v = localStorage.getItem(k);
        return v == null ? def : (v === "true" || v === "1" || v === "on");
      } catch {
        return def;
      }
    };

    const apply = () => {
      const high = getBool("pref.highContrast", false);
      const large = getBool("pref.largeText", false);
      const reduce = getBool("pref.reducedMotion", false);
      root.classList.toggle("pref-high-contrast", high);
      root.classList.toggle("pref-large-text", large);
      root.classList.toggle("pref-reduced-motion", reduce);
    };

    apply();

    const onStorage = (e) => {
      if (!e.key) return;
      if (
        e.key === "pref.highContrast" ||
        e.key === "pref.largeText" ||
        e.key === "pref.reducedMotion"
      ) {
        apply();
      }
    };
    const onFocus = () => apply();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Handle /logout: clear token and send to /login (works even if not authed)
  if (onLogoutRoute) {
    try {
      clearToken();
      try { localStorage.removeItem("auth.user"); } catch {}
      try { sessionStorage.removeItem("auth.user"); } catch {}
    } catch {}
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }

  // Root landing → dashboard or login
  if (loc.pathname === "/") {
    return <Navigate to={authed ? "/dashboard" : "/login"} replace />;
  }

  // If already logged in and hits /login, push to /dashboard
  if (onLoginRoute && authed) {
    return <Navigate to="/dashboard" replace />;
  }

  // If not authed and trying to access a protected route → login
  if (!onLoginRoute && !authed) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }

  // Unauthed routes (e.g., /login) render without the shell
  if (onLoginRoute) {
    return <Outlet />;
  }

  // RBAC: Staff guard (prevents direct URL access to hidden/forbidden routes)
  if (role === "STAFF" && !isStaffAllowedPath(loc.pathname)) {
    return <Navigate to="/dashboard" replace state={{ denied: loc.pathname }} />;
  }

  // Authenticated app: wrap routed pages with the responsive sidebar shell
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}