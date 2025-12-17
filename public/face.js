import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Lipsync } from "/vendor/wawa-lipsync/wawa-lipsync.es.js";
import { getVisemeTargets } from "./lipsync-utils.js";
import {
  VISEME_NAMES,
  mergeWithDefaultConfig,
  loadVisemeConfig,
  VISEME_CONFIG_STORAGE_KEY,
} from "./viseme-config.js";
import {
  loadAssistantSettings,
  ASSISTANT_SETTINGS_STORAGE_KEY,
  ensureAssistantSettings,
  DEFAULT_ASSISTANT_SETTINGS,
  SPOTLIGHT_INTENSITY_MIN,
  SPOTLIGHT_INTENSITY_MAX,
  DEFAULT_SPOTLIGHT_TARGET_OFFSET,
} from "./assistant-settings.js";
import { applyMirrorMaskOrientation } from "./mirror-model-utils.js";

const MIRROR_URL = "/characters/lynq/lynx_bobcat_01.fbx";

const VOWEL_VISEMES = Object.freeze(["AA", "O", "EE", "UH", "W", "ER"]);
const DEFAULT_VISEME_HOLD_MS = 160;

const SMOKE_TEXTURE_URL =
  "https://s3-us-west-2.amazonaws.com/s.cdpn.io/95637/Smoke-Element.png";
const SMOKE_PARTICLE_COUNT = 840; // far denser particle field
const SMOKE_RADIUS_RANGE = [36, 82];
const SMOKE_CORE_RADIUS_RANGE = [18.4, 42.8]; // broader inward pull for the swirl
const SMOKE_INNER_CORE_RADIUS_RANGE = [8.8, 24.6];
const SMOKE_INNER_CORE_PARTICLE_RATIO = 0.32;
const SMOKE_INTRO_DURATION = 3.6;
const SMOKE_REVEAL_DURATION = 1.1;
const SMOKE_REVEAL_TIGHTEN_FACTOR = 0.82; // how much the particle field contracts during the reveal phase
const SMOKE_ACTIVE_DISSIPATE_DURATION = 1.6;
const SMOKE_OUTRO_GATHER_DURATION = 3.4;
const SMOKE_OUTRO_PUFF_DURATION = 2.2;
const SMOKE_COLOR = 0xffffff;
const SMOKE_SCALE_RANGE = [10.5, 22.5];
const SMOKE_VERTICAL_SCALE_RANGE = [1.35, 2.15];
const SMOKE_OUTRO_RADIUS_MULTIPLIER = [1.8, 2.6];
const SMOKE_FRONT_OFFSET = 1.28;
const SMOKE_DEPTH_RANGE = [1, 3.4];
const SMOKE_SWIRL_HEIGHT = 1.75; // stretch vertically for a taller plume
const SMOKE_SWIRL_WIDTH = 0.92; // slightly wider swirl for the smoke animation
const SMOKE_WOBBLE_STRENGTH = 0.88;
const SMOKE_INTRO_SWIRL_TURNS = [2.4, 3.4];
const SMOKE_REVEAL_SWIRL_TURNS = [1.7, 2.6];
const SMOKE_OUTRO_GATHER_SWIRL_TURNS = [2.3, 3.3];
const SMOKE_OUTRO_PUFF_SWIRL_TURNS = [1.2, 2.1];
const SMOKE_GROUP_SCALE_REFERENCE = 680;
const SMOKE_VIEWPORT_MARGIN = 0.04;
const SMOKE_MAX_RADIUS_FRACTION = 0.96;
const SMOKE_INTRO_SFX_URL = "/sfx/intro.MP3";
const SMOKE_OUTRO_SFX_URL = "/sfx/outro.MP3";
const SMOKE_BRIGHTNESS_MULTIPLIER = 1.2;
const SMOKE_VERTICAL_OFFSET_FACTOR = 0.15;

const PHONEME_TO_VISEME = Object.freeze({
  viseme_sil: null,
  viseme_pp: "BMP",
  viseme_ff: "FV",
  viseme_th: "TH",
  viseme_dd: "L",
  viseme_kk: "CH_SH",
  viseme_ch: "CH_SH",
  viseme_ss: "S_Z",
  viseme_nn: "L",
  viseme_rr: "ER",
  viseme_aa: "AA",
  viseme_e: "EE",
  viseme_i: "EE",
  viseme_o: "O",
  viseme_u: "W",
  sil: null,
  aa: "AA",
  ah: "AA",
  ae: "AA",
  aw: "AA",
  er: "ER",
  rr: "ER",
  r: "ER",
  oo: "W",
  ou: "W",
  ow: "O",
  oh: "O",
  uh: "UH",
  uw: "W",
  w: "W",
  o: "O",
  u: "W",
  e: "EE",
  eh: "EE",
  ee: "EE",
  ei: "EE",
  i: "EE",
  ih: "EE",
  y: "EE",
  l: "L",
  el: "L",
  m: "BMP",
  b: "BMP",
  p: "BMP",
  f: "FV",
  v: "FV",
  ph: "FV",
  th: "TH",
  dh: "TH",
  s: "S_Z",
  z: "S_Z",
  zh: "S_Z",
  sh: "CH_SH",
  ch: "CH_SH",
  jh: "CH_SH",
  g: "CH_SH",
  k: "CH_SH",
  q: "CH_SH",
  d: "L",
  t: "L",
  n: "L",
});

function createVisemeState(names) {
  return names.reduce((state, name) => {
    state[name] = {
      name,
      value: 0,
      target: 0,
      holdMs: DEFAULT_VISEME_HOLD_MS,
      lastActivatedAt: 0,
    };
    return state;
  }, {});
}

const BLINK_INTERVAL_MIN_MS = 900;
const BLINK_INTERVAL_MAX_MS = 2200;
const BLINK_DOUBLE_CHANCE = 0.45;
const BLINK_DOUBLE_GAP_RANGE = [0.045, 0.1];
const BLINK_SLOW_CLOSE_RANGE = [0.075, 0.11];
const BLINK_SLOW_OPEN_RANGE = [0.13, 0.18];
const BLINK_SLOW_HOLD_RANGE = [0.035, 0.06];
const BLINK_FAST_CLOSE_RANGE = [0.055, 0.085];
const BLINK_FAST_OPEN_RANGE = [0.09, 0.13];
const BLINK_FAST_HOLD_RANGE = [0.025, 0.045];

const blinkState = {
  phase: "idle",
  value: 0,
  nextBlinkTime: null,
  remainingBlinks: 0,
  holdTimer: 0,
  betweenTimer: 0,
  closeDuration: 0.09,
  openDuration: 0.14,
  holdDuration: 0.05,
  fastNextBlink: false,
};

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function easeInCubic(t) {
  const clamped = clamp01(t);
  return clamped * clamped * clamped;
}

function easeOutCubic(t) {
  const clamped = clamp01(t);
  const inv = 1 - clamped;
  return 1 - inv * inv * inv;
}

function easeInOutCubic(t) {
  const clamped = clamp01(t);
  if (clamped < 0.5) {
    return 4 * clamped * clamped * clamped;
  }
  const inv = -2 * clamped + 2;
  return 1 - (inv * inv * inv) / 2;
}

function isSmokeAnimationEnabled() {
  return assistantSettings.enableSmokeAnimation !== false;
}

function setHeadVisibilityTarget(value, options = {}) {
  const clamped = clamp01(value);
  headVisibilityState.target = clamped;
  if (options.immediate) {
    applyHeadOpacity(clamped);
  }
}

function applyHeadOpacity(value) {
  const clamped = clamp01(value);
  headVisibilityState.current = clamped;
  if (Math.abs(headVisibilityState.lastApplied - clamped) < 1e-3) {
    return;
  }
  headVisibilityState.lastApplied = clamped;
  if (currentModel) {
    currentModel.visible = clamped > 0.01;
  }
  headMaterialData.forEach((data, material) => {
    const nextOpacity = data.baseOpacity * clamped;
    if (Math.abs(material.opacity - nextOpacity) > 1e-3) {
      material.opacity = nextOpacity;
      material.transparent = true;
      material.needsUpdate = true;
    }
  });
}

function updateHeadVisibility(dt) {
  const smoothing = 1 - Math.exp(-Math.max(dt, 0) * 7.5);
  const next =
    headVisibilityState.current +
    (headVisibilityState.target - headVisibilityState.current) * smoothing;
  applyHeadOpacity(next);
}

function registerHeadMaterials(object3D) {
  headMaterialData.clear();
  if (!object3D || typeof object3D.traverse !== "function") {
    return;
  }
  object3D.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (!material || headMaterialData.has(material)) {
        return;
      }
      const baseOpacity = Number.isFinite(material.opacity)
        ? material.opacity
        : 1;
      headMaterialData.set(material, { baseOpacity });
      material.transparent = true;
      material.depthWrite = true;
      material.needsUpdate = true;
    });
  });
  applyHeadOpacity(headVisibilityState.current);
}

function getSmokeVerticalOffset() {
  if (!smokeState?.group) {
    return 0;
  }
  const scale = Math.max(
    smokeState.group.scale?.y || smokeState.group.scale?.x || 1,
    1e-6
  );
  const maxRadius = SMOKE_RADIUS_RANGE[1];
  const localExtent =
    maxRadius * SMOKE_SWIRL_HEIGHT * SMOKE_VERTICAL_OFFSET_FACTOR;
  return localExtent * scale;
}

function alignSmokeGroupWithTarget() {
  if (!smokeState?.group) {
    return;
  }
  smokeState.group.position.copy(spotTarget.position);
  smokeState.group.position.z += SMOKE_FRONT_OFFSET;
  const verticalOffset = getSmokeVerticalOffset();
  if (verticalOffset) {
    smokeState.group.position.y -= verticalOffset;
  }
}

