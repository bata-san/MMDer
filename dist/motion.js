import * as THREE from 'three';
import { extension, objectUrl, revokeObjectUrl, toast } from './dom.js';
import { loader } from './scene.js';
import { state } from './state.js';
export const DEFAULT_IDLE_URL = new URL('../assets/default-idle.vmd', import.meta.url).href;
export const DEFAULT_IDLE_NAME = '待機・素立ち';
let cachedDefaultIdleObjectUrl = null;
export function morphMeshes(root) {
    const result = [];
    root?.traverse((node) => {
        if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences)
            result.push(node);
    });
    return result;
}
export function createMotionController(mesh) {
    return {
        mesh,
        mixer: new THREE.AnimationMixer(mesh),
        clips: new Map(),
        actions: new Map(),
        current: null,
        currentName: '',
    };
}
export function playMotion(controller, clip, name = clip.name || 'VMD', blend = state.motionBlend) {
    controller.clips.set(name, clip);
    const next = controller.actions.get(name) ?? controller.mixer.clipAction(clip);
    controller.actions.set(name, next);
    next.enabled = true;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (controller.current && controller.current !== next) {
        controller.current.crossFadeTo(next, Math.max(0.04, blend), false);
    }
    controller.current = next;
    controller.currentName = name;
    controller.mesh.userData.motionName = name;
    recomputeDuration();
}
export function recomputeDuration() {
    state.duration = state.models.reduce((maximum, model) => {
        const durations = [...model.motion.clips.values()].map((clip) => Number(clip.duration) || 0);
        return Math.max(maximum, ...durations, 0);
    }, 0);
}
function loadAnimationUrl(url, item, name, blend) {
    return new Promise((resolve) => {
        loader.loadAnimation(url, item.mesh, (clip) => {
            playMotion(item.motion, clip, name, blend);
            resolve(true);
        }, undefined, (error) => {
            console.warn(`Motion load failed: ${name}`, error);
            resolve(false);
        });
    });
}
async function defaultIdleObjectUrl() {
    if (cachedDefaultIdleObjectUrl)
        return cachedDefaultIdleObjectUrl;
    const encoded = (await fetch(DEFAULT_IDLE_URL)).text().then((text) => text.trim());
    const binary = atob(await encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
    cachedDefaultIdleObjectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    return cachedDefaultIdleObjectUrl;
}
export async function loadDefaultMotion(item) {
    try {
        const url = await defaultIdleObjectUrl();
        const loaded = await loadAnimationUrl(url, item, DEFAULT_IDLE_NAME, 0.08);
        if (!loaded)
            toast('標準待機VMDを読み込めませんでした');
        return loaded;
    }
    catch (error) {
        console.warn('Default VMD decode failed', error);
        toast('標準待機VMDを読み込めませんでした');
        return false;
    }
}
export function applyMotion(file, item = state.active) {
    if (!item) {
        toast('先にモデルを選択してください');
        return Promise.resolve();
    }
    const url = objectUrl(file);
    if (extension(file) === 'vpd') {
        return new Promise((resolve) => {
            loader.loadVPD(url, false, (pose) => {
                revokeObjectUrl(url);
                loader.poseAsVpd(item.mesh, pose);
                toast(`VPD: ${file.name}`);
                resolve();
            }, undefined, () => {
                revokeObjectUrl(url);
                toast('VPD の読み込みに失敗しました');
                resolve();
            });
        });
    }
    return new Promise((resolve) => {
        loader.loadAnimation(url, item.mesh, (clip) => {
            revokeObjectUrl(url);
            const name = file.name.replace(/\.[^.]+$/, '');
            playMotion(item.motion, clip, name);
            toast(`VMD: ${file.name}（${Math.round(clip.duration * 10) / 10}秒）`);
            resolve();
        }, undefined, () => {
            revokeObjectUrl(url);
            toast('VMD の読み込みに失敗しました');
            resolve();
        });
    });
}
