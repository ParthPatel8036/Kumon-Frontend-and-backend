// src/services/authSession.js
import { getToken, setToken, clearToken, parseJwt, AUTH_EVENT } from "./auth";
import { refreshAuth } from "./api";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh ~5 minutes before expiry
const MIN_DELAY_MS = 15 * 1000;        // avoid tight loops; at least 15s

let timerId = null;

// Simple route guard to avoid refreshing on login/logout screens
function onAuthPages() {
  try {
    const p = String(window.location.pathname || "");
    return p.startsWith("/login") || p.startsWith("/logout");
  } catch {
    return false;
  }
}

// Compute milliseconds until we should refresh the token.
// Returns null if no valid token/exp or when on login/logout.
function msUntilRefresh() {
  if (onAuthPages()) return null;
  const token = getToken();
  if (!token) return null;
  const p = parseJwt(token);
  if (!p || !p.exp) return null;
  const dueAt = p.exp * 1000 - REFRESH_SKEW_MS;
  const ms = dueAt - Date.now();
  return isFinite(ms) ? ms : null;
}

function schedule() {
  clearTimer();

  // Do not schedule if we are on login/logout or we cannot determine a refresh time
  const ms = msUntilRefresh();
  if (ms == null) return;

  const delay = Math.max(ms, MIN_DELAY_MS);
  timerId = setTimeout(async () => {
    // Bail out if we navigated to login/logout in the meantime
    if (onAuthPages()) return;

    try {
      const { token, user } = await refreshAuth();

      // If we ended up on login/logout during the request, do nothing
      if (onAuthPages()) return;

      // Preserve storage policy by using the 'remember' claim on the new token.
      const remember = !!parseJwt(token)?.remember;
      setToken(token, { remember });
      try { localStorage.setItem("auth.user", JSON.stringify(user)); } catch {}
    } catch (err) {
      // If unauthorized or network fails, clear token to force re-auth on next navigation/API call.
      if (String(err?.message || "").toLowerCase().includes("unauthorized")) {
        try { clearToken(); } catch {}
        return; // don't reschedule; app will redirect on next render
      }
      // Backoff and retry later
      timerId = setTimeout(schedule, 60 * 1000);
      return;
    }
    // Schedule the next refresh
    schedule();
  }, delay);
}

function clearTimer() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

/**
 * Initialize the auth session manager.
 * - Schedules a refresh before token expiry.
 * - Reschedules on auth changes, focus, visibility.
 * Returns a cleanup function.
 */
export function initAuthSession() {
  schedule();

  const onAuthEvent = () => schedule();
  const onFocus = () => schedule();
  const onVisibility = () => { if (!document.hidden) schedule(); };
  const onStorage = (e) => {
    if (!e || (e.key == null)) return;
    schedule();
  };

  window.addEventListener(AUTH_EVENT, onAuthEvent);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("storage", onStorage);

  return () => {
    clearTimer();
    window.removeEventListener(AUTH_EVENT, onAuthEvent);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("storage", onStorage);
  };
}