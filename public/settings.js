import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import {
  loadAssistantSettings,
  saveAssistantSettings,
  DEFAULT_ASSISTANT_SETTINGS,
  ASSISTANT_SETTINGS_STORAGE_KEY,
  ensureAssistantSettings,
  SPOTLIGHT_INTENSITY_MIN,
  SPOTLIGHT_INTENSITY_MAX,
  DEFAULT_SPOTLIGHT_TARGET_OFFSET,
  DEFAULT_AUDIO2FACE_SETTINGS,
  AUDIO2FACE_MODEL_IDS,
  AUDIO2FACE_FUNCTION_IDS,
} from "./assistant-settings.js";
import {
  VISEME_NAMES,
  loadVisemeConfig,
  saveVisemeConfig,
  cloneDefaultConfig as cloneDefaultVisemeConfig,
  cloneVisemeConfig,
  setVisemeBlendshapeWeight,
  getOrderedBlendshapeNames,
  removeVisemeBlendshape,
  VISEME_CONFIG_STORAGE_KEY,
} from "./viseme-config.js";
import { applyMirrorMaskOrientation } from "./mirror-model-utils.js";

const statusElement = document.getElementById("status");
const unsavedElement = document.getElementById("unsaved");
const formElement = document.getElementById("assistant-settings-form");
const saveButton = document.getElementById("save-button");
const resetButton = document.getElementById("reset-button");
const visemeEditorElement = document.getElementById("viseme-editor");

const PREVIEW_MODEL_URL = "/characters/lynq/lynx_bobcat_01.fbx";
const lightingPreviewContainer = document.getElementById("lighting-preview");
const lightingPreviewStatusElement = document.getElementById(
  "lighting-preview-status"
);

const inputRefs = {
  name: document.getElementById("assistant-name"),
  hotword: document.getElementById("assistant-hotword"),
  apiKey: document.getElementById("assistant-api-key"),
  model: document.getElementById("assistant-model"),
  voice: document.getElementById("assistant-voice"),
  initialPrompt: document.getElementById("assistant-initial-prompt"),
};

const audio2FaceRefs = {
  enabled: document.getElementById("assistant-enable-audio2face"),
  apiKey: document.getElementById("assistant-audio2face-key"),
  functionId: document.getElementById("assistant-audio2face-function"),
  model: document.getElementById("assistant-audio2face-model"),
};

const animationGeneralRefs = {
  enableSmokeAnimation: document.getElementById("enable-smoke-animation"),
};

const visemeRefs = {
  strength: document.getElementById("viseme-strength"),
  smoothing: document.getElementById("viseme-smoothing"),
  delayMs: document.getElementById("viseme-delay"),
  holdMs: document.getElementById("viseme-hold"),
};

const headRefs = {
  enableBlinks: document.getElementById("head-enable-blinks"),
  enableRandomNods: document.getElementById("head-enable-nods"),
  nodIntensity: document.getElementById("head-nod-intensity"),
  volumeInfluence: document.getElementById("head-volume-influence"),
  hoverAmount: document.getElementById("head-hover-amount"),
};

const expressionRefs = {
  enableEyebrows: document.getElementById("expressions-enable-eyebrows"),
  eyebrowIntensity: document.getElementById("expressions-eyebrow-intensity"),
  eyebrowVolumeInfluence: document.getElementById("expressions-eyebrow-volume"),
  happiness: document.getElementById("expressions-happiness"),
};

const lightingRefs = {
  meshColor: document.getElementById("lighting-mesh-color"),
  enableSpotLight: document.getElementById("lighting-enable-spot"),
  spotIntensity: document.getElementById("lighting-spot-intensity"),
  spotAngle: document.getElementById("lighting-spot-angle"),
  spotOffset: document.getElementById("lighting-spot-offset"),
  spotHeightOffset: document.getElementById("lighting-spot-height"),
  spotVerticalRotation: document.getElementById("lighting-spot-vertical"),
};

const lightingPreviewState = {
  container: lightingPreviewContainer,
  statusElement: lightingPreviewStatusElement,
  renderer: null,
  scene: null,
  camera: null,
  spotLight: null,
  spotTarget: null,
  ambientLight: null,
  fillLight: null,
  rimLight: null,
  model: null,
  loader: null,
  resizeObserver: null,
  modelCenter: new THREE.Vector3(0, 1.4, 0),
  modelSize: new THREE.Vector3(1, 1, 1),
  boundingBox: new THREE.Box3(),
  tempCameraOffset: new THREE.Vector3(),
  isReady: false,
  pendingLighting: null,
};

const rangeDisplays = new Map();
document.querySelectorAll("[data-display-for]").forEach((node) => {
  const targetId = node.getAttribute("data-display-for");
  if (targetId) {
    rangeDisplays.set(targetId, node);
  }
});

function cloneLightingSettings(rawLighting) {
  const sanitized = ensureAssistantSettings({ lighting: rawLighting }).lighting;
  return {
    meshColor: sanitized.meshColor,
    enableSpotLight: sanitized.enableSpotLight,
    spotIntensity: sanitized.spotIntensity,
    spotAngle: sanitized.spotAngle,
    spotOffset: sanitized.spotOffset,
    spotHeightOffset: sanitized.spotHeightOffset,
    spotVerticalRotation: sanitized.spotVerticalRotation,
  };
}

lightingPreviewState.pendingLighting = cloneLightingSettings(
  DEFAULT_ASSISTANT_SETTINGS.lighting
);

let committedSettings = ensureAssistantSettings(loadAssistantSettings());
let draftSettings = ensureAssistantSettings(committedSettings);
let committedVisemeConfig = cloneVisemeConfig(loadVisemeConfig());
let draftVisemeConfig = cloneVisemeConfig(committedVisemeConfig);
let dirty = false;
let lastAudio2FaceModel = DEFAULT_AUDIO2FACE_SETTINGS.model;

function setStatus(message, type = "info") {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.toggle("error", type === "error");
}

function setDirty(isDirty) {
  dirty = Boolean(isDirty);
  if (saveButton) {
    saveButton.disabled = !dirty;
  }
  if (unsavedElement) {
    unsavedElement.hidden = !dirty;
  }
}

