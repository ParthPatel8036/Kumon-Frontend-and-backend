// src/pages/Users.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import * as api from "../services/api"; // getUsers/createUser/updateUser/deleteUser
import { getRole, addAuthStorageListener } from "../services/auth"; // ⟵ RBAC helpers

export default function Users() {
  // RBAC: Admin only
  const [authRole, setAuthRole] = useState(() => getRole());
  const isAdmin = authRole === "ADMIN";
  const loc = useLocation();
  useEffect(() => {
    const unsub = addAuthStorageListener(setAuthRole);
    return unsub;
  }, []);
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace state={{ denied: loc.pathname }} />;
  }

  // data
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filters (note: this 'role' is a filter, not the auth role above)
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // editing
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // create new
  const [newOpen, setNewOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "STAFF", active: true });
  const [creating, setCreating] = useState(false);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const data = await api.getUsers?.(300, 0);
      const rows = Array.isArray(data) ? data : (data?.items || []);
      setItems(rows.map(normalize));
      setPage(1);
    } catch (e) {
      setErr(e?.message || "Failed to load users");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const data = await api.getUsers?.(300, 0);
        const rows = Array.isArray(data) ? data : (data?.items || []);
        if (on) setItems(rows.map(normalize));
      } catch (e) {
        if (on) setErr(e?.message || "Failed to load users");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  useEffect(() => { setPage(1); }, [q, role, active, pageSize]);

  const filtered = useMemo(() => {
    const qlc = q.trim().toLowerCase();
    return items.filter(u => {
      if (role && String(u.role).toUpperCase() !== role) return false;
      if (active) {
        const want = active === "yes";
        if (!!u.active !== want) return false;
      }
      if (qlc) {
        const hay = [u.email, u.role, fmtDate(u.lastLoginAt), fmtDate(u.createdAt)].join(" ").toLowerCase();
        if (!hay.includes(qlc)) return false;
      }
      return true;
    });
  }, [items, q, role, active]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // actions
  function startEdit(u) {
    setEditingId(u.id);
    setDraft({ ...u, password: "" });
    setErr("");
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setErr("");
  }
  async function saveEdit() {
    if (!editingId || !draft || saving) return;
    setSaving(true);
    setErr("");
    try {
      const payload = {
        email: (draft.email || "").trim(),
        role: String(draft.role || "STAFF").toUpperCase(),
        active: !!draft.active,
        ...(draft.password ? { password: draft.password } : {})
      };
      const updated = await api.updateUser?.(editingId, payload);
      const clean = normalize(updated?.item || updated || payload);
      setItems(prev => prev.map(x => (x.id === editingId ? { ...x, ...clean } : x)));
      setEditingId(null);
      setDraft(null);
    } catch (e) {
      setErr(e?.message || "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u) {
    if (deletingId) return;
    const msg = `Delete user "${u.email}"?\n\nThis will remove their account and access.`;
    if (!window.confirm(msg)) return;

    setDeletingId(u.id);
    setErr("");
    try {
      await api.deleteUser?.(u.id);
      setItems(prev => prev.filter(x => x.id !== u.id));
      if (editingId === u.id) cancelEdit();
    } catch (e) {
      setErr(e?.message || "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (creating) return;
    setCreating(true);
    setErr("");
    try {
      const payload = {
        email: (newUser.email || "").trim(),
        password: newUser.password || "",
        role: String(newUser.role || "STAFF").toUpperCase(),
        active: !!newUser.active,
      };
      const created = await api.createUser?.(payload);
      const clean = normalize(created?.item || created || payload);
      setItems(prev => [clean, ...prev]);
      setNewUser({ email: "", password: "", role: "STAFF", active: true });
      setNewOpen(false);
      setPage(1);
    } catch (e) {
      setErr(e?.message || "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Users</h1>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Create, update, deactivate, or delete dashboard users.
        </p>
      </header>

      {/* Actions */}
      <div className="actions" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={() => setNewOpen(v => !v)}
          aria-expanded={newOpen}
        >
          {newOpen ? "Close" : "Add New User"}
        </button>

        <span className="spacer" />

        <button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Create new */}
      {newOpen && (
        <section className="card" aria-label="Create new user" style={{ marginBottom: 12 }}>
          <form className="form" onSubmit={handleCreate}>
            <div className="form-row">
              <div>
                <label className="small muted" htmlFor="new-email">Email</label>
                <input
                  id="new-email"
                  className="input"
                  type="email"
                  placeholder="user@example.com"
                  value={newUser.email}
                  onChange={e => setNewUser(v => ({ ...v, email: e.target.value }))}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="small muted" htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  className="input"
                  value={newUser.role}
                  onChange={e => setNewUser(v => ({ ...v, role: e.target.value }))}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="STAFF">STAFF</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div>
                <label className="small muted" htmlFor="new-password">Password</label>
                <input
                  id="new-password"
                  className="input"
                  type="password"
                  placeholder="Set password"
                  value={newUser.password}
                  onChange={e => setNewUser(v => ({ ...v, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="small muted" htmlFor="new-active">Active</label>
                <select
                  id="new-active"
                  className="input"
                  value={newUser.active ? "yes" : "no"}
                  onChange={e => setNewUser(v => ({ ...v, active: e.target.value === "yes" }))}
                >
                  <option value="yes">Yes (can sign in)</option>
                  <option value="no">No (disabled)</option>
                </select>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 4 }}>
              <button type="submit" className="btn" disabled={creating}>
                {creating ? "Creating…" : "Create User"}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setNewOpen(false)} disabled={creating}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filters */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="form" role="search" aria-label="Filter users">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="q">Search</label>
              <input
                id="q"
                className="input"
                placeholder="Email, role, date…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="small muted" htmlFor="role">Role</label>
              <select id="role" className="input" value={role} onChange={e => setRole(e.target.value)}>
                <option value="">All</option>
                <option value="ADMIN">ADMIN</option>
                <option value="STAFF">STAFF</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="active">Active</label>
              <select id="active" className="input" value={active} onChange={e => setActive(e.target.value)}>
                <option value="">All</option>
                <option value="yes">Active only</option>
                <option value="no">Inactive only</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="pageSize">Page size</label>
              <select id="pageSize" className="input" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Table */}
      <div className="card" role="region" aria-label="Users table">
        <div className="muted small" style={{ marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} user${filtered.length === 1 ? "" : "s"}`}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="responsive-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: "28%" }}>Email</th>
                <th style={{ textAlign: "left", width: "12%" }}>Role</th>
                <th style={{ textAlign: "left", width: "8%" }}>Active</th>
                <th style={{ textAlign: "left", width: "18%" }}>Last Login</th>
                <th style={{ textAlign: "left", width: "18%" }}>Created</th>
                <th style={{ textAlign: "left", width: "18%" }}>Updated</th>
                <th style={{ textAlign: "right", width: "18%" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && paged.length === 0 && (
                <tr><td colSpan={7} className="muted">No users match your filters.</td></tr>
              )}
              {paged.map(u => (
                <tr key={u.id}>
                  <td data-label="Email">
                    {editingId === u.id ? (
                      <input
                        className="input"
                        type="email"
                        value={draft?.email || ""}
                        onChange={e => setDraft(v => ({ ...v, email: e.target.value }))}
                      />
                    ) : (
                      <span>{u.email}</span>
                    )}
                  </td>
                  <td data-label="Role">
                    {editingId === u.id ? (
                      <select
                        className="input"
                        value={draft?.role || "STAFF"}
                        onChange={e => setDraft(v => ({ ...v, role: e.target.value }))}
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="STAFF">STAFF</option>
                      </select>
                    ) : (
                      <span className="small" style={{ fontWeight: 600 }}>{u.role}</span>
                    )}
                  </td>
                  <td data-label="Active">
                    {editingId === u.id ? (
                      <select
                        className="input"
                        value={draft?.active ? "yes" : "no"}
                        onChange={e => setDraft(v => ({ ...v, active: e.target.value === "yes" }))}
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    ) : (
                      <span>{u.active ? "Yes" : "No"}</span>
                    )}
                  </td>
                  <td data-label="Last Login">{fmtDate(u.lastLoginAt) || "—"}</td>
                  <td data-label="Created">{fmtDate(u.createdAt)}</td>
                  <td data-label="Updated">{fmtDate(u.updatedAt)}</td>
                  <td data-label="Actions" style={{ textAlign: "right" }}>
                    {editingId === u.id ? (
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <input
                          className="input"
                          type="password"
                          placeholder="Set new password (optional)"
                          value={draft?.password || ""}
                          onChange={e => setDraft(v => ({ ...v, password: e.target.value }))}
                          style={{ maxWidth: 220 }}
                        />
                        <button type="button" className="btn" onClick={saveEdit} disabled={saving}>
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="btn btn-outline" onClick={cancelEdit} disabled={saving}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-outline" onClick={() => startEdit(u)} disabled={deletingId === u.id}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => handleDelete(u)}
                          disabled={deletingId === u.id}
                          aria-busy={deletingId === u.id || undefined}
                        >
                          {deletingId === u.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="actions" style={{ marginTop: 12 }}>
          <span className="muted small">
            Page {page} of {Math.max(1, Math.ceil(filtered.length / pageSize))}
          </span>
          <span className="spacer" />
          <PageBtn label="‹ Prev" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} />
          <PageBtn label="Next ›" onClick={() => setPage(p => (page * pageSize < filtered.length ? p + 1 : p))} disabled={page * pageSize >= filtered.length} />
        </div>
      </div>

      {/* error */}
      {err && (
        <div className="small" style={{
          marginTop: 12,
          background: "rgba(239,68,68,.12)",
          border: "1px solid rgba(239,68,68,.3)",
          borderRadius: 10,
          padding: "8px 10px"
        }}>
          {err}
        </div>
      )}
    </>
  );
}

/* ---------- helpers ---------- */

function normalize(u) {
  if (!u) return { id: null, email: "", role: "STAFF", active: false, lastLoginAt: null, createdAt: null, updatedAt: null };
  return {
    id: u.id ?? u.user_id ?? null,
    email: u.email ?? "",
    role: String(u.role ?? "STAFF").toUpperCase(),
    active: !!(u.active ?? true),
    lastLoginAt: u.last_login_at ?? u.lastLoginAt ?? null,
    createdAt: u.created_at ?? u.createdAt ?? null,
    updatedAt: u.updated_at ?? u.updatedAt ?? null,
  };
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(+d) ? String(v) : d.toLocaleString();
}

function PageBtn({ label, onClick, disabled, active }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      style={{
        padding: "6px 10px",
        minWidth: 36,
        ...(active ? {} : { background: "transparent", color: "var(--text)", borderColor: "var(--border)" }),
      }}
    >
      {label}
    </button>
  );
}