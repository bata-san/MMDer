import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { initCore, parseVmdSectionInventory } from '@yohawing/three-mmd-loader/parser';
import { sampleMmdCameraTrack, sampleMmdLightTrack } from '@yohawing/three-mmd-loader/runtime';
import {
  ThreeMmdLoader,
  applyMmdCameraStateToThreeCamera,
  applyMmdLightStateToThreeDirectionalLight,
  createMmdTextureMapFromFiles,
  disposeMmdModel,
  findMmdModelFiles,
  findMmdMotionFiles,
  syncMmdSpecularDirection,
} from '@yohawing/three-mmd-loader/three';

const MMD_FPS = 30;
const $ = (id) => document.getElementById(id);

const ui = {
  canvas: $('viewport'),
  dropZone: $('dropZone'),
  openFiles: $('openFiles'),
  openFolder: $('openFolder'),
  resetCamera: $('resetCamera'),
  fileInput: $('fileInput'),
  folderInput: $('folderInput'),
  play: $('playButton'),
  timeline: $('timeline'),
  time: $('timeLabel'),
  edge: $('edgeToggle'),
  camera: $('cameraToggle'),
  loop: $('loopToggle'),
  scale: $('scaleSelect'),
  modelName: $('modelName'),
  stats: $('modelStats'),
  fps: $('fps'),
  frame: $('frameLabel'),
  status: $('status'),
};

const state = {
  renderer: null,
  scene: null,
  controls: null,
  manualCamera: null,
  vmdCamera: null,
  activeCamera: null,
  keyLight: null,
  model: null,
  animation: null,
  cameraAnimation: null,
  lightAnimation: null,
  animationLoader: null,
  corePromise: null,
  audio: null,
  audioUrl: null,
  timeSeconds: 0,
  maxSeconds: 0.001,
  playing: false,
  lastNow: performance.now(),
  loading: false,
  renderScale: 1,
  fpsFrames: 0,
  fpsStart: performance.now(),
};

boot().catch((error) => {
  console.error(error);
  setStatus(`初期化失敗: ${describeError(error)}`);
});

async function boot() {
  bindUi();
  setFileControlsEnabled(false);
  setStatus('Three.js と MMD ランタイムを初期化しています。');

  const renderer = new THREE.WebGLRenderer({
    canvas: ui.canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf4f6f8, 1);
  state.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6f8);
  state.scene = scene;

  const manualCamera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
  manualCamera.position.set(0, 12, 32);
  state.manualCamera = manualCamera;
  state.vmdCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  state.activeCamera = manualCamera;

  const controls = new OrbitControls(manualCamera, ui.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.rotateSpeed = 0.65;
  controls.panSpeed = 0.8;
  controls.zoomSpeed = 0.85;
  controls.minDistance = 0.05;
  controls.maxDistance = 5000;
  controls.target.set(0, 10, 0);
  controls.update();
  state.controls = controls;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x687184, 1.7);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(8, 18, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0002;
  keyLight.shadow.normalBias = 0.025;
  scene.add(keyLight, keyLight.target);
  state.keyLight = keyLight;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ color: 0x111827, opacity: 0.14 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.name = 'ground-shadow';
  scene.add(ground);

  state.corePromise = initCore({
    wasmUrl: new URL('./mmd_anim_wasm_bg.wasm', import.meta.url),
  });
  await state.corePromise;

  resize();
  setFileControlsEnabled(true);
  setStatus('準備完了。モデルのフォルダーを選択してください。');
  requestAnimationFrame(loop);
}

function bindUi() {
  ui.openFiles.addEventListener('click', () => ui.fileInput.click());
  ui.openFolder.addEventListener('click', () => ui.folderInput.click());
  ui.resetCamera?.addEventListener('click', frameModel);
  ui.fileInput.addEventListener('change', () => loadFiles([...ui.fileInput.files]));
  ui.folderInput.addEventListener('change', () => loadFiles([...ui.folderInput.files]));
  ui.play.addEventListener('click', togglePlayback);
  ui.timeline.addEventListener('input', () => seek(Number(ui.timeline.value)));
  ui.edge.addEventListener('change', updateOutlineVisibility);
  ui.camera.addEventListener('change', updateCameraMode);
  ui.scale.addEventListener('change', () => {
    state.renderScale = Number(ui.scale.value) || 1;
    resize();
  });
  addEventListener('resize', resize);

  let dragDepth = 0;
  addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add('dragging');
  });
  addEventListener('dragover', (event) => event.preventDefault());
  addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dragging');
  });
  addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    await loadFiles(await filesFromDrop(event.dataTransfer));
  });
}