function initSmokeSystem() {
  if (!smokeState.group) {
    return;
  }
  if (smokeState.particles.length > 0) {
    alignSmokeGroupWithTarget();
    return;
  }

  smokeState.group.clear();

  const textureLoader = new THREE.TextureLoader();
  const texture = textureLoader.load(SMOKE_TEXTURE_URL);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(1, 1);

  for (let i = 0; i < SMOKE_PARTICLE_COUNT; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: new THREE.Color(SMOKE_COLOR),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 25;
    smokeState.group.add(mesh);

    const initialRadius = THREE.MathUtils.lerp(
      SMOKE_RADIUS_RANGE[0],
      SMOKE_RADIUS_RANGE[1],
      Math.random()
    );
    const useInnerCore = Math.random() < SMOKE_INNER_CORE_PARTICLE_RATIO;
    const targetRadiusSource = useInnerCore
      ? THREE.MathUtils.lerp(
          SMOKE_INNER_CORE_RADIUS_RANGE[0],
          SMOKE_INNER_CORE_RADIUS_RANGE[1],
          Math.pow(Math.random(), 1.2)
        )
      : THREE.MathUtils.lerp(
          SMOKE_CORE_RADIUS_RANGE[0],
          SMOKE_CORE_RADIUS_RANGE[1],
          Math.pow(Math.random(), 1.35)
        );
    const targetRadius = Math.min(targetRadiusSource, initialRadius);
    const layer = THREE.MathUtils.clamp(
      (initialRadius - SMOKE_RADIUS_RANGE[0]) /
        Math.max(SMOKE_RADIUS_RANGE[1] - SMOKE_RADIUS_RANGE[0], 0.0001),
      0,
      1
    );
    const scale = THREE.MathUtils.lerp(
      SMOKE_SCALE_RANGE[0],
      SMOKE_SCALE_RANGE[1],
      Math.random()
    );
    const verticalScale = THREE.MathUtils.lerp(
      SMOKE_VERTICAL_SCALE_RANGE[0],
      SMOKE_VERTICAL_SCALE_RANGE[1],
      Math.random()
    );
    const outroTargetRadius =
      initialRadius *
      THREE.MathUtils.lerp(
        SMOKE_OUTRO_RADIUS_MULTIPLIER[0],
        SMOKE_OUTRO_RADIUS_MULTIPLIER[1],
        Math.random()
      );
    const direction = Math.random() < 0.5 ? -1 : 1;
    const introTurns = THREE.MathUtils.lerp(
      SMOKE_INTRO_SWIRL_TURNS[0],
      SMOKE_INTRO_SWIRL_TURNS[1],
      Math.pow(1 - layer, 0.75)
    );
    const revealTurns = THREE.MathUtils.lerp(
      SMOKE_REVEAL_SWIRL_TURNS[0],
      SMOKE_REVEAL_SWIRL_TURNS[1],
      Math.pow(1 - layer, 0.55)
    );
    const baseAngle = Math.random() * Math.PI * 2;
    const introStartAngle =
      -Math.PI / 2 + THREE.MathUtils.lerp(-0.42, 0.42, Math.random());
    const introDelay = THREE.MathUtils.lerp(0, 0.82, Math.pow(1 - layer, 1.12));
    const outroDelay = THREE.MathUtils.lerp(0, 0.75, Math.pow(1 - layer, 1.05));
    const outroPuffDelay = THREE.MathUtils.lerp(
      0,
      0.52,
      Math.pow(Math.random(), 1.35)
    );
    const outroGatherTurns = THREE.MathUtils.lerp(
      SMOKE_OUTRO_GATHER_SWIRL_TURNS[0],
      SMOKE_OUTRO_GATHER_SWIRL_TURNS[1],
      Math.pow(1 - layer, 0.68)
    );
    const outroPuffTurns = THREE.MathUtils.lerp(
      SMOKE_OUTRO_PUFF_SWIRL_TURNS[0],
      SMOKE_OUTRO_PUFF_SWIRL_TURNS[1],
      Math.pow(1 - layer, 0.58)
    );

    const particle = {
      mesh,
      initialRadius,
      targetRadius,
      radius: clampRadiusToViewport(initialRadius),
      angle: introStartAngle,
      baseAngle,
      introStartAngle,
      phaseAnchorAngle: introStartAngle,
      direction,
      introTurns,
      revealTurns,
      outroGatherTurns,
      outroPuffTurns,
      introDelay,
      outroDelay,
      outroPuffDelay,
      angularVelocity:
        THREE.MathUtils.lerp(1.1, 2.05, Math.random()) * direction,
      spin: Math.random() * Math.PI * 2,
      spinSpeed:
        THREE.MathUtils.lerp(0.35, 0.92, Math.random()) *
        (Math.random() < 0.5 ? -1 : 1),
      baseOpacity: Math.min(
        1,
        0.64 + Math.random() * 0.32 + (useInnerCore ? 0.12 : 0)
      ),
      layer,
      randomZ: THREE.MathUtils.lerp(
        SMOKE_DEPTH_RANGE[0],
        SMOKE_DEPTH_RANGE[1],
        Math.random()
      ),
      verticalScale,
      scale,
      phaseOffset: Math.random() * Math.PI * 2,
      outroStartRadius: initialRadius,
      outroStartOpacity: 0,
      outroTargetRadius,
      activeRadiusRange: [
        THREE.MathUtils.lerp(0.58, 0.74, Math.random()),
        THREE.MathUtils.lerp(0.96, 1.12, Math.random()),
      ],
      activeOpacityScale: THREE.MathUtils.lerp(0.08, 0.16, Math.random()),
      innerCore: useInnerCore,
    };
    particle.mesh.scale.set(scale, scale * verticalScale, 1);
    smokeState.particles.push(particle);
  }

  alignSmokeGroupWithTarget();
  resetSmokeParticles();
}

function resetSmokeParticles() {
  if (!smokeState.particles.length) {
    return;
  }
  smokeState.particles.forEach((particle) => {
    const baseAngle = Math.random() * Math.PI * 2;
    const introStartAngle =
      -Math.PI / 2 + THREE.MathUtils.lerp(-0.42, 0.42, Math.random());
    particle.radius = clampRadiusToViewport(particle.initialRadius);
    particle.baseAngle = baseAngle;
    particle.introStartAngle = introStartAngle;
    particle.phaseAnchorAngle = introStartAngle;
    particle.angle = introStartAngle;
    particle.spin = Math.random() * Math.PI * 2;
    particle.outroStartRadius = particle.initialRadius;
    particle.outroStartOpacity = 0;
    particle.introTurns = THREE.MathUtils.lerp(
      SMOKE_INTRO_SWIRL_TURNS[0],
      SMOKE_INTRO_SWIRL_TURNS[1],
      Math.pow(1 - particle.layer, 0.72)
    );
    particle.revealTurns = THREE.MathUtils.lerp(
      SMOKE_REVEAL_SWIRL_TURNS[0],
      SMOKE_REVEAL_SWIRL_TURNS[1],
      Math.pow(1 - particle.layer, 0.55)
    );
    particle.outroGatherTurns = THREE.MathUtils.lerp(
      SMOKE_OUTRO_GATHER_SWIRL_TURNS[0],
      SMOKE_OUTRO_GATHER_SWIRL_TURNS[1],
      Math.pow(1 - particle.layer, 0.68)
    );
    particle.outroPuffTurns = THREE.MathUtils.lerp(
      SMOKE_OUTRO_PUFF_SWIRL_TURNS[0],
      SMOKE_OUTRO_PUFF_SWIRL_TURNS[1],
      Math.pow(1 - particle.layer, 0.58)
    );
    particle.introDelay = THREE.MathUtils.lerp(
      0,
      0.82,
      Math.pow(1 - particle.layer, 1.12)
    );
    particle.outroDelay = THREE.MathUtils.lerp(
      0,
      0.75,
      Math.pow(1 - particle.layer, 1.05)
    );
    particle.outroPuffDelay = THREE.MathUtils.lerp(
      0,
      0.52,
      Math.pow(Math.random(), 1.35)
    );
    particle.phaseOffset = Math.random() * Math.PI * 2;
    particle.mesh.position.set(0, 0, particle.randomZ);
    setParticleOpacity(particle, 0);
  });
}

function setParticleOpacity(particle, opacity) {
  if (!particle?.mesh?.material) {
    return;
  }
  const adjustedOpacity = clamp01(opacity * SMOKE_BRIGHTNESS_MULTIPLIER);
  const material = particle.mesh.material;
  if (Math.abs(material.opacity - adjustedOpacity) < 1e-3) {
    return;
  }
  material.opacity = adjustedOpacity;
  material.needsUpdate = true;
}

function clampRadiusToViewport(radius) {
  if (!Number.isFinite(radius)) {
    return radius;
  }
  if (!smokeState?.safeMaxRadius) {
    return radius;
  }
  const limitWorld = smokeState.safeMaxRadius * 0.98;
  const scale = Math.max(smokeState.group?.scale?.x || 1, 1e-6);
  const limitLocal = Math.max(limitWorld / scale, 0);
  return Math.min(radius, limitLocal);
}

function createSmokeAudio(url) {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  try {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    if (typeof audio.load === "function") {
      audio.load();
    }
    return audio;
  } catch (error) {
    console.warn("Failed to create smoke audio", error);
    return null;
  }
}

const smokeSfx = {
  intro: createSmokeAudio(SMOKE_INTRO_SFX_URL),
  outro: createSmokeAudio(SMOKE_OUTRO_SFX_URL),
};

function playSmokeSfx(name) {
  const audio = smokeSfx?.[name];
  if (!audio) {
    return;
  }
  try {
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch((error) =>
        console.warn(`Failed to play smoke ${name} sfx`, error)
      );
    }
  } catch (error) {
    console.warn(`Failed to play smoke ${name} sfx`, error);
  }
}

function stopSmokeSfx(name) {
  const audio = smokeSfx?.[name];
  if (!audio) {
    return;
  }
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (error) {
    console.warn(`Failed to stop smoke ${name} sfx`, error);
  }
}

function stopAllSmokeSfx() {
  stopSmokeSfx("intro");
  stopSmokeSfx("outro");
}

function resolveSmokeRevealWaiters() {
  if (!smokeState.revealResolvers?.size) {
    return;
  }
  smokeState.revealResolvers.forEach((resolve) => {
    try {
      resolve();
    } catch (error) {
      console.warn("Smoke reveal waiter failed to resolve", error);
    }
  });
  smokeState.revealResolvers.clear();
}

