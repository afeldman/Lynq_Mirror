import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { applyMirrorMaskOrientation } from "./mirror-model-utils.js";
import {
  loadAssistantSettings,
  ensureAssistantSettings,
  DEFAULT_AUDIO2FACE_SETTINGS,
  AUDIO2FACE_FUNCTION_IDS,
} from "./assistant-settings.js";
import { clamp01 } from "./lipsync-utils.js";
import {
  getBlendshapeAliases,
  normalizeBlendshapeValues,
  computeBlendshapeDiagnostics,
} from "./blendshape-utils.js";

const MIRROR_URL = "/characters/lynq/lynx_bobcat_01.fbx";
const LOG_MAX_LENGTH = 200;
const DEFAULT_FRAME_DELTA_SEC = 1 / 30;

const formElement = document.getElementById("a2f-form");
const fileInput = document.getElementById("file-input");
const fileInfoElement = document.getElementById("file-info");
const apiKeyStatusElement = document.getElementById("api-key-status");
const functionIdInput = document.getElementById("function-id-input");
const modelSelect = document.getElementById("model-select");
const processButton = document.getElementById("process-button");
const clearLogButton = document.getElementById("clear-log-button");
const logOutput = document.getElementById("log-output");
const logCountElement = document.getElementById("log-count");
const resultSummaryElement = document.getElementById("result-summary");
const defaultsInfoElement = document.getElementById("defaults-info");
const viewerCanvasElement = document.getElementById("viewer-canvas");
const viewerStatusElement = document.getElementById("viewer-status");
const playButton = document.getElementById("play-button");
const pauseButton = document.getElementById("pause-button");
const resetButton = document.getElementById("reset-button");
const frameSlider = document.getElementById("frame-slider");
const frameInfoElement = document.getElementById("frame-info");
const blendshapeTableBody = document.getElementById("blendshape-table-body");
const playbackAudioElement = document.getElementById("playback-audio");
const animationOffsetSlider = document.getElementById(
  "animation-offset-slider"
);
const animationOffsetValue = document.getElementById("animation-offset-value");
const timelineScaleSlider = document.getElementById("timeline-scale-slider");
const timelineScaleValue = document.getElementById("timeline-scale-value");
const playbackRateSlider = document.getElementById("playback-rate-slider");
const playbackRateValue = document.getElementById("playback-rate-value");
const smoothingWindowSlider = document.getElementById(
  "smoothing-window-slider"
);
const smoothingWindowValue = document.getElementById("smoothing-window-value");
const smoothingStrengthSlider = document.getElementById(
  "smoothing-strength-slider"
);
const smoothingStrengthValue = document.getElementById(
  "smoothing-strength-value"
);

const DEFAULT_PLAYBACK_SETTINGS = Object.freeze({
  audioOffsetMs: 0,
  timelineScale: 1,
  playbackRate: 1,
  smoothingWindow: 0,
  smoothingStrength: 0,
});

const PCM16_TARGET_SAMPLE_RATE = 16000;
const PCM16_BYTES_PER_SAMPLE = 2;
const PCM16_EXPECTED_BYTES_TOLERANCE = 8000;
const PCM16_EXPECTED_SECONDS_TOLERANCE = 0.1;
const PCM16_CHUNK_SIZE_BYTES = 16000; // ~500ms @ 16kHz mono

let assistantSettings = ensureAssistantSettings(loadAssistantSettings());
let nvidiaSettings =
  assistantSettings.nvidiaAudio2Face ?? DEFAULT_AUDIO2FACE_SETTINGS;
let activeApiKey = "";
let currentAudio = null;
let lastRequestMeta = null;
let logCount = 0;
let viewer = null;
let playbackState = {
  frames: [],
  playing: false,
  currentFrameIndex: 0,
  nextFrameIndex: 0,
  startTime: 0,
  rafId: null,
  elapsed: 0,
  baseDuration: 0,
  settings: { ...DEFAULT_PLAYBACK_SETTINGS },
};
let lastBlendshapeDiagnostics = null;
let viewerBlendshapeWarningLogged = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pluralize(count, singular, plural = null) {
  const resolvedPlural = plural ?? `${singular}s`;
  return count === 1 ? singular : resolvedPlural;
}

function renderBlendshapeDetails(names, summaryText, mode = "info") {
  if (!Array.isArray(names) || names.length === 0) {
    return "";
  }
  const chips = names
    .map((name) => `<code>${escapeHtml(name)}</code>`)
    .join("");
  const safeSummary = escapeHtml(summaryText);
  return `<details class="blendshape-details ${mode}"><summary>${safeSummary}</summary><div class="blendshape-tag-grid">${chips}</div></details>`;
}

function safeRevokeObjectUrl(url) {
  if (typeof url !== "string" || !url) {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn("Failed to revoke object URL", error);
  }
}

function getPlaybackSettings() {
  if (!playbackState.settings) {
    playbackState.settings = { ...DEFAULT_PLAYBACK_SETTINGS };
  }
  return playbackState.settings;
}

function updatePlaybackAudioSource(url) {
  if (!playbackAudioElement) {
    return;
  }
  if (!url) {
    if (typeof playbackAudioElement.pause === "function") {
      playbackAudioElement.pause();
    }
    playbackAudioElement.removeAttribute("src");
    playbackAudioElement.load();
    playbackAudioElement.hidden = true;
    return;
  }
  if (playbackAudioElement.src !== url) {
    playbackAudioElement.src = url;
    playbackAudioElement.load();
  }
  playbackAudioElement.hidden = false;
  playbackAudioElement.playbackRate = getPlaybackSettings().playbackRate;
}

function updatePlaybackAudioRate() {
  if (playbackAudioElement) {
    playbackAudioElement.playbackRate = getPlaybackSettings().playbackRate;
  }
}

async function preparePlaybackAudio(targetTime) {
  if (!playbackAudioElement || !currentAudio?.objectUrl) {
    return false;
  }
  updatePlaybackAudioSource(currentAudio.objectUrl);
  updatePlaybackAudioRate();

  const seekToTarget = () => {
    if (!playbackAudioElement) {
      return;
    }
    try {
      const duration = Number(playbackAudioElement.duration);
      const clamped = Number.isFinite(duration)
        ? Math.min(Math.max(0, targetTime), Math.max(duration - 0.01, 0))
        : Math.max(0, targetTime);
      playbackAudioElement.currentTime = clamped;
    } catch (error) {
      console.warn("Failed to seek playback audio", error);
    }
  };

  if (playbackAudioElement.readyState >= 1) {
    seekToTarget();
    return true;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      seekToTarget();
      resolve(true);
    };
    playbackAudioElement.addEventListener("loadedmetadata", finish, {
      once: true,
    });
    playbackAudioElement.addEventListener("canplay", finish, { once: true });
  });
}

class MirrorViewer {
  constructor(container, statusElement) {
    this.container = container;
    this.statusElement = statusElement;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050b13);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 1.55, 3.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.45, 0);
    this.controls.update();

    this.loader = new FBXLoader();
    this.model = null;
    this.blendshapeMap = new Map();

    const hemiLight = new THREE.HemisphereLight(0xcad8ff, 0x0f172a, 0.9);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(4, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.bias = -0.0002;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.5);
    fillLight.position.set(-4, 3, -6);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
    rimLight.position.set(-6, 2, 6);
    this.scene.add(rimLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0b1120,
        roughness: 0.95,
        metalness: 0.08,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    this.scene.add(ground);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate();
  }

  async load() {
    try {
      const model = await this.loader.loadAsync(MIRROR_URL);
      applyMirrorMaskOrientation(model);
      this.setModel(model);
      this.setStatus("Mirror ready", "ok");
      setTimeout(() => this.hideStatus(), 1200);
    } catch (error) {
      this.setStatus("Failed to load Mirror", "error");
      throw error;
    }
  }

  setStatus(message, mode = "info") {
    if (!this.statusElement) {
      return;
    }
    this.statusElement.textContent = message;
    this.statusElement.classList.toggle("hidden", false);
    this.statusElement.classList.toggle("error", mode === "error");
  }

  hideStatus() {
    if (this.statusElement) {
      this.statusElement.classList.add("hidden");
    }
  }

  resize() {
    if (!this.container || !this.renderer) {
      return;
    }
    const { clientWidth, clientHeight } = this.container;
    const width = Math.max(1, clientWidth);
    const height = Math.max(1, clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }

  setModel(model) {
    if (this.model) {
      this.scene.remove(this.model);
    }
    this.model = model;
    this.scene.add(this.model);

    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.buildBlendshapeMap();
    this.resetBlendshapes();
    this.focusCameraOnModel();
  }

  buildBlendshapeMap() {
    this.blendshapeMap.clear();
    if (!this.model) {
      return;
    }
    this.model.traverse((child) => {
      if (
        child.isMesh &&
        child.morphTargetDictionary &&
        child.morphTargetInfluences &&
        child.morphTargetInfluences.length
      ) {
        for (const [name, index] of Object.entries(
          child.morphTargetDictionary
        )) {
          if (!this.blendshapeMap.has(name)) {
            this.blendshapeMap.set(name, []);
          }
          this.blendshapeMap.get(name).push({ mesh: child, index });
        }
      }
    });
  }

  getBlendshapeNames() {
    return Array.from(this.blendshapeMap.keys());
  }

  resetBlendshapes() {
    for (const targets of this.blendshapeMap.values()) {
      targets.forEach(({ mesh, index }) => {
        mesh.morphTargetInfluences[index] = 0;
      });
    }
  }

  applyFrame(frame) {
    if (!frame || !frame.blendShapes) {
      this.resetBlendshapes();
      return { timeCode: frame?.timeCode ?? 0, values: new Map() };
    }
    const values = new Map();
    for (const [name, targets] of this.blendshapeMap.entries()) {
      const raw = frame.blendShapes[name] ?? 0;
      const clamped = clamp01(raw);
      targets.forEach(({ mesh, index }) => {
        mesh.morphTargetInfluences[index] = clamped;
      });
      if (clamped > 0) {
        values.set(name, clamped);
      }
    }
    return { timeCode: frame.timeCode ?? 0, values };
  }

  focusCameraOnModel() {
    if (!this.model) {
      return;
    }
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const distance = maxDim * 1.4;

    this.camera.position.copy(center);
    this.camera.position.add(new THREE.Vector3(0, size.y * 0.1, distance));
    this.camera.near = Math.max(0.1, distance / 50);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.update();
  }
}

