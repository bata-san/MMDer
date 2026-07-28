import * as THREE from 'three';
import { setNotice } from './dom.js';
import { pokeFromRay } from './interaction.js';
import { setLifeXrGazeTarget } from './life.js';
import { morphMeshes } from './motion.js';
import { modelFromObject, setActiveModel } from './models.js';
import { controls, renderer, resizeScene, scene, stage } from './scene.js';
import { state } from './state.js';

type XrAction = 'previous' | 'next' | 'down' | 'up' | 'reset';

const xrRaycaster = new THREE.Raycaster();
const xrUi = new THREE.Group();
xrUi.name = 'XR_MORPH_PANEL';
xrUi.visible = false;
let morphIndex = 0;
let refreshTimer = 0;
let xrScaleModelId: string | null = null;
const HUMAN_REFERENCE_HEIGHT_METERS = 1.65;

function fitStageToRealWorld(): void {
  const model = state.active ?? state.models.find((item) => item.visible);
  if (!model) return;
  // PMX has no dependable metres metadata. Its rendered full-body bounding
  // box is the useful physical reference: map it to an adult standing height,
  // place its lowest point on the XR local floor, and keep it two metres away.
  stage.scale.setScalar(1);
  stage.position.set(0, 0, 0);
  stage.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model.mesh);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height < 0.01) return;
  const scale = HUMAN_REFERENCE_HEIGHT_METERS / height;
  const center = bounds.getCenter(new THREE.Vector3());
  stage.scale.setScalar(scale);
  stage.position.set(-center.x * scale, -bounds.min.y * scale, -2);
  stage.updateWorldMatrix(true, true);
  xrScaleModelId = model.id;
}

function setXrStageMode(enabled: boolean): void {
  if (enabled) {
    stage.scale.setScalar(0.1);
    stage.position.set(0, 0, -2);
  } else {
    stage.scale.setScalar(1);
    stage.position.set(0, 0, 0);
  }
  stage.updateMatrixWorld(true);
}

function controllerRay(controller: any): any {
  const rotation = new THREE.Matrix4().extractRotation(controller.matrixWorld);
  xrRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  xrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation).normalize();
  return xrRaycaster;
}

function labelTexture(lines: string[], accent = '#9ed6ff'): any {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07111e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = '#f0f8ff';
  ctx.font = 'bold 31px system-ui, sans-serif';
  ctx.textAlign = 'center';
  lines.slice(0, 2).forEach((line, index) => ctx.fillText(line, 256, 45 + index * 43));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function panelButton(action: XrAction, x: number, y: number, label: string): void {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.065),
    new THREE.MeshBasicMaterial({ map: labelTexture([label]), transparent: true, side: THREE.DoubleSide }),
  );
  mesh.position.set(x, y, 0.004);
  mesh.userData.xrAction = action;
  xrUi.add(mesh);
}

