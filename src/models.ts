import * as THREE from 'three';
import { objectUrl, revokeObjectUrl, setNotice, toast } from './dom.js';
import { applyOutlineScale, applySkinSettings, configureMmdMaterials } from './materials.js';
import { createMotionController, recomputeDuration } from './motion.js';
import { controls, frameObject, loader, scene, transform } from './scene.js';
import { state } from './state.js';
import type { SceneModel } from './types.js';

export type ActiveModelListener = (model: SceneModel | null) => void;
const activeListeners = new Set<ActiveModelListener>();
const modelsListeners = new Set<() => void>();

export function onActiveModelChange(listener: ActiveModelListener): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

export function onModelsChange(listener: () => void): () => void {
  modelsListeners.add(listener);
  return () => modelsListeners.delete(listener);
}

function emitChanges(): void {
  modelsListeners.forEach((listener) => listener());
  activeListeners.forEach((listener) => listener(state.active));
}

export function setActiveModel(item: SceneModel | null): void {
  state.active = item;
  setupRigHandles(item);
  activeListeners.forEach((listener) => listener(item));
  modelsListeners.forEach((listener) => listener());
}

export function loadModel(file: File): Promise<SceneModel | null> {
  return new Promise((resolve) => {
    setNotice('LOADING MODEL…');
    const url = objectUrl(file);
    loader.load(url, (mesh: any) => {
      revokeObjectUrl(url);
      mesh.name = file.name;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.userData.motionPhase = Math.random() * Math.PI * 2;
      mesh.traverse((node: any) => {
        if (!node.isMesh) return;
        node.frustumCulled = false;
        node.castShadow = true;
        node.receiveShadow = false;
      });
      configureMmdMaterials(mesh);
      const item: SceneModel = {
        mesh,
        file,
        name: file.name,
        visible: true,
        physics: null,
        motion: createMotionController(mesh),
      };
      mesh.position.x = state.models.length * 2.7;
      scene.add(mesh);
      state.models.push(item);
      applyOutlineScale();
      applySkinSettings();
      setActiveModel(item);
      frameObject(mesh);
      setNotice();
      toast(`${file.name} — Default MMD Idle`);
      resolve(item);
    }, undefined, (error: unknown) => {
      revokeObjectUrl(url);
      console.error(error);
      setNotice();
      toast(`${file.name} を読めませんでした。コンソールを確認してください`);
      resolve(null);
    });
  });
}

export function focusModel(item: SceneModel): void {
  setActiveModel(item);
  frameObject(item.mesh);
}

export function disposeModel(item: SceneModel): void {
  scene.remove(item.mesh);
  item.motion.mixer.stopAllAction();
  item.mesh.traverse((node: any) => {
    node.geometry?.dispose();
    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material: any) => material.dispose());
  });
}

export function removeModel(item: SceneModel): void {
  disposeModel(item);
  state.models = state.models.filter((model) => model !== item);
  recomputeDuration();
  setActiveModel(state.active === item ? state.models.at(-1) ?? null : state.active);
  toast(`${item.name} をシーンから削除しました`);
}

export function clearModels(): void {
  state.models.forEach(disposeModel);
  state.models = [];
  state.active = null;
  state.duration = 0;
  setActiveModel(null);
}

function setupRigHandles(item: SceneModel | null): void {
  state.rigHandles.forEach((handle) => scene.remove(handle));
  state.rigHandles = [];
  transform.detach();
  if (!item) return;
  const bones: any[] = [];
  item.mesh.traverse((node: any) => { if (node.isBone) bones.push(node); });
  const chosen = [
    bones.find((bone) => /上半身|chest|spine/i.test(bone.name)),
    bones.find((bone) => /腰|センター|hips|pelvis/i.test(bone.name)),
  ].filter(Boolean);
  chosen.forEach((bone, index) => {
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshBasicMaterial({ color: index ? 0x2a7de1 : 0xe15c2a, depthTest: false }),
    );
    handle.userData.bone = bone;
    handle.visible = false;
    handle.renderOrder = 999;
    scene.add(handle);
    state.rigHandles.push(handle);
  });
}

export function updateRigHandles(): void {
  state.rigHandles.forEach((handle) => handle.userData.bone.getWorldPosition(handle.position));
}

export function setRigEditing(enabled: boolean): void {
  state.rigHandles.forEach((handle) => { handle.visible = enabled; });
  transform.visible = enabled;
  if (!enabled) transform.detach();
}

export function attachRigHandleFromPointer(clientX: number, clientY: number, raycaster: any, pointer: any, canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, (controls as any).object);
  const hit = raycaster.intersectObjects(state.rigHandles.filter((handle) => handle.visible), false)[0];
  if (hit) transform.attach(hit.object.userData.bone);
}