function ensureViewer() {
  if (!viewer) {
    viewer = new MirrorViewer(viewerCanvasElement, viewerStatusElement);
    viewer
      .load()
      .then(() => addLog("Mirror mesh loaded successfully.", "info"))
      .catch((error) => addLog("Failed to load Mirror mesh.", "error", error));
  }
  return viewer;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 && unitIndex > 0 ? 2 : 0)} ${
    units[unitIndex]
  }`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)} ms`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) {
    return `${secs.toFixed(secs < 10 ? 2 : 1)} s`;
  }
  return `${mins}m ${secs.toFixed(0)}s`;
}

function getAudioContextClass() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function getOfflineAudioContextClass() {
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

function float32ToPcm16LE(f32) {
  if (!(f32 instanceof Float32Array) || f32.length === 0) {
    return new Uint8Array(0);
  }
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) {
    let sample = f32[i];
    if (!Number.isFinite(sample)) {
      sample = 0;
    }
    sample = Math.max(-1, Math.min(1, sample));
    out[i] = (sample < 0 ? sample * 32768 : sample * 32767) | 0;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function uint8ToBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return "";
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length)
    );
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function createWavBlob(pcmBytes, sampleRate) {
  if (!(pcmBytes instanceof Uint8Array)) {
    return null;
  }
  const headerSize = 44;
  const dataLength = pcmBytes.length;
  const totalLength = headerSize + dataLength;
  const buffer = new ArrayBuffer(headerSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  const byteRate = sampleRate * PCM16_BYTES_PER_SAMPLE;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(34, PCM16_BYTES_PER_SAMPLE * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  const wavBuffer = new Uint8Array(totalLength);
  wavBuffer.set(new Uint8Array(buffer), 0);
  wavBuffer.set(pcmBytes, headerSize);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function decodeAndNormalizeAudioBuffer(arrayBuffer) {
  const AudioContextClass = getAudioContextClass();
  const OfflineAudioContextClass = getOfflineAudioContextClass();
  if (!AudioContextClass || !OfflineAudioContextClass) {
    throw new Error("Web Audio API is not available in this browser.");
  }
  const audioContext = new AudioContextClass();
  let decodedBuffer;
  try {
    decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try {
      await audioContext.close();
    } catch (error) {
      console.warn("AudioContext close failed", error);
    }
  }

  const durationSeconds = Number(decodedBuffer?.duration);
  const sourceSampleRate = Number(decodedBuffer?.sampleRate);
  const channels = Number(decodedBuffer?.numberOfChannels) || 1;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Decoded audio duration was invalid.");
  }
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("Decoded audio sample rate was invalid.");
  }

  const targetFrames = Math.max(
    1,
    Math.round(durationSeconds * PCM16_TARGET_SAMPLE_RATE)
  );
  const offlineContext = new OfflineAudioContextClass(
    1,
    targetFrames,
    PCM16_TARGET_SAMPLE_RATE
  );
  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = decodedBuffer;
  sourceNode.connect(offlineContext.destination);
  sourceNode.start(0);
  const renderedBuffer = await offlineContext.startRendering();
  const monoData = renderedBuffer.getChannelData(0);
  const pcmBytes = float32ToPcm16LE(monoData);
  const normalizedSeconds =
    pcmBytes.length / (PCM16_BYTES_PER_SAMPLE * PCM16_TARGET_SAMPLE_RATE);
  const expectedBytes = targetFrames * PCM16_BYTES_PER_SAMPLE;
  const expectedChunks = Math.ceil(expectedBytes / PCM16_CHUNK_SIZE_BYTES);
  const actualChunks = Math.ceil(
    Math.max(1, pcmBytes.length) / PCM16_CHUNK_SIZE_BYTES
  );
  const bytesOk =
    Math.abs(pcmBytes.length - expectedBytes) <= PCM16_EXPECTED_BYTES_TOLERANCE;
  const durationOk =
    Math.abs(normalizedSeconds - durationSeconds) <=
    PCM16_EXPECTED_SECONDS_TOLERANCE;

  return {
    decoded: {
      duration: durationSeconds,
      sampleRate: sourceSampleRate,
      channels,
    },
    normalized: {
      bytes: pcmBytes,
      base64: uint8ToBase64(pcmBytes),
      sampleRate: PCM16_TARGET_SAMPLE_RATE,
      durationSeconds: normalizedSeconds,
      expectedBytes,
      targetFrames,
      expectedChunks,
      actualChunks,
    },
    checks: {
      bytesOk,
      durationOk,
    },
  };
}

function readWavInfo(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const toString = (offset, length) => {
    let result = "";
    for (let i = 0; i < length; i += 1) {
      result += String.fromCharCode(view.getUint8(offset + i));
    }
    return result;
  };

  if (view.byteLength < 12) {
    return { valid: false, errors: ["File too small to be a WAV."] };
  }

  const riff = toString(0, 4);
  const wave = toString(8, 4);
  const errors = [];

  if (riff !== "RIFF" || wave !== "WAVE") {
    errors.push("Not a RIFF/WAVE file.");
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= view.byteLength) {
    const chunkId = toString(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const nextOffset = offset + 8 + chunkSize + (chunkSize % 2);

    if (chunkId === "fmt ") {
      const audioFormat = view.getUint16(offset + 8, true);
      const channels = view.getUint16(offset + 10, true);
      const sampleRate = view.getUint32(offset + 12, true);
      const byteRate = view.getUint32(offset + 16, true);
      const blockAlign = view.getUint16(offset + 20, true);
      const bitsPerSample = view.getUint16(offset + 22, true);
      fmt = {
        audioFormat,
        channels,
        sampleRate,
        byteRate,
        blockAlign,
        bitsPerSample,
      };
      if (audioFormat !== 1) {
        errors.push(
          `Unsupported audio format ${audioFormat} (expected PCM 1).`
        );
      }
    } else if (chunkId === "data") {
      data = {
        size: chunkSize,
        offset: offset + 8,
      };
    }

    offset = nextOffset;
  }

  const duration =
    fmt && data && fmt.byteRate ? data.size / fmt.byteRate : null;
  const warnings = [];
  if (fmt) {
    if (fmt.channels !== 1) {
      warnings.push(`Audio has ${fmt.channels} channels. Mono is recommended.`);
    }
    if (fmt.bitsPerSample !== 16) {
      warnings.push(
        `Audio is ${fmt.bitsPerSample}-bit. 16-bit PCM works best.`
      );
    }
  }

  return {
    valid: Boolean(fmt && data && errors.length === 0),
    fmt,
    data,
    duration,
    errors,
    warnings,
  };
}

function describeFile(details) {
  if (!details || !details.file) {
    fileInfoElement.hidden = true;
    fileInfoElement.innerHTML = "";
    return;
  }

  const { file, info, decoded, normalized } = details;
  const parts = [];
  parts.push(`<strong>Name:</strong> ${escapeHtml(file.name)}`);
  parts.push(`<strong>Size:</strong> ${formatBytes(file.size)}`);

  if (decoded) {
    if (Number.isFinite(decoded.sampleRate)) {
      parts.push(
        `<strong>Decoded sample rate:</strong> ${decoded.sampleRate.toLocaleString()} Hz`
      );
    }
    if (Number.isFinite(decoded.channels)) {
      parts.push(`<strong>Decoded channels:</strong> ${decoded.channels}`);
    }
    if (Number.isFinite(decoded.duration)) {
      parts.push(
        `<strong>Decoded duration:</strong> ${formatDuration(decoded.duration)}`
      );
    }
  } else if (info?.fmt) {
    if (info.fmt.sampleRate) {
      parts.push(
        `<strong>Sample rate:</strong> ${info.fmt.sampleRate.toLocaleString()} Hz`
      );
    }
    if (info.fmt.channels) {
      parts.push(`<strong>Channels:</strong> ${info.fmt.channels}`);
    }
    if (info.fmt.bitsPerSample) {
      parts.push(`<strong>Bits per sample:</strong> ${info.fmt.bitsPerSample}`);
    }
    if (Number.isFinite(info.duration)) {
      parts.push(`<strong>Duration:</strong> ${formatDuration(info.duration)}`);
    }
  }

  if (normalized) {
    const sampleRate = normalized.sampleRate || PCM16_TARGET_SAMPLE_RATE;
    parts.push(
      `<strong>Normalized sample rate:</strong> ${sampleRate.toLocaleString()} Hz`
    );
    if (Number.isFinite(normalized.durationSeconds)) {
      parts.push(
        `<strong>Normalized duration:</strong> ${formatDuration(
          normalized.durationSeconds
        )}`
      );
    }
    if (Number.isFinite(normalized.byteLength)) {
      parts.push(
        `<strong>Normalized size:</strong> ${formatBytes(
          normalized.byteLength
        )} (${normalized.targetFrames.toLocaleString()} frames)`
      );
    }
    if (
      Number.isFinite(normalized.actualChunks) &&
      Number.isFinite(normalized.expectedChunks)
    ) {
      parts.push(
        `<strong>Chunk estimate:</strong> ${escapeHtml(
          `${normalized.actualChunks.toLocaleString()} sent • ${normalized.expectedChunks.toLocaleString()} expected`
        )} (${formatBytes(PCM16_CHUNK_SIZE_BYTES)}/chunk)`
      );
    }
    if (Number.isFinite(normalized.expectedBytes)) {
      const actualDisplay = Number.isFinite(normalized.byteLength)
        ? formatBytes(normalized.byteLength)
        : "n/a";
      parts.push(
        `<strong>Expected bytes:</strong> ${escapeHtml(
          `${formatBytes(
            normalized.expectedBytes
          )} target • ${actualDisplay} actual`
        )}`
      );
    }
  }

  if (info?.errors?.length) {
    parts.push(
      `<strong>Errors:</strong> ${info.errors
        .map((err) => `<div>${escapeHtml(err)}</div>`)
        .join("")}`
    );
  }
  if (info?.warnings?.length) {
    parts.push(
      `<strong>Warnings:</strong> ${info.warnings
        .map((warn) => `<div>${escapeHtml(warn)}</div>`)
        .join("")}`
    );
  }

  fileInfoElement.innerHTML = parts
    .map((line) => `<div>${line}</div>`)
    .join("");
  fileInfoElement.hidden = false;
}

function addLog(message, level = "info", details) {
  if (!logOutput) {
    return;
  }
  if (logCount === 0) {
    logOutput.innerHTML = "";
  }
  logCount += 1;
  if (logCountElement) {
    logCountElement.textContent = `${logCount} events`;
    logCountElement.hidden = false;
  }

  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  const meta = document.createElement("div");
  meta.className = "meta";

  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = new Date().toLocaleTimeString();

  const labelSpan = document.createElement("span");
  labelSpan.className = "label";
  labelSpan.textContent = level.toUpperCase();

  const messageSpan = document.createElement("span");
  messageSpan.className = "message";
  messageSpan.textContent = message;

  meta.append(timeSpan, labelSpan, messageSpan);
  entry.append(meta);

  if (details !== undefined && details !== null) {
    const pre = document.createElement("pre");
    if (details instanceof Error) {
      pre.textContent = details.stack || details.message;
    } else if (typeof details === "object") {
      try {
        pre.textContent = JSON.stringify(details, null, 2);
      } catch (error) {
        pre.textContent = String(details);
      }
    } else {
      pre.textContent = String(details);
    }
    entry.append(pre);
  }

  logOutput.append(entry);

  if (logOutput.children.length > LOG_MAX_LENGTH) {
    logOutput.removeChild(logOutput.firstChild);
  }

  logOutput.scrollTop = logOutput.scrollHeight;
}

function clearLog() {
  if (!logOutput) {
    return;
  }
  logOutput.innerHTML =
    '<p class="placeholder">Logs appear here during processing.</p>';
  logCount = 0;
  if (logCountElement) {
    logCountElement.hidden = true;
    logCountElement.textContent = "";
  }
}

function updateApiKeyStatus(key) {
  activeApiKey = typeof key === "string" ? key.trim() : "";
  if (!apiKeyStatusElement) {
    return;
  }
  apiKeyStatusElement.classList.remove("error", "ok");
  if (activeApiKey) {
    const suffix =
      activeApiKey.length > 6 ? activeApiKey.slice(-6) : activeApiKey;
    apiKeyStatusElement.textContent = `Loaded • ends with ${suffix}`;
    apiKeyStatusElement.classList.add("ok");
  } else {
    apiKeyStatusElement.textContent = "Missing — add it in Settings";
    apiKeyStatusElement.classList.add("error");
  }
}

function refreshSettings() {
  try {
    assistantSettings = ensureAssistantSettings(loadAssistantSettings());
    nvidiaSettings =
      assistantSettings.nvidiaAudio2Face ?? DEFAULT_AUDIO2FACE_SETTINGS;
  } catch (error) {
    addLog("Failed to load assistant settings.", "error", error);
    assistantSettings = ensureAssistantSettings({});
    nvidiaSettings =
      assistantSettings.nvidiaAudio2Face ?? DEFAULT_AUDIO2FACE_SETTINGS;
  }

  updateApiKeyStatus(nvidiaSettings.apiKey);

  if (
    functionIdInput &&
    (!functionIdInput.value ||
      functionIdInput.value === functionIdInput.dataset.defaultValue)
  ) {
    functionIdInput.value = nvidiaSettings.functionId || "";
    functionIdInput.dataset.defaultValue = nvidiaSettings.functionId || "";
  } else if (functionIdInput && !functionIdInput.dataset.defaultValue) {
    functionIdInput.dataset.defaultValue = nvidiaSettings.functionId || "";
  }

  if (modelSelect) {
    modelSelect.value = nvidiaSettings.model || modelSelect.value;
  }
}

function getEffectiveFunctionId() {
  const userValue = functionIdInput?.value?.trim();
  if (userValue) {
    return userValue;
  }
  const model = modelSelect?.value;
  return (
    AUDIO2FACE_FUNCTION_IDS[model] ||
    nvidiaSettings.functionId ||
    DEFAULT_AUDIO2FACE_SETTINGS.functionId
  );
}

function handleModelChange() {
  if (!modelSelect || !functionIdInput) {
    return;
  }
  const model = modelSelect.value;
  const defaultFunction = AUDIO2FACE_FUNCTION_IDS[model] || "";
  const currentValue = functionIdInput.value.trim();
  const previousDefault = functionIdInput.dataset.defaultValue || "";
  if (!currentValue || currentValue === previousDefault) {
    functionIdInput.value = defaultFunction;
  }
  functionIdInput.dataset.defaultValue = defaultFunction;
  addLog(`Selected Audio2Face character: ${model}.`, "info", {
    defaultFunction,
  });
}

async function handleFileSelection(file) {
  if (!file) {
    stopPlayback();
    if (currentAudio?.objectUrl) {
      safeRevokeObjectUrl(currentAudio.objectUrl);
    }
    currentAudio = null;
    describeFile(null);
    updatePlaybackAudioSource(null);
    return;
  }

  addLog(`Selected file: ${file.name}`, "info", {
    size: formatBytes(file.size),
  });

  stopPlayback();

  if (currentAudio?.objectUrl) {
    updatePlaybackAudioSource(null);
    safeRevokeObjectUrl(currentAudio.objectUrl);
    currentAudio = null;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const info = readWavInfo(arrayBuffer);
    const { decoded, normalized, checks } = await decodeAndNormalizeAudioBuffer(
      arrayBuffer
    );
    const pcmBytes = normalized.bytes;
    const normalizedBlob = createWavBlob(pcmBytes, normalized.sampleRate);
    const playbackBlob =
      normalizedBlob ||
      new Blob([arrayBuffer], { type: file.type || "audio/wav" });
    const objectUrl = URL.createObjectURL(playbackBlob);
    const byteLength = pcmBytes instanceof Uint8Array ? pcmBytes.length : 0;
    const normalizedInfo = {
      sampleRate: normalized.sampleRate,
      durationSeconds: normalized.durationSeconds,
      expectedBytes: normalized.expectedBytes,
      targetFrames: normalized.targetFrames,
      expectedChunks: normalized.expectedChunks,
      actualChunks: normalized.actualChunks,
      byteLength,
      checks,
    };
    currentAudio = {
      file,
      arrayBuffer,
      base64: normalized.base64,
      info,
      decoded,
      normalized: normalizedInfo,
      objectUrl,
    };
    describeFile(currentAudio);
    updatePlaybackAudioSource(objectUrl);

    const decodedSummary = {
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      durationSeconds: Number.isFinite(decoded.duration)
        ? Number(decoded.duration.toFixed(3))
        : decoded.duration,
    };
    addLog("Decoded audio summary.", "info", decodedSummary);

    const normalizedSummary = {
      expectedBytes: normalized.expectedBytes,
      actualBytes: byteLength,
      targetFrames: normalized.targetFrames,
      expectedChunks: normalized.expectedChunks,
      actualChunks: normalized.actualChunks,
      normalizedSeconds: Number.isFinite(normalized.durationSeconds)
        ? Number(normalized.durationSeconds.toFixed(3))
        : normalized.durationSeconds,
      sourceSeconds: Number.isFinite(decoded.duration)
        ? Number(decoded.duration.toFixed(3))
        : decoded.duration,
      toleranceBytes: PCM16_EXPECTED_BYTES_TOLERANCE,
      toleranceSeconds: PCM16_EXPECTED_SECONDS_TOLERANCE,
    };
    const normalizedLevel =
      checks.bytesOk && checks.durationOk ? "info" : "warn";
    addLog("Normalized PCM16 ready.", normalizedLevel, normalizedSummary);
    if (!checks.bytesOk || !checks.durationOk) {
      addLog(
        "Normalized audio size/duration deviated from expected tolerances.",
        "error",
        normalizedSummary
      );
    }

    if (info?.errors?.length) {
      addLog("WAV parsing reported errors.", "warn", info.errors);
    } else if (info?.warnings?.length) {
      addLog("WAV parsing warnings.", "warn", info.warnings);
    } else if (info?.fmt) {
      addLog("WAV header looks good.", "info", {
        sampleRate: info.fmt.sampleRate,
        channels: info.fmt.channels,
        bitsPerSample: info.fmt.bitsPerSample,
      });
    }
  } catch (error) {
    addLog("Failed to prepare audio file.", "error", error);
    if (currentAudio?.objectUrl) {
      updatePlaybackAudioSource(null);
      safeRevokeObjectUrl(currentAudio.objectUrl);
    } else {
      updatePlaybackAudioSource(null);
    }
    currentAudio = null;
    describeFile(null);
  }
}

function disableForm(isDisabled) {
  [
    fileInput,
    functionIdInput,
    modelSelect,
    processButton,
    clearLogButton,
  ].forEach((element) => {
    if (element) {
      element.disabled = isDisabled;
    }
  });
}

function normalizeFrames(frames = []) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return [];
  }

  const prepared = frames.map((frame, index) => {
    const rawTime = Number(frame?.timeCode);
    const { normalized: normalizedShapes, original: originalShapes } =
      normalizeBlendshapeValues(frame?.blendShapes);
    return {
      ...frame,
      index,
      rawTimeCode: Number.isFinite(rawTime) ? rawTime : null,
      timeCode: Number.isFinite(rawTime) ? rawTime : null,
      blendShapes: normalizedShapes,
      originalBlendShapes: originalShapes,
    };
  });

  prepared.sort((a, b) => {
    const aTime = Number.isFinite(a.timeCode)
      ? a.timeCode
      : Number.isFinite(a.rawTimeCode)
      ? a.rawTimeCode
      : a.index;
    const bTime = Number.isFinite(b.timeCode)
      ? b.timeCode
      : Number.isFinite(b.rawTimeCode)
      ? b.rawTimeCode
      : b.index;
    return aTime - bTime;
  });

  let lastTime = null;
  let lastDelta = DEFAULT_FRAME_DELTA_SEC;
  for (let i = 0; i < prepared.length; i += 1) {
    const entry = prepared[i];
    let time = Number(entry.timeCode);
    if (!Number.isFinite(time)) {
      time = Number(entry.rawTimeCode);
    }
    if (!Number.isFinite(time)) {
      time = lastTime === null ? 0 : lastTime + lastDelta;
    }
    if (lastTime !== null && time <= lastTime) {
      const fallbackDelta =
        lastDelta > 1e-4 ? lastDelta : DEFAULT_FRAME_DELTA_SEC;
      time = lastTime + fallbackDelta;
    }
    const delta = lastTime === null ? null : time - lastTime;
    if (Number.isFinite(delta) && delta > 1e-6) {
      lastDelta = delta;
    }
    entry.timeCode = time;
    entry.index = i;
    lastTime = time;
  }

  return prepared;
}

