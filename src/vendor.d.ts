declare module 'three' {
  const THREE: any;
  export = THREE;
}

declare module 'three/addons/controls/OrbitControls.js' { export const OrbitControls: any; }
declare module 'three/addons/loaders/MMDLoader.js' { export const MMDLoader: any; }
declare module 'three/addons/effects/OutlineEffect.js' { export const OutlineEffect: any; }
declare module 'three/addons/loaders/RGBELoader.js' { export const RGBELoader: any; }
declare module 'three/addons/controls/TransformControls.js' { export const TransformControls: any; }
declare module 'three/addons/animation/MMDPhysics.js' { export const MMDPhysics: any; }
declare module 'three/addons/webxr/VRButton.js' { export const VRButton: any; }
declare module 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js' {
  export function unzipSync(data: Uint8Array): Record<string, Uint8Array>;
}
declare module 'https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/libs/mmdparser.module.js' {
  export const MMDParser: any;
}

interface Window { Ammo?: any; }