function transitionSmokePhase(nextPhase) {
  if (!smokeState.enabled) {
    stopAllSmokeSfx();
    smokeState.phase = "idle";
    smokeState.elapsed = 0;
    smokeState.pendingReveal = false;
    smokeState.group.visible = false;
    return;
  }
  if (smokeState.phase === nextPhase) {
    smokeState.elapsed = 0;
    if (nextPhase === "idle") {
      stopAllSmokeSfx();
    } else if (nextPhase === "intro") {
      stopSmokeSfx("outro");
      playSmokeSfx("intro");
    } else if (nextPhase === "outro") {
      stopSmokeSfx("intro");
      playSmokeSfx("outro");
      smokeState.outroStage = "gather";
      smokeState.outroHeadFadeStarted = false;
      setHeadVisibilityTarget(1);
    } else if (nextPhase === "active") {
      stopSmokeSfx("intro");
      stopSmokeSfx("outro");
    }
    return;
  }
  if (!smokeState.particles.length && nextPhase !== "idle") {
    initSmokeSystem();
  }
  smokeState.phase = nextPhase;
  smokeState.elapsed = 0;
  smokeState.pendingReveal = false;
  smokeState.activeDissolveComplete = false;
  smokeState.outroStage = nextPhase === "outro" ? "gather" : "idle";
  smokeState.outroHeadFadeStarted = false;

  if (nextPhase === "idle") {
    stopAllSmokeSfx();
    smokeState.group.visible = false;
    smokeState.particles.forEach((particle) => setParticleOpacity(particle, 0));
    if (sessionStatus === "active") {
      setHeadVisibilityTarget(1);
    } else {
      setHeadVisibilityTarget(0);
    }
    resolveSmokeRevealWaiters();
  } else if (nextPhase === "intro") {
    stopSmokeSfx("outro");
    playSmokeSfx("intro");
    smokeState.group.visible = true;
    resetSmokeParticles();
    setHeadVisibilityTarget(0, { immediate: true });
  } else if (nextPhase === "reveal") {
    stopSmokeSfx("outro");
    smokeState.group.visible = true;
    smokeState.particles.forEach((particle) => {
      particle.phaseAnchorAngle = particle.angle;
    });
    resolveSmokeRevealWaiters();
  } else if (nextPhase === "active") {
    stopSmokeSfx("intro");
    stopSmokeSfx("outro");
    smokeState.group.visible = true;
    smokeState.particles.forEach((particle) => {
      particle.phaseAnchorAngle = particle.angle;
    });
    setHeadVisibilityTarget(1);
    resolveSmokeRevealWaiters();
  } else if (nextPhase === "outro") {
    stopSmokeSfx("intro");
    playSmokeSfx("outro");
    smokeState.group.visible = true;
    resetSmokeParticles();
    smokeState.particles.forEach((particle) => {
      particle.outroAnchorAngle = particle.introStartAngle;
      particle.phaseAnchorAngle = particle.introStartAngle;
      particle.angle = particle.introStartAngle;
      setParticleOpacity(particle, 0);
    });
    setHeadVisibilityTarget(1);
    resolveSmokeRevealWaiters();
  }
}

function beginSmokeSequence() {
  if (!smokeState.enabled) {
    return;
  }
  if (!smokeState.particles.length) {
    initSmokeSystem();
  }
  smokeState.sessionActive = sessionStatus === "active";
  smokeState.pendingReveal = false;
  transitionSmokePhase("intro");
}

function waitForSmokeReveal() {
  if (!smokeState.enabled) {
    return Promise.resolve();
  }
  if (smokeState.phase === "reveal" || smokeState.phase === "active") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    smokeState.revealResolvers.add(resolve);
  });
}

function stopSmokeSequence({ immediate = false } = {}) {
  if (!smokeState.enabled) {
    stopAllSmokeSfx();
    resolveSmokeRevealWaiters();
    return;
  }
  if (!smokeState.particles.length) {
    stopAllSmokeSfx();
    smokeState.phase = "idle";
    smokeState.elapsed = 0;
    smokeState.group.visible = false;
    setHeadVisibilityTarget(sessionStatus === "active" ? 1 : 0, {
      immediate: true,
    });
    resolveSmokeRevealWaiters();
    return;
  }
  if (immediate) {
    stopAllSmokeSfx();
    smokeState.phase = "idle";
    smokeState.elapsed = 0;
    smokeState.pendingReveal = false;
    smokeState.group.visible = false;
    smokeState.particles.forEach((particle) => setParticleOpacity(particle, 0));
    setHeadVisibilityTarget(sessionStatus === "active" ? 1 : 0, {
      immediate: true,
    });
    resolveSmokeRevealWaiters();
    return;
  }
  if (smokeState.phase === "idle") {
    stopAllSmokeSfx();
    if (sessionStatus !== "active") {
      setHeadVisibilityTarget(0);
    }
    return;
  }
  if (smokeState.phase !== "outro") {
    transitionSmokePhase("outro");
  }
}

function updateSmoke(dt) {
  if (
    !smokeState.enabled ||
    !smokeState.group ||
    !smokeState.particles.length
  ) {
    return;
  }

  alignSmokeGroupWithTarget();

  if (smokeState.phase === "idle") {
    return;
  }

  const nowSeconds = (performance.now?.() ?? Date.now()) * 0.001;
  const swirlHeight = SMOKE_SWIRL_HEIGHT;
  const swirlWidth = SMOKE_SWIRL_WIDTH;
  const wobbleStrength = SMOKE_WOBBLE_STRENGTH;

  smokeState.elapsed += dt;

  if (smokeState.phase === "intro") {
    const duration = SMOKE_INTRO_DURATION;
    const progress = Math.min(smokeState.elapsed / duration, 1);
    smokeState.particles.forEach((particle) => {
      const releaseProgress = getStaggeredProgress(
        progress,
        particle.introDelay
      );
      const inwardProgress = easeOutCubic(releaseProgress);
      const swirlProgress = easeInOutCubic(releaseProgress);
      const radius = THREE.MathUtils.lerp(
        particle.initialRadius,
        particle.targetRadius,
        inwardProgress
      );
      const clampedRadius = clampRadiusToViewport(radius);
      particle.radius = clampedRadius;
      const outerFraction = THREE.MathUtils.clamp(
        (clampedRadius - particle.targetRadius) /
          Math.max(particle.initialRadius - particle.targetRadius, 0.0001),
        0,
        1
      );
      const centerBoost = 1 - outerFraction;
      const layerAttenuation = 0.58 + 0.42 * (1 - particle.layer);
      const opacity =
        particle.baseOpacity *
        easeOutCubic(releaseProgress) *
        (0.5 + 0.5 * centerBoost) *
        layerAttenuation;
      setParticleOpacity(particle, opacity);
      const swirlAngle =
        particle.introTurns * Math.PI * 2 * swirlProgress * particle.direction;
      const baseBlend = lerpAngle(
        particle.introStartAngle,
        particle.baseAngle,
        swirlProgress
      );
      particle.angle = baseBlend + swirlAngle;
    });
    if (progress >= 1 || smokeState.pendingReveal) {
      transitionSmokePhase("reveal");
    }
  } else if (smokeState.phase === "reveal") {
    const progress = Math.min(smokeState.elapsed / SMOKE_REVEAL_DURATION, 1);
    const eased = easeInOutCubic(progress);
    const swirlProgress = easeInOutCubic(progress);
    smokeState.particles.forEach((particle) => {
      const tightenTarget =
        particle.targetRadius *
        (particle.innerCore
          ? SMOKE_REVEAL_TIGHTEN_FACTOR * 0.85
          : SMOKE_REVEAL_TIGHTEN_FACTOR);
      const tightenRadius = THREE.MathUtils.lerp(
        particle.targetRadius,
        tightenTarget,
        eased
      );
      const clampedRadius = clampRadiusToViewport(tightenRadius);
      particle.radius = clampedRadius;
      const centerReference = particle.innerCore
        ? particle.targetRadius * 1.05
        : particle.targetRadius * 1.2;
      const centerWeight =
        1 - Math.min(clampedRadius / Math.max(centerReference, 1e-4), 1);
      const layerAttenuation = 0.62 + 0.38 * (1 - particle.layer);
      const opacity =
        particle.baseOpacity *
        (0.5 + 0.6 * centerWeight) *
        layerAttenuation *
        (1 - progress * 0.32);
      setParticleOpacity(particle, opacity);
      const swirlAngle =
        particle.revealTurns * Math.PI * 2 * swirlProgress * particle.direction;
      particle.angle = particle.phaseAnchorAngle + swirlAngle;
    });
    setHeadVisibilityTarget(Math.max(headVisibilityState.target, eased));
    if (progress >= 1) {
      transitionSmokePhase("active");
      smokeState.particles.forEach((particle) => {
        particle.phaseAnchorAngle = particle.angle;
      });
    }
  } else if (smokeState.phase === "active") {
    if (smokeState.activeDissolveComplete) {
      return;
    }
    const fadeDuration = SMOKE_ACTIVE_DISSIPATE_DURATION;
    const progress = Math.min(smokeState.elapsed / fadeDuration, 1);
    const eased = easeOutCubic(progress);
    smokeState.particles.forEach((particle) => {
      const radius = THREE.MathUtils.lerp(
        particle.targetRadius,
        particle.outroTargetRadius ?? particle.targetRadius * 1.6,
        eased
      );
      const clampedRadius = clampRadiusToViewport(radius);
      particle.radius = clampedRadius;
      const layerAttenuation = 0.65 + 0.35 * (1 - particle.layer);
      const opacity =
        particle.baseOpacity * (1 - eased) * 0.35 * layerAttenuation;
      setParticleOpacity(particle, opacity);
    });
    if (progress >= 1) {
      smokeState.activeDissolveComplete = true;
      smokeState.particles.forEach((particle) =>
        setParticleOpacity(particle, 0)
      );
      smokeState.group.visible = false;
      return;
    }
  } else if (smokeState.phase === "outro") {
    const gatherDuration = SMOKE_OUTRO_GATHER_DURATION;
    const puffDuration = SMOKE_OUTRO_PUFF_DURATION;
    const gatherProgress = Math.min(smokeState.elapsed / gatherDuration, 1);
    const puffProgress =
      smokeState.elapsed <= gatherDuration
        ? 0
        : Math.min(
            (smokeState.elapsed - gatherDuration) /
              Math.max(puffDuration, 1e-5),
            1
          );

    if (smokeState.elapsed < gatherDuration) {
      if (smokeState.outroStage !== "gather") {
        smokeState.outroStage = "gather";
      }
      smokeState.particles.forEach((particle) => {
        const releaseProgress = getStaggeredProgress(
          gatherProgress,
          particle.outroDelay
        );
        const inwardProgress = easeOutCubic(releaseProgress);
        const swirlProgress = easeInOutCubic(releaseProgress);
        const radius = THREE.MathUtils.lerp(
          particle.initialRadius,
          particle.targetRadius,
          inwardProgress
        );
        const clampedRadius = clampRadiusToViewport(radius);
        particle.radius = clampedRadius;
        const outerFraction = THREE.MathUtils.clamp(
          (clampedRadius - particle.targetRadius) /
            Math.max(particle.initialRadius - particle.targetRadius, 0.0001),
          0,
          1
        );
        const centerBoost = 1 - outerFraction;
        const layerAttenuation = 0.6 + 0.4 * (1 - particle.layer);
        const opacity =
          particle.baseOpacity *
          easeOutCubic(releaseProgress) *
          (0.55 + 0.45 * centerBoost) *
          layerAttenuation;
        setParticleOpacity(particle, opacity);
        const swirlAngle =
          particle.outroGatherTurns *
          Math.PI *
          2 *
          swirlProgress *
          particle.direction;
        const baseBlend = lerpAngle(
          particle.introStartAngle,
          particle.baseAngle,
          swirlProgress
        );
        particle.angle = baseBlend + swirlAngle;
      });
    } else {
      if (smokeState.outroStage !== "puff") {
        smokeState.outroStage = "puff";
        smokeState.particles.forEach((particle) => {
          particle.outroAnchorAngle = particle.angle;
          particle.outroStartRadius = particle.radius;
        });
        if (!smokeState.outroHeadFadeStarted) {
          smokeState.outroHeadFadeStarted = true;
          setHeadVisibilityTarget(0);
        }
      }
      const swirlProgress = easeInOutCubic(puffProgress);
      smokeState.particles.forEach((particle) => {
        const releaseProgress = getStaggeredProgress(
          puffProgress,
          particle.outroPuffDelay
        );
        const radiusProgress = easeOutCubic(releaseProgress);
        const radius = THREE.MathUtils.lerp(
          particle.outroStartRadius ?? particle.targetRadius,
          particle.outroTargetRadius ?? particle.initialRadius * 1.45,
          radiusProgress
        );
        const clampedRadius = clampRadiusToViewport(radius);
        particle.radius = clampedRadius;
        const fade = 1 - radiusProgress;
        const layerAttenuation = 0.6 + 0.4 * (1 - particle.layer);
        const opacity = particle.baseOpacity * fade * 0.42 * layerAttenuation;
        setParticleOpacity(particle, opacity);
        const swirlAngle =
          particle.outroPuffTurns *
          Math.PI *
          2 *
          swirlProgress *
          particle.direction;
        const anchor = particle.outroAnchorAngle ?? particle.baseAngle;
        particle.angle = anchor + swirlAngle;
      });
      if (puffProgress >= 1) {
        transitionSmokePhase("idle");
        return;
      }
    }
  }

  smokeState.particles.forEach((particle) => {
    if (
      smokeState.phase !== "intro" &&
      smokeState.phase !== "reveal" &&
      smokeState.phase !== "outro"
    ) {
      particle.angle += particle.angularVelocity * dt;
    }
    particle.spin += particle.spinSpeed * dt;

    const radius = particle.radius;
    const x = Math.cos(particle.angle) * radius * swirlWidth;
    const y = Math.sin(particle.angle) * radius * swirlHeight;
    let clampedX = x;
    let clampedY = y;
    if (smokeState.safeMaxRadius) {
      const scale = Math.max(smokeState.group?.scale?.x || 1, 1e-6);
      const limitWorld = smokeState.safeMaxRadius * 0.98;
      const worldRadius = Math.hypot(x, y) * scale;
      if (worldRadius > limitWorld) {
        const k = limitWorld / Math.max(worldRadius, 1e-6);
        clampedX *= k;
        clampedY *= k;
      }
    }
    const wobble =
      Math.sin(nowSeconds * 0.7 + particle.phaseOffset) * wobbleStrength;
    particle.mesh.position.set(clampedX, clampedY + wobble, particle.randomZ);
    particle.mesh.quaternion.copy(camera.quaternion);
    particle.mesh.rotateZ(particle.spin);
  });
}