function getScaledTime(timeCode) {
  const numeric = Number(timeCode);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const scale = getPlaybackSettings().timelineScale;
  const safeScale = Number.isFinite(scale) ? Math.max(0.01, scale) : 1;
  return numeric * safeScale;
}

function getScaledDuration(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return 0;
  }
  const last = frames[frames.length - 1];
  return getScaledTime(last?.timeCode ?? 0);
}

function computeSmoothedBlendShapes(index) {
  const frames = playbackState.frames;
  const settings = getPlaybackSettings();
  const windowSize = Math.max(0, Math.floor(settings.smoothingWindow || 0));
  const blend = clamp01(settings.smoothingStrength || 0);
  const baseFrame = frames?.[index];
  if (!baseFrame) {
    return null;
  }
  if (windowSize <= 0 || blend <= 0) {
    return baseFrame.blendShapes;
  }
  const start = Math.max(0, index - windowSize);
  const sums = new Map();
  let samples = 0;
  for (let i = start; i <= index; i += 1) {
    const sample = frames[i]?.blendShapes;
    if (!sample) {
      continue;
    }
    samples += 1;
    for (const [name, value] of Object.entries(sample)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      const current = sums.get(name) || 0;
      sums.set(name, current + value);
    }
  }
  if (samples === 0) {
    return baseFrame.blendShapes;
  }
  const averaged = {};
  for (const [name, total] of sums.entries()) {
    averaged[name] = total / samples;
  }
  const blended = {};
  const keys = new Set([
    ...Object.keys(baseFrame.blendShapes || {}),
    ...Object.keys(averaged),
  ]);
  keys.forEach((key) => {
    const baseValue = baseFrame.blendShapes?.[key] ?? 0;
    const averageValue = averaged[key] ?? baseValue;
    blended[key] = baseValue + (averageValue - baseValue) * blend;
  });
  return blended;
}

