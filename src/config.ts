/**
 * Environment Configuration Loader
 * Loads .env file and manages configuration
 */

/**
 * Load .env file into environment variables
 */
export async function loadEnv(envPath = ".env"): Promise<void> {
  try {
    const envContent = await Deno.readTextFile(envPath);
    const lines = envContent.split("\n");

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) {
        continue;
      }

      // Parse KEY=VALUE
      const [key, ...valueParts] = line.split("=");
      const trimmedKey = key.trim();
      const value = valueParts.join("=").trim();

      if (trimmedKey && value) {
        // Only set if not already in environment (env vars take precedence)
        if (!Deno.env.get(trimmedKey)) {
          Deno.env.set(trimmedKey, value);
        }
      }
    }

    console.log(`[Config] Loaded environment from ${envPath}`);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.log(`[Config] .env file not found. Create one from .env.example`);
    } else {
      console.error(`[Config] Error loading .env: ${err}`);
    }
  }
}

/**
 * Get config value with fallback
 */
export function getConfig(key: string, fallback?: string): string | undefined {
  return Deno.env.get(key) || fallback;
}

/**
 * Get required config value (throws if missing)
 */
export function getRequiredConfig(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required configuration: ${key}`);
  }
  return value;
}

/**
 * Get config as number
 */
export function getConfigNumber(key: string, fallback?: number): number {
  const value = Deno.env.get(key);
  if (!value) {
    return fallback ?? 0;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback ?? 0;
}

/**
 * Get config as boolean
 */
export function getConfigBool(key: string, fallback = false): boolean {
  const value = Deno.env.get(key);
  if (!value) {
    return fallback;
  }
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * Print loaded configuration (safe - only non-secret keys)
 */
export function printConfig(): void {
  const safeKeys = [
    "PORT",
    "OPENAI_MODEL",
    "OPENAI_VOICE",
    "NVIDIA_A2F_ENDPOINT",
  ];
  const secretKeys = ["OPENAI_API_KEY", "NVIDIA_A2F_FUNCTION_ID"];

  console.log("[Config] Active configuration:");
  for (const key of safeKeys) {
    const value = Deno.env.get(key);
    if (value) {
      console.log(`  ${key}: ${value}`);
    }
  }

  for (const key of secretKeys) {
    const value = Deno.env.get(key);
    if (value) {
      const masked =
        value.substring(0, 6) + "*".repeat(Math.max(0, value.length - 10));
      console.log(`  ${key}: ${masked}`);
    }
  }
}
