/**
 * Configuration Loader
 * Load and cache YAML model configurations
 */

import { parse } from "std/yaml";
import { dirname, join } from "std/path";
import { MODEL_CONFIGS } from "./models.ts";

const __dirname = dirname(new URL(".", import.meta.url).pathname);
const CONFIG_DIR = join(__dirname, "..", "nvidia", "configs");

// Configuration cache
const configCache = new Map<string, Record<string, unknown>>();

/**
 * Load YAML configuration for a model
 */
export async function loadModelConfig(
  modelName: string,
): Promise<Record<string, unknown>> {
  if (configCache.has(modelName)) {
    return configCache.get(modelName)!;
  }

  const configFile = MODEL_CONFIGS[modelName];
  if (!configFile) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  const configPath = join(CONFIG_DIR, configFile.file);

  try {
    const content = await Deno.readTextFile(configPath);
    const config = parse(content) as Record<string, unknown>;
    configCache.set(modelName, config);
    return config;
  } catch (err) {
    throw new Error(
      `Failed to load config for model ${modelName}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Clear configuration cache
 */
export function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Get cached model configuration (synchronous)
 */
export function getCachedConfig(
  modelName: string,
): Record<string, unknown> | null {
  return configCache.get(modelName) ?? null;
}

/**
 * Parse emotion with timecode from config
 */
export interface EmotionFrame {
  timeCode: number;
  emotions: Record<string, number>;
}

export function parseEmotionWithTimecode(
  config: Record<string, unknown>,
): EmotionFrame[] {
  const emotionList: EmotionFrame[] = [];

  const emotionData = config.emotion_with_timecode_list as Record<
    string,
    { time_code: number; emotions: Record<string, number> }
  >;

  if (emotionData) {
    for (const key in emotionData) {
      emotionList.push({
        timeCode: emotionData[key].time_code,
        emotions: emotionData[key].emotions,
      });
    }
  }

  return emotionList;
}

/**
 * Get blendshape parameters from config
 */
export interface BlendshapeParams {
  multipliers: Record<string, number>;
  offsets: Record<string, number>;
  enable_clamping_bs_weight?: boolean;
}

export function getBlendshapeParams(
  config: Record<string, unknown>,
): BlendshapeParams {
  const blendshapeConfig = config.blendshape_parameters as Record<
    string,
    unknown
  >;

  return {
    multipliers: (blendshapeConfig?.multipliers as Record<string, number>) ??
      {},
    offsets: (blendshapeConfig?.offsets as Record<string, number>) ?? {},
    enable_clamping_bs_weight:
      (blendshapeConfig?.enable_clamping_bs_weight as boolean) ?? false,
  };
}
