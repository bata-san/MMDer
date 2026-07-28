import * as THREE from 'three';
import { blinkEnvelope, minimumJerk } from './life-math.js';
import { motionControlsBone, motionControlsMorph } from './motion.js';
import { state } from './state.js';
import type {
  BlinkKind,
  BodyRegion,
  BoneOffsetBinding,
  LifeController,
  MotionController,
  PositionOffsetBinding,
} from './types.js';

let pointerX = 0;
let pointerY = 0;

const IDENTITY = new THREE.Quaternion();
const BODY_REGIONS: BodyRegion[] = [
  'center', 'hips', 'spineLower', 'spineUpper',
  'shoulderLeft', 'shoulderRight', 'neck', 'head',
];

export function setLifePointer(clientX: number, clientY: number, viewport?: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): void {
  const left = viewport?.left ?? 0;
  const top = viewport?.top ?? 0;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  pointerX = Math.max(-1, Math.min(1, (clientX - left) / Math.max(1, width) * 2 - 1));
  pointerY = Math.max(-1, Math.min(1, -((clientY - top) / Math.max(1, height) * 2 - 1)));
}

function normalRandom(): number {
  const a = Math.max(Number.EPSILON, Math.random());
  const b = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

function logNormalInterval(mean: number, sigma = 0.5): number {
  const mu = Math.log(Math.max(0.2, mean)) - sigma * sigma / 2;
  return Math.exp(mu + sigma * normalRandom());
}

function normalizedMorphName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s_\-・.]/g, '');
}

function collectBlinkTargets(mesh: any): LifeController['blinkTargets'] {
  const canonical: LifeController['blinkTargets'] = [];
  const exact: LifeController['blinkTargets'] = [];
  const winkFallback: LifeController['blinkTargets'] = [];
  mesh.traverse((node: any) => {
    if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
    Object.entries(node.morphTargetDictionary as Record<string, number>).forEach(([name, indexValue]) => {
      const index = Number(indexValue);
      const normalized = normalizedMorphName(name);
      const target = { node, name, index, lastProcedural: 0, baseValue: Number(node.morphTargetInfluences[index]) || 0 };
      const canonicalBlink = /^(まばたき|瞬き|blink|eyes?close|eyeclose|両目閉じ)$/.test(normalized);
      const fullBlink = canonicalBlink || (normalized.includes('まばたき') && !/(笑|smile)/i.test(normalized));
      if (canonicalBlink) canonical.push(target);
      else if (fullBlink) exact.push(target);
      else if ((/(ウィンク|wink)/i.test(normalized) || /^(blink(left|right|l|r)|eye(left|right|l|r)close)$/i.test(normalized)) && !/(笑|smile)/i.test(normalized)) winkFallback.push(target);
    });
  });
  // A model can expose variants such as "まばたき" and "まばたき2".
  // They are alternatives, not layers: animate exactly one, preferring the canonical name.
  if (canonical.length) return canonical.slice(0, 1);
  if (exact.length) return exact.slice(0, 1);
  return winkFallback.slice(0, 1);
}

function findBone(mesh: any, patterns: RegExp[]): any | null {
  let match: any | null = null;
  mesh.traverse((node: any) => {
    if (!match && node.isBone && patterns.some((pattern) => pattern.test(node.name))) match = node;
  });
  return match;
}

function boneBinding(bone: any | null): BoneOffsetBinding | null {
  return bone ? { bone, name: bone.name, lastOffset: new THREE.Quaternion() } : null;
}

function positionBinding(bone: any | null): PositionOffsetBinding | null {
  return bone ? { bone, name: bone.name, lastOffset: new THREE.Vector3() } : null;
}

function collectEyeBindings(mesh: any): BoneOffsetBinding[] {
  const both = findBone(mesh, [/^(両目|eyes|both.?eyes)$/i]);
  if (both) return [boneBinding(both)!];
  return [
    findBone(mesh, [/^(左目|left.?eye|eye[_ .-]?l)$/i]),
    findBone(mesh, [/^(右目|right.?eye|eye[_ .-]?r)$/i]),
  ].filter(Boolean).map((bone) => boneBinding(bone)!);
}

