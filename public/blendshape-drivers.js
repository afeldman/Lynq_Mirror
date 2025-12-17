import { clamp01 } from './lipsync-utils.js';
import { normalizeBlendshapeValues } from './blendshape-utils.js';

const PCM16_TARGET_SAMPLE_RATE = 16000;
const PCM16_STATS_LOG_INTERVAL_MS = 2000;
const DEFAULT_FRAME_DELTA_SEC = 1 / 30;
const FRAME_MIN_SPACING_SEC = DEFAULT_FRAME_DELTA_SEC;
const FRAME_EARLY_TOLERANCE_SEC = 0.005;
const FRAME_LATE_DROP_SEC = 0.1;
const MAX_FRAME_LAG_SEC = 0.043;
const DEFAULT_PLAYBACK_GUARD_SEC = 0.08;

const BLENDSHAPE_CANONICAL_NAMES = Object.freeze([
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'jawForward',
  'jawLeft',
  'jawOpen',
  'jawRight',
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthSuckLeft',
  'mouthSuckRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'noseSneerLeft',
  'noseSneerRight',
  'tongueOut'
]);

const BLENDSHAPE_CANON_MAP = new Map(
  BLENDSHAPE_CANONICAL_NAMES.map((name) => [name.replace(/[^a-z0-9]/gi, '').toLowerCase(), name])
);

function getBlendshapeDedupeKey(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const compact = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact || null;
}

function canonicalizeBlendshapeName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const compact = trimmed.replace(/[^A-Za-z0-9]+/g, '');
  const lookupKey = compact.toLowerCase();
  if (BLENDSHAPE_CANON_MAP.has(lookupKey)) {
    return BLENDSHAPE_CANON_MAP.get(lookupKey);
  }
  const camelized = trimmed
    .replace(/[-_\s]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ''))
    .replace(/^[a-z]/, (char) => char.toUpperCase());
  const camelKey = camelized.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  if (BLENDSHAPE_CANON_MAP.has(camelKey)) {
    return BLENDSHAPE_CANON_MAP.get(camelKey);
  }
  return camelized || trimmed;
}

function pcm16Stats(bytes) {
  const view = bytes instanceof DataView
    ? bytes
    : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.byteLength - (view.byteLength % 2);
  if (length <= 0) {
    return { samples: 0, rms: 0, peak: 0 };
  }
  const sampleCount = length >> 1;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = view.getInt16(i * 2, true);
    const abs = Math.abs(sample);
    if (abs > peak) {
      peak = abs;
    }
    sumSq += sample * sample;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, sampleCount)) / 32768;
  return {
    samples: sampleCount,
    rms: Number.isFinite(rms) ? Number(rms.toFixed(4)) : 0,
    peak
  };
}

function float32Stats(float32Array) {
  if (!(float32Array instanceof Float32Array) || float32Array.length === 0) {
    return { samples: 0, rms: 0, peak: 0 };
  }
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = float32Array[i] || 0;
    const abs = Math.abs(sample);
    if (abs > peak) {
      peak = abs;
    }
    sumSq += sample * sample;
  }
  const sampleCount = float32Array.length;
  const rms = Math.sqrt(sumSq / Math.max(1, sampleCount));
  return {
    samples: sampleCount,
    rms: Number.isFinite(rms) ? Number(rms.toFixed(4)) : 0,
    peak: Number.isFinite(peak) ? Number(peak.toFixed(4)) : 0
  };
}

function pcm16BytesToFloat32Mono(bytes) {
  if (!bytes || bytes.length < 2) {
    return new Float32Array(0);
  }
  const usableLength = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usableLength);
  const frameCount = usableLength >> 1;
  const out = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function resampleFloat32Mono(source, sourceRate, targetRate) {
  if (!(source instanceof Float32Array) || source.length === 0) {
    return new Float32Array(0);
  }
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || sourceRate === targetRate) {
    return source.slice();
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    return source.slice();
  }

  const ratio = targetRate / sourceRate;
  const targetLength = Math.max(1, Math.round(source.length * ratio));
  const result = new Float32Array(targetLength);
  const step = sourceRate / targetRate;
  for (let i = 0; i < targetLength; i += 1) {
    const position = i * step;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(source.length - 1, leftIndex + 1);
    const frac = position - leftIndex;
    const left = source[leftIndex] ?? 0;
    const right = source[rightIndex] ?? left;
    result[i] = left + (right - left) * frac;
  }
  return result;
}

function float32ToPcm16Mono16k(float32Array) {
  if (!(float32Array instanceof Float32Array) || float32Array.length === 0) {
    return new Uint8Array(0);
  }
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i += 1) {
    let s = float32Array[i];
    if (!Number.isFinite(s)) {
      s = 0;
    }
    s = Math.max(-1, Math.min(1, s));
    out[i] = (s < 0 ? s * 32768 : s * 32767) | 0;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function ensurePcm16Mono16k(bytes, sampleRate) {
  const sourceRate = Number.isFinite(sampleRate) && sampleRate > 0
    ? sampleRate
    : PCM16_TARGET_SAMPLE_RATE;
  if (!bytes || bytes.length === 0) {
    return {
      bytes: new Uint8Array(0),
      sampleRate: PCM16_TARGET_SAMPLE_RATE,
      stats: { samples: 0, rms: 0, peak: 0 }
    };
  }
  const float32 = pcm16BytesToFloat32Mono(bytes);
  const resampled = resampleFloat32Mono(float32, sourceRate, PCM16_TARGET_SAMPLE_RATE);
  const pcm16 = float32ToPcm16Mono16k(resampled);
  const stats = pcm16Stats(pcm16);
  return {
    bytes: pcm16,
    sampleRate: PCM16_TARGET_SAMPLE_RATE,
    stats
  };
}

const captureStats = {
  audioChunksIn: 0,
  audioBytesIn: 0,
  audioSamplesIn: 0,
  silentChunks: 0
};

setInterval(() => {
  if (
    !captureStats.audioChunksIn &&
    !captureStats.audioBytesIn &&
    !captureStats.audioSamplesIn &&
    !captureStats.silentChunks
  ) {
    return;
  }
  console.log('A2F capture stats', { ...captureStats });
  captureStats.audioChunksIn = 0;
  captureStats.audioBytesIn = 0;
  captureStats.audioSamplesIn = 0;
  captureStats.silentChunks = 0;
}, PCM16_STATS_LOG_INTERVAL_MS);

const DEFAULT_MODEL = 'mark_v2.3';
const FALLBACK_SILENCE_TIMEOUT_MS = 600;
const VALID_MODELS = new Set(['mark_v2.3', 'claire_v2.3', 'james_v2.3']);
const DEFAULT_SAMPLE_RATE = PCM16_TARGET_SAMPLE_RATE;
const DEFAULT_DRAIN_TARGET_SEC = 0.24;
const DEFAULT_DRAIN_INTERVAL_MS = 100;
const MIN_DRAIN_TARGET_SEC = 0.11;
const MAX_DRAIN_TARGET_SEC = 0.45;
const MIN_DRAIN_INTERVAL_MS = 40;
const MAX_DRAIN_INTERVAL_MS = 200;
const A2F_DECAY_FACTOR = 0.85;
const A2F_HEALTH_LOG_INTERVAL_MS = 1000;

function cloneBlendshapeMap(map) {
  if (!(map instanceof Map)) {
    return new Map();
  }
  const clone = new Map();
  map.forEach((value, key) => {
    if (Number.isFinite(value) && value > 0) {
      clone.set(key, value);
    }
  });
  return clone;
}

function decayToNeutral(values, factor = A2F_DECAY_FACTOR) {
  const weight = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : A2F_DECAY_FACTOR;
  if (!(values instanceof Map)) {
    return new Map();
  }
  const out = new Map();
  values.forEach((value, key) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const decayed = value * weight;
    if (decayed > 1e-3) {
      out.set(key, Math.max(0, Math.min(1, decayed)));
    }
  });
  return out;
}

const A2F_DEBUG_PREFIX = '[Audio2Face]';

function getA2FPerformanceNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function getFaceDebugSink() {
  if (typeof window === 'undefined') {
    return null;
  }
  const sink = window.__FACE_DEBUG_SINK__;
  if (!sink || typeof sink.handleEvent !== 'function') {
    return null;
  }
  return sink;
}

function emitA2FDebugEvent(type, payload = {}) {
  const sink = getFaceDebugSink();
  if (!sink) {
    return;
  }
  const event = { type, ...payload };
  if (!Number.isFinite(event.wallTimeMs)) {
    event.wallTimeMs = Date.now();
  }
  if (!Number.isFinite(event.perfTimeMs)) {
    event.perfTimeMs = getA2FPerformanceNow();
  }
  try {
    sink.handleEvent(event);
  } catch (error) {
    console.warn('Audio2Face debug sink handler failed', error);
  }
}

