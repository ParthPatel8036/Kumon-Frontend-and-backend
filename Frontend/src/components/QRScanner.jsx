import { useEffect, useRef, useState, useCallback } from "react";

const STORAGE_KEY_CAMERA = "qr.lastCameraId";

export default function QRScanner({
  onResult,
  disabled = false,
  className = "",
  preferredFacingMode = "environment",
  deviceId, // NEW: preferred camera deviceId (e.g., from Settings)
}) {
  const containerRef = useRef(null);
  const idRef = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const trackRef = useRef(null); // MediaStreamTrack for torch, if available
  const [error, setError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState(() => localStorage.getItem(STORAGE_KEY_CAMERA) || null);
  const [torchOn, setTorchOn] = useState(false);
  const lastTextRef = useRef("");

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    try {
      if (!s) return;
      try { s.pause(true); } catch (_) {}
      await s.stop();
    } catch (_) {
      // ignore
    } finally {
      try { s?.clear(); } catch (_) {}
      scannerRef.current = null;
      trackRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async () => {
    setError(null);
    if (!containerRef.current) return;

    // lazy import
    let Html5Qrcode;
    try {
      ({ Html5Qrcode } = await import("html5-qrcode"));
    } catch (e) {
      setError("Failed to load QR module.");
      return;
    }

    // ensure inner mount node exists
    const mountId = idRef.current;
    if (!containerRef.current.querySelector(`#${mountId}`)) {
      const el = document.createElement("div");
      el.id = mountId;
      el.style.width = "100%";
      el.style.height = "100%";
      containerRef.current.appendChild(el);
    }

    // compute a reasonable qrbox based on current container size
    const rect = containerRef.current.getBoundingClientRect();
    const side = Math.max(180, Math.min(rect.width, rect.height)) * 0.75;
    const qrbox = { width: Math.round(side), height: Math.round(side) };

    const s = new Html5Qrcode(mountId, /* verbose= */ false);
    scannerRef.current = s;

    // prefer prop deviceId, then previously chosen cameraId, otherwise facingMode
    const chosenId = (deviceId && String(deviceId)) || cameraId;
    const constraints = chosenId
      ? { deviceId: { exact: chosenId } }
      : { facingMode: preferredFacingMode };

    try {
      await s.start(
        constraints,
        { fps: 10, qrbox, aspectRatio: 1.0, rememberLastUsedCamera: false },
        (decodedText) => {
          if (!decodedText || decodedText === lastTextRef.current) return;
          lastTextRef.current = decodedText;
          setTimeout(() => { if (lastTextRef.current === decodedText) lastTextRef.current = ""; }, 1200);
          if (!disabled) onResult?.(decodedText);
        },
        () => {}
      );

      // Attempt to get MediaStreamTrack from the internal video
      try {
        const video = containerRef.current.querySelector("video");
        const track = video?.srcObject?.getVideoTracks?.()[0];
        trackRef.current = track || null;
      } catch (_) {
        trackRef.current = null;
      }

      // enumerate cameras for the switcher
      try {
        const devices = await Html5Qrcode.getCameras();
        if (Array.isArray(devices)) {
          setCameras(devices);
          if (cameraId) localStorage.setItem(STORAGE_KEY_CAMERA, cameraId);
        }
      } catch (_) {
        // ignore if enumerate fails
      }

      // Apply torch state if previously set and supported
      if (torchOn) {
        await applyTorch(true);
      }
    } catch (e) {
      setError(e?.message || "Could not start camera.");
      await stopScanner();
    }
  }, [cameraId, deviceId, disabled, preferredFacingMode, onResult, stopScanner, torchOn]);

  // Start / restart on mount & when selection changes (including prop deviceId)
  useEffect(() => {
    startScanner();
    return () => { stopScanner(); };
  }, [startScanner, stopScanner]);

  // Pause/resume when disabled changes
  useEffect(() => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      if (disabled) s.pause(true);
      else s.resume();
    } catch (_) {}
  }, [disabled]);

  // Camera switch from the dropdown
  async function switchCamera(id) {
    if (id === cameraId) return;
    setCameraId(id);
    localStorage.setItem(STORAGE_KEY_CAMERA, id || "");
    await stopScanner();
    await startScanner();
  }

  // Torch toggle (best-effort; only works if device supports it)
  async function applyTorch(on) {
    try {
      const track = trackRef.current;
      if (!track) return false;
      const caps = track.getCapabilities?.();
      if (!caps || !caps.torch) return false;
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      setTorchOn(!!on);
      return true;
    } catch {
      return false;
    }
  }

  async function toggleTorch() {
    const ok = await applyTorch(!torchOn);
    if (!ok) {
      if (!error) setError("Torch not supported on this device/browser.");
    }
  }

  return (
    <div className={`card ${className}`} style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Mount target – video fills parent via inline styles above */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Overlay controls (top-right) */}
      <div style={{
        position: "absolute", top: 8, right: 8, display: "flex", gap: 8, alignItems: "center",
        background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.12)", padding: 6, borderRadius: 10, backdropFilter: "blur(6px)"
      }}>
        {/* Torch */}
        <button type="button" className="icon-btn" aria-pressed={torchOn} onClick={toggleTorch} title="Toggle torch">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 2h10l-1 4H8L7 2zm2 6h6v13a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8z" />
          </svg>
        </button>

        {/* Camera chooser (if multiple) */}
        {cameras.length > 1 && (
          <select
            aria-label="Camera"
            className="input"
            style={{ width: "auto", padding: "6px 8px", borderRadius: 8 }}
            value={cameraId || deviceId || ""}
            onChange={(e) => switchCamera(e.target.value || null)}
          >
            <option value="">Default</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.label || c.id}</option>
            ))}
          </select>
        )}
      </div>

      {/* Error toast-ish message (bottom) */}
      {error && (
        <div className="small" style={{
          position: "absolute", left: 12, right: 12, bottom: 12,
          background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.3)",
          borderRadius: 10, padding: "8px 10px"
        }}>
          {error}
        </div>
      )}
    </div>
  );
}