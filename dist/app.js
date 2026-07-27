import { $, input, output } from './dom.js';
import { recomputeDuration, updateProceduralMotion } from './motion.js';
import { updateRigHandles } from './models.js';
import { stepPhysics } from './physics.js';
import { BUILD_VERSION, state } from './state.js';
import { bindUi } from './ui.js';
import { refreshStoredAssets } from './storage.js';
import { clock, controls, loadDefaultHdr, renderScene, renderer, resizeScene, setRenderScale, } from './scene.js';
import { renderActivePanels, renderLibraries } from './views.js';
import { setupXr } from './xr.js';
$('#build-version').textContent = BUILD_VERSION;
let frameCount = 0;
let fpsStartedAt = performance.now();
let qualitySamples = 0;
function updateTimeline() {
    if (!state.duration)
        return;
    if (state.elapsed > state.duration) {
        if (state.loop) {
            state.elapsed %= state.duration;
            // AnimationAction loops internally. Keep the mixer and physics continuous at the seam.
        }
        else {
            state.elapsed = state.duration;
            state.playing = false;
            $('#play').textContent = '▶';
        }
    }
    input('#timeline').value = String(state.elapsed / state.duration);
    output('#timecode').textContent = `${String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:${(state.elapsed % 60).toFixed(1).padStart(4, '0')}`;
}
function updatePerformance(now) {
    frameCount += 1;
    if (frameCount % 30 !== 0)
        return;
    const fps = Math.round(30000 / Math.max(1, now - fpsStartedAt));
    $('#fps').textContent = `${fps} FPS`;
    fpsStartedAt = now;
    if (state.xrPresenting)
        return;
    qualitySamples += 1;
    if (qualitySamples < 4)
        return;
    qualitySamples = 0;
    if (fps < 46 && state.renderScale > 0.7)
        setRenderScale(state.renderScale - 0.1);
    else if (fps > 58 && state.renderScale < 1)
        setRenderScale(state.renderScale + 0.05);
}
function animate() {
    const delta = Math.min(clock.getDelta(), 0.05);
    if (state.playing) {
        state.elapsed += delta;
        state.models.forEach((model) => {
            model.motion.mixer.update(delta);
            updateProceduralMotion(model.motion, delta);
            stepPhysics(model, delta, state.elapsed);
        });
    }
    updateTimeline();
    updateRigHandles();
    if (!state.xrPresenting)
        controls.update();
    renderScene();
    updatePerformance(performance.now());
}
async function start() {
    bindUi();
    setupXr();
    await refreshStoredAssets();
    renderLibraries();
    renderActivePanels();
    recomputeDuration();
    loadDefaultHdr();
    window.addEventListener('resize', resizeScene);
    renderer.setAnimationLoop(animate);
}
void start();
