import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BACKGROUND_GZIP_BASE64_CHUNKS,
  BACKGROUND_NAME,
  BACKGROUND_PROXY_GZIP_BASE64,
  BACKGROUND_PROXY_SHA256,
  BACKGROUND_PROXY_UNCOMPRESSED_BYTES,
  BACKGROUND_SHA256,
  BACKGROUND_UNCOMPRESSED_BYTES,
} from 'virtual:mmd-background-data';
import { setNotice, toast } from './dom.js';
import { floor, grid, stage } from './scene.js';

// The baked office uses the same coordinate scale as the PMX character models.
// Keep these constants local so the private scene can be aligned without adding UI.
const BACKGROUND_SCALE = 1;
const BACKGROUND_POSITION = new THREE.Vector3(0, 0, 0);
const BACKGROUND_ROTATION_Y = 0;

let backgroundRoot: THREE.Object3D | null = null;
let loadingBackground: Promise<boolean> | null = null;

function decodeBase64Chunks(chunks: readonly string[]): Uint8Array {
  const decoded = chunks.map((chunk) => atob(chunk));
  const byteLength = decoded.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  decoded.forEach((chunk) => {
    for (let index = 0; index < chunk.length; index += 1) {
      output[offset + index] = chunk.charCodeAt(index);
    }
    offset += chunk.length;
  });
  return output;
}

async function decompressBackground(compressed: Uint8Array): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support gzip DecompressionStream.');
  }
  const payload = compressed.slice().buffer;
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function parseGlbBackground(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', (gltf: any) => resolve(gltf.scene), reject);
  });
}

function parseProxyBackground(buffer: ArrayBuffer): THREE.Object3D {
  const view = new DataView(buffer);
  let offset = 0;
  const readByte = () => view.getUint8(offset++);
  const magic = String.fromCharCode(readByte(), readByte(), readByte(), readByte());
  if (magic !== 'MMBX') throw new Error(`Invalid background proxy magic: ${magic}`);
  const version = view.getUint16(offset, true);
  offset += 2;
  if (version !== 1) throw new Error(`Unsupported background proxy version: ${version}`);
  const count = view.getUint16(offset, true);
  offset += 2;
  const minimum = new THREE.Vector3(
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  );
  offset += 12;
  const maximum = new THREE.Vector3(
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  );
  offset += 12;
  const span = maximum.clone().sub(minimum);
  const paletteCount = view.getUint16(offset, true);
  offset += 2;
  const palette = new Uint8Array(buffer, offset, paletteCount * 4);
  offset += palette.byteLength;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.85,
  });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'BUILT_IN_BACKGROUND_PROXY';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const low = new THREE.Vector3();
  const high = new THREE.Vector3();
  const color = new THREE.Color();
  const rotation = new THREE.Quaternion();
  for (let index = 0; index < count; index += 1) {
    low.set(
      view.getUint16(offset, true),
      view.getUint16(offset + 2, true),
      view.getUint16(offset + 4, true),
    ).multiplyScalar(1 / 65535).multiply(span).add(minimum);
    high.set(
      view.getUint16(offset + 6, true),
      view.getUint16(offset + 8, true),
      view.getUint16(offset + 10, true),
    ).multiplyScalar(1 / 65535).multiply(span).add(minimum);
    const materialIndex = view.getUint16(offset + 12, true);
    offset += 14;
    center.copy(low).add(high).multiplyScalar(0.5);
    size.copy(high).sub(low).max(new THREE.Vector3(0.02, 0.02, 0.02));
    matrix.compose(center, rotation, size);
    mesh.setMatrixAt(index, matrix);
    const paletteOffset = Math.min(materialIndex, paletteCount - 1) * 4;
    color.setRGB(
      palette[paletteOffset] / 255,
      palette[paletteOffset + 1] / 255,
      palette[paletteOffset + 2] / 255,
      THREE.SRGBColorSpace,
    );
    mesh.setColorAt(index, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

function configureBackground(root: THREE.Object3D): void {
  root.name = `BUILT_IN_BACKGROUND:${BACKGROUND_NAME}`;
  root.position.copy(BACKGROUND_POSITION);
  root.rotation.y = BACKGROUND_ROTATION_Y;
  root.scale.setScalar(BACKGROUND_SCALE);
  root.userData.isBuiltInBackground = true;
  root.traverse((node: any) => {
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = true;
    const materials = node.material
      ? (Array.isArray(node.material) ? node.material : [node.material])
      : [];
    materials.forEach((entry: any) => {
      entry.toneMapped = true;
      entry.userData ??= {};
      entry.userData.outlineParameters = {
        ...(entry.userData.outlineParameters ?? {}),
        visible: false,
      };
    });
  });
}

export async function loadBuiltInBackground(): Promise<boolean> {
  if (backgroundRoot) return true;
  if (loadingBackground) return loadingBackground;
  const hasProxy = Boolean(BACKGROUND_PROXY_GZIP_BASE64);
  if (!hasProxy && !BACKGROUND_GZIP_BASE64_CHUNKS.length) {
    console.info('Private built-in background is not generated; using the simple stage.');
    return false;
  }

  loadingBackground = (async () => {
    setNotice(`LOADING BACKGROUND ${BACKGROUND_NAME}…`);
    try {
      let root: THREE.Object3D;
      let byteLength: number;
      let digest: string;
      if (hasProxy) {
        const compressed = decodeBase64Chunks([BACKGROUND_PROXY_GZIP_BASE64]);
        const buffer = await decompressBackground(compressed);
        root = parseProxyBackground(buffer);
        byteLength = BACKGROUND_PROXY_UNCOMPRESSED_BYTES;
        digest = BACKGROUND_PROXY_SHA256;
      } else {
        const compressed = decodeBase64Chunks(BACKGROUND_GZIP_BASE64_CHUNKS);
        const buffer = await decompressBackground(compressed);
        root = await parseGlbBackground(buffer);
        byteLength = BACKGROUND_UNCOMPRESSED_BYTES;
        digest = BACKGROUND_SHA256;
      }
      configureBackground(root);
      stage.add(root);
      backgroundRoot = root;
      floor.visible = false;
      grid.visible = false;
      console.info(
        `Loaded private background ${BACKGROUND_NAME} (${byteLength.toLocaleString()} bytes, ${digest}).`,
      );
      toast(`背景: ${BACKGROUND_NAME}`);
      return true;
    } catch (error) {
      console.error('Built-in background load failed.', error);
      floor.visible = true;
      grid.visible = true;
      toast('固定背景を読み込めなかったため、簡易背景を使用します');
      return false;
    } finally {
      setNotice();
      loadingBackground = null;
    }
  })();

  return loadingBackground;
}
