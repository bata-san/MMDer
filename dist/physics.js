import * as THREE from 'three';
import { MMDPhysics } from 'three/addons/animation/MMDPhysics.js';
import { ammoReady } from './scene.js';
import { state } from './state.js';
import { toast } from './dom.js';
function partForBody(wrapper, item) {
    const bone = item.mesh.skeleton?.bones?.[wrapper.params?.boneIndex];
    const name = `${wrapper.params?.name || ''} ${bone?.name || ''}`.toLowerCase();
    if (/hair|髪|前髪|後髪/.test(name))
        return 'hair';
    if (/skirt|cloth|ribbon|dress|スカート|リボン|衣/.test(name))
        return 'cloth';
    return 'body';
}
function precision() {
    return [
        { unitStep: 1 / 60, maxStepNum: 3 },
        { unitStep: 1 / 90, maxStepNum: 5 },
        { unitStep: 1 / 120, maxStepNum: 7 },
        { unitStep: 1 / 144, maxStepNum: 10 },
    ][state.physicsSettings.quality - 1];
}
export function applyPhysicsSettings(item = state.active) {
    if (!item?.physics?.bodies)
        return;
    const { stiffness, damping, gravity, air, parts } = state.physicsSettings;
    const selectedPrecision = precision();
    item.physics.unitStep = selectedPrecision.unitStep;
    item.physics.maxStepNum = selectedPrecision.maxStepNum;
    item.physics.setGravity(new THREE.Vector3(0, -98 * gravity, 0));
    item.physics.bodies.forEach((wrapper) => {
        const body = wrapper.body;
        if (!body)
            return;
        const enabled = parts[partForBody(wrapper, item)];
        const linear = enabled ? Math.min(0.98, damping + air * 0.35) : 0.98;
        const angular = enabled ? Math.min(0.98, damping * 0.75 + air * 0.45) : 0.98;
        body.setDamping(linear, angular);
        body.setFriction(0.35 + stiffness * 0.45);
        body.setRestitution(0);
        body.setActivationState(4);
    });
}
export async function enablePhysics(item = state.active) {
    if (!item)
        return;
    const ammo = await ammoReady;
    const mmd = item.mesh.geometry?.userData?.MMD;
    if (!ammo || !mmd?.rigidBodies?.length) {
        toast('このモデルには利用可能な物理剛体がありません');
        return;
    }
    try {
        item.physics ??= new MMDPhysics(item.mesh, mmd.rigidBodies, mmd.constraints || [], precision());
        item.physics.reset();
        applyPhysicsSettings(item);
    }
    catch (error) {
        console.warn(error);
        toast('物理を有効化できませんでした');
    }
}
export function applyWind(item, time) {
    if (!item.physics?.bodies || !window.Ammo)
        return;
    const { wind, turbulence, parts } = state.physicsSettings;
    if (!wind && !turbulence)
        return;
    const Ammo = window.Ammo;
    item.physics.bodies.forEach((wrapper, index) => {
        const part = partForBody(wrapper, item);
        if ((part !== 'hair' && part !== 'cloth') || !parts[part])
            return;
        const body = wrapper.body;
        if (!body)
            return;
        const gust = wind + Math.sin(time * 2.1 + index * 1.7) * turbulence * wind;
        const force = new Ammo.btVector3(gust, Math.sin(time * 3.7 + index) * turbulence * wind * 0.2, Math.cos(time * 1.3 + index) * turbulence * wind * 0.35);
        body.applyCentralForce(force);
        Ammo.destroy(force);
    });
}
