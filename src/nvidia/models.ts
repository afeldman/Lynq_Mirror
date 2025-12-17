/**
 * Audio2Face Model Configuration
 * Supported models and their default function IDs
 */

export interface ModelConfig {
  file: string;
  defaultFunctionId: string;
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  mark_v2_3: {
    file: "mark_v2.3.yml",
    defaultFunctionId: "8efc55f5-6f00-424e-afe9-26212cd2c630",
  },
  claire_v2_3: {
    file: "claire_v2.3.yml",
    defaultFunctionId: "0961a6da-fb9e-4f2e-8491-247e5fd7bf8d",
  },
  james_v2_3: {
    file: "james_v2.3.yml",
    defaultFunctionId: "9327c39f-a361-4e02-bd72-e11b4c9b7b5e",
  },
};

export const DEFAULT_MODEL = "mark_v2_3";

/**
 * Get default function ID for a model
 */
export function getDefaultFunctionIdForModel(modelName: string): string {
  const config = MODEL_CONFIGS[modelName];
  if (!config) {
    throw new Error(`Unknown model: ${modelName}`);
  }
  return config.defaultFunctionId;
}

/**
 * List all supported models
 */
export function listSupportedModels(): string[] {
  return Object.keys(MODEL_CONFIGS);
}

/**
 * Validate model name
 */
export function isValidModel(modelName: string): boolean {
  return modelName in MODEL_CONFIGS;
}
