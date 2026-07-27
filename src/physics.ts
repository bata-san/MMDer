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

const PROFILES: PhysicsProfile[] = [
  { fixedStep: 1 / 60, maxSubSteps: 2, warmupSteps: 4 },
  { fixedStep: 1 / 72, maxSubSteps: 3, warmupSteps: 6 },
  { fixedStep: 1 / 90, maxSubSteps: 4, warmupSteps: 8 },
  { fixedStep: 1 / 120, maxSubSteps: 5, warmupSteps: 10 },
];

function profile(): PhysicsProfile {
  const selected = PROFILES[Math.max(0, Math.min(PROFILES.length - 1, state.physicsSettings.quality - 1))];
  if (!state.xrPresenting) return selected;
  return {
    fixedStep: Math.max(selected.fixedStep, 1 / 72),
    maxSubSteps: Math.min(selected.maxSubSteps, 3),
    warmupSteps: Math.min(selected.warmupSteps, 6),
  };
}

function partForBody(wrapper: any, item: SceneModel): PhysicsPart {
  const bone = item.mesh.skeleton?.bones?.[wrapper.params?.boneIndex];
  const name = `${wrapper.params?.name || ''} ${bone?.name || ''}`.toLowerCase();
  if (/hair|髪|前髪|後髪|ツインテ|ponytail/.test(name)) return 'hair';
  if (/skirt|cloth|ribbon|dress|coat|袖|スカート|リボン|衣|裾/.test(name)) return 'cloth';
  return 'body';
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
    // Ammo builds differ; damping still provides a safe fallback.
  }
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
    const enabled = parts[partForBody(wrapper, item)];
    if (!enabled) {
      body.clearForces?.();
      body.setDamping?.(0.99, 0.99);
      body.setActivationState?.(5);
      return;
    }
    const linear = Math.min(0.95, 0.04 + damping * 0.62 + air * 0.26);
    const angular = Math.min(0.97, 0.08 + damping * 0.72 + air * 0.34);
    body.setDamping?.(linear, angular);
    body.setFriction?.(0.24 + stiffness * 0.44);
    body.setRestitution?.(0);
    body.setSleepingThresholds?.(0.04, 0.08);
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

function applyAerodynamics(item: SceneModel, time: number): void {
  const runtime = item.physics;
  const Ammo = window.Ammo;
  if (!runtime?.engine?.bodies || !Ammo) return;
  const { wind, turbulence, air, parts } = state.physicsSettings;
  if (!wind && !turbulence && !air) return;

  runtime.engine.bodies.forEach((wrapper: any, index: number) => {
    const part = partForBody(wrapper, item);
    if (!parts[part] || part === 'body') return;
    const body = wrapper.body;
    if (!body) return;
    const phase = time * 1.7 + index * 0.618;
    const gust = wind * (1 + Math.sin(phase) * turbulence * 0.55);
    const lateral = Math.cos(time * 0.83 + index * 0.37) * wind * turbulence * 0.32;
    const vertical = Math.sin(time * 2.31 + index) * wind * turbulence * 0.12;
    const partScale = part === 'hair' ? 1 : 0.72;

    const velocity = body.getLinearVelocity?.();
    const dragX = velocity ? -velocity.x() * air * 0.12 : 0;
    const dragY = velocity ? -velocity.y() * air * 0.08 : 0;
    const dragZ = velocity ? -velocity.z() * air * 0.12 : 0;
    const force = new Ammo.btVector3(
      (gust + dragX) * partScale,
      (vertical + dragY) * partScale,
      (lateral + dragZ) * partScale,
    );
    body.applyCentralForce?.(force);
    Ammo.destroy(force);
  });
}

export function stepPhysics(item: SceneModel, delta: number, time: number): void {
  const runtime = item.physics;
  if (!state.physics || !runtime?.enabled) return;
  runtime.accumulator = Math.min(runtime.accumulator + Math.min(delta, 0.05), runtime.fixedStep * runtime.maxSubSteps);
  let steps = 0;
  while (runtime.accumulator >= runtime.fixedStep && steps < runtime.maxSubSteps) {
    applyAerodynamics(item, time + steps * runtime.fixedStep);
    runtime.engine.update(runtime.fixedStep);
    runtime.accumulator -= runtime.fixedStep;
    steps += 1;
  }
  if (steps === runtime.maxSubSteps && runtime.accumulator >= runtime.fixedStep) runtime.accumulator = 0;
}