async function loadFiles(files) {
  if (!files.length || state.loading) return;
  state.loading = true;
  pause();
  setFileControlsEnabled(false);
  setStatus('モデルとテクスチャを読み込んでいます。');

  try {
    const modelFiles = findMmdModelFiles(files);
    const modelFile = modelFiles[0];
    if (!modelFile) throw new Error('PMX または PMD が見つかりません。モデルのフォルダーごと選択してください。');

    clearCurrentModel();
    const textureMap = createMmdTextureMapFromFiles(files, modelFile);
    const loader = new ThreeMmdLoader({
      textureMap,
      ddsLoader: new DDSLoader(),
      core: state.corePromise,
      geometryAwareAlpha: true,
    });
    state.animationLoader = loader;

    const model = await loader.loadModel(modelFile, {
      outline: true,
      materialRenderOrder: true,
      morphSplit: true,
      morphAttributes: true,
      frustumCulled: false,
    });
    state.model = model;
    state.scene.add(model.root);

    model.root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    syncMmdSpecularDirection(model.mesh.material, state.keyLight);

    const vmdFiles = findMmdMotionFiles(files);
    const { modelMotionFile, cameraMotionFile } = await classifyVmdFiles(vmdFiles);
    state.animation = null;
    state.cameraAnimation = null;
    state.lightAnimation = null;
    state.timeSeconds = 0;
    state.maxSeconds = 0.001;

    let modelLoaded = null;
    if (modelMotionFile) {
      modelLoaded = await loader.loadAnimation(modelMotionFile);
      state.animation = modelLoaded.animation;
      model.setAnimation(modelLoaded.animation);
      state.maxSeconds = Math.max(state.maxSeconds, animationDuration(modelLoaded.animation));
    }

    if (cameraMotionFile) {
      const cameraLoaded = cameraMotionFile === modelMotionFile
        ? modelLoaded
        : await loader.loadAnimation(cameraMotionFile);
      state.cameraAnimation = cameraLoaded?.animation ?? null;
      state.lightAnimation = cameraLoaded?.animation ?? null;
      state.maxSeconds = Math.max(state.maxSeconds, animationDuration(cameraLoaded?.animation));
    } else if (modelLoaded?.animation?.cameraFrames?.length) {
      state.cameraAnimation = modelLoaded.animation;
      state.lightAnimation = modelLoaded.animation;
    }

    replaceAudio(findAudioFile(files));
    model.update(0);
    updateOutlineVisibility();
    updateModelUi(modelFile, model);
    frameModel();
    updateTimelineRange();
    seek(0);

    const textureFailures = model.diagnostics?.textures?.filter((item) => item.status === 'error').length ?? 0;
    const motionStatus = modelMotionFile ? 'VMDボーン・モーフを読み込みました。' : 'モデル用VMDなし。';
    const cameraStatus = cameraMotionFile ? ' VMDカメラ・ライトを読み込みました。' : '';
    const textureStatus = textureFailures ? ` テクスチャ失敗 ${textureFailures} 件。` : '';
    setStatus(`${motionStatus}${cameraStatus} Three.js MMDマテリアルで描画しています。${textureStatus}`);
  } catch (error) {
    console.error(error);
    setStatus(`ロード失敗: ${describeError(error)}`);
  } finally {
    state.loading = false;
    setFileControlsEnabled(true);
  }
}

async function classifyVmdFiles(files) {
  let modelMotionFile = null;
  let cameraMotionFile = null;
  for (const file of files) {
    try {
      const inventory = parseVmdSectionInventory(new Uint8Array(await file.arrayBuffer()));
      const counts = inventory.counts ?? {};
      if (!modelMotionFile && ((counts.bones ?? 0) > 0 || (counts.morphs ?? 0) > 0)) modelMotionFile = file;
      if (!cameraMotionFile && (counts.cameras ?? 0) > 0) cameraMotionFile = file;
    } catch (error) {
      console.warn(`VMD分類をスキップ: ${file.name}`, error);
    }
  }
  return { modelMotionFile, cameraMotionFile };
}

