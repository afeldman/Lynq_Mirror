/**
 * Audio Processing Utilities
 * Audio normalization, resampling, and format conversion
 */

import {
  PCM16_BYTES_PER_SAMPLE,
  PCM16_TARGET_SAMPLE_RATE,
} from "./constants.ts";

/**
 * Normalize audio to PCM16 16kHz mono
 * Handles resampling and float32 to int16 conversion
 */
export function normalizeAudioToPCM16(
  audioData: Float32Array,
  originalSampleRate: number,
): Uint8Array {
  // Resample if needed
  let pcm16Data = audioData;

  if (originalSampleRate !== PCM16_TARGET_SAMPLE_RATE) {
    const ratio = PCM16_TARGET_SAMPLE_RATE / originalSampleRate;
    const newLength = Math.round(audioData.length * ratio);
    pcm16Data = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio;
      const srcIndexInt = Math.floor(srcIndex);
      const srcIndexFrac = srcIndex - srcIndexInt;

      if (srcIndexInt + 1 < audioData.length) {
        pcm16Data[i] = audioData[srcIndexInt] * (1 - srcIndexFrac) +
          audioData[srcIndexInt + 1] * srcIndexFrac;
      } else {
        pcm16Data[i] = audioData[srcIndexInt];
      }
    }
  }

  // Convert float32 to int16
  const buffer = new ArrayBuffer(pcm16Data.length * 2);
  const view = new Int16Array(buffer);

  for (let i = 0; i < pcm16Data.length; i++) {
    let sample = pcm16Data[i] < 0
      ? pcm16Data[i] * 0x8000
      : pcm16Data[i] * 0x7fff;
    sample = Math.max(-32768, Math.min(32767, sample));
    view[i] = sample;
  }

  return new Uint8Array(buffer);
}

/**
 * Decode audio from base64 to Uint8Array
 */
export function decodeBase64Audio(base64Data: string): Uint8Array {
  return new Uint8Array(
    atob(base64Data)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
}

/**
 * Encode audio Uint8Array to base64
 */
export function encodeBase64Audio(audioData: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < audioData.length; i++) {
    binary += String.fromCharCode(audioData[i]);
  }
  return btoa(binary);
}

/**
 * Get audio duration in seconds
 */
export function getAudioDuration(
  audioData: Uint8Array,
  sampleRate: number = PCM16_TARGET_SAMPLE_RATE,
): number {
  const samples = audioData.length / PCM16_BYTES_PER_SAMPLE;
  return samples / sampleRate;
}

/**
 * Get audio statistics
 */
export function getAudioStats(audioData: Uint8Array): {
  duration: number;
  sampleCount: number;
  byteSize: number;
} {
  return {
    duration: getAudioDuration(audioData),
    sampleCount: audioData.length / PCM16_BYTES_PER_SAMPLE,
    byteSize: audioData.length,
  };
}