function formatRangeValue(id, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return "";
  }
  switch (id) {
    case "viseme-strength":
    case "viseme-smoothing":
    case "head-nod-intensity":
    case "head-volume-influence":
    case "head-hover-amount":
    case "expressions-eyebrow-intensity":
    case "expressions-eyebrow-volume":
    case "expressions-happiness":
      return `${Math.round(value * 100)}%`;
    case "viseme-delay":
    case "viseme-hold":
      return `${Math.round(value)} ms`;
    case "lighting-spot-angle":
    case "lighting-spot-vertical":
      return `${Math.round(value)}°`;
    case "lighting-spot-intensity":
      return value.toFixed(2);
    case "lighting-spot-offset":
    case "lighting-spot-height":
      return value.toFixed(2);
    default:
      return value.toFixed(2);
  }
}

function updateRangeDisplay(element) {
  if (!element) {
    return;
  }
  const display = rangeDisplays.get(element.id);
  if (display) {
    display.textContent = formatRangeValue(element.id, element.value);
  }
}

function updateAllRangeDisplays() {
  rangeDisplays.forEach((_, id) => {
    const element = document.getElementById(id);
    if (element) {
      updateRangeDisplay(element);
    }
  });
}

function getDefaultAudio2FaceFunctionId(model) {
  return (
    AUDIO2FACE_FUNCTION_IDS[model] || DEFAULT_AUDIO2FACE_SETTINGS.functionId
  );
}

function normalizeAudio2FaceModel(model) {
  const available = Object.values(AUDIO2FACE_MODEL_IDS);
  return available.includes(model) ? model : DEFAULT_AUDIO2FACE_SETTINGS.model;
}

function updateAudio2FaceFunctionPlaceholder(model) {
  const input = audio2FaceRefs.functionId;
  if (!input) {
    return;
  }
  const defaultId = getDefaultAudio2FaceFunctionId(model);
  input.placeholder = defaultId;
}

function setLightingPreviewStatus(message, type = "info") {
  const statusElement = lightingPreviewState.statusElement;
  if (!statusElement) {
    return;
  }
  if (!message) {
    statusElement.hidden = true;
    statusElement.textContent = "";
    statusElement.classList.remove("error");
    return;
  }
  statusElement.hidden = false;
  statusElement.textContent = message;
  statusElement.classList.toggle("error", type === "error");
}

function resizeLightingPreview() {
  const { container, renderer, camera } = lightingPreviewState;
  if (!container || !renderer || !camera) {
    return;
  }
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function renderLightingPreview() {
  const { renderer, scene, camera } = lightingPreviewState;
  if (!renderer || !scene || !camera) {
    return;
  }
  renderer.render(scene, camera);
}

function prepareLightingPreviewModel(object3D) {
  if (!object3D) {
    return;
  }
  object3D.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (material) {
        material.needsUpdate = true;
      }
    });
  });
}

function applyMeshColorToModel(object3D, colorHex) {
  if (!object3D || typeof object3D.traverse !== "function") {
    return;
  }
  const fallbackColor = DEFAULT_ASSISTANT_SETTINGS.lighting.meshColor;
  let targetColor;
  try {
    targetColor = new THREE.Color(colorHex || fallbackColor);
  } catch (error) {
    targetColor = new THREE.Color(fallbackColor);
  }

  object3D.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (
        material &&
        material.color &&
        typeof material.color.set === "function"
      ) {
        material.color.set(targetColor);
        material.needsUpdate = true;
      }
    });
  });
}

function frameLightingPreviewModel() {
  const {
    model,
    camera,
    boundingBox,
    modelCenter,
    modelSize,
    tempCameraOffset,
  } = lightingPreviewState;
  if (!model || !camera) {
    return;
  }
  boundingBox.setFromObject(model);
  if (
    !Number.isFinite(boundingBox.max.x) ||
    !Number.isFinite(boundingBox.max.y) ||
    !Number.isFinite(boundingBox.max.z)
  ) {
    return;
  }

  boundingBox.getCenter(modelCenter);
  boundingBox.getSize(modelSize);

  const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  let distance = Math.abs(maxDim / Math.sin(fov / 2));
  distance = distance * 0.45 + maxDim * 0.6;

  tempCameraOffset.set(0, modelSize.y * 0.3, distance);
  camera.position.copy(modelCenter).add(tempCameraOffset);
  camera.near = Math.max(0.05, distance / 120);
  camera.far = Math.max(distance * 8, 20);
  camera.lookAt(modelCenter);
  camera.updateProjectionMatrix();
}

