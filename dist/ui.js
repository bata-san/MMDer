import * as THREE from 'three';
import { importAssets } from './assets.js';
import { $, $all, button, input, output } from './dom.js';
import { applyOutlineScale, applySkinSettings } from './materials.js';
import { morphMeshes } from './motion.js';
import { attachRigHandleFromPointer, clearModels, onActiveModelChange, onModelsChange, setRigEditing } from './models.js';
import { applyPhysicsSettings, enablePhysics } from './physics.js';
import { camera, canvas, controls, grid, loadHdr, pointer, raycaster, renderer, scene, setEnvironmentStrength } from './scene.js';
import { state } from './state.js';
import { renderActivePanels, renderLibraries, renderMaterials, renderMorphs, showAllMaterials } from './views.js';
function bindFileInputs() {
    button('#open-models').onclick = () => input('#models-file').click();
    button('#open-motions').onclick = () => input('#motions-file').click();
    button('#open-folder').onclick = () => input('#folder').click();
    input('#models-file').onchange = (event) => { const files = event.currentTarget.files; if (files)
        void importAssets(files, true).then(renderLibraries); };
    input('#motions-file').onchange = (event) => { const files = event.currentTarget.files; if (files)
        void importAssets(files, false).then(renderLibraries); };
    input('#folder').onchange = (event) => { const files = event.currentTarget.files; if (files)
        void importAssets(files, false).then(renderLibraries); };
    button('#clear-models').onclick = clearModels;
}
function bindPlayback() {
    button('#play').onclick = (event) => {
        state.playing = !state.playing;
        event.currentTarget.textContent = state.playing ? '❚❚' : '▶';
    };
    button('#loop').onclick = (event) => {
        state.loop = !state.loop;
        event.currentTarget.classList.toggle('active', state.loop);
    };
    input('#timeline').oninput = (event) => {
        if (!state.duration)
            return;
        state.elapsed = Number(event.currentTarget.value) * state.duration;
        state.models.forEach((model) => model.motion.mixer.setTime(state.elapsed));
    };
    input('#living-motion').onchange = (event) => { state.livingMotion = event.currentTarget.checked; };
    input('#motion-blend').oninput = (event) => {
        state.motionBlend = Number(event.currentTarget.value);
        output('#motion-blend-value').textContent = `${state.motionBlend.toFixed(2)}s`;
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
    input('#hdri').onchange = (event) => { const file = event.currentTarget.files?.[0]; if (file)
        loadHdr(file); };
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
    };
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
                hair: { stiffness: 0.72, damping: 0.12, gravity: 0.9 },
                cloth: { stiffness: 0.85, damping: 0.07, gravity: 1.15 },
                body: { stiffness: 0.5, damping: 0.2, gravity: 1 },
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
    ['specular', 'wetness', 'roughness-map'].forEach((id) => {
        input(`#${id}`).oninput = (event) => {
            const key = id === 'roughness-map' ? 'roughnessMap' : id;
            const value = Number(event.currentTarget.value);
            state.skinSettings[key] = value;
            output(`#${id}-value`).textContent = value.toFixed(2);
            applySkinSettings();
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
