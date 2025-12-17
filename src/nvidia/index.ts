/**
 * Audio2Face Module
 * Main entry point - re-exports all public APIs
 */

// Constants
export * from "./constants.ts";

// Models
export {
  MODEL_CONFIGS,
  DEFAULT_MODEL,
  getDefaultFunctionIdForModel,
  listSupportedModels,
  isValidModel,
  type ModelConfig,
} from "./models.ts";

// Audio Processing
export {
  normalizeAudioToPCM16,
  decodeBase64Audio,
  encodeBase64Audio,
  getAudioDuration,
  getAudioStats,
} from "./audio-processor.ts";

// Configuration
export {
  loadModelConfig,
  clearConfigCache,
  getCachedConfig,
  parseEmotionWithTimecode,
  getBlendshapeParams,
  type EmotionFrame,
  type BlendshapeParams,
} from "./config-loader.ts";

// Service
export {
  processAudioWithA2F,
  validateAudioData,
  type A2FProcessResponse,
} from "./service.ts";
