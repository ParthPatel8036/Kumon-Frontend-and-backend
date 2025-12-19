import { useEffect, useMemo, useState } from "react";
import { getMessages } from "../services/api";

export default function Messages() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [q, setQ] = useState("");                   // free text: student name/body
  const [recipientQ, setRecipientQ] = useState(""); // phone/email search
  const [type, setType] = useState("");             // CHECK_IN | CHECK_OUT | ""
  const [status, setStatus] = useState("");         // SENT | ERROR | ...
  const [from, setFrom] = useState("");             // YYYY-MM-DD
  const [to, setTo] = useState("");                 // YYYY-MM-DD

  // Pagination (client-side)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      // include=student is default in api.js
      // grab a decent window for filtering
      const data = await getMessages(300, 0);
      const rows = Array.isArray(data) ? data : (data?.items || []);
      setItems(rows);
      setPage(1); // reset to first page after reload
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const data = await getMessages(300, 0);
        const rows = Array.isArray(data) ? data : (data?.items || []);
        if (on) setItems(rows);
      } catch (e) {
        if (on) setError(e?.message || "Failed to load");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  // When any filter changes, go back to page 1
  useEffect(() => { setPage(1); }, [q, recipientQ, type, status, from, to, pageSize]);

  // Options for selects (derived from data)
  const statusOptions = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      const s = normalizeStatus(it);
      if (s && s !== "—") set.add(s);
    }
    return Array.from(set).sort();
  }, [items]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const qlc = q.trim().toLowerCase();
    const rlc = recipientQ.trim().toLowerCase();
    const fromMs = from ? +new Date(from + "T00:00:00") : null;
    const toMs = to ? +new Date(to + "T23:59:59.999") : null;

    return items.filter((m) => {
      // type
      if (type) {
        const t = fmtType(m);
        if (t !== type) return false;
      }
      // status
      if (status) {
        const s = normalizeStatus(m);
        if (s !== status) return false;
      }
      // date range
      const ts = getTs(m);
      if (fromMs && ts < fromMs) return false;
      if (toMs && ts > toMs) return false;

      // free-text: student name + preview/body
      if (qlc) {
        const name = fmtStudentName(m).toLowerCase();
        const preview = (m.body_rendered || m.body || "").toLowerCase();
        if (!name.includes(qlc) && !preview.includes(qlc)) return false;
      }

      // recipient search
      if (rlc) {
        const rec = fmtRecipients(m).toLowerCase();
        if (!rec.includes(rlc)) return false;
      }

      return true;
    });
  }, [items, q, recipientQ, type, status, from, to]);

  // Pagination math
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Page number list (compact, with ellipsis)
  function pageNumbers() {
    const arr = [];
    const max = totalPages;
    const push = (v) => arr.push(v);
    if (max <= 7) {
      for (let i = 1; i <= max; i++) push(i);
    } else {
      const show = new Set([1, 2, max - 1, max, current - 1, current, current + 1]);
      const ordered = Array.from({ length: max }, (_, i) => i + 1)
        .filter(n => show.has(n))
        .sort((a, b) => a - b);
      for (let i = 0; i < ordered.length; i++) {
        const n = ordered[i];
        push(n);
        const next = ordered[i + 1];
        if (next && next - n > 1) push("…");
      }
    }
    return arr;
  }

  function resetFilters() {
    setQ(""); setRecipientQ(""); setType(""); setStatus(""); setFrom(""); setTo("");
  }

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Messages</h1>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Explore, filter, and page through recent messages
        </p>
      </header>

      {/* Filters */}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="form" style={{ gap: 10 }}>
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="q">Search (student or message)</label>
              <input id="q" className="input" placeholder="e.g. James or 'checked out'"
                     value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <label className="small muted" htmlFor="rq">Recipient</label>
              <input id="rq" className="input" placeholder="+614…"
                     value={recipientQ} onChange={(e) => setRecipientQ(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="type">Type</label>
              <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All</option>
                <option value="CHECK_IN">Check-In</option>
                <option value="CHECK_OUT">Check-Out</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="status">Status</label>
              <select id="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="from">From</label>
              <input id="from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="small muted" htmlFor="to">To</label>
              <input id="to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="actions" style={{ justifyContent: "space-between" }}>
            {/* Active filter chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {q && <Chip onClear={() => setQ("")}>Search: “{q}”</Chip>}
              {recipientQ && <Chip onClear={() => setRecipientQ("")}>Recipient: “{recipientQ}”</Chip>}
              {type && <Chip onClear={() => setType("")}>Type: {type}</Chip>}
              {status && <Chip onClear={() => setStatus("")}>Status: {status}</Chip>}
              {from && <Chip onClear={() => setFrom("")}>From: {from}</Chip>}
              {to && <Chip onClear={() => setTo("")}>To: {to}</Chip>}
              {!(q||recipientQ||type||status||from||to) && (
                <span className="small muted">No active filters</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline" onClick={resetFilters} disabled={loading}>Reset</button>
              <button className="btn btn-outline" onClick={load} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="card">
        {loading && <div className="muted">Loading…</div>}
        {error && !loading && (
          <div role="alert" className="small" style={{ color: "crimson" }}>
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="muted">No messages match your filters.</div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student</th>
                  <th>DOB</th>
                  <th>Recipients</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m, i) => (
                  <tr key={m.id || `${start + i}`}>
                    <td data-label="Time">{fmtTime(m)}</td>
                    <td data-label="Student">{fmtStudentName(m)}</td>
                    <td data-label="DOB">{fmtStudentDob(m)}</td>
                    <td data-label="Recipients">{fmtRecipients(m)}</td>
                    <td data-label="Type">{fmtType(m)}</td>
                    <td data-label="Status">{fmtStatus(m)}</td>
                    <td data-label="Preview" title={m.body_rendered || m.body || ""}>
                      {fmtPreview(m)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="actions" style={{ marginTop: 12, alignItems: "center" }}>
              <div className="small muted">
                Showing <strong>{Math.min(total, start + 1)}</strong>–<strong>{Math.min(total, start + pageItems.length)}</strong> of <strong>{total}</strong>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                <select
                  className="input"
                  style={{ width: "auto", padding: "8px 10px" }}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
                </select>

                <nav aria-label="Pagination" style={{ display: "flex", gap: 6 }}>
                  <PageBtn label="«" disabled={current === 1} onClick={() => setPage(1)} />
                  <PageBtn label="‹" disabled={current === 1} onClick={() => setPage(p => Math.max(1, p - 1))} />
                  {pageNumbers().map((p, idx) =>
                    p === "…" ? (
                      <span key={`dots-${idx}`} className="small muted" style={{ padding: "6px 8px" }}>…</span>
                    ) : (
                      <PageBtn
                        key={p}
                        label={String(p)}
                        active={p === current}
                        onClick={() => setPage(p)}
                      />
                    )
                  )}
                  <PageBtn label="›" disabled={current === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} />
                  <PageBtn label="»" disabled={current === totalPages} onClick={() => setPage(totalPages)} />
                </nav>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/* ---------- small presentational helpers ---------- */

function Chip({ children, onClear }) {
  return (
    <span
      className="small"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        border: "1px solid var(--border)", borderRadius: 999, padding: "6px 10px",
        background: "linear-gradient(180deg, rgba(0,0,0,.02), rgba(0,0,0,.01))"
      }}
    >
      {children}
      <button
        type="button"
        className="icon-btn"
        onClick={onClear}
        aria-label="Clear filter"
        title="Clear"
        style={{ width: 28, height: 28 }}
      >
        ×
      </button>
    </span>
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
        ...(active ? {} : { background: "transparent", color: "var(--text)", borderColor: "var(--border)" })
      }}
    >
      {label}
    </button>
  );
}