function handleSessionActivated() {
  smokeState.sessionActive = true;
  smokeState.pendingReveal = false;
  if (!smokeState.enabled) {
    setHeadVisibilityTarget(1);
    return;
  }
  if (!smokeState.particles.length) {
    initSmokeSystem();
  }
  if (smokeState.phase === "intro") {
    if (smokeState.elapsed >= SMOKE_INTRO_DURATION * 0.85) {
      transitionSmokePhase("reveal");
    } else {
      smokeState.pendingReveal = true;
    }
  } else if (smokeState.phase === "outro") {
    transitionSmokePhase("active");
  } else if (smokeState.phase === "idle") {
    setHeadVisibilityTarget(1);
  }
}

function handleSessionTerminated({ immediate = false } = {}) {
  smokeState.sessionActive = false;
  smokeState.pendingReveal = false;
  if (!smokeState.enabled) {
    if (assistantSettings.enableSmokeAnimation === false) {
      setHeadVisibilityTarget(1, { immediate: true });
    }
    return;
  }
  stopSmokeSequence({ immediate });
}

function applySmokeSettings() {
  smokeState.enabled = isSmokeAnimationEnabled();
  smokeState.sessionActive = sessionStatus === "active";
  smokeState.pendingReveal = false;

  if (!smokeState.enabled) {
    stopSmokeSequence({ immediate: true });
    setHeadVisibilityTarget(1, { immediate: true });
    return;
  }

  if (!smokeState.particles.length) {
    initSmokeSystem();
  }

  if (sessionStatus !== "active" && smokeState.phase === "idle") {
    setHeadVisibilityTarget(0, { immediate: true });
  }
}

const amplitudeState = {
  float: null,
  byte: null,
  value: 0,
};

const headAnimationState = {
  basePosition: new THREE.Vector3(),
  baseQuaternion: new THREE.Quaternion(),
  hoverPhase: Math.random() * Math.PI * 2,
  timeUntilNextNod: randomInRange(1.6, 3.2),
  activeNod: false,
  nodProgress: 0,
  nodDuration: 1.6,
  nodDirection: 1,
  targetPitch: 0,
  targetYaw: 0,
  targetRoll: 0,
  currentPitch: 0,
  currentYaw: 0,
  currentRoll: 0,
  smoothedVolume: 0,
};

const tempEuler = new THREE.Euler();
const tempQuaternion = new THREE.Quaternion();
const tempTarget = new THREE.Vector3();

function scheduleNextBlink(referenceTime) {
  const fallbackNow =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const base = Number.isFinite(referenceTime) ? referenceTime : fallbackNow;
  blinkState.nextBlinkTime =
    base + randomInRange(BLINK_INTERVAL_MIN_MS, BLINK_INTERVAL_MAX_MS);
}

function configureBlinkDurations({ fast } = {}) {
  if (fast) {
    blinkState.closeDuration = randomInRange(...BLINK_FAST_CLOSE_RANGE);
    blinkState.openDuration = randomInRange(...BLINK_FAST_OPEN_RANGE);
    blinkState.holdDuration = randomInRange(...BLINK_FAST_HOLD_RANGE);
  } else {
    blinkState.closeDuration = randomInRange(...BLINK_SLOW_CLOSE_RANGE);
    blinkState.openDuration = randomInRange(...BLINK_SLOW_OPEN_RANGE);
    blinkState.holdDuration = randomInRange(...BLINK_SLOW_HOLD_RANGE);
  }
}

function beginBlinkClosing() {
  configureBlinkDurations({ fast: blinkState.fastNextBlink });
  blinkState.fastNextBlink = false;
  blinkState.phase = "closing";
}

function startBlinkSequence(timestamp) {
  blinkState.remainingBlinks = Math.random() < BLINK_DOUBLE_CHANCE ? 2 : 1;
  blinkState.fastNextBlink = false;
  blinkState.nextBlinkTime = null;
  blinkState.value = 0;
  beginBlinkClosing();
}

function updateBlink(timestamp, dt) {
  if (!Number.isFinite(timestamp)) {
    return;
  }

  if (blinkState.phase === "idle") {
    if (blinkState.nextBlinkTime == null) {
      scheduleNextBlink(timestamp);
    } else if (timestamp >= blinkState.nextBlinkTime) {
      startBlinkSequence(timestamp);
    }
  }

  switch (blinkState.phase) {
    case "idle":
      blinkState.value = 0;
      break;
    case "closing": {
      blinkState.value = clamp01(
        blinkState.value + dt / blinkState.closeDuration
      );
      if (blinkState.value >= 1) {
        blinkState.phase = "closed";
        blinkState.holdTimer = blinkState.holdDuration;
        blinkState.remainingBlinks = Math.max(
          0,
          blinkState.remainingBlinks - 1
        );
      }
      break;
    }
    case "closed": {
      blinkState.holdTimer -= dt;
      if (blinkState.holdTimer <= 0) {
        blinkState.phase = "opening";
      }
      break;
    }
    case "opening": {
      blinkState.value = clamp01(
        blinkState.value - dt / blinkState.openDuration
      );
      if (blinkState.value <= 0) {
        if (blinkState.remainingBlinks > 0) {
          blinkState.fastNextBlink = true;
          blinkState.phase = "between";
          blinkState.betweenTimer = randomInRange(...BLINK_DOUBLE_GAP_RANGE);
        } else {
          blinkState.phase = "idle";
          blinkState.value = 0;
          scheduleNextBlink(timestamp);
        }
      }
      break;
    }
    case "between": {
      blinkState.betweenTimer -= dt;
      if (blinkState.betweenTimer <= 0) {
        beginBlinkClosing();
      }
      break;
    }
    default:
      blinkState.phase = "idle";
      blinkState.value = 0;
      scheduleNextBlink(timestamp);
      break;
  }
}

const canvasContainer = document.getElementById("canvas-container");
const statusElement = document.getElementById("status");
const remoteAudioElement = document.getElementById("assistant-audio");
let hideStatusTimeout = null;

let assistantSettings = ensureAssistantSettings(loadAssistantSettings());
const headMaterialData = new Map();
const initialHeadVisibility =
  assistantSettings.enableSmokeAnimation === false ? 1 : 0;
const headVisibilityState = {
  current: initialHeadVisibility,
  target: initialHeadVisibility,
  lastApplied: initialHeadVisibility,
};
const visemeState = createVisemeState(VISEME_NAMES);
const visemeTimers = new Set();
const visemeWeights = new Map(VISEME_NAMES.map((name) => [name, 0]));
let visemeConfig = mergeWithDefaultConfig(loadVisemeConfig());

