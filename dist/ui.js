import * as THREE from 'three';
import { importAssets } from './assets.js';
import { $, $all, button, input, output } from './dom.js';
import { blinkMorphNames, forceBlink } from './life.js';
import { applyOutlineScale, applyToonSettings } from './materials.js';
import { morphMeshes, seekMotions, setMotionLooping, synchronizeMotions } from './motion.js';
import { arrangeModels, attachRigHandleFromPointer, clearModelSelection, clearModels, onActiveModelChange, onModelsChange, selectAllModels, setRigEditing, } from './models.js';
import { applyPhysicsSettings, disablePhysics, enablePhysics, PHYSICS_PART_LABELS, PHYSICS_PARTS, resetAllPhysics, } from './physics.js';
import { camera, canvas, controls, grid, loadHdr, pointer, raycaster, renderer, scene, setEnvironmentStrength } from './scene.js';
import { state } from './state.js';
import { renderActivePanels, renderLibraries, renderMorphs, showAllMaterials } from './views.js';
const BODY_REGION_LABELS = {
    center: 'センター',
    hips: '腰・骨盤',
    spineLower: '上半身',
    spineUpper: '胸郭・上半身2',
    shoulderLeft: '左肩',
    shoulderRight: '右肩',
    neck: '首',
    head: '頭',
};
function setRange(id, value, suffix = '') {
    input(`#${id}`).value = String(value);
    const target = document.querySelector(`#${id}-value`);
    if (target)
        target.textContent = `${Number(value).toFixed(2)}${suffix}`;
}
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
    button('#select-all-models').onclick = selectAllModels;
    button('#clear-selection').onclick = clearModelSelection;
    button('#arrange-models').onclick = arrangeModels;
    button('#scene-select-all').onclick = selectAllModels;
    button('#scene-arrange').onclick = arrangeModels;
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
    input('#loop-blend').oninput = (event) => {
        state.loopBlend = Number(event.currentTarget.value);
        output('#loop-blend-value').textContent = `${state.loopBlend.toFixed(2)}s`;
    };
    input('#motion-scope').onchange = (event) => {
        state.motionScope = event.currentTarget.value;
    };
    button('#sync-motion').onclick = () => synchronizeMotions(false);
    button('#restart-motion').onclick = () => {
        state.elapsed = 0;
        synchronizeMotions(true);
        resetAllPhysics();
    };
}
function applyLifePreset(name) {
    const presets = {
        calm: {
            blinkActivity: 0.34, gazeActivity: 0.28, gazeRange: 0.28, gazeDwell: 0.7,
            breathRate: 11, breathDepth: 0.2, sway: 0.14, swaySpeed: 0.3, swayIrregularity: 0.18,
        },
        natural: {
            blinkActivity: 0.52, gazeActivity: 0.48, gazeRange: 0.42, gazeDwell: 0.55,
            breathRate: 14, breathDepth: 0.24, sway: 0.22, swaySpeed: 0.44, swayIrregularity: 0.32,
        },
        alert: {
            blinkActivity: 0.38, gazeActivity: 0.78, gazeRange: 0.62, gazeDwell: 0.28,
            breathRate: 18, breathDepth: 0.18, sway: 0.16, swaySpeed: 0.62, swayIrregularity: 0.42,
        },
    };
    const preset = presets[name];
    if (!preset)
        return;
    Object.assign(state.lifeSettings, preset);
    Object.entries(preset).forEach(([key, value]) => {
        const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const suffix = key === 'breathRate' ? ' bpm' : '';
        setRange(id, Number(value), suffix);
    });
}
function renderSwayRegionControls() {
    const root = $('#sway-regions');
    root.innerHTML = '';
    Object.keys(BODY_REGION_LABELS).forEach((region) => {
        const card = document.createElement('div');
        card.className = 'region-card';
        card.innerHTML = `<header><strong>${BODY_REGION_LABELS[region]}</strong><output>${state.lifeSettings.segments[region].toFixed(2)}</output></header><input type="range" min="0" max="1" step=".01" value="${state.lifeSettings.segments[region]}">`;
        const range = card.querySelector('input');
        const value = card.querySelector('output');
        range.oninput = () => {
            state.lifeSettings.segments[region] = Number(range.value);
            value.textContent = Number(range.value).toFixed(2);
        };
        root.append(card);
    });
}
function updateBlinkMorphStatus() {
    const target = $('#blink-morph-status');
    const models = state.selectedModels.length ? state.selectedModels : state.active ? [state.active] : [];
    if (!models.length) {
        target.textContent = 'モデルを選択すると、使用するMMDモーフを表示します。';
        button('#test-blink').disabled = true;
        return;
    }
    const details = models.map((model) => {
        const names = blinkMorphNames(model.life);
        return `${model.name}: ${names.length ? names.join(' / ') : '瞬きモーフ未検出'}`;
    });
    target.textContent = details.join(' ｜ ');
    button('#test-blink').disabled = models.every((model) => model.life.blinkTargets.length === 0);
}
function bindLife() {
    input('#life-enabled').onchange = (event) => {
        state.lifeSettings.enabled = event.currentTarget.checked;
    };
    button('#test-blink').onclick = () => {
        const targets = state.selectedModels.length ? state.selectedModels : state.active ? [state.active] : [];
        targets.forEach((model) => forceBlink(model.life, model.motion, 'full'));
    };
    $all('[data-life-preset]').forEach((element) => {
        element.onclick = () => applyLifePreset(element.dataset.lifePreset ?? 'natural');
    });
    const scalarMap = {
        'blink-activity': 'blinkActivity',
        'blink-strength': 'blinkStrength',
        'blink-duration': 'blinkDuration',
        'soft-blink': 'softBlinkChance',
        'double-blink': 'doubleBlinkChance',
        'blink-on-gaze': 'blinkOnGaze',
        'gaze-activity': 'gazeActivity',
        'gaze-range': 'gazeRange',
        'gaze-dwell': 'gazeDwell',
        'micro-saccade': 'microSaccade',
        'head-follow': 'headFollow',
        'breath-rate': 'breathRate',
        'breath-depth': 'breathDepth',
        'breath-variation': 'breathVariation',
        sway: 'sway',
        'sway-speed': 'swaySpeed',
        'sway-irregularity': 'swayIrregularity',
    };
    Object.entries(scalarMap).forEach(([id, key]) => {
        input(`#${id}`).oninput = (event) => {
            const value = Number(event.currentTarget.value);
            state.lifeSettings[key] = value;
            output(`#${id}-value`).textContent = key === 'breathRate' ? `${value.toFixed(1)} bpm` : value.toFixed(2);
        };
    });
    input('#follow-pointer').onchange = (event) => {
        state.lifeSettings.followPointer = event.currentTarget.checked;
    };
    renderSwayRegionControls();
}
function renderPhysicsPartControls() {
    const root = $('#physics-parts');
    root.innerHTML = '';
    PHYSICS_PARTS.forEach((part) => {
        const tuning = state.physicsSettings.parts[part];
        const card = document.createElement('div');
        card.className = 'region-card';
        card.innerHTML = `
      <header><strong>${PHYSICS_PART_LABELS[part]}</strong><label class="switch"><input class="part-enabled" type="checkbox" ${tuning.enabled ? 'checked' : ''}><i></i></label></header>
      <div class="mini-grid">
        <div><label>RESPONSE <output>${tuning.response.toFixed(2)}</output></label><input data-key="response" type="range" min="0" max="1.5" step=".01" value="${tuning.response}"></div>
        <div><label>DAMPING <output>${tuning.damping.toFixed(2)}</output></label><input data-key="damping" type="range" min="0" max="1" step=".01" value="${tuning.damping}"></div>
        <div><label>GRAVITY <output>${tuning.gravity.toFixed(2)}</output></label><input data-key="gravity" type="range" min="0" max="2" step=".01" value="${tuning.gravity}"></div>
        <div><label>WIND <output>${tuning.wind.toFixed(2)}</output></label><input data-key="wind" type="range" min="0" max="2" step=".01" value="${tuning.wind}"></div>
      </div>`;
        card.querySelector('.part-enabled').onchange = (event) => {
            tuning.enabled = event.currentTarget.checked;
            state.models.forEach((model) => applyPhysicsSettings(model));
        };
        card.querySelectorAll('input[type=range]').forEach((range) => {
            range.oninput = () => {
                const key = range.dataset.key;
                tuning[key] = Number(range.value);
                range.parentElement?.querySelector('output').replaceChildren(Number(range.value).toFixed(2));
                state.models.forEach((model) => applyPhysicsSettings(model));
            };
        });
        root.append(card);
    });
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
    input('#physics-quality').oninput = (event) => {
        state.physicsSettings.quality = Number(event.currentTarget.value);
        output('#physics-quality-value').textContent = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'][state.physicsSettings.quality - 1];
        state.models.forEach((model) => applyPhysicsSettings(model));
    };
    renderPhysicsPartControls();
}
function bindInteraction() {
    input('#interaction-mode').onchange = (event) => {
        state.interactionSettings.mode = event.currentTarget.value;
        canvas.style.cursor = state.interactionSettings.mode === 'pull' ? 'grab'
            : state.interactionSettings.mode === 'poke' ? 'crosshair'
                : state.interactionSettings.mode === 'move' ? 'move' : 'default';
    };
    input('#ground-lock').onchange = (event) => {
        state.interactionSettings.groundLock = event.currentTarget.checked;
    };
    const controlsMap = {
        'drag-response': 'dragResponse',
        'poke-strength': 'pokeStrength',
        'poke-radius': 'pokeRadius',
        'pull-strength': 'pullStrength',
        'pull-damping': 'pullDamping',
        'pull-radius': 'pullRadius',
    };
    Object.entries(controlsMap).forEach(([id, key]) => {
        input(`#${id}`).oninput = (event) => {
            const value = Number(event.currentTarget.value);
            state.interactionSettings[key] = value;
            output(`#${id}-value`).textContent = value.toFixed(key.includes('Strength') ? 1 : 2);
        };
    });
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
    const toonControls = { specular: 'specular', 'shadow-lift': 'shadowLift' };
    Object.entries(toonControls).forEach(([id, key]) => {
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
    bindLife();
    bindPhysics();
    bindInteraction();
    bindRendering();
    bindPanels();
    bindDropzone();
    onActiveModelChange(() => { renderActivePanels(); updateBlinkMorphStatus(); });
    onModelsChange(() => { renderActivePanels(); updateBlinkMorphStatus(); });
    updateBlinkMorphStatus();
}
