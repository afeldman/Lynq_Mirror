export const VISEME_NAMES = Object.freeze([
  'BMP',
  'FV',
  'W',
  'O',
  'EE',
  'AA',
  'UH',
  'L',
  'CH_SH',
  'S_Z',
  'ER',
  'TH'
]);

export const DEFAULT_VISEME_BLENDSHAPES = Object.freeze({
  BMP: Object.freeze({
    mouthClose: 1,
    mouthPressLeft: 0.3,
    mouthPressRight: 0.3
  }),
  FV: Object.freeze({
    mouthLowerDownLeft: 0.7,
    mouthLowerDownRight: 0.7,
    mouthUpperUpLeft: 0.35,
    mouthUpperUpRight: 0.35,
    mouthPressLeft: 0.15,
    mouthPressRight: 0.15
  }),
  W: Object.freeze({
    mouthPucker: 0.8,
    jawOpen: 0.2
  }),
  O: Object.freeze({
    mouthFunnel: 0.85,
    jawOpen: 0.35
  }),
  EE: Object.freeze({
    mouthStretchLeft: 0.8,
    mouthStretchRight: 0.8,
    mouthSmileLeft: 0.2,
    mouthSmileRight: 0.2,
    jawOpen: 0.1
  }),
  AA: Object.freeze({
    jawOpen: 1,
    mouthUpperUpLeft: 0.2,
    mouthUpperUpRight: 0.2,
    mouthStretchLeft: 0.15,
    mouthStretchRight: 0.15
  }),
  UH: Object.freeze({
    jawOpen: 0.35,
    mouthShrugLower: 0.3,
    mouthFunnel: 0.2
  }),
  L: Object.freeze({
    jawOpen: 0.35,
    mouthUpperUpLeft: 0.3,
    mouthUpperUpRight: 0.3,
    mouthStretchLeft: 0.1,
    mouthStretchRight: 0.1
  }),
  CH_SH: Object.freeze({
    mouthDimpleLeft: 0.4,
    mouthDimpleRight: 0.4,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.3,
    mouthPressLeft: 0.2,
    mouthPressRight: 0.2,
    jawOpen: 0.15,
    mouthRollUpper: 0.2
  }),
  S_Z: Object.freeze({
    mouthStretchLeft: 0.5,
    mouthStretchRight: 0.5,
    mouthPressLeft: 0.3,
    mouthPressRight: 0.3,
    mouthDimpleLeft: 0.3,
    mouthDimpleRight: 0.3,
    jawOpen: 0.15
  }),
  ER: Object.freeze({
    mouthPucker: 0.4,
    mouthFunnel: 0.35,
    jawOpen: 0.3,
    mouthDimpleLeft: 0.2,
    mouthDimpleRight: 0.2
  }),
  TH: Object.freeze({
    mouthUpperUpLeft: 0.4,
    mouthUpperUpRight: 0.4,
    mouthLowerDownLeft: 0.3,
    mouthLowerDownRight: 0.3,
    jawOpen: 0.25,
    mouthPressLeft: 0.1,
    mouthPressRight: 0.1
  })
});

export const VISEME_CONFIG_STORAGE_KEY = 'viseme-blendshape-config';
const LEGACY_STORAGE_KEY = 'viseme-algorithm-config';

const DEFAULT_BLENDSHAPE_ORDER = Object.freeze(
  Object.fromEntries(
    VISEME_NAMES.map((name) => [name, Object.keys(DEFAULT_VISEME_BLENDSHAPES[name] || {})])
  )
);

function clampNormalized(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function cloneBlendshapeMap(source) {
  const clone = {};
  Object.entries(source || {}).forEach(([shape, weight]) => {
    clone[shape] = clampNormalized(weight);
  });
  return clone;
}

export function cloneDefaultConfig() {
  return {
    visemes: Object.fromEntries(
      VISEME_NAMES.map((name) => [name, cloneBlendshapeMap(DEFAULT_VISEME_BLENDSHAPES[name])])
    )
  };
}

export function mergeWithDefaultConfig(config) {
  const base = cloneDefaultConfig();
  if (!config || typeof config !== 'object') {
    return base;
  }

  const sourceVisemes = config.visemes;
  if (sourceVisemes && typeof sourceVisemes === 'object') {
    VISEME_NAMES.forEach((viseme) => {
      const target = base.visemes[viseme];
      const provided = sourceVisemes[viseme];
      if (provided && typeof provided === 'object') {
        Object.entries(provided).forEach(([shape, weight]) => {
          target[shape] = clampNormalized(weight);
        });
      }
    });
  }

  return base;
}

export function cloneVisemeConfig(config) {
  const merged = mergeWithDefaultConfig(config);
  return {
    visemes: Object.fromEntries(
      Object.entries(merged.visemes).map(([name, shapes]) => [name, cloneBlendshapeMap(shapes)])
    )
  };
}

export function loadVisemeConfig() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return cloneDefaultConfig();
  }

  try {
    const storage = window.localStorage;
    const raw = storage.getItem(VISEME_CONFIG_STORAGE_KEY);
    if (raw) {
      return mergeWithDefaultConfig(JSON.parse(raw));
    }
    if (storage.getItem(LEGACY_STORAGE_KEY)) {
      storage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Failed to read viseme configuration, falling back to defaults.', error);
  }

  return cloneDefaultConfig();
}

export function saveVisemeConfig(config) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return mergeWithDefaultConfig(config);
  }

  const normalized = mergeWithDefaultConfig(config);
  try {
    const storage = window.localStorage;
    storage.setItem(VISEME_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to persist viseme configuration.', error);
  }
  return normalized;
}

export function getVisemeBlendshapes(config, visemeName) {
  const source = config?.visemes?.[visemeName];
  if (!source) {
    return {};
  }
  return cloneBlendshapeMap(source);
}

export function setVisemeBlendshapeWeight(config, visemeName, shapeName, weight) {
  if (!config || !config.visemes || !config.visemes[visemeName]) {
    return;
  }
  config.visemes[visemeName][shapeName] = clampNormalized(weight);
}

export function getOrderedBlendshapeNames(config, visemeName) {
  const source = config?.visemes?.[visemeName] || {};
  const defaultOrder = DEFAULT_BLENDSHAPE_ORDER[visemeName] || [];
  const names = Object.keys(source);
  names.sort((a, b) => {
    const indexA = defaultOrder.indexOf(a);
    const indexB = defaultOrder.indexOf(b);
    if (indexA === indexB) {
      return a.localeCompare(b);
    }
    if (indexA === -1) {
      return 1;
    }
    if (indexB === -1) {
      return -1;
    }
    return indexA - indexB;
  });
  return names;
}

export function removeVisemeBlendshape(config, visemeName, shapeName) {
  if (!config || !config.visemes || !config.visemes[visemeName]) {
    return false;
  }
  const shapes = config.visemes[visemeName];
  if (!Object.prototype.hasOwnProperty.call(shapes, shapeName)) {
    return false;
  }
  delete shapes[shapeName];
  return true;
}
