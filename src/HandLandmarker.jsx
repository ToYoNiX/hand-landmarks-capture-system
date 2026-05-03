import { useRef, useEffect, useState, useCallback } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { createClient } from "@supabase/supabase-js";
import { LABELS, CATEGORIES, REQUIRED } from "./labels";

// ─── MediaPipe topology ────────────────────────────────────────────────────────
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

// ─── Status constants ──────────────────────────────────────────────────────────
const STATUS = { LOADING: "loading", DETECTING: "detecting", NO_HAND: "no_hand" };
const STATUS_LABELS = { loading: "Loading…", detecting: "Detecting", no_hand: "No hand detected" };
const STATUS_COLORS = { loading: "#f59e0b", detecting: "#22c55e", no_hand: "#ef4444" };

const REC = { IDLE: "idle", RECORDING: "recording", SAVING: "saving", SAVED: "saved", ERROR: "error" };
const REC_LABELS = { idle: "Idle", recording: "REC", saving: "Saving…", saved: "Saved ✓", error: "Error" };
const REC_COLORS = { idle: "#334155", recording: "#dc2626", saving: "#f59e0b", saved: "#22c55e", error: "#7f1d1d" };

// ─── Supabase ──────────────────────────────────────────────────────────────────
const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

// ─── Helpers ───────────────────────────────────────────────────────────────────
function normalizeHand(landmarks) {
  const { x: wx, y: wy, z: wz } = landmarks[0];
  const dx = landmarks[9].x - wx, dy = landmarks[9].y - wy, dz = landmarks[9].z - wz;
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return landmarks.map(({ x, y, z }) => ({
    x: +((x - wx) / scale).toFixed(4),
    y: +((y - wy) / scale).toFixed(4),
    z: +((z - wz) / scale).toFixed(4),
  }));
}