function logA2FDebug(message, details, options = {}) {
  const payload = details === undefined ? [] : [details];
  const wallTimeMs = Number.isFinite(options.wallTimeMs) ? options.wallTimeMs : Date.now();
  const isoTimestamp = new Date(wallTimeMs).toISOString();
  const prefix = `${A2F_DEBUG_PREFIX} ${isoTimestamp}`;
  if (typeof console !== 'undefined') {
    if (typeof console.log === 'function') {
      console.log(prefix, message, ...payload);
    } else if (typeof console.debug === 'function') {
      console.debug(prefix, message, ...payload);
    }
  }
  const level = options.level || 'info';
  const perfTimeMs = Number.isFinite(options.perfTimeMs) ? options.perfTimeMs : getA2FPerformanceNow();
  emitA2FDebugEvent('log', {
    message,
    details,
    source: options.source || 'audio2face-driver',
    level,
    isoTime: isoTimestamp,
    wallTimeMs,
    perfTimeMs
  });
}

function toFixedNumber(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(digits));
}

function summarizeSecret(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'none';
  }
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return `${trimmed.length} chars`;
  }
  return `${trimmed.length} chars (${trimmed.slice(0, 4)}…${trimmed.slice(-4)})`;
}

const AUDIO_DELTA_EVENT_TYPES = new Set([
  'input_audio_buffer.append',
  'response.output_audio.delta',
  'audio.delta',
  'audio_chunk',
  'audio'
]);

const AUDIO_START_EVENT_TYPES = new Set([
  'output_audio_buffer.started',
  'response.output_audio.started'
]);

const AUDIO_COMPLETION_EVENT_TYPES = new Set(['output_audio_buffer.stopped']);

const AUDIO_FALLBACK_COMPLETION_EVENT_TYPES = new Set(['response.output_audio.done']);

function normalizeModel(model) {
  if (typeof model !== 'string') {
    return DEFAULT_MODEL;
  }
  const trimmed = model.trim();
  return VALID_MODELS.has(trimmed) ? trimmed : DEFAULT_MODEL;
}

function extractResponseId(event) {
  if (!event || typeof event !== 'object') {
    return 'default';
  }
  return (
    event.response_id ||
    event.responseId ||
    event.response?.id ||
    event.response?.response_id ||
    event.id ||
    'default'
  );
}

function extractSampleRate(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const candidates = [
    event.sampleRate,
    event.sample_rate,
    event.audio?.sampleRate,
    event.audio?.sample_rate
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

const BASE64_LOOKUP_TABLE = (() => {
  const table = new Uint8Array(256).fill(0xff);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i += 1) {
    table[alphabet.charCodeAt(i)] = i;
  }
  table['='.charCodeAt(0)] = 0;
  return table;
})();

function normalizeBase64(b64) {
  if (typeof b64 !== 'string') {
    return null;
  }
  let s = b64.trim();
  if (!s) {
    return null;
  }

  const match = s.match(/^data:[^,]+,([\s\S]*)$/i);
  if (match) {
    s = match[1];
  } else {
    const comma = s.indexOf(',');
    if (comma !== -1 && s.slice(0, comma).toLowerCase().includes('base64')) {
      s = s.slice(comma + 1);
    }
  }

  s = s
    .replace(/[\s\r\n]+/g, '')
    .replace(/\u0000/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  s = s.replace(/[^A-Za-z0-9+/=]/g, '');

  const remainder = s.length % 4;
  if (remainder === 1) {
    return null;
  }
  if (remainder) {
    s += '='.repeat(4 - remainder);
  }
  return s;
}

function decodeNormalizedBase64ToUint8Array(s) {
  const len = typeof s === 'string' ? s.length : 0;
  if (!len) {
    return new Uint8Array(0);
  }

  let outLen = (len >> 2) * 3;
  if (s.endsWith('==')) {
    outLen -= 2;
  } else if (s.endsWith('=')) {
    outLen -= 1;
  }

  const out = new Uint8Array(Math.max(0, outLen));
  let buf = 0;
  let bits = 0;
  let idx = 0;

  for (let i = 0; i < len; i += 1) {
    const code = s.charCodeAt(i);
    if (code === 61) {
      break;
    }
    const value = BASE64_LOOKUP_TABLE[code];
    if (value === 0xff) {
      continue;
    }
    buf = (buf << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (idx < out.length) {
        out[idx] = (buf >> bits) & 0xff;
        idx += 1;
      } else {
        break;
      }
      buf &= (1 << bits) - 1;
    }
  }

  return out.subarray(0, idx);
}

function base64ToUint8Array(input, seen = new Set()) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (Array.isArray(input)) {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const value = Number(input[i]);
      if (!Number.isFinite(value)) {
        return null;
      }
      out[i] = value & 0xff;
    }
    return out;
  }
  if (input && typeof input === 'object') {
    if (seen.has(input)) {
      return null;
    }
    seen.add(input);
    const keys = ['base64', 'data', 'delta', 'chunk', 'audio', 'value', 'bytes'];
    for (const key of keys) {
      if (key in input) {
        const result = base64ToUint8Array(input[key], seen);
        if (result && result.length) {
          return result;
        }
      }
    }
    return null;
  }
  if (typeof input !== 'string') {
    return null;
  }

  const normalized = normalizeBase64(input);
  if (!normalized) {
    return null;
  }

  const bytes = decodeNormalizedBase64ToUint8Array(normalized);
  return bytes && bytes.length ? bytes : null;
}

function coerceAssistantEvent(message) {
  if (!message) {
    return null;
  }
  if (typeof message === 'string') {
    try {
      return JSON.parse(message);
    } catch (error) {
      return null;
    }
  }
  return typeof message === 'object' ? message : null;
}

function getNormalizedEventType(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  const rawType = event.type || event.event || event.kind || '';
  return typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
}