const lipsync = new Lipsync({ fftSize: 2048, historySize: 12 });
let lipsyncSourceNode = null;
let lipsyncAnalysisStream = null;

let recognition = null;
let peerConnection = null;
let dataChannel = null;
let localStream = null;
let sessionStatus = "idle";
let sessionEndTimer = null;

function disconnectLipsyncStream() {
  if (lipsyncSourceNode) {
    try {
      lipsyncSourceNode.disconnect();
    } catch (error) {
      console.warn("Failed to disconnect lipsync source", error);
    }
    lipsyncSourceNode = null;
  }
  if (lipsyncAnalysisStream) {
    lipsyncAnalysisStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.warn("Failed to stop cloned audio track", error);
      }
    });
    lipsyncAnalysisStream = null;
  }
  amplitudeState.value = 0;
  headAnimationState.smoothedVolume = 0;
  headAnimationState.targetPitch = 0;
  headAnimationState.targetYaw = 0;
  headAnimationState.targetRoll = 0;
}

function connectStreamToLipsync(stream) {
  if (!stream || !lipsync?.audioContext) {
    return;
  }

  const audioTracks =
    typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];
  if (!audioTracks.length) {
    return;
  }

  disconnectLipsyncStream();

  try {
    const context = lipsync.audioContext;
    if (context?.state === "suspended") {
      context.resume().catch(() => {});
    }

    lipsyncAnalysisStream = new MediaStream();
    audioTracks.forEach((track) => {
      try {
        lipsyncAnalysisStream.addTrack(track.clone());
      } catch (error) {
        console.warn("Failed to clone assistant audio track", error);
      }
    });

    if (!lipsyncAnalysisStream.getAudioTracks().length) {
      lipsyncAnalysisStream = null;
      return;
    }

    lipsyncSourceNode = context.createMediaStreamSource(lipsyncAnalysisStream);
    lipsyncSourceNode.connect(lipsync.analyser);
  } catch (error) {
    console.warn("Failed to attach assistant audio to lipsync analyser", error);
    disconnectLipsyncStream();
  }
}

