// src/pages/Students.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom"; // CHANGE: add useNavigate
import {
  getStudents,
  getGuardiansByStudent,
  updateStudent,
  deleteStudent,
  generateQRCodes,
  getQrPng,
  cleanupQrImages,
} from "../services/api";
import { getRole, addAuthStorageListener } from "../services/auth";
import ManageGuardians from "../components/ManageGuardians"; // NEW: drawer/panel component

export default function Students() {
  // role
  const [role, setRole] = useState(() => getRole());
  const isStaff = role === "STAFF";
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);

  // data
  const [items, setItems] = useState([]);
  const [guardians, setGuardians] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [guardianQ, setGuardianQ] = useState("");
  const [hasGuard, setHasGuard] = useState("");
  const [leaveAlone, setLeaveAlone] = useState("");

  // CHANGE: id filter parsed from URL (?id= or ?ids=)
  const [idFilter, setIdFilter] = useState([]); // array<number>
  const idSet = useMemo(() => new Set(idFilter.map(n => String(n))), [idFilter]);

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // inline editing
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  // deleting
  const [deletingId, setDeletingId] = useState(null);

  // qr ops
  const [qrBusyId, setQrBusyId] = useState(null);

  // Manage Guardians panel state
  const [mgStudent, setMgStudent] = useState(null); // { id, ... } or null
  const lastTriggerRef = useRef(null); // restores focus to the “Guardians” button on close

  const lastLoadRef = useRef(0);
  const location = useLocation();
  const navigate = useNavigate(); // CHANGE

  // read ?q= from URL to prefill search (for deep-linking from Guardians page)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qp = params.get("q");
    if (qp !== null && qp !== q) setQ(qp);
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // CHANGE: read ?id= / ?ids= from URL to focus on exact student(s)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const one = params.get("id");
    const many = params.get("ids");
    const next = [];

    if (one != null && one !== "") {
      const n = Number(one);
      if (Number.isFinite(n) && n > 0) next.push(n);
    }
    if (many != null && many !== "") {
      for (const part of many.split(",")) {
        const n = Number(part.trim());
        if (Number.isFinite(n) && n > 0) next.push(n);
      }
    }

    // only update if changed
    const sameLen = next.length === idFilter.length;
    const sameVals = sameLen && next.every(n => idFilter.includes(n));
    if (!sameVals) {
      setIdFilter(next);
      setPage(1); // ensure visible
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  async function load() {
    setErr("");
    setLoading(true);
    const stamp = Date.now();
    lastLoadRef.current = stamp;
    try {
      const data = await getStudents(500, 0, q.trim(), status || "");
      const rows = Array.isArray(data) ? data : (data?.items || []);
      if (lastLoadRef.current === stamp) {
        setItems(rows);
        setPage(1);
      }
    } catch (e) {
      if (lastLoadRef.current === stamp) setErr(e?.message || "Failed to load students");
    } finally {
      if (lastLoadRef.current === stamp) setLoading(false);
    }
  }
  useEffect(() => { load(); }, [q, status]);

  // filtering
  const filtered = useMemo(() => {
    const qlc = q.trim().toLowerCase();
    const gq = guardianQ.trim().toLowerCase();

    return items.filter((s) => {
      // CHANGE: apply exact ID filter first (if present)
      if (idSet.size && !idSet.has(String(s.id))) return false;

      if (status && String(s.status || "").toUpperCase() !== status) return false;

      if (qlc) {
        const first = (s.first_name || s.firstName || "").toLowerCase();
        const last  = (s.last_name  || s.lastName  || "").toLowerCase();
        const exid  = (s.external_id || s.externalId || "").toLowerCase();
        const name  = [first, last].filter(Boolean).join(" ").trim();
        if (!name.includes(qlc) && !exid.includes(qlc)) return false;
      }

      if (leaveAlone) {
        const val = !!(s.can_leave_alone ?? s.canLeaveAlone);
        if (leaveAlone === "yes" && !val) return false;
        if (leaveAlone === "no"  &&  val) return false;
      }

      const list = guardians[s.id];
      if (hasGuard) {
        const present = Array.isArray(list) && list.length > 0;
        if (hasGuard === "yes" && !present) return false;
        if (hasGuard === "no"  &&  present) return false;
      }
      if (gq) {
        if (!Array.isArray(list)) return false;
        const matches = list.some(g => {
          const name = (g.name || `${g.first_name || ""} ${g.last_name || ""}`).toLowerCase();
          const phone = (g.phone_e164 || g.phone || g.phone_raw || "").toLowerCase();
          return name.includes(gq) || phone.includes(gq);
        });
        if (!matches) return false;
      }
      return true;
    });
  }, [items, guardians, q, status, guardianQ, hasGuard, leaveAlone, idSet]); // CHANGE: include idSet

  // pagination
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // prefetch guardians when filter requires them
  useEffect(() => {
    const needGuardianFilter = guardianQ.trim() || hasGuard;
    if (!needGuardianFilter) return;

    const ids = paged.map(s => s.id).filter(Boolean);
    const toFetch = ids.filter(id => !guardians[id]);
    if (!toFetch.length) return;

    let alive = true;
    (async () => {
      try {
        const updates = {};
        await Promise.all(toFetch.map(async (sid) => {
          const g = await getGuardiansByStudent(sid);
          updates[sid] = Array.isArray(g) ? g : (g?.items || []);
        }));
        if (alive) setGuardians(prev => ({ ...prev, ...updates }));
      } catch {}
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianQ, hasGuard, page, pageSize, items]);

  // prefetch guardians for visible page
  useEffect(() => {
    let on = true;
    const toFetch = paged.map(s => s.id).filter(id => !guardians[id]);
    if (!toFetch.length) return;
    (async () => {
      try {
        const updates = {};
        await Promise.all(toFetch.map(async (sid) => {
          const g = await getGuardiansByStudent(sid);
          updates[sid] = Array.isArray(g) ? g : (g?.items || []);
        }));
        if (on) setGuardians(prev => ({ ...prev, ...updates }));
      } catch {}
    })();
    return () => { on = false; };
  }, [paged, guardians]);

  // helpers
  function fmtName(s) {
    const f = s.first_name || s.firstName || "";
    const l = s.last_name || s.lastName || "";
    return (f + " " + l).trim() || "—";
  }
  function fmtStatus(s) {
    const v = String(s.status || "").toUpperCase();
    return v || "—";
  }
  function fmtDateISO(d) {
    if (!d) return "";
    const date = typeof d === "string" ? new Date(d) : d;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const da = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function fmtDateTime(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const activeFilters = !!(q || status || guardianQ || hasGuard || leaveAlone || idFilter.length); // CHANGE

  function clearFilters() {
    setQ(""); setStatus(""); setGuardianQ(""); setHasGuard(""); setLeaveAlone("");
    setIdFilter([]); // CHANGE
    // CHANGE: also clear URL query (removes ?id, ?ids, ?q)
    if (location.search) {
      navigate({ pathname: location.pathname }, { replace: true });
    }
  }

  // editing handlers (disabled for STAFF)
  function beginEdit(s) {
    if (isStaff || saving) return; // Staff cannot edit
    setEditingId(s.id);
    setDraft({
      externalId: s.external_id ?? s.externalId ?? "",
      firstName: s.first_name ?? s.firstName ?? "",
      lastName:  s.last_name  ?? s.lastName  ?? "",
      dob: fmtDateISO(s.dob),
      status: (s.status || "ACTIVE").toUpperCase(),
      canLeaveAlone: !!(s.can_leave_alone ?? s.canLeaveAlone),
      notes: s.notes ?? "",
    });
  }
  function updateDraftField(field, value) {
    setDraft(prev => ({ ...prev, [field]: value }));
  }
  function cancelEdit() {
    if (saving) return;
    setEditingId(null);
    setDraft(null);
  }
  async function saveEdit(id) {
    if (isStaff) {
      setErr("You do not have permission to edit students.");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        externalId: draft.externalId?.trim() || null,
        firstName: draft.firstName?.trim(),
        lastName: draft.lastName?.trim(),
        dob: draft.dob || null,
        status: draft.status,
        canLeaveAlone: !!draft.canLeaveAlone,
        notes: draft.notes?.trim() || null,
      };
      const updated = await updateStudent(id, payload);
      const merged = Array.isArray(updated) ? updated[0] : (updated?.item || updated || {});
      setItems(prev => prev.map(s => (s.id === id ? { ...s, ...merged } : s)));
      setEditingId(null);
      setDraft(null);
      setErr("");
    } catch (e) {
      setErr(e?.message || "Failed to update student");
    } finally {
      setSaving(false);
    }
  }

  // delete handler (disabled for STAFF)
  async function handleDelete(s) {
    if (isStaff) {
      setErr("You do not have permission to delete students.");
      return;
    }
    if (deletingId) return;
    // Try to show how many guardians this student currently has (optional)
    let gCount = guardians[s.id]?.length;
    if (typeof gCount !== "number") {
      try {
        const g = await getGuardiansByStudent(s.id);
        const arr = Array.isArray(g) ? g : (g?.items || []);
        gCount = arr.length;
        setGuardians(prev => ({ ...prev, [s.id]: arr }));
      } catch {
        gCount = undefined;
      }
    }
    const confirmMsg =
      `Delete "${fmtName(s)}"?\n\n` +
      `Guardians not linked to any other students will also be deleted.` +
      (typeof gCount === "number" ? `\n(Currently ${gCount} guardian${gCount === 1 ? "" : "s"} linked)` : "");
    if (!window.confirm(confirmMsg)) return;

    setDeletingId(s.id);
    setErr("");
    try {
      await deleteStudent(s.id);
      setItems(prev => prev.filter(x => x.id !== s.id));
      const { [s.id]: _removed, ...rest } = guardians;
      setGuardians(rest);
    } catch (e) {
      setErr(e?.message || "Failed to delete student");
    } finally {
      setDeletingId(null);
    }
  }

  // QR regenerate → download → cleanup (disabled for STAFF)
  async function handleQrCycle(studentId) {
    if (isStaff) {
      setErr("You do not have permission to regenerate QR codes.");
      return;
    }
    if (qrBusyId) return;
    setErr("");
    setQrBusyId(studentId);
    try {
      await generateQRCodes([studentId]);
      const blob = await getQrPng(studentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qr_${studentId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await cleanupQrImages([studentId]);
    } catch (e) {
      setErr(e?.message || "Failed to regenerate/download/cleanup QR");
    } finally {
      setQrBusyId(null);
    }
  }

  // guardians cache updater passed to the panel
  function setGuardiansFor(studentId, nextList) {
    setGuardians(prev => ({ ...prev, [studentId]: Array.isArray(nextList) ? nextList : [] }));
  }

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Students</h1>
        {isStaff && (
          <p className="muted small" style={{ margin: "6px 0 0" }} title="Read-only access">
            Read-only
          </p>
        )}
      </header>

      {/* Filters */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="form" role="search" aria-label="Filter students">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="q">Search (name or external ID)</label>
              <input
                id="q"
                className="input"
                type="text"
                placeholder="e.g., Alex or EXT123"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="small muted" htmlFor="status">Status</label>
              <select
                id="status"
                className="input"
                value={status}
                onChange={e => setStatus(e.target.value)}
              >
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="leaveAlone">Can leave alone</label>
              <select
                id="leaveAlone"
                className="input"
                value={leaveAlone}
                onChange={e => setLeaveAlone(e.target.value)}
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="guardianQ">Guardian contains</label>
              <input
                id="guardianQ"
                className="input"
                type="text"
                placeholder="Name or phone"
                value={guardianQ}
                onChange={e => setGuardianQ(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="hasGuard">Has guardians</label>
              <select
                id="hasGuard"
                className="input"
                value={hasGuard}
                onChange={e => setHasGuard(e.target.value)}
              >
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="pageSize">Page size</label>
              <select
                id="pageSize"
                className="input"
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 4 }}>
            <span className="muted small">{activeFilters ? "" : "No active filters"}</span>
            <span className="spacer" />
            {activeFilters && (
              <button type="button" className="btn btn-outline small" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Table */}
      <div className="card" role="region" aria-label="Students table">
        <div className="muted small" style={{ marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
        </div>

        {!loading && !paged.length && (
          <div className="muted" style={{ padding: 12 }} role="status">
            No students match the current filters.
          </div>
        )}

        {err && (
          <div
            className="small"
            style={{
              marginBottom: 8,
              background: "rgba(239,68,68,.12)",
              border: "1px solid rgba(239,68,68,.3)",
              borderRadius: 10,
              padding: "8px 10px"
            }}
            role="alert"
          >
            {err}
          </div>
        )}

        {!loading && paged.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="responsive-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Student</th>
                  <th style={{ textAlign: "left" }}>Guardian (Full name)</th>
                  <th style={{ textAlign: "left" }}>External ID</th>
                  <th style={{ textAlign: "left" }}>DOB</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                  <th style={{ textAlign: "left" }}>Can Leave Alone</th>
                  <th style={{ textAlign: "left" }}>Notes</th>
                  <th style={{ textAlign: "left" }}>Created / Updated</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(s => {
                  const isEditing = editingId === s.id && !isStaff;
                  const list = guardians[s.id];
                  const extId = s.external_id || s.externalId || "";
                  const statusVal = fmtStatus(s);
                  const canLeave = !!(s.can_leave_alone ?? s.canLeaveAlone);
                  const createdAt = s.created_at || s.createdAt;
                  const updatedAt = s.updated_at || s.updatedAt;

                  return (
                    <tr key={s.id}>
                      {/* STUDENT (first + last) */}
                      <td data-label="Student">
                        {isEditing ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                            <input
                              className="input"
                              placeholder="First name"
                              value={draft.firstName}
                              onChange={e => updateDraftField("firstName", e.target.value)}
                            />
                            <input
                              className="input"
                              placeholder="Last name"
                              value={draft.lastName}
                              onChange={e => updateDraftField("lastName", e.target.value)}
                            />
                            <div className="muted small" style={{ gridColumn: "span 2" }}>ID: {s.id}</div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700 }}>{fmtName(s)}</div>
                            <div className="muted small">ID: {s.id}</div>
                          </>
                        )}
                      </td>

                      {/* GUARDIAN (full name) */}
                      <td data-label="Guardian (Full name)">
                        {Array.isArray(list) && list.length ? (
                          <div>
                            {list.map((g, idx) => {
                              const name = (g.name || `${g.first_name || ""} ${g.last_name || ""}`).trim() || "—";
                              return (
                                <span key={g.id || idx}>
                                  {/* CHANGE: link to exact guardian by id */}
                                  <Link
                                    to={`/guardians?id=${g.id}`}
                                    style={{ cursor: "pointer", textDecoration: "underline", color: "darkblue" }}
                                    title="View this guardian"
                                  >
                                    {name}
                                  </Link>
                                  {idx < list.length - 1 ? <span>, </span> : null}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <>
                            {"—"}
                            {!Array.isArray(list) && (
                              <div>
                                <button
                                  type="button"
                                  className="btn btn-outline small"
                                  onClick={async () => {
                                    try {
                                      const g = await getGuardiansByStudent(s.id);
                                      const arr = Array.isArray(g) ? g : (g?.items || []);
                                      setGuardians(prev => ({ ...prev, [s.id]: arr }));
                                    } catch {}
                                  }}
                                >
                                  Load
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* EXTERNAL ID */}
                      <td data-label="External ID">
                        {isEditing ? (
                          <input
                            className="input"
                            value={draft.externalId}
                            onChange={e => updateDraftField("externalId", e.target.value)}
                          />
                        ) : (
                          extId || <span className="muted">—</span>
                        )}
                      </td>

                      {/* DOB */}
                      <td data-label="DOB">
                        {isEditing ? (
                          <input
                            type="date"
                            className="input"
                            value={draft.dob || ""}
                            onChange={e => updateDraftField("dob", e.target.value)}
                          />
                        ) : (
                          (s.dob ? fmtDateISO(s.dob) : <span className="muted">—</span>)
                        )}
                      </td>

                      {/* STATUS */}
                      <td data-label="Status">
                        {isEditing ? (
                          <select
                            className="input"
                            value={draft.status}
                            onChange={e => updateDraftField("status", e.target.value)}
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                        ) : (
                          <span className="tag">{statusVal}</span>
                        )}
                      </td>

                      {/* CAN LEAVE ALONE */}
                      <td data-label="Can Leave Alone">
                        {isEditing ? (
                          <label className="label small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!draft.canLeaveAlone}
                              onChange={e => updateDraftField("canLeaveAlone", e.target.checked)}
                            />
                            Yes
                          </label>
                        ) : (
                          canLeave ? <span className="tag">Yes</span> : <span className="tag">No</span>
                        )}
                      </td>

                      {/* NOTES */}
                      <td data-label="Notes">
                        {isEditing ? (
                          <input
                            className="input"
                            placeholder="Notes"
                            value={draft.notes}
                            onChange={e => updateDraftField("notes", e.target.value)}
                          />
                        ) : (
                          s.notes ? <span title={s.notes}>{s.notes}</span> : <span className="muted">—</span>
                        )}
                      </td>

                      {/* CREATED / UPDATED (read-only) */}
                      <td data-label="Created / Updated">
                        <div className="muted small">
                          <div>Created: {fmtDateTime(createdAt)}</div>
                          <div>Updated: {fmtDateTime(updatedAt)}</div>
                        </div>
                      </td>

                      {/* ACTIONS */}
                      <td data-label="Actions" style={{ textAlign: "right" }}>
                        {isStaff ? (
                          <span className="muted small">View only</span>
                        ) : isEditing ? (
                          <div className="actions" style={{ justifyContent: "flex-end" }}>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => saveEdit(s.id)}
                              disabled={saving || !draft.firstName?.trim() || !draft.lastName?.trim()}
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button className="btn btn-outline" type="button" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
                            {/* NEW: Manage Guardians (Admin only) */}
                            <button
                              className="btn btn-outline"
                              type="button"
                              onClick={(e) => { lastTriggerRef.current = e.currentTarget; setMgStudent(s); }}
                              title="Add/link guardians for this student"
                            >
                              Guardians
                            </button>

                            <button className="btn btn-outline" type="button" onClick={() => beginEdit(s)}>
                              Edit
                            </button>
                            <button
                              className="btn btn-outline"
                              type="button"
                              onClick={() => handleQrCycle(s.id)}
                              disabled={qrBusyId === s.id}
                              aria-disabled={qrBusyId === s.id}
                              title="Regenerate QR, download PNG, then delete from GitHub"
                            >
                              {qrBusyId === s.id ? "QR…" : "QR ↻⇣✖"}
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => handleDelete(s)}
                              disabled={deletingId === s.id}
                              aria-disabled={deletingId === s.id}
                              title="Delete student (and any guardians not linked to other students)"
                            >
                              {deletingId === s.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="actions" style={{ marginTop: 12, flexWrap: "wrap", rowGap: 8 }}>
          <span className="muted small">
            Page {page} of {totalPages} · {filtered.length} total
          </span>
          <span className="spacer" />
          <PageBtn label="« First" onClick={() => setPage(1)} disabled={!canPrev} />
          <PageBtn label="‹ Prev" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!canPrev} />
          <PageBtn label="Next ›" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={!canNext} />
          <PageBtn label="Last »" onClick={() => setPage(totalPages)} disabled={!canNext} />
        </div>
      </div>

      {/* Manage Guardians Drawer (renders at document end so it overlays nicely on mobile) */}
      {mgStudent && (
        <ManageGuardians
          student={mgStudent}
          guardians={guardians[mgStudent.id] || []}
          onChange={(nextList) => setGuardiansFor(mgStudent.id, nextList)}
          onClose={() => {
            setMgStudent(null);
            // restore focus to the trigger button for accessibility
            if (lastTriggerRef.current && typeof lastTriggerRef.current.focus === "function") {
              lastTriggerRef.current.focus();
            }
          }}
        />
      )}
    </>
  );
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