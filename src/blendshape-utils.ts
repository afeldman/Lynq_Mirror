/**
 * Blendshape utilities for parsing and managing FBX morph targets
 */

export interface BlendshapeConfig {
  multipliers: Record<string, number>;
  offsets: Record<string, number>;
  enable_clamping_bs_weight?: boolean;
}

export interface BlendshapeWeight {
  name: string;
  value: number;
  clamped: number;
}

/**
 * Apply blendshape configuration (multipliers and offsets) to raw values
 */
export function applyBlendshapeConfig(
  rawWeights: Record<string, number>,
  config: BlendshapeConfig,
): BlendshapeWeight[] {
  const results: BlendshapeWeight[] = [];

  for (const [name, rawValue] of Object.entries(rawWeights)) {
    const multiplier = config.multipliers?.[name] ?? 1.0;
    const offset = config.offsets?.[name] ?? 0.0;

    const value = rawValue * multiplier + offset;

    // Clamp if enabled
    let clamped = value;
    if (config.enable_clamping_bs_weight) {
      clamped = Math.max(0, Math.min(1, value));
    }

    results.push({
      name,
      value,
      clamped,
    });
  }

  return results;
}

/**
 * Smooth blendshape transitions using exponential moving average
 */
export function smoothBlendshapes(
  current: Record<string, number>,
  target: Record<string, number>,
  smoothing: number,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const key in target) {
    const curr = current[key] ?? 0;
    const tgt = target[key] ?? 0;
    result[key] = curr + (tgt - curr) * smoothing;
  }

  return result;
}

/**
 * Normalize blendshape values to 0-1 range
 */
export function normalizeBlendshapes(
  weights: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [name, value] of Object.entries(weights)) {
    result[name] = Math.max(0, Math.min(1, value));
  }

  return result;
}

/**
 * Get blendshape statistics
 */
export function getBlendshapeStats(weights: Record<string, number>): {
  count: number;
  min: number;
  max: number;
  mean: number;
  nonZero: number;
} {
  const values = Object.values(weights);
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, nonZero: 0 };
  }

  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    nonZero: values.filter((v) => v !== 0).length,
  };
}
