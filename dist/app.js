import { $, input, output } from './dom.js';
import { updateLivingMotion } from './motion.js';
import { updateRigHandles } from './models.js';
import { applyWind } from './physics.js';
import { BUILD_VERSION, state } from './state.js';
import { bindUi } from './ui.js';
import { refreshStoredAssets } from './storage.js';
import { camera, clock, controls, effect, loadDefaultHdr, renderer, resizeScene, scene } from './scene.js';
import { renderActivePanels, renderLibraries } from './views.js';
$('#build-version').textContent = BUILD_VERSION;
let frameCount = 0;
let fpsStartedAt = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    if (state.playing) {
        state.elapsed += delta;
        state.models.forEach((model) => {
            model.motion.mixer.update(delta);
            updateLivingMotion(model.motion, delta, state.elapsed);
            if (state.physics) {
                applyWind(model, state.elapsed);
                model.physics?.update(delta);
            }
        });
    }
    if (state.duration) {
        if (state.elapsed > state.duration) {
            if (state.loop)
                state.elapsed %= state.duration;
            else
                state.playing = false;
        }
        input('#timeline').value = String(state.elapsed / state.duration);
        output('#timecode').textContent = `${String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:${(state.elapsed % 60).toFixed(1).padStart(4, '0')}`;
    }
    updateRigHandles();
    controls.update();
    if (state.outline)
        effect.render(scene, camera);
    else
        renderer.render(scene, camera);
    frameCount += 1;
    if (frameCount % 20 === 0) {
        const now = performance.now();
        $('#fps').textContent = `${Math.round(20000 / (now - fpsStartedAt))} FPS`;
        fpsStartedAt = now;
    }
}
async function start() {
    bindUi();
    await refreshStoredAssets();
    renderLibraries();
    renderActivePanels();
    loadDefaultHdr();
    window.addEventListener('resize', resizeScene);
    animate();
}
void start();
