import * as THREE from 'https://unpkg.com/three@0.168.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.168.0/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'https://unpkg.com/three@0.168.0/examples/jsm/loaders/FBXLoader.js';
import * as BufferGeometryUtils from 'https://unpkg.com/three@0.168.0/examples/jsm/utils/BufferGeometryUtils.js';
import {
  VISEME_NAMES,
  loadVisemeConfig,
  mergeWithDefaultConfig,
  VISEME_CONFIG_STORAGE_KEY,
  getOrderedBlendshapeNames
} from './viseme-config.js';
import { applyMirrorMaskOrientation, shouldApplyMirrorMaskOrientation } from './mirror-model-utils.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const defaultSelect = document.getElementById('default-select');
const loadDefaultButton = document.getElementById('load-default');
const statusMessage = document.getElementById('status-message');
const canvasContainer = document.getElementById('canvas-container');
const blendshapeContainer = document.getElementById('blendshape-sliders');
const visemeContainer = document.getElementById('viseme-sliders');
const blendshapeTablist = document.getElementById('blendshape-tablist');
const manualBlendshapePanel = document.getElementById('manual-blendshape-panel');
const visemePanel = document.getElementById('viseme-panel');

const MANUAL_BLENDSHAPE_CATEGORIES = Object.freeze([
  { id: 'brows', label: 'Brows', matchers: ['brow'] },
  { id: 'cheek', label: 'Cheek', matchers: ['cheek'] },
  { id: 'eyes', label: 'Eyes', matchers: ['eye', 'eyelid', 'blink', 'look'] },
  { id: 'jaw', label: 'Jaw', matchers: ['jaw', 'chin'] },
  { id: 'mouth', label: 'Mouth', matchers: ['mouth', 'lip', 'tongue', 'smile', 'frown', 'pout'] },
  { id: 'nose', label: 'Nose', matchers: ['nose', 'nostril', 'sneer', 'snarl'] }
]);

const BLENDSHAPE_TABS = Object.freeze([
  ...MANUAL_BLENDSHAPE_CATEGORIES,
  { id: 'visemes', label: 'Visemes' }
]);

const tabButtons = new Map();
const manualCategoryRows = new Map();
let activeTabId = BLENDSHAPE_TABS[0]?.id ?? 'visemes';
let lastManualTabId = MANUAL_BLENDSHAPE_CATEGORIES[0]?.id ?? 'visemes';
let manualEmptyStateMessage = 'Load a model to see available blendshapes.';

let visemeConfig = mergeWithDefaultConfig(loadVisemeConfig());
let visemeValues = {};
const manualBlendshapeValues = new Map();
const manualSliderElements = new Map();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1120);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(0, 1.5, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasContainer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.5, 0);
controls.update();

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1f2937, 1.1);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(6, 10, 6);
dirLight.castShadow = true;
dirLight.shadow.bias = -0.0001;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x9ca3af, 0.4);
fillLight.position.set(-4, 6, -6);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    roughness: 0.9,
    metalness: 0.1
  })
);
ground.receiveShadow = true;
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.5;
scene.add(ground);

const loader = new FBXLoader();
let currentModel = null;
let activeBlendshapeMap = new Map();

const MORPH_MISMATCH_HINT = [
  'Morph target integrity mismatch detected.',
  'This typically happens when an indexed geometry is expanded to non-indexed',
  'after morph targets were created (e.g. geometry.toNonIndexed(), geometry.setIndex(null),',
  'BufferGeometryUtils.mergeGeometries, BufferGeometryUtils.toTrianglesDrawMode, or clone().toNonIndexed()).',
  'Avoid those calls on meshes with morph targets, or expand the morph attributes alongside the base geometry.'
].join(' ');

let _printedMorphMismatchHint = false;

function getManualCategoryId(blendshapeName) {
  const normalized = String(blendshapeName || '').toLowerCase();
  for (const category of MANUAL_BLENDSHAPE_CATEGORIES) {
    if (category.matchers.some((matcher) => normalized.includes(matcher))) {
      return category.id;
    }
  }
  const fallback = MANUAL_BLENDSHAPE_CATEGORIES.find((category) => category.id === 'mouth');
  return fallback?.id ?? MANUAL_BLENDSHAPE_CATEGORIES[0]?.id ?? 'mouth';
}