function refreshVisemeConfig() {
  visemeConfig = mergeWithDefaultConfig(loadVisemeConfig());
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
camera.position.set(0, 1.4, 3.4);
camera.lookAt(0, 1.4, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setPixelRatio(window.devicePixelRatio || 1);
canvasContainer.appendChild(renderer.domElement);

const smokeState = {
  enabled: assistantSettings.enableSmokeAnimation !== false,
  group: new THREE.Group(),
  particles: [],
  phase: "idle",
  elapsed: 0,
  sessionActive: false,
  pendingReveal: false,
  revealResolvers: new Set(),
  activeDissolveComplete: false,
  outroStage: "idle",
  outroHeadFadeStarted: false,
  safeMaxRadius: null,
};
smokeState.group.visible = false;
smokeState.group.renderOrder = 50;
smokeState.group.name = "SmokeLayer";
scene.add(smokeState.group);

const smokeEllipse = {
  rx: 0.6,
  ry: 0.6,
  centerY: 0,
};

const spotTarget = new THREE.Object3D();
spotTarget.position.set(0, 1.4, 0);
scene.add(spotTarget);

const spotLight = new THREE.SpotLight(0xfff1e0, 0);
spotLight.castShadow = true;
spotLight.shadow.mapSize.set(2048, 2048);
spotLight.shadow.bias = -0.00004;
spotLight.penumbra = 0.45;
spotLight.decay = 2.1;
spotLight.angle = THREE.MathUtils.degToRad(38);
spotLight.distance = 10;
spotLight.target = spotTarget;
scene.add(spotLight);

const hemisphereLight = new THREE.HemisphereLight(0x1f2a3f, 0x110806, 0.6);
hemisphereLight.intensity = 0.6;
scene.add(hemisphereLight);

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

initSmokeSystem();

const loader = new FBXLoader();
let currentModel = null;
let activeBlendshapeMap = new Map();
const currentModelCenter = new THREE.Vector3(0, 1.4, 0);
const currentModelSize = new THREE.Vector3(1, 1, 1);
const tempBox = new THREE.Box3();

function setStatus(message, type = "info", autoHideMs = null) {
  if (!statusElement) {
    return;
  }
  if (hideStatusTimeout) {
    clearTimeout(hideStatusTimeout);
    hideStatusTimeout = null;
  }
  statusElement.textContent = message;
  statusElement.classList.remove("hidden", "error");
  if (type === "error") {
    statusElement.classList.add("error");
  }
  if (autoHideMs && autoHideMs > 0) {
    hideStatusTimeout = window.setTimeout(() => {
      hideStatus();
    }, autoHideMs);
  }
}

function hideStatus() {
  if (hideStatusTimeout) {
    clearTimeout(hideStatusTimeout);
    hideStatusTimeout = null;
  }
  statusElement?.classList.add("hidden");
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(min, max, value) {
  if (min === max) {
    return value < min ? 0 : 1;
  }
  const clamped = clamp01((value - min) / (max - min));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerpAngle(start, end, t) {
  const clampedT = clamp01(t);
  const delta =
    THREE.MathUtils.euclideanModulo(end - start + Math.PI, Math.PI * 2) -
    Math.PI;
  return start + delta * clampedT;
}

function getStaggeredProgress(progress, offset) {
  const clampedProgress = clamp01(progress);
  const clampedOffset = clamp01(offset || 0);
  if (clampedProgress <= clampedOffset) {
    return 0;
  }
  const span = Math.max(1 - clampedOffset, 1e-5);
  return clamp01((clampedProgress - clampedOffset) / span);
}

function normalizeVisemeName(rawName) {
  if (!rawName) {
    return null;
  }
  const direct = String(rawName).trim();
  if (!direct) {
    return null;
  }
  const normalized = direct.replace(/[^a-z0-9_]/gi, "").toUpperCase();
  if (VISEME_NAMES.includes(normalized)) {
    return normalized;
  }
  const mapped = PHONEME_TO_VISEME[direct.toLowerCase()];
  return mapped && VISEME_NAMES.includes(mapped) ? mapped : null;
}

function getAnimationSettings() {
  return assistantSettings.animation || DEFAULT_ASSISTANT_SETTINGS.animation;
}

function getVisemeSettings() {
  const animation = getAnimationSettings();
  return animation?.viseme || DEFAULT_ASSISTANT_SETTINGS.animation.viseme;
}

function getLightingSettings() {
  return assistantSettings.lighting || DEFAULT_ASSISTANT_SETTINGS.lighting;
}

function setVisemeTarget(name, target, holdMs = DEFAULT_VISEME_HOLD_MS) {
  const state = visemeState[name];
  if (!state) {
    return;
  }
  state.target = clamp01(target);
  state.lastActivatedAt = performance.now();
  state.holdMs = Math.max(holdMs, 60);
}

function scheduleVisemeActivation(name, startMs, endMs, strength = 1) {
  const visemeSettings = getVisemeSettings();
  const delayOffset = Math.max(0, visemeSettings.delayMs || 0);
  const startDelay = Math.max(0, startMs + delayOffset);
  const releaseDelay = Math.max(startDelay, Math.max(0, endMs + delayOffset));
  const holdDuration = Math.max(
    visemeSettings.holdMs || DEFAULT_VISEME_HOLD_MS,
    releaseDelay - startDelay
  );
  const amplitude = clamp01(strength);

  const startHandle = window.setTimeout(() => {
    setVisemeTarget(name, amplitude, holdDuration);
  }, startDelay);

  const endHandle = window.setTimeout(() => {
    setVisemeTarget(name, 0, visemeSettings.holdMs || DEFAULT_VISEME_HOLD_MS);
  }, releaseDelay);

  visemeTimers.add(startHandle);
  visemeTimers.add(endHandle);
}

function clearVisemeTimers() {
  visemeTimers.forEach((handle) => window.clearTimeout(handle));
  visemeTimers.clear();
}

function scheduleVisemeEvents(events) {
  if (!Array.isArray(events) || !events.length) {
    return;
  }
  events.forEach((entry) => {
    const name = normalizeVisemeName(
      entry?.viseme ?? entry?.value ?? entry?.code ?? entry?.label
    );
    if (!name) {
      return;
    }
    const startSeconds = Number(
      entry?.start ?? entry?.time ?? entry?.offset ?? 0
    );
    const startMs =
      Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0) * 1000;
    const endSecondsRaw = entry?.end ?? entry?.finish ?? entry?.stop;
    const endSeconds = Number(endSecondsRaw);
    const durationSecondsRaw = entry?.duration ?? entry?.length;
    const durationSeconds = Number(durationSecondsRaw);
    let endMs;
    if (Number.isFinite(endSeconds)) {
      endMs = Math.max(0, endSeconds) * 1000;
    } else if (Number.isFinite(durationSeconds)) {
      endMs = startMs + Math.max(0, durationSeconds) * 1000;
    } else {
      endMs = startMs + DEFAULT_VISEME_HOLD_MS;
    }
    const strength = clamp01(
      entry?.strength ?? entry?.amplitude ?? entry?.score ?? 1
    );
    scheduleVisemeActivation(name, startMs, endMs, strength);
  });
}

function ensureAmplitudeBuffers(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return;
  }
  if (!amplitudeState.float || amplitudeState.float.length !== size) {
    amplitudeState.float = new Float32Array(size);
  }
  if (!amplitudeState.byte || amplitudeState.byte.length !== size) {
    amplitudeState.byte = new Uint8Array(size);
  }
}

function sampleAssistantAmplitude() {
  const analyser = lipsync?.analyser;
  if (!analyser) {
    return 0;
  }
  const { fftSize } = analyser;
  ensureAmplitudeBuffers(fftSize);
  if (!amplitudeState.float || !amplitudeState.byte) {
    return 0;
  }
  try {
    analyser.getFloatTimeDomainData(amplitudeState.float);
    let sumSquares = 0;
    for (let i = 0; i < amplitudeState.float.length; i += 1) {
      const sample = amplitudeState.float[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / amplitudeState.float.length);
    const normalized = clamp01((rms - 0.02) / 0.35);
    amplitudeState.value = normalized;
    return normalized;
  } catch (error) {
    try {
      analyser.getByteTimeDomainData(amplitudeState.byte);
    } catch (innerError) {
      return 0;
    }
    let sumSquares = 0;
    for (let i = 0; i < amplitudeState.byte.length; i += 1) {
      const centered = amplitudeState.byte[i] / 128 - 1;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / amplitudeState.byte.length);
    const normalized = clamp01((rms - 0.05) / 0.35);
    amplitudeState.value = normalized;
    return normalized;
  }
}

function resetHeadAnimationPose() {
  if (!currentModel) {
    return;
  }
  headAnimationState.basePosition.copy(currentModel.position);
  headAnimationState.baseQuaternion.copy(currentModel.quaternion);
  headAnimationState.hoverPhase = Math.random() * Math.PI * 2;
  headAnimationState.timeUntilNextNod = randomInRange(1.6, 3.2);
  headAnimationState.activeNod = false;
  headAnimationState.nodProgress = 0;
  headAnimationState.targetPitch = 0;
  headAnimationState.targetYaw = 0;
  headAnimationState.targetRoll = 0;
  headAnimationState.currentPitch = 0;
  headAnimationState.currentYaw = 0;
  headAnimationState.currentRoll = 0;
}

function updateHeadAnimation(dt, amplitude, headSettings) {
  if (!currentModel || !headSettings) {
    return;
  }

  const hoverAmount = clamp01(headSettings.hoverAmount ?? 0);
  let hoverOffsetX = 0;
  let hoverOffsetY = 0;
  let hoverOffsetZ = 0;
  if (hoverAmount > 0) {
    headAnimationState.hoverPhase += Math.max(dt, 0) * (0.4 + amplitude * 0.9);
    const hoverDistance = hoverAmount * 0.06;
    hoverOffsetY = Math.sin(headAnimationState.hoverPhase) * hoverDistance;
    hoverOffsetX =
      Math.cos(headAnimationState.hoverPhase * 0.5) * hoverDistance * 0.35;
    hoverOffsetZ =
      Math.sin(headAnimationState.hoverPhase * 0.3) * hoverDistance * 0.4;
  }

  let nodOffsetX = 0;
  let nodYawContribution = 0;
  let nodPitchContribution = 0;
  let nodRollContribution = 0;

  if (headSettings.enableRandomNods) {
    const nodSpeed = 0.6 + amplitude * 0.9;
    if (!headAnimationState.activeNod) {
      headAnimationState.timeUntilNextNod -= dt * nodSpeed;
      if (headAnimationState.timeUntilNextNod <= 0) {
        headAnimationState.activeNod = true;
        headAnimationState.nodProgress = 0;
        headAnimationState.nodDuration = randomInRange(1.1, 2.1);
        headAnimationState.nodDirection = Math.random() < 0.5 ? -1 : 1;
      }
    }
    if (headAnimationState.activeNod) {
      headAnimationState.nodProgress += dt / headAnimationState.nodDuration;
      const progress = Math.min(headAnimationState.nodProgress, 1);
      const eased = Math.sin(Math.PI * progress);
      const baseIntensity = clamp01(headSettings.nodIntensity ?? 0);
      const volumeBoost =
        clamp01(headSettings.volumeInfluence ?? 0) * amplitude;
      const nodIntensity = clamp01(baseIntensity + volumeBoost) * 0.7;
      nodYawContribution =
        THREE.MathUtils.degToRad(11 * nodIntensity) *
        eased *
        headAnimationState.nodDirection;
      nodPitchContribution =
        THREE.MathUtils.degToRad(1.8 * nodIntensity) * eased;
      nodRollContribution =
        THREE.MathUtils.degToRad(2.6 * nodIntensity) *
        eased *
        -headAnimationState.nodDirection;
      nodOffsetX =
        headAnimationState.nodDirection * nodIntensity * 0.018 * eased;
      if (progress >= 1) {
        headAnimationState.activeNod = false;
        headAnimationState.timeUntilNextNod = randomInRange(1.8, 3.4);
      }
    }
  } else {
    headAnimationState.activeNod = false;
    headAnimationState.timeUntilNextNod = Math.max(
      headAnimationState.timeUntilNextNod,
      1.5
    );
  }

  const finalOffsetX = hoverOffsetX + nodOffsetX;
  const finalOffsetY = hoverOffsetY;
  const finalOffsetZ = hoverOffsetZ;

  currentModel.position.set(
    headAnimationState.basePosition.x + finalOffsetX,
    headAnimationState.basePosition.y + finalOffsetY,
    headAnimationState.basePosition.z + finalOffsetZ
  );

  const BASE_ALIGNMENT_DISTANCE = 0.04;
  const horizontalFraction = THREE.MathUtils.clamp(
    BASE_ALIGNMENT_DISTANCE > 0 ? finalOffsetX / BASE_ALIGNMENT_DISTANCE : 0,
    -1,
    1
  );
  const verticalFraction = THREE.MathUtils.clamp(
    BASE_ALIGNMENT_DISTANCE > 0 ? finalOffsetY / BASE_ALIGNMENT_DISTANCE : 0,
    -1,
    1
  );

  const alignmentYaw = THREE.MathUtils.degToRad(-9 * horizontalFraction);
  const alignmentPitch = THREE.MathUtils.degToRad(-3.2 * verticalFraction);
  const alignmentRoll = THREE.MathUtils.degToRad(3.5 * horizontalFraction);

  headAnimationState.targetPitch = alignmentPitch + nodPitchContribution;
  headAnimationState.targetYaw = alignmentYaw + nodYawContribution;
  headAnimationState.targetRoll = alignmentRoll + nodRollContribution;

  const smoothing = 1 - Math.exp(-Math.max(dt, 0) * 9.5);
  headAnimationState.currentPitch +=
    (headAnimationState.targetPitch - headAnimationState.currentPitch) *
    smoothing;
  headAnimationState.currentYaw +=
    (headAnimationState.targetYaw - headAnimationState.currentYaw) * smoothing;
  headAnimationState.currentRoll +=
    (headAnimationState.targetRoll - headAnimationState.currentRoll) *
    smoothing;

  tempEuler.set(
    headAnimationState.currentPitch,
    headAnimationState.currentYaw,
    headAnimationState.currentRoll,
    "XYZ"
  );
  tempQuaternion.setFromEuler(tempEuler);
  currentModel.quaternion.copy(headAnimationState.baseQuaternion);
  currentModel.quaternion.multiply(tempQuaternion);
}

function accumulateBlendshape(totals, shape, value) {
  const amount = clamp01(value);
  if (!amount) {
    return;
  }
  const current = totals.get(shape) || 0;
  totals.set(shape, Math.max(current, amount));
}

function applyExpressionTargets(totals, amplitude, expressionSettings) {
  if (!expressionSettings) {
    return;
  }

  if (expressionSettings.enableEyebrows) {
    const base = clamp01(expressionSettings.eyebrowIntensity ?? 0);
    const sensitivity = clamp01(expressionSettings.eyebrowVolumeInfluence ?? 0);
    const eyebrowValue = clamp01(base * 0.35 + base * sensitivity * amplitude);
    accumulateBlendshape(totals, "browInnerUp", eyebrowValue);
    accumulateBlendshape(totals, "browOuterUpLeft", eyebrowValue * 0.85);
    accumulateBlendshape(totals, "browOuterUpRight", eyebrowValue * 0.85);
  }

  const happiness = clamp01(expressionSettings.happiness ?? 0);
  if (happiness > 0) {
    const smileValue = clamp01(happiness * 0.5 + happiness * 0.6 * amplitude);
    accumulateBlendshape(totals, "mouthSmileLeft", smileValue);
    accumulateBlendshape(totals, "mouthSmileRight", smileValue);
    accumulateBlendshape(totals, "cheekSquintLeft", smileValue * 0.6);
    accumulateBlendshape(totals, "cheekSquintRight", smileValue * 0.6);
    accumulateBlendshape(totals, "mouthPressLeft", smileValue * 0.25);
    accumulateBlendshape(totals, "mouthPressRight", smileValue * 0.25);
  }
}

function dampVisemeValues(dt, visemeSettings) {
  const smoothingAmount = clamp01(visemeSettings?.smoothing ?? 0.6);
  const smoothingRate = 4 + smoothingAmount * 18;
  const smoothing = 1 - Math.exp(-dt * smoothingRate);
  const now = performance.now();
  VISEME_NAMES.forEach((name) => {
    const state = visemeState[name];
    if (!state) {
      return;
    }
    if (state.target > 0 && now - state.lastActivatedAt > state.holdMs) {
      state.target = 0;
    }
    state.value += (state.target - state.value) * smoothing;
    if (state.value < 1e-3 && state.target === 0) {
      state.value = 0;
    }
  });
}

function updateVisemeWeights(dt, visemeSettings) {
  if (!Number.isFinite(dt) || dt <= 0) {
    dt = 0;
  }

  dampVisemeValues(dt, visemeSettings);

  let vowelActive = false;
  VISEME_NAMES.forEach((name) => {
    const state = visemeState[name];
    const value = clamp01(state?.value ?? 0);
    visemeWeights.set(name, value);
    if (!vowelActive && VOWEL_VISEMES.includes(name) && value > 0.25) {
      vowelActive = true;
    }
  });

  try {
    if (lipsync && lipsync.viseme) {
      const { amplitude, targets } = getVisemeTargets({
        viseme: lipsync.viseme,
        features: lipsync.features,
        state: lipsync.state,
      });

      let lipsyncVowelActive = amplitude > 0.2;
      if (targets instanceof Map) {
        targets.forEach((value, name) => {
          if (!value) {
            return;
          }
          const current = visemeWeights.get(name) || 0;
          const blended = Math.max(current, value);
          visemeWeights.set(name, clamp01(blended));
          if (
            !lipsyncVowelActive &&
            VOWEL_VISEMES.includes(name) &&
            blended > 0.25
          ) {
            lipsyncVowelActive = true;
          }
        });
      }

      vowelActive = vowelActive || lipsyncVowelActive;
    }
  } catch (error) {
    console.warn("Failed to compute lipsync viseme targets", error);
  }

  return { vowelActive };
}

function resetVisemes() {
  clearVisemeTimers();
  const visemeSettings = getVisemeSettings();
  const defaultHold = Math.max(
    visemeSettings.holdMs || DEFAULT_VISEME_HOLD_MS,
    60
  );
  VISEME_NAMES.forEach((name) => {
    const state = visemeState[name];
    if (!state) {
      return;
    }
    state.value = 0;
    state.target = 0;
    state.lastActivatedAt = 0;
    state.holdMs = defaultHold;
  });
}

function getAssistantName() {
  return assistantSettings.name?.trim() || DEFAULT_ASSISTANT_SETTINGS.name;
}

function getAssistantHotword() {
  const hotword = assistantSettings.hotword?.trim();
  if (hotword) {
    return hotword;
  }
  const name = assistantSettings.name?.trim();
  if (name) {
    return name;
  }
  return DEFAULT_ASSISTANT_SETTINGS.hotword;
}

function getHotwordPhrase() {
  return `Hey ${getAssistantHotword()}`;
}

function getAssistantInitialPrompt() {
  const template =
    assistantSettings.initialPrompt?.trim() ||
    DEFAULT_ASSISTANT_SETTINGS.initialPrompt;
  const replacements = {
    name: getAssistantName(),
    hotword: getAssistantHotword(),
  };
  const processed = template.replace(
    /\{\{\s*(name|hotword)\s*\}\}/gi,
    (_, key) => replacements[key.toLowerCase()] || ""
  );
  return processed.trim() || DEFAULT_ASSISTANT_SETTINGS.initialPrompt;
}

function refreshAssistantSettings() {
  assistantSettings = ensureAssistantSettings(loadAssistantSettings());
  applyLightingSettingsToScene();
  applySmokeSettings();
  if (sessionStatus === "active") {
    sendSessionUpdate();
  }
  headAnimationState.timeUntilNextNod = randomInRange(1.6, 3.2);
}

function clearSessionEndTimer() {
  if (sessionEndTimer) {
    clearTimeout(sessionEndTimer);
    sessionEndTimer = null;
  }
}

function handleConnectionStateChange() {
  if (!peerConnection) {
    return;
  }
  const state = peerConnection.connectionState;
  if (state === "failed") {
    endRealtimeSession({
      reason: "error",
      message: "Assistant connection failed.",
    });
  } else if (state === "disconnected") {
    endRealtimeSession({ reason: "error", message: "Assistant disconnected." });
  }
}

function sendSessionUpdate() {
  if (!dataChannel || dataChannel.readyState !== "open") {
    return;
  }
  const payload = {
    type: "session.update",
    session: {
      voice: assistantSettings.voice || DEFAULT_ASSISTANT_SETTINGS.voice,
      instructions: getAssistantInitialPrompt(),
      tools: [],
    },
  };
  try {
    dataChannel.send(JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to send session update", error);
  }
}

function processAssistantEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }
  switch (event.type) {
    case "viseme":
      scheduleVisemeEvents([event]);
      break;
    case "visemes":
      scheduleVisemeEvents(event.visemes);
      break;
    case "session.disconnected":
      endRealtimeSession({
        reason: "error",
        message: event.reason || "Assistant disconnected.",
      });
      break;
    case "error":
      endRealtimeSession({
        reason: "error",
        message: event.message || event.error || "Assistant error.",
      });
      break;
    default:
      break;
  }
}

function handleDataChannelMessage(event) {
  if (!event?.data) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch (error) {
    console.warn("Failed to parse assistant message", error);
    return;
  }
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (payload.type === "response.output") {
    const outputs = Array.isArray(payload.output) ? payload.output : [];
    outputs.forEach(processAssistantEvent);
    return;
  }
  processAssistantEvent(payload);
}

function handleDataChannelOpen() {
  sendSessionUpdate();
}

async function startRealtimeSession() {
  if (sessionStatus === "connecting" || sessionStatus === "active") {
    return;
  }
  refreshAssistantSettings();
  if (!assistantSettings.apiKey) {
    setStatus(
      "Add your realtime-enabled OpenAI API key in Settings before speaking.",
      "error"
    );
    return;
  }

  sessionStatus = "connecting";
  clearSessionEndTimer();
  resetVisemes();
  disconnectLipsyncStream();
  setStatus("Hotword detected. Connecting to the assistant…");
  let revealPromise = null;
  if (isSmokeAnimationEnabled()) {
    beginSmokeSequence();
    revealPromise = waitForSmokeReveal();
  } else {
    setHeadVisibilityTarget(1);
  }

  if (revealPromise) {
    try {
      await revealPromise;
    } catch (error) {
      console.warn("Smoke reveal wait failed", error);
    }
    if (sessionStatus !== "connecting") {
      return;
    }
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (error) {
    console.error("Microphone access failed", error);
    sessionStatus = "idle";
    handleSessionTerminated({ immediate: true });
    setStatus(
      error?.message || "Microphone access is required for the assistant.",
      "error"
    );
    return;
  }

  peerConnection = new RTCPeerConnection();
  localStream
    .getTracks()
    .forEach((track) => peerConnection.addTrack(track, localStream));
  peerConnection.onconnectionstatechange = handleConnectionStateChange;
  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream || !remoteAudioElement) {
      return;
    }
    try {
      remoteAudioElement.srcObject = stream;
      if (remoteAudioElement.muted) {
        try {
          remoteAudioElement.muted = false;
          remoteAudioElement.defaultMuted = false;
          remoteAudioElement.removeAttribute("muted");
        } catch (error) {
          console.warn("Failed to unmute assistant audio element", error);
        }
      }
      connectStreamToLipsync(stream);
      const playPromise = remoteAudioElement.play();
      if (playPromise?.catch) {
        playPromise.catch((error) =>
          console.warn("Assistant audio playback blocked", error)
        );
      }
    } catch (error) {
      console.error("Failed to play assistant audio", error);
    }
  };

  dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.onmessage = handleDataChannelMessage;
  dataChannel.onopen = handleDataChannelOpen;
  dataChannel.onerror = (event) => {
    console.error("Assistant data channel error", event);
  };

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const url = new URL("https://api.openai.com/v1/realtime");
    url.searchParams.set(
      "model",
      assistantSettings.model || "gpt-4o-mini-realtime-preview"
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${assistantSettings.apiKey}`,
        "Content-Type": "application/sdp",
        "OpenAI-Beta": "realtime=v1",
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        text || `Realtime negotiation failed (${response.status})`
      );
    }

    const answer = await response.text();
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });

    sessionStatus = "active";
    setStatus(
      "Assistant connected. Say “thank you” when you want to wrap up.",
      "info"
    );
    handleSessionActivated();
  } catch (error) {
    console.error("Failed to establish realtime session", error);
    endRealtimeSession({
      reason: "error",
      message: error?.message || "Failed to start realtime session.",
    });
  }
}

function endRealtimeSession({ reason, message } = {}) {
  clearSessionEndTimer();

  const previousStatus = sessionStatus;
  handleSessionTerminated({ immediate: previousStatus !== "active" });

  if (dataChannel) {
    try {
      dataChannel.close();
    } catch (error) {
      console.warn("Failed to close data channel", error);
    }
    dataChannel = null;
  }

  if (peerConnection) {
    try {
      peerConnection.close();
    } catch (error) {
      console.warn("Failed to close peer connection", error);
    }
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (remoteAudioElement) {
    try {
      remoteAudioElement.pause();
    } catch (error) {
      console.warn("Failed to pause assistant audio", error);
    }
    remoteAudioElement.srcObject = null;
  }

  disconnectLipsyncStream();

  sessionStatus = "idle";
  resetVisemes();

  if (reason === "error") {
    setStatus(message || "Assistant session ended unexpectedly.", "error");
  } else if (reason === "user") {
    setStatus(
      `Session ended. Say “${getHotwordPhrase()}” to talk again.`,
      "info"
    );
  } else if (message) {
    setStatus(message, "info");
  } else if (previousStatus !== "connecting") {
    setStatus(
      `Assistant disconnected. Say “${getHotwordPhrase()}” to reconnect.`,
      "info"
    );
  }
}

function handleSpeechRecognitionResult(event) {
  const wakeWord = getAssistantHotword().toLowerCase();
  const hotwordPhrases = [`hey ${wakeWord}`];
  if (wakeWord !== "mirror") {
    hotwordPhrases.push("hey mirror");
  }
  const assistantName = getAssistantName().toLowerCase();
  if (
    assistantName &&
    assistantName !== wakeWord &&
    assistantName !== "mirror"
  ) {
    hotwordPhrases.push(`hey ${assistantName}`);
  }

  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    if (!result.isFinal) {
      continue;
    }
    const transcript = result[0]?.transcript?.trim()?.toLowerCase();
    if (!transcript) {
      continue;
    }
    if (hotwordPhrases.some((phrase) => transcript.includes(phrase))) {
      if (sessionStatus === "idle") {
        startRealtimeSession();
      }
      break;
    }
    if (sessionStatus === "active" && transcript.includes("thank you")) {
      clearSessionEndTimer();
      sessionEndTimer = window.setTimeout(() => {
        endRealtimeSession({ reason: "user" });
      }, 5000);
      setStatus("Wrapping up after the assistant finishes speaking…", "info");
      break;
    }
  }
}

function setupHotwordRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not supported in this browser.", "error");
    return;
  }
  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = handleSpeechRecognitionResult;
    recognition.onerror = (event) => {
      console.error("Speech recognition error", event);
    };
    recognition.onend = () => {
      if (recognition) {
        try {
          recognition.start();
        } catch (error) {
          console.warn("Failed to restart speech recognition", error);
        }
      }
    };
    recognition.start();
    setStatus(`Say “${getHotwordPhrase()}” to start the assistant.`, "info");
  } catch (error) {
    console.error("Failed to initialise speech recognition", error);
    setStatus("Unable to start speech recognition.", "error");
  }
}

function hasMorphs(geometry) {
  return Boolean(
    geometry?.morphAttributes &&
      ((Array.isArray(geometry.morphAttributes.position) &&
        geometry.morphAttributes.position.length > 0) ||
        (Array.isArray(geometry.morphAttributes.normal) &&
          geometry.morphAttributes.normal.length > 0))
  );
}

function prepareMeshForMorphTargets(mesh) {
  if (!mesh.geometry || !hasMorphs(mesh.geometry)) {
    return;
  }
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  materials.forEach((material) => {
    if (material && "morphTargets" in material) {
      material.morphTargets = true;
      material.needsUpdate = true;
    }
    if (
      material &&
      "morphNormals" in material &&
      mesh.geometry.morphAttributes?.normal?.length
    ) {
      material.morphNormals = true;
    }
  });
}

function enforceMorphSafety(root) {
  if (!root || typeof root.traverse !== "function") {
    return;
  }
  root.traverse((child) => {
    if (child.isMesh) {
      prepareMeshForMorphTargets(child);
    }
  });
}

function buildBlendshapeMap(object3D) {
  const map = new Map();
  object3D.traverse((child) => {
    if (
      child.isMesh &&
      child.geometry &&
      child.morphTargetDictionary &&
      child.morphTargetInfluences
    ) {
      const entries = Object.entries(child.morphTargetDictionary);
      for (const [name, index] of entries) {
        if (!map.has(name)) {
          map.set(name, []);
        }
        map.get(name).push({ mesh: child, index });
      }
    }
  });
  return map;
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
  const distance = Math.max(maxDim / (2 * Math.tan(fov / 2)), 0.5);

  camera.position.set(
    center.x,
    center.y + size.y * 0.15,
    center.z + distance * 1.4
  );
  camera.near = Math.max(0.1, distance / 100);
  camera.far = Math.max(1000, distance * 20);
  camera.updateProjectionMatrix();
  camera.lookAt(center);
}

function updateCurrentModelBounds(object3D) {
  tempBox.makeEmpty();
  if (object3D && typeof object3D === "object") {
    tempBox.setFromObject(object3D);
  }

  if (
    !Number.isFinite(tempBox.min.x) ||
    !Number.isFinite(tempBox.min.y) ||
    !Number.isFinite(tempBox.min.z) ||
    !Number.isFinite(tempBox.max.x) ||
    !Number.isFinite(tempBox.max.y) ||
    !Number.isFinite(tempBox.max.z) ||
    tempBox.isEmpty()
  ) {
    currentModelCenter.set(0, 1.4, 0);
    currentModelSize.set(1, 1, 1);
    return;
  }

  tempBox.getCenter(currentModelCenter);
  tempBox.getSize(currentModelSize);
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

function applyLightingSettingsToScene() {
  const lighting = {
    ...DEFAULT_ASSISTANT_SETTINGS.lighting,
    ...getLightingSettings(),
  };
  applyMeshColorToModel(currentModel, lighting.meshColor);

  const modelHeight = Math.max(currentModelSize.y, 0.6);
  const offsetScalar = Math.max(
    Number(lighting.spotOffset) ||
      DEFAULT_ASSISTANT_SETTINGS.lighting.spotOffset ||
      0,
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

  const targetY =
    currentModelCenter.y + DEFAULT_SPOTLIGHT_TARGET_OFFSET * modelHeight;
  const target = tempTarget.set(
    currentModelCenter.x,
    targetY,
    currentModelCenter.z
  );
  spotTarget.position.copy(target);
  spotTarget.updateMatrixWorld();

  const orbitY = Math.sin(verticalRotation) * radius;
  const orbitZ = Math.cos(verticalRotation) * radius;
  const baseY = target.y + orbitY;
  const desiredY = baseY + heightScalar * modelHeight;
  const minLift = Math.min(baseY, target.y - modelHeight * 0.25);
  const maxLift = Math.max(baseY, target.y + modelHeight * 2.4);
  const effectiveY = lighting.enableSpotLight
    ? THREE.MathUtils.clamp(desiredY, minLift, maxLift)
    : desiredY;
  spotLight.position.set(target.x, effectiveY, target.z + orbitZ);

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

  hemisphereLight.intensity = ambientStrength;

  const fillHeight = target.y + modelHeight * 0.3;
  const fillDistance = Math.max(radius * 2.2, modelHeight * 2.7);
  const fillOffsetX = radius * 0.4;
  fillLight.position.set(
    target.x - fillOffsetX,
    fillHeight,
    target.z + fillDistance
  );
  fillLight.distance = Math.max(fillDistance * 1.3, modelHeight * 3.2);
  fillLight.angle = THREE.MathUtils.degToRad(Math.max(clampedAngle + 12, 55));
  fillLight.intensity = fillStrength;
  fillLight.visible = true;

  const rimHeight = target.y + modelHeight * 1.05;
  const rimOffsetX = radius * 1.35;
  const rimOffsetZ = radius * 1.55;
  rimLight.position.set(
    target.x + rimOffsetX,
    rimHeight,
    target.z - rimOffsetZ
  );
  rimLight.intensity = rimStrength;
  rimLight.visible = true;
}

function resetSceneWithModel(object3D) {
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
      if (Array.isArray(child.morphTargetInfluences)) {
        for (let i = 0; i < child.morphTargetInfluences.length; i += 1) {
          child.morphTargetInfluences[i] = 0;
        }
      }
    }
  });

  registerHeadMaterials(currentModel);

  activeBlendshapeMap = buildBlendshapeMap(currentModel);
  updateCurrentModelBounds(currentModel);
  applyLightingSettingsToScene();
  focusCameraOnObject(currentModel);
  resetHeadAnimationPose();
}

function applyVisemes({
  vowelActive = false,
  visemeSettings,
  headSettings,
  expressionSettings,
  amplitude = 0,
} = {}) {
  if (activeBlendshapeMap.size === 0) {
    return;
  }

  const totals = new Map();
  const visemeStrength = Math.max(0, visemeSettings?.strength ?? 1);
  for (const name of VISEME_NAMES) {
    const value = clamp01((visemeWeights.get(name) ?? 0) * visemeStrength);
    if (!value) {
      continue;
    }
    const recipe = visemeConfig.visemes?.[name];
    if (!recipe) {
      continue;
    }
    for (const [shape, weight] of Object.entries(recipe)) {
      const contribution = value * weight;
      if (!contribution) {
        continue;
      }
      const current = totals.get(shape) || 0;
      totals.set(shape, Math.min(1, current + contribution));
    }
  }

  const blinkValue = clamp01(blinkState.value);
  if (headSettings?.enableBlinks !== false && blinkValue > 0) {
    ["eyeBlinkLeft", "eyeBlinkRight"].forEach((shape) => {
      accumulateBlendshape(totals, shape, blinkValue);
    });
  }

  if (vowelActive) {
    const minJaw = 0.08;
    const existing = totals.get("jawOpen") || 0;
    totals.set("jawOpen", Math.max(existing, minJaw));
  }

  applyExpressionTargets(totals, amplitude, expressionSettings);

  for (const [shape, targets] of activeBlendshapeMap.entries()) {
    const influence = clamp01(totals.get(shape) || 0);
    targets.forEach(({ mesh, index }) => {
      mesh.morphTargetInfluences[index] = influence;
    });
  }
}

function updateSmokeGroupScaleForViewport(width, height) {
  if (!smokeState?.group) {
    return;
  }
  const reference = SMOKE_GROUP_SCALE_REFERENCE || 680;
  const w = Math.max(width || 0, 1);
  const h = Math.max(height || 0, 1);
  const pad = Math.max(0, 1 - SMOKE_VIEWPORT_MARGIN);
  const target = Math.min(w, h) * pad;
  const baseScale = Math.max(target / reference, 0.01);
  smokeState.group.scale.setScalar(baseScale);
  smokeState.safeMaxRadius = target * 0.5 * SMOKE_MAX_RADIUS_FRACTION;
}

function resizeRenderer() {
  const width = canvasContainer.clientWidth || window.innerWidth || 1;
  const height = canvasContainer.clientHeight || window.innerHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateSmokeGroupScaleForViewport(width, height);
}

function loadMirror() {
  setStatus("Loading mirror mask…");
  loader.load(
    MIRROR_URL,
    (object) => {
      try {
        applyMirrorMaskOrientation(object);
        enforceMorphSafety(object);
        resetSceneWithModel(object);
        setStatus(
          `Mirror is ready. Say “${getHotwordPhrase()}” to start the assistant.`,
          "info",
          3200
        );
      } catch (error) {
        console.error("Failed to prepare mirror model", error);
        setStatus(
          "The mirror mask could not be prepared for animation.",
          "error"
        );
      }
    },
    undefined,
    (error) => {
      console.error("Failed to load mirror mask", error);
      setStatus("Unable to load the mirror FBX.", "error");
    }
  );
}

function animate(timestamp) {
  requestAnimationFrame(animate);
  if (!animate.lastTime) {
    animate.lastTime = timestamp;
  }
  const dt = (timestamp - animate.lastTime) / 1000;
  animate.lastTime = timestamp;
  try {
    lipsync.processAudio();
  } catch (error) {
    console.warn("Failed to process assistant audio", error);
  }
  const animationSettings = getAnimationSettings();
  const visemeSettings =
    animationSettings.viseme || DEFAULT_ASSISTANT_SETTINGS.animation.viseme;
  const headSettings =
    animationSettings.head || DEFAULT_ASSISTANT_SETTINGS.animation.head;
  const expressionSettings =
    animationSettings.expressions ||
    DEFAULT_ASSISTANT_SETTINGS.animation.expressions;

  const amplitudeSample = sampleAssistantAmplitude();
  headAnimationState.smoothedVolume =
    headAnimationState.smoothedVolume * 0.85 + amplitudeSample * 0.15;
  const reactiveVolume = headAnimationState.smoothedVolume;

  if (headSettings.enableBlinks !== false) {
    updateBlink(timestamp, dt);
  } else {
    blinkState.phase = "idle";
    blinkState.value = 0;
    blinkState.nextBlinkTime = null;
  }

  const { vowelActive } = updateVisemeWeights(dt, visemeSettings);
  updateHeadAnimation(dt, reactiveVolume, headSettings);
  applyVisemes({
    vowelActive,
    visemeSettings,
    headSettings,
    expressionSettings,
    amplitude: reactiveVolume,
  });
  updateSmoke(dt);
  updateHeadVisibility(dt);
  renderer.render(scene, camera);
}

window.addEventListener("storage", (event) => {
  if (event.key === ASSISTANT_SETTINGS_STORAGE_KEY) {
    refreshAssistantSettings();
    if (sessionStatus === "idle") {
      setStatus(
        `Assistant settings updated. Say “${getHotwordPhrase()}” to use them.`,
        "info"
      );
    }
  } else if (event.key === VISEME_CONFIG_STORAGE_KEY) {
    refreshVisemeConfig();
    if (sessionStatus === "idle") {
      setStatus("Viseme mapping updated.", "info");
    }
  }
});

resizeRenderer();
window.addEventListener("resize", resizeRenderer);

refreshAssistantSettings();
loadMirror();
setupHotwordRecognition();
requestAnimationFrame(animate);