function applyLightingSettingsToPreview(lightingSettings) {
  const {
    model,
    spotLight,
    spotTarget,
    ambientLight,
    fillLight,
    rimLight,
    modelCenter,
    modelSize,
  } = lightingPreviewState;
  if (!spotLight || !spotTarget || !ambientLight || !fillLight || !rimLight) {
    return;
  }
  const lighting = lightingSettings || DEFAULT_ASSISTANT_SETTINGS.lighting;
  applyMeshColorToModel(model, lighting.meshColor);

  const modelHeight = Math.max(modelSize.y, 0.6);
  const offsetScalar = Math.max(
    Number(
      lighting.spotOffset ?? DEFAULT_ASSISTANT_SETTINGS.lighting.spotOffset ?? 0
    ),
    0.4
  );
  const radius = Math.max(offsetScalar * modelHeight, modelHeight * 0.5);
  const clampedAngle = THREE.MathUtils.clamp(
    Number(lighting.spotAngle) || 38,
    10,
    80
  );
  const angle = THREE.MathUtils.degToRad(clampedAngle);

  const heightScalar = THREE.MathUtils.clamp(
    Number(
      lighting.spotHeightOffset ??
        DEFAULT_ASSISTANT_SETTINGS.lighting.spotHeightOffset ??
        0
    ),
    -1.5,
    2.4
  );
  const verticalRotation = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(
      Number(
        lighting.spotVerticalRotation ??
          DEFAULT_ASSISTANT_SETTINGS.lighting.spotVerticalRotation ??
          0
      ),
      -90,
      90
    )
  );

  const targetY = modelCenter.y + DEFAULT_SPOTLIGHT_TARGET_OFFSET * modelHeight;
  spotTarget.position.set(modelCenter.x, targetY, modelCenter.z);
  spotTarget.updateMatrixWorld();

  const orbitY = Math.sin(verticalRotation) * radius;
  const orbitZ = Math.cos(verticalRotation) * radius;
  const baseY = targetY + orbitY;
  const desiredY = baseY + heightScalar * modelHeight;
  const minLift = Math.min(baseY, targetY - modelHeight * 0.25);
  const maxLift = Math.max(baseY, targetY + modelHeight * 2.4);
  const effectiveY = lighting.enableSpotLight
    ? THREE.MathUtils.clamp(desiredY, minLift, maxLift)
    : desiredY;

  spotLight.position.set(
    spotTarget.position.x,
    effectiveY,
    spotTarget.position.z + orbitZ
  );

  spotLight.angle = angle;
  const distance = Math.max(radius * 1.9, modelHeight * 2.2);
  spotLight.distance = distance;
  spotLight.decay = 1.15;

  const rawIntensity = Number(
    lighting.spotIntensity ??
      DEFAULT_ASSISTANT_SETTINGS.lighting.spotIntensity ??
      SPOTLIGHT_INTENSITY_MIN
  );
  const intensity = THREE.MathUtils.clamp(
    rawIntensity,
    SPOTLIGHT_INTENSITY_MIN,
    SPOTLIGHT_INTENSITY_MAX
  );
  const enabled = Boolean(
    lighting.enableSpotLight && intensity >= SPOTLIGHT_INTENSITY_MIN
  );
  spotLight.intensity = enabled ? intensity * 2.4 : 0;
  spotLight.visible = enabled;
  spotLight.castShadow = enabled;

  const intensityRange = Math.max(
    SPOTLIGHT_INTENSITY_MAX - SPOTLIGHT_INTENSITY_MIN,
    1
  );
  const normalizedKey = THREE.MathUtils.clamp(
    (intensity - SPOTLIGHT_INTENSITY_MIN) / intensityRange,
    0,
    1
  );
  const supportScalar = enabled
    ? Math.max(normalizedKey, 0.28)
    : Math.max(normalizedKey, 0.62);

  const ambientStrength = 0.28 + supportScalar * 0.52;
  const fillStrength = 0.5 + supportScalar * 1.1;
  const rimStrength = 0.34 + supportScalar * 0.9;

  ambientLight.intensity = ambientStrength;

  const fillHeight = spotTarget.position.y + modelHeight * 0.3;
  const fillDistance = Math.max(radius * 2.2, modelHeight * 2.7);
  const fillOffsetX = radius * 0.4;
  fillLight.position.set(
    spotTarget.position.x - fillOffsetX,
    fillHeight,
    spotTarget.position.z + fillDistance
  );
  fillLight.distance = Math.max(fillDistance * 1.3, modelHeight * 3.2);
  fillLight.angle = THREE.MathUtils.degToRad(Math.max(clampedAngle + 12, 55));
  fillLight.intensity = fillStrength;
  fillLight.visible = true;

  const rimHeight = spotTarget.position.y + modelHeight * 1.05;
  const rimOffsetX = radius * 1.35;
  const rimOffsetZ = radius * 1.55;
  rimLight.position.set(
    spotTarget.position.x + rimOffsetX,
    rimHeight,
    spotTarget.position.z - rimOffsetZ
  );
  rimLight.intensity = rimStrength;
  rimLight.visible = true;
}

function queueLightingPreviewUpdate(lighting) {
  lightingPreviewState.pendingLighting = cloneLightingSettings(lighting);
  if (lightingPreviewState.isReady) {
    applyLightingSettingsToPreview(lightingPreviewState.pendingLighting);
  }
}

let lightingPreviewInitialized = false;