function animationDuration(animation) {
  return Math.max((animation?.metadata?.maxFrame ?? 0) / MMD_FPS, 0.001);
}

function clearCurrentModel() {
  if (state.model) {
    state.scene.remove(state.model.root);
    disposeMmdModel(state.model);
  }
  state.model = null;
  state.animation = null;
  state.cameraAnimation = null;
  state.lightAnimation = null;
  state.animationLoader = null;
  state.timeSeconds = 0;
  state.maxSeconds = 0.001;
}

function frameModel() {
  if (!state.model) return;
  state.model.update(state.timeSeconds);
  state.model.root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(state.model.root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = state.manualCamera;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1));
  const distanceV = size.y / (2 * Math.tan(verticalFov / 2));
  const distanceH = size.x / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(distanceV, distanceH, size.z, 1) * 1.25;

  state.controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0, size.y * 0.04, distance));
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = Math.max(distance * 50, 1000);
  camera.updateProjectionMatrix();
  state.controls.minDistance = Math.max(distance * 0.03, 0.03);
  state.controls.maxDistance = distance * 20;
  state.controls.update();
}

function updateCameraMode() {
  const hasVmdCamera = Boolean(state.cameraAnimation?.cameraFrames?.length || state.model?.runtime?.cameraState?.());
  state.controls.enabled = !ui.camera.checked || !hasVmdCamera;
  if (!state.controls.enabled) state.controls.update();
}

function updateOutlineVisibility() {
  for (const outline of state.model?.outlineMeshes ?? []) outline.visible = ui.edge.checked;
}

function loop(now) {
  requestAnimationFrame(loop);
  const delta = Math.min((now - state.lastNow) / 1000, 0.1);
  state.lastNow = now;

  if (state.model && !state.loading) {
    if (state.playing) {
      state.timeSeconds = state.audio && !state.audio.error
        ? state.audio.currentTime
        : state.timeSeconds + delta;
      if (state.timeSeconds >= state.maxSeconds) {
        if (ui.loop.checked) {
          state.timeSeconds %= state.maxSeconds;
          if (state.audio) {
            state.audio.currentTime = state.timeSeconds;
            state.audio.play().catch(() => {});
          }
        } else {
          state.timeSeconds = state.maxSeconds;
          pause();
        }
      }
    }

    state.model.update(state.timeSeconds);
    const frame = state.timeSeconds * MMD_FPS;
    const cameraState = state.cameraAnimation?.cameraFrames?.length
      ? sampleMmdCameraTrack(state.cameraAnimation.cameraFrames, frame)
      : state.model.runtime?.cameraState?.();
    const lightState = state.lightAnimation?.lightFrames?.length
      ? sampleMmdLightTrack(state.lightAnimation.lightFrames, frame)
      : state.model.runtime?.lightState?.();
    if (lightState) applyMmdLightStateToThreeDirectionalLight(state.keyLight, lightState);
    const useVmdCamera = Boolean(ui.camera.checked && cameraState);
    state.controls.enabled = !useVmdCamera;

    if (useVmdCamera) {
      state.activeCamera = applyMmdCameraStateToThreeCamera(state.vmdCamera, cameraState, {
        aspect: viewportAspect(),
      });
    } else {
      state.controls.update(delta);
      state.activeCamera = state.manualCamera;
    }

    state.renderer.render(state.scene, state.activeCamera);
    updateTimeUi();
  } else {
    state.controls?.update(delta);
    if (state.renderer && state.scene && state.manualCamera) {
      state.renderer.render(state.scene, state.manualCamera);
    }
  }

  state.fpsFrames += 1;
  if (now - state.fpsStart >= 500) {
    ui.fps.textContent = String(Math.round(state.fpsFrames * 1000 / (now - state.fpsStart)));
    state.fpsFrames = 0;
    state.fpsStart = now;
  }
}

