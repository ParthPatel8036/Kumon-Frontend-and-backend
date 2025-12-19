import { useEffect, useRef } from "react";

export default function Modal({ open, title, children, onClose, initialFocusRef, size = "md" }) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const lastFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Close on Escape
    const onEsc = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onEsc);

    // Lock scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Save/restore focus + initial focus
    lastFocusRef.current = document.activeElement;
    const focusTarget = initialFocusRef?.current || dialogRef.current;
    setTimeout(() => focusTarget?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prevOverflow;
      lastFocusRef.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  // Simple focus trap (Tab cycles within dialog)
  useEffect(() => {
    if (!open) return;
    const onTab = (e) => {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const selectors = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
      const nodes = Array.from(root.querySelectorAll(selectors)).filter(el => el.offsetParent !== null);
      if (nodes.length === 0) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && active === last) { first.focus(); e.preventDefault(); }
    };
    document.addEventListener("keydown", onTab);
    return () => document.removeEventListener("keydown", onTab);
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: "min(420px, 96vw)",
    md: "min(640px, 96vw)",
    lg: "min(900px, 96vw)",
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        backdropFilter: "blur(2px)",
        display: "grid",
        placeItems: "center",
        zIndex: 10000,
        padding: 16,                 // breathing room on small screens
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: sizes[size] || sizes.md,
          maxHeight: "min(80vh, 100dvh - 32px)",
          overflow: "auto",
          background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.03)), var(--surface)",
          color: "var(--text)",      // uses shell variable
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 10px 40px rgba(0,0,0,.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {!!title && <h2 id="modal-title" className="h1" style={{ margin: 0, flex: 1 }}>{title}</h2>}
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={() => onClose?.()}
          >
            {/* Visible, reliable "X" drawn with strokes */}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6L18 18M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}