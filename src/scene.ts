import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { $, objectUrl, revokeObjectUrl, setNotice, toast } from './dom.js';
import { state } from './state.js';

const canvas = $('#scene') as HTMLCanvasElement;
const desktopPixelRatio = (): number => Math.min(window.devicePixelRatio, 1.75) * state.renderScale;

export const clock = new THREE.Clock();
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1ece5);

export const stage = new THREE.Group();
stage.name = 'MMD_STAGE';
scene.add(stage);

export const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 1000);
camera.position.set(8, 5.4, 12);

export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.setPixelRatio(desktopPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

export const effect = new OutlineEffect(renderer, {
  defaultThickness: 0.0028,
  defaultColor: [0.035, 0.04, 0.055],
  defaultAlpha: 0.78,
  defaultKeepAlive: true,
});

export const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 4, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.ROTATE,
  RIGHT: THREE.MOUSE.PAN,
};
controls.screenSpacePanning = true;

let blenderPan: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 1 || !event.shiftKey) return;
  blenderPan = { x: event.clientX, y: event.clientY };
  controls.enabled = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
window.addEventListener('pointermove', (event) => {
  if (!blenderPan) return;
  const dx = event.clientX - blenderPan.x;
  const dy = event.clientY - blenderPan.y;
  const distance = camera.position.distanceTo(controls.target) * 0.0015;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  camera.position.addScaledVector(right, -dx * distance).addScaledVector(up, dy * distance);
  controls.target.addScaledVector(right, -dx * distance).addScaledVector(up, dy * distance);
  blenderPan = { x: event.clientX, y: event.clientY };
});
window.addEventListener('pointerup', () => {
  if (!blenderPan) return;
  blenderPan = null;
  controls.enabled = true;
});

export const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('translate');
transform.visible = false;
transform.addEventListener('dragging-changed', (event: { value: boolean }) => {
  controls.enabled = !event.value;
});
scene.add(transform);

export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();

scene.add(new THREE.AmbientLight(0xfff4e8, 0.22));
export const environmentLight = new THREE.HemisphereLight(0xf7f5f0, 0xb8c2d2, 0.18);
scene.add(environmentLight);

const key = new THREE.DirectionalLight(0xffd7b0, 1.18);
key.position.set(3, 5, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = key.shadow.camera.bottom = -16;
key.shadow.camera.right = key.shadow.camera.top = 16;
key.shadow.bias = -0.00012;
key.shadow.normalBias = 0.035;
key.shadow.radius = 2;
scene.add(key);

const fill = new THREE.DirectionalLight(0xcfe1ff, 0.28);
fill.position.set(-5, 3, 1);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xfff2df, 0.52);
rim.position.set(-2, 5, -6);
scene.add(rim);

export const floor = new THREE.Mesh(
  new THREE.CircleGeometry(20, 64),
  new THREE.MeshStandardMaterial({ color: 0xe9e1d8, roughness: 0.88, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.material.userData.outlineParameters = { visible: false };
stage.add(floor);

export const grid = new THREE.GridHelper(32, 32, 0xc8b9ad, 0xd9cec4);
grid.position.y = 0.012;
grid.material.userData.outlineParameters = { visible: false };
stage.add(grid);

const textureManager = new THREE.LoadingManager();
textureManager.setURLModifier((request: string) => {
  const clean = decodeURIComponent(request).replace(/\\/g, '/').replace(/^.*mmd\//, '');
  const asset = state.assets.find((item) =>
    item.kind === 'texture' &&
    (item.path.endsWith(clean) || clean.endsWith(item.path) || item.name === clean.split('/').pop()),
  );
  return asset ? objectUrl(asset.file) : request;
});

export const loader = new MMDLoader(textureManager);
loader.setResourcePath('mmd/');
export const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

export const ammoReady: Promise<any | null> = new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/libs/ammo.wasm.js';
  script.onload = async () => {
    try {
      const ammo = await window.Ammo?.();
      if (ammo) window.Ammo = ammo;
      resolve(ammo ?? null);
    } catch {
      resolve(null);
    }
  };
  script.onerror = () => resolve(null);
  document.head.append(script);
});

export function frameObject(object: any): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size.y * 0.62, size.y * 0.28, size.y * 1.45));
  controls.update();
}

function applyEnvironmentLight(): void {
  environmentLight.intensity = state.environment ? 0.12 + state.environmentStrength * 0.32 : 0.18;
}

export function applyHdr(texture: any, label: string, notify = true): void {
  const environment = pmrem.fromEquirectangular(texture).texture;
  texture.dispose();
  state.environment?.dispose();
  state.environment = environment;
  scene.environment = environment;
  scene.environmentIntensity = state.environmentStrength;
  applyEnvironmentLight();
  scene.background = new THREE.Color(0xe9edf2);
  const checkbox = document.querySelector<HTMLInputElement>('#show-hdri');
  if (checkbox) checkbox.checked = false;
  $('#hdri-name').textContent = label;
  if (notify) toast(`HDRI: ${label}`);
}

export function loadHdr(file: File): void {
  setNotice('LOADING HDRI…');
  const url = objectUrl(file);
  new RGBELoader().load(url, (texture: any) => {
    revokeObjectUrl(url);
    applyHdr(texture, file.name);
    setNotice();
  }, undefined, () => {
    revokeObjectUrl(url);
    setNotice();
    toast('HDRI の読み込みに失敗しました');
  });
}

export function setEnvironmentStrength(value: number): void {
  state.environmentStrength = value;
  scene.environmentIntensity = value;
  applyEnvironmentLight();
}

export function setRenderScale(value: number): void {
  state.renderScale = Math.max(0.7, Math.min(1, value));
  if (!state.xrPresenting) renderer.setPixelRatio(desktopPixelRatio());
}

export function resizeScene(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (!state.xrPresenting) renderer.setPixelRatio(desktopPixelRatio());
  renderer.setSize(innerWidth, innerHeight);
}

export function renderScene(): void {
  if (state.outline && !state.xrPresenting) effect.render(scene, camera);
  else renderer.render(scene, camera);
}

export function loadDefaultHdr(): void {
  new RGBELoader().load(
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/white_studio_05_1k.hdr',
    (texture: any) => applyHdr(texture, 'Poly Haven — White Studio 05 (CC0)', false),
    undefined,
    () => { $('#hdri-name').textContent = '標準 HDRI を読み込めませんでした'; },
  );
}

export { canvas };
