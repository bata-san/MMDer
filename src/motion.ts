import * as THREE from 'three';
import { extension, objectUrl, revokeObjectUrl, toast } from './dom.js';
import { loader } from './scene.js';
import { state } from './state.js';
import type { MotionController, SceneModel } from './types.js';

export function morphMeshes(root: any): any[] {
  const result: any[] = [];
  root?.traverse((node: any) => {
    if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) result.push(node);
  });
  return result;
}

function defaultIdleClip(mesh: any): any {
  const times = [0, 1, 2, 3, 4];
  const tracks: any[] = [
    new THREE.NumberKeyframeTrack('.position[y]', times, [0, 0.06, 0, -0.04, 0]),
    new THREE.NumberKeyframeTrack('.rotation[y]', times, [0, 0.035, 0, -0.035, 0]),
  ];
  const bones: any[] = [];
  mesh.traverse((node: any) => { if (node.isBone) bones.push(node); });
  const targets = [
    { pattern: /上半身2|upper.?body.?2/i, x: 0.035, y: 0.012 },
    { pattern: /上半身|胸|chest|spine/i, x: 0.055, y: 0.02 },
    { pattern: /首|neck/i, x: 0.03, y: 0.028 },
    { pattern: /頭|head/i, x: 0.022, y: 0.04 },
  ];
  for (const target of targets) {
    const bone = bones.find((node) => target.pattern.test(node.name));
    if (!bone) continue;
    const values: number[] = [];
    const base = bone.quaternion.clone();
    times.forEach((_, index) => {
      const phase = Math.sin(index * Math.PI / 2);
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(phase * target.x, phase * target.y, 0),
      );
      values.push(...base.clone().multiply(offset).normalize().toArray());
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${bone.name}].quaternion`, times, values));
  }
  return new THREE.AnimationClip('Default MMD Idle', 4, tracks);
}

export function createMotionController(mesh: any): MotionController {
  const controller: MotionController = {
    mesh,
    mixer: new THREE.AnimationMixer(mesh),
    clips: new Map(),
    actions: new Map(),
    current: null,
    currentName: '',
    breath: 0,
    head: 0,
    blink: 0,
    nextBlink: 2.5,
    bones: {},
    morphs: [],
  };
  mesh.traverse((node: any) => {
    if (!node.isBone) return;
    if (!controller.bones.chest && /上半身|胸|chest|spine/i.test(node.name)) controller.bones.chest = node;
    if (!controller.bones.head && /頭|head|neck/i.test(node.name)) controller.bones.head = node;
  });
  for (const node of morphMeshes(mesh)) {
    for (const [name, indexValue] of Object.entries(node.morphTargetDictionary as Record<string, number>)) {
      if (!/まばたき|blink|eye.?close/i.test(name)) continue;
      const index = Number(indexValue);
      controller.morphs.push({ node, index, base: node.morphTargetInfluences[index] || 0 });
    }
  }
  playMotion(controller, defaultIdleClip(mesh), 'Default Idle', 0.2);
  return controller;
}

export function playMotion(controller: MotionController, clip: any, name = clip.name || 'VMD', blend = state.motionBlend): void {
  controller.clips.set(name, clip);
  const next = controller.actions.get(name) ?? controller.mixer.clipAction(clip);
  controller.actions.set(name, next);
  next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  if (controller.current && controller.current !== next) {
    controller.current.crossFadeTo(next, Math.max(0.04, blend), false);
  }
  controller.current = next;
  controller.currentName = name;
  controller.mesh.userData.motionName = name;
  recomputeDuration();
}

export function recomputeDuration(): void {
  state.duration = state.models.reduce((maximum, model) => {
    const durations = [...model.motion.clips.values()].map((clip) => clip.duration as number);
    return Math.max(maximum, ...durations, 0);
  }, 0);
}

export function updateLivingMotion(controller: MotionController, delta: number, time: number): void {
  if (!state.livingMotion) return;
  const chest = controller.bones.chest;
  const head = controller.bones.head;
  const phase = Number(controller.mesh.userData.motionPhase ?? 0);
  if (chest) {
    chest.rotation.x -= controller.breath;
    controller.breath = Math.sin(time * 1.35 + phase) * 0.012;
    chest.rotation.x += controller.breath;
  }
  if (head) {
    head.rotation.y -= controller.head;
    controller.head = Math.sin(time * 0.55 + phase * 1.7) * 0.008;
    head.rotation.y += controller.head;
  }
  if (!controller.morphs.length) return;
  controller.blink += delta;
  if (controller.blink > controller.nextBlink) {
    controller.blink = 0;
    controller.nextBlink = 2.8 + Math.random() * 4.5;
  }
  const blink = controller.blink < 0.18 ? Math.sin(Math.PI * controller.blink / 0.18) : 0;
  controller.morphs.forEach(({ node, index, base }) => {
    node.morphTargetInfluences[index] = Math.max(0, Math.min(1, base + blink));
  });
}

export function applyMotion(file: File, item: SceneModel | null = state.active): Promise<void> {
  if (!item) {
    toast('先にモデルを選択してください');
    return Promise.resolve();
  }
  const url = objectUrl(file);
  if (extension(file) === 'vpd') {
    return new Promise((resolve) => {
      loader.loadVPD(url, false, (pose: any) => {
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
    loader.loadAnimation(url, item.mesh, (clip: any) => {
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