function initLightingPreview() {
  if (lightingPreviewInitialized || !lightingPreviewState.container) {
    return;
  }
  lightingPreviewInitialized = true;

  const container = lightingPreviewState.container;
  setLightingPreviewStatus("Loading lighting preview…", "info");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  camera.position.set(0, 1.4, 3.4);
  camera.lookAt(0, 1.4, 0);

  const spotTarget = new THREE.Object3D();
  scene.add(spotTarget);

  const spotLight = new THREE.SpotLight(0xfff1e0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.set(1024, 1024);
  spotLight.shadow.bias = -0.00006;
  spotLight.penumbra = 0.45;
  spotLight.decay = 2.1;
  spotLight.distance = 10;
  spotLight.target = spotTarget;
  scene.add(spotLight);

  const ambientLight = new THREE.HemisphereLight(0x1f2a3f, 0x110806, 0.6);
  ambientLight.intensity = 0.6;
  scene.add(ambientLight);

  const fillLight = new THREE.SpotLight(0xf3f6ff, 0.9);
  fillLight.castShadow = false;
  fillLight.penumbra = 0.85;
  fillLight.decay = 1.05;
  fillLight.angle = THREE.MathUtils.degToRad(70);
  fillLight.distance = 12;
  fillLight.target = spotTarget;
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x7fa2ff, 0.6);
  rimLight.position.set(-2.2, 2.1, -2.4);
  rimLight.target = spotTarget;
  scene.add(rimLight);

  lightingPreviewState.renderer = renderer;
  lightingPreviewState.scene = scene;
  lightingPreviewState.camera = camera;
  lightingPreviewState.spotLight = spotLight;
  lightingPreviewState.spotTarget = spotTarget;
  lightingPreviewState.ambientLight = ambientLight;
  lightingPreviewState.fillLight = fillLight;
  lightingPreviewState.rimLight = rimLight;

  const loader = new FBXLoader();
  lightingPreviewState.loader = loader;

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      resizeLightingPreview();
    });
    observer.observe(container);
    lightingPreviewState.resizeObserver = observer;
  } else {
    window.addEventListener("resize", resizeLightingPreview);
  }

  const ensureResize = () => {
    resizeLightingPreview();
    renderLightingPreview();
  };
  window.requestAnimationFrame(ensureResize);

  loader.load(
    PREVIEW_MODEL_URL,
    (object) => {
      lightingPreviewState.model = object;
      applyMirrorMaskOrientation(object);
      prepareLightingPreviewModel(object);
      scene.add(object);
      frameLightingPreviewModel();
      lightingPreviewState.isReady = true;
      queueLightingPreviewUpdate(lightingPreviewState.pendingLighting);
      setLightingPreviewStatus("", "info");
    },
    undefined,
    (error) => {
      console.error("Failed to load lighting preview model", error);
      setLightingPreviewStatus("Failed to load lighting preview.", "error");
    }
  );

  renderer.setAnimationLoop(renderLightingPreview);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function toPercent(value) {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function createVisemeShapeRow(visemeName, shapeName, weight) {
  const row = document.createElement("div");
  row.className = "viseme-shape-row";
  row.dataset.viseme = visemeName;
  row.dataset.shape = shapeName;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "viseme-shape-name";
  nameInput.value = shapeName;
  nameInput.setAttribute("aria-label", `${visemeName} blendshape name`);
  row.appendChild(nameInput);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = `${clamp01(weight)}`;
  slider.className = "viseme-shape-slider";
  row.appendChild(slider);

  const valueDisplay = document.createElement("span");
  valueDisplay.className = "viseme-shape-value";
  valueDisplay.textContent = toPercent(weight);
  row.appendChild(valueDisplay);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "viseme-shape-remove";
  removeButton.textContent = "Remove";
  removeButton.setAttribute(
    "aria-label",
    `Remove ${shapeName} from ${visemeName}`
  );
  row.appendChild(removeButton);

  return row;
}

function createVisemeRecipeElement(visemeName, config) {
  const recipe = document.createElement("section");
  recipe.className = "viseme-recipe";
  recipe.dataset.viseme = visemeName;

  const header = document.createElement("div");
  header.className = "viseme-recipe-header";
  const title = document.createElement("h3");
  title.textContent = visemeName;
  header.appendChild(title);

  const recipeShapes = getOrderedBlendshapeNames(config, visemeName);
  const count = document.createElement("span");
  count.className = "viseme-recipe-count";
  count.textContent =
    recipeShapes.length === 1
      ? "1 blendshape"
      : `${recipeShapes.length} blendshapes`;
  header.appendChild(count);
  recipe.appendChild(header);

  const list = document.createElement("div");
  list.className = "viseme-shape-list";
  if (recipeShapes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "viseme-empty";
    empty.textContent = "No blendshapes configured.";
    list.appendChild(empty);
  } else {
    const shapes = config?.visemes?.[visemeName] || {};
    recipeShapes.forEach((shapeName) => {
      const weight = shapes[shapeName] ?? 0;
      list.appendChild(createVisemeShapeRow(visemeName, shapeName, weight));
    });
  }
  recipe.appendChild(list);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "viseme-add-button";
  addButton.dataset.viseme = visemeName;
  addButton.textContent = "Add blendshape";
  recipe.appendChild(addButton);

  return recipe;
}

function findVisemeRecipeElement(visemeName) {
  if (!visemeEditorElement) {
    return null;
  }
  return Array.from(
    visemeEditorElement.querySelectorAll(".viseme-recipe")
  ).find((node) => node.dataset.viseme === visemeName);
}

function findShapeRowElement(visemeName, shapeName) {
  const recipe = findVisemeRecipeElement(visemeName);
  if (!recipe) {
    return null;
  }
  return Array.from(recipe.querySelectorAll(".viseme-shape-row")).find(
    (row) => row.dataset.shape === shapeName
  );
}

function renderVisemeRecipe(visemeName, config = draftVisemeConfig) {
  if (!visemeEditorElement) {
    return;
  }
  const next = createVisemeRecipeElement(visemeName, config);
  const existing = findVisemeRecipeElement(visemeName);
  if (existing && existing.parentNode) {
    existing.parentNode.replaceChild(next, existing);
  } else {
    visemeEditorElement.appendChild(next);
  }
}

function renderVisemeEditor(config = draftVisemeConfig) {
  if (!visemeEditorElement) {
    return;
  }
  visemeEditorElement.innerHTML = "";
  const fragment = document.createDocumentFragment();
  VISEME_NAMES.forEach((visemeName) => {
    fragment.appendChild(createVisemeRecipeElement(visemeName, config));
  });
  visemeEditorElement.appendChild(fragment);
}

function addBlendshapeToViseme(visemeName) {
  if (!draftVisemeConfig.visemes) {
    draftVisemeConfig.visemes = {};
  }
  if (!draftVisemeConfig.visemes[visemeName]) {
    draftVisemeConfig.visemes[visemeName] = {};
  }
  const shapes = draftVisemeConfig.visemes[visemeName];
  let index = Object.keys(shapes).length + 1;
  let candidate;
  do {
    candidate = `Custom${index}`;
    index += 1;
  } while (Object.prototype.hasOwnProperty.call(shapes, candidate));
  setVisemeBlendshapeWeight(draftVisemeConfig, visemeName, candidate, 0.6);
  return candidate;
}

function renameVisemeBlendshape(config, visemeName, oldName, desiredName) {
  const shapes = config?.visemes?.[visemeName];
  if (!shapes || !Object.prototype.hasOwnProperty.call(shapes, oldName)) {
    return { appliedName: oldName, changed: false };
  }
  const trimmed = desiredName.trim();
  if (!trimmed) {
    return { appliedName: oldName, changed: false };
  }
  if (trimmed === oldName) {
    return { appliedName: oldName, changed: false };
  }
  const weight = shapes[oldName];
  delete shapes[oldName];
  let finalName = trimmed;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(shapes, finalName)) {
    finalName = `${trimmed}_${suffix}`;
    suffix += 1;
  }
  setVisemeBlendshapeWeight(config, visemeName, finalName, weight);
  return { appliedName: finalName, changed: true };
}

