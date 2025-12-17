const STORAGE_KEY = 'ai-assistant-settings';

export const SPOTLIGHT_INTENSITY_MIN = 4;
export const SPOTLIGHT_INTENSITY_MAX = 400;
export const DEFAULT_SPOTLIGHT_TARGET_OFFSET = 0.12;

const DEFAULT_INITIAL_PROMPT =
  'You are a helpful magic mirror on the wall that talks like a gameshow host. Provide concise, spoken responses and help with daily routines and smart home tasks when asked.';

const DEFAULT_ANIMATION_SETTINGS = Object.freeze({
  viseme: Object.freeze({
    strength: 1,
    smoothing: 0.6,
    delayMs: 60,
    holdMs: 180
  }),
  head: Object.freeze({
    enableBlinks: true,
    enableRandomNods: true,
    nodIntensity: 0.35,
    volumeInfluence: 0.55,
    hoverAmount: 0.3
  }),
  expressions: Object.freeze({
    enableEyebrows: true,
    eyebrowIntensity: 0.6,
    eyebrowVolumeInfluence: 0.7,
    happiness: 0.25
  })
});

const DEFAULT_LIGHTING_SETTINGS = Object.freeze({
  meshColor: '#f3d1c7',
  enableSpotLight: true,
  spotIntensity: 12,
  spotAngle: 38,
  spotOffset: 1.35,
  spotHeightOffset: 0.85,
  spotVerticalRotation: 0
});

export const AUDIO2FACE_MODEL_IDS = Object.freeze({
  MARK_V23: 'mark_v2.3',
  CLAIRE_V23: 'claire_v2.3',
  JAMES_V23: 'james_v2.3'
});

export const AUDIO2FACE_FUNCTION_IDS = Object.freeze({
  [AUDIO2FACE_MODEL_IDS.MARK_V23]: '8efc55f5-6f00-424e-afe9-26212cd2c630',
  [AUDIO2FACE_MODEL_IDS.CLAIRE_V23]: '0961a6da-fb9e-4f2e-8491-247e5fd7bf8d',
  [AUDIO2FACE_MODEL_IDS.JAMES_V23]: '9327c39f-a361-4e02-bd72-e11b4c9b7b5e'
});

export const DEFAULT_AUDIO2FACE_SETTINGS = Object.freeze({
  enabled: false,
  apiKey: '',
  model: AUDIO2FACE_MODEL_IDS.MARK_V23,
  functionId: AUDIO2FACE_FUNCTION_IDS[AUDIO2FACE_MODEL_IDS.MARK_V23]
});

const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'gpt-4o-mini-realtime-preview',
  voice: 'ash',
  name: 'Mirror',
  hotword: 'Mirror',
  initialPrompt: DEFAULT_INITIAL_PROMPT,
  enableSmokeAnimation: true,
  animation: DEFAULT_ANIMATION_SETTINGS,
  lighting: DEFAULT_LIGHTING_SETTINGS,
  nvidiaAudio2Face: DEFAULT_AUDIO2FACE_SETTINGS
});

export const ASSISTANT_SETTINGS_STORAGE_KEY = STORAGE_KEY;
export const DEFAULT_ASSISTANT_SETTINGS = DEFAULT_SETTINGS;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function toNumberInRange(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(fallback, min, max);
  }
  return clamp(numeric, min, max);
}

function toBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : Boolean(fallback);
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return fallback;
  }
  return `#${hex.toLowerCase()}`;
}

function sanitizeAnimationSettings(source = {}) {
  const visemeSource = source && typeof source === 'object' ? source.viseme : undefined;
  const headSource = source && typeof source === 'object' ? source.head : undefined;
  const expressionSource = source && typeof source === 'object' ? source.expressions : undefined;

  const defaultViseme = DEFAULT_ANIMATION_SETTINGS.viseme;
  const defaultHead = DEFAULT_ANIMATION_SETTINGS.head;
  const defaultExpressions = DEFAULT_ANIMATION_SETTINGS.expressions;

  const viseme = {
    strength: toNumberInRange(visemeSource?.strength, defaultViseme.strength, 0.4, 1.6),
    smoothing: toNumberInRange(visemeSource?.smoothing, defaultViseme.smoothing, 0, 1),
    delayMs: toNumberInRange(visemeSource?.delayMs, defaultViseme.delayMs, 0, 400),
    holdMs: toNumberInRange(visemeSource?.holdMs, defaultViseme.holdMs, 80, 480)
  };

  const head = {
    enableBlinks: toBoolean(headSource?.enableBlinks, defaultHead.enableBlinks),
    enableRandomNods: toBoolean(headSource?.enableRandomNods, defaultHead.enableRandomNods),
    nodIntensity: toNumberInRange(headSource?.nodIntensity, defaultHead.nodIntensity, 0, 1),
    volumeInfluence: toNumberInRange(headSource?.volumeInfluence, defaultHead.volumeInfluence, 0, 1),
    hoverAmount: toNumberInRange(headSource?.hoverAmount, defaultHead.hoverAmount, 0, 1)
  };

  const expressions = {
    enableEyebrows: toBoolean(expressionSource?.enableEyebrows, defaultExpressions.enableEyebrows),
    eyebrowIntensity: toNumberInRange(
      expressionSource?.eyebrowIntensity,
      defaultExpressions.eyebrowIntensity,
      0,
      1
    ),
    eyebrowVolumeInfluence: toNumberInRange(
      expressionSource?.eyebrowVolumeInfluence,
      defaultExpressions.eyebrowVolumeInfluence,
      0,
      1
    ),
    happiness: toNumberInRange(expressionSource?.happiness, defaultExpressions.happiness, 0, 1)
  };

  return { viseme, head, expressions };
}