function collectBodyBindings(mesh: any): LifeController['body'] {
  return {
    center: boneBinding(findBone(mesh, [/^センター$/i, /^center$/i])) ?? undefined,
    hips: boneBinding(findBone(mesh, [/^下半身$/i, /^腰$/i, /^(hips|pelvis|lower.?body)$/i])) ?? undefined,
    spineLower: boneBinding(findBone(mesh, [/^上半身$/i, /^(spine|upper.?body)$/i])) ?? undefined,
    spineUpper: boneBinding(findBone(mesh, [/^上半身2$/i, /^(chest|spine.?2|upper.?body.?2)$/i])) ?? undefined,
    shoulderLeft: boneBinding(findBone(mesh, [/^左肩$/i, /^(left.?shoulder|shoulder[_ .-]?l)$/i])) ?? undefined,
    shoulderRight: boneBinding(findBone(mesh, [/^右肩$/i, /^(right.?shoulder|shoulder[_ .-]?r)$/i])) ?? undefined,
    neck: boneBinding(findBone(mesh, [/^首$/i, /^neck$/i])) ?? undefined,
    head: boneBinding(findBone(mesh, [/^頭$/i, /^head$/i])) ?? undefined,
  };
}

function quaternionTrack(name: string, rotations: Array<[number, number, number]>): any {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const values: number[] = [];
  rotations.forEach(([x, y, z]) => {
    values.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray());
  });
  return new THREE.QuaternionKeyframeTrack(`.bones[${name}].quaternion`, times, values);
}

function createBreathAction(mesh: any, motion: MotionController): { clip: any | null; action: any | null } {
  const lower = findBone(mesh, [/^上半身$/i, /^(spine|upper.?body)$/i]);
  const upper = findBone(mesh, [/^上半身2$/i, /^(chest|spine.?2|upper.?body.?2)$/i]);
  const leftShoulder = findBone(mesh, [/^左肩$/i, /^(left.?shoulder|shoulder[_ .-]?l)$/i]);
  const rightShoulder = findBone(mesh, [/^右肩$/i, /^(right.?shoulder|shoulder[_ .-]?r)$/i]);
  const neck = findBone(mesh, [/^首$/i, /^neck$/i]);
  const tracks: any[] = [];
  if (lower) tracks.push(quaternionTrack(lower.name, [[0, 0, 0], [0.018, 0, 0], [0, 0, 0], [-0.007, 0, 0], [0, 0, 0]]));
  if (upper) tracks.push(quaternionTrack(upper.name, [[0, 0, 0], [0.03, 0, 0.002], [0, 0, 0], [-0.011, 0, -0.002], [0, 0, 0]]));
  if (leftShoulder) tracks.push(quaternionTrack(leftShoulder.name, [[0, 0, 0], [0, 0, -0.009], [0, 0, 0], [0, 0, 0.003], [0, 0, 0]]));
  if (rightShoulder) tracks.push(quaternionTrack(rightShoulder.name, [[0, 0, 0], [0, 0, 0.009], [0, 0, 0], [0, 0, -0.003], [0, 0, 0]]));
  if (neck) tracks.push(quaternionTrack(neck.name, [[0, 0, 0], [-0.005, 0, 0], [0, 0, 0], [0.002, 0, 0], [0, 0, 0]]));
  if (!tracks.length) return { clip: null, action: null };
  const clip = new THREE.AnimationClip('Life breathing additive', 1, tracks);
  THREE.AnimationUtils.makeClipAdditive(clip, 0, clip, 30);
  const action = motion.mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.enabled = true;
  action.play();
  return { clip, action };
}

