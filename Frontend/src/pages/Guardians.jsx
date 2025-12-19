// src/pages/Guardians.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom"; // CHANGE: add useNavigate
import * as api from "../services/api";
import { getRole, addAuthStorageListener } from "../services/auth";
import CreateGuardianModal from "../components/CreateGuardianModal"; // NEW

export default function Guardians() {
  // role (read-only for STAFF)
  const [role, setRole] = useState(() => getRole());
  const isStaff = role === "STAFF";
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);

  // data
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // students resolved per guardian (lazy or prefetch)
  const [students, setStudents] = useState({});               // { [guardianId]: Student[] }
  const [studentsLoading, setStudentsLoading] = useState({}); // { [guardianId]: boolean }
  const [studentsError, setStudentsError] = useState({});     // { [guardianId]: string }

  // filters (server-side)
  const [q, setQ] = useState("");
  const [relationship, setRelationship] = useState("");
  const [active, setActive] = useState("");         // "" | "yes" | "no"
  const [phoneValid, setPhoneValid] = useState(""); // "" | "yes" | "no"

  // filters (client-side on resolved students)
  const [studentQ, setStudentQ] = useState("");
  const [hasStudents, setHasStudents] = useState(""); // "" | "yes" | "no"

  // CHANGE: id filter parsed from URL (?id= or ?ids=)
  const [idFilter, setIdFilter] = useState([]); // number[]
  // Store as strings for robust matching regardless of backend type
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

  const lastLoadRef = useRef(0);
  const location = useLocation();
  const navigate = useNavigate(); // CHANGE

  // NEW: create-guardian modal
  const [showCreate, setShowCreate] = useState(false); // NEW

  // read ?name= to prefill the main "Search" filter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qp = params.get("name");
    if (qp !== null && qp !== q) setQ(qp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // CHANGE: read ?id= / ?ids= to focus on exact guardian(s)
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
      const data = await api.getGuardians(1000000, 0, q.trim(), relationship, active, phoneValid);
      const rows = Array.isArray(data) ? data : (data?.items || []);
      if (lastLoadRef.current === stamp) {
        setItems(rows);
        setPage(1);
      }
    } catch (e) {
      if (lastLoadRef.current === stamp) setErr(e?.message || "Failed to load guardians");
    } finally {
      if (lastLoadRef.current === stamp) setLoading(false);
    }
  }
  useEffect(() => { load(); }, [q, relationship, active, phoneValid]);

  // helpers
  function fmtName(g) {
    const f = g.first_name || g.firstName || "";
    const l = g.last_name || g.lastName || "";
    const n = g.name || (f || l ? `${f} ${l}`.trim() : "");
    return n || "—";
  }
  function fmtDateTime(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  }

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

  // efficient loaders (bulk + single)
  const hasBulk = typeof api.getStudentsByGuardianBulk === "function";
  const hasSingle = typeof api.getStudentsByGuardian === "function";

  async function loadStudentsForGuardianIds(ids) {
    const unique = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!unique.length) return;

    const toFetch = unique.filter(id => !students[id] && !studentsLoading[id]);
    if (!toFetch.length) return;

    setStudentsLoading(prev => ({ ...prev, ...Object.fromEntries(toFetch.map(id => [id, true])) }));
    setStudentsError(prev => ({ ...prev, ...Object.fromEntries(toFetch.map(id => [id, ""])) }));

    try {
      if (hasBulk) {
        const resp = await api.getStudentsByGuardianBulk(toFetch);
        const map = (resp && resp.items) || {};
        setStudents(prev => ({ ...prev, ...map }));
      } else if (hasSingle) {
        const results = await Promise.all(
          toFetch.map(async id => {
            const r = await api.getStudentsByGuardian(id);
            const list = Array.isArray(r) ? r : (r?.items || []);
            return [id, list];
          })
        );
        setStudents(prev => ({ ...prev, ...Object.fromEntries(results) }));
      } else {
        setStudentsError(prev => ({
          ...prev,
          ...Object.fromEntries(toFetch.map(id => [id, "Missing API: getStudentsByGuardianBulk / getStudentsByGuardian"]))
        }));
      }
    } catch (e) {
      const msg = e?.message || "Failed to load students";
      setStudentsError(prev => ({ ...prev, ...Object.fromEntries(toFetch.map(id => [id, msg])) }));
    } finally {
      setStudentsLoading(prev => ({ ...prev, ...Object.fromEntries(toFetch.map(id => [id, false])) }));
    }
  }
  function loadStudentsForGuardian(guardianId) {
    return loadStudentsForGuardianIds([guardianId]);
  }

  // editing — disabled for STAFF
  function beginEdit(g) {
    if (isStaff || saving) return;
    setEditingId(g.id);
    setDraft({
      firstName: g.first_name ?? g.firstName ?? "",
      lastName:  g.last_name  ?? g.lastName  ?? "",
      relationship: (g.relationship_type || g.relationship || "GUARDIAN"),
      email: g.email ?? "",
      phoneE164: g.phone_e164 ?? g.phoneE164 ?? "",
      phoneRaw: g.phone_raw ?? g.phoneRaw ?? "",
      phoneValid: !!(g.phone_valid ?? g.phoneValid),
      active: !!(g.active ?? g.isActive),
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
      setErr("You do not have permission to edit guardians.");
      return;
    }
    try {
      setSaving(true);
      const normalizedE164 = toE164AU(draft.phoneRaw);
      const payload = {
        firstName: draft.firstName?.trim(),
        lastName:  draft.lastName?.trim(),
        relationship: draft.relationship?.trim() || "GUARDIAN",
        email: draft.email?.trim() || null,
        phoneE164: normalizedE164 || null,
        phoneRaw: draft.phoneRaw?.trim() || null,
        phoneValid: !!draft.phoneValid,
        active: !!draft.active,
      };
      const updated = await api.patchGuardian(id, payload);
      const merged = Array.isArray(updated) ? updated[0] : (updated?.item || updated || {});
      setItems(prev => prev.map(x => (x.id === id ? { ...x, ...merged } : x)));
      setEditingId(null);
      setDraft(null);
      setErr("");
    } catch (e) {
      setErr(e?.message || "Failed to update guardian");
    } finally {
      setSaving(false);
    }
  }

  // delete — disabled for STAFF
  async function handleDelete(g) {
    if (isStaff) {
      setErr("You do not have permission to delete guardians.");
      return;
    }
    if (deletingId) return;
    const name = fmtName(g) || `Guardian #${g.id}`;
    const list = students[String(g.id)];
    const sCount = Array.isArray(list) ? list.length : undefined;

    const confirmMsg =
      `Delete "${name}"?\n\n` +
      `This will remove the guardian and unlink them from any students.\n` +
      `Students are NOT deleted.` +
      (typeof sCount === "number" ? `\n(Currently linked to ${sCount} student${sCount === 1 ? "" : "s"})` : "");
    if (!window.confirm(confirmMsg)) return;

    setDeletingId(g.id);
    setErr("");
    try {
      await api.deleteGuardian(g.id);
      setItems(prev => prev.filter(x => x.id !== g.id));
      const { [String(g.id)]: _removed, ...rest } = students;
      setStudents(rest);
    } catch (e) {
      setErr(e?.message || "Failed to delete guardian");
    } finally {
      setDeletingId(null);
    }
  }

  // client-side extras: id filter + hasStudents/studentQ
  const filtered = useMemo(() => {
    const sq = studentQ.trim().toLowerCase();

    return items.filter((g) => {
      // CHANGE: exact ID filter (if present) — compare as strings
      if (idSet.size && !idSet.has(String(g.id))) return false;

      const list = students[String(g.id)];

      if (hasStudents) {
        const present = Array.isArray(list) && list.length > 0;
        if (hasStudents === "yes" && !present) return false;
        if (hasStudents === "no"  &&  present) return false;
      }

      if (sq) {
        if (!Array.isArray(list)) return false;
        const hit = list.some(s => {
          const fn = (s.first_name || s.firstName || "").toLowerCase();
          const ln = (s.last_name  || s.lastName  || "").toLowerCase();
          const nm = `${fn} ${ln}`.trim();
          return nm.includes(sq);
        });
        if (!hit) return false;
      }
      return true;
    });
  }, [items, students, hasStudents, studentQ, idSet]); // CHANGE: include idSet

  // pagination
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const activeFilters = !!(q || relationship || active || phoneValid || studentQ || hasStudents || idFilter.length); // CHANGE

  function clearFilters() {
    setQ(""); setRelationship(""); setActive(""); setPhoneValid(""); setStudentQ(""); setHasStudents("");
    setIdFilter([]); // CHANGE
    // CHANGE: also clear URL query (removes ?id, ?ids, ?name, etc.)
    if (location.search) {
      navigate({ pathname: location.pathname }, { replace: true });
    }
  }

  // NEW: after creation, refresh or inject the record
  function handleCreated(newGuardian) {
    setShowCreate(false);
    if (newGuardian && newGuardian.id) {
      // Keep it simple: refresh list to respect current filters/order
      load();
    }
  }

  // prefetch students for visible guardians
  useEffect(() => {
    const ids = paged.map(g => g.id).filter(Boolean);
    loadStudentsForGuardianIds(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged]);

  // keep prefetch when student-based filters are active
  useEffect(() => {
    const need = studentQ.trim() || hasStudents;
    if (!need) return;
    const ids = paged.map(g => g.id).filter(Boolean);
    loadStudentsForGuardianIds(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentQ, hasStudents, page, pageSize, filtered]);

  return (
    <>
      {/* Header */}
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Guardians</h1>
        {isStaff && (
          <p className="muted small" style={{ margin: "6px 0 0" }} title="Read-only access">
            Read-only
          </p>
        )}
      </header>

      {/* Filters */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="form" role="search" aria-label="Filter guardians">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="q">Search (name, email, phone)</label>
              <input
                id="q"
                className="input"
                type="text"
                placeholder="e.g., Jane, +614…, or name@example.com"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="small muted" htmlFor="relationship">Relationship</label>
              <input
                id="relationship"
                className="input"
                type="text"
                placeholder="e.g., GUARDIAN"
                value={relationship}
                onChange={e => setRelationship(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="active">Active</label>
              <select id="active" className="input" value={active} onChange={e => setActive(e.target.value)}>
                <option value="">Any</option>
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="phoneValid">Phone valid</label>
              <select id="phoneValid" className="input" value={phoneValid} onChange={e => setPhoneValid(e.target.value)}>
                <option value="">Any</option>
                <option value="yes">Valid</option>
                <option value="no">Invalid</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="studentQ">Student contains</label>
              <input
                id="studentQ"
                className="input"
                type="text"
                placeholder="Student name"
                value={studentQ}
                onChange={e => setStudentQ(e.target.value)}
              />
            </div>
            <div>
              <label className="small muted" htmlFor="hasStudents">Has students</label>
              <select id="hasStudents" className="input" value={hasStudents} onChange={e => setHasStudents(e.target.value)}>
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>

          <div className="form-row">
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
            {/* NEW: Create Guardian button (Admin & Staff) */}
            <button
              type="button"
              className="btn"
              onClick={() => setShowCreate(true)}
              title="Add a new guardian without linking to a student"
            >
              New Guardian
            </button>
            {activeFilters && (
              <button type="button" className="btn btn-outline small" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Table */}
      <div className="card" role="region" aria-label="Guardians table">
        <div className="muted small" style={{ marginBottom: 8 }}>
          {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
        </div>

        {!loading && !paged.length && (
          <div className="muted" style={{ padding: 12 }} role="status">
            No guardians match the current filters.
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
                  <th style={{ textAlign: "left" }}>Guardian (Full name)</th>
                  <th style={{ textAlign: "left" }}>Students</th>
                  <th style={{ textAlign: "left" }}>Relationship</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Phone (E.164)</th>
                  <th style={{ textAlign: "left" }}>Phone Raw</th>
                  <th style={{ textAlign: "left" }}>Phone Valid</th>
                  <th style={{ textAlign: "left" }}>Active</th>
                  <th style={{ textAlign: "left" }}>Created / Updated</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(g => {
                  const gidKey = String(g.id);
                  const list = students[gidKey];
                  const createdAt = g.created_at || g.createdAt;
                  const updatedAt = g.updated_at || g.updatedAt;
                  const phoneE164 = g.phone_e164 || g.phoneE164 || "";
                  const phoneRaw = g.phone_raw || g.phoneRaw || "";
                  const rel = g.relationship_type || g.relationship || "GUARDIAN";
                  const isValid = !!(g.phone_valid ?? g.phoneValid);
                  const isActive = !!(g.active ?? g.isActive);
                  const isLoadingStudents = !!studentsLoading[gidKey];
                  const rowErr = studentsError[gidKey];

                  const isEditing = editingId === g.id && !isStaff;

                  return (
                    <tr key={gidKey}>
                      {/* FULL NAME */}
                      <td data-label="Guardian (Full name)">
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
                            <div className="muted small" style={{ gridColumn: "span 2" }}>ID: {g.id}</div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700 }}>{fmtName(g)}</div>
                            <div className="muted small">
                              {(g.first_name || g.firstName || "—")}{(g.last_name || g.lastName) ? " · " + (g.last_name || g.lastName) : ""}
                            </div>
                          </>
                        )}
                      </td>

                      {/* STUDENTS under this guardian */}
                      <td data-label="Students">
                        {Array.isArray(list)
                          ? (
                            list.length
                              ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {list.map(s => {
                                    const label = `${s.first_name || s.firstName || ""} ${s.last_name || s.lastName || ""}`.trim() || "Student";
                                    return (
                                      <Link
                                        key={s.id || label}
                                        to={`/students?id=${s.id}`} // CHANGE: exact student by id
                                        className="tag"
                                        title="View this student"
                                        style={{ cursor: "pointer", textDecoration: "underline", color: "darkblue" }}
                                      >
                                        {label}
                                      </Link>
                                    );
                                  })}
                                </div>
                              )
                              : <span className="muted">—</span>
                          )
                          : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-outline small"
                                onClick={() => loadStudentsForGuardian(gidKey)}
                                disabled={isLoadingStudents}
                              >
                                {isLoadingStudents ? "Loading…" : "Load"}
                              </button>
                              {rowErr ? <span className="muted small">({rowErr})</span> : null}
                            </div>
                          )}
                      </td>

                      {/* RELATIONSHIP */}
                      <td data-label="Relationship">
                        {isEditing ? (
                          <input
                            className="input"
                            placeholder="Relationship"
                            value={draft.relationship}
                            onChange={e => updateDraftField("relationship", e.target.value)}
                          />
                        ) : (
                          rel || <span className="muted">—</span>
                        )}
                      </td>

                      {/* EMAIL */}
                      <td data-label="Email">
                        {isEditing ? (
                          <input
                            className="input"
                            placeholder="Email"
                            value={draft.email || ""}
                            onChange={e => updateDraftField("email", e.target.value)}
                          />
                        ) : (
                          g.email ? <a href={`mailto:${g.email}`}>{g.email}</a> : <span className="muted">—</span>
                        )}
                      </td>

                      {/* PHONE E.164 */}
                      <td data-label="Phone (E.164)">
                        {isEditing ? (
                          <input
                            className="input"
                            value={toE164AU(draft.phoneRaw || draft.phoneE164 || "")}
                            readOnly
                            disabled
                            title="Auto-filled from Phone Raw"
                          />
                        ) : (
                          phoneE164 ? <a href={`tel:${phoneE164}`}>{phoneE164}</a> : <span className="muted">—</span>
                        )}
                      </td>

                      {/* PHONE RAW */}
                      <td data-label="Phone Raw">
                        {isEditing ? (
                          <input
                            className="input"
                            placeholder="Phone (raw)"
                            value={draft.phoneRaw || ""}
                            onChange={e => {
                              const v = e.target.value;
                              updateDraftField("phoneRaw", v);
                              updateDraftField("phoneE164", toE164AU(v));
                            }}
                          />
                        ) : (
                          phoneRaw || <span className="muted">—</span>
                        )}
                      </td>

                      {/* PHONE VALID */}
                      <td data-label="Phone Valid">
                        {isEditing ? (
                          <label className="label small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!draft.phoneValid}
                              onChange={e => updateDraftField("phoneValid", e.target.checked)}
                            />
                            Yes
                          </label>
                        ) : (
                          isValid ? <span className="tag">Yes</span> : <span className="tag">No</span>
                        )}
                      </td>

                      {/* ACTIVE */}
                      <td data-label="Active">
                        {isEditing ? (
                          <label className="label small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!draft.active}
                              onChange={e => updateDraftField("active", e.target.checked)}
                            />
                            Yes
                          </label>
                        ) : (
                          isActive ? <span className="tag">Yes</span> : <span className="tag">No</span>
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
                              onClick={() => saveEdit(g.id)}
                              disabled={saving || !draft.firstName?.trim() || !draft.lastName?.trim()}
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                            <button className="btn btn-outline" type="button" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button className="btn btn-outline" type="button" onClick={() => beginEdit(g)}>
                              Edit
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => handleDelete(g)}
                              disabled={deletingId === g.id}
                              aria-disabled={deletingId === g.id}
                              title="Delete guardian (students are NOT deleted)"
                            >
                              {deletingId === g.id ? "Deleting…" : "Delete"}
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
        <div className="actions" style={{ marginTop: 12 }}>
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

      {/* NEW: Create Guardian Modal mount point */}
      {showCreate && (
        <CreateGuardianModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
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