function visemeConfigsEqual(a, b) {
  if (!a || !b) {
    return false;
  }
  return VISEME_NAMES.every((visemeName) => {
    const leftShapes = a.visemes?.[visemeName] || {};
    const rightShapes = b.visemes?.[visemeName] || {};
    const leftKeys = Object.keys(leftShapes);
    const rightKeys = Object.keys(rightShapes);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => {
      if (!Object.prototype.hasOwnProperty.call(rightShapes, key)) {
        return false;
      }
      const leftValue = Number(leftShapes[key]);
      const rightValue = Number(rightShapes[key]);
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
        return false;
      }
      return Math.abs(leftValue - rightValue) < 1e-4;
    });
  });
}

function updateDirtyState(
  settingsCandidate = draftSettings,
  visemeCandidate = draftVisemeConfig,
  options = {}
) {
  const { silent = false } = options;
  const settingsChanged = !settingsEqual(settingsCandidate, committedSettings);
  const visemeChanged = !visemeConfigsEqual(
    visemeCandidate,
    committedVisemeConfig
  );
  const changed = settingsChanged || visemeChanged;
  setDirty(changed);
  if (!silent) {
    setStatus(
      changed
        ? "Unsaved changes. Press save to apply them."
        : "No pending changes.",
      "info"
    );
  }
  return changed;
}

function getNumberInputValue(input, fallback) {
  const number = Number(input?.value);
  return Number.isFinite(number) ? number : fallback;
}

function getCheckboxValue(input, fallback) {
  return typeof input?.checked === "boolean" ? input.checked : fallback;
}

function applySettingsToForm(settings, visemeConfig = draftVisemeConfig) {
  const source = ensureAssistantSettings(settings);
  if (inputRefs.name) {
    inputRefs.name.value = source.name ?? DEFAULT_ASSISTANT_SETTINGS.name;
  }
  if (inputRefs.hotword) {
    inputRefs.hotword.value =
      source.hotword ?? DEFAULT_ASSISTANT_SETTINGS.hotword;
  }
  if (inputRefs.apiKey) {
    inputRefs.apiKey.value = source.apiKey ?? DEFAULT_ASSISTANT_SETTINGS.apiKey;
  }
  if (inputRefs.model) {
    inputRefs.model.value = source.model ?? DEFAULT_ASSISTANT_SETTINGS.model;
  }
  if (inputRefs.voice) {
    inputRefs.voice.value = source.voice ?? DEFAULT_ASSISTANT_SETTINGS.voice;
  }
  if (inputRefs.initialPrompt) {
    inputRefs.initialPrompt.value =
      source.initialPrompt ?? DEFAULT_ASSISTANT_SETTINGS.initialPrompt;
  }

  const audio2Face = source.nvidiaAudio2Face ?? DEFAULT_AUDIO2FACE_SETTINGS;
  lastAudio2FaceModel = normalizeAudio2FaceModel(audio2Face.model);
  if (audio2FaceRefs.enabled) {
    audio2FaceRefs.enabled.checked = Boolean(audio2Face.enabled);
  }
  if (audio2FaceRefs.apiKey) {
    audio2FaceRefs.apiKey.value =
      audio2Face.apiKey ?? DEFAULT_AUDIO2FACE_SETTINGS.apiKey;
  }
  if (audio2FaceRefs.model) {
    audio2FaceRefs.model.value = lastAudio2FaceModel;
  }
  if (audio2FaceRefs.functionId) {
    audio2FaceRefs.functionId.value =
      audio2Face.functionId ??
      getDefaultAudio2FaceFunctionId(lastAudio2FaceModel);
  }
  updateAudio2FaceFunctionPlaceholder(lastAudio2FaceModel);

  if (animationGeneralRefs.enableSmokeAnimation) {
    animationGeneralRefs.enableSmokeAnimation.checked = Boolean(
      source.enableSmokeAnimation ??
        DEFAULT_ASSISTANT_SETTINGS.enableSmokeAnimation
    );
  }

  const animationDefaults = DEFAULT_ASSISTANT_SETTINGS.animation;
  const viseme = source.animation?.viseme ?? animationDefaults.viseme;
  const head = source.animation?.head ?? animationDefaults.head;
  const expressions =
    source.animation?.expressions ?? animationDefaults.expressions;
  const lightingDefaults = DEFAULT_ASSISTANT_SETTINGS.lighting;
  const lighting = source.lighting ?? lightingDefaults;

  if (visemeRefs.strength) {
    visemeRefs.strength.value = String(viseme.strength);
    updateRangeDisplay(visemeRefs.strength);
  }
  if (visemeRefs.smoothing) {
    visemeRefs.smoothing.value = String(viseme.smoothing);
    updateRangeDisplay(visemeRefs.smoothing);
  }
  if (visemeRefs.delayMs) {
    visemeRefs.delayMs.value = String(viseme.delayMs);
    updateRangeDisplay(visemeRefs.delayMs);
  }
  if (visemeRefs.holdMs) {
    visemeRefs.holdMs.value = String(viseme.holdMs);
    updateRangeDisplay(visemeRefs.holdMs);
  }

  if (headRefs.enableBlinks) {
    headRefs.enableBlinks.checked = Boolean(head.enableBlinks);
  }
  if (headRefs.enableRandomNods) {
    headRefs.enableRandomNods.checked = Boolean(head.enableRandomNods);
  }
  if (headRefs.nodIntensity) {
    headRefs.nodIntensity.value = String(head.nodIntensity);
    updateRangeDisplay(headRefs.nodIntensity);
  }
  if (headRefs.volumeInfluence) {
    headRefs.volumeInfluence.value = String(head.volumeInfluence);
    updateRangeDisplay(headRefs.volumeInfluence);
  }
  if (headRefs.hoverAmount) {
    headRefs.hoverAmount.value = String(head.hoverAmount);
    updateRangeDisplay(headRefs.hoverAmount);
  }

  if (expressionRefs.enableEyebrows) {
    expressionRefs.enableEyebrows.checked = Boolean(expressions.enableEyebrows);
  }
  if (expressionRefs.eyebrowIntensity) {
    expressionRefs.eyebrowIntensity.value = String(
      expressions.eyebrowIntensity
    );
    updateRangeDisplay(expressionRefs.eyebrowIntensity);
  }
  if (expressionRefs.eyebrowVolumeInfluence) {
    expressionRefs.eyebrowVolumeInfluence.value = String(
      expressions.eyebrowVolumeInfluence
    );
    updateRangeDisplay(expressionRefs.eyebrowVolumeInfluence);
  }
  if (expressionRefs.happiness) {
    expressionRefs.happiness.value = String(expressions.happiness);
    updateRangeDisplay(expressionRefs.happiness);
  }

  if (lightingRefs.meshColor) {
    lightingRefs.meshColor.value =
      lighting.meshColor || lightingDefaults.meshColor;
  }
  if (lightingRefs.enableSpotLight) {
    lightingRefs.enableSpotLight.checked = Boolean(lighting.enableSpotLight);
  }
  if (lightingRefs.spotIntensity) {
    lightingRefs.spotIntensity.value = String(lighting.spotIntensity);
    updateRangeDisplay(lightingRefs.spotIntensity);
  }
  if (lightingRefs.spotAngle) {
    lightingRefs.spotAngle.value = String(lighting.spotAngle);
    updateRangeDisplay(lightingRefs.spotAngle);
  }
  if (lightingRefs.spotOffset) {
    lightingRefs.spotOffset.value = String(lighting.spotOffset);
    updateRangeDisplay(lightingRefs.spotOffset);
  }
  if (lightingRefs.spotHeightOffset) {
    lightingRefs.spotHeightOffset.value = String(lighting.spotHeightOffset);
    updateRangeDisplay(lightingRefs.spotHeightOffset);
  }
  if (lightingRefs.spotVerticalRotation) {
    lightingRefs.spotVerticalRotation.value = String(
      lighting.spotVerticalRotation
    );
    updateRangeDisplay(lightingRefs.spotVerticalRotation);
  }

  queueLightingPreviewUpdate(lighting);
  updateAllRangeDisplays();
  renderVisemeEditor(visemeConfig);
}