export function createLifeController(mesh: any, motion: MotionController): LifeController {
  const breath = createBreathAction(mesh, motion);
  const swayNoise: LifeController['swayNoise'] = {};
  const body = collectBodyBindings(mesh);
  const anchor = body.hips?.bone ?? body.center?.bone ?? body.spineLower?.bone ?? mesh;
  const anchorPosition = anchor.getWorldPosition(new THREE.Vector3());
  BODY_REGIONS.forEach((region) => { swayNoise[region] = 0; });
  return {
    mesh,
    phase: Math.random() * Math.PI * 2,
    blinkTargets: collectBlinkTargets(mesh),
    nextBlinkAt: 1.5 + Math.random() * 3,
    lifeTime: 0,
    blinkStartedAt: 0,
    blinkDuration: 0.18,
    blinkKind: null,
    blinkPeak: 0,
    breathClip: breath.clip,
    breathAction: breath.action,
    eyes: collectEyeBindings(mesh),
    body,
    gazeStartYaw: 0,
    gazeStartPitch: 0,
    gazeYaw: 0,
    gazePitch: 0,
    gazeTargetYaw: 0,
    gazeTargetPitch: 0,
    gazeElapsed: 0,
    gazeDuration: 0.06,
    nextGazeAt: 0.8 + Math.random() * 1.6,
    microYaw: 0,
    microPitch: 0,
    microTargetYaw: 0,
    microTargetPitch: 0,
    nextMicroAt: 0.25 + Math.random() * 0.7,
    swayNoise,
    anchorPosition,
    anchorVelocity: new THREE.Vector3(),
    posturePitch: 0,
    postureRoll: 0,
    centerPosition: positionBinding(body.center?.bone ?? body.hips?.bone) ?? undefined,
    leftFoot: positionBinding(findBone(mesh, [/^左足ＩＫ$/i, /^(left.?foot.?ik|foot[_ .-]?ik[_ .-]?l)$/i])) ?? undefined,
    rightFoot: positionBinding(findBone(mesh, [/^右足ＩＫ$/i, /^(right.?foot.?ik|foot[_ .-]?ik[_ .-]?r)$/i])) ?? undefined,
    nextFootStepAt: 3 + Math.random() * 4,
    footStepStartedAt: -Infinity,
    footStepSide: null,
  };
}

function scheduleBlink(life: LifeController): void {
  const activity = Math.max(0.05, state.lifeSettings.blinkActivity);
  const meanInterval = 10.4 - activity * 6.8;
  const interval = logNormalInterval(meanInterval, 0.54);
  life.nextBlinkAt = life.lifeTime + Math.max(1.15, Math.min(16, interval));
}

function captureBlinkBases(life: LifeController, motion: MotionController, poseAdvanced: boolean): void {
  life.blinkTargets.forEach((target) => {
    const influences = target.node.morphTargetInfluences as number[] | undefined;
    if (!influences || target.index < 0 || target.index >= influences.length) return;
    const current = Number(influences[target.index]) || 0;
    const mixerOwnsMorph = poseAdvanced && motionControlsMorph(motion, target.name, target.index);
    target.baseValue = THREE.MathUtils.clamp(mixerOwnsMorph ? current : current - target.lastProcedural, 0, 1);
    influences[target.index] = target.baseValue;
    target.lastProcedural = 0;
  });
}

function triggerBlink(life: LifeController, motion: MotionController, forcedKind?: BlinkKind): void {
  if (!life.blinkTargets.length) return;
  const restarting = Boolean(forcedKind && life.blinkKind);
  if (restarting) {
    captureBlinkBases(life, motion, false);
    life.blinkKind = null;
  }
  if (life.blinkKind) return;
  captureBlinkBases(life, motion, state.playing);
  const random = Math.random();
  const settings = state.lifeSettings;
  const kind: BlinkKind = forcedKind
    ?? (random < settings.doubleBlinkChance ? 'double'
      : random < settings.doubleBlinkChance + settings.softBlinkChance ? 'soft' : 'full');
  const baseDuration = kind === 'double' ? 0.38 : kind === 'soft' ? 0.16 : 0.205;
  life.blinkKind = kind;
  life.blinkStartedAt = life.lifeTime;
  life.blinkDuration = baseDuration * THREE.MathUtils.lerp(0.75, 1.4, settings.blinkDuration) * (0.9 + Math.random() * 0.2);
  life.blinkPeak = kind === 'soft' ? 0.56 + Math.random() * 0.16 : 0.93 + Math.random() * 0.07;
  scheduleBlink(life);
}