function labelToPath(label) {
  return btoa(unescape(encodeURIComponent(label)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}


// ─── Main component ────────────────────────────────────────────────────────────
export default function HandLandmarkerDemo() {
  const videoRef         = useRef(null);
  const canvasRef        = useRef(null);
  const landmarkerRef    = useRef(null);
  const animFrameRef     = useRef(null);
  const streamRef        = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const isRecordingRef   = useRef(false);
  const frameBufferRef   = useRef([]);
  const resetTimerRef    = useRef(null);
  const dropdownRef      = useRef(null);

  const [status,        setStatus]        = useState(STATUS.LOADING);
  const [landmarkData,  setLandmarkData]  = useState(null);
  const [detectionErr,  setDetectionErr]  = useState(null);

  const [selectedLabel, setSelectedLabel] = useState(null);
  const [mirrorable,    setMirrorable]    = useState(false);
  const [signType,      setSignType]      = useState("dynamic");

  const [dropdownOpen,   setDropdownOpen]   = useState(false);
  const [recStatus,      setRecStatus]      = useState(REC.IDLE);
  const [recError,       setRecError]       = useState(null);
  const [liveFrameCount, setLiveFrameCount] = useState(0);
  const [sessionCount,   setSessionCount]   = useState(0);

  // counts: labelToPath(ar) → number of files in storage
  const [counts, setCounts] = useState({});

  // ── Fetch sample counts from Storage ──────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    async function fetchCounts() {
      const { data, error } = await supabase.storage
        .from("arsl-dataset")
        .list("raw", { limit: 2000 });
      if (error || !data) return;

      const map = {};
      for (const file of data) {
        // filename: {base64urlLabel}-{timestamp}.json
        const match = file.name.match(/^(.+)-\d+\.json$/);
        if (match) map[match[1]] = (map[match[1]] || 0) + 1;
      }
      setCounts(map);
    }
    fetchCounts();
  }, []);

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dropdownOpen]);

  // ── Init MediaPipe ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) { hl.close(); return; }
        landmarkerRef.current = hl;
        setStatus(STATUS.NO_HAND);
      } catch (err) {
        if (!cancelled) setDetectionErr(err.message);
      }
    }
    init();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      clearTimeout(resetTimerRef.current);
    };
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === STATUS.LOADING || detectionErr) return;
    let stopped = false;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      } catch (err) {
        if (!stopped) setDetectionErr("Camera error: " + err.message);
      }
    }
    startCamera();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === STATUS.LOADING, detectionErr]);

  // ── Canvas drawing ─────────────────────────────────────────────────────────
  const drawResults = useCallback((canvas, video, results) => {
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!results.landmarks?.length) return;
    for (const landmarks of results.landmarks) {
      ctx.strokeStyle = "rgba(99,102,241,0.85)";
      ctx.lineWidth = 2;
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
        ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < landmarks.length; i++) {
        ctx.beginPath();
        ctx.arc(landmarks[i].x * canvas.width, landmarks[i].y * canvas.height, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#f59e0b" : "#22c55e";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, []);

  // ── Detection + recording loop ─────────────────────────────────────────────
  const detect = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current, landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detect);
      return;
    }
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const results = landmarker.detectForVideo(video, performance.now());
      const hasHand = !!(results.landmarks?.length);
      setStatus(hasHand ? STATUS.DETECTING : STATUS.NO_HAND);
      drawResults(canvas, video, results);
      setLandmarkData(hasHand
        ? results.landmarks.map(h => h.map(({ x, y, z }) => ({ x: +x.toFixed(4), y: +y.toFixed(4), z: +z.toFixed(4) })))
        : null
      );
      if (isRecordingRef.current) {
        frameBufferRef.current.push({
          hasHand,
          landmarks: hasHand ? results.landmarks[0].map(({ x, y, z }) => ({ x, y, z })) : null,
        });
        setLiveFrameCount(frameBufferRef.current.length);
      }
    }
    animFrameRef.current = requestAnimationFrame(detect);
  }, [drawResults]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay  = () => { animFrameRef.current = requestAnimationFrame(detect); };
    const onPause = () => cancelAnimationFrame(animFrameRef.current);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [detect]);

  // ── Label selection ────────────────────────────────────────────────────────
  function onLabelSelect(label) {
    setSelectedLabel(label);
    setSignType(label.type);
    setMirrorable(label.mirrorable);
    setRecStatus(REC.IDLE);
    setRecError(null);
    setDropdownOpen(false);
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  function toggleRecording() {
    if (recStatus === REC.RECORDING) return stopRecording();
    if (!canRecord) return;
    isRecordingRef.current = true;
    frameBufferRef.current = [];
    setLiveFrameCount(0);
    setRecError(null);
    setRecStatus(REC.RECORDING);
  }

  async function stopRecording() {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    const buffer = frameBufferRef.current;
    frameBufferRef.current = [];

    const firstHand = buffer.findIndex(f => f.hasHand);
    if (firstHand === -1) {
      setRecStatus(REC.ERROR);
      setRecError("No hand detected during recording.");
      return;
    }
    let lastHand = buffer.length - 1;
    while (lastHand > firstHand && !buffer[lastHand].hasHand) lastHand--;
    const trimmed = buffer.slice(firstHand, lastHand + 1).filter(f => f.hasHand);

    const normalised = trimmed.map(f => ({ landmarks: normalizeHand(f.landmarks) }));

    let frames;
    if (signType === "static") {
      const mid = Math.floor(normalised.length / 2);
      const win = normalised.slice(Math.max(0, mid - 2), Math.min(normalised.length, mid + 3));
      frames = [{ landmarks: Array.from({ length: 21 }, (_, i) => ({
        x: +(win.reduce((s, f) => s + f.landmarks[i].x, 0) / win.length).toFixed(4),
        y: +(win.reduce((s, f) => s + f.landmarks[i].y, 0) / win.length).toFixed(4),
        z: +(win.reduce((s, f) => s + f.landmarks[i].z, 0) / win.length).toFixed(4),
      })) }];
    } else {
      frames = normalised;
    }

    const currentLabel = selectedLabel.ar;
    const payload = {
      label: currentLabel,
      type: signType,
      mirrorable,
      captured_at: new Date().toISOString(),
      frame_count: frames.length,
      frames,
    };

    setRecStatus(REC.SAVING);
    try {
      if (!supabase) throw new Error("Supabase not configured.");
      const path = `raw/${labelToPath(currentLabel)}-${Date.now()}.json`;
      const { error: uploadErr } = await supabase.storage
        .from("arsl-dataset")
        .upload(path, JSON.stringify(payload, null, 2), { contentType: "application/json" });
      if (uploadErr) throw uploadErr;

      // Update count locally without re-fetching
      const key = labelToPath(currentLabel);
      setCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));

      setRecStatus(REC.SAVED);
      setSessionCount(c => c + 1);
      resetTimerRef.current = setTimeout(() => setRecStatus(REC.IDLE), 2500);
    } catch (err) {
      console.error("[upload error]", err);
      setRecStatus(REC.ERROR);
      setRecError(err.message);
    }
  }

  const canRecord = !!(
    selectedLabel &&
    status !== STATUS.LOADING &&
    recStatus !== REC.SAVING
  );

  const completedCount = LABELS.filter(l => (counts[labelToPath(l.ar)] || 0) >= REQUIRED).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>

      <div style={s.topBar}>
        <h1 style={s.title}>ARSL Data Collection</h1>
        <div style={s.sessionBadge}>{sessionCount} saved this session</div>
      </div>

      <div style={{ ...s.pill, background: STATUS_COLORS[status] }}>
        <span style={s.pillDot} />
        {STATUS_LABELS[status]}
      </div>

      {detectionErr && <div style={s.errorBox}>{detectionErr}</div>}

      <div style={s.videoWrap}>
        <video ref={videoRef} playsInline muted style={s.video} />
        <canvas ref={canvasRef} style={s.canvas} />
        {recStatus === REC.RECORDING && (
          <div style={s.recBadge}>⬤ REC · {liveFrameCount} frames</div>
        )}
      </div>

      {/* ── Data collection panel ───────────────────────────────────────────── */}
      <div style={{ ...s.panel, overflow: "visible" }}>
        <div style={s.panelHeader}>
          Data Collection
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={s.panelSub}>{completedCount} / {LABELS.length} complete</span>
            <div style={{ ...s.recPill, background: REC_COLORS[recStatus] }}>
              {REC_LABELS[recStatus]}
            </div>
          </div>
        </div>
        <div style={s.panelBody}>

          {/* Sign dropdown */}
          <div ref={dropdownRef} style={s.dropdownWrap}>
            <button
              style={s.dropdownBtn}
              onClick={() => setDropdownOpen(o => !o)}
              disabled={recStatus === REC.RECORDING || recStatus === REC.SAVING}
            >
              {selectedLabel ? (
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span dir="rtl" style={{ fontSize: 18, fontWeight: 700 }}>{selectedLabel.ar}</span>
                  <span style={s.dropdownMeta}>
                    {signType} · {counts[labelToPath(selectedLabel.ar)] || 0} / {REQUIRED}
                  </span>
                </span>
              ) : (
                <span style={{ color: "#475569" }}>Select a sign…</span>
              )}
              <span style={s.dropdownArrow}>{dropdownOpen ? "▲" : "▼"}</span>
            </button>

            {dropdownOpen && (
              <div style={s.dropdownMenu}>
                {CATEGORIES.map(cat => (
                  <div key={cat}>
                    <div style={s.dropdownCat}>{cat}</div>
                    {LABELS.filter(l => l.category === cat).map(l => {
                      const count = counts[labelToPath(l.ar)] || 0;
                      const done  = count >= REQUIRED;
                      const pct   = Math.min(count / REQUIRED, 1);
                      return (
                        <button
                          key={l.ar}
                          style={{
                            ...s.dropdownItem,
                            ...(selectedLabel?.ar === l.ar ? s.dropdownItemActive : {}),
                          }}
                          onClick={() => onLabelSelect(l)}
                        >
                          <span dir="rtl" style={s.dropdownAr}>{l.ar}</span>
                          <span style={s.dropdownRight}>
                            <span style={s.dropdownBar}>
                              <span style={{
                                ...s.dropdownBarFill,
                                width: `${pct * 100}%`,
                                background: done ? "#22c55e" : count > 0 ? "#f59e0b" : "#334155",
                              }} />
                            </span>
                            <span style={{ ...s.dropdownCount, color: done ? "#22c55e" : "#64748b" }}>
                              {count} / {REQUIRED}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reference link — curated URL or YouTube search fallback */}
          {selectedLabel && (() => {
            const url = selectedLabel.videoUrl ??
              `https://www.youtube.com/results?search_query=${encodeURIComponent("لغة الإشارة العربية " + selectedLabel.ar)}`;
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" style={s.refLink}>
                <span style={s.refIcon}>▶</span>
                <span>
                  Watch reference: <span dir="rtl" style={{ fontWeight: 700 }}>{selectedLabel.ar}</span>
                  {!selectedLabel.videoUrl && <span style={s.refFallback}> (YouTube search)</span>}
                </span>
              </a>
            );
          })()}

          {/* Options */}
          <div style={s.optRow}>
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={mirrorable}
                onChange={e => setMirrorable(e.target.checked)}
                disabled={recStatus === REC.RECORDING || recStatus === REC.SAVING}
                style={{ marginRight: 6, accentColor: "#6366f1" }}
              />
              Mirrorable
            </label>
            <div style={s.typeToggle}>
              {["static", "dynamic"].map(t => (
                <button
                  key={t}
                  style={{ ...s.toggleBtn, ...(signType === t ? s.toggleActive : {}) }}
                  onClick={() => setSignType(t)}
                  disabled={recStatus === REC.RECORDING || recStatus === REC.SAVING}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Record button */}
          <button
            style={{
              ...s.recordBtn,
              ...(recStatus === REC.RECORDING ? s.recordBtnActive : {}),
              ...(!canRecord ? s.recordBtnDisabled : {}),
            }}
            onClick={toggleRecording}
            disabled={!canRecord && recStatus !== REC.RECORDING}
          >
            {recStatus === REC.RECORDING
              ? `◉  Stop · ${liveFrameCount} frames`
              : "Start Recording"}
          </button>

          {recStatus === REC.ERROR && recError && (
            <div style={s.recError}>{recError}</div>
          )}
        </div>
      </div>

      {/* ── Raw landmark data ────────────────────────────────────────────────── */}
      <div style={s.panel}>
        <div style={s.panelHeader}>
          Raw Landmark Data
          <span style={s.panelSub}>
            {landmarkData
              ? `${landmarkData.length} hand${landmarkData.length > 1 ? "s" : ""} · 21 points each`
              : "waiting for detection…"}
          </span>
        </div>
        <pre style={s.pre}>
          {landmarkData ? JSON.stringify(landmarkData, null, 2) : "null"}
        </pre>
      </div>

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  root: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
    padding: "24px 16px", fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0f172a", minHeight: "100vh", color: "#e2e8f0",
  },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", maxWidth: 860, gap: 12,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.5 },
  sessionBadge: {
    background: "#1e293b", border: "1px solid #334155", borderRadius: 9999,
    padding: "4px 12px", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap",
  },
  pill: {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 16px",
    borderRadius: 9999, fontSize: 13, fontWeight: 600, color: "#fff",
    textTransform: "uppercase", letterSpacing: 0.5, transition: "background 0.3s",
  },
  pillDot: { width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.7)", display: "inline-block" },
  errorBox: {
    background: "#7f1d1d", color: "#fca5a5", padding: "10px 20px",
    borderRadius: 8, fontSize: 14, maxWidth: 860, width: "100%", textAlign: "center",
  },
  videoWrap: {
    position: "relative", width: "100%", maxWidth: 860, aspectRatio: "16/9",
    background: "#1e293b", borderRadius: 12, overflow: "hidden",
    boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
  },
  video:  { width: "100%", height: "100%", objectFit: "cover", display: "block", transform: "scaleX(-1)" },
  canvas: { position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" },
  recBadge: {
    position: "absolute", top: 12, left: 12,
    background: "rgba(220,38,38,0.88)", backdropFilter: "blur(4px)",
    color: "#fff", padding: "4px 12px", borderRadius: 9999,
    fontSize: 13, fontWeight: 700, letterSpacing: 0.5, pointerEvents: "none",
  },
  panel: {
    width: "100%", maxWidth: 860, background: "#1e293b", borderRadius: 12,
    overflow: "hidden", boxShadow: "0 2px 16px rgba(0,0,0,0.3)",
  },
  panelHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 16px", background: "#0f172a",
    fontSize: 13, fontWeight: 600, borderBottom: "1px solid #334155",
    gap: 8, borderRadius: "12px 12px 0 0",
  },
  recPill: {
    padding: "3px 10px", borderRadius: 9999, fontSize: 11, fontWeight: 700,
    color: "#fff", letterSpacing: 0.5, textTransform: "uppercase", transition: "background 0.2s",
    flexShrink: 0,
  },
  panelSub: { fontWeight: 400, color: "#94a3b8", fontSize: 12 },
  // dropdown
  dropdownWrap: { position: "relative", width: "100%" },
  dropdownBtn: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 8, color: "#e2e8f0", fontSize: 14, cursor: "pointer",
    fontFamily: "inherit", transition: "border-color 0.15s",
  },
  dropdownMeta: { fontSize: 12, color: "#64748b", marginLeft: 4 },
  dropdownArrow: { fontSize: 10, color: "#64748b", marginLeft: 8, flexShrink: 0 },
  dropdownMenu: {
    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
    background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    maxHeight: 320, overflowY: "auto",
  },
  dropdownCat: {
    padding: "8px 14px 4px",
    fontSize: 10, fontWeight: 700, letterSpacing: 1,
    textTransform: "uppercase", color: "#475569",
  },
  dropdownItem: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 14px", background: "transparent", border: "none",
    color: "#e2e8f0", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
    transition: "background 0.1s", textAlign: "left",
  },
  dropdownItemActive: { background: "#1e1b4b" },
  dropdownAr: { fontSize: 17, fontWeight: 600 },
  dropdownRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  dropdownBar: {
    width: 60, height: 4, background: "#0f172a", borderRadius: 9999,
    overflow: "hidden", display: "inline-block",
  },
  dropdownBarFill: { display: "block", height: "100%", borderRadius: 9999, transition: "width 0.3s" },
  dropdownCount: { fontSize: 11, fontWeight: 600, minWidth: 40, textAlign: "right" },
  refLink: {
    display: "flex", alignItems: "center", gap: 10,
    background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
    padding: "10px 14px", color: "#a5b4fc", fontSize: 13,
    textDecoration: "none", transition: "border-color 0.15s",
  },
  refIcon: { fontSize: 16, flexShrink: 0 },
  refFallback: { color: "#475569", fontSize: 11 },

  // panel body
  panelBody: { display: "flex", flexDirection: "column", gap: 12, padding: 16 },
  optRow: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  checkLabel: {
    display: "flex", alignItems: "center", fontSize: 14,
    color: "#94a3b8", cursor: "pointer", userSelect: "none",
  },
  typeToggle: { display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #334155" },
  toggleBtn: {
    padding: "6px 18px", background: "transparent", border: "none",
    color: "#64748b", fontSize: 13, fontWeight: 500, cursor: "pointer",
    transition: "background 0.15s, color 0.15s", fontFamily: "inherit",
  },
  toggleActive: { background: "#6366f1", color: "#fff" },
  recordBtn: {
    width: "100%", padding: "14px 24px", background: "#0f172a",
    border: "2px solid #334155", borderRadius: 10, color: "#e2e8f0",
    fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
    userSelect: "none", fontFamily: "inherit", letterSpacing: 0.3,
  },
  recordBtnActive:   { background: "#450a0a", borderColor: "#dc2626", color: "#fca5a5" },
  recordBtnDisabled: { opacity: 0.35, cursor: "not-allowed" },
  recError: { background: "#450a0a", color: "#fca5a5", borderRadius: 8, padding: "8px 12px", fontSize: 13 },

  // landmark panel
  pre: {
    margin: 0, padding: "12px 16px", fontSize: 11, lineHeight: 1.6,
    overflowY: "auto", maxHeight: 280, color: "#7dd3fc",
    fontFamily: "'Fira Code', 'Cascadia Code', monospace",
    whiteSpace: "pre-wrap", wordBreak: "break-all",
  },
};