function readFormValues() {
  const animationDefaults = DEFAULT_ASSISTANT_SETTINGS.animation;
  const visemeDefaults = animationDefaults.viseme;
  const headDefaults = animationDefaults.head;
  const expressionDefaults = animationDefaults.expressions;
  const lightingDefaults = DEFAULT_ASSISTANT_SETTINGS.lighting;

  return ensureAssistantSettings({
    name: inputRefs.name?.value?.trim() || DEFAULT_ASSISTANT_SETTINGS.name,
    hotword:
      inputRefs.hotword?.value?.trim() || DEFAULT_ASSISTANT_SETTINGS.hotword,
    apiKey: inputRefs.apiKey?.value?.trim() || "",
    model: inputRefs.model?.value || DEFAULT_ASSISTANT_SETTINGS.model,
    voice: inputRefs.voice?.value || DEFAULT_ASSISTANT_SETTINGS.voice,
    initialPrompt:
      inputRefs.initialPrompt?.value?.trim() ||
      DEFAULT_ASSISTANT_SETTINGS.initialPrompt,
    enableSmokeAnimation: getCheckboxValue(
      animationGeneralRefs.enableSmokeAnimation,
      DEFAULT_ASSISTANT_SETTINGS.enableSmokeAnimation
    ),
    animation: {
      viseme: {
        strength: getNumberInputValue(
          visemeRefs.strength,
          visemeDefaults.strength
        ),
        smoothing: getNumberInputValue(
          visemeRefs.smoothing,
          visemeDefaults.smoothing
        ),
        delayMs: getNumberInputValue(
          visemeRefs.delayMs,
          visemeDefaults.delayMs
        ),
        holdMs: getNumberInputValue(visemeRefs.holdMs, visemeDefaults.holdMs),
      },
      head: {
        enableBlinks: getCheckboxValue(
          headRefs.enableBlinks,
          headDefaults.enableBlinks
        ),
        enableRandomNods: getCheckboxValue(
          headRefs.enableRandomNods,
          headDefaults.enableRandomNods
        ),
        nodIntensity: getNumberInputValue(
          headRefs.nodIntensity,
          headDefaults.nodIntensity
        ),
        volumeInfluence: getNumberInputValue(
          headRefs.volumeInfluence,
          headDefaults.volumeInfluence
        ),
        hoverAmount: getNumberInputValue(
          headRefs.hoverAmount,
          headDefaults.hoverAmount
        ),
      },
      expressions: {
        enableEyebrows: getCheckboxValue(
          expressionRefs.enableEyebrows,
          expressionDefaults.enableEyebrows
        ),
        eyebrowIntensity: getNumberInputValue(
          expressionRefs.eyebrowIntensity,
          expressionDefaults.eyebrowIntensity
        ),
        eyebrowVolumeInfluence: getNumberInputValue(
          expressionRefs.eyebrowVolumeInfluence,
          expressionDefaults.eyebrowVolumeInfluence
        ),
        happiness: getNumberInputValue(
          expressionRefs.happiness,
          expressionDefaults.happiness
        ),
      },
    },
    lighting: {
      meshColor: lightingRefs.meshColor?.value || lightingDefaults.meshColor,
      enableSpotLight: getCheckboxValue(
        lightingRefs.enableSpotLight,
        lightingDefaults.enableSpotLight
      ),
      spotIntensity: getNumberInputValue(
        lightingRefs.spotIntensity,
        lightingDefaults.spotIntensity
      ),
      spotAngle: getNumberInputValue(
        lightingRefs.spotAngle,
        lightingDefaults.spotAngle
      ),
      spotOffset: getNumberInputValue(
        lightingRefs.spotOffset,
        lightingDefaults.spotOffset
      ),
      spotHeightOffset: getNumberInputValue(
        lightingRefs.spotHeightOffset,
        lightingDefaults.spotHeightOffset
      ),
      spotVerticalRotation: getNumberInputValue(
        lightingRefs.spotVerticalRotation,
        lightingDefaults.spotVerticalRotation
      ),
    },
    nvidiaAudio2Face: {
      enabled: getCheckboxValue(
        audio2FaceRefs.enabled,
        DEFAULT_AUDIO2FACE_SETTINGS.enabled
      ),
      apiKey: audio2FaceRefs.apiKey?.value?.trim() || "",
      model: normalizeAudio2FaceModel(audio2FaceRefs.model?.value),
      functionId: audio2FaceRefs.functionId?.value?.trim() || "",
    },
  });
}

