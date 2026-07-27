import * as THREE from 'three';
import { effect } from './scene.js';
import { state } from './state.js';
export function eachMaterial(root, callback) {
    root?.traverse((node) => {
        if (!node.isMesh || !node.material)
            return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => callback(material, node));
    });
}
function rememberNativeState(material) {
    if (material.userData.mmdLabNativeMaterial)
        return material.userData.mmdLabNativeMaterial;
    const outline = material.userData?.outlineParameters;
    const native = {
        specular: material.specular?.clone?.(),
        shininess: typeof material.shininess === 'number' ? material.shininess : undefined,
        emissive: material.emissive?.clone?.(),
        emissiveIntensity: typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : undefined,
        outlineAlpha: outline ? Number(outline.alpha) || 1 : undefined,
        outlineColor: outline?.color ? [...outline.color] : undefined,
    };
    material.userData.mmdLabNativeMaterial = native;
    return native;
}
function restoreNativeShaderHooks(material) {
    // v4.1.0 briefly installed an incompatible onBeforeCompile patch on MMDToonMaterial.
    // Freshly loaded materials do not need this, but clearing our cache key keeps hot reloads safe.
    if (!material.userData.mmdLabToonInstalled)
        return;
    material.onBeforeCompile = () => { };
    material.customProgramCacheKey = () => '';
    delete material.userData.mmdLabToonInstalled;
    delete material.userData.mmdLabToonUniforms;
}
function applyNativeMaterialSettings(material) {
    const native = rememberNativeState(material);
    const { specular, shadowLift } = state.toonSettings;
    if (native.specular && material.specular?.copy) {
        material.specular.copy(native.specular);
        const scale = 0.55 + specular * 1.45;
        material.specular.multiplyScalar(scale);
    }
    if (native.shininess !== undefined && typeof material.shininess === 'number') {
        material.shininess = Math.max(0, native.shininess * (0.7 + specular * 1.8));
    }
    if (native.emissive && material.emissive?.copy) {
        material.emissive.copy(native.emissive);
        if (material.color && shadowLift > 0) {
            material.emissive.lerp(material.color, Math.min(0.12, shadowLift * 0.3));
        }
    }
    if (native.emissiveIntensity !== undefined && typeof material.emissiveIntensity === 'number') {
        material.emissiveIntensity = native.emissiveIntensity + shadowLift * 0.35;
    }
    const outline = material.userData?.outlineParameters;
    if (outline) {
        if (native.outlineAlpha !== undefined)
            outline.alpha = native.outlineAlpha;
        if (native.outlineColor)
            outline.color = [...native.outlineColor];
    }
}
export function configureMmdMaterials(root) {
    eachMaterial(root, (material) => {
        restoreNativeShaderHooks(material);
        if (material.map)
            material.map.colorSpace = THREE.SRGBColorSpace;
        if (material.emissiveMap)
            material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        [material.alphaMap, material.normalMap, material.bumpMap, material.aoMap, material.gradientMap]
            .filter(Boolean)
            .forEach((texture) => { texture.colorSpace = THREE.NoColorSpace; });
        if (material.gradientMap) {
            material.gradientMap.minFilter = THREE.NearestFilter;
            material.gradientMap.magFilter = THREE.NearestFilter;
            material.gradientMap.generateMipmaps = false;
            material.gradientMap.needsUpdate = true;
        }
        // Keep MMDLoader's native transparency, side, blending and depth decisions intact.
        material.depthTest = true;
        material.dithering = true;
        material.toneMapped = true;
        const outline = material.userData?.outlineParameters;
        if (outline) {
            const baseThickness = Math.min(0.008, Math.max(0, Number(outline.thickness) || 0));
            outline.mmdBaseThickness = baseThickness;
            outline.thickness = baseThickness * state.outlineScale;
            outline.visible = outline.visible !== false && baseThickness > 0;
        }
        applyNativeMaterialSettings(material);
        material.needsUpdate = true;
    });
}
export function applyOutlineScale() {
    state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
        const outline = material.userData?.outlineParameters;
        if (outline?.mmdBaseThickness !== undefined) {
            outline.thickness = Math.min(0.012, outline.mmdBaseThickness * state.outlineScale);
        }
    }));
    effect.defaultThickness = Math.min(0.006, 0.0028 * state.outlineScale);
}
export function applyToonSettings() {
    state.models.forEach((item) => eachMaterial(item.mesh, (material) => {
        applyNativeMaterialSettings(material);
        material.needsUpdate = true;
    }));
}
