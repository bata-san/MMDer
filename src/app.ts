import { updateInteraction, setupInteraction } from './interaction.js';
import { updateLife } from './life.js';
import { recomputeDuration } from './motion.js';
import { updateRigHandles } from './models.js';
import { stepPhysics } from './physics.js';
import { state } from './state.js';
import { refreshStoredAssets } from './storage.js';
import {
  clock,
  controls,
  loadDefaultHdr,
  renderScene,
  renderer,
  resizeScene,
  setRenderScale,
} from './scene.js';
import { setupXr } from './xr.js';

let frameCount = 0;
let fpsStartedAt = performance.now();
let qualitySamples = 0;

function updateTimeline(): void {
  if (!state.duration) return;
  if (state.elapsed > state.duration) {
    if (state.loop) {
      state.elapsed %= state.duration;
      // AnimationAction loops internally. Keep the mixer and physics continuous at the seam.
    } else {
      state.elapsed = state.duration;
      state.playing = false;
    }
  }
}

function updatePerformance(now: number): void {
  frameCount += 1;
  if (frameCount % 30 !== 0) return;
  const fps = Math.round(30000 / Math.max(1, now - fpsStartedAt));
  fpsStartedAt = now;
  if (state.xrPresenting) return;

  qualitySamples += 1;
  if (qualitySamples < 4) return;
  qualitySamples = 0;
  if (fps < 46 && state.renderScale > 0.7) setRenderScale(state.renderScale - 0.1);
  else if (fps > 58 && state.renderScale < 1) setRenderScale(state.renderScale + 0.05);
}

function animate(): void {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (state.playing) state.elapsed += delta;
  state.models.forEach((model) => {
    if (state.playing) model.motion.mixer.update(delta);
    updateLife(model.life, model.motion, delta, state.playing);
    // Direct physics manipulation must work while the timeline is paused too.
    // MMDPhysics also needs regular steps to settle a body after a pull.
    if (state.physics) stepPhysics(model, delta, state.elapsed);
  });
  updateTimeline();
  updateInteraction(delta);
  updateRigHandles();
  if (!state.xrPresenting) controls.update();
  renderScene();
  updatePerformance(performance.now());
}

async function start(): Promise<void> {
  setupInteraction();
  setupXr();
  await refreshStoredAssets();
  recomputeDuration();
  loadDefaultHdr();
  window.addEventListener('resize', resizeScene);
  renderer.setAnimationLoop(animate);
}

void start();
