import { parsePmx } from './pmx.js';
import { parsePmd } from './pmd.js';
import { parseVmd } from './vmd.js';
import { WasmPoseCore } from './wasm-core.js';
import { MorphController, buildMorphCsr, materialStateFor } from './morphs.js';
import { WebGpuMmdRenderer } from './renderer.js';
import { WebGl2MmdRenderer } from './webgl-renderer.js';
import { AssetBundle, extensionOf, filesFromDrop } from './files.js';
import { OrbitCamera } from './math.js';
import { evaluateVmdCamera, evaluateVmdLight } from './vmd-eval.js';

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('viewport'), dropZone: $('dropZone'), openFiles: $('openFiles'), openFolder: $('openFolder'), fileInput: $('fileInput'), folderInput: $('folderInput'),
  play: $('playButton'), timeline: $('timeline'), time: $('timeLabel'), ik: $('ikToggle'), edge: $('edgeToggle'), camera: $('cameraToggle'), loop: $('loopToggle'),
  scale: $('scaleSelect'), modelName: $('modelName'), stats: $('modelStats'), fps: $('fps'), frame: $('frameLabel'), status: $('status'),
};

const state = {
  renderer: null, core: null, camera: new OrbitCamera(ui.canvas), model: null, motion: null, morphs: null, assets: null,
  audio: null, audioUrl: null, frame: 0, maxFrame: 1, playing: false, clockStart: 0, hasMaterialMorph: false,
  fpsFrames: 0, fpsStart: performance.now(), lastTime: performance.now(), loading: false,
  readyPromise: null, initError: null, backend: null,
};

async function boot() {
  bindUi();
  setFileControlsEnabled(false);
  state.readyPromise = initializeRuntime();
  try {
    await state.readyPromise;
    const version = state.core.exports.core_version() >>> 16;
    setStatus(`準備完了。${state.backend} / WASM core v${version}。`);
    setFileControlsEnabled(true);
    requestAnimationFrame(loop);
  } catch (error) {
    state.initError = error;
    console.error(error);
    setStatus(`初期化失敗: ${error.message}`);
  }
}

async function initializeRuntime() {
  const wasmUrl = new URL('../public/mmd_core.wasm', import.meta.url);
  const corePromise = WasmPoseCore.create(wasmUrl);
  let renderer;
  let webGpuError = null;
  try {
    renderer = await WebGpuMmdRenderer.create(ui.canvas);
    await renderer.initialize();
    state.backend = 'Raw WebGPU';
  } catch (error) {
    webGpuError = error;
    console.warn('WebGPU initialization failed; falling back to WebGL2.', error);
    renderer = await WebGl2MmdRenderer.create(ui.canvas);
    await renderer.initialize();
    state.backend = `Raw WebGL2 fallback（WebGPU: ${error.message}）`;
  }
  try {
    state.core = await corePromise;
  } catch (error) {
    throw new Error(`WASM coreを読み込めません: ${error.message}`);
  }
  state.renderer = renderer;
  state.initError = null;
  if (webGpuError) console.info('Using WebGL2 fallback because WebGPU was unavailable.', webGpuError);
}

function setFileControlsEnabled(enabled) {
  ui.openFiles.disabled = !enabled;
  ui.openFolder.disabled = !enabled;
  ui.fileInput.disabled = !enabled;
  ui.folderInput.disabled = !enabled;
}

async function ensureReady() {
  if (state.readyPromise) await state.readyPromise;
  if (!state.core || !state.renderer) {
    throw new Error(state.initError?.message || '描画エンジンの初期化が完了していません。ページを再読み込みしてください。');
  }
}

function bindUi() {
  ui.openFiles.addEventListener('click', () => ui.fileInput.click());
  ui.openFolder.addEventListener('click', () => ui.folderInput.click());
  ui.fileInput.addEventListener('change', () => loadFiles([...ui.fileInput.files]));
  ui.folderInput.addEventListener('change', () => loadFiles([...ui.folderInput.files]));
  ui.play.addEventListener('click', togglePlayback);
  ui.timeline.addEventListener('input', () => seek(Number(ui.timeline.value)));
  ui.edge.addEventListener('change', () => state.renderer?.setEdgeEnabled(ui.edge.checked));
  ui.scale.addEventListener('change', () => state.renderer?.setRenderScale(Number(ui.scale.value)));
  addEventListener('resize', () => state.renderer?.resize());
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth += 1; document.body.classList.add('dragging'); });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) document.body.classList.remove('dragging'); });
  addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); });
  addEventListener('drop', async (e) => loadFiles(await filesFromDrop(e.dataTransfer)));
}