function togglePlayback() {
  if (!state.model || state.maxSeconds <= 0.001) return;
  if (state.playing) {
    pause();
    return;
  }
  state.playing = true;
  ui.play.textContent = 'Ⅱ';
  if (state.audio) {
    state.audio.currentTime = Math.min(state.timeSeconds, state.audio.duration || state.timeSeconds);
    state.audio.play().catch((error) => {
      console.warn(error);
      state.audio = null;
    });
  }
}

function pause() {
  state.playing = false;
  state.audio?.pause();
  ui.play.textContent = '▶';
}

function seek(seconds) {
  state.timeSeconds = Math.max(0, Math.min(state.maxSeconds, seconds));
  if (state.audio && Number.isFinite(state.audio.duration)) {
    state.audio.currentTime = Math.min(state.timeSeconds, state.audio.duration);
  }
  state.model?.update(state.timeSeconds);
  updateTimeUi();
}

function replaceAudio(file) {
  state.audio?.pause();
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audio = null;
  state.audioUrl = null;
  if (!file) return;

  state.audioUrl = URL.createObjectURL(file);
  state.audio = new Audio(state.audioUrl);
  state.audio.preload = 'auto';
  state.audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(state.audio.duration)) {
      state.maxSeconds = Math.max(state.maxSeconds, state.audio.duration);
      updateTimelineRange();
      updateTimeUi();
    }
  }, { once: true });
}

function findAudioFile(files) {
  return files.find((file) => /\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) ?? null;
}

function updateTimelineRange() {
  ui.timeline.max = String(Math.max(state.maxSeconds, 0.001));
}

function updateTimeUi() {
  ui.timeline.value = String(state.timeSeconds);
  ui.frame.textContent = (state.timeSeconds * MMD_FPS).toFixed(1);
  ui.time.textContent = `${formatTime(state.timeSeconds)} / ${formatTime(state.maxSeconds)}`;
}

function updateModelUi(modelFile, model) {
  const metadata = model.mesh.userData?.mmdModel?.metadata ?? {};
  ui.modelName.textContent = metadata.name || metadata.modelName || modelFile.name;
  const values = [
    model.mesh.geometry.getAttribute('position')?.count ?? 0,
    model.mesh.skeleton?.bones?.length ?? 0,
    model.mesh.geometry.morphAttributes?.position?.length ?? 0,
    metadata.rigidBodies?.length ?? metadata.counts?.rigidBodies ?? 0,
  ];
  [...ui.stats.querySelectorAll('dd')].forEach((dd, index) => {
    dd.textContent = Number(values[index] ?? 0).toLocaleString();
  });
}

function resize() {
  if (!state.renderer || !state.manualCamera) return;
  const width = Math.max(ui.canvas.clientWidth, 1);
  const height = Math.max(ui.canvas.clientHeight, 1);
  const pixelRatio = Math.min(devicePixelRatio * state.renderScale, 2.5);
  state.renderer.setPixelRatio(pixelRatio);
  state.renderer.setSize(width, height, false);
  state.manualCamera.aspect = width / height;
  state.manualCamera.updateProjectionMatrix();
  state.vmdCamera.aspect = width / height;
  state.vmdCamera.updateProjectionMatrix();
}

function viewportAspect() {
  return Math.max(ui.canvas.clientWidth, 1) / Math.max(ui.canvas.clientHeight, 1);
}

function setFileControlsEnabled(enabled) {
  ui.openFiles.disabled = !enabled;
  ui.openFolder.disabled = !enabled;
  ui.fileInput.disabled = !enabled;
  ui.folderInput.disabled = !enabled;
}

function setStatus(text) {
  ui.status.textContent = text;
}

function describeError(error) {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` / ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00.00';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

async function filesFromDrop(dataTransfer) {
  const out = [];
  const items = [...(dataTransfer?.items ?? [])];
  if (!items.length) return [...(dataTransfer?.files ?? [])];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await walkEntry(entry, '', out);
    else {
      const file = item.getAsFile?.();
      if (file) out.push(file);
    }
  }
  return out;
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    Object.defineProperty(file, 'relativePath', {
      value: `${prefix}${file.name}`,
      configurable: true,
    });
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  while (true) {
    const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) break;
    for (const child of entries) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}
