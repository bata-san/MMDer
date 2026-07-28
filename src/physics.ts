import * as THREE from 'three';
import { MMDPhysics } from 'three/addons/animation/MMDPhysics.js';
import { toast } from './dom.js';
import { ammoReady } from './scene.js';
import { state } from './state.js';
import type { PhysicsPart, PhysicsRuntime, SceneModel } from './types.js';

interface PhysicsProfile {
  fixedStep: number;
  maxSubSteps: number;
  warmupSteps: number;
}

export interface PhysicsBodyHit {
  model: SceneModel;
  wrapper: any;
  part: PhysicsPart;
  position: any;
  distance: number;
}

export interface PhysicsPullHandle extends PhysicsBodyHit {
  localOffset: any;
}

const PROFILES: PhysicsProfile[] = [
  { fixedStep: 1 / 60, maxSubSteps: 2, warmupSteps: 4 },
  { fixedStep: 1 / 72, maxSubSteps: 3, warmupSteps: 6 },
  { fixedStep: 1 / 90, maxSubSteps: 4, warmupSteps: 8 },
  { fixedStep: 1 / 120, maxSubSteps: 5, warmupSteps: 10 },
];

export const PHYSICS_PARTS: PhysicsPart[] = [
  'hairFront', 'hairBack', 'hairSide', 'skirt', 'cloth', 'accessory',
  'chest', 'torso', 'hips', 'arms', 'legs',
];

export const PHYSICS_PART_LABELS: Record<PhysicsPart, string> = {
  hairFront: '前髪',
  hairBack: '後髪・長髪',
  hairSide: '横髪・ツインテール',
  skirt: 'スカート',
  cloth: '衣装・袖・裾',
  accessory: 'リボン・アクセサリ',
  chest: '胸部',
  torso: '胴体',
  hips: '腰・骨盤',
  arms: '腕・手',
  legs: '脚',
};

function profile(): PhysicsProfile {
  const selected = PROFILES[Math.max(0, Math.min(PROFILES.length - 1, state.physicsSettings.quality - 1))];
  if (!state.xrPresenting) return selected;
  return {
    fixedStep: Math.max(selected.fixedStep, 1 / 72),
    maxSubSteps: Math.min(selected.maxSubSteps, 3),
    warmupSteps: Math.min(selected.warmupSteps, 6),
  };
}

export function partForBody(wrapper: any, item: SceneModel): PhysicsPart {
  const bone = item.mesh.skeleton?.bones?.[wrapper.params?.boneIndex];
  const name = `${wrapper.params?.name || ''} ${bone?.name || ''}`.toLowerCase();
  if (/前髪|bang|fringe/.test(name)) return 'hairFront';
  if (/後髪|ponytail|long.?hair|back.?hair/.test(name)) return 'hairBack';
  if (/横髪|ツインテ|side.?hair|twin.?tail/.test(name)) return 'hairSide';
  if (/skirt|スカート/.test(name)) return 'skirt';
  if (/胸|bust|breast|chest.?soft/.test(name)) return 'chest';
  if (/腰|骨盤|hip|pelvis|lower.?body/.test(name)) return 'hips';
  if (/腕|ひじ|肘|手|arm|elbow|hand/.test(name)) return 'arms';
  if (/脚|足|膝|leg|knee|ankle/.test(name)) return 'legs';
  if (/上半身|胴|torso|spine|body/.test(name)) return 'torso';
  if (/ribbon|リボン|tie|ネクタイ|chain|鎖|accessory|アクセ/.test(name)) return 'accessory';
  if (/cloth|dress|coat|袖|裾|衣|服|cape/.test(name)) return 'cloth';
  if (/hair|髪/.test(name)) return 'hairBack';
  return 'accessory';
}

function configureConstraint(wrapper: any, stiffness: number): void {
  const constraint = wrapper?.constraint;
  if (!constraint?.setParam) return;
  try {
    const erp = 0.16 + stiffness * 0.64;
    const cfm = 0.018 * (1 - stiffness) + 0.0005;
    constraint.setParam(2, erp, -1);
    constraint.setParam(3, cfm, -1);
  } catch {
    // Ammo builds differ. Body damping remains the portable fallback.
  }
}

function bodyPosition(wrapper: any): any | null {
  const body = wrapper?.body;
  const transform = body?.getWorldTransform?.();
  const origin = transform?.getOrigin?.();
  if (!origin) return null;
  return new THREE.Vector3(origin.x(), origin.y(), origin.z());
}

function bodyMass(body: any): number {
  const invMass = Number(body?.getInvMass?.() ?? 0);
  return invMass > 0 ? 1 / invMass : 0;
}