async function loadFiles(files) {
  if (!files.length || state.loading) return;
  state.loading = true; pause(); setStatus('ファイルを解析しています。');
  try {
    await ensureReady();
    const assets = new AssetBundle(files);
    const modelFile = assets.findExtension('.pmx', '.pmd');
    if (!modelFile) throw new Error('PMXまたはPMDモデルが見つかりません。モデルのフォルダーごと選択してください。');
    const motionFile = assets.findExtension('.vmd');
    const audioFile = assets.findExtension('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac');
    const modelBuffer = await modelFile.arrayBuffer();
    const model = extensionOf(modelFile.name) === '.pmx' ? parsePmx(modelBuffer) : parsePmd(modelBuffer);
    const motion = motionFile ? parseVmd(await motionFile.arrayBuffer()) : null;
    const modelPath = modelFile.webkitRelativePath || modelFile.relativePath || modelFile.name;
    state.core.load(model, motion);
    const morphs = new MorphController(model, motion);
    await state.renderer.loadModel(model, assets, buildMorphCsr(model), modelPath);
    state.camera.frameModel(model);
    replaceAudio(audioFile);
    state.model = model; state.motion = motion; state.morphs = morphs; state.assets = assets; state.frame = 0;
    state.maxFrame = Math.max(1, motion?.maxFrame ?? 0);
    state.hasMaterialMorph = model.morphs.some((m) => m.type === 8);
    if (state.audio) state.audio.addEventListener('loadedmetadata', () => { state.maxFrame = Math.max(state.maxFrame, state.audio.duration * 30); updateTimelineRange(); }, { once: true });
    updateTimelineRange(); updateModelUi(model); seek(0);
    const fallbackNote = state.backend?.startsWith('Raw WebGL2') ? ' WebGL2フォールバックでは頂点・UVモーフをCPU更新します。' : '';
    setStatus(`${model.format.toUpperCase()} / ${model.vertexCount.toLocaleString()}頂点をロード。${motion ? 'VMDあり。' : 'VMDなし。'}${fallbackNote} 物理剛体データは保持しますが、この軽量ビルドでは物理バックエンド未接続です。`);
  } catch (error) {
    console.error(error); setStatus(`ロード失敗: ${error.message}`);
  } finally { state.loading = false; }
}

function replaceAudio(file) {
  state.audio?.pause();
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audio = null; state.audioUrl = null;
  if (!file) return;
  state.audioUrl = URL.createObjectURL(file);
  state.audio = new Audio(state.audioUrl); state.audio.preload = 'auto';
}

async function togglePlayback() {
  if (!state.model) return;
  if (state.playing) { pause(); return; }
  state.playing = true; ui.play.textContent = 'Ⅱ';
  if (state.audio) {
    state.audio.currentTime = state.frame / 30;
    try { await state.audio.play(); } catch (error) { console.warn(error); state.clockStart = performance.now() - state.frame / 30 * 1000; }
  } else state.clockStart = performance.now() - state.frame / 30 * 1000;
}
function pause() { state.playing = false; state.audio?.pause(); ui.play.textContent = '▶'; }
function seek(frame) {
  state.frame = Math.max(0, Math.min(state.maxFrame, frame));
  if (state.audio && Math.abs(state.audio.currentTime * 30 - state.frame) > 1) state.audio.currentTime = state.frame / 30;
  if (state.playing && !state.audio) state.clockStart = performance.now() - state.frame / 30 * 1000;
  updateTimeUi();
}
function updateTimelineRange() { ui.timeline.max = String(Math.max(1, state.maxFrame)); }

function loop(now) {
  requestAnimationFrame(loop);
  if (!state.renderer) return;
  if (state.model && !state.loading) {
    if (state.playing) {
      if (state.audio && !state.audio.error) state.frame = state.audio.currentTime * 30;
      else state.frame = (now - state.clockStart) * 0.03;
      if (state.frame >= state.maxFrame) {
        if (ui.loop.checked) { state.frame %= state.maxFrame; if (state.audio) { state.audio.currentTime = state.frame / 30; state.audio.play().catch(() => {}); } else state.clockStart = now - state.frame / 30 * 1000; }
        else { state.frame = state.maxFrame; pause(); }
      }
    }
    const weights = state.morphs.evaluate(state.frame);
    const skinMatrices = state.core.evaluate(state.frame, weights, ui.ik.checked);
    const aspect = ui.canvas.width / Math.max(1, ui.canvas.height);
    const vmdCamera = ui.camera.checked ? evaluateVmdCamera(state.motion?.cameraKeys, state.frame, aspect) : null;
    const eye = vmdCamera?.eye ?? state.camera.eye();
    const viewProjection = vmdCamera?.viewProjection ?? state.camera.matrix(aspect);
    const light = evaluateVmdLight(state.motion?.lightKeys, state.frame);
    state.renderer.render({ viewProjection, cameraPosition: eye, skinMatrices, morphWeights: weights, materialStates: state.hasMaterialMorph ? materialStateFor(state.model, weights) : null, lightDirection: light?.direction ?? [-0.5, -1, -0.5], lightColor: light?.color ?? [1, 1, 1] });
    updateTimeUi();
  }
  state.fpsFrames += 1;
  if (now - state.fpsStart >= 500) { ui.fps.textContent = String(Math.round(state.fpsFrames * 1000 / (now - state.fpsStart))); state.fpsFrames = 0; state.fpsStart = now; }
  state.lastTime = now;
}

function updateTimeUi() {
  ui.timeline.value = String(state.frame); ui.frame.textContent = state.frame.toFixed(1);
  ui.time.textContent = `${formatTime(state.frame / 30)} / ${formatTime(state.maxFrame / 30)}`;
}
function formatTime(seconds) { if (!Number.isFinite(seconds)) return '0:00.00'; const m = Math.floor(seconds / 60), s = seconds - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; }
function updateModelUi(model) {
  ui.modelName.textContent = model.name || model.nameEn || '名称なし';
  const values = [model.vertexCount, model.bones.length, model.morphs.length, model.rigidBodies.length];
  [...ui.stats.querySelectorAll('dd')].forEach((dd, i) => { dd.textContent = values[i].toLocaleString(); });
}
function setStatus(text) { ui.status.textContent = text; }

boot();
