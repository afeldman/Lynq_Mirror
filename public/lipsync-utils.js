import { VISEMES } from '/vendor/wawa-lipsync/wawa-lipsync.es.js';
import { VISEME_NAMES } from './viseme-config.js';

export { VISEMES };

export function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

const WAWA_VISEME_MAPPING = new Map([
  [VISEMES.sil, []],
  [VISEMES.PP, [{ target: 'BMP', weight: 1 }]],
  [VISEMES.FF, [{ target: 'FV', weight: 1 }]],
  [VISEMES.TH, [{ target: 'TH', weight: 1 }]],
  [VISEMES.DD, [
    { target: 'L', weight: 0.7 },
    { target: 'TH', weight: 0.25 }
  ]],
  [VISEMES.kk, [
    { target: 'CH_SH', weight: 0.85 },
    { target: 'S_Z', weight: 0.35 }
  ]],
  [VISEMES.CH, [{ target: 'CH_SH', weight: 1 }]],
  [VISEMES.SS, [{ target: 'S_Z', weight: 1 }]],
  [VISEMES.nn, [
    { target: 'L', weight: 0.8 },
    { target: 'ER', weight: 0.2 }
  ]],
  [VISEMES.RR, [{ target: 'ER', weight: 1 }]],
  [VISEMES.aa, [
    { target: 'AA', weight: 1 },
    { target: 'ER', weight: 0.25 }
  ]],
  [VISEMES.E, [{ target: 'EE', weight: 1 }]],
  [VISEMES.I, [
    { target: 'EE', weight: 0.9 },
    { target: 'CH_SH', weight: 0.2 }
  ]],
  [VISEMES.O, [
    { target: 'O', weight: 1 },
    { target: 'UH', weight: 0.6 },
    { target: 'W', weight: 0.35 }
  ]],
  [VISEMES.U, [
    { target: 'W', weight: 1 },
    { target: 'UH', weight: 0.55 }
  ]]
]);

function createEmptyTargetMap() {
  return new Map(VISEME_NAMES.map((name) => [name, 0]));
}

function computeAmplitude(features, state) {
  if (!features) {
    return 0;
  }
  const baseVolume = clamp01(features.volume ?? 0);
  let amplitude = baseVolume;
  switch (state) {
    case 'vowel':
      amplitude = clamp01(baseVolume * 1.25);
      break;
    case 'plosive':
      amplitude = Math.max(baseVolume, 0.6);
      break;
    case 'fricative':
      amplitude = Math.max(baseVolume, 0.45);
      break;
    default:
      break;
  }

  if (state === 'silence' && amplitude < 0.15) {
    return 0;
  }

  return clamp01(amplitude);
}

export function getVisemeTargets({ viseme, features, state }) {
  const amplitude = computeAmplitude(features, state);
  const targets = createEmptyTargetMap();

  const entries = WAWA_VISEME_MAPPING.get(viseme) || [];
  entries.forEach(({ target, weight }) => {
    if (!VISEME_NAMES.includes(target)) {
      return;
    }
    const value = clamp01(amplitude * weight);
    if (!value) {
      return;
    }
    const current = targets.get(target) || 0;
    targets.set(target, Math.max(current, value));
  });

  return { amplitude, targets };
}

export function getMappingTable() {
  return WAWA_VISEME_MAPPING;
}