function renderManualCategory(categoryId) {
  if (!blendshapeContainer) {
    return;
  }

  const rows = manualCategoryRows.get(categoryId) || [];
  blendshapeContainer.innerHTML = '';

  if (rows.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = manualEmptyStateMessage;
    blendshapeContainer.appendChild(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row) => fragment.appendChild(row));
  blendshapeContainer.appendChild(fragment);
}

function activateTab(tabId) {
  if (!BLENDSHAPE_TABS.some((tab) => tab.id === tabId)) {
    return;
  }

  activeTabId = tabId;

  tabButtons.forEach((button, id) => {
    const isActive = id === tabId;
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.tabIndex = isActive ? 0 : -1;
  });

  if (tabId === 'visemes') {
    if (manualBlendshapePanel) {
      manualBlendshapePanel.classList.add('is-hidden');
    }
    if (visemePanel) {
      visemePanel.classList.remove('is-hidden');
    }
    if (lastManualTabId && lastManualTabId !== 'visemes') {
      renderManualCategory(lastManualTabId);
    }
    return;
  }

  lastManualTabId = tabId;
  if (manualBlendshapePanel) {
    manualBlendshapePanel.classList.remove('is-hidden');
  }
  if (visemePanel) {
    visemePanel.classList.add('is-hidden');
  }
  renderManualCategory(tabId);
}

function handleTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const tabIds = BLENDSHAPE_TABS.map((tab) => tab.id);
  const currentIndex = tabIds.indexOf(activeTabId);
  let nextIndex = currentIndex;

  if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
  } else if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabIds.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabIds.length - 1;
  }

  const nextId = tabIds[nextIndex];
  activateTab(nextId);
  const nextButton = tabButtons.get(nextId);
  if (nextButton) {
    nextButton.focus();
  }
}

function initializeBlendshapeTabs() {
  if (!blendshapeTablist) {
    return;
  }

  blendshapeTablist.innerHTML = '';
  tabButtons.clear();

  BLENDSHAPE_TABS.forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button';
    button.textContent = tab.label;
    button.dataset.tabId = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', tab.id === 'visemes' ? 'viseme-panel' : 'manual-blendshape-panel');
    button.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
    button.tabIndex = tab.id === activeTabId ? 0 : -1;
    button.addEventListener('click', () => {
      activateTab(tab.id);
    });
    blendshapeTablist.appendChild(button);
    tabButtons.set(tab.id, button);
  });

  blendshapeTablist.addEventListener('keydown', handleTabKeydown);
  activateTab(activeTabId);
}

function hasMorphs(geometry) {
  return Boolean(
    geometry?.morphAttributes &&
      ((Array.isArray(geometry.morphAttributes.position) && geometry.morphAttributes.position.length > 0) ||
        (Array.isArray(geometry.morphAttributes.normal) && geometry.morphAttributes.normal.length > 0))
  );
}

function expandAttributeByIndex(attribute, indexArray) {
  if (!attribute || !indexArray) {
    return null;
  }

  const { array, itemSize, normalized } = attribute;
  const ArrayType = array.constructor;
  const expanded = new ArrayType(indexArray.length * itemSize);

  for (let i = 0, offset = 0; i < indexArray.length; i += 1) {
    const sourceIndex = indexArray[i] * itemSize;
    for (let k = 0; k < itemSize; k += 1) {
      expanded[offset] = array[sourceIndex + k];
      offset += 1;
    }
  }

  const expandedAttribute = new THREE.BufferAttribute(expanded, itemSize, normalized);
  if (typeof attribute.name === 'string') {
    expandedAttribute.name = attribute.name;
  }
  if (attribute.usage !== undefined) {
    expandedAttribute.usage = attribute.usage;
  }
  expandedAttribute.needsUpdate = true;
  return expandedAttribute;
}

