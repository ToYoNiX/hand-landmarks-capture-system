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

const MODE = { CAMERA: "camera", UPLOAD: "upload" };

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

function toRoundedLandmarks(landmarks) {
  return landmarks.map(({ x, y, z }) => ({
    x: +x.toFixed(4),
    y: +y.toFixed(4),
    z: +z.toFixed(4),
  }));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function HandLandmarkerDemo() {
  const videoRef           = useRef(null);
  const canvasRef          = useRef(null);
  const landmarkerRef      = useRef(null);
  const animFrameRef       = useRef(null);
  const streamRef          = useRef(null);
  const lastVideoTimeRef   = useRef(-1);
  const isRecordingRef     = useRef(false);
  const frameBufferRef     = useRef([]);
  const resetTimerRef      = useRef(null);
  const staticTimerRef     = useRef(null);
  const dropdownRef        = useRef(null);
  const fileInputRef       = useRef(null);
  const imgPreviewRef      = useRef(null);
  const imgQueueRef        = useRef([]);
  const imgCursorRef       = useRef(0);
  const imgProcessingRef   = useRef(false);
  const isSwitchingModeRef = useRef(false);
  const captureModeRef     = useRef(MODE.CAMERA);

  const [status,        setStatus]        = useState(STATUS.LOADING);
  const [landmarkData,  setLandmarkData]  = useState(null);
  const [detectionErr,  setDetectionErr]  = useState(null);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [mirrorable,    setMirrorable]    = useState(false);
  const [signType,      setSignType]      = useState("dynamic");
  const [customLabel,   setCustomLabel]   = useState("");
  const [dropdownOpen,  setDropdownOpen]  = useState(false);
  const [recStatus,     setRecStatus]     = useState(REC.IDLE);
  const [recError,      setRecError]      = useState(null);
  const [liveFrameCount, setLiveFrameCount] = useState(0);
  const [sessionCount,  setSessionCount]  = useState(0);
  const [counts, setCounts] = useState({});
  const [captureMode,   setCaptureMode]   = useState(MODE.CAMERA);
  const [imgQueue,      setImgQueue]      = useState([]);
  const [imgCursor,     setImgCursor]     = useState(0);
  const [imgSaveStatus, setImgSaveStatus] = useState(REC.IDLE);
  const [imgSaveError,  setImgSaveError]  = useState(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [staticCountdown, setStaticCountdown] = useState(0);
  const [pendingStatic, setPendingStatic] = useState(null);

  // ── Fetch sample counts from Storage ──────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    async function fetchCounts() {
      const map = {};
      const limit = 1000;
      let offset = 0;

      while (true) {
        const { data, error } = await supabase.storage
          .from("arsl-dataset")
          .list("raw", { limit, offset });
        if (error || !data) return;

        for (const file of data) {
          if (!file.name || file.name === ".emptyFolderPlaceholder") continue;
          const match = file.name.match(/^(.+)-.+\.json$/);
          if (match) map[match[1]] = (map[match[1]] || 0) + 1;
        }

        if (data.length < limit) break;
        offset += limit;
      }

      setCounts(map);
    }
    fetchCounts();
  }, []);

  useEffect(() => {
    if (!supabase || !selectedLabel || selectedLabel.custom) return;
    let cancelled = false;
    async function fetchSelectedCount() {
      const key = labelToPath(selectedLabel.ar);
      const limit = 1000;
      let offset = 0;
      let count = 0;

      while (true) {
        const { data, error } = await supabase.storage
          .from("arsl-dataset")
          .list("raw", { limit, offset });
        if (error || !data) return;

        for (const file of data) {
          if (!file.name || file.name === ".emptyFolderPlaceholder") continue;
          if (file.name.startsWith(`${key}-`)) count += 1;
        }

        if (data.length < limit) break;
        offset += limit;
      }

      if (!cancelled) {
        setCounts(prev => ({ ...prev, [key]: count }));
      }
    }

    fetchSelectedCount();
    return () => { cancelled = true; };
  }, [selectedLabel]);

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dropdownOpen]);

  useEffect(() => {
    imgQueueRef.current = imgQueue;
  }, [imgQueue]);

  useEffect(() => {
    imgCursorRef.current = imgCursor;
  }, [imgCursor]);

  useEffect(() => {
    captureModeRef.current = captureMode;
  }, [captureMode]);

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
        if (cancelled) {
          hl.close();
          return;
        }
        landmarkerRef.current = hl;
        setStatus(STATUS.NO_HAND);
      } catch (err) {
        if (!cancelled) setDetectionErr(err.message);
      }
    }
    init();
    return () => {
      cancelled = true;
      imgQueueRef.current.forEach(entry => URL.revokeObjectURL(entry.objectUrl));
      landmarkerRef.current?.close();
      clearTimeout(resetTimerRef.current);
      clearTimeout(staticTimerRef.current);
    };
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === STATUS.LOADING || detectionErr || captureMode !== MODE.CAMERA) return;
    let stopped = false;
    async function startCamera() {
      try {
        const video = videoRef.current;
        if (!video) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
        });
        if (stopped) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        if (!stopped) setDetectionErr("Camera error: " + err.message);
      }
    }
    startCamera();
    const video = videoRef.current;
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (video) video.srcObject = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === STATUS.LOADING, detectionErr, captureMode]);

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

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ── Detection + recording loop ─────────────────────────────────────────────
  const detect = useCallback(function detectFrame() {
    if (captureModeRef.current !== MODE.CAMERA) return;
    if (isSwitchingModeRef.current) {
      animFrameRef.current = requestAnimationFrame(detectFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(detectFrame);
      return;
    }
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const results = landmarker.detectForVideo(video, video.currentTime * 1000);
      const hasHand = !!(results.landmarks?.length);
      setStatus(hasHand ? STATUS.DETECTING : STATUS.NO_HAND);
      drawResults(canvas, video, results);
      setLandmarkData(hasHand ? results.landmarks.map(h => toRoundedLandmarks(h)) : null);
      if (isRecordingRef.current) {
        frameBufferRef.current.push({
          hasHand,
          landmarks: hasHand ? results.landmarks[0].map(({ x, y, z }) => ({ x, y, z })) : null,
        });
        setLiveFrameCount(frameBufferRef.current.length);
      }
    }
    animFrameRef.current = requestAnimationFrame(detectFrame);
  }, [drawResults]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => { animFrameRef.current = requestAnimationFrame(detect); };
    const onPause = () => cancelAnimationFrame(animFrameRef.current);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [detect]);

  async function switchLandmarkerMode(targetMode) {
    if (!landmarkerRef.current) return;
    isSwitchingModeRef.current = true;
    try {
      await landmarkerRef.current.setOptions({ runningMode: targetMode });
    } finally {
      isSwitchingModeRef.current = false;
    }
  }

  function setImageQueue(nextQueue) {
    imgQueueRef.current = nextQueue;
    setImgQueue(nextQueue);
  }

  function clearImageQueue() {
    imgQueueRef.current.forEach(entry => URL.revokeObjectURL(entry.objectUrl));
    setImageQueue([]);
    setImgCursor(0);
    setImgSaveStatus(REC.IDLE);
    setImgSaveError(null);
  }

  async function uploadSample(frames, label, type, mirrorableFlag) {
    if (!supabase) throw new Error("Supabase not configured.");
    const uploadStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = {
      label: label.ar,
      type,
      mirrorable: mirrorableFlag,
      captured_at: new Date().toISOString(),
      frame_count: frames.length,
      frames,
    };
    const path = `raw/${labelToPath(label.ar)}-${uploadStamp}.json`;
    const { error } = await supabase.storage
      .from("arsl-dataset")
      .upload(path, JSON.stringify(payload, null, 2), { contentType: "application/json" });
    if (error) throw error;
    const key = labelToPath(label.ar);
    setCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    setSessionCount(c => c + 1);
  }

  async function handleSwitchMode(mode) {
    if (mode === captureMode) return;
    if (recStatus === REC.RECORDING) await stopRecording();

    isSwitchingModeRef.current = true;
    captureModeRef.current = mode;
    setDropdownOpen(false);
    setLandmarkData(null);
    setPendingStatic(null);
    setStatus(STATUS.NO_HAND);
    clearCanvas();

    try {
      if (mode === MODE.UPLOAD) {
        setCaptureMode(MODE.UPLOAD);
        clearImageQueue();
        await switchLandmarkerMode("IMAGE");
      } else {
        clearImageQueue();
        setCaptureMode(MODE.CAMERA);
        lastVideoTimeRef.current = -1;
        await switchLandmarkerMode("VIDEO");
      }
    } finally {
      isSwitchingModeRef.current = false;
    }
  }

  function enqueueFiles(fileList) {
    const entries = Array.from(fileList)
      .filter(file => file.type.startsWith("image/"))
      .map(file => ({
        file,
        objectUrl: URL.createObjectURL(file),
        landmarks: null,
        status: "pending",
      }));
    if (!entries.length) return;
    const next = [...imgQueueRef.current, ...entries];
    setImageQueue(next);
    processQueue();
  }

  async function processQueue() {
    if (imgProcessingRef.current) return;
    imgProcessingRef.current = true;
    try {
      while (true) {
        if (captureModeRef.current !== MODE.UPLOAD) break;
        const idx = imgQueueRef.current.findIndex(entry => entry.status === "pending");
        if (idx === -1) break;
        if (isSwitchingModeRef.current) {
          await delay(50);
          continue;
        }
        const landmarker = landmarkerRef.current;
        if (!landmarker) {
          await delay(50);
          continue;
        }

        const entry = imgQueueRef.current[idx];
        if (!entry || entry.status !== "pending") continue;

        let imageSource = null;
        try {
          if (entry.file) {
            imageSource = await createImageBitmap(entry.file, { imageOrientation: "from-image" });
          }
        } catch {
          imageSource = null;
        }

        if (!imageSource) {
          const img = new Image();
          img.src = entry.objectUrl;
          await new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          });
          imageSource = img;
        }

        if (captureModeRef.current !== MODE.UPLOAD || isSwitchingModeRef.current) break;
        if (imgQueueRef.current[idx] !== entry) continue;

        let landmarks = null;
        try {
          const results = landmarker.detect(imageSource);
          landmarks = results.landmarks?.[0]?.map(({ x, y, z }) => ({ x, y, z })) ?? null;
        } catch {
          landmarks = null;
        } finally {
          if (imageSource && imageSource.close) imageSource.close();
        }

        if (captureModeRef.current !== MODE.UPLOAD || imgQueueRef.current[idx] !== entry) continue;

        const updatedEntry = {
          ...entry,
          landmarks,
          status: landmarks ? "ok" : "error",
        };
        const next = imgQueueRef.current.map((currentEntry, currentIdx) => (
          currentIdx === idx ? updatedEntry : currentEntry
        ));
        setImageQueue(next);

        if (idx === imgCursorRef.current) {
          const currentImg = imgPreviewRef.current;
          if (currentImg && landmarks) {
            drawResultsForImage(currentImg, landmarks);
            setLandmarkData([toRoundedLandmarks(landmarks)]);
          } else {
            clearCanvas();
            setLandmarkData(null);
          }
        }
      }
    } finally {
      imgProcessingRef.current = false;
    }
  }

  function drawResultsForImage(imgEl, landmarks) {
    if (!canvasRef.current || !imgEl) return;
    drawResults(
      canvasRef.current,
      { videoWidth: imgEl.naturalWidth, videoHeight: imgEl.naturalHeight },
      { landmarks: landmarks ? [landmarks] : [] }
    );
  }

  function onLabelSelect(label) {
    setSelectedLabel(label);
    setSignType(label.type);
    setMirrorable(label.mirrorable);
    setRecStatus(REC.IDLE);
    setRecError(null);
    setPendingStatic(null);
    setDropdownOpen(false);
  }

  function onCustomSelect() {
    setSelectedLabel({ ar: "Custom", type: "dynamic", mirrorable: false, custom: true });
    setSignType("dynamic");
    setMirrorable(false);
    setCustomLabel("");
    setRecStatus(REC.IDLE);
    setRecError(null);
    setPendingStatic(null);
    setDropdownOpen(false);
  }

  function getActiveLabel() {
    if (!selectedLabel) return null;
    if (selectedLabel.custom) {
      const trimmed = customLabel.trim();
      if (!trimmed) return null;
      return { ar: trimmed, type: signType, mirrorable };
    }
    return selectedLabel;
  }

  function toggleRecording() {
    if (signType === "static") {
      if (!canRecord || staticCountdown > 0) return;
      return startStaticCapture();
    }
    if (recStatus === REC.RECORDING) return stopRecording();
    if (!canRecord) return;
    isRecordingRef.current = true;
    frameBufferRef.current = [];
    setLiveFrameCount(0);
    setRecError(null);
    setRecStatus(REC.RECORDING);
  }

  async function startStaticCapture() {
    setRecError(null);
    setRecStatus(REC.RECORDING);
    setStaticCountdown(3);

    let remaining = 3;
    const tick = () => {
      remaining -= 1;
      setStaticCountdown(remaining);
      if (remaining > 0) {
        staticTimerRef.current = setTimeout(tick, 1000);
        return;
      }
      captureStaticFrame();
    };

    staticTimerRef.current = setTimeout(tick, 1000);
  }

  async function captureStaticFrame() {
    const activeLabel = getActiveLabel();
    const firstHand = landmarkData?.[0] || null;
    if (!activeLabel) {
      setRecStatus(REC.IDLE);
      setStaticCountdown(0);
      return;
    }
    if (!firstHand) {
      setRecStatus(REC.ERROR);
      setRecError("No hand detected during capture.");
      setStaticCountdown(0);
      return;
    }
    setPendingStatic(normalizeHand(firstHand));
    setRecStatus(REC.IDLE);
    setStaticCountdown(0);
  }

  async function saveStaticCapture() {
    const activeLabel = getActiveLabel();
    if (!activeLabel || !pendingStatic) return;
    setRecStatus(REC.SAVING);
    try {
      const frames = [{ landmarks: pendingStatic }];
      await uploadSample(frames, activeLabel, signType, mirrorable);
      setRecStatus(REC.SAVED);
      setPendingStatic(null);
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setRecStatus(REC.IDLE), 2500);
    } catch (err) {
      console.error("[upload error]", err);
      setRecStatus(REC.ERROR);
      setRecError(err.message);
    }
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

    const activeLabel = getActiveLabel();
    if (!activeLabel) return;

    setRecStatus(REC.SAVING);
    try {
      await uploadSample(frames, activeLabel, signType, mirrorable);
      setRecStatus(REC.SAVED);
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setRecStatus(REC.IDLE), 2500);
    } catch (err) {
      console.error("[upload error]", err);
      setRecStatus(REC.ERROR);
      setRecError(err.message);
    }
  }

  function commitCurrent() {
    const entry = imgQueue[imgCursor];
    const activeLabel = getActiveLabel();
    if (!entry?.landmarks || !activeLabel) return;
    setImgSaveStatus(REC.SAVING);
    setImgSaveError(null);
    uploadSample([{ landmarks: normalizeHand(entry.landmarks) }], activeLabel, signType, mirrorable)
      .then(() => {
        setImgSaveStatus(REC.SAVED);
        removeImages(item => item === entry);
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => setImgSaveStatus(REC.IDLE), 2500);
      })
      .catch(err => {
        setImgSaveStatus(REC.ERROR);
        setImgSaveError(err.message);
      });
  }

  async function commitAllValid() {
    const valid = imgQueue.filter(entry => entry.landmarks);
    const activeLabel = getActiveLabel();
    if (!valid.length || !activeLabel) return;
    setImgSaveStatus(REC.SAVING);
    setImgSaveError(null);
    try {
      for (const entry of valid) {
        await uploadSample([{ landmarks: normalizeHand(entry.landmarks) }], activeLabel, signType, mirrorable);
        await delay(50);
      }
      setImgSaveStatus(REC.SAVED);
      removeImages(entry => !!entry.landmarks);
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setImgSaveStatus(REC.IDLE), 2500);
    } catch (err) {
      setImgSaveStatus(REC.ERROR);
      setImgSaveError(err.message);
    }
  }

  function renderSignDropdown(disabled) {
    const isCustom = !!selectedLabel?.custom;
    return (
      <>
        <div ref={dropdownRef} style={s.dropdownWrap}>
          <button
            style={s.dropdownBtn}
            onClick={() => setDropdownOpen(o => !o)}
            disabled={disabled}
          >
            {selectedLabel ? (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span dir="rtl" style={{ fontSize: 18, fontWeight: 700 }}>
                  {selectedLabel.custom ? (customLabel || "Custom sign") : selectedLabel.ar}
                </span>
                <span style={s.dropdownMeta}>
                  {selectedLabel.custom
                    ? `${signType} · custom`
                    : `${signType} · ${counts[labelToPath(selectedLabel.ar)] || 0} / ${REQUIRED}`}
                </span>
              </span>
            ) : (
              <span style={{ color: "#475569" }}>Select a sign…</span>
            )}
            <span style={s.dropdownArrow}>{dropdownOpen ? "▲" : "▼"}</span>
          </button>

          {dropdownOpen && (
            <div style={s.dropdownMenu}>
              <button
                style={{
                  ...s.dropdownItem,
                  ...(selectedLabel?.custom ? s.dropdownItemActive : {}),
                }}
                onClick={onCustomSelect}
              >
                <span style={s.dropdownAr}>Custom…</span>
                <span style={s.dropdownRight}>
                  <span style={s.dropdownCount}>Type your own</span>
                </span>
              </button>
              <div style={s.dropdownDivider} />
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

        {selectedLabel && !isCustom && (() => {
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
      </>
    );
  }

  function onSelectFiles(fileList) {
    enqueueFiles(fileList);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onDropFiles(event) {
    event.preventDefault();
    setIsDraggingOver(false);
    onSelectFiles(event.dataTransfer.files);
  }

  function moveCursor(delta) {
    if (!imgQueue.length) return;
    const next = (imgCursor + delta + imgQueue.length) % imgQueue.length;
    setImgCursor(next);
  }

  function deleteImageAt(index) {
    const entry = imgQueueRef.current[index];
    if (!entry) return;
    URL.revokeObjectURL(entry.objectUrl);
    const next = imgQueueRef.current.filter((_, i) => i !== index);
    setImageQueue(next);
    if (!next.length) {
      setImgCursor(0);
      clearCanvas();
      return;
    }
    const nextCursor = Math.min(imgCursorRef.current, next.length - 1);
    setImgCursor(nextCursor);
  }

  function removeImages(predicate) {
    const next = [];
    for (const entry of imgQueueRef.current) {
      if (predicate(entry)) {
        URL.revokeObjectURL(entry.objectUrl);
      } else {
        next.push(entry);
      }
    }
    setImageQueue(next);
    if (!next.length) {
      setImgCursor(0);
      clearCanvas();
      return;
    }
    const nextCursor = Math.min(imgCursorRef.current, next.length - 1);
    setImgCursor(nextCursor);
  }

  const activeLabel = getActiveLabel();
  const isCustom = !!selectedLabel?.custom;
  const canRecord = !!(
    captureMode === MODE.CAMERA &&
    activeLabel &&
    status !== STATUS.LOADING &&
    recStatus !== REC.SAVING &&
    staticCountdown === 0
  );
  const canSaveStatic = !!(
    signType === "static" &&
    pendingStatic &&
    activeLabel &&
    recStatus !== REC.SAVING
  );

  const completedCount = LABELS.filter(l => (counts[labelToPath(l.ar)] || 0) >= REQUIRED).length;
  const currentUploadEntry = captureMode === MODE.UPLOAD ? imgQueue[imgCursor] || null : null;
  const validUploadCount = imgQueue.filter(entry => entry.landmarks).length;
  const displayLandmarkData = pendingStatic ? [pendingStatic] : landmarkData;
  const uploadStatus = !currentUploadEntry
    ? STATUS.NO_HAND
    : currentUploadEntry.status === "ok"
      ? STATUS.DETECTING
      : currentUploadEntry.status === "error"
        ? STATUS.NO_HAND
        : STATUS.LOADING;
  const displayStatus = captureMode === MODE.UPLOAD ? uploadStatus : status;

  useEffect(() => {
    if (captureMode !== MODE.UPLOAD) return;
    if (!currentUploadEntry || currentUploadEntry.status === "pending") {
      clearCanvas();
      return;
    }
    const img = imgPreviewRef.current;
    if (!img || !img.complete || !img.naturalWidth) return;
    drawResultsForImage(img, currentUploadEntry.landmarks);
    setLandmarkData(currentUploadEntry.landmarks ? [toRoundedLandmarks(currentUploadEntry.landmarks)] : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureMode, imgCursor, imgQueue]);

  useEffect(() => {
    return () => {
      imgQueueRef.current.forEach(entry => URL.revokeObjectURL(entry.objectUrl));
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <div style={s.topBar}>
        <h1 style={s.title}>ARSL Data Collection</h1>
        <div style={s.sessionBadge}>{sessionCount} saved this session</div>
      </div>

      <div style={{ ...s.pill, background: STATUS_COLORS[displayStatus] }}>
        <span style={s.pillDot} />
        {STATUS_LABELS[displayStatus]}
      </div>

      {detectionErr && <div style={s.errorBox}>{detectionErr}</div>}

      <div style={s.modeTabs}>
        {[MODE.CAMERA, MODE.UPLOAD].map(mode => (
          <button
            key={mode}
            style={{ ...s.modeTab, ...(captureMode === mode ? s.modeTabActive : {}) }}
            onClick={() => handleSwitchMode(mode)}
            disabled={recStatus === REC.RECORDING || recStatus === REC.SAVING || imgSaveStatus === REC.SAVING}
          >
            {mode === MODE.CAMERA ? "Camera" : "Upload Images"}
          </button>
        ))}
      </div>

      <div style={s.videoWrap}>
        {captureMode === MODE.UPLOAD && currentUploadEntry && (
          <img
            key={currentUploadEntry.objectUrl}
            ref={imgPreviewRef}
            src={currentUploadEntry.objectUrl}
            alt="Upload preview"
            onLoad={() => {
              if (!currentUploadEntry || currentUploadEntry.status === "pending") return;
              const img = imgPreviewRef.current;
              if (!img) return;
              drawResultsForImage(img, currentUploadEntry.landmarks);
              setLandmarkData(currentUploadEntry.landmarks ? [toRoundedLandmarks(currentUploadEntry.landmarks)] : null);
            }}
            style={{ ...s.video, transform: "none", display: captureMode === MODE.UPLOAD ? "block" : "none" }}
          />
        )}
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ ...s.video, display: captureMode === MODE.CAMERA ? "block" : "none" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            ...s.canvas,
            transform: captureMode === MODE.CAMERA ? "scaleX(-1)" : "none",
          }}
        />
        {captureMode === MODE.UPLOAD && imgQueue.length > 1 && (
          <>
            <button
              type="button"
              style={{ ...s.navArrow, ...s.navArrowLeft }}
              onClick={() => moveCursor(-1)}
              aria-label="Previous image"
            >
              ‹
            </button>
            <button
              type="button"
              style={{ ...s.navArrow, ...s.navArrowRight }}
              onClick={() => moveCursor(1)}
              aria-label="Next image"
            >
              ›
            </button>
          </>
        )}
        {captureMode === MODE.UPLOAD && imgQueue.length > 0 && (
          <div style={s.uploadCounterBadge}>
            {imgCursor + 1} / {imgQueue.length}
          </div>
        )}
        {recStatus === REC.RECORDING && (
          <div style={s.recBadge}>⬤ REC · {liveFrameCount} frames</div>
        )}
      </div>

      {captureMode === MODE.CAMERA && (
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
            {renderSignDropdown(recStatus === REC.RECORDING || recStatus === REC.SAVING || imgSaveStatus === REC.SAVING)}

            <div style={s.optRow}>
              <label style={s.checkLabel}>
                <input
                  type="checkbox"
                  checked={mirrorable}
                  onChange={e => setMirrorable(e.target.checked)}
                  disabled={!isCustom || recStatus === REC.RECORDING || recStatus === REC.SAVING}
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
                    disabled={!isCustom || recStatus === REC.RECORDING || recStatus === REC.SAVING}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {isCustom && (
              <input
                type="text"
                value={customLabel}
                onChange={e => setCustomLabel(e.target.value)}
                placeholder="Type custom sign label"
                style={s.customInput}
              />
            )}

            <button
              style={{
                ...s.recordBtn,
                ...(recStatus === REC.RECORDING ? s.recordBtnActive : {}),
                ...(!canRecord ? s.recordBtnDisabled : {}),
              }}
              onClick={toggleRecording}
              disabled={!canRecord && recStatus !== REC.RECORDING}
            >
              {signType === "static"
                ? staticCountdown > 0
                  ? `Capturing in ${staticCountdown}s…`
                  : "Capture (3s)"
                : recStatus === REC.RECORDING
                  ? `◉  Stop · ${liveFrameCount} frames`
                  : "Start Recording"}
            </button>

            {signType === "static" && (
              <button
                type="button"
                style={{
                  ...s.recordBtn,
                  ...(!canSaveStatic ? s.recordBtnDisabled : {}),
                }}
                onClick={saveStaticCapture}
                disabled={!canSaveStatic}
              >
                Save Capture
              </button>
            )}

            {recStatus === REC.ERROR && recError && (
              <div style={s.recError}>{recError}</div>
            )}
          </div>
        </div>
      )}

      {captureMode === MODE.UPLOAD && (
        <div style={{ ...s.panel, overflow: "visible" }}>
          <div style={s.panelHeader}>
            Upload Images
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={s.panelSub}>{validUploadCount} / {imgQueue.length} with hand</span>
              <div style={{ ...s.recPill, background: REC_COLORS[imgSaveStatus] }}>
                {REC_LABELS[imgSaveStatus]}
              </div>
            </div>
          </div>
          <div style={s.panelBody}>
            {renderSignDropdown(recStatus === REC.RECORDING || recStatus === REC.SAVING || imgSaveStatus === REC.SAVING)}

            {isCustom && (
              <input
                type="text"
                value={customLabel}
                onChange={e => setCustomLabel(e.target.value)}
                placeholder="Type custom sign label"
                style={s.customInput}
              />
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={e => onSelectFiles(e.target.files)}
              style={{ display: "none" }}
            />

            <div
              style={{ ...s.dropZone, ...(isDraggingOver ? s.dropZoneOver : {}) }}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={() => setIsDraggingOver(true)}
              onDragOver={e => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={onDropFiles}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: isDraggingOver ? "#c7d2fe" : "#e2e8f0" }}>
                Drop images here or click to browse
              </div>
              <div style={{ marginTop: 8, color: "#94a3b8" }}>
                JPG, PNG, and other image files are supported.
              </div>
            </div>

            {imgQueue.length > 0 && (
              <div style={s.thumbStrip}>
                {imgQueue.map((entry, index) => (
                  <div
                    key={entry.objectUrl}
                    role="button"
                    tabIndex={0}
                    style={{
                      ...s.thumbButton,
                      ...(imgCursor === index ? s.thumbButtonActive : {}),
                      ...(entry.status === "error" ? s.thumbButtonError : {}),
                    }}
                    onClick={() => setImgCursor(index)}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setImgCursor(index);
                      }
                    }}
                  >
                    <img src={entry.objectUrl} alt="Thumbnail" style={s.thumbImg} />
                    <button
                      type="button"
                      style={s.thumbDelete}
                      onClick={e => {
                        e.stopPropagation();
                        deleteImageAt(index);
                      }}
                      aria-label="Delete image"
                      title="Delete image"
                    >
                      ×
                    </button>
                    <span
                      style={{
                        ...s.thumbStatus,
                        background: entry.status === "ok"
                          ? "#22c55e"
                          : entry.status === "error"
                            ? "#ef4444"
                            : "#f59e0b",
                      }}
                    >
                      {entry.status === "ok" ? "✓" : entry.status === "error" ? "✗" : "…"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={s.commitRow}>
              <button
                type="button"
                style={{
                  ...s.commitBtn,
                  ...((currentUploadEntry?.landmarks && activeLabel) ? s.commitBtnValid : {}),
                }}
                disabled={!currentUploadEntry?.landmarks || !activeLabel || imgSaveStatus === REC.SAVING}
                onClick={commitCurrent}
              >
                Commit This
              </button>
              <button
                type="button"
                style={{
                  ...s.commitBtn,
                  ...(validUploadCount > 0 && activeLabel ? s.commitBtnValid : {}),
                }}
                disabled={!validUploadCount || !activeLabel || imgSaveStatus === REC.SAVING}
                onClick={commitAllValid}
              >
                Commit All Valid
              </button>
            </div>

            {selectedLabel && (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>
                Saving as <span dir="rtl" style={{ fontWeight: 700, color: "#e2e8f0" }}>
                  {activeLabel ? activeLabel.ar : (selectedLabel.custom ? "Custom sign" : selectedLabel.ar)}
                </span>
                <span> · {signType} · {mirrorable ? "mirrorable" : "not mirrorable"}</span>
              </div>
            )}

            {imgSaveStatus === REC.ERROR && imgSaveError && (
              <div style={s.recError}>{imgSaveError}</div>
            )}
          </div>
        </div>
      )}

      <div style={s.panel}>
        <div style={s.panelHeader}>
          Raw Landmark Data
          <span style={s.panelSub}>
            {displayLandmarkData
              ? `${displayLandmarkData.length} hand${displayLandmarkData.length > 1 ? "s" : ""} · 21 points each`
              : "waiting for detection…"}
          </span>
        </div>
        <pre style={s.pre}>
          {displayLandmarkData ? JSON.stringify(displayLandmarkData, null, 2) : "null"}
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
  modeTabs: {
    display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid #334155",
    width: "100%", maxWidth: 860,
  },
  modeTab: {
    flex: 1, padding: "10px 0", background: "transparent",
    borderWidth: 0, borderStyle: "solid", borderColor: "transparent",
    color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    transition: "background 0.15s, color 0.15s",
  },
  modeTabActive: {
    background: "#1e293b",
    color: "#e2e8f0",
    boxShadow: "inset 0 -2px 0 0 #6366f1",
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
  uploadCounterBadge: {
    position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)",
    background: "rgba(15,23,42,0.82)", backdropFilter: "blur(4px)",
    color: "#e2e8f0", border: "1px solid #334155", borderRadius: 9999,
    padding: "4px 12px", fontSize: 12, fontWeight: 700, zIndex: 11,
  },
  navArrow: {
    position: "absolute", top: "50%", transform: "translateY(-50%)",
    background: "rgba(15,23,42,0.75)", border: "1px solid #334155", color: "#e2e8f0",
    borderRadius: "50%", width: 36, height: 36, fontSize: 20, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
  },
  navArrowLeft: { left: 12 },
  navArrowRight: { right: 12 },
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
  dropdownDivider: { height: 1, background: "#334155", margin: "4px 0" },
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
  panelBody: { display: "flex", flexDirection: "column", gap: 12, padding: 16 },
  optRow: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  customInput: {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0",
    fontSize: 14, fontFamily: "inherit",
  },
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
  dropZone: { border: "2px dashed #334155", borderRadius: 12, padding: "40px 24px", textAlign: "center", color: "#475569", cursor: "pointer", transition: "border-color 0.2s, color 0.2s", fontSize: 14 },
  dropZoneOver: { borderColor: "#6366f1", color: "#a5b4fc" },
  thumbStrip: { display: "flex", gap: 8, overflowX: "auto", padding: "8px 0" },
  thumbButton: {
    position: "relative", width: 72, height: 56, flexShrink: 0,
    padding: 0, borderWidth: 2, borderStyle: "solid", borderColor: "#334155",
    borderRadius: 8, background: "#0f172a",
    cursor: "pointer", overflow: "hidden",
  },
  thumbButtonActive: { borderColor: "#6366f1" },
  thumbButtonError: { borderColor: "#ef4444" },
  thumbDelete: {
    position: "absolute", top: 4, left: 4, width: 18, height: 18,
    borderRadius: 9999, border: "1px solid #334155",
    background: "rgba(15,23,42,0.85)", color: "#e2e8f0",
    fontSize: 14, lineHeight: "16px", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbStatus: {
    position: "absolute", right: 4, bottom: 4,
    minWidth: 18, height: 18, borderRadius: 9999,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 11, fontWeight: 800, boxShadow: "0 0 0 2px rgba(15,23,42,0.9)",
  },
  commitRow: { display: "flex", gap: 10 },
  commitBtn: {
    flex: 1, padding: "12px 16px", background: "#0f172a", border: "2px solid #334155",
    borderRadius: 10, color: "#e2e8f0", fontSize: 14, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
  },
  commitBtnValid: { borderColor: "#6366f1", color: "#a5b4fc" },
  pre: {
    margin: 0, padding: "12px 16px", fontSize: 11, lineHeight: 1.6,
    overflowY: "auto", maxHeight: 280, color: "#7dd3fc",
    fontFamily: "'Fira Code', 'Cascadia Code', monospace",
    whiteSpace: "pre-wrap", wordBreak: "break-all",
  },
};