function getValueAtPath(source, path, fallback) {
  let current = source;
  for (const key of path) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return fallback;
    }
  }
  return current;
}

function settingsEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  const simpleKeys = [
    "name",
    "hotword",
    "apiKey",
    "model",
    "voice",
    "initialPrompt",
  ];
  for (const key of simpleKeys) {
    if ((a[key] || "") !== (b[key] || "")) {
      return false;
    }
  }

  const defaults = DEFAULT_ASSISTANT_SETTINGS.animation;
  const lightingDefaults = DEFAULT_ASSISTANT_SETTINGS.lighting;
  const comparisons = [
    {
      path: ["enableSmokeAnimation"],
      fallback: DEFAULT_ASSISTANT_SETTINGS.enableSmokeAnimation,
    },
    {
      path: ["animation", "viseme", "strength"],
      fallback: defaults.viseme.strength,
    },
    {
      path: ["animation", "viseme", "smoothing"],
      fallback: defaults.viseme.smoothing,
    },
    {
      path: ["animation", "viseme", "delayMs"],
      fallback: defaults.viseme.delayMs,
    },
    {
      path: ["animation", "viseme", "holdMs"],
      fallback: defaults.viseme.holdMs,
    },
    {
      path: ["animation", "head", "enableBlinks"],
      fallback: defaults.head.enableBlinks,
    },
    {
      path: ["animation", "head", "enableRandomNods"],
      fallback: defaults.head.enableRandomNods,
    },
    {
      path: ["animation", "head", "nodIntensity"],
      fallback: defaults.head.nodIntensity,
    },
    {
      path: ["animation", "head", "volumeInfluence"],
      fallback: defaults.head.volumeInfluence,
    },
    {
      path: ["animation", "head", "hoverAmount"],
      fallback: defaults.head.hoverAmount,
    },
    {
      path: ["animation", "expressions", "enableEyebrows"],
      fallback: defaults.expressions.enableEyebrows,
    },
    {
      path: ["animation", "expressions", "eyebrowIntensity"],
      fallback: defaults.expressions.eyebrowIntensity,
    },
    {
      path: ["animation", "expressions", "eyebrowVolumeInfluence"],
      fallback: defaults.expressions.eyebrowVolumeInfluence,
    },
    {
      path: ["animation", "expressions", "happiness"],
      fallback: defaults.expressions.happiness,
    },
    { path: ["lighting", "meshColor"], fallback: lightingDefaults.meshColor },
    {
      path: ["lighting", "enableSpotLight"],
      fallback: lightingDefaults.enableSpotLight,
    },
    {
      path: ["lighting", "spotIntensity"],
      fallback: lightingDefaults.spotIntensity,
    },
    { path: ["lighting", "spotAngle"], fallback: lightingDefaults.spotAngle },
    { path: ["lighting", "spotOffset"], fallback: lightingDefaults.spotOffset },
    {
      path: ["lighting", "spotHeightOffset"],
      fallback: lightingDefaults.spotHeightOffset,
    },
    {
      path: ["lighting", "spotVerticalRotation"],
      fallback: lightingDefaults.spotVerticalRotation,
    },
    {
      path: ["nvidiaAudio2Face", "enabled"],
      fallback: DEFAULT_AUDIO2FACE_SETTINGS.enabled,
    },
    {
      path: ["nvidiaAudio2Face", "apiKey"],
      fallback: DEFAULT_AUDIO2FACE_SETTINGS.apiKey,
    },
    {
      path: ["nvidiaAudio2Face", "model"],
      fallback: DEFAULT_AUDIO2FACE_SETTINGS.model,
    },
    {
      path: ["nvidiaAudio2Face", "functionId"],
      fallback: DEFAULT_AUDIO2FACE_SETTINGS.functionId,
    },
  ];

  return comparisons.every(({ path, fallback }) => {
    const left = getValueAtPath(a, path, fallback);
    const right = getValueAtPath(b, path, fallback);
    return left === right;
  });
}

function handleInputChange() {
  const nextDraft = readFormValues();
  draftSettings = nextDraft;
  queueLightingPreviewUpdate(nextDraft.lighting);
  updateDirtyState(nextDraft, draftVisemeConfig);
}

function handleSave(event) {
  if (event) {
    event.preventDefault();
  }
  try {
    const savedSettings = ensureAssistantSettings(
      saveAssistantSettings(draftSettings)
    );
    const savedVisemeConfig = cloneVisemeConfig(
      saveVisemeConfig(draftVisemeConfig)
    );

    committedSettings = savedSettings;
    committedVisemeConfig = savedVisemeConfig;
    draftSettings = ensureAssistantSettings(committedSettings);
    draftVisemeConfig = cloneVisemeConfig(committedVisemeConfig);

    applySettingsToForm(committedSettings, draftVisemeConfig);
    setDirty(false);
    setStatus("Settings saved locally. Viseme mapping updated.", "info");
  } catch (error) {
    console.error("Failed to save assistant or viseme settings", error);
    setStatus("Failed to save settings.", "error");
  }
}

function handleReset() {
  draftSettings = ensureAssistantSettings(DEFAULT_ASSISTANT_SETTINGS);
  draftVisemeConfig = cloneDefaultVisemeConfig();
  applySettingsToForm(draftSettings, draftVisemeConfig);
  setDirty(true);
  setStatus("Defaults restored. Press save to apply them.", "info");
}

function syncAssistantSettingsFromStorage() {
  committedSettings = ensureAssistantSettings(loadAssistantSettings());
  draftSettings = ensureAssistantSettings(committedSettings);
  applySettingsToForm(committedSettings, draftVisemeConfig);
  const changed = updateDirtyState(draftSettings, draftVisemeConfig, {
    silent: true,
  });
  if (!changed) {
    setStatus("Assistant settings synced from storage.", "info");
  } else {
    setStatus(
      "Assistant settings synced from storage. Viseme edits pending save.",
      "info"
    );
  }
}

