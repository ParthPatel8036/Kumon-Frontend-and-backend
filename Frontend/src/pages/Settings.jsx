// src/pages/Settings.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../services/api";
import { getToken, getRole, addAuthStorageListener, setToken } from "../services/auth"; // ← add setToken

/**
 * Settings Page
 * - Organisation (admin-only edits): centre profile, SMS policy, retention/export, health.
 * - My Preferences (per-user): scanner + accessibility + account (email/password).
 */

export default function Settings() {
  const [role, setRole] = useState(() => getRole());
  const isStaff = role === "STAFF";

  // Tabs: Staff are forced to "me"
  const [tab, setTab] = useState(() => (isStaff ? "me" : "org"));
  useEffect(() => {
    const unsub = addAuthStorageListener(setRole);
    return unsub;
  }, []);
  useEffect(() => {
    if (isStaff) setTab("me");
  }, [isStaff]);

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Settings</h1>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          {isStaff
            ? "Your personal preferences."
            : "Configure centre behaviour and your personal preferences."
          }
        </p>
      </header>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="actions" role="tablist" aria-label="Settings sections">
          {!isStaff && (
            <TabButton label="Organisation" active={tab === "org"} onClick={() => setTab("org")} />
          )}
          <TabButton label="My Preferences" active={tab === "me"} onClick={() => setTab("me")} />
        </div>
      </div>

      {isStaff ? (
        <MyPreferences />
      ) : (
        tab === "org" ? <OrganisationSettings /> : <MyPreferences />
      )}
    </>
  );
}

/* ---------------- Organisation (Admin) ---------------- */

function OrganisationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [form, setForm] = useState({
    centreName: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Hobart",
    smsPolicy: { sendOnCheckIn: true, sendOnCheckOut: true },
  });

  const [initial, setInitial] = useState(null);

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const [hc, setHc] = useState({ loading: true, when: null, db: "unknown", sms: "unknown", serverTime: "" });
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  const dirty = useMemo(() => {
    if (!initial) return false;
    return JSON.stringify(form) !== JSON.stringify(initial);
  }, [form, initial]);

  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      setErr("");
      setOk("");
      try {
        const data = await api.getOrgSettings?.();
        if (!on) return;
        const shaped = shapeOrg(data);
        setForm(shaped);
        setInitial(shaped);
      } catch (e) {
        if (on) setErr(e?.message || "Failed to load settings");
      } finally {
        if (on) setLoading(false);
      }
    })();
    (async () => {
      try {
        const h = await api.getHealth?.();
        setHc({
          loading: false,
          when: new Date().toISOString(),
          db: truthy(h?.dbOk) ? "ok" : "fail",
          sms: truthy(h?.smsOk) ? "ok" : "fail",
          serverTime: h?.serverTime || "",
        });
      } catch {
        setHc(v => ({ ...v, loading: false, db: "unknown", sms: "unknown" }));
      }
    })();
    return () => { on = false; };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setErr("");
    setOk("");
    try {
      const payload = unshapeOrg(form);
      await api.updateOrgSettings?.(payload);
      setOk("Settings saved");
      setInitial(form);
    } catch (e) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function runTestSms() {
    if (!testTo.trim()) return setErr("Enter a phone number for the test SMS");
    setTesting(true);
    setErr("");
    setOk("");
    try {
      await api.testSms?.({ to: testTo.trim() });
      setOk("Test SMS sent");
    } catch (e) {
      setErr(e?.message || "Failed to send test SMS");
    } finally {
      setTesting(false);
    }
  }

  async function refreshHealth() {
    setHc(v => ({ ...v, loading: true }));
    try {
      const h = await api.getHealth?.();
      setHc({
        loading: false,
        when: new Date().toISOString(),
        db: truthy(h?.dbOk) ? "ok" : "fail",
        sms: truthy(h?.smsOk) ? "ok" : "fail",
        serverTime: h?.serverTime || "",
      });
    } catch {
      setHc({ loading: false, when: new Date().toISOString(), db: "unknown", sms: "unknown", serverTime: "" });
    }
  }

  async function exportFile(kind, format) {
    try {
      setErr("");
      setOk("");
      const qs = new URLSearchParams();
      if (exportFrom) qs.set("from", exportFrom);
      if (exportTo) qs.set("to", exportTo);
      qs.set("format", format);
      const base = kind === "scans" ? "/settings/export/scans" : "/settings/export/messages";
      const url = (api.baseUrl ? api.baseUrl : "") + base + "?" + qs.toString();

      const token = getToken?.();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        mode: "cors",
      });

      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
          else if (j?.message) msg = j.message;
        } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();

      const dispo = res.headers.get("content-disposition") || "";
      let filename = "";
      const m = dispo.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (m && m[1]) {
        try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; }
      }
      if (!filename) {
        const datePart = [
          exportFrom || "",
          exportTo || "",
        ].filter(Boolean).join("_to_") || new Date().toISOString().slice(0,10);
        const ext = format === "csv" ? "csv" : "json";
        filename = `${kind}-${datePart}.${ext}`;
      }

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      }, 0);

      setOk("Export ready");
    } catch (e) {
      setErr(e?.message || "Failed to export");
    }
  }

  async function purgeOld() {
    if (!window.confirm(
      "Archive & purge records older than 12 months?\n\nThis cannot be undone."
    )) return;

    setErr("");
    setOk("");
    try {
      await api.purgeOldData?.();
      setOk("Archive & purge completed");
    } catch (e) {
      setErr(e?.message || "Failed to purge");
    }
  }

  return (
    <>
      <section className="card" aria-busy={loading || undefined} style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Organisation</h2>
        <div className="form">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="centreName">Centre name</label>
              <input
                id="centreName"
                className="input"
                value={form.centreName}
                onChange={e => setForm(v => ({ ...v, centreName: e.target.value }))}
                placeholder="Kumon North Hobart"
              />
            </div>
            <div>
              <label className="small muted" htmlFor="timezone">Timezone</label>
              <input
                id="timezone"
                className="input"
                value={form.timezone}
                onChange={e => setForm(v => ({ ...v, timezone: e.target.value }))}
                placeholder="Australia/Hobart"
              />
            </div>
          </div>

          <fieldset className="fieldset" style={{ marginTop: 8 }}>
            <legend className="small muted">SMS policy</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!form.smsPolicy.sendOnCheckIn}
                onChange={e => setForm(v => ({ ...v, smsPolicy: { ...v.smsPolicy, sendOnCheckIn: e.target.checked } }))}
              />
              <span>Send SMS on Check-in</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!form.smsPolicy.sendOnCheckOut}
                onChange={e => setForm(v => ({ ...v, smsPolicy: { ...v.smsPolicy, sendOnCheckOut: e.target.checked } }))}
              />
              <span>Send SMS on Check-out</span>
            </label>

            <div className="actions" style={{ marginTop: 8 }}>
              <input
                className="input"
                style={{ maxWidth: 240 }}
                placeholder="Test number e.g. +61…"
                value={testTo}
                onChange={e => setTestTo(e.target.value)}
              />
              <button type="button" className="btn btn-outline" onClick={runTestSms} disabled={testing}>
                {testing ? "Sending…" : "Send Test SMS"}
              </button>
              <a className="btn btn-outline" href="/templates">Edit Templates</a>
            </div>
          </fieldset>

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Data retention & export</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Logs older than <strong>12 months</strong> are eligible for archival and purge.
        </p>
        <div className="form">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="from">From</label>
              <input id="from" className="input" type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} />
            </div>
            <div>
              <label className="small muted" htmlFor="to">To</label>
              <input id="to" className="input" type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => exportFile("scans", "csv")}>Export Scans (CSV)</button>
            <button type="button" className="btn btn-outline" onClick={() => exportFile("messages", "csv")}>Export Messages (CSV)</button>
            <button type="button" className="btn btn-outline" onClick={() => exportFile("scans", "json")}>Export Scans (JSON)</button>
            <button type="button" className="btn btn-outline" onClick={() => exportFile("messages", "json")}>Export Messages (JSON)</button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={purgeOld}>Archive & Purge ≥ 12mo</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="h2" style={{ marginTop: 0 }}>System health</h2>
        <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <HealthTile label="Database" status={hc.db} />
          <HealthTile label="SMS Gateway" status={hc.sms} />
          <HealthTile label="Server time" status={hc.serverTime ? "ok" : "unknown"} note={hc.serverTime} />
        </div>
        <div className="actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-outline" onClick={refreshHealth} disabled={hc.loading}>
            {hc.loading ? "Checking…" : "Run health check"}
          </button>
          <span className="muted small"> Last run: {hc.when ? new Date(hc.when).toLocaleString() : "—"}</span>
        </div>
      </section>

      {(err || ok) && (
        <div className="small" style={{
          marginTop: 12,
          background: err ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)",
          border: "1px solid " + (err ? "rgba(239,68,68,.3)" : "rgba(16,185,129,.3)"),
          borderRadius: 10,
          padding: "8px 10px"
        }}>
          {err || ok}
        </div>
      )}
    </>
  );
}