function lerpBlendshapeMaps(a = {}, b = {}, t = 0) {
  const clamped = clamp01(Number.isFinite(t) ? t : 0);
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const result = {};
  keys.forEach((key) => {
    const av = Number.isFinite(a?.[key]) ? a[key] : 0;
    const bv = Number.isFinite(b?.[key]) ? b[key] : 0;
    result[key] = av + (bv - av) * clamped;
  });
  return result;
}

function buildInterpolatedPlaybackFrame(index, nextIndex, alpha) {
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    return null;
  }
  const clampedIndex = Math.max(0, Math.min(frames.length - 1, index));
  const baseFrame = frames[clampedIndex];
  if (!baseFrame) {
    return null;
  }
  const clampedAlpha = clamp01(Number.isFinite(alpha) ? alpha : 0);
  const baseShapes = computeSmoothedBlendShapes(baseFrame.index);
  if (clampedAlpha <= 0 || nextIndex === clampedIndex) {
    return {
      ...baseFrame,
      blendShapes: baseShapes,
    };
  }
  const clampedNext = Math.max(0, Math.min(frames.length - 1, nextIndex));
  const nextFrame = frames[clampedNext];
  if (!nextFrame) {
    return {
      ...baseFrame,
      blendShapes: baseShapes,
    };
  }
  const nextShapes = computeSmoothedBlendShapes(nextFrame.index);
  const blended = lerpBlendshapeMaps(baseShapes, nextShapes, clampedAlpha);
  const startTime = Number(baseFrame.timeCode) || 0;
  const endTime = Number(nextFrame.timeCode) || startTime;
  const timeCode = startTime + (endTime - startTime) * clampedAlpha;
  return {
    ...baseFrame,
    timeCode,
    blendShapes: blended,
    originalBlendShapes: baseFrame.originalBlendShapes,
    interpolation: {
      from: baseFrame.index,
      to: nextFrame.index,
      alpha: clampedAlpha,
    },
  };
}

