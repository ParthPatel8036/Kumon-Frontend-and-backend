// src/components/AppShell.jsx
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearToken, getRole, addAuthStorageListener } from "../services/auth";
import "./app-shell.css";
import brandLogo from "../assets/kumon-north-hobart.png";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: DashIcon },
  { to: "/scan", label: "Scan", icon: ScanIcon },
  { to: "/messages", label: "Messages", icon: MsgIcon },
  { to: "/templates", label: "Templates", icon: TplIcon },

  /* NEW */
  { to: "/users", label: "Users", icon: UsersIcon },

  { to: "/students", label: "Students", icon: StudentsIcon },
  { to: "/guardians", label: "Guardians", icon: GuardiansIcon }, // NEW
  { to: "/import", label: "Add Student(s)", icon: AddStudentsIcon },
  { to: "/settings", label: "Settings", icon: GearIcon },
];

export default function AppShell({ children }) {
  const [open, setOpen] = useState(false); // mobile drawer state
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false
  );
  const [role, setRole] = useState(() => getRole());

  const location = useLocation();
  const navigate = useNavigate();

  // Refs for focus management
  const menuBtnRef = useRef(null);
  const sideRef = useRef(null);

  // Track viewport (desktop vs mobile) so we only apply 'inert' on mobile
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = (e) => setIsDesktop(e.matches);
    mql.addEventListener?.("change", onChange);
    mql.addListener?.(onChange); // Safari fallback
    setIsDesktop(mql.matches);
    return () => {
      mql.removeEventListener?.("change", onChange);
      mql.removeListener?.(onChange);
    };
  }, []);

  // Refresh role if another tab logs in/out or role changes
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);

  // Close drawer on route change (mobile)
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Manage 'inert' + focus when opening/closing the drawer (mobile only)
  useEffect(() => {
    const sidebar = sideRef.current;
    if (!sidebar) return;

    // Only apply inert on mobile; desktop must stay interactive
    try { sidebar.inert = !isDesktop && !open; } catch {}

    if (isDesktop) return; // no focus juggling for desktop

    if (open) {
      // Move focus into the drawer when it opens (first interactive element)
      const firstFocusable =
        sidebar.querySelector(".nav .nav-item, .nav a, a, button, [tabindex]:not([tabindex='-1'])");
      firstFocusable?.focus();
    } else {
      // If focus remained inside the (now closed) drawer, return it to the menu button
      if (sidebar.contains(document.activeElement)) {
        menuBtnRef.current?.focus();
      }
    }
  }, [open, isDesktop]);

  function handleLogout(e) {
    e.preventDefault();
    try { clearToken(); } finally {
      navigate("/login", { replace: true });
    }
  }

  const isStaff = role === "STAFF";
  const staffAllowed = new Set([
    "/dashboard",
    "/scan",
    "/messages",
    "/students",
    "/guardians",
    "/settings", // Route-level guard will restrict to "My Preferences" section
  ]);
  const filteredNav = isStaff ? NAV.filter(({ to }) => staffAllowed.has(to)) : NAV;

  return (
    <div className="app-shell">
      <a href="#content" className="skip-link">Skip to content</a>

      {/* Mobile topbar */}
      <header className="topbar">
        <button
          ref={menuBtnRef}
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(v => !v)}
        >
          <BurgerIcon />
        </button>
        <Link to="/" className="brand">
          <span className="brand-dot" />
          Kumon
        </Link>
        <div className="topbar-spacer" />
      </header>

      {/* Sidebar (no aria-hidden; rely on inert for mobile when closed) */}
      <aside
        id="sidebar"
        ref={sideRef}
        className={`sidebar ${open ? "open" : ""}`}
        onKeyDown={(e) => { if (!isDesktop && e.key === "Escape") setOpen(false); }}
      >
        <div className="sidebar-header">
          <Link
            to="/"
            className="brand-lg"
            aria-label="Kumon North Hobart — home"
            style={{ textAlign: "left", display: "block" }}
          >
            <img
              src={brandLogo}
              alt="Kumon North Hobart"
              className="brand-img"
              decoding="async"
            />
          </Link>
        </div>

        {/* Nav (explicit left alignment) */}
        <nav className="nav" style={{ alignItems: "stretch" }}>
          {filteredNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
              style={{ justifyContent: "flex-start", textAlign: "left" }}
            >
              <Icon className="nav-ico" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Use anchor with click handler so it always logs out immediately */}
          <a
            href="/logout"
            className="nav-item danger"
            onClick={handleLogout}
            style={{ justifyContent: "flex-start", textAlign: "left" }}
          >
            <LogoutIcon className="nav-ico" />
            <span>Logout</span>
          </a>
        </div>
      </aside>

      {/* Overlay for mobile */}
      <button
        className={`scrim ${open ? "show" : ""}`}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
      />

      {/* Main content */}
      <main id="content" className="content">
        {children}
      </main>
    </div>
  );
}

/* --------- tiny inline SVG icons (no deps) --------- */
function DashIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M3 5h18v4H3zM3 10h10v9H3zM14 10h7v9h-7z" />
  </svg>
);}
function ScanIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M3 12h18" />
  </svg>
);}
function MsgIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
  </svg>
);}
function TplIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M4 4h16v6H4zM4 12h7v8H4zM13 12h7v8h-7z" />
  </svg>
);}

/* NEW */
function UsersIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M7 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm10 2a3 3 0 1 0-3-3 3 3 0 0 0 3 3z" />
    <path d="M14 21v-1c0-2.8-4-5-7-5s-7 2.2-7 5v1h14zM24 21v-1c0-2-2.7-3.8-5.8-4 0 0-1.2.1-1.2.1 1.8 1 3 2.2 3 3.9V21h4z" />
  </svg>
);}

function StudentsIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M12 3l9 5-9 5L3 8l9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />
  </svg>
);}
 /* NEW */
function GuardiansIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4v2h14v-2c0-2-3-4-7-4zm7-7a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-2 9a6.8 6.8 0 0 1 4 2v2h3v-2c0-2.2-3-4-7-4z" />
  </svg>
);}
function AddStudentsIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M15 19c0-2.2-3-4-7-4s-7 1.8-7 4v2h14v-2zM8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M19 8v6M16 11h6" />
  </svg>
);}
function GearIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12l2-1 1-3 3-1 2-2 2 2 3 1 1 3 2 1-2 1-1 3-3 1-2 2-2-2-3-1-1-3z" />
  </svg>
);}
function LogoutIcon(props){ return (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...props}>
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M16 17l5-5-5-5M21 12H9M12 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h6" />
  </svg>
);}
function BurgerIcon(props){ return (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...props}>
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);}