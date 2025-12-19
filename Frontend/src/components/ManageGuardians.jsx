// src/components/ManageGuardians.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGuardians,
  getGuardiansByStudent,
  createGuardian,
  linkGuardian,
  unlinkGuardian, // NEW
} from "../services/api";
import { getRole, addAuthStorageListener } from "../services/auth";

/**
 * Modal/panel to attach a guardian to an existing student.
 *
 * Props:
 *   - student: { id, first_name/firstName, last_name/lastName, ... }
 *   - guardians: Guardian[] (optional initial list for this student)
 *   - onClose: () => void
 *   - onChange: (newGuardianList: any[]) => void
 */
export default function ManageGuardians({ student, guardians = [], onClose, onChange }) {
  const titleId = useRef(`mg-title-${Math.random().toString(36).slice(2)}`).current;
  const panelRef = useRef(null);

  // RBAC
  const [role, setRole] = useState(() => getRole());
  const isAdmin = role === "ADMIN";
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);

  // Drawer layout: mobile bottom sheet, desktop right drawer
  const isWide = useIsWide(900);

  // Tabs: "find" existing vs "create" new
  const [tab, setTab] = useState("find"); // "find" | "create"

  // Current linked guardians for this student
  const [linkedIds, setLinkedIds] = useState(() => new Set((guardians || []).map(g => g.id)));
  const [linkedList, setLinkedList] = useState(() => (Array.isArray(guardians) ? guardians : []));

  // Find tab state
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [linkBusy, setLinkBusy] = useState({});   // id -> boolean
  const [unlinkBusy, setUnlinkBusy] = useState({}); // id -> boolean
  const [isPrimary, setIsPrimary] = useState(false);

  // Create tab state
  const [nf, setNf] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    relationship: "GUARDIAN",
    primary: true,
  });
  const [creating, setCreating] = useState(false);

  // UX/Error
  const [err, setErr] = useState("");

  // Utilities
  const sid = Number(student?.id);
  const studentName = useMemo(() => {
    const f = student?.first_name ?? student?.firstName ?? "";
    const l = student?.last_name ?? student?.lastName ?? "";
    return `${f} ${l}`.trim() || `ID ${sid}`;
  }, [student, sid]);

  // Sync with guardians prop when student or provided list changes
  useEffect(() => {
    const arr = Array.isArray(guardians) ? guardians : [];
    setLinkedList(arr);
    setLinkedIds(new Set(arr.map(x => x.id)));
  }, [sid, guardians]);

  // Initial refresh from API (source of truth)
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const g = await getGuardiansByStudent(sid);
        const arr = Array.isArray(g) ? g : (g?.items || []);
        if (!on) return;
        setLinkedList(arr);
        setLinkedIds(new Set(arr.map((x) => x.id)));
        onChange && onChange(arr);
      } catch (e) {
        if (!on) return;
        setErr(e?.message || "Failed to load linked guardians.");
      }
    })();
    return () => { on = false; };
  }, [sid, onChange]);

  // Debounced search for "find" tab
  useEffect(() => {
    if (tab !== "find") return;
    const handle = setTimeout(async () => {
      setErr("");
      setSearching(true);
      try {
        const data = await getGuardians(20, 0, q.trim(), "", "", "");
        const list = Array.isArray(data) ? data : (data?.items || []);
        setResults(list);
      } catch (e) {
        setErr(e?.message || "Search failed.");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [q, tab]);

  function canCreate() {
    return nf.firstName.trim() && nf.lastName.trim() && nf.phone.trim();
  }

  async function refreshLinked() {
    try {
      const g = await getGuardiansByStudent(sid);
      const arr = Array.isArray(g) ? g : (g?.items || []);
      setLinkedList(arr);
      setLinkedIds(new Set(arr.map((x) => x.id)));
      onChange && onChange(arr);
    } catch {
      // swallow; parent retains previous state
    }
  }

  async function handleLink(guardianId, primaryFlag) {
    if (!isAdmin) { setErr("Only Admin can link guardians."); return; }
    if (!guardianId) return;

    setErr("");
    setLinkBusy((m) => ({ ...m, [guardianId]: true }));
    try {
      await linkGuardian(sid, guardianId, !!primaryFlag);
      await refreshLinked();
    } catch (e) {
      setErr(e?.message || "Failed to link guardian.");
    } finally {
      setLinkBusy((m) => ({ ...m, [guardianId]: false }));
    }
  }

  async function handleUnlink(guardianId) {
    if (!isAdmin) { setErr("Only Admin can unlink guardians."); return; }
    if (!guardianId) return;
    if (!window.confirm("Unlink this guardian from the student? The guardian will remain in the system.")) return;

    setErr("");
    setUnlinkBusy((m) => ({ ...m, [guardianId]: true }));
    try {
      await unlinkGuardian(sid, guardianId);
      await refreshLinked();
    } catch (e) {
      setErr(e?.message || "Failed to unlink guardian.");
    } finally {
      setUnlinkBusy((m) => ({ ...m, [guardianId]: false }));
    }
  }

  async function handleCreate() {
    if (!isAdmin) { setErr("Only Admin can create guardians."); return; }
    if (!canCreate()) return;

    setErr("");
    setCreating(true);
    try {
      // 1) Create guardian
      const created = await createGuardian({
        firstName: nf.firstName.trim(),
        lastName: nf.lastName.trim(),
        phone: nf.phone.trim(),
        email: nf.email.trim() || null,
        relationship: nf.relationship.trim() || "GUARDIAN",
      });

      const gid = (created?.id ?? created?.item?.id ?? created?.guardian?.id);
      if (!gid) throw new Error("Guardian created but ID not returned.");

      // 2) Link to this student
      await linkGuardian(sid, gid, !!nf.primary);

      // 3) Refresh and reset for another addition
      await refreshLinked();
      setNf({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        relationship: "GUARDIAN",
        primary: true,
      });
      setTab("find");
      setQ("");
    } catch (e) {
      setErr(e?.message || "Failed to create/link guardian.");
    } finally {
      setCreating(false);
    }
  }

  // Keyboard close (Escape)
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const overlayStyle = isWide ? overlayDesktop : overlayMobile;
  const panelStyle = isWide ? panelDesktop : panelMobile;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={overlayStyle}
    >
      <div ref={panelRef} style={panelStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h2 id={titleId} className="h2" style={{ margin: 0, flex: 1 }}>
            Add guardian · <span className="muted">{studentName}</span>
          </h2>
          <button type="button" className="btn btn-outline small" onClick={onClose}>
            Close
          </button>
        </div>

        {/* RBAC notice */}
        {!isAdmin && (
          <p className="muted small" style={{ marginTop: 0, marginBottom: 12 }}>
            You have read-only access. Linking/creating guardians is disabled.
          </p>
        )}

        {/* Tabs */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              aria-pressed={tab === "find"}
              onClick={() => setTab("find")}
              style={tab === "find" ? {} : inactiveTabBtnStyle}
            >
              Find existing
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={tab === "create"}
              onClick={() => setTab("create")}
              style={tab === "create" ? {} : inactiveTabBtnStyle}
            >
              Create new
            </button>
          </div>

          {/* Error banner */}
          {err && (
            <div
              className="small"
              role="alert"
              style={{
                marginTop: 12,
                marginBottom: 8,
                background: "rgba(239,68,68,.12)",
                border: "1px solid rgba(239,68,68,.3)",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              {err}
            </div>
          )}

          {/* Content */}
          <div style={{ marginTop: 12 }}>
            {tab === "find" ? (
              <FindTab
                q={q}
                setQ={setQ}
                searching={searching}
                results={results}
                linkedIds={linkedIds}
                isAdmin={isAdmin}
                isPrimary={isPrimary}
                setIsPrimary={setIsPrimary}
                linkBusy={linkBusy}
                unlinkBusy={unlinkBusy}          // NEW
                onLink={handleLink}
                onUnlink={handleUnlink}          // NEW
                linkedList={linkedList}
              />
            ) : (
              <CreateTab
                nf={nf}
                setNf={setNf}
                creating={creating}
                disabled={!isAdmin}
                onCreate={handleCreate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FindTab({
  q, setQ, searching, results, linkedIds, isAdmin,
  isPrimary, setIsPrimary, linkBusy, unlinkBusy, onLink, onUnlink, linkedList,
}) {
  return (
    <>
      {/* Quick view: already-linked */}
      <section className="muted small" style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Linked now ({linkedList.length})
        </div>

        {linkedList.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {linkedList.map((g) => (
              <div
                key={g.id}
                className="tag"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span>{fmtGuardianName(g)}</span>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-outline small"
                    style={{ padding: "2px 6px" }}
                    disabled={!!unlinkBusy[g.id]}
                    aria-disabled={!!unlinkBusy[g.id]}
                    onClick={() => onUnlink(g.id)}
                    title="Unlink guardian from this student"
                  >
                    {unlinkBusy[g.id] ? "…" : "Unlink"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          "—"
        )}
      </section>

      <div className="form">
        <div className="form-row" style={{ alignItems: "end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="small muted" htmlFor="gsearch">Search guardians</label>
            <input
              id="gsearch"
              className="input"
              type="text"
              placeholder="Name, phone, or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="small muted" htmlFor="primary">
              Mark as primary
            </label>
            <div>
              <input
                id="primary"
                type="checkbox"
                checked={!!isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
              />{" "}
              <span className="small">Primary</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>
          {searching ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="responsive-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Guardian</th>
                <th style={{ textAlign: "left" }}>Phone / Email</th>
                <th style={{ textAlign: "left" }}>Relationship</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((g) => {
                const already = linkedIds.has(g.id);
                return (
                  <tr key={g.id}>
                    <td data-label="Guardian">
                      <div style={{ fontWeight: 600 }}>{fmtGuardianName(g)}</div>
                      <div className="muted small">ID: {g.id}</div>
                    </td>
                    <td data-label="Phone / Email">
                      <div>{g.phone_e164 || g.phone || g.phone_raw || "—"}</div>
                      <div className="muted small">{g.email || "—"}</div>
                    </td>
                    <td data-label="Relationship">
                      <span className="tag">
                        {g.relationship || g.relationship_type || "GUARDIAN"}
                      </span>
                    </td>
                    <td data-label="Action" style={{ textAlign: "right" }}>
                      {already ? (
                        <span className="muted small">Linked</span>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          disabled={!isAdmin || !!linkBusy[g.id]}
                          onClick={() => onLink(g.id, isPrimary)}
                          aria-disabled={!isAdmin || !!linkBusy[g.id]}
                        >
                          {linkBusy[g.id] ? "Linking…" : "Link"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {results.length === 0 && !searching && (
                <tr>
                  <td colSpan={4}>
                    <div className="muted" style={{ padding: 8 }}>No matches.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CreateTab({ nf, setNf, creating, disabled, onCreate }) {
  function set(field, v) { setNf((p) => ({ ...p, [field]: v })); }
  const canSave = nf.firstName.trim() && nf.lastName.trim() && nf.phone.trim();

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSave && !disabled) onCreate(); }}>
      <div className="form">
        <div className="form-row">
          <div>
            <label className="small muted" htmlFor="nf_first">First name</label>
            <input
              id="nf_first"
              className="input"
              value={nf.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              placeholder="e.g., Alex"
              required
            />
          </div>
          <div>
            <label className="small muted" htmlFor="nf_last">Last name</label>
            <input
              id="nf_last"
              className="input"
              value={nf.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              placeholder="e.g., Nguyen"
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label className="small muted" htmlFor="nf_phone">Phone</label>
            <input
              id="nf_phone"
              className="input"
              value={nf.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="e.g., 0412 345 678"
              required
            />
          </div>
          <div>
            <label className="small muted" htmlFor="nf_email">Email (optional)</label>
            <input
              id="nf_email"
              className="input"
              type="email"
              value={nf.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="e.g., alex@example.com"
            />
          </div>
        </div>

        <div className="form-row" style={{ alignItems: "end" }}>
          <div>
            <label className="small muted" htmlFor="nf_rel">Relationship</label>
            <input
              id="nf_rel"
              className="input"
              value={nf.relationship}
              onChange={(e) => set("relationship", e.target.value)}
              placeholder="e.g., Mother / Father / Guardian"
            />
          </div>
          <div>
            <label className="small muted" htmlFor="nf_primary">Primary</label>
            <div>
              <input
                id="nf_primary"
                type="checkbox"
                checked={!!nf.primary}
                onChange={(e) => set("primary", e.target.checked)}
              />{" "}
              <span className="small">Mark as primary</span>
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 10 }}>
          <span className="muted small">Fields marked required must be filled.</span>
          <span className="spacer" />
          <button
            type="submit"
            className="btn"
            disabled={disabled || creating || !canSave}
            aria-disabled={disabled || creating || !canSave}
          >
            {creating ? "Creating…" : "Create & Link"}
          </button>
        </div>
      </div>
    </form>
  );
}

/* ------------ helpers & styles ------------ */

function fmtGuardianName(g) {
  const name = g.name?.trim();
  if (name) return name;
  const f = g.first_name || g.firstName || "";
  const l = g.last_name || g.lastName || "";
  const n = `${f} ${l}`.trim();
  return n || "—";
}

function useIsWide(bp = 900) {
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(`(min-width:${bp}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(min-width:${bp}px)`);
    const handler = (e) => setWide(e.matches);
    try { mql.addEventListener("change", handler); } catch { mql.addListener(handler); }
    return () => {
      try { mql.removeEventListener("change", handler); } catch { mql.removeListener(handler); }
    };
  }, [bp]);
  return wide;
}

const inactiveTabBtnStyle = {
  background: "transparent",
  color: "var(--text)",
  borderColor: "var(--border)",
};

const overlayMobile = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "flex-end", // bottom sheet
  justifyContent: "center",
  zIndex: 1000,
};

const panelMobile = {
  background: "var(--card)",
  color: "var(--text)",
  width: "100%",
  maxWidth: 720,
  maxHeight: "90vh",
  overflow: "auto",
  borderTopLeftRadius: 12,
  borderTopRightRadius: 12,
  padding: 12,
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  margin: "0 8px 8px",
};

const overlayDesktop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "flex-end", // right drawer
  zIndex: 1000,
};

const panelDesktop = {
  background: "var(--card)",
  color: "var(--text)",
  width: 480,
  height: "100%",
  maxHeight: "100%",
  overflow: "auto",
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  padding: 12,
  boxShadow: "0 0 30px rgba(0,0,0,.35)",
};