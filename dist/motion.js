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
function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}
function makeLoopFriendlyClip(source, blendDuration) {
    const clip = source.clone();
    const duration = Number(clip.duration) || 0;
    if (duration <= 0 || blendDuration <= 0)
        return clip;
    clip.tracks.forEach((track) => {
        const times = track.times;
        const values = track.values;
        const count = times.length;
        const stride = track.getValueSize?.() ?? Math.floor(values.length / Math.max(1, count));
        if (count < 2 || stride <= 0)
            return;
        const trackEnd = Number(times[count - 1]);
        const seam = Math.min(blendDuration, trackEnd * 0.3);
        if (seam <= 0)
            return;
        const seamStart = trackEnd - seam;
        const first = Array.from(values.slice(0, stride));
        const quaternionTrack = track instanceof THREE.QuaternionKeyframeTrack || (stride === 4 && /quaternion$/i.test(track.name));
        for (let key = 0; key < count; key += 1) {
            const time = Number(times[key]);
            if (time < seamStart)
                continue;
            const alpha = smoothstep((time - seamStart) / seam);
            const offset = key * stride;
            if (quaternionTrack) {
                const from = new THREE.Quaternion().fromArray(values, offset);
                const to = new THREE.Quaternion().fromArray(first, 0);
                from.slerp(to, alpha).normalize().toArray(values, offset);
            }
            else {
                for (let component = 0; component < stride; component += 1) {
                    const current = Number(values[offset + component]);
                    values[offset + component] = current + (first[component] - current) * alpha;
                }
            }
        }
        const lastOffset = (count - 1) * stride;
        for (let component = 0; component < stride; component += 1)
            values[lastOffset + component] = first[component];
    });
    clip.name = source.name;
    return clip;
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
export function playMotion(controller, sourceClip, name = sourceClip.name || 'VMD', blend = state.motionBlend, loopFriendly = false, resetTimeline = true) {
    const clip = loopFriendly ? makeLoopFriendlyClip(sourceClip, state.loopBlend) : sourceClip;
    controller.clips.set(name, clip);
    const next = controller.mixer.clipAction(clip);
    controller.actions.set(name, next);
    next.enabled = true;
    next.reset();
    next.setLoop(state.loop ? THREE.LoopRepeat : THREE.LoopOnce, state.loop ? Infinity : 1);
    next.clampWhenFinished = !state.loop;
    next.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    const previous = controller.current;
    if (previous && previous !== next) {
        previous.stopFading();
        next.stopFading();
        previous.crossFadeTo(next, Math.max(0.04, blend), true);
    }
    controller.current = next;
    controller.currentName = name;
    controller.mesh.userData.motionName = name;
    if (resetTimeline)
        state.elapsed = 0;
    else
        next.time = state.loop ? state.elapsed % Math.max(clip.duration, 0.001) : Math.min(state.elapsed, clip.duration);
    recomputeDuration();
}
export function setMotionLooping(enabled) {
    state.models.forEach((model) => {
        const action = model.motion.current;
        if (!action)
            return;
        action.setLoop(enabled ? THREE.LoopRepeat : THREE.LoopOnce, enabled ? Infinity : 1);
        action.clampWhenFinished = !enabled;
    });
}
export function seekMotions(time) {
    state.models.forEach((model) => {
        const action = model.motion.current;
        if (action) {
            const duration = Number(action.getClip?.().duration) || state.duration || 1;
            action.time = state.loop ? time % duration : Math.min(time, duration);
            action.paused = false;
        }
        model.motion.mixer.update(0);
    });
}
export function synchronizeMotions(reset = false) {
    if (reset)
        state.elapsed = 0;
    seekMotions(state.elapsed);
}
export function motionControlsMorph(controller, name, index) {
    const tracks = controller.current?.getClip?.().tracks ?? [];
    const byName = `morphTargetInfluences[${name}]`;
    const byIndex = `morphTargetInfluences[${index}]`;
    return tracks.some((track) => {
        const path = String(track.name);
        return path.includes(byName) || path.includes(byIndex);
    });
}
export function motionControlsBone(controller, name) {
    const tracks = controller.current?.getClip?.().tracks ?? [];
    return tracks.some((track) => String(track.name).includes(`bones[${name}]`));
}
export function recomputeDuration() {
    state.duration = state.models.reduce((maximum, model) => {
        const duration = Number(model.motion.current?.getClip?.().duration) || 0;
        return Math.max(maximum, duration);
    }, 0);
}
function loadAnimationUrl(url, item, name, blend, loopFriendly = false, resetTimeline = true) {
    return new Promise((resolve) => {
        loader.loadAnimation(url, item.mesh, (clip) => {
            playMotion(item.motion, clip, name, blend, loopFriendly, resetTimeline);
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
        const resetTimeline = state.models.length <= 1;
        const loaded = await loadAnimationUrl(url, item, DEFAULT_IDLE_NAME, 0.08, true, resetTimeline);
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
export function motionTargets(explicit = null) {
    if (explicit)
        return [explicit];
    if (state.motionScope === 'all')
        return [...state.models];
    if (state.motionScope === 'selected' && state.selectedModels.length)
        return [...state.selectedModels];
    return state.active ? [state.active] : [];
}
export async function applyMotion(file, explicit = null) {
    const targets = motionTargets(explicit);
    if (!targets.length) {
        toast('先にモデルを選択してください');
        return;
    }
    if (extension(file) === 'vpd') {
        const url = objectUrl(file);
        await new Promise((resolve) => {
            loader.loadVPD(url, false, (pose) => {
                revokeObjectUrl(url);
                targets.forEach((item) => loader.poseAsVpd(item.mesh, pose));
                toast(`VPD: ${file.name} → ${targets.length} model${targets.length === 1 ? '' : 's'}`);
                resolve();
            }, undefined, () => {
                revokeObjectUrl(url);
                toast('VPD の読み込みに失敗しました');
                resolve();
            });
        });
        return;
    }
    let succeeded = 0;
    for (const item of targets) {
        const url = objectUrl(file);
        const ok = await new Promise((resolve) => {
            loader.loadAnimation(url, item.mesh, (clip) => {
                revokeObjectUrl(url);
                playMotion(item.motion, clip, file.name.replace(/\.[^.]+$/, ''), state.motionBlend, state.loop && state.loopBlend > 0, false);
                resolve(true);
            }, undefined, () => {
                revokeObjectUrl(url);
                resolve(false);
            });
        });
        if (ok)
            succeeded += 1;
    }
    if (succeeded) {
        state.elapsed = 0;
        synchronizeMotions(true);
    }
    toast(succeeded
        ? `VMD: ${file.name} → ${succeeded}/${targets.length} models`
        : 'VMD の読み込みに失敗しました');
}