function sanitizeLightingSettings(source = {}) {
  const defaults = DEFAULT_LIGHTING_SETTINGS;
  const safeSource = source && typeof source === 'object' ? source : {};

  return {
    meshColor: normalizeHexColor(safeSource.meshColor, defaults.meshColor),
    enableSpotLight: toBoolean(safeSource.enableSpotLight, defaults.enableSpotLight),
    spotIntensity: toNumberInRange(
      safeSource.spotIntensity,
      defaults.spotIntensity,
      SPOTLIGHT_INTENSITY_MIN,
      SPOTLIGHT_INTENSITY_MAX
    ),
    spotAngle: toNumberInRange(safeSource.spotAngle, defaults.spotAngle, 10, 80),
    spotOffset: toNumberInRange(safeSource.spotOffset, defaults.spotOffset, 0.4, 4),
    spotHeightOffset: toNumberInRange(
      safeSource.spotHeightOffset,
      defaults.spotHeightOffset,
      -2,
      2
    ),
    spotVerticalRotation: toNumberInRange(
      safeSource.spotVerticalRotation,
      defaults.spotVerticalRotation,
      -90,
      90
    )
  };
}

function sanitizeAudio2FaceSettings(source = {}) {
  const safeSource = source && typeof source === 'object' ? source : {};
  const defaults = DEFAULT_AUDIO2FACE_SETTINGS;
  const modelValues = Object.values(AUDIO2FACE_MODEL_IDS);
  const model = modelValues.includes(safeSource.model) ? safeSource.model : defaults.model;
  const defaultFunctionId = AUDIO2FACE_FUNCTION_IDS[model] || defaults.functionId;
  const functionId =
    typeof safeSource.functionId === 'string' && safeSource.functionId.trim()
      ? safeSource.functionId.trim()
      : defaultFunctionId;

  return {
    enabled: toBoolean(safeSource.enabled, defaults.enabled),
    apiKey: typeof safeSource.apiKey === 'string' ? safeSource.apiKey.trim() : defaults.apiKey,
    model,
    functionId
  };
}

export function ensureAssistantSettings(settings = {}) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};
  const merged = {
    ...DEFAULT_SETTINGS,
    ...safeSettings,
    animation: sanitizeAnimationSettings(safeSettings.animation),
    lighting: sanitizeLightingSettings(safeSettings.lighting)
  };

  merged.enableSmokeAnimation = toBoolean(
    safeSettings.enableSmokeAnimation,
    DEFAULT_SETTINGS.enableSmokeAnimation
  );

  merged.nvidiaAudio2Face = sanitizeAudio2FaceSettings(safeSettings.nvidiaAudio2Face);

  if (typeof merged.name !== 'string') {
    merged.name = DEFAULT_SETTINGS.name;
  } else {
    merged.name = merged.name.trim() || DEFAULT_SETTINGS.name;
  }

  if (typeof merged.hotword !== 'string' || !merged.hotword.trim()) {
    if (typeof safeSettings.name === 'string' && safeSettings.name.trim()) {
      merged.hotword = safeSettings.name.trim();
    } else {
      merged.hotword = DEFAULT_SETTINGS.hotword;
    }
  } else {
    merged.hotword = merged.hotword.trim();
  }

  if (typeof merged.initialPrompt !== 'string' || !merged.initialPrompt.trim()) {
    merged.initialPrompt = DEFAULT_SETTINGS.initialPrompt;
  }

  return merged;
}

export function loadAssistantSettings() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return ensureAssistantSettings(parsed);
  } catch (error) {
    console.error('Failed to load assistant settings', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAssistantSettings(newSettings = {}) {
  try {
    const current = loadAssistantSettings();
    const merged = ensureAssistantSettings({ ...current, ...newSettings });
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (error) {
    console.error('Failed to save assistant settings', error);
    return loadAssistantSettings();
  }
}

export function clearAssistantSettings() {
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear assistant settings', error);
  }
  return { ...DEFAULT_SETTINGS };
}