function toNonIndexedWithMorphs(geometry) {
  if (!geometry || !geometry.index) {
    return geometry;
  }

  const indexArray = geometry.index.array;
  const result = new THREE.BufferGeometry();

  const expandAttribute = (attribute) => {
    if (!attribute) {
      return null;
    }

    const { array, itemSize, normalized } = attribute;
    const ArrayType = array.constructor;
    const expanded = new ArrayType(indexArray.length * itemSize);

    for (let i = 0, offset = 0; i < indexArray.length; i += 1) {
      const sourceIndex = indexArray[i] * itemSize;
      for (let k = 0; k < itemSize; k += 1) {
        expanded[offset] = array[sourceIndex + k];
        offset += 1;
      }
    }

    return new THREE.BufferAttribute(expanded, itemSize, normalized);
  };

  const attributeNames = Object.keys(geometry.attributes || {});
  attributeNames.forEach((name) => {
    const attribute = geometry.getAttribute(name);
    if (!attribute) {
      return;
    }
    const expanded = expandAttribute(attribute);
    if (expanded) {
      result.setAttribute(name, expanded);
    }
  });

  if (geometry.morphAttributes?.position?.length) {
    result.morphAttributes = result.morphAttributes || {};
    result.morphAttributes.position = geometry.morphAttributes.position
      .map((attribute) => expandAttribute(attribute))
      .filter(Boolean);
  }

  if (geometry.morphAttributes?.normal?.length) {
    result.morphAttributes = result.morphAttributes || {};
    result.morphAttributes.normal = geometry.morphAttributes.normal
      .map((attribute) => expandAttribute(attribute))
      .filter(Boolean);
  }

  result.morphTargetsRelative = geometry.morphTargetsRelative === true;
  result.name = geometry.name || result.name;
  result.userData = { ...geometry.userData };

  if (Array.isArray(geometry.groups) && geometry.groups.length > 0) {
    geometry.groups.forEach((group) => {
      result.addGroup(group.start, group.count, group.materialIndex);
    });
  }

  const { start = 0, count = indexArray.length } = geometry.drawRange || {};
  result.setDrawRange(start, count === Infinity ? indexArray.length : count);

  result.computeBoundingBox();
  result.computeBoundingSphere();

  return result;
}

function getGeometryAttribute(geometry, name) {
  if (!geometry) {
    return null;
  }
  if (typeof geometry.getAttribute === 'function') {
    return geometry.getAttribute(name);
  }
  return geometry.attributes?.[name] ?? null;
}

function printMorphMismatchHint() {
  if (_printedMorphMismatchHint) {
    return;
  }
  console.warn(MORPH_MISMATCH_HINT);
  _printedMorphMismatchHint = true;
}

function enforceMorphSafety(root) {
  if (!root || typeof root.traverse !== 'function') {
    return;
  }

  root.traverse((child) => {
    if (child.isMesh) {
      prepareMeshForMorphTargets(child);
    }
  });
}

function prepareMeshForMorphTargets(mesh) {
  if (!mesh.geometry || !hasMorphs(mesh.geometry)) {
    return;
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => {
    if (material && 'morphTargets' in material) {
      material.morphTargets = true;
      material.needsUpdate = true;
    }
    if (material && 'morphNormals' in material && mesh.geometry.morphAttributes?.normal?.length) {
      material.morphNormals = true;
    }
  });
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = canvasContainer;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function setStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusMessage.classList.remove('error', 'success', 'warning');
  if (type === 'error') {
    statusMessage.classList.add('error');
  } else if (type === 'success') {
    statusMessage.classList.add('success');
  } else if (type === 'warning') {
    statusMessage.classList.add('warning');
  }
}

function clearBlendshapeUI(
  message = 'Load a model to see available blendshapes.',
  visemeMessage = 'Load a model to map visemes to blendshapes.'
) {
  activeBlendshapeMap.clear();
  manualBlendshapeValues.clear();
  manualSliderElements.clear();
  manualCategoryRows.clear();
  manualEmptyStateMessage = message;

  const targetCategory =
    lastManualTabId && lastManualTabId !== 'visemes'
      ? lastManualTabId
      : MANUAL_BLENDSHAPE_CATEGORIES[0]?.id;
  if (targetCategory) {
    renderManualCategory(targetCategory);
  }

  clearVisemeUI(visemeMessage);
}

