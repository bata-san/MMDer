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
function textureHasData(texture) {
    if (!texture)
        return false;
    const source = texture.source?.data;
    const image = texture.image;
    return Boolean(source
        || image?.data
        || image?.width
        || image?.videoWidth
        || image?.naturalWidth
        || (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
        || (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement)
        || (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement)
        || (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0));
}
function setTextureColorSpace(texture, colorSpace) {
    // Changing colorSpace marks a texture for upload. MMDToonMaterial sometimes exposes
    // a placeholder gradient texture before its image arrives, so never touch placeholders.
    if (!textureHasData(texture) || texture.colorSpace === colorSpace)
        return;
    texture.colorSpace = colorSpace;
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
    // v4.1.0 installed an incompatible shader patch. Clear only hooks created by MMD LAB.
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
        material.specular.copy(native.specular).multiplyScalar(0.55 + specular * 1.45);
    }
    if (native.shininess !== undefined && typeof material.shininess === 'number') {
        material.shininess = Math.max(0, native.shininess * (0.7 + specular * 1.8));
    }
    if (native.emissive && material.emissive?.copy) {
        material.emissive.copy(native.emissive);
        if (material.color && shadowLift > 0) {
            material.emissive.lerp(material.color, Math.min(0.1, shadowLift * 0.24));
        }
    }
    if (native.emissiveIntensity !== undefined && typeof material.emissiveIntensity === 'number') {
        material.emissiveIntensity = native.emissiveIntensity + shadowLift * 0.28;
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
        setTextureColorSpace(material.map, THREE.SRGBColorSpace);
        setTextureColorSpace(material.emissiveMap, THREE.SRGBColorSpace);
        [material.alphaMap, material.normalMap, material.bumpMap, material.aoMap, material.gradientMap]
            .forEach((texture) => setTextureColorSpace(texture, THREE.NoColorSpace));
        if (textureHasData(material.gradientMap)) {
            material.gradientMap.minFilter = THREE.NearestFilter;
            material.gradientMap.magFilter = THREE.NearestFilter;
            material.gradientMap.generateMipmaps = false;
        }
        // Preserve MMDLoader's side, transparency, blending and depth-write decisions.
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
    }));
}
