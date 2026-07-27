import type { AppState } from './types.js';

export const BUILD_VERSION = 'v4.1.0';

export const state: AppState = {
  models: [],
  active: null,
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
  physicsSettings: {
    stiffness: 0.62,
    damping: 0.18,
    gravity: 1,
    wind: 0,
    turbulence: 0,
    quality: 3,
    air: 0.28,
    parts: { hair: true, cloth: true, body: true },
  },
  toonSettings: { specular: 0.16, rim: 0.22, shadowLift: 0.08 },
  xrPresenting: false,
  renderScale: 1,
};
