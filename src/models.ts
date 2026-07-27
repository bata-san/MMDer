import * as THREE from 'three';
import { objectUrl, revokeObjectUrl, setNotice, toast } from './dom.js';
import { createLifeController } from './life.js';
import { applyOutlineScale, applyToonSettings, configureMmdMaterials } from './materials.js';
import { createMotionController, loadDefaultMotion, recomputeDuration } from './motion.js';
import { enablePhysics, resetPhysics } from './physics.js';
import { controls, frameObject, loader, scene, stage, transform } from './scene.js';
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
  activeListeners.forEach((listener) => listener(state.active));
  modelsListeners.forEach((listener) => listener());
}

export function setActiveModel(item: SceneModel | null, keepSelection = false): void {
  state.active = item;
  if (!keepSelection) state.selectedModels = item ? [item] : [];
  else if (item && !state.selectedModels.includes(item)) state.selectedModels.push(item);
  setupRigHandles(item);
  emitChanges();
}

export function toggleModelSelection(item: SceneModel, selected: boolean): void {
  if (selected && !state.selectedModels.includes(item)) state.selectedModels.push(item);
  if (!selected) state.selectedModels = state.selectedModels.filter((model) => model !== item);
  if (selected) state.active = item;
  else if (state.active === item) state.active = state.selectedModels.at(-1) ?? null;
  setupRigHandles(state.active);
  emitChanges();
}

export function selectAllModels(): void {
  state.selectedModels = state.models.filter((model) => model.visible);
  state.active ??= state.selectedModels.at(-1) ?? null;
  setupRigHandles(state.active);
  emitChanges();
}

export function clearModelSelection(): void {
  state.selectedModels = [];
  state.active = null;
  setupRigHandles(null);
  emitChanges();
}

export function arrangeModels(): void {
  const visible = state.models.filter((model) => model.visible);
  const columns = Math.max(1, Math.ceil(Math.sqrt(visible.length)));
  const spacing = 2.8;
  visible.forEach((model, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    model.mesh.position.set(
      (column - (Math.min(columns, visible.length) - 1) / 2) * spacing,
      model.mesh.position.y,
      -row * spacing * 0.72,
    );
    resetPhysics(model);
  });
  emitChanges();
}

export function loadModel(file: File): Promise<SceneModel | null> {
  return new Promise((resolve) => {
    setNotice('LOADING MODEL…');
    const url = objectUrl(file);
    loader.load(url, async (mesh: any) => {
      revokeObjectUrl(url);
      mesh.name = file.name;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.traverse((node: any) => {
        if (!node.isMesh) return;
        node.frustumCulled = false;
        node.castShadow = true;
        node.receiveShadow = false;
      });
      configureMmdMaterials(mesh);
      const motion = createMotionController(mesh);
      const item: SceneModel = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        mesh,
        file,
        name: file.name,
        visible: true,
        physics: null,
        motion,
        life: createLifeController(mesh, motion),
      };
      const index = state.models.length;
      mesh.position.x = index * 2.7;
      stage.add(mesh);
      state.models.push(item);
      const defaultLoaded = await loadDefaultMotion(item);
      recomputeDuration();
      applyOutlineScale();
      applyToonSettings();
      if (state.physics) await enablePhysics(item);
      setActiveModel(item);
      if (state.models.length > 1) arrangeModels();
      frameObject(mesh);
      setNotice();
      toast(defaultLoaded ? `${file.name} — 待機・素立ち VMD` : `${file.name} — モーションなし`);
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
  setActiveModel(item, state.selectedModels.includes(item));
  frameObject(item.mesh);
}

export function modelFromObject(object: any): SceneModel | null {
  return state.models.find((model) => {
    let current = object;
    while (current) {
      if (current === model.mesh) return true;
      current = current.parent;
    }
    return false;
  }) ?? null;
}

export function disposeModel(item: SceneModel): void {
  stage.remove(item.mesh);
  item.motion.mixer.stopAllAction();
  item.physics?.engine?.reset?.();
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
  state.selectedModels = state.selectedModels.filter((model) => model !== item);
  recomputeDuration();
  setActiveModel(state.active === item ? state.selectedModels.at(-1) ?? state.models.at(-1) ?? null : state.active, true);
  if (state.models.length > 1) arrangeModels();
  toast(`${item.name} をシーンから削除しました`);
}

export function clearModels(): void {
  state.models.forEach(disposeModel);
  state.models = [];
  state.selectedModels = [];
  state.active = null;
  state.duration = 0;
  state.elapsed = 0;
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
    bones.find((bone) => /上半身2|胸|chest|spine2/i.test(bone.name))
      ?? bones.find((bone) => /上半身|chest|spine/i.test(bone.name)),
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

export function attachRigHandleFromPointer(
  clientX: number,
  clientY: number,
  raycaster: any,
  pointer: any,
  canvas: HTMLCanvasElement,
): void {
  const rect = canvas.getBoundingClientRect();
  pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, (controls as any).object);
  const hit = raycaster.intersectObjects(state.rigHandles.filter((handle) => handle.visible), false)[0];
  if (hit) transform.attach(hit.object.userData.bone);
}