function clearVisemeUI(message = 'Load a model to map visemes to blendshapes.') {
  visemeContainer.innerHTML = '';
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = message;
  visemeContainer.appendChild(placeholder);
  visemeValues = {};
}

function setupBlendshapeControls(object3D) {
  manualBlendshapeValues.clear();
  manualSliderElements.clear();
  activeBlendshapeMap = new Map();
  manualCategoryRows.clear();

  object3D.traverse((child) => {
    if (
      child.isMesh &&
      child.geometry &&
      child.morphTargetDictionary &&
      child.morphTargetInfluences
    ) {
      for (const [name, index] of Object.entries(child.morphTargetDictionary)) {
        if (!activeBlendshapeMap.has(name)) {
          activeBlendshapeMap.set(name, []);
        }
        activeBlendshapeMap.get(name).push({ mesh: child, index });
      }
    }
  });

  if (activeBlendshapeMap.size === 0) {
    clearBlendshapeUI(
      'No blendshapes found in this model.',
      'Viseme recipes require matching blendshapes in the current model.'
    );
    return;
  }

  for (const [name, targets] of [...activeBlendshapeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = document.createElement('div');
    row.className = 'slider-row';

    const header = document.createElement('div');
    header.className = 'slider-label';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = name;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';

    const initialTarget = targets[0];
    const initialValue =
      initialTarget && typeof initialTarget.index === 'number'
        ? initialTarget.mesh.morphTargetInfluences[initialTarget.index] || 0
        : 0;

    manualBlendshapeValues.set(name, initialValue);
    valueSpan.textContent = `${Math.round(initialValue * 100)}%`;

    header.appendChild(labelSpan);
    header.appendChild(valueSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = `${initialValue}`;
    slider.disabled = !initialTarget;

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      manualBlendshapeValues.set(name, value);
      updateMorphInfluences();
    });

    manualSliderElements.set(name, { slider, valueSpan });

    row.appendChild(header);
    row.appendChild(slider);

    const categoryId = getManualCategoryId(name);
    if (!manualCategoryRows.has(categoryId)) {
      manualCategoryRows.set(categoryId, []);
    }
    manualCategoryRows.get(categoryId).push(row);
  }

  manualEmptyStateMessage = 'No blendshapes found for this category in the current model.';

  const renderTarget =
    activeTabId === 'visemes'
      ? lastManualTabId && lastManualTabId !== 'visemes'
        ? lastManualTabId
        : MANUAL_BLENDSHAPE_CATEGORIES[0]?.id
      : activeTabId;
  if (renderTarget) {
    renderManualCategory(renderTarget);
  }

  setupVisemeControls();
  updateMorphInfluences();
}

function setupVisemeControls() {
  visemeContainer.innerHTML = '';
  visemeValues = {};

  if (activeBlendshapeMap.size === 0) {
    clearVisemeUI('Load a model to map visemes to blendshapes.');
    return;
  }

  const fragment = document.createDocumentFragment();

  VISEME_NAMES.forEach((visemeName) => {
    const recipe = visemeConfig.visemes?.[visemeName] ?? {};
    const recipeShapes = getOrderedBlendshapeNames(visemeConfig, visemeName);

    const row = document.createElement('div');
    row.className = 'slider-row';

    const header = document.createElement('div');
    header.className = 'slider-label';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = visemeName;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    valueSpan.textContent = '0%';

    header.appendChild(labelSpan);
    header.appendChild(valueSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = '0';

    const availableShapes = recipeShapes.filter((shape) => activeBlendshapeMap.has(shape));
    const missingShapes = recipeShapes.filter((shape) => !activeBlendshapeMap.has(shape));

    if (recipeShapes.length === 0) {
      slider.disabled = true;
      row.classList.add('warning');
      const warning = document.createElement('p');
      warning.className = 'slider-warning';
      warning.textContent = 'No blendshapes are configured for this viseme. Update the mapping in Settings.';
      row.appendChild(warning);
    } else if (availableShapes.length === 0) {
      slider.disabled = true;
      row.classList.add('warning');
    } else if (missingShapes.length > 0) {
      row.classList.add('warning');
    }

    row.appendChild(header);
    row.appendChild(slider);

    if (recipeShapes.length === 0) {
      // Message already added above.
    } else if (availableShapes.length === 0) {
      const warning = document.createElement('p');
      warning.className = 'slider-warning';
      warning.textContent = 'No matching blendshapes found for this viseme.';
      row.appendChild(warning);
    } else if (missingShapes.length > 0) {
      const warning = document.createElement('p');
      warning.className = 'slider-warning';
      warning.textContent = `Missing blendshapes: ${missingShapes.join(', ')}`;
      row.appendChild(warning);
    }

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      visemeValues[visemeName] = value;
      valueSpan.textContent = `${Math.round(value * 100)}%`;
      updateMorphInfluences();
    });

    visemeValues[visemeName] = 0;
    fragment.appendChild(row);
  });

  visemeContainer.appendChild(fragment);
}