function buildFrameForPlayback(index) {
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    return null;
  }
  const baseFrame = frames[Math.max(0, Math.min(frames.length - 1, index))];
  if (!baseFrame) {
    return null;
  }
  const smoothed = computeSmoothedBlendShapes(baseFrame.index);
  if (smoothed === baseFrame.blendShapes) {
    return baseFrame;
  }
  return {
    ...baseFrame,
    blendShapes: smoothed,
  };
}

function applyFrameAndUpdateUI(frame, index) {
  if (!frame) {
    return;
  }
  const viewerInstance = ensureViewer();
  const snapshot = viewerInstance.applyFrame(frame);
  if (frameSlider) {
    const sliderValue = Math.max(
      0,
      Math.min(playbackState.frames.length - 1, index)
    );
    frameSlider.value = String(sliderValue);
  }
  updateFrameInfo(index, frame);
  renderBlendshapeTable(snapshot, frame);
}

function resyncPlaybackClock() {
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    return;
  }
  const currentFrame = frames[playbackState.currentFrameIndex] || frames[0];
  const rawTime = Number.isFinite(Number(currentFrame?.timeCode))
    ? Number(currentFrame.timeCode)
    : 0;
  const scaledTime = getScaledTime(rawTime);
  const offsetSec = (getPlaybackSettings().audioOffsetMs || 0) / 1000;
  if (
    playbackAudioElement &&
    Number.isFinite(playbackAudioElement.currentTime)
  ) {
    playbackState.startTime =
      performance.now() - (playbackAudioElement.currentTime + offsetSec) * 1000;
  } else {
    playbackState.startTime = performance.now() - scaledTime * 1000;
  }
}

function syncAudioPositionToCurrentFrame() {
  if (!playbackAudioElement || !currentAudio?.objectUrl) {
    return;
  }
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    return;
  }
  const currentFrame = frames[playbackState.currentFrameIndex] || frames[0];
  const rawTime = Number.isFinite(Number(currentFrame?.timeCode))
    ? Number(currentFrame.timeCode)
    : 0;
  const scaledTime = getScaledTime(rawTime);
  const offsetSec = (getPlaybackSettings().audioOffsetMs || 0) / 1000;
  const target = Math.max(0, scaledTime - offsetSec);
  if (!Number.isFinite(target)) {
    return;
  }
  if (playbackAudioElement.readyState >= 1) {
    try {
      playbackAudioElement.currentTime = target;
    } catch (error) {
      console.warn("Failed to align audio position", error);
    }
  }
}

