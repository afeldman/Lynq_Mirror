const MIRROR_MASK_PATH = "/characters/lynq/lynx_bobcat_01.fbx";
const MIRROR_MASK_FILENAME = "lynx_bobcat_01.fbx";

function isString(value) {
  return typeof value === "string";
}

function normalizeHint(hint) {
  if (!isString(hint)) {
    return "";
  }
  let normalized = hint.trim().toLowerCase();
  const queryIndex = normalized.indexOf("?");
  if (queryIndex !== -1) {
    normalized = normalized.slice(0, queryIndex);
  }
  const hashIndex = normalized.indexOf("#");
  if (hashIndex !== -1) {
    normalized = normalized.slice(0, hashIndex);
  }
  return normalized;
}

export function applyMirrorMaskOrientation(object3D) {
  if (
    !object3D ||
    typeof object3D.rotateX !== "function" ||
    typeof object3D.rotateZ !== "function"
  ) {
    return;
  }
  object3D.rotateX(-Math.PI / 2);
  object3D.rotateZ(Math.PI);
  if (typeof object3D.updateMatrixWorld === "function") {
    object3D.updateMatrixWorld(true);
  }
}

export function shouldApplyMirrorMaskOrientation(...hints) {
  return hints.some((hint) => {
    const normalized = normalizeHint(hint);
    if (!normalized) {
      return false;
    }
    return (
      normalized === MIRROR_MASK_PATH ||
      normalized.endsWith(`/mirror/${MIRROR_MASK_FILENAME}`) ||
      (normalized.endsWith(MIRROR_MASK_FILENAME) &&
        normalized.includes("mirror"))
    );
  });
}
