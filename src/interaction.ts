import * as THREE from 'three';
import { setLifePointer } from './life.js';
import { modelFromObject, setActiveModel, toggleModelSelection } from './models.js';
import {
  beginPhysicsPull,
  enablePhysics,
  pokePhysics,
  resetPhysics,
  updatePhysicsPull,
  type PhysicsPullHandle,
} from './physics.js';
import { camera, canvas, controls, pointer, raycaster, scene, stage } from './scene.js';
import { state } from './state.js';
import type { SceneModel } from './types.js';

interface ModelDragEntry {
  model: SceneModel;
  start: any;
  target: any;
}

interface PickResult {
  model: SceneModel;
  point: any;
  normal: any;
}

let pointerId: number | null = null;
let dragPlane = new THREE.Plane();
let startPoint = new THREE.Vector3();
let modelDragEntries: ModelDragEntry[] = [];
let pullHandle: PhysicsPullHandle | null = null;
let pullTarget = new THREE.Vector3();
let operation: 'none' | 'move' | 'pull' = 'none';

async function ensurePhysics(item: SceneModel): Promise<boolean> {
  // Direct manipulation must be useful even when the Physics tab was not opened first.
  // A runtime may exist while the global simulation is paused, so enable both layers.
  state.physics = true;
  const physicsToggle = document.querySelector<HTMLInputElement>('#physics');
  if (physicsToggle) physicsToggle.checked = true;
  if (!item.physics?.enabled) await enablePhysics(item);
  return Boolean(item.physics?.enabled);
}

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.075, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x3d8df2, transparent: true, opacity: 0.72, depthTest: false }),
);
marker.visible = false;
marker.renderOrder = 1000;
scene.add(marker);

function setPointer(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  setLifePointer(event.clientX, event.clientY);
}

function pick(event: PointerEvent): PickResult | null {
  setPointer(event);
  const hits = raycaster.intersectObjects(
    state.models.filter((model) => model.visible).map((model) => model.mesh),
    true,
  );
  for (const hit of hits) {
    const model = modelFromObject(hit.object);
    if (!model) continue;
    const normal = hit.face?.normal?.clone?.() ?? new THREE.Vector3(0, 0, 1);
    normal.transformDirection(hit.object.matrixWorld).normalize();
    return { model, point: hit.point.clone(), normal };
  }
  return null;
}

function dragPoint(target: any): boolean {
  const world = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragPlane, world)) return false;
  target.copy(stage.worldToLocal(world.clone()));
  return true;
}

function selectPicked(model: SceneModel, event: PointerEvent): void {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    toggleModelSelection(model, !state.selectedModels.includes(model));
  } else {
    setActiveModel(model);
  }
}

async function pokePicked(hit: PickResult): Promise<void> {
  if (!await ensurePhysics(hit.model)) return;
  const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
  const direction = hit.normal.clone().multiplyScalar(-0.35).add(cameraDirection).normalize();
  const affected = pokePhysics(
    hit.model,
    hit.point,
    direction,
    state.interactionSettings.pokeStrength,
    state.interactionSettings.pokeRadius,
  );
  if (affected) {
    marker.position.copy(hit.point);
    marker.visible = true;
    setTimeout(() => { marker.visible = false; }, 130);
  }
}

async function beginPull(hit: PickResult, event: PointerEvent): Promise<void> {
  if (!await ensurePhysics(hit.model)) return;
  pullHandle = beginPhysicsPull(hit.model, hit.point, state.interactionSettings.pullRadius);
  if (!pullHandle) return;
  dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hit.point);
  setPointer(event);
  const world = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragPlane, world)) return;
  pullTarget.copy(world);
  marker.position.copy(hit.point);
  marker.visible = true;
  operation = 'pull';
  controls.enabled = false;
  pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
}

function prepareManipulationSelection(model: SceneModel, event: PointerEvent): void {
  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  if (additive) {
    if (!state.selectedModels.includes(model)) toggleModelSelection(model, true);
    else setActiveModel(model, true);
  } else if (!state.selectedModels.includes(model)) {
    setActiveModel(model);
  } else {
    setActiveModel(model, true);
  }
}

function beginModelMove(hit: PickResult, event: PointerEvent): void {
  prepareManipulationSelection(hit.model, event);
  const models = state.selectedModels.length ? state.selectedModels : [hit.model];
  const worldPoint = new THREE.Vector3();
  hit.model.mesh.getWorldPosition(worldPoint);
  if (state.interactionSettings.groundLock) {
    dragPlane.set(new THREE.Vector3(0, 1, 0), -worldPoint.y);
  } else {
    dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), worldPoint);
  }
  setPointer(event);
  if (!dragPoint(startPoint)) return;
  modelDragEntries = models.map((model) => ({
    model,
    start: model.mesh.position.clone(),
    target: model.mesh.position.clone(),
  }));
  operation = 'move';
  controls.enabled = false;
  pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const rigEdit = document.querySelector<HTMLInputElement>('#rig-edit');
  if (rigEdit?.checked) return;
  const hit = pick(event);
  if (!hit) return;
  switch (state.interactionSettings.mode) {
    case 'select':
      selectPicked(hit.model, event);
      break;
    case 'move':
      beginModelMove(hit, event);
      break;
    case 'poke':
      prepareManipulationSelection(hit.model, event);
      void pokePicked(hit);
      break;
    case 'pull':
      prepareManipulationSelection(hit.model, event);
      void beginPull(hit, event);
      break;
  }
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  setLifePointer(event.clientX, event.clientY);
  if (operation === 'none') return;
  setPointer(event);
  if (operation === 'move') {
    const current = new THREE.Vector3();
    if (!dragPoint(current)) return;
    const delta = current.sub(startPoint);
    if (state.interactionSettings.groundLock) delta.y = 0;
    modelDragEntries.forEach((entry) => entry.target.copy(entry.start).add(delta));
  } else if (operation === 'pull') {
    const world = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, world)) {
      pullTarget.copy(world);
      marker.position.copy(world);
    }
  }
  event.preventDefault();
}

function endOperation(event: PointerEvent): void {
  if (operation === 'none') return;
  if (operation === 'move') modelDragEntries.forEach((entry) => resetPhysics(entry.model));
  operation = 'none';
  modelDragEntries = [];
  pullHandle = null;
  marker.visible = false;
  controls.enabled = true;
  if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  pointerId = null;
  event.preventDefault();
}

export function setupInteraction(): void {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endOperation);
  canvas.addEventListener('pointercancel', endOperation);
  canvas.addEventListener('pointerleave', (event) => {
    if (event.buttons === 0) endOperation(event as PointerEvent);
  });
}

export function updateInteraction(delta: number): void {
  if (operation === 'move') {
    const response = 1 - Math.exp(-Math.max(0, delta) * (8 + state.interactionSettings.dragResponse * 22));
    modelDragEntries.forEach((entry) => entry.model.mesh.position.lerp(entry.target, response));
  } else if (operation === 'pull' && pullHandle) {
    updatePhysicsPull(pullHandle, pullTarget, delta);
  }
}

export function pokeFromRay(sourceRaycaster: any): boolean {
  const hits = sourceRaycaster.intersectObjects(
    state.models.filter((model) => model.visible).map((model) => model.mesh),
    true,
  );
  const hit = hits[0];
  if (!hit) return false;
  const model = modelFromObject(hit.object);
  if (!model?.physics) return false;
  const direction = sourceRaycaster.ray.direction.clone();
  return pokePhysics(model, hit.point, direction, state.interactionSettings.pokeStrength, state.interactionSettings.pokeRadius) > 0;
}