function formatOffsetValue(value) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} ms`;
}

function formatTimelineScaleValue(value) {
  const numeric = Number(value) || 0;
  return `${Math.round(numeric * 100)}%`;
}

function formatPlaybackRateValue(value) {
  const numeric = Number(value) || 0;
  return `${numeric.toFixed(2)}×`;
}

function formatSmoothingWindowValue(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count === 0 ? "Off" : `${count} ${pluralize(count, "frame")}`;
}

function formatSmoothingStrengthValue(value) {
  const numeric = clamp01(Number(value) || 0);
  return `${Math.round(numeric * 100)}%`;
}

function updatePlaybackSetting(key, value) {
  const settings = getPlaybackSettings();
  let sanitized = value;
  switch (key) {
    case "audioOffsetMs":
      sanitized = Number.isFinite(value) ? Math.round(value) : 0;
      sanitized = Math.max(-1000, Math.min(1000, sanitized));
      break;
    case "timelineScale":
      sanitized = Number.isFinite(value) && value > 0 ? value : 1;
      break;
    case "playbackRate":
      sanitized = Number.isFinite(value) && value > 0 ? value : 1;
      break;
    case "smoothingWindow":
      sanitized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
      break;
    case "smoothingStrength":
      sanitized = clamp01(Number(value) || 0);
      break;
    default:
      break;
  }
  if (settings[key] === sanitized) {
    return sanitized;
  }
  settings[key] = sanitized;

  if (key === "playbackRate") {
    updatePlaybackAudioRate();
  }

  if (key === "audioOffsetMs" || key === "timelineScale") {
    resyncPlaybackClock();
    if (!playbackState.playing) {
      syncAudioPositionToCurrentFrame();
    }
  }

  if (
    key === "timelineScale" ||
    key === "smoothingWindow" ||
    key === "smoothingStrength" ||
    key === "audioOffsetMs"
  ) {
    if (playbackState.frames.length > 0) {
      applyFrameAtIndex(playbackState.currentFrameIndex);
    }
  }

  return sanitized;
}

function bindSliderControl(slider, valueElement, formatter, handler) {
  if (!slider) {
    return;
  }
  const applyValue = (raw) => {
    const numeric = Number(raw);
    const sanitized = handler(numeric);
    const displayValue = Number.isFinite(sanitized) ? sanitized : numeric;
    if (valueElement) {
      valueElement.textContent = formatter(displayValue);
    }
    if (Number(slider.value) !== displayValue) {
      slider.value = String(displayValue);
    }
  };
  slider.addEventListener("input", (event) => {
    applyValue(event.target.value);
  });
  slider.addEventListener("change", (event) => {
    applyValue(event.target.value);
  });
  applyValue(slider.value);
}

function initTuningControls() {
  bindSliderControl(
    animationOffsetSlider,
    animationOffsetValue,
    formatOffsetValue,
    (value) => updatePlaybackSetting("audioOffsetMs", value)
  );
  bindSliderControl(
    timelineScaleSlider,
    timelineScaleValue,
    formatTimelineScaleValue,
    (value) => updatePlaybackSetting("timelineScale", value)
  );
  bindSliderControl(
    playbackRateSlider,
    playbackRateValue,
    formatPlaybackRateValue,
    (value) => updatePlaybackSetting("playbackRate", value)
  );
  bindSliderControl(
    smoothingWindowSlider,
    smoothingWindowValue,
    formatSmoothingWindowValue,
    (value) => updatePlaybackSetting("smoothingWindow", value)
  );
  bindSliderControl(
    smoothingStrengthSlider,
    smoothingStrengthValue,
    formatSmoothingStrengthValue,
    (value) => updatePlaybackSetting("smoothingStrength", value)
  );
}

function updateSummary(result, meta) {
  if (!resultSummaryElement) {
    return;
  }

  if (!result || !result.ok) {
    resultSummaryElement.innerHTML =
      '<p class="placeholder">Run a test to see model, rates and blendshape counts.</p>';
    return;
  }

  const audio = result.audio || {};
  const rows = [];
  const requestedModel = meta?.requestedModel || modelSelect?.value || "—";
  rows.push(`<strong>Requested model:</strong> ${escapeHtml(requestedModel)}`);
  rows.push(
    `<strong>Audio2Face reported model:</strong> ${escapeHtml(
      result.model || "—"
    )}`
  );
  if (meta?.functionId) {
    rows.push(
      `<strong>Function ID used:</strong> ${escapeHtml(meta.functionId)}`
    );
  }
  const blendshapeCount = result.blendshapeNames?.length ?? 0;
  rows.push(
    `<strong>Blendshape names received:</strong> ${escapeHtml(
      String(blendshapeCount)
    )}`
  );
  const frameCount = result.frames?.length ?? 0;
  rows.push(`<strong>Frames:</strong> ${escapeHtml(String(frameCount))}`);
  const frameTimeline = Number(audio.frameDurationSeconds);
  if (Number.isFinite(frameTimeline) && frameTimeline > 0) {
    const fps = frameTimeline > 0 ? frameCount / frameTimeline : frameCount;
    const fpsDisplay = Number.isFinite(fps) ? `${fps.toFixed(2)} fps` : "";
    rows.push(
      `<strong>Frame timeline:</strong> ${escapeHtml(
        `${frameTimeline.toFixed(3)} s${fpsDisplay ? ` • ${fpsDisplay}` : ""}`
      )}`
    );
  } else if (Array.isArray(result.frames) && result.frames.length > 0) {
    const lastFrameTime = Number(
      result.frames[result.frames.length - 1]?.timeCode
    );
    if (Number.isFinite(lastFrameTime)) {
      const fps = lastFrameTime > 0 ? frameCount / lastFrameTime : frameCount;
      const fpsDisplay = Number.isFinite(fps) ? `${fps.toFixed(2)} fps` : "";
      rows.push(
        `<strong>Frame timeline:</strong> ${escapeHtml(
          `${lastFrameTime.toFixed(3)} s${fpsDisplay ? ` • ${fpsDisplay}` : ""}`
        )}`
      );
    }
  }
  if (audio.sampleRate) {
    const sampleRate = Number.isFinite(audio.sampleRate)
      ? audio.sampleRate
      : audio.sampleRate;
    const rateParts = [String(sampleRate)];
    if (audio.sourceSampleRate) {
      rateParts.push(`• source ${audio.sourceSampleRate}`);
    }
    if (
      audio.providedSourceSampleRate &&
      audio.providedSourceSampleRate !== audio.sourceSampleRate
    ) {
      rateParts.push(`• provided ${audio.providedSourceSampleRate}`);
    }
    rows.push(
      `<strong>Normalized sample rate:</strong> ${escapeHtml(
        `${rateParts.join(" ")} Hz`
      )}`
    );
  }
  const normalizedSeconds = Number(audio.durationSeconds);
  if (Number.isFinite(normalizedSeconds)) {
    const sourceSeconds = Number(audio.sourceDurationSeconds);
    const details =
      Number.isFinite(sourceSeconds) &&
      Math.abs(sourceSeconds - normalizedSeconds) > 1e-3
        ? `${normalizedSeconds.toFixed(3)} s • source ${sourceSeconds.toFixed(
            3
          )} s`
        : `${normalizedSeconds.toFixed(3)} s`;
    rows.push(
      `<strong>Normalized audio duration:</strong> ${escapeHtml(details)}`
    );
    if (
      Number.isFinite(audio.providedSourceDurationSeconds) &&
      (!Number.isFinite(sourceSeconds) ||
        Math.abs(audio.providedSourceDurationSeconds - sourceSeconds) > 1e-3)
    ) {
      rows.push(
        `<strong>Client-provided duration:</strong> ${escapeHtml(
          `${Number(audio.providedSourceDurationSeconds).toFixed(3)} s`
        )}`
      );
    }
  }
  if (audio.pcmStats) {
    const { samples, rms, peak } = audio.pcmStats;
    rows.push(
      `<strong>PCM stats:</strong> ${escapeHtml(
        `${samples} samples • RMS ${rms} • Peak ${peak}`
      )}`
    );
  }
  if (Number.isFinite(audio.uploadCoverage)) {
    const sentBytesDisplay = formatBytes(audio.sentBytes ?? 0);
    const expectedBytesDisplay = formatBytes(audio.expectedBytes ?? 0);
    rows.push(
      `<strong>Upload coverage:</strong> ${escapeHtml(
        `${(audio.uploadCoverage * 100).toFixed(2)}%`
      )} (${escapeHtml(`${sentBytesDisplay} / ${expectedBytesDisplay}`)})`
    );
  } else if (
    Number.isFinite(audio.sentBytes) &&
    Number.isFinite(audio.expectedBytes)
  ) {
    rows.push(
      `<strong>Uploaded bytes:</strong> ${escapeHtml(
        `${formatBytes(audio.sentBytes)} / ${formatBytes(audio.expectedBytes)}`
      )}`
    );
  }
  if (Number.isFinite(audio.frameCoverage)) {
    rows.push(
      `<strong>Frame coverage vs. audio:</strong> ${escapeHtml(
        `${(audio.frameCoverage * 100).toFixed(2)}%`
      )}`
    );
  }
  if (Number.isFinite(audio.expectedBytesFromDuration)) {
    const expectationParts = [
      `target ${formatBytes(audio.expectedBytesFromDuration)}`,
    ];
    if (Number.isFinite(audio.expectedBytes)) {
      expectationParts.push(`actual ${formatBytes(audio.expectedBytes)}`);
    }
    const deltaBytes = Number(audio.normalizedBytesDelta);
    if (Number.isFinite(deltaBytes) && Math.abs(deltaBytes) > 0) {
      const deltaBytesLabel = `${deltaBytes > 0 ? "+" : "−"}${formatBytes(
        Math.abs(deltaBytes)
      )}`;
      expectationParts.push(`Δbytes ${deltaBytesLabel}`);
    }
    const deltaSeconds = Number(audio.normalizedDurationDelta);
    if (Number.isFinite(deltaSeconds) && Math.abs(deltaSeconds) > 1e-6) {
      const sign = deltaSeconds > 0 ? "+" : "−";
      expectationParts.push(`Δt ${sign}${Math.abs(deltaSeconds).toFixed(3)} s`);
    }
    rows.push(
      `<strong>Duration-based expectation:</strong> ${escapeHtml(
        expectationParts.join(" • ")
      )}`
    );
  }
  if (meta?.wavInfo?.fmt) {
    const { sampleRate, channels, bitsPerSample } = meta.wavInfo.fmt;
    const duration = formatDuration(meta.wavInfo.duration);
    rows.push(
      `<strong>Uploaded WAV:</strong> ${escapeHtml(
        `${sampleRate} Hz • ${channels} channel(s) • ${bitsPerSample}-bit • ${duration}`
      )}`
    );
  }
  if (meta?.sourceAudio) {
    const {
      sampleRate: srcRate,
      channels: srcChannels,
      duration: srcDuration,
    } = meta.sourceAudio;
    const parts = [];
    if (Number.isFinite(srcRate)) {
      parts.push(`${Number(srcRate).toLocaleString()} Hz`);
    }
    if (Number.isFinite(srcChannels)) {
      parts.push(`${srcChannels} channel${srcChannels === 1 ? "" : "s"}`);
    }
    if (Number.isFinite(srcDuration)) {
      parts.push(formatDuration(srcDuration));
    }
    if (parts.length) {
      rows.push(
        `<strong>Decoded source audio:</strong> ${escapeHtml(
          parts.join(" • ")
        )}`
      );
    }
  }
  if (meta?.normalizedAudio) {
    const normalizedMeta = meta.normalizedAudio;
    const parts = [];
    if (Number.isFinite(normalizedMeta.sampleRate)) {
      parts.push(`${Number(normalizedMeta.sampleRate).toLocaleString()} Hz`);
    }
    if (Number.isFinite(normalizedMeta.byteLength)) {
      const sizeParts = [formatBytes(normalizedMeta.byteLength)];
      if (Number.isFinite(normalizedMeta.targetFrames)) {
        sizeParts.push(
          `${Number(normalizedMeta.targetFrames).toLocaleString()} frames`
        );
      }
      parts.push(sizeParts.join(" • "));
    }
    if (Number.isFinite(normalizedMeta.durationSeconds)) {
      parts.push(`${Number(normalizedMeta.durationSeconds).toFixed(3)} s`);
    }
    if (parts.length) {
      rows.push(
        `<strong>Client-normalized audio:</strong> ${escapeHtml(
          parts.join(" • ")
        )}`
      );
    }
  }
  if (result.status) {
    const statusCode = result.status.code ?? "—";
    const statusMessage = result.status.message ?? "n/a";
    rows.push(
      `<strong>A2F status:</strong> ${escapeHtml(
        `${statusCode} — ${statusMessage}`
      )}`
    );
  } else {
    rows.push("<strong>A2F status:</strong> OK");
  }

  if (lastBlendshapeDiagnostics) {
    const {
      matched = [],
      unmatched = [],
      viewerOnly = [],
    } = lastBlendshapeDiagnostics;
    const summaryParts = [
      `${matched.length} ${pluralize(matched.length, "match", "matches")}`,
      `${unmatched.length} unmatched`,
      `${viewerOnly.length} Mirror-only`,
    ];
    rows.push(
      `<strong>Mirror coverage:</strong> ${escapeHtml(
        summaryParts.join(" • ")
      )}`
    );
  }

  const extras = [];
  if (Array.isArray(result.blendshapeNames) && result.blendshapeNames.length) {
    extras.push(
      renderBlendshapeDetails(
        result.blendshapeNames,
        `Blendshape names from NVIDIA (${result.blendshapeNames.length})`,
        "info"
      )
    );
  }
  if (lastBlendshapeDiagnostics) {
    const { unmatched = [], viewerOnly = [] } = lastBlendshapeDiagnostics;
    if (unmatched.length) {
      const label = `${unmatched.length} NVIDIA ${pluralize(
        unmatched.length,
        "blendshape"
      )} without Mirror match`;
      extras.push(renderBlendshapeDetails(unmatched, label, "warning"));
    }
    if (viewerOnly.length) {
      const label = `${viewerOnly.length} Mirror ${pluralize(
        viewerOnly.length,
        "blendshape"
      )} unused by NVIDIA`;
      extras.push(renderBlendshapeDetails(viewerOnly, label, "muted"));
    }
  }

  const rowsHtml = rows.map((line) => `<div>${line}</div>`).join("");
  resultSummaryElement.innerHTML = rowsHtml + extras.join("");
}

function updateDefaultsInfo(defaults) {
  if (!defaultsInfoElement) {
    return;
  }
  if (!defaults) {
    defaultsInfoElement.hidden = true;
    defaultsInfoElement.innerHTML = "";
    return;
  }
  const parts = [];
  if (defaults.functionId) {
    parts.push(
      `<div><strong>Server default function:</strong> ${defaults.functionId}</div>`
    );
  }
  if (defaults.models) {
    parts.push(
      `<div><strong>Supported models:</strong> ${defaults.models.join(
        ", "
      )}</div>`
    );
  }
  defaultsInfoElement.innerHTML = parts
    .map((line) => `<div>${line}</div>`)
    .join("");
  defaultsInfoElement.hidden = false;
}

function setPlaybackFrames(frames) {
  stopPlayback();
  playbackState.frames = frames || [];
  playbackState.playing = false;
  playbackState.currentFrameIndex = 0;
  playbackState.nextFrameIndex = frames?.length > 0 ? 1 : 0;
  playbackState.startTime = 0;
  playbackState.elapsed = 0;
  playbackState.baseDuration =
    frames && frames.length
      ? Number(frames[frames.length - 1]?.timeCode ?? 0)
      : 0;
  if (playbackState.rafId) {
    cancelAnimationFrame(playbackState.rafId);
    playbackState.rafId = null;
  }

  if (frameSlider) {
    frameSlider.disabled = !(frames && frames.length > 0);
    frameSlider.min = "0";
    frameSlider.max = frames && frames.length ? String(frames.length - 1) : "0";
    frameSlider.value = "0";
  }
  updateFrameInfo(0, frames?.[0] ?? null);
  if (!frames || frames.length === 0) {
    renderBlendshapeTable(null, null);
  }
  updatePlaybackButtons();
  updatePlaybackAudioRate();
  resyncPlaybackClock();
  if (!playbackState.playing) {
    syncAudioPositionToCurrentFrame();
  }

  const sourceDuration =
    currentAudio?.normalized?.durationSeconds ??
    currentAudio?.decoded?.duration ??
    currentAudio?.info?.duration;
  if (Number.isFinite(sourceDuration) && playbackState.baseDuration) {
    const audioDuration = Number(sourceDuration);
    if (Number.isFinite(audioDuration)) {
      const diff = audioDuration - playbackState.baseDuration;
      if (Math.abs(diff) > 0.05) {
        const sign = diff > 0 ? "longer" : "shorter";
        addLog(
          `Uploaded audio is ${Math.abs(diff).toFixed(
            2
          )}s ${sign} than the raw frame timeline`,
          diff > 0 ? "warn" : "info",
          {
            audioDuration: Number(audioDuration.toFixed(3)),
            frameDuration: Number(playbackState.baseDuration.toFixed(3)),
          }
        );
      }
    }
  }
}

function updateFrameInfo(index, frame) {
  if (!frameInfoElement) {
    return;
  }
  const total = playbackState.frames?.length ?? 0;
  const scaledTime = frame ? getScaledTime(frame.timeCode ?? 0) : null;
  let label = "—";
  if (Number.isFinite(scaledTime)) {
    label = `${scaledTime.toFixed(3)} s`;
    const raw = Number(frame?.timeCode);
    if (Number.isFinite(raw) && Math.abs(raw - scaledTime) > 1e-3) {
      label += ` (raw ${raw.toFixed(3)} s)`;
    }
  }
  frameInfoElement.textContent = `Frame ${
    total === 0 ? 0 : index + 1
  } / ${total} • ${label}`;
}

function renderBlendshapeTable(snapshot, frame) {
  if (!blendshapeTableBody) {
    return;
  }
  blendshapeTableBody.innerHTML = "";
  if (!snapshot || !snapshot.values || snapshot.values.size === 0) {
    const row = document.createElement("tr");
    row.className = "placeholder-row";
    const cell = document.createElement("td");
    cell.colSpan = 2;
    if (
      frame?.originalBlendShapes &&
      Object.keys(frame.originalBlendShapes).length > 0
    ) {
      cell.textContent = "No matching Mirror blendshapes for this frame.";
    } else {
      cell.textContent = "No active blendshapes in this frame.";
    }
    row.append(cell);
    blendshapeTableBody.append(row);
    return;
  }

  const entries = Array.from(snapshot.values.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 20);

  entries.forEach(({ name, value }) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = name;
    const valueCell = document.createElement("td");
    valueCell.textContent = `${(value * 100).toFixed(1)}%`;
    row.append(nameCell, valueCell);
    blendshapeTableBody.append(row);
  });
}

function applyFrameAtIndex(index) {
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    return;
  }
  const clampedIndex = Math.max(0, Math.min(frames.length - 1, index));
  playbackState.currentFrameIndex = clampedIndex;
  playbackState.nextFrameIndex = Math.min(frames.length, clampedIndex + 1);
  const playableFrame = buildFrameForPlayback(clampedIndex);
  if (!playableFrame) {
    return;
  }
  applyFrameAndUpdateUI(playableFrame, clampedIndex);
}

function getAnimationTime(timestamp) {
  const offsetSec = (getPlaybackSettings().audioOffsetMs || 0) / 1000;
  if (
    playbackAudioElement &&
    Number.isFinite(playbackAudioElement.currentTime)
  ) {
    return playbackAudioElement.currentTime + offsetSec;
  }
  return (timestamp - playbackState.startTime) / 1000;
}

function findFrameWindowForTime(frames, targetTime) {
  const total = Array.isArray(frames) ? frames.length : 0;
  if (total === 0) {
    return { index: 0, nextIndex: 0, alpha: 0 };
  }
  const tolerance = 1e-4;
  const duration = getScaledDuration(frames);
  const clamped = Math.max(0, Number.isFinite(targetTime) ? targetTime : 0);
  if (clamped >= duration - tolerance) {
    const lastIndex = total - 1;
    return { index: lastIndex, nextIndex: lastIndex, alpha: 0 };
  }

  let low = 0;
  let high = total - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = getScaledTime(frames[mid].timeCode ?? 0);
    if (midTime < clamped) {
      low = mid + 1;
    } else if (midTime > clamped) {
      high = mid - 1;
    } else {
      return { index: mid, nextIndex: Math.min(total - 1, mid + 1), alpha: 0 };
    }
  }

  const index = Math.max(0, Math.min(total - 1, low - 1));
  const nextIndex = Math.min(total - 1, index + 1);
  const start = getScaledTime(frames[index].timeCode ?? 0);
  const end = getScaledTime(frames[nextIndex].timeCode ?? 0);
  if (nextIndex === index || !Number.isFinite(end) || end <= start) {
    return { index, nextIndex: index, alpha: 0 };
  }
  const alpha = clamp01((clamped - start) / (end - start));
  return { index, nextIndex, alpha };
}

function playbackLoop(timestamp) {
  if (!playbackState.playing) {
    return;
  }
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    stopPlayback();
    return;
  }
  const elapsed = getAnimationTime(timestamp);
  playbackState.elapsed = elapsed;

  const window = findFrameWindowForTime(frames, elapsed);
  playbackState.currentFrameIndex = window.index;
  playbackState.nextFrameIndex = Math.min(frames.length, window.nextIndex + 1);
  const playbackFrame = buildInterpolatedPlaybackFrame(
    window.index,
    window.nextIndex,
    window.alpha
  );
  if (playbackFrame) {
    applyFrameAndUpdateUI(playbackFrame, window.index);
  }

  const duration = getScaledDuration(frames);
  if (elapsed >= duration - 1e-4) {
    stopPlayback({ preserveAudio: true });
    return;
  }

  playbackState.rafId = requestAnimationFrame(playbackLoop);
}

async function startPlayback() {
  const frames = playbackState.frames;
  if (!frames || frames.length === 0) {
    addLog("No frames to play back.", "warn");
    return;
  }
  const currentFrame = frames[playbackState.currentFrameIndex] || frames[0];
  const rawTime = Number.isFinite(Number(currentFrame?.timeCode))
    ? Number(currentFrame.timeCode)
    : 0;
  const scaledTime = getScaledTime(rawTime);
  const offsetSec = (getPlaybackSettings().audioOffsetMs || 0) / 1000;

  playbackState.playing = true;
  playbackState.nextFrameIndex = Math.min(
    frames.length,
    playbackState.currentFrameIndex + 1
  );

  let audioReady = false;
  if (currentAudio?.objectUrl && playbackAudioElement) {
    try {
      if (typeof playbackAudioElement.pause === "function") {
        playbackAudioElement.pause();
      }
      await preparePlaybackAudio(Math.max(0, scaledTime - offsetSec));
      audioReady = true;
      const playAttempt = playbackAudioElement.play();
      if (playAttempt && typeof playAttempt.catch === "function") {
        playAttempt.catch((error) => {
          addLog(
            "Audio playback failed to start.",
            "warn",
            error?.message || error
          );
        });
      }
    } catch (error) {
      addLog(
        "Audio element was not ready to play.",
        "warn",
        error?.message || error
      );
    }
  }

  const audioBasedTime =
    playbackAudioElement && Number.isFinite(playbackAudioElement.currentTime)
      ? playbackAudioElement.currentTime + offsetSec
      : scaledTime;
  playbackState.startTime = performance.now() - audioBasedTime * 1000;
  playbackState.elapsed = audioBasedTime;
  playbackState.rafId = requestAnimationFrame(playbackLoop);

  const scaledDuration = getScaledDuration(frames);
  const rawDuration = Number(playbackState.baseDuration);
  const formattedRawDuration = Number.isFinite(rawDuration)
    ? Number(rawDuration.toFixed(3))
    : rawDuration;
  const formattedScaledDuration = Number.isFinite(scaledDuration)
    ? Number(scaledDuration.toFixed(3))
    : scaledDuration;
  addLog("Starting playback.", "info", {
    frames: frames.length,
    rawDuration: formattedRawDuration,
    scaledDuration: formattedScaledDuration,
    audioReady,
  });
  updatePlaybackButtons();
}

function stopPlayback(options = {}) {
  const { preserveAudio = false } = options;
  playbackState.playing = false;
  if (playbackState.rafId) {
    cancelAnimationFrame(playbackState.rafId);
    playbackState.rafId = null;
  }
  if (
    playbackAudioElement &&
    !preserveAudio &&
    typeof playbackAudioElement.pause === "function"
  ) {
    try {
      playbackAudioElement.pause();
    } catch (error) {
      console.warn("Failed to pause playback audio", error);
    }
  }
  updatePlaybackButtons();
}

function resetPlayback() {
  stopPlayback();
  playbackState.currentFrameIndex = 0;
  playbackState.nextFrameIndex = playbackState.frames.length > 0 ? 1 : 0;
  playbackState.elapsed = 0;
  const offsetSec = (getPlaybackSettings().audioOffsetMs || 0) / 1000;
  if (playbackAudioElement && currentAudio?.objectUrl) {
    updatePlaybackAudioSource(currentAudio.objectUrl);
    updatePlaybackAudioRate();
    const target = Math.max(0, -offsetSec);
    if (playbackAudioElement.readyState >= 1) {
      try {
        playbackAudioElement.currentTime = target;
      } catch (error) {
        console.warn("Failed to reset audio position", error);
      }
    } else {
      const prep = preparePlaybackAudio(target);
      if (prep && typeof prep.then === "function") {
        prep.catch(() => {});
      }
    }
  }
  if (playbackState.frames.length > 0) {
    applyFrameAtIndex(0);
  } else if (viewer) {
    viewer.resetBlendshapes();
    renderBlendshapeTable(null, null);
    updateFrameInfo(0, null);
  }
}

function updatePlaybackButtons() {
  if (playButton) {
    playButton.disabled =
      playbackState.playing || !(playbackState.frames.length > 0);
  }
  if (pauseButton) {
    pauseButton.disabled = !playbackState.playing;
  }
}

async function submitForm(event) {
  event.preventDefault();
  if (!currentAudio || !currentAudio.base64) {
    addLog("Select a WAV file before sending to NVIDIA.", "warn");
    fileInput?.focus();
    return;
  }
  if (!activeApiKey) {
    addLog("Missing Audio2Face API key. Add it in Settings.", "error");
    return;
  }

  lastBlendshapeDiagnostics = null;
  const functionId = getEffectiveFunctionId();
  const model = modelSelect?.value || nvidiaSettings.model;
  const normalizedMeta = currentAudio.normalized || {};
  const sampleRate =
    normalizedMeta.sampleRate || currentAudio.info?.fmt?.sampleRate;
  const sourceSampleRate =
    currentAudio.decoded?.sampleRate || currentAudio.info?.fmt?.sampleRate;
  const sourceDurationSeconds = currentAudio.decoded?.duration;

  const payload = {
    apiKey: activeApiKey,
    functionId,
    model,
    audio: currentAudio.base64,
    sampleRate,
    sourceSampleRate,
    sourceDurationSeconds,
  };

  addLog("Sending Audio2Face request…", "info", {
    model,
    functionId,
    sampleRate,
    sourceSampleRate,
    sourceDurationSeconds: Number.isFinite(sourceDurationSeconds)
      ? Number(sourceDurationSeconds.toFixed(3))
      : sourceDurationSeconds,
  });

  disableForm(true);
  processButton.textContent = "Processing…";

  try {
    const response = await fetch("/api/audio2face/blendshapes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) {
      const errorMessage =
        data?.error || `Request failed with status ${response.status}`;
      addLog("Audio2Face request failed.", "error", errorMessage);
      updateSummary(null);
      updateDefaultsInfo(null);
      lastBlendshapeDiagnostics = null;
      return;
    }

    addLog("Audio2Face request succeeded.", "info", {
      model: data.model || model,
      frames: data.frames?.length ?? 0,
      blendshapes: {
        count: data.blendshapeNames?.length ?? 0,
        names: data.blendshapeNames || [],
      },
      audio: {
        sampleRate: data.audio?.sampleRate,
        sourceSampleRate: data.audio?.sourceSampleRate,
      },
    });

    if (Array.isArray(data.blendshapeNames) && data.blendshapeNames.length) {
      addLog(
        "Blendshape names returned by NVIDIA.",
        "info",
        data.blendshapeNames
      );
    }

    lastRequestMeta = {
      requestedModel: model,
      functionId,
      wavInfo: currentAudio.info,
      sourceAudio: currentAudio.decoded,
      normalizedAudio: currentAudio.normalized,
    };
    const viewerInstance = ensureViewer();
    const viewerBlendshapes = viewerInstance?.getBlendshapeNames?.() ?? [];
    if (!viewerInstance?.model || viewerBlendshapes.length === 0) {
      lastBlendshapeDiagnostics = null;
      if (!viewerBlendshapeWarningLogged) {
        addLog(
          "Mirror blendshape map not ready yet. Diagnostics will appear after the mesh finishes loading.",
          "info"
        );
        viewerBlendshapeWarningLogged = true;
      }
    } else {
      viewerBlendshapeWarningLogged = false;
      lastBlendshapeDiagnostics = computeBlendshapeDiagnostics(
        data.blendshapeNames,
        viewerBlendshapes
      );

      if (lastBlendshapeDiagnostics) {
        const diagSummary = {
          matched: lastBlendshapeDiagnostics.matched.length,
          unmatched: lastBlendshapeDiagnostics.unmatched.length,
          mirrorOnly: lastBlendshapeDiagnostics.viewerOnly.length,
        };
        addLog("Blendshape coverage summary.", "info", diagSummary);
        if (lastBlendshapeDiagnostics.unmatched.length) {
          addLog(
            "Unmatched NVIDIA blendshape names.",
            "warn",
            lastBlendshapeDiagnostics.unmatched
          );
        }
        if (lastBlendshapeDiagnostics.viewerOnly.length) {
          addLog(
            "Mirror blendshapes without NVIDIA weights.",
            "info",
            lastBlendshapeDiagnostics.viewerOnly
          );
        }
      }
    }

    updateSummary(data, lastRequestMeta);
    updateDefaultsInfo(data.defaults);

    const frames = normalizeFrames(data.frames);
    setPlaybackFrames(frames);
    if (frames.length > 0) {
      applyFrameAtIndex(0);
    } else {
      addLog("Audio2Face returned no blendshape frames.", "warn");
      ensureViewer().resetBlendshapes();
      renderBlendshapeTable(null, null);
    }
  } catch (error) {
    addLog("Audio2Face request threw an error.", "error", error);
    lastBlendshapeDiagnostics = null;
    updateSummary(null);
    updateDefaultsInfo(null);
  } finally {
    disableForm(false);
    processButton.textContent = "Send to NVIDIA";
    updatePlaybackButtons();
  }
}

function initEventListeners() {
  formElement?.addEventListener("submit", (event) => {
    submitForm(event);
  });

  fileInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    handleFileSelection(file);
  });

  clearLogButton?.addEventListener("click", () => {
    clearLog();
    addLog("Log cleared.", "info");
  });

  modelSelect?.addEventListener("change", () => {
    handleModelChange();
  });

  frameSlider?.addEventListener("input", () => {
    const index = Number(frameSlider.value);
    stopPlayback();
    applyFrameAtIndex(index);
    updatePlaybackButtons();
  });

  playButton?.addEventListener("click", () => {
    startPlayback();
  });

  pauseButton?.addEventListener("click", () => {
    stopPlayback();
  });

  resetButton?.addEventListener("click", () => {
    resetPlayback();
  });
}

function init() {
  ensureViewer();
  refreshSettings();
  handleModelChange();
  initTuningControls();
  initEventListeners();
  updatePlaybackButtons();
}

init();
