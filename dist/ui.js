import * as THREE from 'three';
import { importAssets } from './assets.js';
import { $, $all, button, input, output } from './dom.js';
import { applyOutlineScale, applyToonSettings } from './materials.js';
import { morphMeshes, seekMotions, setMotionLooping, setProceduralMotion } from './motion.js';
import { attachRigHandleFromPointer, clearModels, onActiveModelChange, onModelsChange, setRigEditing } from './models.js';
import { applyPhysicsSettings, disablePhysics, enablePhysics, resetAllPhysics } from './physics.js';
import { camera, canvas, controls, grid, loadHdr, pointer, raycaster, renderer, scene, setEnvironmentStrength } from './scene.js';
import { state } from './state.js';
import { renderActivePanels, renderLibraries, renderMorphs, showAllMaterials } from './views.js';
function bindFileInputs() {
    button('#open-models').onclick = () => input('#models-file').click();
    button('#open-motions').onclick = () => input('#motions-file').click();
    button('#open-folder').onclick = () => input('#folder').click();
    input('#models-file').onchange = (event) => {
        const files = event.currentTarget.files;
        if (files)
            void importAssets(files, true).then(renderLibraries);
    };
    input('#motions-file').onchange = (event) => {
        const files = event.currentTarget.files;
        if (files)
            void importAssets(files, false).then(renderLibraries);
    };
    input('#folder').onchange = (event) => {
        const files = event.currentTarget.files;
        if (files)
            void importAssets(files, false).then(renderLibraries);
    };
    button('#clear-models').onclick = clearModels;
}
function bindPlayback() {
    button('#play').onclick = (event) => {
        if (!state.playing && state.duration && state.elapsed >= state.duration - 0.001) {
            state.elapsed = 0;
            seekMotions(0);
            resetAllPhysics();
        }
        state.playing = !state.playing;
        event.currentTarget.textContent = state.playing ? '❚❚' : '▶';
    };
    button('#loop').onclick = (event) => {
        state.loop = !state.loop;
        setMotionLooping(state.loop);
        event.currentTarget.classList.toggle('active', state.loop);
    };
    input('#timeline').oninput = (event) => {
        if (!state.duration)
            return;
        state.elapsed = Number(event.currentTarget.value) * state.duration;
        seekMotions(state.elapsed);
        resetAllPhysics();
    };
    input('#motion-blend').oninput = (event) => {
        state.motionBlend = Number(event.currentTarget.value);
        output('#motion-blend-value').textContent = `${state.motionBlend.toFixed(2)}s`;
    };
    input('#procedural-motion').onchange = (event) => {
        setProceduralMotion(event.currentTarget.checked);
    };
    input('#procedural-weight').oninput = (event) => {
        const value = Number(event.currentTarget.value);
        setProceduralMotion(input('#procedural-motion').checked, value);
        output('#procedural-weight-value').textContent = value.toFixed(2);
    };
}
function bindRendering() {
    input('#toon-outline').onchange = (event) => { state.outline = event.currentTarget.checked; };
    input('#outline').oninput = (event) => {
        const value = Number(event.currentTarget.value);
        state.outlineScale = value / 0.28;
        applyOutlineScale();
        output('#outline-value').textContent = String(value);
    };
    input('#fov').oninput = (event) => {
        camera.fov = Number(event.currentTarget.value);
        camera.updateProjectionMatrix();
        output('#fov-value').textContent = `${camera.fov}°`;
    };
    input('#exposure').oninput = (event) => {
        renderer.toneMappingExposure = Number(event.currentTarget.value);
        output('#exposure-value').textContent = String(renderer.toneMappingExposure);
    };
    button('#open-hdri').onclick = () => input('#hdri').click();
    input('#hdri').onchange = (event) => {
        const file = event.currentTarget.files?.[0];
        if (file)
            loadHdr(file);
    };
    input('#env-intensity').oninput = (event) => {
        const value = Number(event.currentTarget.value);
        setEnvironmentStrength(value);
        output('#env-value').textContent = value.toFixed(2);
    };
    input('#show-hdri').onchange = (event) => {
        scene.background = event.currentTarget.checked && state.environment
            ? state.environment
            : new THREE.Color(0xe9edf2);
    };
    input('#grid').onchange = (event) => { grid.visible = event.currentTarget.checked; };
    input('#shadows').onchange = (event) => { renderer.shadowMap.enabled = event.currentTarget.checked; };
}
function bindPhysics() {
    input('#physics').onchange = (event) => {
        state.physics = event.currentTarget.checked;
        if (state.physics)
            void Promise.all(state.models.map((model) => enablePhysics(model)));
        else
            state.models.forEach(disablePhysics);
    };
    button('#physics-reset').onclick = resetAllPhysics;
    const scalarSettings = ['stiffness', 'damping', 'gravity', 'wind', 'turbulence', 'air'];
    scalarSettings.forEach((key) => {
        input(`#${key}`).oninput = (event) => {
            const value = Number(event.currentTarget.value);
            state.physicsSettings[key] = value;
            output(`#${key}-value`).textContent = value.toFixed(2);
            state.models.forEach((model) => applyPhysicsSettings(model));
        };
    });
    $all('.physics-part').forEach((element) => {
        element.onchange = () => {
            state.physicsSettings.parts[element.dataset.part] = element.checked;
            state.models.forEach((model) => applyPhysicsSettings(model));
        };
    });
    $all('[data-physics-preset]').forEach((element) => {
        element.onclick = () => {
            const presets = {
                hair: { stiffness: 0.48, damping: 0.16, gravity: 0.88, air: 0.42 },
                cloth: { stiffness: 0.7, damping: 0.12, gravity: 1.08, air: 0.3 },
                body: { stiffness: 0.82, damping: 0.28, gravity: 1, air: 0.18 },
            };
            const preset = presets[element.dataset.physicsPreset];
            Object.assign(state.physicsSettings, preset);
            Object.keys(preset).forEach((key) => {
                input(`#${key}`).value = String(preset[key]);
                output(`#${key}-value`).textContent = preset[key].toFixed(2);
            });
            state.models.forEach((model) => applyPhysicsSettings(model));
        };
    });
    input('#physics-quality').oninput = (event) => {
        state.physicsSettings.quality = Number(event.currentTarget.value);
        output('#physics-quality-value').textContent = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'][state.physicsSettings.quality - 1];
        state.models.forEach((model) => applyPhysicsSettings(model));
    };
}
function bindPanels() {
    $all('.tabs button').forEach((tab) => {
        tab.onclick = () => {
            $all('.tabs button').forEach((candidate) => candidate.classList.toggle('active', candidate === tab));
            $all('.tab-content').forEach((content) => content.classList.toggle('active', content.id === `${tab.dataset.tab}-tab`));
        };
    });
    $all('[data-camera]').forEach((element) => {
        element.onclick = () => {
            camera.position.fromArray({ front: [0, 4.8, 12], threequarter: [8, 5.4, 12], wide: [13, 9, 18] }[element.dataset.camera]);
            controls.update();
        };
    });
    button('#reset-morph').onclick = () => {
        morphMeshes(state.active?.mesh).forEach((mesh) => mesh.morphTargetInfluences.fill(0));
        renderMorphs();
    };
    button('#show-all-materials').onclick = showAllMaterials;
    input('#rig-edit').onchange = (event) => setRigEditing(event.currentTarget.checked);
    canvas.addEventListener('pointerdown', (event) => {
        if (!input('#rig-edit').checked)
            return;
        attachRigHandleFromPointer(event.clientX, event.clientY, raycaster, pointer, canvas);
    });
    const toonControls = {
        specular: 'specular',
        'shadow-lift': 'shadowLift',
    };
    Object.entries(toonControls)
        .forEach(([id, key]) => {
        input(`#${id}`).oninput = (event) => {
            const value = Number(event.currentTarget.value);
            state.toonSettings[key] = value;
            output(`#${id}-value`).textContent = value.toFixed(2);
            applyToonSettings();
        };
    });
}
function bindDropzone() {
    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    ['dragenter', 'dragover'].forEach((type) => window.addEventListener(type, (event) => {
        const dragEvent = event;
        if (!hasFiles(dragEvent))
            return;
        dragEvent.preventDefault();
        $('#dropzone').classList.add('show');
    }));
    ['dragleave', 'drop'].forEach((type) => window.addEventListener(type, (event) => {
        const dragEvent = event;
        if (!hasFiles(dragEvent))
            return;
        dragEvent.preventDefault();
        if (type === 'dragleave' && dragEvent.relatedTarget)
            return;
        $('#dropzone').classList.remove('show');
    }));
    window.addEventListener('drop', (event) => {
        if (event.dataTransfer?.files.length)
            void importAssets(event.dataTransfer.files, true).then(renderLibraries);
    });
}
export function bindUi() {
    bindFileInputs();
    bindPlayback();
    bindRendering();
    bindPhysics();
    bindPanels();
    bindDropzone();
    onActiveModelChange(renderActivePanels);
    onModelsChange(renderActivePanels);
}
