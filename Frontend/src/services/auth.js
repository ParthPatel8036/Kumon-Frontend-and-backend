// src/services/auth.js
const TOKEN_KEY = "token";
export const AUTH_EVENT = "auth:changed";

function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event(AUTH_EVENT)); // same-tab broadcast
  } catch {}
}

/**
 * Store the token.
 * - If { remember: true } → localStorage (persists across browser restarts).
 * - Else (default) → sessionStorage (clears when tab/window closes).
 * Back-compat: setToken(token) still works and uses sessionStorage by default.
 *
 * Fix: guard against undefined, null, and empty tokens so we do not
 * accidentally persist the strings "undefined" or "null". If an invalid
 * value is provided, treat it as a clear.
 */
export const setToken = (t, opts = {}) => {
  const remember = !!opts.remember;

  // Normalize and validate the incoming token
  const raw =
    typeof t === "string" ? t : t == null ? null : String(t);
  const token =
    raw && raw.trim() && raw !== "undefined" && raw !== "null"
      ? raw
      : null;

  try {
    if (!token) {
      // Invalid or empty token → clear both stores
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
      return;
    }

    if (remember) {
      // Ensure session copy is cleared so local wins consistently
      try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      // Ensure local copy is cleared so session wins consistently
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      sessionStorage.setItem(TOKEN_KEY, token);
    }
  } finally {
    notifyAuthChanged();
  }
};

/**
 * Read token, preferring the session token (non-remembered) over remembered.
 * Filters out junk values like "undefined", "null", or empty strings.
 */
export const getToken = () => {
  const sanitize = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s || s === "undefined" || s === "null") return null;
    return s;
  };

  try {
    const s = sanitize(sessionStorage.getItem(TOKEN_KEY));
    if (s) return s;
  } catch {}
  try {
    const l = sanitize(localStorage.getItem(TOKEN_KEY));
    if (l) return l;
  } catch {}
  return null;
};

export const clearToken = () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  notifyAuthChanged();
};
export const isAuthed = () => !!getToken();

/* ---------- Role helpers (UI-side only; server must still enforce) ---------- */

const USER_KEYS = ["auth.user", "user", "currentUser"];

// Decode Base64URL → JSON
function b64urlDecode(s) {
  try {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    const str = atob(b64);
    // Decode as UTF-8
    const out = decodeURIComponent(
      str
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return out;
  } catch {
    return null;
  }
}

export function parseJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadStr = b64urlDecode(parts[1]);
    if (!payloadStr) return null;
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}

function getStoredUser() {
  for (const k of USER_KEYS) {
    try {
      const raw = localStorage.getItem(k) ?? sessionStorage.getItem(k);
      if (!raw) continue;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    } catch {}
  }
  return null;
}

/** Returns "ADMIN" or "STAFF" (defaulting to STAFF if unknown) */
export function getRole() {
  // Optional global injection
  if (typeof window !== "undefined" && window.__USER?.role) {
    return String(window.__USER.role).toUpperCase();
  }

  // Local/session user cache
  const u = getStoredUser();
  if (u?.role) return String(u.role).toUpperCase();
  if (Array.isArray(u?.roles) && u.roles.length) return String(u.roles[0]).toUpperCase();

  // JWT claims
  const t = getToken();
  if (t) {
    const p = parseJwt(t);
    const candidates = [
      p?.role,
      Array.isArray(p?.roles) ? p.roles[0] : p?.roles,
      p?.["https://schemas.example/role"],
      Array.isArray(p?.["https://schemas.example/roles"])
        ? p["https://schemas.example/roles"][0]
        : p?.["https://schemas.example/roles"],
    ].filter(Boolean);
    if (candidates.length) return String(candidates[0]).toUpperCase();
  }

  // Safe restrictive default
  return "STAFF";
}

export function isStaff() {
  return getRole() === "STAFF";
}
export function isAdmin() {
  return getRole() === "ADMIN";
}

/**
 * Subscribe to auth/role changes (same-tab + cross-tab).
 * Caller can re-read getRole() in the listener.
 * Returns an unsubscribe fn.
 */
export function addAuthStorageListener(listener) {
  const invoke = () => {
    try {
      listener(getRole());
    } catch {}
  };

  // Cross-tab changes (localStorage "storage" event)
  const onStorage = (e) => {
    // Any storage change → recompute role
    if (!e || (!e.key && e.key !== "")) return;
    invoke();
  };

  window.addEventListener("storage", onStorage);
  // Same-tab login/logout token updates
  window.addEventListener(AUTH_EVENT, invoke);
  // Mild safety nets when tab regains focus or becomes visible
  window.addEventListener("focus", invoke);
  const onVisibility = () => {
    if (!document.hidden) invoke();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTH_EVENT, invoke);
    window.removeEventListener("focus", invoke);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}