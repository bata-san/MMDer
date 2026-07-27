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
        const quaternionTrack = track instanceof THREE.QuaternionKeyframeTrack || stride === 4 && /quaternion$/i.test(track.name);
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
        for (let component = 0; component < stride; component += 1) {
            values[lastOffset + component] = first[component];
        }
    });
    clip.name = source.name;
    return clip;
}
function findBone(mesh, pattern) {
    let match = null;
    mesh.traverse((node) => {
        if (!match && node.isBone && pattern.test(node.name))
            match = node;
    });
    return match;
}
function quaternionTrack(name, times, rotations) {
    const values = [];
    rotations.forEach(([x, y, z]) => {
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
        values.push(...quaternion.toArray());
    });
    return new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, times, values);
}
function createProceduralClip(mesh) {
    const duration = 4;
    const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
    const tracks = [];
    const upper2 = findBone(mesh, /上半身2|upper.?body.?2/i);
    const upper = findBone(mesh, /上半身|胸|chest|spine/i);
    const neck = findBone(mesh, /首|neck/i);
    if (upper) {
        tracks.push(quaternionTrack(upper.name, times, [
            [0, 0, 0], [0.003, 0, 0.001], [0.006, 0, 0.002], [0.003, 0, 0.001],
            [0, 0, 0], [-0.002, 0, -0.001], [-0.004, 0, -0.002], [-0.002, 0, -0.001], [0, 0, 0],
        ]));
    }
    if (upper2) {
        tracks.push(quaternionTrack(upper2.name, times, [
            [0, 0, 0], [0.002, 0.001, 0], [0.004, 0.002, 0], [0.002, 0.001, 0],
            [0, 0, 0], [-0.001, -0.001, 0], [-0.003, -0.002, 0], [-0.001, -0.001, 0], [0, 0, 0],
        ]));
    }
    if (neck) {
        tracks.push(quaternionTrack(neck.name, times, [
            [0, 0, 0], [0, 0.001, 0], [0.001, 0.002, 0], [0, 0.001, 0],
            [0, 0, 0], [0, -0.001, 0], [-0.001, -0.002, 0], [0, -0.001, 0], [0, 0, 0],
        ]));
    }
    if (!tracks.length)
        return null;
    const clip = new THREE.AnimationClip('Procedural breathing layer', duration, tracks);
    THREE.AnimationUtils.makeClipAdditive(clip, 0, clip, 30);
    return clip;
}
function blinkBindings(mesh) {
    const bindings = [];
    morphMeshes(mesh).forEach((node) => {
        Object.entries(node.morphTargetDictionary).forEach(([name, index]) => {
            if (/まばたき|blink|eye.?close/i.test(name))
                bindings.push({ node, index: Number(index) });
        });
    });
    return bindings;
}
export function createMotionController(mesh) {
    const mixer = new THREE.AnimationMixer(mesh);
    const proceduralClip = createProceduralClip(mesh);
    const proceduralAction = proceduralClip ? mixer.clipAction(proceduralClip) : null;
    if (proceduralAction) {
        proceduralAction.setLoop(THREE.LoopRepeat, Infinity);
        proceduralAction.setEffectiveWeight(state.proceduralMotion ? state.proceduralWeight : 0);
        proceduralAction.play();
    }
    return {
        mesh,
        mixer,
        clips: new Map(),
        actions: new Map(),
        current: null,
        currentName: '',
        proceduralClip,
        proceduralAction,
        blinkBindings: blinkBindings(mesh),
        blinkElapsed: 0,
        nextBlinkAt: 2.5 + Math.random() * 2,
    };
}
export function playMotion(controller, sourceClip, name = sourceClip.name || 'VMD', blend = state.motionBlend, loopFriendly = false) {
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
    state.elapsed = 0;
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
        const controller = model.motion;
        const action = controller.current;
        if (action) {
            const duration = Number(action.getClip?.().duration) || state.duration || 1;
            action.time = state.loop ? time % duration : Math.min(time, duration);
            action.paused = false;
        }
        if (controller.proceduralAction && controller.proceduralClip) {
            controller.proceduralAction.time = time % controller.proceduralClip.duration;
        }
        controller.mixer.update(0);
    });
}
export function setProceduralMotion(enabled, weight = state.proceduralWeight) {
    state.proceduralMotion = enabled;
    state.proceduralWeight = weight;
    state.models.forEach((model) => {
        const action = model.motion.proceduralAction;
        if (!action)
            return;
        action.enabled = true;
        action.setEffectiveWeight(enabled ? weight : 0);
    });
}
export function updateProceduralMotion(controller, delta) {
    if (controller.proceduralAction) {
        controller.proceduralAction.setEffectiveWeight(state.proceduralMotion ? state.proceduralWeight : 0);
    }
    if (!state.proceduralMotion || !controller.blinkBindings.length)
        return;
    controller.blinkElapsed += delta;
    const blinkAge = controller.blinkElapsed - controller.nextBlinkAt;
    if (blinkAge < 0)
        return;
    if (blinkAge > 0.18) {
        controller.nextBlinkAt = controller.blinkElapsed + 2.8 + Math.random() * 4.2;
        return;
    }
    const phase = Math.sin(Math.PI * blinkAge / 0.18);
    const strength = Math.min(0.9, state.proceduralWeight * 4.2);
    controller.blinkBindings.forEach(({ node, index }) => {
        const base = Number(node.morphTargetInfluences[index]) || 0;
        node.morphTargetInfluences[index] = base + (1 - base) * phase * strength;
    });
}
export function recomputeDuration() {
    state.duration = state.models.reduce((maximum, model) => {
        const duration = Number(model.motion.current?.getClip?.().duration) || 0;
        return Math.max(maximum, duration);
    }, 0);
}
function loadAnimationUrl(url, item, name, blend, loopFriendly = false) {
    return new Promise((resolve) => {
        loader.loadAnimation(url, item.mesh, (clip) => {
            playMotion(item.motion, clip, name, blend, loopFriendly);
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
        const loaded = await loadAnimationUrl(url, item, DEFAULT_IDLE_NAME, 0.08, true);
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
