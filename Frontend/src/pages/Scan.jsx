// src/pages/Scan.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRScanner from "../components/QRScanner";
import ScanConfirmModal from "../components/ScanConfirmModal";
import { postScan } from "../services/api";

/* ---------- local prefs helpers (match Settings.jsx keys) ---------- */
function pget(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }
function pbool(k, d = false) { const v = pget(k, null); return v == null ? d : (v === "true" || v === "1" || v === "on"); }
function pnum(k, d = 0) { const v = Number(pget(k, NaN)); return Number.isFinite(v) ? v : d; }

function parseToken(raw) {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.token === "string" && o.token.length) return o.token;
  } catch {}
  return raw && raw.trim() ? raw.trim() : null;
}

export default function Scan() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState("CHECK_IN");
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { token }

  // My Preferences (read once on mount; can be refreshed on demand if needed)
  const [dupBehaviour] = useState(pget("pref.dupBehaviour", "toast")); // 'toast' | 'overlay'
  const [soundOn] = useState(pbool("pref.soundOn", true));
  const [volume] = useState(pnum("pref.volume", 0.8));
  const [haptics] = useState(pbool("pref.haptics", true));
  const [camId] = useState(pget("pref.cameraId", "")); // preferred camera id (may be ignored by QRScanner if unsupported)

  // Overlay feedback (for invalid/duplicate when behaviour = overlay)
  const [overlayMsg, setOverlayMsg] = useState("");
  const overlayTimer = useRef(null);

  // Audio feedback
  const beepRef = useRef(null);
  const failRef = useRef(null);

  // Support /scan?type=CHECK_IN or CHECK_OUT
  useEffect(() => {
    const t = (params.get("type") || "").toUpperCase();
    if (t === "CHECK_IN" || t === "CHECK_OUT") setMode(t);
  }, [params]);

  useEffect(() => () => { if (overlayTimer.current) clearTimeout(overlayTimer.current); }, []);

  const playFeedback = useCallback((ok = true) => {
    if (soundOn) {
      const el = ok ? beepRef.current : failRef.current;
      if (el) {
        try {
          el.volume = Math.max(0, Math.min(1, volume));
          el.currentTime = 0;
          el.play().catch(() => {});
        } catch {}
      }
    }
    if (haptics && "vibrate" in navigator) {
      navigator.vibrate?.(ok ? 40 : 120);
    }
  }, [soundOn, volume, haptics]);

  const showOverlay = useCallback((msg) => {
    setOverlayMsg(msg);
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setOverlayMsg(""), 1200);
  }, []);

  const onResult = useCallback((text) => {
    const token = parseToken(text);
    if (!token) {
      if (dupBehaviour === "overlay") {
        showOverlay("Invalid QR");
        playFeedback(false);
      } else {
        setLast({ text, ok: false, message: "Invalid QR" });
        playFeedback(false);
      }
      return;
    }
    setPending({ token });
  }, [dupBehaviour, showOverlay, playFeedback]);

  async function handleSend(messageOverride, recheck, headcountOnly) {
    if (!pending?.token || busy) return;
    setBusy(true);
    try {
      await postScan({
        token: pending.token,
        type: mode,
        messageOverride: messageOverride || undefined,
        recheck: recheck === true,
        headcountOnly: !!headcountOnly,
      });
      setLast({
        text: pending.token,
        ok: true,
        message: mode === "CHECK_IN" ? (recheck ? "Re-check in recorded" : "Checked in") : "Checked out",
      });
      playFeedback(true);
    } catch (e) {
      setLast({ text: pending.token, ok: false, message: e?.message || "Scan failed" });
      playFeedback(false);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <>
      <header style={{ marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Scan</h1>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Align the QR within the frame. A preview will appear before sending.
        </p>
      </header>

      <div className="scan-wrap" style={{ position: "relative" }}>
        {/* Video / camera region */}
        <div className="scan-video" style={{ position: "relative" }}>
          <QRScanner disabled={busy} onResult={onResult} deviceId={camId || undefined} />
          {overlayMsg && (
            <div
              role="status"
              aria-live="assertive"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                backdropFilter: "blur(1px)",
                background: "rgba(0,0,0,0.35)",
                color: "white",
                fontWeight: 700,
                fontSize: 18,
                textAlign: "center",
              }}
            >
              {overlayMsg}
            </div>
          )}
        </div>

        {/* Sticky actions bar */}
        <div className="scan-actions">
          <div className="actions" style={{ margin: 0 }}>
            <button
              type="button"
              className={"btn" + (mode === "CHECK_IN" ? "" : " btn-outline")}
              aria-pressed={mode === "CHECK_IN"}
              onClick={() => setMode("CHECK_IN")}
              disabled={busy}
            >
              Check-In
            </button>
            <button
              type="button"
              className={"btn" + (mode === "CHECK_OUT" ? "" : " btn-outline")}
              aria-pressed={mode === "CHECK_OUT"}
              onClick={() => setMode("CHECK_OUT")}
              disabled={busy}
            >
              Check-Out
            </button>

            <span className="spacer" />

            {pending && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {last && (
        <div
          className="card"
          role="status"
          aria-live="polite"
          style={{
            marginTop: 12,
            borderColor: last.ok ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)",
            background: last.ok ? "rgba(34,197,94,.06)" : "rgba(239,68,68,.06)",
          }}
        >
          <strong>{last.ok ? "Success" : "Error"}:</strong> {last.message}
          <br />
          <small className="muted">{last.text}</small>
        </div>
      )}

      <ScanConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        token={pending?.token}
        type={mode}
        onSend={handleSend}
      />

      {/* hidden audio for feedback */}
      <audio ref={beepRef} preload="auto">
        <source src="/sounds/scan-success.mp3" type="audio/mpeg" />
        <source src="/sounds/scan-success.ogg" type="audio/ogg" />
        {/* fallback to the built-in tiny beep if the above aren't found */}
        <source src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAAAAABbAAAAbQAA" type="audio/wav" />
      </audio>

      {/* hidden failure audio for feedback */}
      <audio ref={failRef} preload="auto">
        <source src="/sounds/scan-fail.mp3" type="audio/mpeg" />
        <source src="/sounds/scan-fail.ogg" type="audio/ogg" />
        {/* fallback tone if files are missing (will sound similar to success unless custom files are provided) */}
        <source src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYAAAAAAABbAAAAbQAA" type="audio/wav" />
      </audio>
    </>
  );
}