function defaultShape(v) {
  return {
    centreName: v?.centreName ?? "",
    timezone: v?.timezone ?? "",
    smsPolicy: {
      sendOnCheckIn: !!v?.smsPolicy?.sendOnCheckIn,
      sendOnCheckOut: !!v?.smsPolicy?.sendOnCheckOut,
    },
  };
}
function shapeOrg(data) {
  const v = data || {};
  return defaultShape(v);
}
function unshapeOrg(form) {
  return {
    centreName: (form.centreName || "").trim(),
    timezone: (form.timezone || "").trim(),
    smsPolicy: {
      sendOnCheckIn: !!form.smsPolicy?.sendOnCheckIn,
      sendOnCheckOut: !!form.smsPolicy?.sendOnCheckOut,
    },
  };
}

/* ---------------- My Preferences (local) ---------------- */

function MyPreferences() {
  const [cameraDevices, setCameraDevices] = useState([]);
  const [camId, setCamId] = useState(localGet("pref.cameraId") || "");
  const [soundOn, setSoundOn] = useState(localGetBool("pref.soundOn", true));
  const [volume, setVolume] = useState(Number(localGet("pref.volume") ?? 0.8));
  const [haptics, setHaptics] = useState(localGetBool("pref.haptics", true));
  const [dupBehaviour, setDupBehaviour] = useState(localGet("pref.dupBehaviour") || "toast");
  const [highContrast, setHighContrast] = useState(localGetBool("pref.highContrast", false));
  const [largeText, setLargeText] = useState(localGetBool("pref.largeText", false));
  const [reducedMotion, setReducedMotion] = useState(localGetBool("pref.reducedMotion", false));

  const audioRef = useRef(null);

  // --- Account ---
  const [meLoading, setMeLoading] = useState(true);
  const [meErr, setMeErr] = useState("");
  const [meId, setMeId] = useState(null);
  const [meEmail, setMeEmail] = useState("");

  const [emailForm, setEmailForm] = useState({ email: "", confirm: "" });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  const [pwForm, setPwForm] = useState({ pw: "", confirm: "", show: false });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    (async () => {
      setMeLoading(true);
      setMeErr("");
      try {
        const data = await api.me(); // GET /auth/me
        const u = data?.user || data || {};
        setMeId(u.id ?? null);
        setMeEmail(u.email ?? "");
        setEmailForm({ email: u.email ?? "", confirm: "" });
      } catch (e) {
        setMeErr(e?.message || "Failed to load account");
      } finally {
        setMeLoading(false);
      }
    })();
  }, []);

  // camera init
  useEffect(() => {
    (async () => {
      try { if (navigator.mediaDevices?.getUserMedia) await navigator.mediaDevices.getUserMedia({ video: true }); } catch {}
      try {
        const all = await navigator.mediaDevices?.enumerateDevices?.();
        const cams = (all || []).filter(d => d.kind === "videoinput");
        setCameraDevices(cams);
        if (!camId && cams[0]) setCamId(cams[0].deviceId);
      } catch {}
    })();
  }, []);

  useEffect(() => localSet("pref.cameraId", camId), [camId]);
  useEffect(() => localSet("pref.soundOn", soundOn), [soundOn]);
  useEffect(() => localSet("pref.volume", volume), [volume]);
  useEffect(() => localSet("pref.haptics", haptics), [haptics]);
  useEffect(() => localSet("pref.dupBehaviour", dupBehaviour), [dupBehaviour]);
  useEffect(() => localSet("pref.highContrast", highContrast), [highContrast]);
  useEffect(() => localSet("pref.largeText", largeText), [largeText]);
  useEffect(() => localSet("pref.reducedMotion", reducedMotion), [reducedMotion]);

  function playTest() {
    if (!soundOn) return;
    const el = audioRef.current;
    if (!el) return;
    el.volume = clamp01(volume);
    el.currentTime = 0;
    el.play?.().catch(() => {});
    if (haptics && "vibrate" in navigator) navigator.vibrate?.(40);
  }

  function reset() {
    setCamId("");
    setSoundOn(true);
    setVolume(0.8);
    setHaptics(true);
    setDupBehaviour("toast");
    setHighContrast(false);
    setLargeText(false);
    setReducedMotion(false);
    [
      "pref.cameraId","pref.soundOn","pref.volume","pref.haptics","pref.dupBehaviour",
      "pref.highContrast","pref.largeText","pref.reducedMotion"
    ].forEach(k => localRemove(k));
  }

  // -------- Account actions (self-service via /auth/me) --------
  const emailDirty = meEmail && emailForm.email.trim() !== meEmail.trim();
  const emailValid = /^\S+@\S+\.\S+$/.test(emailForm.email.trim());
  const emailConfirmOk = emailForm.email.trim() === emailForm.confirm.trim();

  async function saveEmail() {
    if (!meId || emailSaving) return;
    setEmailSaving(true);
    setEmailMsg("");
    try {
      if (!emailDirty || !emailValid || !emailConfirmOk) throw new Error("Please enter a valid matching email.");
      const payload = { email: emailForm.email.trim() };
      const resp = await api.updateAccount(payload); // PATCH /auth/me
      const updated = resp?.user || {};
      if (resp?.token && typeof resp.token === "string" && resp.token.trim()) setToken(resp.token); // refresh JWT claims
      // sync local cache for UI that reads stored user
      try { localStorage.setItem("auth.user", JSON.stringify(updated)); } catch {}
      setMeEmail(updated.email || payload.email);
      setEmailForm({ email: updated.email || payload.email, confirm: "" });
      setEmailMsg("Email updated.");
    } catch (e) {
      setEmailMsg(e?.message || "Failed to update email");
    } finally {
      setEmailSaving(false);
    }
  }

  const pwOkLen = (pwForm.pw || "").length >= 6;
  const pwConfirmOk = pwForm.pw && pwForm.pw === pwForm.confirm;
  const pwScore = scorePassword(pwForm.pw || ""); // 0..4

  async function savePassword() {
    if (!meId || pwSaving) return;
    setPwSaving(true);
    setPwMsg("");
    try {
      if (!pwOkLen || !pwConfirmOk) throw new Error("Please meet the password requirements and confirm.");
      const resp = await api.updateAccount({ password: pwForm.pw }); // PATCH /auth/me
      if (resp?.token && typeof resp.token === "string" && resp.token.trim()) setToken(resp.token); // rotate token just in case
      setPwForm({ pw: "", confirm: "", show: false });
      setPwMsg("Password updated.");
    } catch (e) {
      setPwMsg(e?.message || "Failed to update password");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Scanner & feedback</h2>
        <div className="form">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="cam">Default camera</label>
              <select id="cam" className="input" value={camId} onChange={e => setCamId(e.target.value)}>
                {cameraDevices.length === 0 && <option value="">(No cameras detected)</option>}
                {cameraDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,6)}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="dup">Duplicate/invalid scan</label>
              <select id="dup" className="input" value={dupBehaviour} onChange={e => setDupBehaviour(e.target.value)}>
                <option value="toast">Toast notification</option>
                <option value="overlay">Dim screen + overlay</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="sound">Sound</label>
              <select id="sound" className="input" value={soundOn ? "on" : "off"} onChange={e => setSoundOn(e.target.value === "on")}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="volume">Volume</label>
              <input id="volume" className="input" type="range" min="0" max="1" step="0.05"
                value={volume} onChange={e => setVolume(Number(e.target.value))} />
            </div>
            <div>
              <label className="small muted" htmlFor="haptics">Haptics</label>
              <select id="haptics" className="input" value={haptics ? "on" : "off"} onChange={e => setHaptics(e.target.value === "on")}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={playTest}>Play test sound</button>
            <audio ref={audioRef} preload="auto">
              <source src="/sounds/scan-success.mp3" type="audio/mpeg" />
              <source src="/sounds/scan-success.ogg" type="audio/ogg" />
              <source
                src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAAAAABbAAAAbQAA"
                type="audio/wav"
              />
            </audio>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <h2 className="h2" style={{ marginTop: 0 }}>Interface & accessibility</h2>
        <div className="form">
          <div className="form-row">
            <div>
              <label className="small muted" htmlFor="hc">High contrast</label>
              <select id="hc" className="input" value={highContrast ? "on" : "off"} onChange={e => setHighContrast(e.target.value === "on")}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="lg">Larger text</label>
              <select id="lg" className="input" value={largeText ? "on" : "off"} onChange={e => setLargeText(e.target.value === "on")}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label className="small muted" htmlFor="rm">Reduced motion</label>
              <select id="rm" className="input" value={reducedMotion ? "on" : "off"} onChange={e => setReducedMotion(e.target.value === "on")}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={reset}>Reset preferences</button>
          </div>
        </div>
      </section>

      {/* ---------- Account ---------- */}
      <section className="card">
        <h2 className="h2" style={{ marginTop: 0 }}>My account</h2>

        {meLoading ? (
          <div className="muted small">Loading account…</div>
        ) : meErr ? (
          <div className="small" style={{
            background: "rgba(239,68,68,.12)",
            border: "1px solid rgba(239,68,68,.3)",
            borderRadius: 10, padding: "8px 10px"
          }}>{meErr}</div>
        ) : (
          <div className="form">
            {/* Change Email */}
            <fieldset className="fieldset">
              <legend className="small muted">Change email</legend>
              <div className="form-row">
                <div>
                  <label className="small muted" htmlFor="email">New email</label>
                  <input
                    id="email"
                    type="email"
                    className="input"
                    value={emailForm.email}
                    onChange={e => setEmailForm(v => ({ ...v, email: e.target.value }))}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="small muted" htmlFor="email2">Confirm</label>
                  <input
                    id="email2"
                    type="email"
                    className="input"
                    value={emailForm.confirm}
                    onChange={e => setEmailForm(v => ({ ...v, confirm: e.target.value }))}
                    placeholder="Repeat email"
                  />
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Current: <code style={{ opacity: .85 }}>{meEmail || "—"}</code>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={saveEmail}
                  disabled={emailSaving || !emailDirty || !emailValid || !emailConfirmOk}
                  aria-busy={emailSaving || undefined}
                >
                  {emailSaving ? "Saving…" : "Update email"}
                </button>
              </div>
              {emailMsg && (
                <div className="small" style={{
                  marginTop: 8,
                  background: emailMsg.startsWith("Failed") ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)",
                  border: "1px solid " + (emailMsg.startsWith("Failed") ? "rgba(239,68,68,.3)" : "rgba(16,185,129,.3)"),
                  borderRadius: 10, padding: "8px 10px"
                }}>
                  {emailMsg}
                </div>
              )}
            </fieldset>

            {/* Change Password */}
            <fieldset className="fieldset" style={{ marginTop: 12 }}>
              <legend className="small muted">Change password</legend>
              <div className="form-row">
                <div>
                  <label className="small muted" htmlFor="pw1">New password</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="pw1"
                      type={pwForm.show ? "text" : "password"}
                      className="input"
                      value={pwForm.pw}
                      onChange={e => setPwForm(v => ({ ...v, pw: e.target.value }))}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setPwForm(v => ({ ...v, show: !v.show }))}
                      aria-pressed={pwForm.show}
                      aria-label={pwForm.show ? "Hide password" : "Show password"}
                    >
                      {pwForm.show ? "Hide" : "Show"}
                    </button>
                  </div>
                  {/* strength meter */}
                  <div className="small" style={{ marginTop: 6 }}>
                    <div style={{
                      height: 6, borderRadius: 999, border: "1px solid rgba(255,255,255,.2)",
                      background: "rgba(255,255,255,.05)", overflow: "hidden"
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${(pwScore + 1) * 20}%`,
                        background: pwScore >= 3 ? "rgba(16,185,129,.7)" : pwScore >= 1 ? "rgba(234,179,8,.7)" : "rgba(239,68,68,.7)"
                      }} />
                    </div>
                    <span className="muted">
                      {pwForm.pw ? (pwScore >= 3 ? "Strong" : pwScore >= 2 ? "Okay" : "Weak") : "Enter a password (min 6 chars)"}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="small muted" htmlFor="pw2">Confirm</label>
                  <input
                    id="pw2"
                    type={pwForm.show ? "text" : "password"}
                    className="input"
                    value={pwForm.confirm}
                    onChange={e => setPwForm(v => ({ ...v, confirm: e.target.value }))}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {pwForm.confirm && (pwConfirmOk ? "Match" : "Does not match")}
                  </div>
                </div>
              </div>

              <div className="actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={savePassword}
                  disabled={pwSaving || !pwOkLen || !pwConfirmOk}
                  aria-busy={pwSaving || undefined}
                >
                  {pwSaving ? "Saving…" : "Update password"}
                </button>
              </div>
              {pwMsg && (
                <div className="small" style={{
                  marginTop: 8,
                  background: pwMsg.startsWith("Failed") ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)",
                  border: "1px solid " + (pwMsg.startsWith("Failed") ? "rgba(239,68,68,.3)" : "rgba(16,185,129,.3)"),
                  borderRadius: 10, padding: "8px 10px"
                }}>
                  {pwMsg}
                </div>
              )}
            </fieldset>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------- helpers ---------------- */

function TabButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={"btn" + (active ? "" : " btn-outline")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function HealthTile({ label, status, note }) {
  const text = status === "ok" ? "OK" : status === "fail" ? "Fail" : "Unknown";
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontWeight: 700 }}>{text}</div>
      {note ? <div className="small muted">{note}</div> : null}
    </div>
  );
}

function truthy(v) { return !!v || v === "ok" || v === "true"; }

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, String(v)); } catch {} }
function localRemove(k) { try { localStorage.removeItem(k); } catch {} }
function localGetBool(k, def=false) {
  const v = localGet(k);
  return v == null ? def : v === "true" || v === "1" || v === "on";
}
function clamp01(n) { return Math.max(0, Math.min(1, Number(n))); }

// quick-ish strength scorer: length + diversity
function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNum   = /\d/.test(pw);
  const hasSym   = /[^A-Za-z0-9]/.test(pw);
  const groups = [hasLower, hasUpper, hasNum, hasSym].filter(Boolean).length;
  if (groups >= 2) s++;
  if (groups >= 3) s++;
  return Math.max(0, Math.min(4, s));
}