export function applyPhysicsSettings(item: SceneModel | null = state.active): void {
  const runtime = item?.physics;
  if (!item || !runtime?.engine?.bodies) return;
  const selected = profile();
  runtime.fixedStep = selected.fixedStep;
  runtime.maxSubSteps = selected.maxSubSteps;
  runtime.warmupSteps = selected.warmupSteps;
  runtime.engine.unitStep = selected.fixedStep;
  runtime.engine.maxStepNum = 1;

  const { stiffness, damping, gravity, air, parts } = state.physicsSettings;
  runtime.engine.setGravity(new THREE.Vector3(0, -98 * gravity, 0));
  runtime.engine.bodies.forEach((wrapper: any) => {
    const body = wrapper.body;
    if (!body) return;
    const part = partForBody(wrapper, item);
    const tuning = parts[part];
    if (!tuning.enabled) {
      body.clearForces?.();
      body.setDamping?.(0.995, 0.995);
      body.setActivationState?.(5);
      return;
    }
    const partDamping = THREE.MathUtils.clamp(tuning.damping, 0, 1);
    const response = THREE.MathUtils.clamp(tuning.response, 0, 1.5);
    const linear = Math.min(0.97, 0.035 + damping * 0.52 + air * 0.22 + partDamping * 0.22);
    const angular = Math.min(0.985, 0.07 + damping * 0.62 + air * 0.3 + partDamping * 0.2);
    body.setDamping?.(linear, angular);
    body.setFriction?.(0.2 + stiffness * 0.32 + (1 - response) * 0.14);
    body.setRestitution?.(0);
    body.setSleepingThresholds?.(0.025, 0.05);
    body.setActivationState?.(4);
    body.activate?.(true);
  });
  runtime.engine.constraints?.forEach((wrapper: any) => configureConstraint(wrapper, stiffness));
}

export async function enablePhysics(item: SceneModel | null = state.active): Promise<void> {
  if (!item) return;
  const ammo = await ammoReady;
  const mmd = item.mesh.geometry?.userData?.MMD;
  if (!ammo || !mmd?.rigidBodies?.length) {
    toast('このモデルには利用可能な物理剛体がありません');
    return;
  }
  try {
    if (!item.physics) {
      const selected = profile();
      const engine = new MMDPhysics(item.mesh, mmd.rigidBodies, mmd.constraints || [], {
        unitStep: selected.fixedStep,
        maxStepNum: 1,
      });
      item.physics = {
        engine,
        accumulator: 0,
        fixedStep: selected.fixedStep,
        maxSubSteps: selected.maxSubSteps,
        warmupSteps: selected.warmupSteps,
        enabled: true,
      } satisfies PhysicsRuntime;
    }
    item.physics.enabled = true;
    item.physics.engine.reset();
    applyPhysicsSettings(item);
    item.physics.engine.warmup?.(item.physics.warmupSteps);
  } catch (error) {
    console.warn(error);
    item.physics = null;
    toast('物理を有効化できませんでした');
  }
}

export function disablePhysics(item: SceneModel): void {
  if (!item.physics) return;
  item.physics.enabled = false;
  item.physics.accumulator = 0;
  item.physics.engine.reset?.();
}

export function resetPhysics(item: SceneModel | null = state.active): void {
  if (!item?.physics) return;
  item.physics.accumulator = 0;
  item.physics.engine.reset?.();
  applyPhysicsSettings(item);
  item.physics.engine.warmup?.(Math.min(item.physics.warmupSteps, 6));
}

export function resetAllPhysics(): void {
  state.models.forEach((item) => resetPhysics(item));
  toast('物理状態をリセットしました');
}

function applyForces(item: SceneModel, time: number): void {
  const runtime = item.physics;
  const Ammo = window.Ammo;
  if (!runtime?.engine?.bodies || !Ammo) return;
  const { wind, turbulence, air, gravity, parts } = state.physicsSettings;

  runtime.engine.bodies.forEach((wrapper: any, index: number) => {
    const part = partForBody(wrapper, item);
    const tuning = parts[part];
    if (!tuning.enabled) return;
    const body = wrapper.body;
    if (!body) return;
    const mass = bodyMass(body);
    if (mass <= 0) return;

    const phase = time * 1.7 + index * 0.618;
    const partWind = wind * tuning.wind;
    const gust = partWind * (1 + Math.sin(phase) * turbulence * 0.55);
    const lateral = Math.cos(time * 0.83 + index * 0.37) * partWind * turbulence * 0.32;
    const vertical = Math.sin(time * 2.31 + index) * partWind * turbulence * 0.12;
    const velocity = body.getLinearVelocity?.();
    const response = THREE.MathUtils.clamp(tuning.response, 0, 1.5);
    const dragX = velocity ? -velocity.x() * air * (0.08 + response * 0.06) * mass : 0;
    const dragY = velocity ? -velocity.y() * air * (0.05 + response * 0.04) * mass : 0;
    const dragZ = velocity ? -velocity.z() * air * (0.08 + response * 0.06) * mass : 0;
    const gravityCorrection = -98 * gravity * (tuning.gravity - 1) * mass;
    const force = new Ammo.btVector3(
      (gust + dragX) * response,
      (vertical + dragY + gravityCorrection) * response,
      (lateral + dragZ) * response,
    );
    body.applyCentralForce?.(force);
    Ammo.destroy(force);
  });
}

