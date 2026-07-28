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

interface PhysicsShockwave {
  model: SceneModel;
  origin: any;
  direction: any;
  strength: number;
  radius: number;
  speed: number;
  age: number;
  previousRadius: number;
}

const shockwaves: PhysicsShockwave[] = [];
const restFrames = new WeakMap<object, number>();

const PROFILES: PhysicsProfile[] = [
  { fixedStep: 1 / 60, maxSubSteps: 2, warmupSteps: 4 },
  { fixedStep: 1 / 72, maxSubSteps: 3, warmupSteps: 6 },
  { fixedStep: 1 / 90, maxSubSteps: 4, warmupSteps: 8 },
  { fixedStep: 1 / 120, maxSubSteps: 5, warmupSteps: 10 },
];

export const PHYSICS_PARTS: PhysicsPart[] = [
  'hairFront', 'hairBack', 'hairSide', 'ears', 'skirt', 'cloth', 'accessory',
  'chest', 'torso', 'hips', 'arms', 'legs',
];

export const PHYSICS_PART_LABELS: Record<PhysicsPart, string> = {
  hairFront: '前髪',
  hairBack: '後髪・長髪',
  hairSide: '横髪・ツインテール',
  ears: 'ケモミミ',
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
  if (/耳|ear/.test(name)) return 'ears';
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
    // Large ERP values over-correct each frame and cause the familiar MMD
    // accessory jitter. Keep the solver soft enough to converge at rest.
    const erp = 0.06 + stiffness * 0.14;
    const cfm = 0.04 * (1 - stiffness) + 0.008;
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

function applyContactImpulse(body: any, position: any, contact: any, direction: any, strength: number): void {
  const Ammo = window.Ammo;
  if (!Ammo || !body) return;
  const relativePoint = contact.clone().sub(position);
  const radial = relativePoint.clone().normalize();
  const tangent = new THREE.Vector3().crossVectors(direction, radial);
  if (tangent.lengthSq() < 0.0001) tangent.crossVectors(radial, new THREE.Vector3(0, 1, 0));
  if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0);
  tangent.normalize();
  const impulseDirection = direction.clone().multiplyScalar(0.35).addScaledVector(tangent, 0.94).normalize();
  const impulse = new Ammo.btVector3(impulseDirection.x * strength, impulseDirection.y * strength, impulseDirection.z * strength);
  const relative = new Ammo.btVector3(relativePoint.x, relativePoint.y, relativePoint.z);
  body.activate?.(true);
  body.setActivationState?.(1);
  if (body.applyImpulse) body.applyImpulse(impulse, relative);
  else body.applyCentralImpulse?.(impulse);
  const torque = relativePoint.clone().cross(impulseDirection).multiplyScalar(strength * 0.68);
  const ammoTorque = new Ammo.btVector3(torque.x, torque.y, torque.z);
  body.applyTorqueImpulse?.(ammoTorque);
  Ammo.destroy(ammoTorque);
  Ammo.destroy(relative);
  Ammo.destroy(impulse);
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
    const baseLinear = Math.min(0.97, 0.035 + damping * 0.52 + air * 0.22 + partDamping * 0.22);
    const baseAngular = Math.min(0.985, 0.07 + damping * 0.62 + air * 0.3 + partDamping * 0.2);
    // Soft-body chest rigs need significantly more damping than hair.  Their
    // short constraints otherwise amplify tiny solver corrections into shake.
    const linear = part === 'chest' ? Math.max(baseLinear, 0.72) : baseLinear;
    const angular = part === 'chest' ? Math.max(baseAngular, 0.82) : baseAngular;
    body.setDamping?.(linear, angular);
    body.setFriction?.(0.2 + stiffness * 0.32 + (1 - response) * 0.14);
    body.setRestitution?.(0);
    // `4` is DISABLE_DEACTIVATION in Bullet.  Keeping every accessory awake
    // forever makes an otherwise resting chain visibly tremble.  Let Bullet
    // sleep settled bodies and wake them only when wind or direct manipulation
    // actually applies a force.
    body.setSleepingThresholds?.(0.08, 0.12);
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
  const { wind, turbulence, gravity, parts } = state.physicsSettings;

  runtime.engine.bodies.forEach((wrapper: any, index: number) => {
    const part = partForBody(wrapper, item);
    const tuning = parts[part];
    if (!tuning.enabled) return;
    const body = wrapper.body;
    if (!body) return;
    const mass = bodyMass(body);
    if (mass <= 0) return;

    const phase = time * 1.7 + index * 0.618;
    // Wind belongs to dangling items. Applying it to torso/chest bodies makes
    // them oscillate indefinitely and does not read as believable motion.
    const partWind = part === 'chest' || part === 'ears' || part === 'torso' || part === 'hips'
      ? 0
      : wind * tuning.wind;
    const gust = partWind * (1 + Math.sin(phase) * turbulence * 0.55);
    const lateral = Math.cos(time * 0.83 + index * 0.37) * partWind * turbulence * 0.32;
    const vertical = Math.sin(time * 2.31 + index) * partWind * turbulence * 0.12;
    const response = THREE.MathUtils.clamp(tuning.response, 0, 1.5);
    const gravityCorrection = -98 * gravity * (tuning.gravity - 1) * mass;
    // Air resistance is configured on the rigid body itself. Applying another
    // per-frame velocity force prevents Bullet from ever reaching rest.
    const forceX = gust * response;
    const forceY = (vertical + gravityCorrection) * response;
    const forceZ = lateral * response;
    const forceLengthSq = forceX * forceX + forceY * forceY + forceZ * forceZ;

    // Do not wake bodies with a zero force every simulation tick.  This is
    // especially important when wind is disabled, which is the normal state.
    if (forceLengthSq > 0.000001) {
      const force = new Ammo.btVector3(forceX, forceY, forceZ);
      body.activate?.(true);
      body.applyCentralForce?.(force);
      Ammo.destroy(force);
    }
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
  const Ammo = window.Ammo;
  const bodies = item.physics?.engine?.bodies;
  if (!Ammo || !bodies) return 0;
  let affected = 0;
  let nearest: { wrapper: any; position: any; distance: number; part: PhysicsPart } | null = null;
  bodies.forEach((wrapper: any) => {
    const body = wrapper.body;
    if (!body || bodyMass(body) <= 0) return;
    const part = partForBody(wrapper, item);
    if (!state.physicsSettings.parts[part].enabled) return;
    const position = bodyPosition(wrapper);
    if (!position) return;
    const distance = position.distanceTo(point);
    if (!nearest || distance < nearest.distance) nearest = { wrapper, position, distance, part };
    if (distance > radius) return;
    const outward = position.clone().sub(point);
    if (outward.lengthSq() < 0.0001) outward.copy(direction);
    else outward.normalize().lerp(direction, 0.2).normalize();
    const tuning = state.physicsSettings.parts[part];
    const impulseAmount = strength * (1 - distance / Math.max(0.001, radius)) * (0.7 + tuning.response * 0.7);
    applyContactImpulse(body, position, point, outward, impulseAmount);
    affected += 1;
  });

  // A visible reaction is preferable to silently dropping an input when an
  // imported PMX places its rigid body farther from the rendered surface.
  if (!affected && nearest) {
    const nearestBody = nearest as { wrapper: any; position: any; distance: number; part: PhysicsPart };
    const outward = nearestBody.position.clone().sub(point);
    if (outward.lengthSq() < 0.0001) outward.copy(direction);
    else outward.normalize();
    applyContactImpulse(nearestBody.wrapper.body, nearestBody.position, point, outward, strength * 0.55);
    affected = 1;
  }
  if (!affected) return 0;
  shockwaves.push({
    model: item,
    origin: point.clone(),
    direction: direction.clone().normalize(),
    strength: strength * 0.28,
    radius: Math.max(0.05, radius),
    speed: Math.max(0.2, state.interactionSettings.shockwaveSpeed),
    age: 0,
    previousRadius: Math.min(radius, 0.12),
  });
  return 1;
}

function applyShockwaves(item: SceneModel, delta: number): void {
  const Ammo = window.Ammo;
  const bodies = item.physics?.engine?.bodies;
  if (!Ammo || !bodies) return;
  for (let index = shockwaves.length - 1; index >= 0; index -= 1) {
    const wave = shockwaves[index];
    if (wave.model !== item) continue;
    wave.age += Math.max(0, delta);
    const currentRadius = Math.min(wave.radius, wave.age * wave.speed * 8);
    bodies.forEach((wrapper: any) => {
      const body = wrapper.body;
      if (!body || bodyMass(body) <= 0) return;
      const part = partForBody(wrapper, item);
      const tuning = state.physicsSettings.parts[part];
      if (!tuning.enabled) return;
      const position = bodyPosition(wrapper);
      if (!position) return;
      const distance = position.distanceTo(wave.origin);
      if (distance < wave.previousRadius || distance > currentRadius) return;
      const falloff = 1 - Math.min(1, distance / wave.radius);
      const outward = position.sub(wave.origin);
      if (outward.lengthSq() < 0.0001) outward.copy(wave.direction);
      else outward.normalize().lerp(wave.direction, 0.24).normalize();
      const impulseAmount = wave.strength * falloff * (0.35 + tuning.response * 0.75);
      applyContactImpulse(body, position, wave.origin, outward, impulseAmount);
    });
    wave.previousRadius = currentRadius;
    if (currentRadius >= wave.radius) shockwaves.splice(index, 1);
  }
}

function vectorLength(vector: any): number {
  if (!vector) return 0;
  return Math.hypot(vector.x?.() ?? 0, vector.y?.() ?? 0, vector.z?.() ?? 0);
}

function stabilizeBodies(item: SceneModel): void {
  const Ammo = window.Ammo;
  const bodies = item.physics?.engine?.bodies;
  if (!Ammo || !bodies) return;
  bodies.forEach((wrapper: any) => {
    const body = wrapper.body;
    if (!body || bodyMass(body) <= 0) return;
    const part = partForBody(wrapper, item);
    const linearVelocity = body.getLinearVelocity?.();
    const angularVelocity = body.getAngularVelocity?.();
    const linearSpeed = vectorLength(linearVelocity);
    const angularSpeed = vectorLength(angularVelocity);
    const sensitive = part === 'chest' || part === 'ears';
    const maxLinear = sensitive ? 1.6 : 7;
    const maxAngular = sensitive ? 2.4 : 9;
    const settled = linearSpeed < (sensitive ? 0.045 : 0.02)
      && angularSpeed < (sensitive ? 0.09 : 0.04);
    const frames = settled ? (restFrames.get(body) ?? 0) + 1 : 0;
    restFrames.set(body, frames);

    if (frames >= (sensitive ? 10 : 20)) {
      const zero = new Ammo.btVector3(0, 0, 0);
      body.setLinearVelocity?.(zero);
      body.setAngularVelocity?.(zero);
      body.clearForces?.();
      body.setActivationState?.(2);
      Ammo.destroy(zero);
      return;
    }

    if (linearSpeed > maxLinear && linearVelocity) {
      const scale = maxLinear / linearSpeed;
      const limited = new Ammo.btVector3(linearVelocity.x() * scale, linearVelocity.y() * scale, linearVelocity.z() * scale);
      body.setLinearVelocity?.(limited);
      Ammo.destroy(limited);
    }
    if (angularSpeed > maxAngular && angularVelocity) {
      const scale = maxAngular / angularSpeed;
      const limited = new Ammo.btVector3(angularVelocity.x() * scale, angularVelocity.y() * scale, angularVelocity.z() * scale);
      body.setAngularVelocity?.(limited);
      Ammo.destroy(limited);
    }
  });
}

export function stepPhysics(item: SceneModel, delta: number, time: number): void {
  const runtime = item.physics;
  if (!state.physics || !runtime?.enabled) return;
  applyShockwaves(item, delta);
  runtime.accumulator = Math.min(runtime.accumulator + Math.min(delta, 0.05), runtime.fixedStep * runtime.maxSubSteps);
  let steps = 0;
  while (runtime.accumulator >= runtime.fixedStep && steps < runtime.maxSubSteps) {
    applyForces(item, time + steps * runtime.fixedStep);
    runtime.engine.update(runtime.fixedStep);
    stabilizeBodies(item);
    runtime.accumulator -= runtime.fixedStep;
    steps += 1;
  }
  if (steps === runtime.maxSubSteps && runtime.accumulator >= runtime.fixedStep) runtime.accumulator = 0;
}
