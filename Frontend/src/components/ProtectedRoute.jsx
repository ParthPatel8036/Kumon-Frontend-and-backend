// src/components/ProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { isAuthed, isAdmin, getRole } from "../services/auth";

/**
 * ProtectedRoute
 * - Always requires authentication
 * - Optional role gates:
 *    - requireAdmin: boolean (true = ADMIN only)
 *    - allowRoles: string[] (e.g., ["ADMIN", "STAFF"])
 * - redirectTo: where to send an authed but unauthorized user (default /dashboard)
 *
 * Usage:
 *   // Any authed user
 *   { element: <ProtectedRoute />, children: [...] }
 *
 *   // Admin-only block
 *   { element: <ProtectedRoute requireAdmin />, children: [...] }
 *
 *   // Specific roles
 *   { element: <ProtectedRoute allowRoles={['ADMIN']} />, children: [...] }
 */
export default function ProtectedRoute({ requireAdmin = false, allowRoles, redirectTo = "/dashboard" }) {
  const loc = useLocation();

  // 1) Must be logged in
  if (!isAuthed()) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }

  // 2) Role gates (only applied when specified)
  if (requireAdmin && !isAdmin()) {
    return <Navigate to={redirectTo} replace state={{ denied: loc.pathname }} />;
  }

  if (Array.isArray(allowRoles) && allowRoles.length > 0) {
    const role = String(getRole() || "").toUpperCase();
    const allowed = allowRoles.map(r => String(r).toUpperCase());
    if (!allowed.includes(role)) {
      return <Navigate to={redirectTo} replace state={{ denied: loc.pathname }} />;
    }
  }

  // 3) Authorized → render nested routes
  return <Outlet />;
}