function pickAudioString(candidate) {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed ? trimmed : null;
  }
  if (candidate && typeof candidate === 'object') {
    const keys = ['audio', 'data', 'delta', 'chunk', 'value', 'bytes'];
    for (const key of keys) {
      if (typeof candidate[key] === 'string') {
        const trimmed = candidate[key].trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
  }
  return null;
}

function extractAudioBase64(message) {
  const event = coerceAssistantEvent(message);
  if (!event) {
    return null;
  }
  const candidates = [
    event.audio,
    event.delta,
    event.data,
    event.chunk,
    event.payload?.audio,
    event.payload?.audio?.data,
    event.payload?.audio?.delta,
    event.payload?.audio?.chunk
  ];
  for (const candidate of candidates) {
    const result = pickAudioString(candidate);
    if (result) {
      return result;
    }
  }
  return null;
}

function isAudioDeltaType(type) {
  if (!type) {
    return false;
  }
  return (
    AUDIO_DELTA_EVENT_TYPES.has(type) ||
    type.endsWith('audio.delta') ||
    type.endsWith('audio_chunk') ||
    type === 'audio'
  );
}

function isAudioCompletionType(type) {
  if (!type) {
    return false;
  }
  return AUDIO_COMPLETION_EVENT_TYPES.has(type);
}

function isAudioStartType(type) {
  if (!type) {
    return false;
  }
  return AUDIO_START_EVENT_TYPES.has(type);
}

function isAudioFallbackCompletionType(type) {
  if (!type) {
    return false;
  }
  return (
    AUDIO_FALLBACK_COMPLETION_EVENT_TYPES.has(type) ||
    type.endsWith('output_audio.done')
  );
}

function getAudioEventDetails(message, normalizedType) {
  const event = coerceAssistantEvent(message);
  if (!event) {
    return null;
  }
  const type = normalizedType || getNormalizedEventType(event);
  if (!isAudioDeltaType(type)) {
    return null;
  }
  const base64 = extractAudioBase64(event);
  if (!base64) {
    return null;
  }
  const normalized = normalizeBase64(base64);
  if (!normalized) {
    return null;
  }
  return { event, type, normalizedBase64: normalized };
}

function isValidOpenAIRealtimeAudioEvent(event, normalizedType) {
  if (!event || typeof event !== 'object') {
    return false;
  }
  if (normalizedType !== 'response.output_audio.delta') {
    return true;
  }
  if ('response' in event && event.response != null && typeof event.response !== 'object') {
    return false;
  }
  if ('response_id' in event && event.response_id != null && typeof event.response_id !== 'string') {
    return false;
  }
  if ('responseId' in event && event.responseId != null && typeof event.responseId !== 'string') {
    return false;
  }
  const item = event.item;
  if (item != null && typeof item !== 'object') {
    return false;
  }
  if (item?.id != null && typeof item.id !== 'string') {
    return false;
  }
  return true;
}

function concatUint8Arrays(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return new Uint8Array(0);
  }
  const total = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    if (!chunk || !chunk.length) {
      return;
    }
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function concatFloat32Arrays(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return new Float32Array(0);
  }
  const total = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const result = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    if (!(chunk instanceof Float32Array) || chunk.length === 0) {
      return;
    }
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function uint8ArrayToBase64(bytes) {
  if (!bytes || !bytes.length) {
    return '';
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function createSession(id = 'default') {
  return {
    id,
    chunks: [],
    floatChunks: [],
    frames: null,
    currentValues: new Map(),
    frameQueue: [],
    anchor: null,
    lastEmitAudioTime: -Infinity,
    lastFrameTime: 0,
    lastKnownAudioTime: null,
    sampleRate: DEFAULT_SAMPLE_RATE,
    captureSampleRate: null,
    startedAt: null,
    timelineStart: null,
    wallTimelineStart: null,
    audioClockOffset: null,
    framesCoveredSec: 0,
    syncBiasSec: 0,
    pending: null,
    lastChunkAt: null,
    sourceType: null,
    lastDrainIndex: 0,
    lastDrainAt: 0,
    lastDrainRequestedAt: 0,
    pendingDrainStartedAt: null,
    audioCompleted: false,
    audioCompletedAt: null,
    baseOffsetSec: null,
    thinHorizonSince: null,
    lastThinHorizonLog: 0,
    lastAnimTimeSec: 0,
    lastSampleTimeSec: 0,
    idleDrainSince: null,
    lateDropsTotal: 0,
    lastLateDropLog: 0,
    loggedDuplicateBlendshapes: new Set(),
    loggedNormalizationSummary: false,
    debug: {
      floatChunks: 0,
      pcmChunks: 0,
      lastNormalizedBytes: 0,
      requests: 0,
      createdAt: (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now(),
      lastFinalizedAt: null
    }
  };
}

function applyBlendshapeFrames(session, data, options = {}) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const append = Boolean(options.append);
  const requestedBase = Number(options.baseTimeSec);
  const defaultBase = append ? Number(session.framesCoveredSec) || 0 : 0;
  const baseTimeSec = Number.isFinite(requestedBase)
    ? Math.max(0, requestedBase)
    : Math.max(0, defaultBase);
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const prepared = frames
    .map((frame, index) => {
      const rawTime = Number(
        frame?.timeCode ?? frame?.timecode ?? frame?.time_code ?? frame?.time ?? frame?.timestamp
      );
      const blendShapes = frame?.blendShapes || frame?.blend_shapes || {};
      const { normalized } = normalizeBlendshapeValues(blendShapes);
      return {
        index,
        rawTimeCode: Number.isFinite(rawTime) ? rawTime : null,
        timeCode: Number.isFinite(rawTime) ? rawTime : null,
        blendShapes: normalized
      };
    })
    .filter(Boolean);

  if (!prepared.length) {
    if (!append) {
      session.frames = null;
      session.currentValues = new Map();
      session.framesCoveredSec = 0;
      session.syncBiasSec = 0;
    }
    return [];
  }

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

  prepared.forEach((entry) => {
    let time = Number(entry.timeCode);
    if (!Number.isFinite(time)) {
      time = Number(entry.rawTimeCode);
    }
    if (!Number.isFinite(time)) {
      time = lastTime === null ? 0 : lastTime + lastDelta;
    }
    if (lastTime !== null && time <= lastTime) {
      const fallbackDelta = lastDelta > 1e-4 ? lastDelta : DEFAULT_FRAME_DELTA_SEC;
      time = lastTime + fallbackDelta;
    }
    const delta = lastTime === null ? null : time - lastTime;
    if (Number.isFinite(delta) && delta > 1e-6) {
      lastDelta = delta;
    }
    entry.time = time;
    lastTime = time;
  });

  let maxLocalTime = 0;
  const rawKeysSeen = new Set();
  const canonicalKeysSeen = new Set();
  const duplicateRecords = [];
  const normalizedFrames = prepared.map((entry) => {
    const values = new Map();
    const dedupeMap = new Map();
    const frameDuplicates = [];
    if (entry.blendShapes && typeof entry.blendShapes === 'object') {
      Object.entries(entry.blendShapes).forEach(([name, value]) => {
        if (typeof name === 'string') {
          const trimmedName = name.trim();
          if (trimmedName) {
            rawKeysSeen.add(trimmedName);
          }
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return;
        }
        const clamped = clamp01(numeric);
        if (clamped <= 0) {
          return;
        }
        const canonicalName = canonicalizeBlendshapeName(name);
        if (!canonicalName) {
          return;
        }
        const dedupeKey = getBlendshapeDedupeKey(canonicalName)
          || getBlendshapeDedupeKey(name)
          || canonicalName.toLowerCase();
        if (!dedupeKey) {
          return;
        }
        const existing = dedupeMap.get(dedupeKey);
        if (existing) {
          const keepIncoming = clamped >= existing.value;
          const duplicateEntry = {
            canonical: canonicalName,
            previousRaw: existing.rawName,
            newRaw: typeof name === 'string' ? name : String(name),
            previousValue: existing.value,
            newValue: clamped,
            kept: keepIncoming ? 'incoming' : 'existing'
          };
          if (!session.loggedDuplicateBlendshapes.has(dedupeKey)) {
            frameDuplicates.push(duplicateEntry);
          }
          if (!keepIncoming) {
            canonicalKeysSeen.add(existing.canonicalName);
            return;
          }
          values.delete(existing.canonicalName);
        }
        values.set(canonicalName, clamped);
        dedupeMap.set(dedupeKey, {
          canonicalName,
          value: clamped,
          rawName: typeof name === 'string' ? name : String(name)
        });
        canonicalKeysSeen.add(canonicalName);
      });
    }
    if (frameDuplicates.length) {
      duplicateRecords.push(...frameDuplicates);
    }
    const localTime = Number(entry.time) || 0;
    if (localTime > maxLocalTime) {
      maxLocalTime = localTime;
    }
    return { time: baseTimeSec + localTime, localTime, values };
  });

  if (!session.loggedNormalizationSummary) {
    const shouldLogSummary = rawKeysSeen.size > 0;
    if (shouldLogSummary) {
      const duplicatesFixed = duplicateRecords.map((record) => [record.newRaw, record.canonical]);
      logA2FDebug('Blendshape normalization summary', {
        id: session.id,
        rawKeyCount: rawKeysSeen.size,
        canonicalKeyCount: canonicalKeysSeen.size,
        duplicatesFixed
      });
      session.loggedNormalizationSummary = true;
    }
  }

  if (duplicateRecords.length) {
    logA2FDebug('Normalized duplicate blendshape keys', {
      id: session.id,
      duplicates: duplicateRecords.map((record) => ({
        canonical: record.canonical,
        incoming: record.newRaw,
        previous: record.previousRaw,
        kept: record.kept,
        previousValue: toFixedNumber(record.previousValue, 4),
        newValue: toFixedNumber(record.newValue, 4)
      }))
    });
    duplicateRecords.forEach((record) => {
      const key = getBlendshapeDedupeKey(record.canonical)
        || getBlendshapeDedupeKey(record.newRaw)
        || getBlendshapeDedupeKey(record.previousRaw);
      if (key) {
        session.loggedDuplicateBlendshapes.add(key);
      }
    });
  }

  const coverageBase = Math.max(baseTimeSec, Number(session.framesCoveredSec) || 0);
  const lastAbsolute = normalizedFrames[normalizedFrames.length - 1]?.time ?? coverageBase;
  const localSpan = Math.max(0, lastAbsolute - baseTimeSec);
  const coverageAdvance = Math.max(maxLocalTime, localSpan);
  const minimumAdvance = normalizedFrames.length > 1
    ? coverageAdvance
    : Math.max(coverageAdvance, DEFAULT_FRAME_DELTA_SEC);
  session.framesCoveredSec = coverageBase + minimumAdvance;

  if (append && Array.isArray(session.frames) && session.frames.length > 0) {
    const prevCurrentValues = cloneBlendshapeMap(session.currentValues);
    const merged = session.frames.concat(normalizedFrames);
    merged.sort((a, b) => a.time - b.time);

    const deduped = [];
    const EPSILON = 1e-4;
    for (const frame of merged) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(frame.time - last.time) <= EPSILON) {
        deduped[deduped.length - 1] = frame;
      } else {
        deduped.push(frame);
      }
    }

    session.frames = deduped;
    session.currentValues = prevCurrentValues;
    return normalizedFrames;
  }

  session.frames = normalizedFrames;
  const initialValues = session.frames[0]?.values;
  session.currentValues = initialValues instanceof Map ? cloneBlendshapeMap(initialValues) : new Map();
  session.syncBiasSec = 0;
  return normalizedFrames;
}

function ensureSessionQueue(session) {
  if (!session) {
    return [];
  }
  if (!Array.isArray(session.frameQueue)) {
    session.frameQueue = [];
  }
  return session.frameQueue;
}

function scheduleFramePlayback(session, frame) {
  if (!session || !frame) {
    return;
  }
  if (!session.anchor || !Number.isFinite(session.anchor.audio0)) {
    frame.playAt = null;
    return;
  }
  const frameTime = Number(frame.time) || 0;
  const anchorFrame = Number.isFinite(session.anchor.a2f0) ? session.anchor.a2f0 : 0;
  frame.playAt = session.anchor.audio0 + (frameTime - anchorFrame);
}

function enqueueSessionFrames(session, frames) {
  if (!session || !Array.isArray(frames) || frames.length === 0) {
    return;
  }
  const queue = ensureSessionQueue(session);
  frames.forEach((frame) => {
    if (!frame || typeof frame !== 'object') {
      return;
    }
    const time = Number(frame.time);
    if (!Number.isFinite(time)) {
      return;
    }
    const values = frame.values instanceof Map ? new Map(frame.values) : new Map();
    const queued = {
      time,
      values,
      playAt: null
    };
    queue.push(queued);
  });
  queue.sort((a, b) => a.time - b.time);
  queue.forEach((queued) => scheduleFramePlayback(session, queued));
  if (queue.length) {
    session.lastFrameTime = queue[queue.length - 1].time;
  }
}

function resetSessionPlayback(session) {
  if (!session) {
    return;
  }
  session.frameQueue = [];
  session.anchor = null;
  session.lastEmitAudioTime = -Infinity;
  session.lastFrameTime = 0;
  session.currentValues = new Map();
  session.lastSampleTimeSec = 0;
  session.lastKnownAudioTime = null;
  session.frames = null;
  session.framesCoveredSec = 0;
  session.chunks = [];
  session.floatChunks = [];
  session.lastDrainIndex = 0;
  session.pending = null;
  session.pendingDrainStartedAt = null;
  session.baseOffsetSec = null;
  session.idleDrainSince = null;
  session.lateDropsTotal = 0;
  session.lastLateDropLog = 0;
  if (session.loggedDuplicateBlendshapes instanceof Set) {
    session.loggedDuplicateBlendshapes.clear();
  }
  session.loggedNormalizationSummary = false;
}

function pumpSessionFrames(session, nowAudio) {
  if (!session || !Number.isFinite(nowAudio)) {
    return;
  }
  const queue = ensureSessionQueue(session);
  while (queue.length) {
    const next = queue[0];
    if (!next) {
      queue.shift();
      continue;
    }
    if (!Number.isFinite(next.playAt)) {
      scheduleFramePlayback(session, next);
    }
    if (!Number.isFinite(next.playAt)) {
      break;
    }
    if (nowAudio + FRAME_EARLY_TOLERANCE_SEC < next.playAt) {
      break;
    }
    if (nowAudio - next.playAt > FRAME_LATE_DROP_SEC) {
      queue.shift();
      session.lateDropsTotal = (session.lateDropsTotal || 0) + 1;
      const lateBy = nowAudio - next.playAt;
      const nowMs = Date.now();
      if (!session.lastLateDropLog || nowMs - session.lastLateDropLog > 500) {
        session.lastLateDropLog = nowMs;
        logA2FDebug('Dropping late Audio2Face frame', {
          id: session.id,
          frameTime: Number.isFinite(next.time) ? Number(next.time.toFixed(3)) : null,
          scheduledAt: Number.isFinite(next.playAt) ? Number(next.playAt.toFixed(3)) : null,
          audioTime: Number.isFinite(nowAudio) ? Number(nowAudio.toFixed(3)) : null,
          lateBy: Number.isFinite(lateBy) ? Number(lateBy.toFixed(3)) : null
        });
      }
      continue;
    }
    const lastEmit = Number(session.lastEmitAudioTime);
    if (Number.isFinite(lastEmit) && nowAudio - lastEmit < FRAME_MIN_SPACING_SEC) {
      break;
    }
    session.currentValues = next.values instanceof Map ? new Map(next.values) : new Map();
    session.lastEmitAudioTime = nowAudio;
    session.lastSampleTimeSec = Number(next.time) || nowAudio;
    session.lastFrameTime = Math.max(session.lastFrameTime || 0, Number(next.time) || 0);
    queue.shift();
    break;
  }
}

export function createAudio2FaceBlendshapeDriver(options = {}) {
  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const onFrames = typeof options.onFrames === 'function' ? options.onFrames : null;
  const onFirstFrames = typeof options.onFirstFrames === 'function' ? options.onFirstFrames : null;
  const onDrainComplete = typeof options.onDrainComplete === 'function' ? options.onDrainComplete : null;

  const sessions = new Map();
  const fallbackFinalizationTimers = new Map();
  let settings = {
    enabled: false,
    apiKey: '',
    model: DEFAULT_MODEL,
    functionId: ''
  };
  let sessionStartTime = 0;
  let activeResponseId = null;
  let inactiveEventLogged = false;
  let lastNoFramesLogTime = 0;
  let drainTargetSeconds = DEFAULT_DRAIN_TARGET_SEC;
  let drainIntervalMs = DEFAULT_DRAIN_INTERVAL_MS;
  let lastHealthLogTime = 0;
  let lastUpdateMetrics = { sessions: [], audioTimeSec: 0 };

  function isActive() {
    return settings.enabled && Boolean(settings.apiKey);
  }

  function reset() {
    sessions.clear();
    activeResponseId = null;
    inactiveEventLogged = false;
    lastNoFramesLogTime = 0;
    clearAllFallbackTimers();
    logA2FDebug('Audio2Face driver state reset');
  }

  function clearAllFallbackTimers() {
    const clear = (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function')
      ? globalThis.clearTimeout.bind(globalThis)
      : clearTimeout;
    fallbackFinalizationTimers.forEach((timer) => {
      clear(timer);
    });
    fallbackFinalizationTimers.clear();
  }

  function getDrainTargetSeconds() {
    return drainTargetSeconds;
  }

  function setDrainTargetSeconds(nextSeconds) {
    if (!Number.isFinite(nextSeconds)) {
      return drainTargetSeconds;
    }
    const clamped = Math.max(MIN_DRAIN_TARGET_SEC, Math.min(MAX_DRAIN_TARGET_SEC, Number(nextSeconds)));
    if (Math.abs(clamped - drainTargetSeconds) > 1e-3) {
      drainTargetSeconds = clamped;
      logA2FDebug('Audio2Face drain target updated', {
        seconds: Number(drainTargetSeconds.toFixed(3))
      });
    }
    return drainTargetSeconds;
  }

  function getDrainIntervalMs() {
    return drainIntervalMs;
  }

  function setDrainIntervalMs(nextMs) {
    if (!Number.isFinite(nextMs)) {
      return drainIntervalMs;
    }
    const clamped = Math.max(MIN_DRAIN_INTERVAL_MS, Math.min(MAX_DRAIN_INTERVAL_MS, Math.round(nextMs)));
    if (clamped !== drainIntervalMs) {
      drainIntervalMs = clamped;
      logA2FDebug('Audio2Face drain interval updated', {
        ms: drainIntervalMs
      });
    }
    return drainIntervalMs;
  }

  function getLastUpdateMetrics() {
    return lastUpdateMetrics;
  }

  function clearFallbackTimer(id) {
    const sessionId = id || 'default';
    const timer = fallbackFinalizationTimers.get(sessionId);
    if (!timer) {
      return;
    }
    const clear = (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function')
      ? globalThis.clearTimeout.bind(globalThis)
      : clearTimeout;
    clear(timer);
    fallbackFinalizationTimers.delete(sessionId);
  }

  function scheduleFallbackFinalization(id) {
    const sessionId = id || 'default';
    clearFallbackTimer(sessionId);
    const set = (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function')
      ? globalThis.setTimeout.bind(globalThis)
      : setTimeout;
    const timer = set(() => {
      fallbackFinalizationTimers.delete(sessionId);
      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const lastChunkAt = Number(session.lastChunkAt);
      if (Number.isFinite(lastChunkAt) && now - lastChunkAt < FALLBACK_SILENCE_TIMEOUT_MS) {
        scheduleFallbackFinalization(sessionId);
        return;
      }
      const finalizeAfterDrain = () => {
        finalizeSession(sessionId);
        if (activeResponseId === sessionId) {
          activeResponseId = null;
        }
      };
      const drainPromise = drainToA2F(session, { force: true });
      if (drainPromise && typeof drainPromise.finally === 'function') {
        drainPromise.finally(finalizeAfterDrain);
      } else {
        finalizeAfterDrain();
      }
    }, FALLBACK_SILENCE_TIMEOUT_MS);
    fallbackFinalizationTimers.set(sessionId, timer);
  }

  async function requestBlendshapes(session, base64Audio) {
    if (!fetchImpl) {
      console.warn('Audio2Face driver requires fetch support.');
      return null;
    }
    const payload = {
      apiKey: settings.apiKey,
      functionId: settings.functionId,
      audio: base64Audio,
      sampleRate: session.sampleRate || DEFAULT_SAMPLE_RATE,
      model: settings.model
    };

    if (session.debug) {
      session.debug.requests += 1;
    }

    const requestWall = Date.now();
    const requestPerf = getA2FPerformanceNow();
    if (session.debug) {
      logA2FDebug(
        'Requesting Audio2Face blendshapes',
        {
          id: session.id,
          model: payload.model,
          sampleRate: payload.sampleRate,
          sourceType: session.sourceType,
          requestCount: session.debug.requests,
          floatChunks: session.debug.floatChunks,
          pcmChunks: session.debug.pcmChunks,
          normalizedBytes: session.debug.lastNormalizedBytes || null
        },
        { wallTimeMs: requestWall, perfTimeMs: requestPerf }
      );
    }

    const response = await fetchImpl('/api/audio2face/blendshapes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Audio2Face request failed (${response.status})`);
    }

    const responseWall = Date.now();
    const responsePerf = getA2FPerformanceNow();
    const json = await response.json();
    const frameCount = Array.isArray(json?.frames) ? json.frames.length : 0;
    logA2FDebug(
      'Received Audio2Face response',
      {
        id: session.id,
        frames: frameCount,
        hasBlendshapeNames: Array.isArray(json?.blendshapeNames) && json.blendshapeNames.length > 0,
        status: json?.status?.code || null,
        latencyMs: toFixedNumber(responsePerf - requestPerf, 2)
      },
      { wallTimeMs: responseWall, perfTimeMs: responsePerf }
    );
    return json;
  }

  function encodeNewAudioForDrain(session, options = {}) {
    if (!session) {
      return null;
    }

    const requiredSeconds = Number.isFinite(options.minSeconds)
      ? Math.max(0, Number(options.minSeconds))
      : drainTargetSeconds;
    const isForce = Boolean(options.force);

    const startIndex = Number(session.lastDrainIndex) || 0;
    const sourceType = session.sourceType || (session.floatChunks?.length ? 'float32' : 'pcm16');

    if (sourceType === 'pcm16') {
      const allChunks = Array.isArray(session.chunks) ? session.chunks : [];
      if (startIndex >= allChunks.length) {
        return null;
      }
      const availableChunks = allChunks.slice(startIndex);
      if (!availableChunks.length) {
        return null;
      }
      const sampleRate = Number(session.sampleRate) > 0 ? Number(session.sampleRate) : PCM16_TARGET_SAMPLE_RATE;
      const selected = [];
      let secondsAccum = 0;
      for (let i = 0; i < availableChunks.length; i += 1) {
        const chunk = availableChunks[i];
        if (!chunk || !chunk.length) {
          continue;
        }
        const chunkSeconds = (chunk.length / 2) / Math.max(sampleRate, 1);
        selected.push(chunk);
        secondsAccum += chunkSeconds;
        if (secondsAccum >= requiredSeconds || isForce) {
          break;
        }
      }
      if (!selected.length) {
        return null;
      }
      if (!isForce && secondsAccum < requiredSeconds) {
        return null;
      }
      const concatenated = concatUint8Arrays(selected);
      if (!concatenated.length) {
        return null;
      }
      let effectiveRate = sampleRate;
      let pcmBytes = concatenated;
      let seconds;
      if (effectiveRate !== PCM16_TARGET_SAMPLE_RATE) {
        const floatData = pcm16BytesToFloat32Mono(concatenated);
        const resampled = resampleFloat32Mono(floatData, effectiveRate, PCM16_TARGET_SAMPLE_RATE);
        pcmBytes = float32ToPcm16Mono16k(resampled);
        seconds = resampled.length / PCM16_TARGET_SAMPLE_RATE;
        effectiveRate = PCM16_TARGET_SAMPLE_RATE;
      } else {
        const samples = pcmBytes.length / 2;
        seconds = samples / Math.max(effectiveRate, 1);
      }
      const base64 = uint8ArrayToBase64(pcmBytes);
      if (!base64) {
        return null;
      }
      return {
        base64,
        seconds: Number.isFinite(seconds) ? seconds : 0,
        chunksDrained: selected.length,
        chunkType: 'pcm16'
      };
    }

    const allFloat = Array.isArray(session.floatChunks) ? session.floatChunks : [];
    if (startIndex >= allFloat.length) {
      return null;
    }
    const availableFloat = allFloat.slice(startIndex);
    if (!availableFloat.length) {
      return null;
    }

    const captureRate = Number(session.captureSampleRate) > 0
      ? Number(session.captureSampleRate)
      : Number(session.sampleRate) > 0
        ? Number(session.sampleRate)
        : DEFAULT_SAMPLE_RATE;

    const selectedFloat = [];
    let floatSeconds = 0;
    for (let i = 0; i < availableFloat.length; i += 1) {
      const chunk = availableFloat[i];
      if (!(chunk instanceof Float32Array) || chunk.length === 0) {
        continue;
      }
      const chunkSeconds = chunk.length / Math.max(captureRate, 1);
      selectedFloat.push(chunk);
      floatSeconds += chunkSeconds;
      if (floatSeconds >= requiredSeconds || isForce) {
        break;
      }
    }

    if (!selectedFloat.length) {
      return null;
    }

    if (!isForce && floatSeconds < requiredSeconds) {
      return null;
    }

    const combined = concatFloat32Arrays(selectedFloat);
    if (!(combined instanceof Float32Array) || combined.length === 0) {
      return null;
    }

    const sourceRate = captureRate;

    const resampled = sourceRate === PCM16_TARGET_SAMPLE_RATE
      ? combined
      : resampleFloat32Mono(combined, sourceRate, PCM16_TARGET_SAMPLE_RATE);

    if (!(resampled instanceof Float32Array) || resampled.length === 0) {
      return null;
    }

    const pcmBytes = float32ToPcm16Mono16k(resampled);
    if (!pcmBytes.length) {
      return null;
    }

    const seconds = resampled.length / PCM16_TARGET_SAMPLE_RATE;
    const base64 = uint8ArrayToBase64(pcmBytes);
    if (!base64) {
      return null;
    }

    return {
      base64,
      seconds: Number.isFinite(seconds) ? seconds : 0,
      chunksDrained: selectedFloat.length,
      chunkType: 'float32'
    };
  }

  function handleBlendshapeResponse(session, data, options = {}) {
    const hadFrames = Array.isArray(session.frames) && session.frames.length > 0;
    const frameCount = Array.isArray(data?.frames) ? data.frames.length : 0;
    logA2FDebug('Applying Audio2Face response data', {
      id: session.id,
      frames: frameCount
    });
    const append = Boolean(options.append);
    const baseTimeSec = Number.isFinite(options.baseTimeSec)
      ? Math.max(0, options.baseTimeSec)
      : Number(session.framesCoveredSec) || 0;
    const normalizedFrames = applyBlendshapeFrames(session, data, { append, baseTimeSec }) || [];
    const normalizedCount = normalizedFrames.length;
    const lastFrameTimeBefore = Number.isFinite(session.lastFrameTime) ? session.lastFrameTime : null;
    const regressionThreshold = DEFAULT_FRAME_DELTA_SEC + 1e-3;
    const dropThreshold = Number.isFinite(lastFrameTimeBefore)
      ? lastFrameTimeBefore - FRAME_LATE_DROP_SEC
      : null;
    let horizonTime = lastFrameTimeBefore;
    let orderStatus = normalizedCount > 0 ? 'in-order' : 'empty';
    let droppedLateCount = 0;
    const acceptedFrames = [];
    normalizedFrames.forEach((frame) => {
      if (!frame || typeof frame !== 'object') {
        return;
      }
      const frameTime = Number(frame.time);
      if (!Number.isFinite(frameTime)) {
        return;
      }
      if (Number.isFinite(dropThreshold) && frameTime < dropThreshold) {
        droppedLateCount += 1;
        session.lateDropsTotal = (session.lateDropsTotal || 0) + 1;
        return;
      }
      if (Number.isFinite(horizonTime) && frameTime < horizonTime - regressionThreshold) {
        orderStatus = 'out-of-order-reinserted';
      }
      acceptedFrames.push(frame);
      horizonTime = frameTime;
    });

    if (droppedLateCount > 0) {
      orderStatus = 'dropped-late';
    }

    if (acceptedFrames.length > 0) {
      session.audioCompleted = false;
      session.audioCompletedAt = null;
      enqueueSessionFrames(session, acceptedFrames);
      if (!Number.isFinite(session.timelineStart)) {
        if (Number.isFinite(options.timelineStart)) {
          session.timelineStart = Number(options.timelineStart);
          session.wallTimelineStart = session.timelineStart * 1000;
        } else if (Number.isFinite(session.startedAt)) {
          session.wallTimelineStart = Number(session.startedAt);
          session.timelineStart = session.wallTimelineStart / 1000;
        } else if (Number.isFinite(sessionStartTime)) {
          session.wallTimelineStart = Number(sessionStartTime);
          session.timelineStart = session.wallTimelineStart / 1000;
        } else {
          const fallbackNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
          session.wallTimelineStart = fallbackNow;
          session.timelineStart = fallbackNow / 1000;
        }
      }

      if (typeof onFrames === 'function') {
        try {
          onFrames({
            responseId: session.id,
            frames: normalizedFrames,
            append,
            baseTimeSec
          });
        } catch (error) {
          console.warn('Audio2Face onFrames callback failed', error);
        }
      }

      if (!hadFrames && typeof onFirstFrames === 'function') {
        try {
          onFirstFrames({
            responseId: session.id,
            frames: normalizedFrames,
            baseTimeSec
          });
        } catch (error) {
          console.warn('Audio2Face onFirstFrames callback failed', error);
        }
      }
    } else {
      logA2FDebug('Audio2Face response did not include usable frames', { id: session.id });
    }

    const queue = ensureSessionQueue(session);
    const queueFirst = queue.length ? queue[0] : null;
    const queueLast = queue.length ? queue[queue.length - 1] : null;
    const queueStartTime = Number(queueFirst?.time);
    const queueEndTime = Number(queueLast?.time);
    const queueDuration = Number.isFinite(queueStartTime) && Number.isFinite(queueEndTime)
      ? Math.max(0, queueEndTime - queueStartTime)
      : 0;
    const horizonPlayAt = queueLast && Number.isFinite(queueLast.playAt)
      ? queueLast.playAt
      : (session.anchor && Number.isFinite(queueEndTime))
        ? session.anchor.audio0 + (queueEndTime - (Number.isFinite(session.anchor.a2f0) ? session.anchor.a2f0 : 0))
        : null;
    const audioClock = Number.isFinite(session.lastKnownAudioTime) ? session.lastKnownAudioTime : null;
    const horizonGapSec = Number.isFinite(horizonPlayAt) && Number.isFinite(audioClock)
      ? horizonPlayAt - audioClock
      : null;
    const baseOffsetSec = Number.isFinite(session.baseOffsetSec)
      ? session.baseOffsetSec
      : (session.anchor && Number.isFinite(session.anchor.audio0))
        ? session.anchor.audio0 - (Number.isFinite(session.anchor.a2f0) ? session.anchor.a2f0 : 0)
        : null;
    const firstLocalTime = acceptedFrames[0]?.localTime ?? normalizedFrames[0]?.localTime ?? null;
    const lastLocalTime = acceptedFrames[acceptedFrames.length - 1]?.localTime
      ?? normalizedFrames[normalizedFrames.length - 1]?.localTime
      ?? null;
    const queueSecondsAfterInsert = Number.isFinite(horizonGapSec)
      ? Math.max(0, horizonGapSec)
      : queueDuration;

    logA2FDebug('Audio2Face frames enqueued', {
      id: session.id,
      batchCount: normalizedCount,
      acceptedCount: acceptedFrames.length,
      orderStatus,
      droppedLate: droppedLateCount,
      lateDropsTotal: session.lateDropsTotal || 0,
      localRange: [
        Number.isFinite(firstLocalTime) ? Number(firstLocalTime.toFixed(3)) : null,
        Number.isFinite(lastLocalTime) ? Number(lastLocalTime.toFixed(3)) : null
      ],
      computedAbsRange: baseOffsetSec != null
        ? [
            Number.isFinite(firstLocalTime)
              ? Number((firstLocalTime + baseOffsetSec).toFixed(3))
              : null,
            Number.isFinite(lastLocalTime)
              ? Number((lastLocalTime + baseOffsetSec).toFixed(3))
              : null
          ]
        : [null, null],
      queueSecondsAfterInsert: Number(queueSecondsAfterInsert.toFixed(3)),
      horizonGapSec: Number.isFinite(horizonGapSec) ? Number(horizonGapSec.toFixed(3)) : null,
      guardSec: Number.isFinite(DEFAULT_PLAYBACK_GUARD_SEC)
        ? Number(DEFAULT_PLAYBACK_GUARD_SEC.toFixed(3))
        : null
    });
  }

  function drainToA2F(session, { force = false } = {}) {
    if (!session || !isActive()) {
      return null;
    }

    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    if (!force) {
      const lastDrainAt = Number(session.lastDrainAt) || 0;
      const interval = Math.max(MIN_DRAIN_INTERVAL_MS, Number(drainIntervalMs) || DEFAULT_DRAIN_INTERVAL_MS);
      if (now - lastDrainAt < interval) {
        return null;
      }
    }

    if (session.pending) {
      if (force && typeof session.pending?.finally === 'function') {
        session.pending.finally(() => {
          drainToA2F(session, { force: true });
        });
      }
      return session.pending;
    }

    const payload = encodeNewAudioForDrain(session, {
      minSeconds: force ? 0 : drainTargetSeconds,
      force
    });
    if (!payload || !payload.base64) {
      if (force) {
        session.lastDrainAt = now;
      }
      return null;
    }

    const baseTimeSec = Number(session.framesCoveredSec) || 0;

    session.lastDrainRequestedAt = now;
    session.pendingDrainStartedAt = now;

    const request = requestBlendshapes(session, payload.base64)
      .then((data) => {
        const shouldAppend = Array.isArray(session.frames) && session.frames.length > 0;
        handleBlendshapeResponse(session, data, { append: shouldAppend, baseTimeSec });
        if (payload.chunkType === 'float32' && Array.isArray(session.floatChunks) && payload.chunksDrained > 0) {
          session.floatChunks.splice(0, payload.chunksDrained);
        } else if (payload.chunkType === 'pcm16' && Array.isArray(session.chunks) && payload.chunksDrained > 0) {
          session.chunks.splice(0, payload.chunksDrained);
        }
        session.lastDrainIndex = 0;
      })
      .catch((err) => {
        console.error('Audio2Face micro-drain failed', err);
      })
      .finally(() => {
        const finishedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now();
        const startedAt = Number(session.pendingDrainStartedAt);
        if (typeof onDrainComplete === 'function' && Number.isFinite(startedAt)) {
          const latencyMs = finishedAt - startedAt;
          if (Number.isFinite(latencyMs)) {
            try {
              onDrainComplete({
                responseId: session.id,
                latencyMs,
                chunkSeconds: Number(payload.seconds) || 0,
                chunkType: payload.chunkType || null
              });
            } catch (error) {
              console.warn('Audio2Face onDrainComplete callback failed', error);
            }
          }
        }
        session.pendingDrainStartedAt = null;
        session.pending = null;
        session.lastDrainAt = now;
        if (force) {
          drainToA2F(session, { force: true });
        } else {
          drainToA2F(session);
        }
      });

    session.pending = request;
    return request;
  }

  function finalizeSession(id) {
    const session = sessions.get(id);
    if (!session || session.pending || !isActive()) {
      return;
    }
    clearFallbackTimer(session.id);
    const hasPcmChunks = Array.isArray(session.chunks) && session.chunks.length > 0;
    const hasFloatChunks = Array.isArray(session.floatChunks) && session.floatChunks.length > 0;
    if (!hasPcmChunks && !hasFloatChunks) {
      logA2FDebug('Skipping Audio2Face finalize - no audio chunks', { id: session?.id || id });
      return;
    }

    logA2FDebug('Finalizing Audio2Face capture', {
      id: session.id,
      pcmChunks: session.chunks.length,
      floatChunks: session.floatChunks.length,
      sampleRate: session.sampleRate
    });

    let normalized;

    if (hasPcmChunks) {
      const audioBytes = concatUint8Arrays(session.chunks);
      session.chunks = [];
      normalized = ensurePcm16Mono16k(audioBytes, Number(session.sampleRate));
    } else {
      const floatData = concatFloat32Arrays(session.floatChunks);
      session.floatChunks = [];
      const captureRate = Number(session.captureSampleRate);
      const sourceRate = Number.isFinite(captureRate) && captureRate > 0 ? captureRate : session.sampleRate;
      const resampled = resampleFloat32Mono(floatData, sourceRate || DEFAULT_SAMPLE_RATE, PCM16_TARGET_SAMPLE_RATE);
      const bytes = float32ToPcm16Mono16k(resampled);
      const stats = pcm16Stats(bytes);
      normalized = {
        bytes,
        sampleRate: PCM16_TARGET_SAMPLE_RATE,
        stats
      };
    }

    if (!normalized || !normalized.bytes || normalized.bytes.length === 0) {
      logA2FDebug('Normalized audio was empty after finalize', { id: session.id });
      return;
    }

    if (normalized.stats && (normalized.stats.samples === 0 || normalized.stats.rms === 0)) {
      console.warn('A2F: normalized audio is silent/empty', normalized.stats);
    }

    session.sampleRate = normalized.sampleRate;
    session.captureSampleRate = null;
    session.sourceType = null;

    if (session.debug) {
      session.debug.lastNormalizedBytes = normalized.bytes.length;
    }

    const base64Audio = uint8ArrayToBase64(normalized.bytes);
    if (!base64Audio) {
      logA2FDebug('Failed to encode normalized audio to base64', { id: session.id });
      return;
    }

    session.pending = requestBlendshapes(session, base64Audio)
      .then((data) => {
        const shouldAppend = Array.isArray(session.frames) && session.frames.length > 0;
        handleBlendshapeResponse(session, data, { append: shouldAppend });
      })
      .catch((error) => {
        console.error('Audio2Face blendshape request failed', error);
        sessions.delete(id);
      })
      .finally(() => {
        session.pending = null;
        if (session.debug) {
          session.debug.lastFinalizedAt = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        }
      });
  }

  function getSession(id) {
    const resolvedId = id || 'default';
    if (!sessions.has(resolvedId)) {
      const session = createSession(resolvedId);
      sessions.set(resolvedId, session);
      logA2FDebug('Created new capture session', { id: resolvedId });
    }
    return sessions.get(resolvedId);
  }

  function ingestFloat32AudioChunk(responseId, chunk, sampleRate, timestamp = performance.now()) {
    if (!isActive()) {
      logA2FDebug('Ignoring float32 audio chunk while driver inactive');
      return;
    }
    if (!(chunk instanceof Float32Array) || chunk.length === 0) {
      logA2FDebug('Ignoring invalid float32 audio chunk', {
        hasChunk: chunk instanceof Float32Array,
        length: chunk?.length || 0
      });
      return;
    }
    const targetId = responseId || activeResponseId;
    if (!targetId) {
      logA2FDebug('Dropping float32 audio chunk without active response id', {
        samples: chunk.length
      });
      return;
    }
    const session = getSession(targetId);
    if (!session) {
      logA2FDebug('Failed to locate session for float32 audio chunk', {
        responseId: targetId
      });
      return;
    }
    if (session.sourceType === 'pcm16') {
      logA2FDebug('Skipping float32 chunk because PCM16 stream already active', {
        responseId: targetId
      });
      return;
    }

    const copy = chunk.slice();
    session.floatChunks.push(copy);
    session.sourceType = 'float32';
    session.lastChunkAt = Number(timestamp) || ((typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now());
    if (session.debug) {
      session.debug.floatChunks += 1;
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      if (!session.debug.lastFloatLogTime || now - session.debug.lastFloatLogTime > 1500) {
        session.debug.lastFloatLogTime = now;
        logA2FDebug('Received float32 audio chunk', {
          id: session.id,
          samples: copy.length,
          sampleRate,
          totalFloatChunks: session.debug.floatChunks
        });
      }
    }

    const numericRate = Number(sampleRate);
    if (Number.isFinite(numericRate) && numericRate > 0) {
      session.captureSampleRate = numericRate;
      session.sampleRate = numericRate;
    }

    if (!session.startedAt) {
      session.startedAt = timestamp;
    }

    const stats = float32Stats(copy);
    captureStats.audioChunksIn += 1;
    captureStats.audioSamplesIn += stats.samples;
    captureStats.audioBytesIn += copy.length * 4;
    if (stats.samples === 0 || stats.rms === 0) {
      captureStats.silentChunks += 1;
      console.warn('A2F: silent/empty float32 chunk', stats);
    }

    drainToA2F(session);
  }

  function handleAssistantEvent(event, timestamp = performance.now()) {
    if (!isActive()) {
      if (!inactiveEventLogged) {
        inactiveEventLogged = true;
        logA2FDebug('Assistant event received while driver inactive', {
          type: event?.type,
          enabledSetting: settings.enabled,
          hasApiKey: Boolean(settings.apiKey)
        });
      }
      return;
    }

    inactiveEventLogged = false;

    const normalizedType = getNormalizedEventType(event);
    if (!normalizedType) {
      return;
    }

    const responseId = extractResponseId(event);
    logA2FDebug('Assistant event received', {
      type: event?.type || 'unknown',
      normalizedType,
      responseId
    });
    const session = getSession(responseId);
    const sessionId = session?.id || responseId || 'default';
    const startEvent = isAudioStartType(normalizedType);
    const stopEvent = isAudioCompletionType(normalizedType);
    const fallbackStopEvent = isAudioFallbackCompletionType(normalizedType);
    if ((responseId && isAudioDeltaType(normalizedType)) || startEvent) {
      activeResponseId = sessionId;
    }
    if (startEvent) {
      clearFallbackTimer(sessionId);
    }
    if (session && (startEvent || isAudioDeltaType(normalizedType))) {
      session.audioCompleted = false;
      session.audioCompletedAt = null;
    }
    const sampleRate = extractSampleRate(event);
    if (Number.isFinite(sampleRate) && sampleRate > 0) {
      session.sampleRate = sampleRate;
    }

    const audioDetails = getAudioEventDetails(event, normalizedType);
    if (audioDetails) {
      if (!isValidOpenAIRealtimeAudioEvent(audioDetails.event, audioDetails.type)) {
        return;
      }
      const chunk = decodeNormalizedBase64ToUint8Array(audioDetails.normalizedBase64);
      if (!chunk || !chunk.length) {
        return;
      }
      const chunkStats = pcm16Stats(chunk);
      logA2FDebug('Assistant PCM16 audio payload decoded', {
        id: session.id,
        bytes: chunk.length,
        samples: chunkStats.samples,
        rms: chunkStats.rms
      });
      captureStats.audioChunksIn += 1;
      captureStats.audioBytesIn += chunk.length;
      captureStats.audioSamplesIn += chunkStats.samples;
      if (chunkStats.samples === 0 || chunkStats.rms === 0) {
        captureStats.silentChunks += 1;
        console.warn('A2F: silent/empty PCM16 chunk', chunkStats);
      }
      session.chunks.push(chunk);
      session.sourceType = 'pcm16';
      session.lastChunkAt = Number(timestamp) || ((typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now());
      if (session.debug) {
        session.debug.pcmChunks += 1;
        const now = (typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now();
        if (!session.debug.lastPcmLogTime || now - session.debug.lastPcmLogTime > 1500) {
          session.debug.lastPcmLogTime = now;
          logA2FDebug('Buffered PCM16 audio chunk', {
            id: session.id,
            bytes: chunk.length,
            totalPcmChunks: session.debug.pcmChunks,
            sampleRate: session.sampleRate || null
          });
        }
      }
      session.captureSampleRate = null;
      if (!session.startedAt) {
        session.startedAt = timestamp;
      }
      drainToA2F(session);
      return;
    }

    if ((startEvent || isAudioDeltaType(normalizedType)) && !session.startedAt) {
      session.startedAt = timestamp;
    }

    if (stopEvent) {
      clearFallbackTimer(sessionId);
      if (session) {
        session.audioCompleted = true;
        session.audioCompletedAt = Number(timestamp) || ((typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now());
      }
      const finalizeAfterDrain = () => {
        finalizeSession(sessionId);
        if (activeResponseId === sessionId) {
          activeResponseId = null;
        }
      };
      const drainPromise = drainToA2F(session, { force: true });
      if (drainPromise && typeof drainPromise.finally === 'function') {
        drainPromise.finally(finalizeAfterDrain);
      } else {
        finalizeAfterDrain();
      }
      logA2FDebug('Assistant audio buffer stopped', {
        responseId: sessionId,
        normalizedType
      });
      return;
    }

    if (fallbackStopEvent) {
      if (session) {
        session.audioCompleted = true;
        session.audioCompletedAt = Number(timestamp) || ((typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now());
      }
      drainToA2F(session, { force: true });
      scheduleFallbackFinalization(sessionId);
      logA2FDebug('Assistant audio fallback completion scheduled', {
        responseId: sessionId,
        normalizedType,
        timeoutMs: FALLBACK_SILENCE_TIMEOUT_MS
      });
    }
  }

  function update(arg) {
    if (!isActive()) {
      lastUpdateMetrics = { sessions: [], audioTimeSec: 0 };
      return { totals: new Map(), vowelActive: false, metrics: [] };
    }

    let timestamp = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    let audioTime = null;

    if (typeof arg === 'number') {
      timestamp = arg;
    } else if (arg && typeof arg === 'object') {
      if (Number.isFinite(arg.timestamp)) {
        timestamp = arg.timestamp;
      }
      if (Number.isFinite(arg.audioTime)) {
        audioTime = arg.audioTime;
      }
    }

    const numericNow = Number(timestamp);
    const now = Number.isFinite(numericNow)
      ? numericNow
      : (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

    const totals = new Map();
    let vowelActive = false;
    const metrics = [];

    if (sessions.size === 0) {
      if (!lastNoFramesLogTime || now - lastNoFramesLogTime > 2500) {
        lastNoFramesLogTime = now;
        logA2FDebug('Audio2Face active but no sessions with frames yet');
      }
    }

    sessions.forEach((session, id) => {
      const queue = ensureSessionQueue(session);

      if (Number.isFinite(audioTime)) {
        session.lastKnownAudioTime = audioTime;
        pumpSessionFrames(session, audioTime);
      }

      const values = session.currentValues instanceof Map ? session.currentValues : new Map();
      values.forEach((value, name) => {
        if (!Number.isFinite(value) || value <= 0) {
          return;
        }
        const clamped = clamp01(value);
        const current = totals.get(name) || 0;
        if (clamped > current) {
          totals.set(name, clamped);
        }
        if (!vowelActive && name === 'jawOpen' && clamped > 0.25) {
          vowelActive = true;
        }
      });

      const framesCount = queue.length;
      const firstQueueTime = queue.length ? queue[0].time : session.lastSampleTimeSec || 0;
      const lastQueueTime = queue.length ? queue[queue.length - 1].time : session.lastFrameTime || session.lastSampleTimeSec || 0;

      let horizonPlayAt = null;
      if (queue.length && Number.isFinite(queue[queue.length - 1].playAt)) {
        horizonPlayAt = queue[queue.length - 1].playAt;
      } else if (session.anchor && Number.isFinite(lastQueueTime)) {
        const anchorFrame = Number.isFinite(session.anchor.a2f0) ? session.anchor.a2f0 : 0;
        horizonPlayAt = session.anchor.audio0 + (lastQueueTime - anchorFrame);
      }

      const audioClock = Number.isFinite(audioTime) ? audioTime : session.lastSampleTimeSec || 0;
      const horizonGapSec = Number.isFinite(horizonPlayAt) && Number.isFinite(audioClock)
        ? horizonPlayAt - audioClock
        : null;

      if (Number.isFinite(horizonGapSec) && horizonGapSec < -0.25) {
        const lastThinLog = Number(session.lastThinHorizonLog) || 0;
        if (!Number.isFinite(lastThinLog) || now - lastThinLog > 500) {
          session.lastThinHorizonLog = now;
          logA2FDebug('HORIZON negative', {
            id,
            horizonGapSec: Number(horizonGapSec.toFixed(3))
          });
        }
      }

      const metricEntry = {
        id,
        framesCount,
        framesDurationSec: Math.max(0, lastQueueTime - firstQueueTime),
        framesStartSec: firstQueueTime,
        framesEndSec: lastQueueTime,
        audioTimeSec: audioClock,
        horizonGapSec,
        audioCompleted: Boolean(session.audioCompleted)
      };
      if (session.lateDropsTotal) {
        metricEntry.lateDropsTotal = session.lateDropsTotal;
      }
      metrics.push(metricEntry);

      if (session.audioCompleted && queue.length === 0) {
        session.currentValues = decayToNeutral(session.currentValues, A2F_DECAY_FACTOR);
        if (!Number.isFinite(session.idleDrainSince)) {
          session.idleDrainSince = now;
        }
        const idleElapsed = session.idleDrainSince ? now - session.idleDrainSince : 0;
        if (idleElapsed > 250) {
          clearFallbackTimer(session.id);
          sessions.delete(id);
          logA2FDebug('Session closed (idle drain)', {
            id,
            idleMs: Number.isFinite(idleElapsed) ? Number((idleElapsed).toFixed(1)) : null,
            lateDropsTotal: session.lateDropsTotal || 0
          });
          return;
        }
      } else {
        session.idleDrainSince = null;
      }
    });

    lastUpdateMetrics = {
      sessions: metrics,
      audioTimeSec: Number.isFinite(audioTime) ? audioTime : metrics[0]?.audioTimeSec || 0
    };

    if (metrics.length > 0 && (!Number.isFinite(lastHealthLogTime) || now - lastHealthLogTime > A2F_HEALTH_LOG_INTERVAL_MS)) {
      lastHealthLogTime = now;
      const primary = metrics[0];
      if (primary) {
        const framesAhead = Number.isFinite(primary.horizonGapSec) ? primary.horizonGapSec : null;
        logA2FDebug('Audio2Face health', {
          audioTime: Number.isFinite(primary.audioTimeSec)
            ? Number(primary.audioTimeSec.toFixed(3))
            : null,
          framesAhead: Number.isFinite(framesAhead) ? Number(framesAhead.toFixed(3)) : null,
          drainTargetSec: Number(getDrainTargetSeconds().toFixed(3)),
          drainIntervalMs: getDrainIntervalMs(),
          framesCount: primary.framesCount,
          framesDuration: Number.isFinite(primary.framesDurationSec)
            ? Number(primary.framesDurationSec.toFixed(3))
            : null,
          audioDone: primary.audioCompleted,
          lateDropsTotal: Number.isFinite(primary.lateDropsTotal)
            ? primary.lateDropsTotal
            : 0
        });
      }
    }

    return { totals, vowelActive, metrics };
  }

  function updateSettings(next = {}) {
    const model = normalizeModel(next.model);
    const apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : '';
    const functionId = typeof next.functionId === 'string' ? next.functionId.trim() : '';
    const enabled = Boolean(next.enabled && apiKey);

    settings = {
      enabled,
      apiKey,
      model,
      functionId
    };

    inactiveEventLogged = false;
    lastNoFramesLogTime = 0;
    logA2FDebug('Audio2Face settings updated', {
      enabled,
      model,
      functionId: functionId || 'default',
      apiKey: summarizeSecret(apiKey)
    });

    if (!enabled) {
      reset();
    }
  }

  function onSessionStarted(timestamp = performance.now()) {
    sessionStartTime = Number(timestamp) || performance.now();
    sessions.clear();
    activeResponseId = null;
    inactiveEventLogged = false;
    lastNoFramesLogTime = 0;
    clearAllFallbackTimers();
    logA2FDebug('Audio session started', { timestamp: sessionStartTime });
  }

  function onSessionEnded() {
    sessions.clear();
    activeResponseId = null;
    inactiveEventLogged = false;
    lastNoFramesLogTime = 0;
    clearAllFallbackTimers();
    logA2FDebug('Audio session ended');
  }

  function getActiveResponseId() {
    return activeResponseId;
  }

  function setTimelineStart(responseId, timelineStartSec) {
    const targetId = responseId || activeResponseId;
    if (!targetId || !Number.isFinite(timelineStartSec)) {
      return;
    }
    const session = getSession(targetId);
    if (!session) {
      return;
    }
    session.timelineStart = Number(timelineStartSec);
    session.wallTimelineStart = session.timelineStart * 1000;
    session.audioClockOffset = null;
    session.syncBiasSec = 0;
    if (!session.anchor) {
      session.anchor = { audio0: session.timelineStart, a2f0: 0 };
    } else {
      session.anchor.audio0 = session.timelineStart;
      if (!Number.isFinite(session.anchor.a2f0)) {
        session.anchor.a2f0 = 0;
      }
    }
    session.lastEmitAudioTime = Number.isFinite(session.timelineStart)
      ? session.timelineStart - FRAME_MIN_SPACING_SEC
      : session.lastEmitAudioTime;
    ensureSessionQueue(session).forEach((frame) => scheduleFramePlayback(session, frame));
    logA2FDebug('Timeline start updated for session', {
      id: session.id,
      timelineStart: Number(session.timelineStart.toFixed(3))
    });
  }

  function setPlaybackAnchor(responseId, audioStartSec, frameStartSec = 0) {
    const targetId = responseId || activeResponseId;
    if (!targetId || !Number.isFinite(audioStartSec)) {
      return;
    }
    const session = getSession(targetId);
    if (!session) {
      return;
    }
    const anchor = {
      audio0: Number(audioStartSec),
      a2f0: Number.isFinite(frameStartSec) ? Number(frameStartSec) : 0
    };
    session.anchor = anchor;
    session.timelineStart = anchor.audio0;
    session.wallTimelineStart = anchor.audio0 * 1000;
    session.audioClockOffset = null;
    session.syncBiasSec = 0;
    session.lastEmitAudioTime = anchor.audio0 - FRAME_MIN_SPACING_SEC;
    session.baseOffsetSec = anchor.audio0 - anchor.a2f0;
    ensureSessionQueue(session).forEach((frame) => scheduleFramePlayback(session, frame));
    logA2FDebug('Playback anchor established', {
      id: session.id,
      audioStart: Number(anchor.audio0.toFixed(3)),
      frameStart: Number(anchor.a2f0.toFixed(3)),
      baseOffsetSec: Number.isFinite(session.baseOffsetSec)
        ? Number(session.baseOffsetSec.toFixed(3))
        : null
    });
  }

  function prepareForResponse(responseId) {
    const targetId = responseId || activeResponseId;
    if (!targetId) {
      return;
    }
    const session = getSession(targetId);
    if (!session) {
      return;
    }
    resetSessionPlayback(session);
    session.audioCompleted = false;
    session.audioCompletedAt = null;
  }

  return {
    updateSettings,
    handleAssistantEvent,
    update,
    reset,
    isActive,
    onSessionStarted,
    onSessionEnded,
    ingestFloat32AudioChunk,
    getActiveResponseId,
    setTimelineStart,
    setPlaybackAnchor,
    prepareForResponse,
    setDrainTargetSeconds,
    getDrainTargetSeconds,
    setDrainIntervalMs,
    getDrainIntervalMs,
    getLastUpdateMetrics
  };
}
