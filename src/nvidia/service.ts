/**
 * Audio2Face Service
 * Main integration with Audio2Face gRPC service
 */

import {
  loadModelConfig,
  parseEmotionWithTimecode,
  getBlendshapeParams,
} from "./config-loader.ts";
import {
  getDefaultFunctionIdForModel,
  isValidModel,
  DEFAULT_MODEL,
} from "./models.ts";
import { decodeBase64Audio, getAudioStats } from "./audio-processor.ts";

export interface A2FProcessResponse {
  success: boolean;
  model: string;
  functionId: string;
  audioStats: {
    duration: number;
    sampleCount: number;
    byteSize: number;
  };
  timestamp: string;
  config?: Record<string, unknown>;
  emotions?: Array<{ timeCode: number; emotions: Record<string, number> }>;
  blendshapes?: Record<string, number>;
}

/**
 * Process audio with Audio2Face
 * @param audioData Base64 encoded audio data
 * @param model Model name (default: mark_v2_3)
 * @param functionId Optional custom function ID
 */
export async function processAudioWithA2F(
  audioData: string,
  model: string = DEFAULT_MODEL,
  functionId?: string
): Promise<A2FProcessResponse> {
  try {
    // Validate model
    if (!isValidModel(model)) {
      throw new Error(
        `Invalid model: ${model}. Supported models: mark_v2_3, claire_v2_3, james_v2_3`
      );
    }

    // Load model configuration
    const config = await loadModelConfig(model);

    // Get function ID
    const fnId = functionId || getDefaultFunctionIdForModel(model);

    // Decode audio from base64
    const audioBuffer = decodeBase64Audio(audioData);
    const audioStats = getAudioStats(audioBuffer);

    // Extract config data
    const emotions = parseEmotionWithTimecode(config);
    const blendshapeParams = getBlendshapeParams(config);

    // Log processing info
    console.log(`[Audio2Face] Processing with model: ${model}`);
    console.log(
      `[Audio2Face] Audio duration: ${audioStats.duration.toFixed(2)}s (${
        audioStats.byteSize
      } bytes)`
    );
    console.log(`[Audio2Face] Function ID: ${fnId}`);
    console.log(`[Audio2Face] Emotions detected: ${emotions.length}`);

    // TODO: Implement actual gRPC call to Audio2Face service
    // For now, return mock response with loaded config
    return {
      success: true,
      model,
      functionId: fnId,
      audioStats,
      timestamp: new Date().toISOString(),
      config,
      emotions: emotions.slice(0, 5), // Sample first 5
      blendshapes: blendshapeParams.multipliers,
    };
  } catch (err) {
    console.error("[Audio2Face] Error:", err);
    throw err;
  }
}

/**
 * Validate audio data before processing
 */
export function validateAudioData(audioData: string): {
  valid: boolean;
  error?: string;
} {
  try {
    if (!audioData || typeof audioData !== "string") {
      return { valid: false, error: "Audio data must be a non-empty string" };
    }

    if (audioData.length < 100) {
      return { valid: false, error: "Audio data too small" };
    }

    // Try to decode to verify it's valid base64
    decodeBase64Audio(audioData);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Invalid audio data: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    };
  }
}