function blinkProfile(life: LifeController): number {
  if (!life.blinkKind) return 0;
  const progress = (life.lifeTime - life.blinkStartedAt) / Math.max(0.001, life.blinkDuration);
  if (progress >= 1) {
    life.blinkKind = null;
    life.blinkPeak = 0;
    return 0;
  }
  return blinkEnvelope(life.blinkKind, progress) * life.blinkPeak;
}

function applyBlinkMorphs(
  life: LifeController,
  motion: MotionController,
  value: number,
  poseAdvanced: boolean,
): void {
  const strength = state.lifeSettings.blinkStrength;
  life.blinkTargets.forEach((target) => {
    const influences = target.node.morphTargetInfluences as number[] | undefined;
    if (!influences || target.index < 0 || target.index >= influences.length) return;
    const current = Number(influences[target.index]) || 0;
    const mixerOwnsMorph = poseAdvanced && motionControlsMorph(motion, target.name, target.index);
    const observedBase = THREE.MathUtils.clamp(mixerOwnsMorph ? current : current - target.lastProcedural, 0, 1);
    if (!life.blinkKind || target.lastProcedural === 0 || Math.abs(observedBase - target.baseValue) > 0.08) {
      target.baseValue = observedBase;
    }
    const contribution = (1 - target.baseValue) * THREE.MathUtils.clamp(value * strength, 0, 1);
    influences[target.index] = THREE.MathUtils.clamp(target.baseValue + contribution, 0, 1);
    target.lastProcedural = contribution;
    if (!life.blinkKind && value <= 0) {
      influences[target.index] = target.baseValue;
      target.lastProcedural = 0;
    }
  });
}

function chooseGazeTarget(life: LifeController, motion: MotionController): void {
  const settings = state.lifeSettings;
  const range = settings.gazeRange;
  life.gazeStartYaw = life.gazeYaw;
  life.gazeStartPitch = life.gazePitch;
  life.gazeTargetYaw = (Math.random() * 2 - 1) * 0.25 * range;
  life.gazeTargetPitch = (Math.random() * 2 - 1) * 0.14 * range;
  life.gazeElapsed = 0;
  const amplitudeRadians = Math.hypot(life.gazeTargetYaw - life.gazeStartYaw, life.gazeTargetPitch - life.gazeStartPitch);
  const amplitudeDegrees = THREE.MathUtils.radToDeg(amplitudeRadians);
  life.gazeDuration = Math.max(0.16, Math.min(0.52, 0.16 + amplitudeDegrees * 0.025));
  const activity = Math.max(0.05, settings.gazeActivity);
  const dwell = THREE.MathUtils.lerp(2.6, 0.65, settings.gazeDwell);
  life.nextGazeAt = life.lifeTime + dwell * (0.6 + Math.random() * 1.1) / (0.55 + activity * 0.65);
  if (amplitudeDegrees > 5 && Math.random() < settings.blinkOnGaze) triggerBlink(life, motion, Math.random() < 0.2 ? 'soft' : 'full');
}

