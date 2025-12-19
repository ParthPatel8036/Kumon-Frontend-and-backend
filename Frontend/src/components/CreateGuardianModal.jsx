// src/components/CreateGuardianModal.jsx
import { useEffect, useRef, useState } from "react";
import * as api from "../services/api";

export default function CreateGuardianModal({ open, onClose, onCreated, defaultRelationship = "GUARDIAN" }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [phoneRaw, setPhoneRaw]   = useState("");
  const [relationship, setRelationship] = useState(defaultRelationship);
  const [email, setEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setErr("");
      setSubmitting(false);
      // focus first field
      setTimeout(() => firstInputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [open, onClose]);

  // Same AU phone normalization used elsewhere
  function toE164AU(input) {
    let s = String(input || "").trim();
    s = s.replace(/[^\d+]/g, ""); // keep + and digits
    if (!s) return "";
    if (s.startsWith("+")) s = s.slice(1);
    if (s.startsWith("61")) return "+61" + s.slice(2);
    if (s.startsWith("0")) return "+61" + s.slice(1);
    if (/^4\d{8}$/.test(s)) return "+61" + s;
    return "";
  }

  // Unicode-aware: letters + marks + spaces/hyphens/apostrophes, must start/end with a letter
  const NAME_REGEX = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'\-’]*[\p{L}\p{M}])?$/u;

  function validate() {
    if (!firstName.trim()) return "First name is required";
    if (firstName.trim().length > 100) return "First name must be 100 characters or less";
    if (!NAME_REGEX.test(firstName.trim())) return "First name must contain only letters (plus spaces, hyphens, apostrophes) and start/end with a letter";

    if (lastName.trim()) {
      if (lastName.trim().length > 100) return "Last name must be 100 characters or less";
      if (!NAME_REGEX.test(lastName.trim())) return "Last name must contain only letters (plus spaces, hyphens, apostrophes) and start/end with a letter";
    }

    const e164 = toE164AU(phoneRaw);
    if (!e164) return "Enter a valid AU mobile number (e.g., 04xxxxxxxx)";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setSubmitting(true);
    setErr("");

    const phone = toE164AU(phoneRaw);
    const payload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      relationship: (relationship || "GUARDIAN").trim() || "GUARDIAN",
      phone, // backend expects E.164 as "phone"
      ...(email.trim() ? { email: email.trim() } : {})
    };

    try {
      const resp = typeof api.createGuardian === "function"
        ? await api.createGuardian(payload)
        : await (api.post ? api.post("/guardians", payload) : api.request?.("POST", "/guardians", payload));

      const created = Array.isArray(resp) ? resp[0] : (resp?.item || resp || {});
      onCreated?.(created);
      // reset form after success
      setFirstName(""); setLastName(""); setPhoneRaw(""); setRelationship(defaultRelationship); setEmail("");
    } catch (e) {
      setErr(e?.message || "Failed to create guardian");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-guardian-title"
        className="card"
        style={{
          width: "min(720px, 92vw)",
          maxWidth: "92vw",
          // NEW → force an opaque panel so table doesn't show through
          background: "var(--surface, #fff)",
          border: "1px solid var(--border, rgba(0,0,0,.12))",
          borderRadius: 12,
          boxShadow: "0 20px 40px rgba(0,0,0,.25)",
          maxHeight: "90vh",
          overflowY: "auto"
        }}
      >
        <form className="form" onSubmit={handleSubmit}>
          <h2 id="create-guardian-title" className="h2" style={{ marginTop: 0 }}>
            New Guardian
          </h2>

          {err ? (
            <div
              className="small"
              role="alert"
              style={{
                marginBottom: 8,
                background: "rgba(239,68,68,.12)",
                border: "1px solid rgba(239,68,68,.3)",
                borderRadius: 10,
                padding: "8px 10px"
              }}
            >
              {err}
            </div>
          ) : null}

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="cg-firstName">First name</label>
              <input
                id="cg-firstName"
                ref={firstInputRef}
                className="input"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="e.g., Jane"
                required
              />
            </div>
            <div>
              <label className="small muted" htmlFor="cg-lastName">Last name</label>
              <input
                id="cg-lastName"
                className="input"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="e.g., Smith"
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="cg-phoneRaw">Mobile number</label>
              <input
                id="cg-phoneRaw"
                className="input"
                value={phoneRaw}
                onChange={e => setPhoneRaw(e.target.value)}
                placeholder="e.g., 04xxxxxxxx"
                inputMode="tel"
                required
              />
              <div className="small muted" style={{ marginTop: 4 }}>
                Will be sent as E.164: <strong>{toE164AU(phoneRaw) || "—"}</strong>
              </div>
            </div>
            <div>
              <label className="small muted" htmlFor="cg-relationship">Relationship (optional)</label>
              <input
                id="cg-relationship"
                className="input"
                value={relationship}
                onChange={e => setRelationship(e.target.value)}
                placeholder="e.g., GUARDIAN"
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="cg-email">Email (optional)</label>
              <input
                id="cg-email"
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>

          <div className="actions" style={{ marginTop: 8 }}>
            <span className="muted small">Create a guardian without linking to a student.</span>
            <span className="spacer" />
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? "Creating…" : "Create Guardian"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}