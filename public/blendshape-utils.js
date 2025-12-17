import { clamp01 } from './lipsync-utils.js';

const blendshapeAliasCache = new Map();

export function getBlendshapeAliases(name) {
  if (typeof name !== 'string') {
    return [];
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return [];
  }
  if (blendshapeAliasCache.has(trimmed)) {
    return blendshapeAliasCache.get(trimmed);
  }
  const collapsed = trimmed.replace(/[\s_-]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ''));
  const canonical = collapsed || trimmed;
  const lowerFirst = canonical.charAt(0).toLowerCase() + canonical.slice(1);
  const lower = canonical.toLowerCase();
  const aliases = Array.from(new Set([trimmed, canonical, lowerFirst, lower])).filter(Boolean);
  blendshapeAliasCache.set(trimmed, aliases);
  return aliases;
}

export function normalizeBlendshapeValues(source) {
  if (!source || typeof source !== 'object') {
    return { normalized: {}, original: {} };
  }
  const normalized = {};
  const original = {};
  Object.entries(source).forEach(([name, value]) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return;
    }
    original[name] = numeric;
    const aliases = getBlendshapeAliases(name);
    aliases.forEach((alias) => {
      if (!alias || normalized[alias] !== undefined) {
        return;
      }
      normalized[alias] = numeric;
    });
  });
  return { normalized, original };
}

export function computeBlendshapeDiagnostics(receivedNames = [], viewerNames = []) {
  const sanitizeList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

  const received = sanitizeList(receivedNames);
  const viewer = sanitizeList(viewerNames);

  if (received.length === 0 && viewer.length === 0) {
    return null;
  }

  const viewerAliasMap = new Map();
  viewer.forEach((viewerName) => {
    const aliases = getBlendshapeAliases(viewerName);
    aliases.forEach((alias) => {
      viewerAliasMap.set(alias.toLowerCase(), viewerName);
    });
  });

  const matched = [];
  const unmatched = [];

  received.forEach((sourceName) => {
    const aliases = getBlendshapeAliases(sourceName);
    const match = aliases
      .map((alias) => alias.toLowerCase())
      .find((alias) => viewerAliasMap.has(alias));
    if (match) {
      matched.push({ source: sourceName, viewer: viewerAliasMap.get(match) });
    } else {
      unmatched.push(sourceName);
    }
  });

  const matchedViewerNames = new Set(matched.map((entry) => entry.viewer));
  const viewerOnly = viewer.filter((name) => !matchedViewerNames.has(name));

  return { matched, unmatched, viewerOnly };
}

export function buildBlendshapeValueMap(source) {
  const { normalized } = normalizeBlendshapeValues(source);
  const values = new Map();
  Object.entries(normalized).forEach(([name, value]) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return;
    }
    const clamped = clamp01(numeric);
    if (clamped <= 0) {
      return;
    }
    values.set(name, clamped);
  });
  return values;
}
