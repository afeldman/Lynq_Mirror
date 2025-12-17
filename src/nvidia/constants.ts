/**
 * Audio2Face Constants
 * PCM16, sample rates, timing, and system-wide constants
 */

export const PCM16_TARGET_SAMPLE_RATE = 16000;
export const PCM16_BYTES_PER_SAMPLE = 2;
export const PCM16_CHUNK_SIZE_BYTES = 16000; // ~500ms @ 16kHz mono
export const PCM16_CHUNK_DURATION_SEC = PCM16_CHUNK_SIZE_BYTES /
  (PCM16_TARGET_SAMPLE_RATE * PCM16_BYTES_PER_SAMPLE);

export const DEFAULT_FRAME_DELTA_SEC = 1 / 30;
export const HEARTBEAT_INTERVAL_MS = 1000;
export const STATS_INTERVAL_MS = 2000;

// Audio buffer constants
export const NORMALIZED_LENGTH_TOLERANCE_BYTES = 8000;
export const NORMALIZED_DURATION_TOLERANCE_SEC = 0.1;
