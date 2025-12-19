import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { getMessages, request } from "../services/api"; // NEW: import request for stats

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  // NEW: stats for all scans (incl. non-SMS/headcount-only)
  const [statsLoading, setStatsLoading] = useState(true);
  const [stats, setStats] = useState({
    todayIn: 0,
    todayOut: 0,
    onCampusToday: 0,
    nonSmsIn: 0,
    nonSmsOut: 0,
    nonSmsTotal: 0,
  });

  // NEW: recent scan events (to include non-SMS scans in Recent Activity)
  const [scanLoading, setScanLoading] = useState(true);
  const [scanRows, setScanRows] = useState([]); // array of scan_event rows (may include has_message/headcountOnly flags)

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Fetch a reasonable window for accurate KPIs; we'll display only 20
        const data = await getMessages(200, 0);
        const items = Array.isArray(data) ? data : (data?.items || []);
        if (!cancelled) setRows(items);
      } catch (e) {
        if (!cancelled) setRows([]);
        console.warn("Failed to load messages:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // NEW: fetch today's scan stats (includes non-SMS scans)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatsLoading(true);
        const s = await request("/scan/stats/today");
        if (!cancelled) {
          const merged = {
            todayIn: Number(s?.todayIn || 0),
            todayOut: Number(s?.todayOut || 0),
            onCampusToday: Number(s?.onCampusToday || 0),
            nonSmsIn: Number(s?.nonSmsIn || 0),
            nonSmsOut: Number(s?.nonSmsOut || 0),
            nonSmsTotal: Number(s?.nonSmsTotal || 0),
          };
          setStats(merged);
        }
      } catch (e) {
        if (!cancelled) {
          setStats({
            todayIn: 0, todayOut: 0, onCampusToday: 0,
            nonSmsIn: 0, nonSmsOut: 0, nonSmsTotal: 0,
          });
        }
        console.warn("Failed to load scan stats:", e);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // NEW: fetch recent scans so we can show non-SMS entries as well
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setScanLoading(true);
        const qs = new URLSearchParams({ limit: String(40) });
        // Expected to return: array or { items: [...] } of recent scan_event rows joined with student + has_message/headcountOnly
        const data = await request(`/scan/recent?${qs.toString()}`);
        const items = Array.isArray(data) ? data : (data?.items || []);
        if (!cancelled) setScanRows(items);
      } catch (e) {
        if (!cancelled) setScanRows([]);
        // Silent-ish fail; dashboard still shows messages if endpoint isn't available
        console.warn("Failed to load recent scans:", e);
      } finally {
        if (!cancelled) setScanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Legacy KPI (messages-only) kept as fallback in case stats API is unavailable
  const { onCampusToday: onCampusFromMsgs, todayIn: inFromMsgs, todayOut: outFromMsgs } = useMemo(() => {
    const now = new Date();
    const start = +new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = +new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let cin = 0, cout = 0;
    const latestByStudent = new Map(); // id -> { ts, type }

    for (const r of rows) {
      const ts = getTs(r);
      if (ts < start || ts > end) continue;

      const type = getType(r);
      if (type === "CHECK_IN") cin++;
      else if (type === "CHECK_OUT") cout++;

      const sid = getStudentId(r);
      if (!sid || !type) continue;

      const prev = latestByStudent.get(sid);
      if (!prev || ts > prev.ts) latestByStudent.set(sid, { ts, type });
    }
    let onCampus = 0;
    latestByStudent.forEach(({ type }) => { if (type === "CHECK_IN") onCampus++; });

    return { onCampusToday: onCampus, todayIn: cin, todayOut: cout };
  }, [rows]);

  // Prefer stats (includes non-SMS); fall back to message-derived KPIs while stats load/error
  const kpiOnCampus = !statsLoading ? stats.onCampusToday : onCampusFromMsgs;
  const kpiIn       = !statsLoading ? stats.todayIn       : inFromMsgs;
  const kpiOut      = !statsLoading ? stats.todayOut      : outFromMsgs;
  const kpiNonSms   = !statsLoading ? stats.nonSmsTotal   : 0;

  // NEW: merge message logs with non-SMS scans for Recent Activity
  const display = useMemo(() => {
    // Message rows (SMS attempts); keep as-is
    const smsItems = Array.isArray(rows) ? rows : [];

    // From scanRows include only those with no message (non-SMS / headcount-only)
    const nonSms = (Array.isArray(scanRows) ? scanRows : []).filter(ev => {
      if (ev == null) return false;
      // Prefer explicit flags if present
      if (typeof ev.has_message === "boolean") return ev.has_message === false;
      if (typeof ev.headcountOnly === "boolean") return ev.headcountOnly === true;
      if (typeof ev.headcount_only === "boolean") return ev.headcount_only === true;
      // Fallback heuristic: no body and no recipients arrays => likely non-SMS scan row
      const hasBody = !!((ev.body_rendered || ev.body || "").trim?.());
      const hasRcpt = Array.isArray(ev.recipients) && ev.recipients.length > 0;
      return !(hasBody || hasRcpt);
    });

    // Merge and sort by time desc; cap to 20
    const combined = [...smsItems, ...nonSms].sort((a, b) => getTs(b) - getTs(a));
    return combined.slice(0, 20);
  }, [rows, scanRows]);

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Dashboard</h1>
        <p className="muted small">Quick scan actions and recent activity (latest 20 messages)</p>
      </header>

      {/* Quick actions (wraps neatly on mobile) */}
      <div className="actions" style={{ marginBottom: 16 }}>
        <Link to="/scan?type=CHECK_IN"  className="btn" aria-label="Go to Check-In scanner">Scan Check-In</Link>
        <Link to="/scan?type=CHECK_OUT" className="btn" aria-label="Go to Check-Out scanner">Scan Check-Out</Link>
        <Link to="/messages"  className="btn btn-outline">View Messages</Link>
        <Link to="/templates" className="btn btn-outline">Edit Templates</Link>
      </div>

      {/* KPI tiles (auto-fit grid) */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KpiCard label="Students On Campus (Today)" value={kpiOnCampus} />
        <KpiCard label="Check-Ins Today" value={kpiIn} />
        <KpiCard label="Check-Outs Today" value={kpiOut} />
        <KpiCard label="Non-SMS Scans Today" value={kpiNonSms} /> {/* NEW */}
      </div>

      {/* Recent activity → responsive table/cards on mobile */}
      <section className="card">
        <h2 className="section-title">Recent Activity</h2>
        {(loading || scanLoading) ? (
          <div className="muted">Loading…</div>
        ) : display.length === 0 ? (
          <div className="muted">No messages yet.</div>
        ) : (
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Student</th>
                <th>DOB</th>
                <th>Type</th>
                <th>Preview</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {display.map((r, i) => {
                const when = new Date(getTs(r));
                const name = getStudentName(r) || "—";
                const dob  = getStudentDob(r) || "—";
                const type = getType(r) || (String(r.type || "").toUpperCase() || "—");

                // Preview: for non-SMS scans (no message), show em dash
                const hasMsg = hasMessage(r);
                const preview = hasMsg ? ((r.body_rendered || r.body || "").slice(0, 80) || "—") : "—";

                const status = normalizeStatus(r); // <-- shows NO SMS for headcount-only rows

                return (
                  <tr key={r.id || r.scan_event_id || i}>
                    <td data-label="Time">{when.toLocaleString()}</td>
                    <td data-label="Student">{name}</td>
                    <td data-label="DOB">{dob}</td>
                    <td data-label="Type">{type}</td>
                    <td data-label="Preview" title={(r.body_rendered || r.body || "")}>{preview}</td>
                    <td data-label="Status">{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ---------------- helpers ---------------- */

function getTs(m) {
  const t =
    m.time || m.createdAt || m.created_at || m.sent_at || m.timestamp ||
    m.scanned_at || m.scannedAt; // NEW: support scan_event rows
  return t ? +new Date(t) : Date.now();
}
function getStudentId(m) {
  const s = m.student || {};
  return m.studentId ?? m.student_id ?? s.id ?? null;
}
function getType(m) {
  const key = (m.templateKey || m.template_key || "").toString().toUpperCase();
  if (key === "CHECK_IN" || key === "CHECK_OUT") return key;
  const body = (m.body_rendered || m.body || "").toLowerCase();
  if (body.includes("checked in")) return "CHECK_IN";
  if (body.includes("checked out") || body.includes("check out") || body.includes("finished")) return "CHECK_OUT";
  return null;
}

/* New: tolerant full-name + DOB resolvers */
function getStudentName(m) {
  const s = m.student || {};
  const first = m.student_first ?? s.firstName ?? s.first_name ?? null;
  const last  = m.student_last  ?? s.lastName  ?? s.last_name  ?? null;
  const joined = [first, last].filter(Boolean).join(" ").trim();

  const any =
    joined ||
    m.student_name ||
    m.studentName ||
    s.name ||
    null;

  if (typeof any === "string" && /^student\s*#\d+$/i.test(any)) return null;
  return any?.trim() || null;
}

function getStudentDob(m) {
  const s = m.student || {};
  const raw =
    m.student_dob ?? m.studentDob ?? m.dob ??
    m.birthDate ?? m.birth_date ??
    s.dob ?? s.birthDate ?? s.birth_date ?? null;

  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(+d)) return d.toLocaleDateString();
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function KpiCard({ label, value }) {
  return (
    <div className="card kpi">
      <div className="muted small">{label}</div>
      <div className="kpi-value">{value ?? 0}</div>
    </div>
  );
}

// NEW: does this row represent a stored message (vs. a headcount-only scan)?
function hasMessage(m) {
  if (!m) return false;
  if (m.messageLogId != null || m.message_log_id != null) return true;
  const txt = (m.body_rendered || m.body || "");
  if (typeof txt === "string" && txt.trim().length) return true;
  const r = m.recipients;
  if (Array.isArray(r) && r.length) return true;
  if (typeof m.has_message === "boolean") return m.has_message;
  return false;
}

/* ---- NEW: gateway-aware status normalizer for table display ---- */
function normalizeStatus(m) {
  // Non-SMS / headcount-only fast-path
  if (
    m?.headcountOnly === true ||
    m?.headcount_only === true ||
    (m?.meta && m.meta.headcountOnly === true) ||
    (!hasMessage(m) && (m?.type || m?.scanned_at || m?.scannedAt))
  ) {
    return "NO SMS";
  }

  // Prefer recipient-level gateway_status truth
  const r = m?.recipients;
  if (Array.isArray(r) && r.length) {
    const gw = r
      .map(x => (x?.gateway_status != null ? String(x.gateway_status).toUpperCase() : null))
      .filter(Boolean);
    if (gw.length) {
      const uniq = Array.from(new Set(gw));
      if (uniq.includes("INSUFFICIENT_CREDIT")) return "INSUFFICIENT_CREDIT";
      if (uniq.every(v => v === "SUCCESS")) return "SENT";
      return uniq.join(", ");
    }
    // Fallback to recipient status/state if no gateway_status present
    const rs = r
      .map(x => (x?.status || x?.state || ""))
      .filter(Boolean)
      .map(v => String(v).toUpperCase());
    if (rs.length) {
      const uniq = Array.from(new Set(rs));
      if (uniq.length === 1) return uniq[0];
      if (uniq.every(v => v === "SENT" || v === "SUCCESS")) return "SENT";
      if (uniq.some(v => v === "FAILED" || v === "ERROR")) return "ERROR";
      return uniq.join(", ");
    }
  }

  // Fall back to top-level fields
  const s = m?.status || m?.gateway_status || m?.delivery_status;
  if (s) {
    const up = String(s).toUpperCase();
    return up === "SUCCESS" ? "SENT" : up;
  }

  return "—";
}