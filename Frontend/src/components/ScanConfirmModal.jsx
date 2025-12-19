import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { postScanPreview } from "../services/api";

export default function ScanConfirmModal({
  open,
  onClose,
  token,
  type,               // "CHECK_IN" | "CHECK_OUT"
  onSend,             // (messageText|null, recheck:boolean, headcountOnly?:boolean) => void
}) {
  const [tab, setTab] = useState("DEFAULT"); // DEFAULT | CUSTOM
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [student, setStudent] = useState(null);
  const [defaultText, setDefaultText] = useState("");
  const [customText, setCustomText] = useState("");

  // Same-day flags (for either type)
  const [alreadyToday, setAlreadyToday] = useState(false);
  const [lastActionAt, setLastActionAt] = useState(null);
  const [ackRecheck, setAckRecheck] = useState(false);

  // Policy flag from preview: whether SMS will be sent for this type
  const [smsAllowed, setSmsAllowed] = useState(true);

  // NEW: Headcount-only (persisted per device)
  const [headcountOnly, setHeadcountOnly] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pref.headcountOnly") || "false"); }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("pref.headcountOnly", JSON.stringify(headcountOnly)); } catch {}
  }, [headcountOnly]);

  // Focus targets for accessibility
  const sendRef = useRef(null);
  const recheckRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!open || !token) return;
    setLoading(true);
    setErr("");
    setStudent(null);
    setDefaultText("");
    setCustomText("");
    setAlreadyToday(false);
    setLastActionAt(null);
    setAckRecheck(false);
    setSmsAllowed(true);
    setTab("DEFAULT");

    (async () => {
      try {
        // Backend returns: { student, body, smsAllowed, alreadyDoneToday, lastActionAt } (plus legacy fields)
        // NEW: pass headcountOnly so preview reflects suppression accurately
        const data = await postScanPreview(token, type, { headcountOnly });

        if (!alive) return;

        const {
          student: stu,
          body,
          smsAllowed: policyAllowed,
          alreadyDoneToday,
          lastActionAt: genericLast,
          // legacy:
          alreadyCheckedInToday,
          lastCheckInAt,
          alreadyCheckedOutToday,
          lastCheckOutAt,
        } = data || {};

        setStudent(stu || null);
        const text = body || "";
        setDefaultText(text);
        setCustomText(text);

        setSmsAllowed(policyAllowed !== false); // default to true if undefined

        const already =
          typeof alreadyDoneToday === "boolean"
            ? alreadyDoneToday
            : type === "CHECK_IN"
              ? !!alreadyCheckedInToday
              : !!alreadyCheckedOutToday;

        const last =
          genericLast ?? (type === "CHECK_IN" ? lastCheckInAt || null : lastCheckOutAt || null);

        setAlreadyToday(!!already);
        setLastActionAt(last || null);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Could not load preview");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [open, token, type, headcountOnly]); // NEW: re-preview when toggling headcount-only

  const name = useMemo(() => {
    if (!student) return "";
    const f = student.firstName || ""; const l = student.lastName || "";
    return (f + " " + l).trim();
  }, [student]);

  const isCustomTab = tab === "CUSTOM";
  const canSend = isCustomTab ? !!customText : !!defaultText;

  // Interstitial (for both types)
  const showRecheckInterstitial = alreadyToday && !ackRecheck;
  const verbPast = type === "CHECK_IN" ? "checked in" : "checked out";
  const recheckBtn = type === "CHECK_IN" ? "Re-check In" : "Re-check Out";

  // Prefer nicely formatted last timestamp if parseable
  const lastDisplay = useMemo(() => {
    if (!lastActionAt) return null;
    const d = new Date(lastActionAt);
    return isNaN(+d) ? String(lastActionAt) : d.toLocaleString();
  }, [lastActionAt]);

  // NEW: primary label reacts to headcount mode
  const primaryLabel = headcountOnly
    ? (type === "CHECK_IN" ? "Log Check-In (Headcount)" : "Log Check-Out (Headcount)")
    : (smsAllowed ? "Send" : "Record");

  // --- Fancy Headcount Toggle UI (accessible, animated, no external CSS assumptions) ---
  function HeadcountToggle() {
    const active = headcountOnly;
    return (
      <div
        className="card"
        style={{
          marginBottom: 8,
          border: "1px solid rgba(99,102,241,.35)",
          background: active
            ? "linear-gradient(90deg, rgba(16,185,129,.14), rgba(99,102,241,.10))"
            : "linear-gradient(90deg, rgba(99,102,241,.08), rgba(99,102,241,.03))",
          boxShadow: active ? "0 0 0 3px rgba(16,185,129,.20) inset" : "0 1px 2px rgba(0,0,0,.06)",
          display: "grid",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "grid" }}>
            <div style={{ fontWeight: 600 }}>
              {active ? "Headcount-only mode" : "Send SMS on scan"}
            </div>
            <div className="small muted">
              {active
                ? "No SMS will be sent. Scans are recorded for in-centre headcounts."
                : "SMS will be sent according to your policy and message settings."}
            </div>
          </div>

          {/* Accessible switch */}
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setHeadcountOnly(v => !v)}
            title={active ? "Turn off headcount-only" : "Turn on headcount-only"}
            style={{
              position: "relative",
              width: 54,
              height: 30,
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,.12)",
              background: active ? "rgba(16,185,129,.85)" : "rgba(148,163,184,.55)",
              boxShadow: "inset 0 0 0 2px rgba(255,255,255,.25)",
              transition: "background .22s ease",
              outline: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 3,
                left: active ? 28 : 3,
                width: 24,
                height: 24,
                borderRadius: 999,
                background: "white",
                boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                transform: `translateX(${active ? 0 : 0}px)`,
                transition: "left .22s ease",
              }}
            />
          </button>
        </div>

        {/* Status pill */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            className="small"
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              background: active ? "rgba(16,185,129,.14)" : "rgba(148,163,184,.18)",
              border: `1px solid ${active ? "rgba(16,185,129,.35)" : "rgba(148,163,184,.35)"}`,
              fontWeight: 600,
            }}
          >
            {active ? "🔕 SMS suppressed" : "📨 SMS enabled"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirm SMS"
      initialFocusRef={showRecheckInterstitial ? recheckRef : sendRef}
      size="md"
    >
      {/* Interstitial if already done today */}
      {showRecheckInterstitial ? (
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div>
            <strong>{name || "Student"}</strong> has already <strong>{verbPast} today</strong>.
            {lastDisplay ? <> Last {verbPast}: <em>{lastDisplay}</em>.</> : null}
          </div>
          <div className="muted small">
            You can cancel to return to scanning, or choose “{recheckBtn}” to record another entry.
            Previous records will not be overwritten.
          </div>
          <div className="actions" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button
              type="button"
              ref={recheckRef}
              className="btn"
              onClick={() => setAckRecheck(true)}
            >
              {recheckBtn}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* NEW: Headcount-only fancy toggle */}
          {!loading && !err && <HeadcountToggle />}

          {/* Banner: headcount-only OR policy-disabled */}
          {!loading && !err && headcountOnly && (
            <div
              className="card"
              style={{
                marginBottom: 8,
                borderColor: "rgba(16,185,129,.35)",
                background: "rgba(16,185,129,.12)",
              }}
            >
              <strong>Headcount-only enabled.</strong> This action will be recorded, but no SMS will be sent.
            </div>
          )}
          {!loading && !err && !headcountOnly && !smsAllowed && (
            <div
              className="card"
              style={{
                marginBottom: 8,
                borderColor: "rgba(234,179,8,.35)",
                background: "rgba(234,179,8,.12)",
              }}
            >
              <strong>SMS disabled by policy.</strong> This action will be recorded, but no SMS
              will be sent (see Settings → SMS policy).
            </div>
          )}

          {/* Tab switcher */}
          <div className="actions" style={{ justifyContent: "center", marginBottom: 8 }}>
            <button
              type="button"
              className={isCustomTab ? "btn btn-outline" : "btn"}
              aria-pressed={!isCustomTab}
              onClick={() => setTab("DEFAULT")}
              disabled={!smsAllowed || headcountOnly} /* disabled when SMS off or headcount-only */
            >
              Pick Up Message
            </button>
            <button
              type="button"
              className={isCustomTab ? "btn" : "btn btn-outline"}
              aria-pressed={isCustomTab}
              onClick={() => setTab("CUSTOM")}
              disabled={!smsAllowed || headcountOnly}
            >
              Custom Message
            </button>
          </div>

          {/* Status / errors */}
          {loading && <div className="card">Loading…</div>}
          {err && !loading && (
            <div
              className="card"
              style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)" }}
            >
              {err}
            </div>
          )}

          {/* Preview + editor */}
          {!loading && !err && (
            <div className="form" style={{ gap: 10 }}>
              {name && (
                <div className="muted small">
                  Student: <strong>{name}</strong> • Type:{" "}
                  <strong>{type === "CHECK_IN" ? "Check-In" : "Check-Out"}</strong>
                </div>
              )}

              <div className="form-row">
                {/* Default (read-only) */}
                <div>
                  <label className="small muted" htmlFor="defaultMsg">Message (from template)</label>
                  <textarea
                    id="defaultMsg"
                    className="input"
                    style={{ minHeight: 120 }}
                    value={defaultText}
                    readOnly
                    aria-disabled={!smsAllowed || headcountOnly || undefined}
                  />
                  <div className="small muted" style={{ marginTop: 4 }}>Default Text</div>
                </div>

                {/* Custom (enabled only on CUSTOM tab) */}
                <div>
                  <label className="small muted" htmlFor="customMsg">Custom message</label>
                  <textarea
                    id="customMsg"
                    className="input"
                    style={{ minHeight: 120 }}
                    placeholder="Type message"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    disabled={!isCustomTab || !smsAllowed || headcountOnly}
                    aria-disabled={!isCustomTab || !smsAllowed || headcountOnly || undefined}
                  />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {headcountOnly
                      ? "Headcount-only: message text is ignored."
                      : (smsAllowed
                          ? (isCustomTab ? "Custom Text" : 'Enable by clicking "Custom Message".')
                          : "SMS is disabled by policy; text changes won't be sent.")}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="actions" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Back</button>
            <button
              type="button"
              ref={sendRef}
              className="btn"
              disabled={(!canSend && smsAllowed && !headcountOnly) || loading}
              onClick={() => onSend(
                isCustomTab && smsAllowed && !headcountOnly ? customText : null,
                ackRecheck,
                headcountOnly // NEW: bubble up to parent so POST /scan can include it
              )}
            >
              {primaryLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}