function updateGaze(life: LifeController, motion: MotionController, delta: number): void {
  const settings = state.lifeSettings;
  if (settings.followPointer) {
    const range = settings.gazeRange;
    life.gazeTargetYaw = pointerX * 0.27 * range;
    life.gazeTargetPitch = pointerY * 0.16 * range;
    const response = 1 - Math.exp(-delta * 6);
    life.gazeYaw += (life.gazeTargetYaw - life.gazeYaw) * response;
    life.gazePitch += (life.gazeTargetPitch - life.gazePitch) * response;
  } else {
    if (life.lifeTime >= life.nextGazeAt) chooseGazeTarget(life, motion);
    life.gazeElapsed += delta;
    const progress = minimumJerk(life.gazeElapsed / Math.max(0.001, life.gazeDuration));
    life.gazeYaw = THREE.MathUtils.lerp(life.gazeStartYaw, life.gazeTargetYaw, progress);
    life.gazePitch = THREE.MathUtils.lerp(life.gazeStartPitch, life.gazeTargetPitch, progress);
  }

  if (life.lifeTime >= life.nextMicroAt) {
    const amount = settings.microSaccade;
    life.microTargetYaw = normalRandom() * 0.0032 * amount;
    life.microTargetPitch = normalRandom() * 0.0022 * amount;
    life.nextMicroAt = life.lifeTime + THREE.MathUtils.lerp(1.4, 0.24, amount) * (0.65 + Math.random() * 0.8);
  }
  const microResponse = 1 - Math.exp(-delta * 28);
  life.microYaw += (life.microTargetYaw - life.microYaw) * microResponse;
  life.microPitch += (life.microTargetPitch - life.microPitch) * microResponse;
}

function applyBoneOffset(binding: BoneOffsetBinding | undefined | null, offset: any, motion: MotionController): void {
  if (!binding) return;
  if (!motionControlsBone(motion, binding.name)) {
    binding.bone.quaternion.multiply(binding.lastOffset.clone().invert());
  }
  binding.bone.quaternion.multiply(offset).normalize();
  binding.lastOffset.copy(offset);
}

function applyPositionOffset(binding: PositionOffsetBinding | undefined | null, offset: any, motion: MotionController): void {
  if (!binding) return;
  if (!motionControlsBone(motion, binding.name)) binding.bone.position.sub(binding.lastOffset);
  binding.bone.position.add(offset);
  binding.lastOffset.copy(offset);
}

function clearBoneOffsets(life: LifeController, motion: MotionController): void {
  life.eyes.forEach((binding) => applyBoneOffset(binding, IDENTITY, motion));
  BODY_REGIONS.forEach((region) => applyBoneOffset(life.body[region], IDENTITY, motion));
  applyPositionOffset(life.centerPosition, new THREE.Vector3(), motion);
  applyPositionOffset(life.leftFoot, new THREE.Vector3(), motion);
  applyPositionOffset(life.rightFoot, new THREE.Vector3(), motion);
}

function regionOffset(life: LifeController, region: BodyRegion, delta: number): any {
  const settings = state.lifeSettings;
  const segment = settings.segments[region] * settings.sway;
  if (segment <= 0) return IDENTITY;
  const speed = THREE.MathUtils.lerp(0.16, 0.82, settings.swaySpeed);
  const index = BODY_REGIONS.indexOf(region);
  const phase = life.phase + index * 0.91;
  const noiseResponse = 1 - Math.exp(-delta * (0.45 + settings.swayIrregularity * 1.8));
  const noiseTarget = normalRandom() * 0.009 * settings.swayIrregularity;
  life.swayNoise[region] = THREE.MathUtils.lerp(life.swayNoise[region] ?? 0, noiseTarget, noiseResponse);
  const noise = life.swayNoise[region] ?? 0;
  const slow = Math.sin(life.lifeTime * speed + phase);
  const secondary = Math.sin(life.lifeTime * speed * 0.47 + phase * 1.73);
  const yaw = (slow * 0.032 + secondary * 0.011 + noise) * segment;
  const pitch = (secondary * 0.02 + noise * 0.7) * segment;
  const roll = (Math.sin(life.lifeTime * speed * 0.71 + phase * 0.63) * 0.025 - noise * 0.55) * segment;

  switch (region) {
    case 'center': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.35, yaw * 0.32, roll * 0.25));
    case 'hips': return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch * 0.7, -yaw * 0.55, roll * 0.75));
    case 'spineLower': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.8, yaw * 0.65, roll * 0.7));
    case 'spineUpper': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw * 0.82, roll));
    case 'shoulderLeft': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.15, yaw * 0.1, -roll * 0.8));
    case 'shoulderRight': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.15, yaw * 0.1, roll * 0.8));
    case 'neck': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.45, yaw * 0.5, roll * 0.35));
    case 'head': return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.3, yaw * 0.38, roll * 0.32));
  }
}