function updateMorphInfluences() {
  if (activeBlendshapeMap.size === 0) {
    return;
  }

  const totals = new Map();

  manualBlendshapeValues.forEach((value, name) => {
    totals.set(name, Math.min(1, Math.max(0, value)));
  });

  for (const [visemeName, visemeWeight] of Object.entries(visemeValues)) {
    if (!visemeWeight) {
      continue;
    }
    const recipe = visemeConfig.visemes?.[visemeName];
    if (!recipe) {
      continue;
    }
    for (const [shape, weight] of Object.entries(recipe)) {
      if (!activeBlendshapeMap.has(shape)) {
        continue;
      }
      const contribution = visemeWeight * weight;
      if (!contribution) {
        continue;
      }
      const current = totals.get(shape) || 0;
      totals.set(shape, Math.min(1, current + contribution));
    }
  }

  for (const [name, targets] of activeBlendshapeMap.entries()) {
    const value = Math.min(1, totals.get(name) ?? 0);
    targets.forEach(({ mesh, index }) => {
      mesh.morphTargetInfluences[index] = value;
    });
  }

  updateManualValueDisplays(totals);
}

function updateManualValueDisplays(totals) {
  manualSliderElements.forEach(({ slider, valueSpan }, name) => {
    const baseValue = manualBlendshapeValues.get(name) ?? 0;
    const finalValue = totals.get(name) ?? 0;

    if (slider) {
      slider.value = `${baseValue}`;
    }

    if (valueSpan) {
      const finalPercent = Math.round(finalValue * 100);
      const basePercent = Math.round(baseValue * 100);
      if (Math.abs(finalValue - baseValue) < 0.0005) {
        valueSpan.textContent = `${finalPercent}%`;
      } else {
        valueSpan.textContent = `${finalPercent}% (manual ${basePercent}%)`;
      }
    }
  });
}

function focusCameraOnObject(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  if (!isFinite(box.max.x) || !isFinite(box.max.y) || !isFinite(box.max.z)) {
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2));
  cameraDistance = cameraDistance * 0.4 + maxDim;

  camera.position.copy(center);
  camera.position.add(new THREE.Vector3(0, size.y * 0.2, cameraDistance));
  camera.near = Math.max(0.1, cameraDistance / 100);
  camera.far = cameraDistance * 10;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function resetSceneWithModel(object3D, label) {
  if (currentModel) {
    scene.remove(currentModel);
  }
  currentModel = object3D;
  scene.add(currentModel);

  currentModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      prepareMeshForMorphTargets(child);
    }
  });

  focusCameraOnObject(currentModel);

  setupBlendshapeControls(currentModel);
  setStatus(`Loaded ${label}`, 'success');
}

function loadFBXFromArrayBuffer(buffer, label) {
  try {
    const object = loader.parse(buffer, '');
    enforceMorphSafety(object);
    if (shouldApplyMirrorMaskOrientation(label)) {
      applyMirrorMaskOrientation(object);
    }
    resetSceneWithModel(object, label);
  } catch (error) {
    handleLoadFailure(label, error);
  }
}