/* ---------- format helpers (tolerant to different shapes) ---------- */

function getTs(m) {
  const t = m.time || m.createdAt || m.created_at || m.sent_at || m.timestamp || m.created_at;
  return t ? +new Date(t) : Date.now();
}

function fmtTime(m) {
  const d = new Date(getTs(m));
  return isNaN(+d) ? "—" : d.toLocaleString();
}

/** Full name only (no #id fallback) */
function fmtStudentName(m) {
  const s = m.student || {};
  const first = m.student_first ?? s.firstName ?? s.first_name ?? null;
  const last  = m.student_last  ?? s.lastName  ?? s.last_name  ?? null;
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return (
    joined ||
    m.student_name ||
    m.studentName ||
    s.name ||
    "—"
  );
}

/** Flexible DOB resolver with safe formatting */
function fmtStudentDob(m) {
  const s = m.student || {};
  const raw =
    m.student_dob ?? m.studentDob ?? m.dob ??
    m.birthDate ?? m.birth_date ??
    s.dob ?? s.birthDate ?? s.birth_date ?? null;

  if (!raw) return "—";
  const d = new Date(raw);
  if (!isNaN(+d)) return d.toLocaleDateString();
  if (typeof raw === "string" && raw.trim()) return raw.trim(); // show unparsed strings as-is
  return "—";
}

function fmtRecipients(m) {
  const r = m.recipients ?? m.to ?? m.targets;
  if (!r) return "—";
  if (typeof r === "string") return r;

  if (Array.isArray(r)) {
    const list = r
      .map(x =>
        typeof x === "string"
          ? x
          : x.phone || x.to || x.number || x.msisdn || (x.value ?? null)
      )
      .filter(Boolean);
    if (list.length) return list.join(", ");
    return `${r.length} recipient(s)`;
  }

  const maybe = r.phone || r.to || r.number || r.msisdn;
  return maybe || "—";
}

function fmtType(m) {
  const key = (m.templateKey || m.template_key || "").toString().toUpperCase();
  if (key === "CHECK_IN" || key === "CHECK_OUT") return key || "—";
  const body = (m.body_rendered || m.body || "").toLowerCase();
  if (body.includes("checked in")) return "CHECK_IN";
  if (body.includes("checked out") || body.includes("check out") || body.includes("finished")) return "CHECK_OUT";
  return "—";
}

function normalizeStatus(m) {
  const s = m.status || m.gateway_status || m.delivery_status;
  if (s) return String(s).toUpperCase();
  const r = m.recipients;
  if (Array.isArray(r)) {
    const statuses = r.map(x => (x?.status || x?.state || "")).filter(Boolean).map(v => String(v).toUpperCase());
    if (statuses.length) {
      const uniq = Array.from(new Set(statuses));
      if (uniq.length === 1) return uniq[0];
      if (uniq.every(v => v === "SENT" || v === "SUCCESS")) return "SENT";
      if (uniq.some(v => v === "FAILED" || v === "ERROR")) return "ERROR";
      return uniq.join(", ");
    }
  }
  return "—";
}

function fmtStatus(m) {
  return normalizeStatus(m);
}

function fmtPreview(m) {
  const body = m.body_rendered || m.body || "";
  if (!body) return "";
  return body.length > 120 ? body.slice(0, 117) + "…" : body;
}