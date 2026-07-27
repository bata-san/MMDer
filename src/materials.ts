import * as THREE from 'three';
import { effect } from './scene.js';
import { state } from './state.js';

export function eachMaterial(root: any, callback: (material: any, mesh: any) => void): void {
  root?.traverse((node: any) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material: any) => callback(material, node));
  });
}

export function configureMmdMaterials(root: any): void {
  eachMaterial(root, (material) => {
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
    if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    [material.alphaMap, material.normalMap, material.bumpMap, material.aoMap, material.gradientMap]
      .filter(Boolean)
      .forEach((texture: any) => { texture.colorSpace = THREE.NoColorSpace; });
    if (material.gradientMap) {
      material.gradientMap.minFilter = THREE.NearestFilter;
      material.gradientMap.magFilter = THREE.NearestFilter;
      material.gradientMap.generateMipmaps = false;
      material.gradientMap.needsUpdate = true;
    }
    material.side = THREE.DoubleSide;
    material.depthTest = true;
    material.dithering = true;
    if (material.map && material.opacity >= 0.98) {
      material.transparent = false;
      material.alphaTest = Math.max(material.alphaTest || 0, 0.02);
      material.depthWrite = true;
    }
    const outline = material.userData?.outlineParameters;
    if (outline) {
      outline.thickness = Math.min(0.012, Math.max(0, outline.thickness || 0));
      outline.mmdBaseThickness = outline.thickness;
      outline.visible = outline.visible !== false && outline.thickness > 0;
    }
    material.needsUpdate = true;
  });
}

export function applyOutlineScale(): void {
  state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
    const outline = material.userData?.outlineParameters;
    if (outline?.mmdBaseThickness !== undefined) {
      outline.thickness = outline.mmdBaseThickness * state.outlineScale;
    }
  }));
  effect.defaultThickness = 0.0028 * state.outlineScale;
}

export function applySkinSettings(): void {
  const { specular, wetness, roughnessMap } = state.skinSettings;
  state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
    material.userData.mmdLabSkin = { specular, wetness, roughnessMap };
    if ('roughness' in material) material.roughness = Math.max(0, Math.min(1, 1 - specular * 0.5 - wetness * 0.35));
    if ('metalness' in material) material.metalness = Math.max(0, Math.min(0.2, wetness * 0.08));
    if (material.map) material.mapIntensity = roughnessMap;
    material.needsUpdate = true;
  }));
}