function morphEntries(): Array<{ name: string; bindings: Array<{ mesh: any; index: number }> }> {
  const entries = new Map<string, Array<{ mesh: any; index: number }>>();
  morphMeshes(state.active?.mesh).forEach((mesh: any) => {
    Object.entries(mesh.morphTargetDictionary ?? {}).forEach(([name, raw]) => {
      const list = entries.get(name) ?? [];
      list.push({ mesh, index: Number(raw) });
      entries.set(name, list);
    });
  });
  return [...entries.entries()]
    .map(([name, bindings]) => ({ name, bindings }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function selectedMorph(): { name: string; bindings: Array<{ mesh: any; index: number }> } | null {
  const entries = morphEntries();
  if (!entries.length) return null;
  morphIndex = THREE.MathUtils.euclideanModulo(morphIndex, entries.length);
  return entries[morphIndex];
}

function selectedValue(entry: NonNullable<ReturnType<typeof selectedMorph>>): number {
  return entry.bindings.reduce((sum, { mesh, index }) => sum + Number(mesh.morphTargetInfluences?.[index] ?? 0), 0) / entry.bindings.length;
}

function refreshMorphPanel(): void {
  const title = xrUi.getObjectByName('XR_MORPH_TITLE') as any;
  if (!title) return;
  const entry = selectedMorph();
  const lines = entry
    ? ['モーフ', entry.name.length > 23 ? `${entry.name.slice(0, 22)}…` : entry.name]
    : ['モーフ', 'モデルを選択してください'];
  const material = title.material as any;
  material.map?.dispose();
  material.map = labelTexture(lines, entry ? '#67d7a7' : '#f6bd60');
  material.needsUpdate = true;
  const value = xrUi.getObjectByName('XR_MORPH_VALUE') as any;
  if (!value) return;
  const valueMaterial = value.material as any;
  valueMaterial.map?.dispose();
  valueMaterial.map = labelTexture([entry ? `値 ${selectedValue(entry).toFixed(2)}` : '値 --'], '#e4c1ff');
  valueMaterial.needsUpdate = true;
}

function haptic(controller: any): void {
  const session = renderer.xr.getSession();
  const source = session?.inputSources?.find((input: any) => input.targetRaySpace === controller.userData.xrTargetRaySpace);
  source?.gamepad?.hapticActuators?.[0]?.pulse?.(0.28, 28).catch?.(() => undefined);
}

function applyXrAction(action: XrAction, controller: any): boolean {
  const entries = morphEntries();
  if (!entries.length) return false;
  if (action === 'previous') morphIndex -= 1;
  if (action === 'next') morphIndex += 1;
  const entry = selectedMorph();
  if (!entry) return false;
  if (action === 'down' || action === 'up' || action === 'reset') {
    const current = selectedValue(entry);
    const value = action === 'reset' ? 0 : THREE.MathUtils.clamp(current + (action === 'up' ? 0.1 : -0.1), 0, 1);
    entry.bindings.forEach(({ mesh, index }) => { mesh.morphTargetInfluences[index] = value; });
  }
  refreshMorphPanel();
  haptic(controller);
  return true;
}

function hitXrUi(controller: any): boolean {
  if (!xrUi.visible) return false;
  const hit = controllerRay(controller).intersectObjects(xrUi.children, true)[0];
  const object = hit?.object;
  const action = object?.userData.xrAction as XrAction | undefined;
  return action ? applyXrAction(action, controller) : false;
}

function selectModelFromRay(controller: any): boolean {
  const hits = controllerRay(controller).intersectObjects(
    state.models.filter((model) => model.visible).map((model) => model.mesh),
    true,
  );
  const model = hits.length ? modelFromObject(hits[0].object) : null;
  if (!model) return false;
  setActiveModel(model);
  morphIndex = 0;
  refreshMorphPanel();
  haptic(controller);
  return true;
}

function buildMorphPanel(): void {
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.36),
    new THREE.MeshBasicMaterial({ color: 0x07111e, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  background.position.z = -0.002;
  xrUi.add(background);
  const title = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
  title.name = 'XR_MORPH_TITLE';
  title.position.set(0, 0.105, 0.004);
  xrUi.add(title);
  const value = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.06), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }));
  value.name = 'XR_MORPH_VALUE';
  value.position.set(0, -0.005, 0.004);
  xrUi.add(value);
  panelButton('previous', -0.17, -0.005, '前');
  panelButton('next', 0.17, -0.005, '次');
  panelButton('down', -0.17, -0.105, '− 0.1');
  panelButton('up', 0.17, -0.105, '+ 0.1');
  panelButton('reset', 0, -0.19, '選択モーフを 0');
  const hint = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.045), new THREE.MeshBasicMaterial({ map: labelTexture(['右トリガー: 操作 / 左グリップ: 隠す'], '#738ba6'), transparent: true, side: THREE.DoubleSide }));
  hint.position.set(0, -0.265, 0.004);
  xrUi.add(hint);
  refreshMorphPanel();
}