function handleLoadFailure(label, error) {
  console.error('Failed to load FBX', error);
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const integrityIssue =
    (error && typeof error === 'object' && error.isMorphIntegrityError === true) || /morph/i.test(message);
  if (integrityIssue) {
    printMorphMismatchHint();
  }
  const statusText = integrityIssue
    ? `Morph target integrity issue in ${label}: ${message} (see console for debugging hints)`
    : `Failed to load ${label}: ${message}`;
  setStatus(statusText, 'error');
  clearBlendshapeUI(
    integrityIssue ? 'Morph target validation failed for this model. Check export settings.' : undefined
  );
}

function loadFBXFromURL(url, label) {
  setStatus(`Loading ${label}...`);
  loader.load(
    url,
    (object) => {
      try {
        enforceMorphSafety(object);
        if (shouldApplyMirrorMaskOrientation(url, label)) {
          applyMirrorMaskOrientation(object);
        }
        resetSceneWithModel(object, label);
      } catch (error) {
        handleLoadFailure(label, error);
      }
    },
    (event) => {
      if (event.total) {
        const progress = ((event.loaded / event.total) * 100).toFixed(0);
        setStatus(`Loading ${label}... ${progress}%`);
      }
    },
    (error) => {
      handleLoadFailure(label, error);
    }
  );
}

function handleFile(file) {
  if (!file) {
    return;
  }
  if (!file.name.toLowerCase().endsWith('.fbx')) {
    setStatus('Please provide a valid FBX file.', 'error');
    return;
  }
  setStatus(`Reading ${file.name}...`);
  const reader = new FileReader();
  reader.addEventListener('error', () => {
    setStatus(`Could not read ${file.name}`, 'error');
  });
  reader.addEventListener('load', (event) => {
    loadFBXFromArrayBuffer(event.target.result, file.name);
  });
  reader.readAsArrayBuffer(file);
}

async function populateDefaults() {
  try {
    const response = await fetch('/api/defaults');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const defaults = data.defaults || [];
    defaultSelect.innerHTML = '';
    defaultSelect.disabled = false;
    loadDefaultButton.disabled = false;

    if (defaults.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No default FBX files found';
      defaultSelect.appendChild(option);
      defaultSelect.disabled = true;
      loadDefaultButton.disabled = true;
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select a character --';
    placeholder.disabled = true;
    placeholder.selected = true;
    defaultSelect.appendChild(placeholder);

    defaults.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.url;
      option.textContent = entry.name;
      defaultSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Failed to fetch defaults', error);
    defaultSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Unable to load defaults';
    defaultSelect.appendChild(option);
    loadDefaultButton.disabled = true;
    setStatus('Could not load default characters.', 'error');
  }
}

function setupDragAndDrop() {
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });

  ['dragleave', 'dragend'].forEach((type) => {
    dropZone.addEventListener(type, () => {
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleFile(event.dataTransfer.files[0]);
    }
  });
}

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  handleFile(file);
  fileInput.value = '';
});

loadDefaultButton.addEventListener('click', () => {
  const url = defaultSelect.value;
  if (!url) {
    setStatus('Select a default character to load.', 'error');
    return;
  }
  loadFBXFromURL(url, defaultSelect.options[defaultSelect.selectedIndex].textContent);
});

window.addEventListener('storage', (event) => {
  if (event.key === VISEME_CONFIG_STORAGE_KEY) {
    try {
      const parsed = event.newValue ? JSON.parse(event.newValue) : null;
      visemeConfig = mergeWithDefaultConfig(parsed ?? loadVisemeConfig());
      if (activeBlendshapeMap.size > 0) {
        setupVisemeControls();
        updateMorphInfluences();
      }
    } catch (error) {
      console.warn('Failed to apply updated viseme configuration from Settings.', error);
    }
  }
});

window.addEventListener('resize', resizeRenderer);
initializeBlendshapeTabs();
setupDragAndDrop();
populateDefaults();
resizeRenderer();
animate();

setStatus('Ready. Load an FBX file to begin.');
clearBlendshapeUI();
