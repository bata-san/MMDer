import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MMDPhysics } from 'three/addons/animation/MMDPhysics.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const BUILD_VERSION = 'v3.3.0';
$('#build-version').textContent = BUILD_VERSION;
const state = { models: [], active: null, mixers: [], duration: 0, elapsed: 0, playing: true, loop: true, outline: true, outlineScale: 1, environment: null, environmentStrength: .65, assets: [], rigHandles: [], physics: false, motionBlend: .22, livingMotion: true, physicsSettings: { stiffness: .5, damping: .2, gravity: 1, wind: 0, turbulence: 0, quality: 3, air: .25, parts: { hair: true, cloth: true, body: true } }, skinSettings: { specular: .2, wetness: 0, roughnessMap: 1 } };
const renderRatio = () => Math.min(devicePixelRatio, 2);
const clock = new THREE.Clock(), scene = new THREE.Scene(), canvas = $('#scene');
scene.background = new THREE.Color(0xf1ece5);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 1000); camera.position.set(8, 5.4, 12);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(renderRatio()); renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
const effect = new OutlineEffect(renderer, { defaultThickness: .0028, defaultColor: [0.04, .05, .07], defaultAlpha: .7, defaultKeepAlive: true });
const outlineTarget = new THREE.WebGLRenderTarget(Math.round(innerWidth * renderRatio()), Math.round(innerHeight * renderRatio()), { depthBuffer: true }); outlineTarget.depthTexture = new THREE.DepthTexture(outlineTarget.width, outlineTarget.height); outlineTarget.depthTexture.type = THREE.UnsignedShortType;
const outlineDepthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide }); outlineDepthMaterial.colorWrite = false;
const outlineScene = new THREE.Scene(), outlineCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const outlineVertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position, 1.0 ); }`;
const outlineFragmentShader = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float width;
varying vec2 vUv;

float luma( vec3 color ) { return dot( color, vec3( .299, .587, .114 ) ); }
vec3 fxaa( vec2 uv ) {
  vec2 px = 1.0 / resolution;
  vec3 nw = texture2D( tColor, uv + px * vec2( -1.0, -1.0 ) ).rgb;
  vec3 ne = texture2D( tColor, uv + px * vec2(  1.0, -1.0 ) ).rgb;
  vec3 sw = texture2D( tColor, uv + px * vec2( -1.0,  1.0 ) ).rgb;
  vec3 se = texture2D( tColor, uv + px * vec2(  1.0,  1.0 ) ).rgb;
  vec3 center = texture2D( tColor, uv ).rgb;
  float lNW = luma( nw ), lNE = luma( ne ), lSW = luma( sw ), lSE = luma( se ), lM = luma( center );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
  float reduce = max( ( lNW + lNE + lSW + lSE ) * .03125, .0078125 );
  float inverse = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
  dir = clamp( dir * inverse, vec2( -6.0 ), vec2( 6.0 ) ) * px;
  vec3 a = .5 * ( texture2D( tColor, uv + dir * ( 1.0 / 3.0 - .5 ) ).rgb + texture2D( tColor, uv + dir * ( 2.0 / 3.0 - .5 ) ).rgb );
  vec3 b = a * .5 + .25 * ( texture2D( tColor, uv + dir * -.5 ).rgb + texture2D( tColor, uv + dir * .5 ).rgb );
  float lB = luma( b );
  return ( lB < lMin || lB > lMax ) ? a : b;
}
void main() {
  vec2 px = width / resolution;
  float z = texture2D( tDepth, vUv ).x;
  float depthEdge = 0.0;
  depthEdge = max( depthEdge, abs( z - texture2D( tDepth, vUv + vec2( px.x, 0.0 ) ).x ) );
  depthEdge = max( depthEdge, abs( z - texture2D( tDepth, vUv - vec2( px.x, 0.0 ) ).x ) );
  depthEdge = max( depthEdge, abs( z - texture2D( tDepth, vUv + vec2( 0.0, px.y ) ).x ) );
  depthEdge = max( depthEdge, abs( z - texture2D( tDepth, vUv - vec2( 0.0, px.y ) ).x ) );
  float localDepth = max( fwidth( z ) * 1.5, .00004 );
  float silhouette = smoothstep( localDepth, localDepth * 7.0, depthEdge );
  vec3 color = fxaa( vUv );
  vec3 ink = color * .32;
  gl_FragColor = vec4( mix( color, ink, silhouette ), 1.0 );
  #include <colorspace_fragment>
}`;
const outlineMaterial = new THREE.ShaderMaterial({ uniforms: { tColor: { value: outlineTarget.texture }, tDepth: { value: outlineTarget.depthTexture }, resolution: { value: new THREE.Vector2(outlineTarget.width, outlineTarget.height) }, width: { value: 1.0 } }, vertexShader: outlineVertexShader, fragmentShader: outlineFragmentShader, toneMapped: false });
outlineScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), outlineMaterial));
outlineMaterial.extensions.derivatives = true;
const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
const controls = new OrbitControls(camera, canvas); controls.target.set(0, 4, 0); controls.enableDamping = true; controls.dampingFactor = .06; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI; controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }; controls.screenSpacePanning = true;
let blenderPan = null; canvas.addEventListener('pointerdown', e => { if (e.button !== 1 || !e.shiftKey) return; blenderPan = { x: e.clientX, y: e.clientY }; controls.enabled = false; e.preventDefault(); e.stopImmediatePropagation(); }, true); addEventListener('pointermove', e => { if (!blenderPan) return; const dx = e.clientX - blenderPan.x, dy = e.clientY - blenderPan.y, distance = camera.position.distanceTo(controls.target) * .0015; const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1); camera.position.addScaledVector(right, -dx * distance).addScaledVector(up, dy * distance); controls.target.addScaledVector(right, -dx * distance).addScaledVector(up, dy * distance); blenderPan = { x: e.clientX, y: e.clientY }; }); addEventListener('pointerup', () => { if (blenderPan) { blenderPan = null; controls.enabled = true; } });
const transform = new TransformControls(camera, renderer.domElement); transform.setMode('translate'); transform.visible = false; transform.addEventListener('dragging-changed', e => controls.enabled = !e.value); scene.add(transform);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const ammoReady = new Promise(resolve => { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/libs/ammo.wasm.js'; script.onload = async () => { try { const Ammo = await globalThis.Ammo(); globalThis.Ammo = Ammo; resolve(Ammo); } catch { resolve(null); } }; script.onerror = () => resolve(null); document.head.append(script); });
scene.add(new THREE.AmbientLight(0xfff3e2, .3));
const environmentLight = new THREE.HemisphereLight(0xf7f5f0, 0xc4cbd3, 0); scene.add(environmentLight);
const key = new THREE.DirectionalLight(0xffd7b0, 1.25); key.position.set(3, 4, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = key.shadow.camera.bottom = -15; key.shadow.camera.right = key.shadow.camera.top = 15; key.shadow.bias = -0.00015; key.shadow.normalBias = 0.035; key.shadow.radius = 2; scene.add(key);
const fill = new THREE.DirectionalLight(0xffe6c7, .28); fill.position.set(-4, 3, -3); scene.add(fill);
const floor = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.MeshStandardMaterial({ color: 0xe9e1d8, roughness: .82 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.material.userData.outlineParameters = { visible: false }; scene.add(floor);
const grid = new THREE.GridHelper(32, 32, 0xc8b9ad, 0xd9cec4); grid.position.y = .012; grid.material.userData.outlineParameters = { visible: false }; scene.add(grid);
const textureManager = new THREE.LoadingManager();
textureManager.setURLModifier(request => { const clean = decodeURIComponent(request).replace(/\\/g, '/').replace(/^.*mmd\//, ''); const asset = state.assets.find(x => x.kind === 'texture' && (x.path.endsWith(clean) || clean.endsWith(x.path) || x.name === clean.split('/').pop())); return asset ? url(asset.file) : request; });
const loader = new MMDLoader(textureManager); loader.setResourcePath('mmd/');

function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 2500); }
function ext(file) { return file.name.split('.').pop().toLowerCase(); }
function url(file) { return URL.createObjectURL(file); }
function setNotice(text = 'READY — LOCAL MODE') { $('#notice').textContent = text; }

const db = new Promise((resolve, reject) => { const req = indexedDB.open('mmd-lab-assets', 1); req.onupgradeneeded = () => req.result.createObjectStore('assets', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
async function dbCall(mode, work) { const database = await db; return new Promise((resolve, reject) => { const tx = database.transaction('assets', mode), request = work(tx.objectStore('assets')); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function saveAsset(file, kind, path = '') { const id = `${kind}:${file.name}:${file.size}:${file.lastModified}:${path}`; await dbCall('readwrite', store => store.put({ id, kind, name: file.name, path, file, savedAt: Date.now() })); return id; }
async function removeAsset(id) { await dbCall('readwrite', store => store.delete(id)); state.assets = state.assets.filter(x => x.id !== id); renderLibraries(); }
async function refreshAssets() { state.assets = await dbCall('readonly', store => store.getAll()); renderLibraries(); }

function assetRow(asset, action) { const row = document.createElement('div'); row.className = 'asset'; const open = document.createElement('button'); open.className = 'asset-open'; open.innerHTML = `<span>＋</span><div><b>${asset.name}</b><small>${asset.path || asset.kind.toUpperCase()}</small></div>`; open.onclick = action; const del = document.createElement('button'); del.className = 'asset-delete'; del.title = 'ライブラリから削除'; del.textContent = '×'; del.onclick = () => removeAsset(asset.id); row.append(open, del); return row; }
function renderLibraries() { const draw = (kind, target, count, message, action) => { const assets = state.assets.filter(x => x.kind === kind); $(count).textContent = assets.length; const root = $(target); root.innerHTML = ''; if (!assets.length) { root.innerHTML = `<div class="empty">${message}</div>`; return; } assets.forEach(asset => root.append(assetRow(asset, () => action(asset)))); };
  draw('model', '#model-library', '#model-library-count', 'モデルを追加すると<br/>ここから再読み込みできます', loadAssetModel);
  draw('motion', '#motion-library', '#motion-library-count', 'モーションを追加すると<br/>ここから適用できます', applyAssetMotion);
}
function mimeFor(name) { const suffix = ext({ name }); return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', spa: 'image/bmp', sph: 'image/bmp', tga: 'image/x-tga', dds: 'image/vnd-ms.dds', webp: 'image/webp' })[suffix] || ''; }
async function expandArchives(files) { const expanded = []; for (const file of [...files]) { if (ext(file) !== 'zip') { expanded.push(file); continue; } const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js'); const entries = unzipSync(new Uint8Array(await file.arrayBuffer())); for (const [path, data] of Object.entries(entries)) { if (!data.length || path.endsWith('/')) continue; const name = path.split('/').pop(); const entry = new File([data], name, { type: mimeFor(name) }); Object.defineProperty(entry, 'webkitRelativePath', { value: path }); expanded.push(entry); } } return expanded; }
async function importAssets(files, loadImmediately = false) { const saved = []; const expanded = await expandArchives(files); for (const file of expanded) { const suffix = ext(file); const kind = ['pmx', 'pmd'].includes(suffix) ? 'model' : ['vmd', 'vpd'].includes(suffix) ? 'motion' : ['png', 'jpg', 'jpeg', 'bmp', 'tga', 'dds', 'webp', 'spa', 'sph'].includes(suffix) ? 'texture' : null; if (!kind) continue; const id = await saveAsset(file, kind, file.webkitRelativePath || ''); saved.push({ id, kind, name: file.name, path: file.webkitRelativePath || '', file }); } await refreshAssets(); if (loadImmediately) { for (const asset of saved.filter(x => x.kind === 'model')) await loadModel(asset.file); for (const asset of saved.filter(x => x.kind === 'motion')) await applyMotion(asset.file); } return saved; }
async function loadAssetModel(asset) { await loadModel(asset.file); }
async function applyAssetMotion(asset) { await applyMotion(asset.file); }

function createDefaultIdleClip(mesh) {
  const times = [0, 1, 2, 3, 4], tracks = [
    new THREE.NumberKeyframeTrack('.position[y]', times, [0, .06, 0, -.04, 0]),
    new THREE.NumberKeyframeTrack('.rotation[y]', times, [0, .035, 0, -.035, 0])
  ];
  const bones = []; mesh.traverse(node => { if (node.isBone) bones.push(node); });
  const targets = [
    { re: /上半身2|upper.?body.?2/i, x: .035, y: .012 },
    { re: /上半身|胸|chest|spine/i, x: .055, y: .02 },
    { re: /首|neck/i, x: .03, y: .028 },
    { re: /頭|head/i, x: .022, y: .04 }
  ];
  targets.forEach(target => { const bone = bones.find(node => target.re.test(node.name)); if (!bone) return; const values = []; const base = bone.quaternion.clone(); [0, 1, 2, 3, 4].forEach((_, i) => { const phase = Math.sin(i * Math.PI / 2); const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(phase * target.x, phase * target.y, 0)); values.push(...base.clone().multiply(offset).normalize().toArray()); }); tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${bone.name}].quaternion`, times, values)); });
  return new THREE.AnimationClip('Default MMD Idle', 4, tracks);
}
function createMotionController(mesh) {
  const mixer = new THREE.AnimationMixer(mesh);
  const idle = createDefaultIdleClip(mesh);
  const controller = { mesh, mixer, clips: new Map(), actions: new Map(), defaultClip: idle, current: null, currentName: '', breath: 0, head: 0, blink: 0, nextBlink: 2.5, bones: {}, morphs: [] };
  mesh.traverse(node => { if (!node.isBone) return; if (!controller.bones.chest && /上半身|胸|chest|spine/i.test(node.name)) controller.bones.chest = node; if (!controller.bones.head && /頭|head|neck/i.test(node.name)) controller.bones.head = node; });
  morphMeshes(mesh).forEach(node => Object.entries(node.morphTargetDictionary).forEach(([name, index]) => { if (/まばたき|blink|eye.?close/i.test(name)) controller.morphs.push({ node, index, base: node.morphTargetInfluences[index] || 0 }); }));
  playMotion(controller, idle, 'Default Idle', .2);
  return controller;
}
function playMotion(controller, clip, name = clip.name || 'VMD', blend = state.motionBlend) {
  if (!controller) return;
  controller.clips.set(name, clip);
  const next = controller.actions.get(name) || controller.mixer.clipAction(clip);
  controller.actions.set(name, next); next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  if (controller.current && controller.current !== next) controller.current.crossFadeTo(next, Math.max(.04, blend), false);
  controller.current = next; controller.currentName = name; controller.mesh.userData.motionName = name;
  state.duration = Math.max(state.duration, clip.duration);
}
function updateLivingMotion(controller, dt, time) {
  if (!controller || !state.livingMotion) return;
  const chest = controller.bones.chest, head = controller.bones.head;
  if (chest) { chest.rotation.x -= controller.breath; controller.breath = Math.sin(time * 1.35 + controller.mesh.userData.motionPhase) * .012; chest.rotation.x += controller.breath; }
  if (head) { head.rotation.y -= controller.head; controller.head = Math.sin(time * .55 + controller.mesh.userData.motionPhase * 1.7) * .008; head.rotation.y += controller.head; }
  if (controller.morphs.length) {
    controller.blink += dt;
    if (controller.blink > controller.nextBlink) { controller.blink = 0; controller.nextBlink = 2.8 + Math.random() * 4.5; }
    const phase = controller.blink < .18 ? Math.sin(Math.PI * controller.blink / .18) : 0;
    controller.morphs.forEach(({ node, index, base }) => { node.morphTargetInfluences[index] = Math.max(0, Math.min(1, base + phase)); });
  }
}

function configureMmdMaterial(material) { if (!material) return material; if (material.map) material.map.colorSpace = THREE.SRGBColorSpace; if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace; [material.alphaMap, material.normalMap, material.bumpMap, material.aoMap, material.gradientMap].filter(Boolean).forEach(texture => texture.colorSpace = THREE.NoColorSpace); if (material.gradientMap) { material.gradientMap.minFilter = THREE.NearestFilter; material.gradientMap.magFilter = THREE.NearestFilter; material.gradientMap.generateMipmaps = false; material.gradientMap.needsUpdate = true; } material.side = THREE.DoubleSide; material.depthTest = true; material.dithering = true; const outline = material.userData?.outlineParameters; if (outline) { outline.thickness = Math.min(.012, Math.max(0, outline.thickness || 0)); outline.mmdBaseThickness = outline.thickness; outline.visible = outline.visible !== false && outline.thickness > 0; } material.needsUpdate = true; return material; }
function applyOutlineScale() { state.models.forEach(item => item.mesh.traverse(node => { if (!node.isMesh || !node.material) return; (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => { const outline = material?.userData?.outlineParameters; if (outline && outline.mmdBaseThickness !== undefined) outline.thickness = outline.mmdBaseThickness * state.outlineScale; }); })); effect.defaultThickness = .0028 * state.outlineScale; }
function loadModel(file) { return new Promise(resolve => { setNotice('LOADING MODEL…'); loader.load(url(file), mesh => { mesh.name = file.name; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = false; mesh.userData.motionPhase = Math.random() * Math.PI * 2; mesh.traverse(node => { if (!node.isMesh) return; node.frustumCulled = false; node.castShadow = true; node.receiveShadow = false; const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach(configureMmdMaterial); }); const item = { mesh, file, name: file.name, visible: true, phase: mesh.userData.motionPhase, base: mesh.position.clone(), physics: null, motion: createMotionController(mesh) }; mesh.position.x = state.models.length * 2.7; scene.add(mesh); state.models.push(item); applyOutlineScale(); setActive(item); frameModel(mesh); setNotice(); toast(`${file.name} を読み込みました`); resolve(item); }, undefined, error => { console.error(error); setNotice(); toast(`${file.name} を読めませんでした。コンソールを確認してください`); resolve(null); }); }); }
function applyMotion(file) { const item = state.active; if (!item) { toast('先にモデルを選択してください'); return Promise.resolve(); } if (ext(file) === 'vpd') return new Promise(resolve => loader.loadVPD(url(file), false, pose => { loader.poseAsVpd(item.mesh, pose); toast(`VPD: ${file.name}`); resolve(); }, undefined, () => { toast('VPD の読み込みに失敗しました'); resolve(); }));
  return new Promise(resolve => loader.loadAnimation(url(file), item.mesh, clip => { const name = file.name.replace(/\.[^.]+$/, ''); playMotion(item.motion, clip, name); state.mixers = state.models.map(model => model.motion).filter(Boolean); toast(`VMD: ${file.name}（${Math.round(clip.duration * 10) / 10}秒）`); resolve(); }, undefined, () => { toast('VMD の読み込みに失敗しました'); resolve(); })); }
function frameModel(mesh) { const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(size.y * .62, size.y * .28, size.y * 1.45)); controls.update(); }
function setActive(item) { state.active = item; if (item) setupRigHandles(item); else { state.rigHandles.forEach(handle => scene.remove(handle)); state.rigHandles = []; } renderSceneModels(); renderMorphs(); renderMaterials(); }
function setupRigHandles(item) { state.rigHandles.forEach(h => scene.remove(h)); state.rigHandles = []; const bones = []; item.mesh.traverse(x => { if (x.isBone) bones.push(x); }); const choose = [bones.find(x => /上半身|chest|spine/i.test(x.name)), bones.find(x => /腰|センター|hips|pelvis/i.test(x.name))].filter(Boolean); choose.forEach((bone, index) => { const handle = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 12), new THREE.MeshBasicMaterial({ color: index ? 0x2a7de1 : 0xe15c2a, depthTest: false })); handle.userData.bone = bone; handle.visible = false; handle.renderOrder = 999; scene.add(handle); state.rigHandles.push(handle); }); }
function updateRigHandles() { state.rigHandles.forEach(handle => handle.userData.bone.getWorldPosition(handle.position)); }
function physicsPart(wrapper, item) { const bone = item.mesh.skeleton?.bones?.[wrapper.params?.boneIndex]; const name = `${wrapper.params?.name || ''} ${bone?.name || ''}`.toLowerCase(); if (/hair|髪|前髪|後髪/.test(name)) return 'hair'; if (/skirt|cloth|ribbon|dress|スカート|リボン|衣/.test(name)) return 'cloth'; return 'body'; }
function physicsPrecision() { return [{ unitStep: 1 / 60, maxStepNum: 3 }, { unitStep: 1 / 90, maxStepNum: 5 }, { unitStep: 1 / 120, maxStepNum: 7 }, { unitStep: 1 / 144, maxStepNum: 10 }][state.physicsSettings.quality - 1]; }
function applyPhysicsSettings(item = state.active) { if (!item?.physics?.bodies || !globalThis.Ammo) return; const { stiffness, damping, gravity, air, parts } = state.physicsSettings, precision = physicsPrecision(); item.physics.unitStep = precision.unitStep; item.physics.maxStepNum = precision.maxStepNum; item.physics.setGravity(new THREE.Vector3(0, -98 * gravity, 0)); item.physics.bodies.forEach(wrapper => { const body = wrapper.body; if (!body) return; const enabled = parts[physicsPart(wrapper, item)]; const linear = enabled ? Math.min(.98, damping + air * .35) : .98; const angular = enabled ? Math.min(.98, damping * .75 + air * .45) : .98; body.setDamping(linear, angular); body.setFriction(.35 + stiffness * .45); body.setRestitution(0); body.setActivationState(4); }); }
function enablePhysics(item = state.active) { if (!item) return; ammoReady.then(Ammo => { const mmd = item.mesh.geometry?.userData?.MMD; if (!Ammo || !mmd?.rigidBodies?.length) { toast('このモデルには利用可能な物理剛体がありません'); return; } try { item.physics ||= new MMDPhysics(item.mesh, mmd.rigidBodies, mmd.constraints || [], physicsPrecision()); item.physics.reset(); applyPhysicsSettings(item); } catch (error) { console.warn(error); toast('物理を有効化できませんでした'); } }); }
function applyWind(item, time) { if (!item?.physics?.bodies || !globalThis.Ammo) return; const { wind, turbulence, parts } = state.physicsSettings; if (!wind && !turbulence) return; item.physics.bodies.forEach((wrapper, index) => { const part = physicsPart(wrapper, item); if ((part !== 'hair' && part !== 'cloth') || !parts[part]) return; const body = wrapper.body; if (!body) return; const gust = wind + Math.sin(time * 2.1 + index * 1.7) * turbulence * wind; const force = new Ammo.btVector3(gust, Math.sin(time * 3.7 + index) * turbulence * wind * .2, Math.cos(time * 1.3 + index) * turbulence * wind * .35); body.applyCentralForce(force); Ammo.destroy(force); }); }
function installMmdShader(material) { material.userData.mmdLabShader ||= { uSpecular: { value: .2 }, uWetness: { value: 0 }, uTextureStrength: { value: 1 } }; }
function applySkinShader() { const settings = state.skinSettings; state.models.forEach(item => item.mesh.traverse(node => { if (!node.isMesh || !node.material) return; (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => { installMmdShader(material); const u = material.userData.mmdLabShader; u.uSpecular.value = settings.specular; u.uWetness.value = settings.wetness; u.uTextureStrength.value = settings.roughnessMap; }); })); }
function disposeSceneModel(item) { scene.remove(item.mesh); item.mesh.traverse(node => { node.geometry?.dispose(); if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose()); }); }
function removeSceneModel(item) { disposeSceneModel(item); item.motion?.mixer.stopAllAction(); state.models = state.models.filter(model => model !== item); state.mixers = state.models.map(model => model.motion).filter(Boolean); state.duration = state.mixers.reduce((duration, controller) => Math.max(duration, ...[...controller.clips.values()].map(clip => clip.duration)), 0); setActive(state.active === item ? state.models.at(-1) || null : state.active); toast(`${item.name} をシーンから削除しました`); }
function focusSceneModel(item) { setActive(item); frameModel(item.mesh); }
function renderSceneModels() { const root = $('#models'); if (!state.models.length) { root.innerHTML = '<div class="empty">モデルを読み込むと<br/>ここに表示されます</div>'; $('#model-count').textContent = '0 models'; return; } root.innerHTML = ''; state.models.forEach((m, i) => { const row = document.createElement('div'); row.className = `asset scene-model ${m === state.active ? 'active' : ''}`; const select = document.createElement('button'); select.className = 'asset-open'; select.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span><div><b>${m.name}</b><small>${m.visible ? '表示中' : '非表示'}</small></div>`; select.onclick = () => setActive(m); const visibility = document.createElement('button'); visibility.className = 'scene-action'; visibility.title = m.visible ? '非表示にする' : '表示する'; visibility.textContent = m.visible ? '◉' : '○'; visibility.onclick = () => { m.visible = !m.visible; m.mesh.visible = m.visible; renderSceneModels(); }; const focus = document.createElement('button'); focus.className = 'scene-action'; focus.title = 'このモデルにフォーカス'; focus.textContent = '⌖'; focus.onclick = () => focusSceneModel(m); const remove = document.createElement('button'); remove.className = 'scene-action danger'; remove.title = 'シーンから削除'; remove.textContent = '×'; remove.onclick = () => removeSceneModel(m); row.append(select, visibility, focus, remove); root.append(row); }); $('#model-count').textContent = `${state.models.length} models`; }
function morphMeshes(root) { const result = []; root?.traverse(node => { if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) result.push(node); }); return result; }
function renderMorphs() { const root = $('#morphs'), meshes = morphMeshes(state.active?.mesh); if (!meshes.length) { root.innerHTML = '<div class="empty">モデルを選択すると<br/>モーフが表示されます</div>'; return; } const groups = new Map(); meshes.forEach(mesh => Object.entries(mesh.morphTargetDictionary).forEach(([name, index]) => { if (!groups.has(name)) groups.set(name, []); groups.get(name).push({ mesh, index }); })); root.innerHTML = ''; [...groups.entries()].slice(0, 100).forEach(([name, bindings]) => { const value = bindings.reduce((n, x) => n + x.mesh.morphTargetInfluences[x.index], 0) / bindings.length; const row = document.createElement('div'); row.innerHTML = `<label>${name}<output>${Math.round(value * 100)}%</output></label><input type="range" min="0" max="1" step=".01" value="${value}">`; const input = row.querySelector('input'), output = row.querySelector('output'); input.oninput = () => { const v = +input.value; bindings.forEach(x => x.mesh.morphTargetInfluences[x.index] = v); output.textContent = `${Math.round(v * 100)}%`; }; root.append(row); }); }
function renderMaterials() { const root = $('#materials'); if (!state.active) { root.innerHTML = '<div class="empty">モデルを選択すると<br/>マテリアルが表示されます</div>'; return; } const entries = []; state.active.mesh.traverse(mesh => { if (!mesh.isMesh || !mesh.material) return; (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material, index) => entries.push({ mesh, material, index })); }); root.innerHTML = ''; entries.forEach(({ material }, index) => { const row = document.createElement('label'); row.className = 'check'; const label = material.name || material.map?.name || `Material ${String(index + 1).padStart(2, '0')}`; row.innerHTML = `<input type="checkbox" ${material.visible ? 'checked' : ''}><span>${label}</span>`; row.querySelector('input').onchange = e => { material.visible = e.target.checked; material.needsUpdate = true; }; root.append(row); }); if (!entries.length) root.innerHTML = '<div class="empty">マテリアルが見つかりません</div>'; }
function clearModels() { state.models.forEach(disposeSceneModel); state.models = []; state.active = null; state.mixers = []; state.duration = 0; setActive(null); }
function applyEnvironmentToToonMaterials() { environmentLight.intensity = state.environment ? .12 + state.environmentStrength * .38 : 0; }
function applyHDR(texture, label, notify = true) { const env = pmrem.fromEquirectangular(texture).texture; texture.dispose(); state.environment?.dispose(); state.environment = env; scene.environment = env; scene.environmentIntensity = state.environmentStrength; applyEnvironmentToToonMaterials(); scene.background = new THREE.Color(0xe9edf2); $('#show-hdri').checked = false; $('#hdri-name').textContent = label; if (notify) toast(`HDRI: ${label}`); }
function loadHDR(file) { if (!file) return; setNotice('LOADING HDRI…'); new RGBELoader().load(url(file), texture => { applyHDR(texture, file.name); setNotice(); }, undefined, () => { setNotice(); toast('HDRI の読み込みに失敗しました'); }); }
new RGBELoader().load('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/white_studio_05_1k.hdr', texture => applyHDR(texture, 'Poly Haven — White Studio 05 (CC0)', false), undefined, () => { $('#hdri-name').textContent = '標準 HDRI を読み込めませんでした'; });

function resize() { const ratio = renderRatio(), width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setPixelRatio(ratio); renderer.setSize(innerWidth, innerHeight); outlineTarget.setSize(width, height); outlineMaterial.uniforms.resolution.value.set(width, height); } addEventListener('resize', resize);
function renderOutlineBuffers() { renderer.setRenderTarget(outlineTarget); renderer.render(scene, camera); const excluded = [floor, grid, transform, ...state.rigHandles]; const visibility = excluded.map(object => object.visible); excluded.forEach(object => object.visible = false); const previousOverride = scene.overrideMaterial, previousAutoClear = renderer.autoClear; scene.overrideMaterial = outlineDepthMaterial; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = previousAutoClear; scene.overrideMaterial = previousOverride; excluded.forEach((object, index) => object.visible = visibility[index]); renderer.setRenderTarget(null); renderer.render(outlineScene, outlineCamera); }
let tick = 0, last = performance.now(); function animate() { requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), .1); if (state.playing) { state.elapsed += dt; state.mixers.forEach(x => { x.mixer.update(dt); updateLivingMotion(x, dt, state.elapsed); }); if (state.physics) state.models.forEach(x => { applyWind(x, state.elapsed); x.physics?.update(dt); }); } if (state.duration) { if (state.elapsed > state.duration) { if (state.loop) state.elapsed %= state.duration; else state.playing = false; } $('#timeline').value = state.elapsed / state.duration; $('#timecode').textContent = `${String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:${(state.elapsed % 60).toFixed(1).padStart(4, '0')}`; } updateRigHandles(); controls.update(); if (state.outline) effect.render(scene, camera); else renderer.render(scene, camera); if (++tick % 20 === 0) { const now = performance.now(); $('#fps').textContent = `${Math.round(20000 / (now - last))} FPS`; last = now; } } animate();

$('#open-models').onclick = () => $('#models-file').click(); $('#open-motions').onclick = () => $('#motions-file').click(); $('#open-folder').onclick = () => $('#folder').click();
$('#models-file').onchange = async e => importAssets(e.target.files, true); $('#motions-file').onchange = async e => importAssets(e.target.files, false); $('#folder').onchange = async e => importAssets(e.target.files, false); $('#clear-models').onclick = clearModels;
$('#play').onclick = e => { state.playing = !state.playing; e.currentTarget.textContent = state.playing ? '❚❚' : '▶'; }; $('#loop').onclick = e => { state.loop = !state.loop; e.currentTarget.classList.toggle('active', state.loop); }; $('#timeline').oninput = e => { if (!state.duration) return; state.elapsed = +e.target.value * state.duration; state.mixers.forEach(x => x.mixer.setTime(state.elapsed)); };
$('#living-motion').onchange = e => { state.livingMotion = e.target.checked; }; $('#motion-blend').oninput = e => { state.motionBlend = +e.target.value; $('#motion-blend-value').textContent = `${(+e.target.value).toFixed(2)}s`; };
$('#toon-outline').onchange = e => state.outline = e.target.checked; $('#outline').oninput = e => { state.outlineScale = +e.target.value / .28; applyOutlineScale(); $('#outline-value').textContent = e.target.value; }; $('#fov').oninput = e => { camera.fov = +e.target.value; camera.updateProjectionMatrix(); $('#fov-value').textContent = `${camera.fov}°`; }; $('#exposure').oninput = e => { renderer.toneMappingExposure = +e.target.value; $('#exposure-value').textContent = e.target.value; };
$('#open-hdri').onclick = () => $('#hdri').click(); $('#hdri').onchange = e => loadHDR(e.target.files[0]); $('#env-intensity').oninput = e => { state.environmentStrength = +e.target.value; scene.environmentIntensity = state.environmentStrength; applyEnvironmentToToonMaterials(); $('#env-value').textContent = state.environmentStrength.toFixed(2); }; $('#show-hdri').onchange = e => scene.background = e.target.checked && state.environment ? state.environment : new THREE.Color(0xe9edf2); $('#grid').onchange = e => grid.visible = e.target.checked; $('#shadows').onchange = e => renderer.shadowMap.enabled = e.target.checked; $('#reset-morph').onclick = () => { morphMeshes(state.active?.mesh).forEach(m => m.morphTargetInfluences.fill(0)); renderMorphs(); };
$$('.tabs button').forEach(button => button.onclick = () => { $$('.tabs button').forEach(x => x.classList.toggle('active', x === button)); $$('.tab-content').forEach(x => x.classList.toggle('active', x.id === `${button.dataset.tab}-tab`)); }); $$('[data-camera]').forEach(button => button.onclick = () => { camera.position.fromArray({ front: [0, 4.8, 12], threequarter: [8, 5.4, 12], wide: [13, 9, 18] }[button.dataset.camera]); controls.update(); });
const hasDroppedFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
['dragenter', 'dragover'].forEach(type => addEventListener(type, e => { if (!hasDroppedFiles(e)) return; e.preventDefault(); $('#dropzone').classList.add('show'); })); ['dragleave', 'drop'].forEach(type => addEventListener(type, e => { if (!hasDroppedFiles(e)) return; e.preventDefault(); if (type === 'dragleave' && e.relatedTarget) return; $('#dropzone').classList.remove('show'); })); addEventListener('drop', e => { if (hasDroppedFiles(e)) importAssets(e.dataTransfer.files, true); });
$('#physics').onchange = e => { state.physics = e.target.checked; if (state.physics) enablePhysics(); };
[['stiffness', 'stiffness'], ['damping', 'damping'], ['gravity', 'gravity']].forEach(([id, key]) => { $(`#${id}`).oninput = e => { state.physicsSettings[key] = +e.target.value; $(`#${id}-value`).textContent = (+e.target.value).toFixed(2); applyPhysicsSettings(); }; });
$$('.physics-part').forEach(input => input.onchange = e => { state.physicsSettings.parts[e.target.dataset.part] = e.target.checked; applyPhysicsSettings(); });
$$('[data-physics-preset]').forEach(button => button.onclick = () => { const preset = { hair: { stiffness: .72, damping: .12, gravity: .9 }, cloth: { stiffness: .85, damping: .07, gravity: 1.15 }, body: { stiffness: .5, damping: .2, gravity: 1 } }[button.dataset.physicsPreset]; Object.assign(state.physicsSettings, preset); ['stiffness', 'damping', 'gravity'].forEach(key => { $(`#${key}`).value = preset[key]; $(`#${key}-value`).textContent = preset[key].toFixed(2); }); applyPhysicsSettings(); });
[['wind', 'wind'], ['turbulence', 'turbulence'], ['air', 'air']].forEach(([id, key]) => { $(`#${id}`).oninput = e => { state.physicsSettings[key] = +e.target.value; $(`#${id}-value`).textContent = (+e.target.value).toFixed(2); applyPhysicsSettings(); }; }); $('#physics-quality').oninput = e => { state.physicsSettings.quality = +e.target.value; $('#physics-quality-value').textContent = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'][state.physicsSettings.quality - 1]; applyPhysicsSettings(); };
[['specular', 'specular'], ['wetness', 'wetness'], ['roughness-map', 'roughnessMap']].forEach(([id, key]) => { $(`#${id}`).oninput = e => { state.skinSettings[key] = +e.target.value; $(`#${id}-value`).textContent = (+e.target.value).toFixed(2); applySkinShader(); }; });
$('#rig-edit').onchange = e => { state.rigHandles.forEach(h => h.visible = e.target.checked); transform.visible = e.target.checked; if (!e.target.checked) transform.detach(); };
$('#show-all-materials').onclick = () => { state.active?.mesh.traverse(mesh => { if (!mesh.isMesh || !mesh.material) return; (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.visible = true); }); renderMaterials(); };
canvas.addEventListener('pointerdown', e => { if (!$('#rig-edit').checked) return; const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(state.rigHandles.filter(h => h.visible), false)[0]; if (hit) transform.attach(hit.object.userData.bone); });
refreshAssets();
