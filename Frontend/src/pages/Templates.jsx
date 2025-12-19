// src/pages/Templates.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { getTemplates, patchTemplate } from "../services/api";
import { getRole, addAuthStorageListener } from "../services/auth";

const TOKENS = [
  "{student.firstName}",
  "{student.lastName}",
  "{student.fullName}",
  "{student.id}",
  "{type}",        // CHECK_IN | CHECK_OUT
  "{time}",        // 3:15 PM
  "{date}",        // 17/08/2025
  "{center.name}", // optional for your center branding
];

const SAMPLE = {
  student: { firstName: "Ava", lastName: "Nguyen", id: 12345 },
  center:  { name: "Kumon North Hobart" },
};

export default function Templates() {
  // RBAC: Admin only
  const [role, setRole] = useState(() => getRole());
  const isAdmin = role === "ADMIN";
  const loc = useLocation();
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);
  if (!isAdmin) {
    // Defense-in-depth: App-level guard should already block, but we redirect just in case.
    return <Navigate to="/dashboard" replace state={{ denied: loc.pathname }} />;
  }

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [items, setItems]       = useState([]);            // canonical from server
  const [drafts, setDrafts]     = useState({});            // key -> text
  const [saving, setSaving]     = useState({});            // key -> boolean
  const [errKey, setErrKey]     = useState({});            // key -> error string

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await getTemplates();
      const list = normalizeTemplates(data);
      setItems(list);
      setDrafts(Object.fromEntries(list.map(t => [t.key, t.text ?? ""])));
      setErrKey({});
    } catch (e) {
      setError(e?.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const ordered = useMemo(() => {
    const pref = ["CHECK_IN", "CHECK_OUT"];
    const map = Object.fromEntries(items.map(t => [t.key, t]));
    const first = pref.filter(k => map[k]);
    const rest  = items.map(t => t.key).filter(k => !first.includes(k)).sort();
    return [...first, ...rest].map(k => map[k]);
  }, [items]);

  function onChange(key, val) {
    setDrafts(d => ({ ...d, [key]: val }));
    setErrKey(e => ({ ...e, [key]: undefined }));
  }
  function hasChange(key) {
    const baseline = items.find(t => t.key === key)?.text ?? "";
    return (drafts[key] ?? "") !== baseline;
  }

  async function save(key) {
    const text = (drafts[key] ?? "").trim();
    if (!text) {
      setErrKey(e => ({ ...e, [key]: "Template cannot be empty" }));
      return;
    }
    setSaving(s => ({ ...s, [key]: true }));
    setErrKey(e => ({ ...e, [key]: undefined }));
    try {
      const updated = await patchTemplate(key, text);
      // Your controller returns a single row { id, key, text, updated_by, updated_at }
      const clean = cleanTpl(updated);
      setItems(prev => prev.map(t => (t.key === clean.key ? clean : t)));
      setDrafts(d => ({ ...d, [clean.key]: clean.text ?? "" }));
    } catch (e) {
      setErrKey(er => ({ ...er, [key]: e?.message || "Save failed" }));
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  }

  function revert(key) {
    const baseline = items.find(t => t.key === key)?.text ?? "";
    setDrafts(d => ({ ...d, [key]: baseline }));
    setErrKey(e => ({ ...e, [key]: undefined }));
  }

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Templates</h1>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Edit SMS templates for Check-In and Check-Out. Click a token to insert it.
        </p>
      </header>

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <div className="small muted">
            Tokens:
            <span style={{ marginLeft: 6, display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
              {TOKENS.map(t => <Token key={t} token={t} />)}
            </span>
          </div>
          <button className="btn btn-outline" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {error && (
        <div className="card" role="alert" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="form" style={{ gap: 12 }}>
          {ordered.map(t => (
            <TemplateEditor
              key={t.key}
              tokenKey={t.key}
              title={labelForKey(t.key)}
              value={drafts[t.key] ?? ""}
              onChange={(v) => onChange(t.key, v)}
              onSave={() => save(t.key)}
              onRevert={() => revert(t.key)}
              modified={hasChange(t.key)}
              saving={!!saving[t.key]}
              error={errKey[t.key]}
              meta={{ updatedBy: t.updatedBy, updatedAt: t.updatedAt }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Template Editor ---------------- */

function TemplateEditor({ tokenKey, title, value, onChange, onSave, onRevert, modified, saving, error, meta }) {
  const taRef = useRef(null);
  const count = value.trim().length;
  const tooShort = count === 0;
  const tooLong = count > 500;

  function insert(tok) {
    const el = taRef.current;
    const start = el?.selectionStart ?? value.length;
    const end   = el?.selectionEnd ?? value.length;
    const next  = value.slice(0, start) + tok + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + tok.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  const previewIn  = renderPreview(value, { student: SAMPLE.student, center: SAMPLE.center, type: "CHECK_IN"  });
  const previewOut = renderPreview(value, { student: SAMPLE.student, center: SAMPLE.center, type: "CHECK_OUT" });

  return (
    <section className="card" style={{ display: "grid", gap: 12 }}>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{title}</span>
        {meta?.updatedAt && (
          <span className="small muted">
            Last updated {new Date(meta.updatedAt).toLocaleString()}
            {meta.updatedBy ? ` by #${meta.updatedBy}` : ""}
          </span>
        )}
      </div>

      <div className="form-row">
        <div>
          <label className="small muted" htmlFor={`tpl-${tokenKey}`}>Template text</label>
          <textarea
            ref={taRef}
            id={`tpl-${tokenKey}`}
            className="input"
            style={{ minHeight: 140 }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Dear {student.fullName}, ..."
          />
          <div className="actions" style={{ marginTop: 6 }}>
            <div className="small muted">
              {tooShort ? "Required" : `${count} / 500`} {tooLong && <span style={{ color:"crimson" }}> – too long</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TOKENS.map(tok => (
                <button
                  key={tok}
                  type="button"
                  className="btn btn-outline"
                  onClick={() => insert(tok)}
                  title={`Insert ${tok}`}
                  style={{ padding: "6px 10px" }}
                >
                  {tok}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="small" style={{ color:"crimson", marginTop: 6 }}>{error}</div>}
        </div>

        <div>
          <label className="small muted">Live preview</label>
          <div className="card" style={{ borderRadius: 12, padding: 12 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>Example SMS (Check-In)</div>
            <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{previewIn || "—"}</div>
            <div className="small muted" style={{ marginBottom: 6 }}>Example SMS (Check-Out)</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{previewOut || "—"}</div>
          </div>
        </div>
      </div>

      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onRevert} disabled={!modified || saving}>
          Revert
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={saving || tooShort || tooLong || !modified}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

/* ---------------- helpers ---------------- */

function labelForKey(key){
  if (key === "CHECK_IN") return "Check-In Template";
  if (key === "CHECK_OUT") return "Check-Out Template";
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeTemplates(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean).map(cleanTpl);
  const arr = data.items || data.templates || data.data || [];
  return Array.isArray(arr) ? arr.map(cleanTpl) : [];
}
function cleanTpl(t) {
  return {
    id: t.id ?? t.templateId ?? null,
    key: String(t.key ?? t.templateKey ?? t.name ?? "").toUpperCase(),
    text: t.text ?? t.body ?? "",
    updatedBy: t.updated_by ?? t.updatedBy ?? null,
    updatedAt: t.updated_at ?? t.updatedAt ?? null,
  };
}

function renderPreview(text, ctx) {
  const when = new Date();
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = when.toLocaleDateString();
  const student = ctx?.student || {};
  const center = ctx?.center || {};
  const type = ctx?.type || "CHECK_IN";
  const fullName = [student.firstName, student.lastName].filter(Boolean).join(" ").trim();

  let out = String(text || "");
  out = out.replaceAll("{student.firstName}", student.firstName ?? "Student");
  out = out.replaceAll("{student.lastName}", student.lastName ?? "");
  out = out.replaceAll("{student.fullName}", fullName || "Student");
  out = out.replaceAll("{student.id}", String(student.id ?? ""));
  out = out.replaceAll("{type}", type);
  out = out.replaceAll("{time}", time);
  out = out.replaceAll("{date}", date);
  out = out.replaceAll("{center.name}", center.name || "Kumon Centre");
  return out.trim();
}

function Token({ token }) {
  return (
    <span
      className="small"
      style={{
        display:"inline-flex", alignItems:"center", gap:6,
        border:"1px solid var(--border)", borderRadius:999, padding:"6px 10px",
        background:"linear-gradient(180deg, rgba(0,0,0,.02), rgba(0,0,0,.01))"
      }}
      title={token}
      aria-label={token}
    >
      {token}
    </span>
  );
}