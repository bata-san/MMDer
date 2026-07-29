import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BACKGROUND_GZIP_BASE64_CHUNKS,
  BACKGROUND_NAME,
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

function parseBackground(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', (gltf: any) => resolve(gltf.scene), reject);
  });
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
    materials.forEach((material: any) => {
      material.toneMapped = true;
      material.userData ??= {};
      material.userData.outlineParameters = {
        ...(material.userData.outlineParameters ?? {}),
        visible: false,
      };
    });
  });
}

export async function loadBuiltInBackground(): Promise<boolean> {
  if (backgroundRoot) return true;
  if (loadingBackground) return loadingBackground;
  if (!BACKGROUND_GZIP_BASE64_CHUNKS.length) {
    console.info('Private built-in background is not generated; using the simple stage.');
    return false;
  }

  loadingBackground = (async () => {
    setNotice(`LOADING BACKGROUND ${BACKGROUND_NAME}…`);
    try {
      const compressed = decodeBase64Chunks(BACKGROUND_GZIP_BASE64_CHUNKS);
      const buffer = await decompressBackground(compressed);
      const root = await parseBackground(buffer);
      configureBackground(root);
      stage.add(root);
      backgroundRoot = root;
      floor.visible = false;
      grid.visible = false;
      console.info(
        `Loaded private background ${BACKGROUND_NAME} (${BACKGROUND_UNCOMPRESSED_BYTES.toLocaleString()} bytes, ${BACKGROUND_SHA256}).`,
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
