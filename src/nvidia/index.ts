/**
 * Audio2Face Module
 * Main entry point - re-exports all public APIs
 */

// Constants
export * from "./constants.ts";

// Models
export {
  DEFAULT_MODEL,
  getDefaultFunctionIdForModel,
  isValidModel,
  listSupportedModels,
  MODEL_CONFIGS,
  type ModelConfig,
} from "./models.ts";

// Audio Processing
export {
  decodeBase64Audio,
  encodeBase64Audio,
  getAudioDuration,
  getAudioStats,
  normalizeAudioToPCM16,
} from "./audio-processor.ts";

// Configuration
export {
  type BlendshapeParams,
  clearConfigCache,
  type EmotionFrame,
  getBlendshapeParams,
  getCachedConfig,
  loadModelConfig,
  parseEmotionWithTimecode,
} from "./config-loader.ts";

// Service
export {
  type A2FProcessResponse,
  processAudioWithA2F,
  validateAudioData,
} from "./service.ts";