export function findNearestPhysicsBody(item: SceneModel, point: any, radius: number): PhysicsBodyHit | null {
  const bodies = item.physics?.engine?.bodies;
  if (!bodies) return null;
  let nearest: PhysicsBodyHit | null = null;
  bodies.forEach((wrapper: any) => {
    const body = wrapper.body;
    if (!body || bodyMass(body) <= 0) return;
    const part = partForBody(wrapper, item);
    if (!state.physicsSettings.parts[part].enabled) return;
    const position = bodyPosition(wrapper);
    if (!position) return;
    const distance = position.distanceTo(point);
    if (distance > radius || (nearest && distance >= nearest.distance)) return;
    nearest = { model: item, wrapper, part, position, distance };
  });
  return nearest;
}

export function pokePhysics(item: SceneModel, point: any, direction: any, strength: number, radius: number): number {
  const bodies = item.physics?.engine?.bodies;
  const Ammo = window.Ammo;
  if (!bodies || !Ammo) return 0;
  let affected = 0;
  bodies.forEach((wrapper: any) => {
    const body = wrapper.body;
    if (!body || bodyMass(body) <= 0) return;
    const part = partForBody(wrapper, item);
    const tuning = state.physicsSettings.parts[part];
    if (!tuning.enabled) return;
    const position = bodyPosition(wrapper);
    if (!position) return;
    const distance = position.distanceTo(point);
    if (distance > radius) return;
    const falloff = 1 - distance / Math.max(0.001, radius);
    const impulseAmount = strength * falloff * (0.45 + tuning.response * 0.7);
    const impulse = new Ammo.btVector3(
      direction.x * impulseAmount,
      direction.y * impulseAmount,
      direction.z * impulseAmount,
    );
    body.activate?.(true);
    body.applyCentralImpulse?.(impulse);
    Ammo.destroy(impulse);
    affected += 1;
  });
  return affected;
}

export function beginPhysicsPull(item: SceneModel, point: any, radius: number): PhysicsPullHandle | null {
  const hit = findNearestPhysicsBody(item, point, radius);
  if (!hit) return null;
  // A pull always owns exactly one dynamic rigid body.  This intentionally
  // differs from pokePhysics, which distributes an impulse over an area.
  return { ...hit, localOffset: point.clone().sub(hit.position) };
}

export function updatePhysicsPull(handle: PhysicsPullHandle, target: any, delta: number): void {
  const Ammo = window.Ammo;
  const body = handle.wrapper?.body;
  if (!Ammo || !body) return;
  const position = bodyPosition(handle.wrapper);
  if (!position) return;
  const desired = target.clone().sub(handle.localOffset);
  const error = desired.sub(position);
  const velocity = body.getLinearVelocity?.();
  const settings = state.interactionSettings;
  const tuning = state.physicsSettings.parts[handle.part];
  const forceScale = settings.pullStrength * (0.4 + tuning.response * 0.8);
  const damping = settings.pullDamping;
  const force = new THREE.Vector3(
    error.x * forceScale - (velocity?.x?.() ?? 0) * damping,
    error.y * forceScale - (velocity?.y?.() ?? 0) * damping,
    error.z * forceScale - (velocity?.z?.() ?? 0) * damping,
  );
  const maxForce = 85 * Math.max(0.5, delta * 60);
  if (force.length() > maxForce) force.setLength(maxForce);
  const ammoForce = new Ammo.btVector3(force.x, force.y, force.z);
  body.activate?.(true);
  body.applyCentralForce?.(ammoForce);
  Ammo.destroy(ammoForce);
}

export function stepPhysics(item: SceneModel, delta: number, time: number): void {
  const runtime = item.physics;
  if (!state.physics || !runtime?.enabled) return;
  runtime.accumulator = Math.min(runtime.accumulator + Math.min(delta, 0.05), runtime.fixedStep * runtime.maxSubSteps);
  let steps = 0;
  while (runtime.accumulator >= runtime.fixedStep && steps < runtime.maxSubSteps) {
    applyForces(item, time + steps * runtime.fixedStep);
    runtime.engine.update(runtime.fixedStep);
    runtime.accumulator -= runtime.fixedStep;
    steps += 1;
  }
  if (steps === runtime.maxSubSteps && runtime.accumulator >= runtime.fixedStep) runtime.accumulator = 0;
}
