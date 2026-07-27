import * as THREE from 'three';
import { effect } from './scene.js';
import { state } from './state.js';

interface ToonUniforms {
  specular: { value: number };
  rim: { value: number };
  shadowLift: { value: number };
}

export function eachMaterial(root: any, callback: (material: any, mesh: any) => void): void {
  root?.traverse((node: any) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material: any) => callback(material, node));
  });
}

function isSkinMaterial(material: any): boolean {
  const name = `${material.name ?? ''} ${material.map?.name ?? ''}`;
  return /肌|顔|face|skin|body|neck|head/i.test(name);
}

function toonValues(material: any): { specular: number; rim: number; shadowLift: number } {
  const skin = isSkinMaterial(material);
  const factor = skin ? 1 : 0.35;
  return {
    specular: state.toonSettings.specular * factor,
    rim: state.toonSettings.rim * (skin ? 0.75 : 1),
    shadowLift: state.toonSettings.shadowLift * (skin ? 1 : 0.45),
  };
}

function installToonPatch(material: any): void {
  if (material.userData.mmdLabToonInstalled) return;
  material.userData.mmdLabToonInstalled = true;
  const originalCompile = material.onBeforeCompile?.bind(material);
  const originalCacheKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader: any, renderer: any): void => {
    originalCompile?.(shader, renderer);
    const values = toonValues(material);
    const uniforms: ToonUniforms = {
      specular: { value: values.specular },
      rim: { value: values.rim },
      shadowLift: { value: values.shadowLift },
    };
    shader.uniforms.mmdLabSpecular = uniforms.specular;
    shader.uniforms.mmdLabRim = uniforms.rim;
    shader.uniforms.mmdLabShadowLift = uniforms.shadowLift;
    material.userData.mmdLabToonUniforms = uniforms;

    const marker = '#include <lights_fragment_end>';
    if (!shader.fragmentShader.includes(marker)) return;
    shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}
      float mmdLabFacing = clamp( dot( normalize( normal ), normalize( geometryViewDir ) ), 0.0, 1.0 );
      float mmdLabRimLight = pow( 1.0 - mmdLabFacing, 2.4 ) * mmdLabRim;
      float mmdLabHighlight = pow( mmdLabFacing, 48.0 ) * mmdLabSpecular;
      reflectedLight.indirectDiffuse += diffuseColor.rgb * mmdLabShadowLift;
      reflectedLight.indirectSpecular += vec3( mmdLabRimLight + mmdLabHighlight );`);
  };
  material.customProgramCacheKey = (): string => `${originalCacheKey?.() ?? ''}|mmd-lab-toon-v2`;
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

    material.depthTest = true;
    material.dithering = true;
    material.toneMapped = true;
    if (material.opacity < 0.999 || material.alphaMap) {
      material.transparent = true;
      material.depthWrite = material.opacity >= 0.75;
    } else if (material.map && !material.transparent) {
      material.alphaTest = Math.max(Number(material.alphaTest) || 0, 0.015);
      material.depthWrite = true;
    }

    const outline = material.userData?.outlineParameters;
    if (outline) {
      const baseThickness = Math.min(0.008, Math.max(0, Number(outline.thickness) || 0));
      outline.mmdBaseThickness = baseThickness;
      outline.thickness = baseThickness * state.outlineScale;
      outline.visible = outline.visible !== false && baseThickness > 0;
      outline.alpha = Math.min(0.92, Math.max(0.35, Number(outline.alpha) || 0.75));
      if (material.color) {
        const ink = material.color.clone().multiplyScalar(0.16);
        outline.color = [ink.r, ink.g, ink.b];
      }
    }

    installToonPatch(material);
    material.needsUpdate = true;
  });
}

export function applyOutlineScale(): void {
  state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
    const outline = material.userData?.outlineParameters;
    if (outline?.mmdBaseThickness !== undefined) {
      outline.thickness = Math.min(0.012, outline.mmdBaseThickness * state.outlineScale);
    }
  }));
  effect.defaultThickness = Math.min(0.006, 0.0028 * state.outlineScale);
}

export function applyToonSettings(): void {
  state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
    const values = toonValues(material);
    const uniforms = material.userData.mmdLabToonUniforms as ToonUniforms | undefined;
    if (uniforms) {
      uniforms.specular.value = values.specular;
      uniforms.rim.value = values.rim;
      uniforms.shadowLift.value = values.shadowLift;
    }
  }));
}
