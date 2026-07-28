import type { AppState, BodyRegion, PhysicsPart, PhysicsPartSettings } from './types.js';

export const BUILD_VERSION = 'v5.1.0';

const physicsPart = (
  response: number,
  damping: number,
  gravity: number,
  wind: number,
): PhysicsPartSettings => ({ enabled: true, response, damping, gravity, wind });

const physicsParts: Record<PhysicsPart, PhysicsPartSettings> = {
  hairFront: physicsPart(0.64, 0.74, 0.9, 0.38),
  hairBack: physicsPart(0.78, 0.64, 0.96, 0.56),
  hairSide: physicsPart(0.7, 0.7, 0.94, 0.42),
  ears: physicsPart(0.38, 0.88, 0.96, 0),
  skirt: physicsPart(0.9, 0.44, 1.08, 0.78),
  cloth: physicsPart(0.76, 0.55, 1, 0.66),
  accessory: physicsPart(1, 0.36, 0.94, 1.12),
  chest: physicsPart(0.24, 0.92, 0.98, 0),
  torso: physicsPart(0.3, 0.82, 1, 0.04),
  hips: physicsPart(0.36, 0.9, 1, 0),
  arms: physicsPart(0.42, 0.75, 1, 0.16),
  legs: physicsPart(0.32, 0.84, 1, 0.04),
};

const segments: Record<BodyRegion, number> = {
  center: 0.12,
  hips: 0.18,
  spineLower: 0.22,
  spineUpper: 0.32,
  shoulderLeft: 0.16,
  shoulderRight: 0.16,
  neck: 0.24,
  head: 0.3,
};

export const state: AppState = {
  models: [],
  active: null,
  selectedModels: [],
  motionScope: 'selected',
  duration: 0,
  elapsed: 0,
  playing: true,
  loop: true,
  outline: true,
  outlineScale: 1,
  environment: null,
  environmentStrength: 0.65,
  assets: [],
  rigHandles: [],
  physics: false,
  motionBlend: 0.22,
  loopBlend: 0.38,
  physicsSettings: {
    stiffness: 0.62,
    damping: 0.18,
    gravity: 1,
    wind: 0,
    turbulence: 0,
    quality: 3,
    air: 0.28,
    parts: physicsParts,
  },
  toonSettings: { specular: 0.16, shadowLift: 0.04 },
  lifeSettings: {
    enabled: true,
    blinkActivity: 0.52,
    blinkStrength: 0.94,
    doubleBlinkChance: 0.12,
    softBlinkChance: 0.22,
    blinkDuration: 1,
    blinkOnGaze: 0.35,
    breathRate: 14,
    breathDepth: 0.52,
    breathVariation: 0.28,
    gazeActivity: 0.6,
    gazeRange: 0.58,
    gazeDwell: 0.55,
    headFollow: 0.5,
    microSaccade: 0.42,
    followPointer: false,
    sway: 0.55,
    swaySpeed: 0.5,
    swayIrregularity: 0.5,
    inertiaResponse: 0.68,
    postureRecovery: 0.5,
    // Weight-shift/stepping is intentionally paused while the gait solver is
    // being reworked. Other life features (blink, gaze, expressions) remain.
    weightShift: 0,
    footReplant: 0,
    segments,
  },
  interactionSettings: {
    mode: 'select',
    groundLock: true,
    dragResponse: 0.72,
    // Bullet impulses are expressed in model-space units.  A double-digit
    // default launches light hair bodies through their PMX constraints.
    pokeStrength: 0.85,
    pokeRadius: 1.5,
    shockwaveSpeed: 1.8,
  },
  xrPresenting: false,
  xrFloorHeight: 0,
  xrMoveSpeed: 1.8,
  renderScale: 1,
};