function syncVisemeConfigFromStorage() {
  committedVisemeConfig = cloneVisemeConfig(loadVisemeConfig());
  draftVisemeConfig = cloneVisemeConfig(committedVisemeConfig);
  renderVisemeEditor(draftVisemeConfig);
  const changed = updateDirtyState(draftSettings, draftVisemeConfig, {
    silent: true,
  });
  if (!changed) {
    setStatus("Viseme mapping synced from storage.", "info");
  } else {
    setStatus(
      "Viseme mapping synced from storage. Assistant edits pending save.",
      "info"
    );
  }
}

function bindEvents() {
  if (formElement) {
    formElement.addEventListener("submit", handleSave);
  }

  const allInputs = [
    ...Object.values(inputRefs),
    ...Object.values(audio2FaceRefs),
    ...Object.values(animationGeneralRefs),
    ...Object.values(visemeRefs),
    ...Object.values(headRefs),
    ...Object.values(expressionRefs),
    ...Object.values(lightingRefs),
  ].filter(Boolean);

  allInputs.forEach((input) => {
    const type = (input.type || "").toLowerCase();
    const eventName =
      type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => {
      if (type === "range") {
        updateRangeDisplay(input);
      }
      handleInputChange();
    });
  });

  if (audio2FaceRefs.model) {
    audio2FaceRefs.model.addEventListener("change", () => {
      const modelValue = normalizeAudio2FaceModel(audio2FaceRefs.model?.value);
      const defaultId = getDefaultAudio2FaceFunctionId(modelValue);
      if (audio2FaceRefs.functionId) {
        const currentValue = audio2FaceRefs.functionId.value?.trim();
        const previousDefault =
          getDefaultAudio2FaceFunctionId(lastAudio2FaceModel);
        if (!currentValue || currentValue === previousDefault) {
          audio2FaceRefs.functionId.value = defaultId;
        }
      }
      lastAudio2FaceModel = modelValue;
      updateAudio2FaceFunctionPlaceholder(modelValue);
      handleInputChange();
    });
  }

  if (saveButton) {
    saveButton.addEventListener("click", handleSave);
  }

  if (resetButton) {
    resetButton.addEventListener("click", handleReset);
  }

  if (visemeEditorElement) {
    visemeEditorElement.addEventListener("input", handleVisemeEditorInput);
    visemeEditorElement.addEventListener("change", handleVisemeEditorChange);
    visemeEditorElement.addEventListener("click", handleVisemeEditorClick);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === ASSISTANT_SETTINGS_STORAGE_KEY) {
      syncAssistantSettingsFromStorage();
    } else if (event.key === VISEME_CONFIG_STORAGE_KEY) {
      syncVisemeConfigFromStorage();
    }
  });
}

function handleVisemeEditorInput(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (!target.matches(".viseme-shape-slider")) {
    return;
  }
  const row = target.closest(".viseme-shape-row");
  if (!row) {
    return;
  }
  const visemeName = row.dataset.viseme;
  const shapeName = row.dataset.shape;
  if (!visemeName || !shapeName) {
    return;
  }
  const rawValue = Number(target.value);
  setVisemeBlendshapeWeight(draftVisemeConfig, visemeName, shapeName, rawValue);
  const storedValue = draftVisemeConfig.visemes?.[visemeName]?.[shapeName] ?? 0;
  target.value = `${storedValue}`;
  const valueDisplay = row.querySelector(".viseme-shape-value");
  if (valueDisplay) {
    valueDisplay.textContent = toPercent(storedValue);
  }
  updateDirtyState(draftSettings, draftVisemeConfig);
}

function handleVisemeEditorChange(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (!target.matches(".viseme-shape-name")) {
    return;
  }
  const row = target.closest(".viseme-shape-row");
  if (!row) {
    return;
  }
  const visemeName = row.dataset.viseme;
  const previousName = row.dataset.shape;
  if (!visemeName || !previousName) {
    target.value = previousName;
    return;
  }
  const { appliedName, changed } = renameVisemeBlendshape(
    draftVisemeConfig,
    visemeName,
    previousName,
    target.value || ""
  );
  if (target.value !== appliedName) {
    target.value = appliedName;
  }
  row.dataset.shape = appliedName;
  if (changed) {
    renderVisemeRecipe(visemeName, draftVisemeConfig);
    const updatedRow = findShapeRowElement(visemeName, appliedName);
    const updatedInput = updatedRow?.querySelector(".viseme-shape-name");
    if (updatedInput) {
      updatedInput.focus();
      updatedInput.select();
    }
  }
  updateDirtyState(draftSettings, draftVisemeConfig);
}

function handleVisemeEditorClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const removeButton = target.closest(".viseme-shape-remove");
  if (removeButton) {
    const row = removeButton.closest(".viseme-shape-row");
    const visemeName = row?.dataset.viseme;
    const shapeName = row?.dataset.shape;
    if (
      visemeName &&
      shapeName &&
      removeVisemeBlendshape(draftVisemeConfig, visemeName, shapeName)
    ) {
      renderVisemeRecipe(visemeName, draftVisemeConfig);
      updateDirtyState(draftSettings, draftVisemeConfig);
    }
    return;
  }

  const addButton = target.closest(".viseme-add-button");
  if (addButton) {
    const visemeName = addButton.dataset.viseme;
    if (!visemeName) {
      return;
    }
    const newName = addBlendshapeToViseme(visemeName);
    renderVisemeRecipe(visemeName, draftVisemeConfig);
    updateDirtyState(draftSettings, draftVisemeConfig);
    const newRow = findShapeRowElement(visemeName, newName);
    const nameInput = newRow?.querySelector(".viseme-shape-name");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }
}

function init() {
  committedSettings = ensureAssistantSettings(loadAssistantSettings());
  draftSettings = ensureAssistantSettings(committedSettings);
  committedVisemeConfig = cloneVisemeConfig(loadVisemeConfig());
  draftVisemeConfig = cloneVisemeConfig(committedVisemeConfig);
  applySettingsToForm(committedSettings, draftVisemeConfig);
  initLightingPreview();
  bindEvents();
  setDirty(false);
  if (!committedSettings.apiKey) {
    setStatus(
      "Add your realtime-enabled OpenAI API key and press save.",
      "info"
    );
  } else {
    setStatus("Assistant settings loaded. Update them anytime.", "info");
  }
}

init();