function updatePostureInertia(life: LifeController, delta: number): void {
  const settings = state.lifeSettings;
  const anchor = life.body.hips?.bone ?? life.body.center?.bone ?? life.body.spineLower?.bone;
  if (!anchor || delta <= 0) return;
  const position = anchor.getWorldPosition(new THREE.Vector3());
  const velocity = position.clone().sub(life.anchorPosition).multiplyScalar(1 / Math.max(0.001, delta));
  const acceleration = velocity.clone().sub(life.anchorVelocity).multiplyScalar(1 / Math.max(0.001, delta));
  life.anchorPosition.copy(position);
  life.anchorVelocity.lerp(velocity, 1 - Math.exp(-delta * 9));
  const response = settings.inertiaResponse;
  const targetPitch = THREE.MathUtils.clamp(-acceleration.z * 0.0026 * response, -0.035, 0.035);
  const targetRoll = THREE.MathUtils.clamp(acceleration.x * 0.0022 * response, -0.028, 0.028);
  const follow = 1 - Math.exp(-delta * THREE.MathUtils.lerp(3, 14, settings.postureRecovery));
  life.posturePitch += (targetPitch - life.posturePitch) * follow;
  life.postureRoll += (targetRoll - life.postureRoll) * follow;
}

function updateFootPlacement(life: LifeController, motion: MotionController): void {
  const settings = state.lifeSettings;
  const zero = new THREE.Vector3();
  const moving = life.anchorVelocity.length() > 0.42;
  const leftPosition = life.leftFoot?.bone.getWorldPosition?.(new THREE.Vector3());
  const rightPosition = life.rightFoot?.bone.getWorldPosition?.(new THREE.Vector3());
  const upper = life.body.spineUpper?.bone ?? life.body.spineLower?.bone;
  const upperQuaternion = upper?.getWorldQuaternion?.(new THREE.Quaternion());
  const upperUp = upperQuaternion ? new THREE.Vector3(0, 1, 0).applyQuaternion(upperQuaternion) : null;
  const supportCenter = leftPosition && rightPosition ? leftPosition.clone().add(rightPosition).multiplyScalar(0.5) : null;
  const supportWidth = leftPosition && rightPosition ? Math.max(0.12, Math.abs(leftPosition.x - rightPosition.x)) : 0.42;
  const lateralLean = supportCenter ? life.anchorPosition.x - supportCenter.x : 0;
  const rollLean = upperUp ? Math.asin(THREE.MathUtils.clamp(upperUp.x, -1, 1)) : 0;
  const offBalance = Math.abs(lateralLean) > supportWidth * 0.18 || Math.abs(rollLean) > 0.13;
  const correctionSide: 'left' | 'right' = lateralLean + rollLean * supportWidth > 0 ? 'right' : 'left';
  if (!settings.footReplant || moving) {
    life.footStepSide = null;
    life.nextFootStepAt = Math.max(life.nextFootStepAt, life.lifeTime + 1.6);
    applyPositionOffset(life.centerPosition, zero, motion);
    applyPositionOffset(life.leftFoot, zero, motion);
    applyPositionOffset(life.rightFoot, zero, motion);
    return;
  }

  if (!life.footStepSide && (offBalance || life.lifeTime >= life.nextFootStepAt)) {
    life.footStepSide = offBalance ? correctionSide : Math.random() < 0.5 ? 'left' : 'right';
    life.footStepStartedAt = life.lifeTime;
  }
  const cycle = life.footStepSide ? (life.lifeTime - life.footStepStartedAt) / 0.72 : 0;
  const progress = THREE.MathUtils.clamp(cycle, 0, 1);
  const lift = Math.sin(Math.PI * progress) * 0.055 * settings.footReplant;
  const travel = Math.sin(Math.PI * progress) * 0.035 * settings.footReplant;
  const side = life.footStepSide === 'left' ? -1 : 1;
  const supportShift = life.footStepSide ? -side * Math.sin(Math.PI * progress) * 0.045 * settings.weightShift : 0;
  const footOffset = new THREE.Vector3(side * travel * 0.35, lift, travel);
  applyPositionOffset(life.centerPosition, new THREE.Vector3(supportShift, 0, 0), motion);
  applyPositionOffset(life.leftFoot, life.footStepSide === 'left' ? footOffset : zero, motion);
  applyPositionOffset(life.rightFoot, life.footStepSide === 'right' ? footOffset : zero, motion);

  if (progress >= 1) {
    life.footStepSide = null;
    life.nextFootStepAt = life.lifeTime + THREE.MathUtils.lerp(3.5, 8.5, Math.random());
  }
}