function createControllerRay(index: number): void {
  const controller = renderer.xr.getController(index);
  controller.userData.xrTargetRaySpace = controller;
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const ray = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x75c7ff, transparent: true, opacity: 0.82 }));
  ray.name = `XR_CONTROLLER_RAY_${index}`;
  ray.scale.z = 4;
  controller.add(ray);
  controller.addEventListener('select', () => {
    if (hitXrUi(controller)) return;
    if (state.interactionSettings.mode === 'select' && selectModelFromRay(controller)) return;
    if (state.interactionSettings.mode === 'poke' && pokeFromRay(controllerRay(controller))) haptic(controller);
  });
  controller.addEventListener('squeezestart', () => {
    xrUi.visible = !xrUi.visible;
    if (xrUi.visible) refreshMorphPanel();
    haptic(controller);
  });
  scene.add(controller);
}

function createXrConnectButton(): HTMLElement {
  const button = document.createElement('button');
  button.id = 'xr-button';
  button.type = 'button';
  button.textContent = 'VRゴーグルを確認中…';
  Object.assign(button.style, {
    width: 'auto', minWidth: '132px', height: '28px', padding: '0 10px',
    margin: '0', borderRadius: '4px', fontSize: '11px', lineHeight: '26px',
  });
  const xr = (navigator as any).xr;
  if (!xr) {
    button.disabled = true;
    button.textContent = 'VR未対応ブラウザ';
    return button;
  }
  void xr.isSessionSupported('immersive-vr').then((supported: boolean) => {
    if (!supported) {
      button.disabled = true;
      button.textContent = 'VRゴーグル未検出';
      return;
    }
    button.textContent = 'VRゴーグルに接続';
    button.disabled = false;
  }).catch(() => {
    button.disabled = true;
    button.textContent = 'VRを利用できません';
  });
  button.addEventListener('click', () => {
    if (renderer.xr.isPresenting) return;
    // Must be requested directly from this user gesture. The browser routes
    // the immersive session to the wired HMD it has registered with WebXR.
    void xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    }).then((session: any) => renderer.xr.setSession(session)).catch((error: unknown) => {
      console.warn('Could not connect to the VR headset.', error);
      setNotice('VRゴーグルへ接続できません。OpenXR / SteamVR / Link 接続を確認してください。');
    });
  });
  return button;
}

export function updateXr(delta: number): void {
  if (!state.xrPresenting) return;
  if ((state.active?.id ?? null) !== xrScaleModelId) fitStageToRealWorld();
  // renderer.xr supplies the headset pose in metres in local-floor space.
  const viewer = renderer.xr.getCamera(new THREE.PerspectiveCamera());
  const viewerPosition = viewer.getWorldPosition(new THREE.Vector3());
  setLifeXrGazeTarget(viewerPosition);
  if (!xrUi.visible) return;
  refreshTimer += delta;
  if (refreshTimer >= 0.18) {
    refreshTimer = 0;
    refreshMorphPanel();
  }
}

export function setupXr(): void {
  buildMorphPanel();
  const leftGrip = renderer.xr.getControllerGrip(0);
  leftGrip.add(xrUi);
  xrUi.position.set(0, 0.08, -0.26);
  xrUi.rotation.x = -0.35;
  scene.add(leftGrip);
  createControllerRay(0);
  createControllerRay(1);
  const xrButton = createXrConnectButton();
  document.querySelector('.status')?.append(xrButton);
  renderer.xr.addEventListener('sessionstart', () => {
    state.xrPresenting = true;
    // Keep desktop controls and the React editor live. The headset is a
    // presentation surface for the exact same scene, not a separate editor.
    controls.enabled = true;
    setXrStageMode(true);
    fitStageToRealWorld();
    renderer.setPixelRatio(1);
    renderer.xr.setFoveation?.(1);
    xrUi.visible = true;
    refreshMorphPanel();
    xrButton.textContent = 'VR表示中';
    window.dispatchEvent(new Event('mmdlab-xr-change'));
    setNotice('VR表示中 — PCで準備・編集した内容をヘッドセットへ即時反映');
  });
  renderer.xr.addEventListener('sessionend', () => {
    state.xrPresenting = false;
    controls.enabled = true;
    xrUi.visible = false;
    setLifeXrGazeTarget(null);
    xrScaleModelId = null;
    setXrStageMode(false);
    resizeScene();
    xrButton.textContent = 'VRゴーグルに接続';
    window.dispatchEvent(new Event('mmdlab-xr-change'));
    setNotice();
  });
}