export function updateLife(
  life: LifeController,
  motion: MotionController,
  delta: number,
  poseAdvanced = true,
): void {
  const settings = state.lifeSettings;
  life.lifeTime += delta;

  if (life.breathAction) {
    const variation = 1 + Math.sin(life.lifeTime * 0.11 + life.phase) * settings.breathVariation * 0.16;
    life.breathAction.enabled = true;
    life.breathAction.setEffectiveWeight(settings.enabled ? settings.breathDepth : 0);
    life.breathAction.setEffectiveTimeScale(Math.max(0.05, settings.breathRate / 60 * variation));
  }

  if (!settings.enabled) {
    life.blinkKind = null;
    applyBlinkMorphs(life, motion, 0, poseAdvanced);
    clearBoneOffsets(life, motion);
    return;
  }

  if (life.lifeTime >= life.nextBlinkAt) triggerBlink(life, motion);
  applyBlinkMorphs(life, motion, blinkProfile(life), poseAdvanced);
  if (!poseAdvanced) return;
  updateGaze(life, motion, delta);
  updatePostureInertia(life, delta);

  const eyeOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    life.gazePitch + life.microPitch,
    life.gazeYaw + life.microYaw,
    0,
  ));
  life.eyes.forEach((binding) => applyBoneOffset(binding, eyeOffset, motion));

  BODY_REGIONS.forEach((region) => {
    let offset = regionOffset(life, region, delta);
    if (region === 'head' || region === 'neck' || region === 'spineUpper') {
      const followScale = region === 'head' ? 1 : region === 'neck' ? 0.42 : 0.12;
      const follow = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        life.gazePitch * settings.headFollow * followScale * 0.55,
        life.gazeYaw * settings.headFollow * followScale,
        0,
      ));
      offset = offset.clone().multiply(follow);
    }
    if (region === 'hips' || region === 'spineLower' || region === 'spineUpper' || region === 'shoulderLeft' || region === 'shoulderRight') {
      const scale = region === 'hips' ? 0.5 : region === 'spineLower' ? 0.78 : region === 'spineUpper' ? 1 : 0.22;
      const inertia = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        life.posturePitch * scale,
        0,
        life.postureRoll * scale,
      ));
      offset = offset.clone().multiply(inertia);
    }
    applyBoneOffset(life.body[region], offset, motion);
  });
  updateFootPlacement(life, motion);
}

export function forceBlink(life: LifeController, motion: MotionController, kind: BlinkKind = 'full'): void {
  triggerBlink(life, motion, kind);
}

export function blinkMorphNames(life: LifeController): string[] {
  return [...new Set(life.blinkTargets.map((target) => target.name))];
}
