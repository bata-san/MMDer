import * as THREE from "three";
import { CCDIKSolver } from "three/addons/animation/CCDIKSolver.js";
import { blinkEnvelope, minimumJerk } from "./life-math.js";
import { motionControlsBone, motionControlsMorph } from "./motion.js";
import { state } from "./state.js";
import type {
  BlinkKind,
  BodyRegion,
  BoneOffsetBinding,
  FootIkRuntime,
  LifeController,
  MotionController,
  PositionOffsetBinding,
} from "./types.js";

let pointerX = 0;
let pointerY = 0;
const IDENTITY = new THREE.Quaternion();
const JP = {
  left: "\u5de6",
  right: "\u53f3",
  foot: "\u8db3",
  knee: "\u3072\u3056",
  ankle: "\u8db3\u9996",
  ik: "IK",
  eye: "\u76ee",
  bothEyes: "\u4e21\u76ee",
  center: "\u30bb\u30f3\u30bf\u30fc",
  hips: "\u4e0b\u534a\u8eab",
  upper: "\u4e0a\u534a\u8eab",
  neck: "\u9996",
  head: "\u982d",
  blink: "\u307e\u3070\u305f\u304d",
};

export function setLifePointer(
  clientX: number,
  clientY: number,
  viewport?: Pick<DOMRect, "left" | "top" | "width" | "height">,
): void {
  const left = viewport?.left ?? 0;
  const top = viewport?.top ?? 0;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  pointerX = THREE.MathUtils.clamp(
    ((clientX - left) / Math.max(width, 1)) * 2 - 1,
    -1,
    1,
  );
  pointerY = THREE.MathUtils.clamp(
    -(((clientY - top) / Math.max(height, 1)) * 2 - 1),
    -1,
    1,
  );
}

function normal(): number {
  const a = Math.max(Math.random(), Number.EPSILON);
  const b = Math.max(Math.random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
function bone(mesh: any, names: string[], english: RegExp[] = []): any | null {
  return (
    mesh.skeleton?.bones?.find(
      (b: any) => names.includes(b.name) || english.some((p) => p.test(b.name)),
    ) ?? null
  );
}
function bind(b: any | null): BoneOffsetBinding | undefined {
  return b
    ? { bone: b, name: b.name, lastOffset: new THREE.Quaternion() }
    : undefined;
}
function posBind(b: any | null): PositionOffsetBinding | undefined {
  return b
    ? { bone: b, name: b.name, lastOffset: new THREE.Vector3() }
    : undefined;
}
function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_.\-]/g, "");
}

function bodyBindings(mesh: any): LifeController["body"] {
  return {
    center: bind(bone(mesh, [JP.center], [/^center$/i])),
    hips: bind(bone(mesh, [JP.hips, "\u8170"], [/hips|pelvis|lowerbody/i])),
    spineLower: bind(bone(mesh, [JP.upper], [/^spine$|upperbody/i])),
    spineUpper: bind(
      bone(mesh, [`${JP.upper}2`], [/chest|spine2|upperbody2/i]),
    ),
    shoulderLeft: bind(
      bone(mesh, [`${JP.left}\u80a9`], [/left.?shoulder|shoulder[_ .-]?l/i]),
    ),
    shoulderRight: bind(
      bone(mesh, [`${JP.right}\u80a9`], [/right.?shoulder|shoulder[_ .-]?r/i]),
    ),
    neck: bind(bone(mesh, [JP.neck], [/^neck$/i])),
    head: bind(bone(mesh, [JP.head], [/^head$/i])),
  };
}

function eyes(mesh: any): BoneOffsetBinding[] {
  const both = bone(mesh, [JP.bothEyes], [/^(both.?eyes?|eyes)$/i]);
  if (both) return [bind(both)!];
  return [
    bind(bone(mesh, [`${JP.left}${JP.eye}`], [/left.?eye|eye[_ .-]?l/i])),
    bind(bone(mesh, [`${JP.right}${JP.eye}`], [/right.?eye|eye[_ .-]?r/i])),
  ].filter(Boolean) as BoneOffsetBinding[];
}

function morphs(
  mesh: any,
  kind: "blink" | "mouth" | "expression",
): LifeController["blinkTargets"] {
  const out: LifeController["blinkTargets"] = [];
  mesh.traverse((node: any) => {
    if (
      !node.isMesh ||
      !node.morphTargetDictionary ||
      !node.morphTargetInfluences
    )
      return;
    Object.entries(
      node.morphTargetDictionary as Record<string, number>,
    ).forEach(([name, raw]) => {
      const key = normalized(name);
      const isBlink =
        key.includes(normalized(JP.blink)) || /blink|eyeclose|wink/.test(key);
      const isMouth =
        /mouth|lip|vowel|open/.test(key) ||
        ["\u3042", "\u3044", "\u3046", "\u3048", "\u304a"].includes(key);
      const isExpression =
        /smile|happy|joy|grin/.test(key) || key.includes("\u7b11");
      if (
        (kind === "blink" && isBlink) ||
        (kind === "mouth" && isMouth && !isBlink) ||
        (kind === "expression" && isExpression)
      ) {
        out.push({
          node,
          name,
          index: Number(raw),
          lastProcedural: 0,
          baseValue: Number(node.morphTargetInfluences[Number(raw)]) || 0,
        });
      }
    });
  });
  return out.slice(0, kind === "blink" ? 1 : 2);
}

function footRuntime(
  mesh: any,
  side: "left" | "right",
): FootIkRuntime | undefined {
  const prefix = side === "left" ? JP.left : JP.right;
  const controller = bone(
    mesh,
    [`${prefix}${JP.foot}${JP.ik}`, `${prefix}${JP.foot}\uff29\uff2b`],
    [new RegExp(`${side}.?foot.?ik|foot.?ik.?${side[0]}`, "i")],
  );
  if (!controller || !mesh.geometry?.userData?.MMD?.iks) return undefined;
  const target = mesh.skeleton.bones.indexOf(controller);
  const definition = mesh.geometry.userData.MMD.iks.find(
    (entry: any) => entry.target === target,
  );
  if (!definition) return undefined;
  // PMX often specifies a single 5° CCD turn because the native runtime
  // repeatedly evaluates it. The life layer has its own held-pose solve, so
  // clone and converge only this leg chain; do not mutate the model's shared
  // IK definition used by the rest of the editor.
  const lifeDefinition = {
    ...definition,
    links: definition.links.map((link: any) => ({
      ...link,
      // Preserve the PMX hinge axis but let the life solver use its bounded
      // CCD angle instead of the authored per-frame rotation clamp.
      rotationMin: undefined,
      rotationMax: undefined,
    })),
    iteration: Math.min(8, Math.max(6, Number(definition.iteration) || 1)),
    maxAngle: Math.min(THREE.MathUtils.degToRad(12), Math.max(THREE.MathUtils.degToRad(10), Number(definition.maxAngle) || 0)),
  };
  const ankle = bone(
    mesh,
    [`${prefix}${JP.ankle}`],
    [new RegExp(`${side}.?(ankle|foot)$|(ankle|foot).?${side[0]}`, "i")],
  );
  mesh.updateWorldMatrix(true, true);
  const restTarget = controller.getWorldPosition(new THREE.Vector3());
  // PMX IK controllers are authored in the same world floor as the rendered
  // sole.  An ankle bone is not a sole marker (high heels, toe bones and D
  // chains all differ), so deriving contact from ankle height makes one foot
  // hover on asymmetric rigs.  Keep each controller's authored floor offset.
  void ankle;
  return {
    binding: posBind(controller)!,
    solver: new CCDIKSolver(mesh, [lifeDefinition]),
    floorHeight: 0,
    restTarget,
    contactOffset: restTarget.y,
    plantedTarget: restTarget.clone(),
    linkBases: [],
  };
}

export function createLifeController(
  mesh: any,
  motion: MotionController,
): LifeController {
  const body = bodyBindings(mesh);
  const anchor = body.hips?.bone ?? body.center?.bone ?? mesh;
  const blinkTargets = morphs(mesh, "blink");
  const mouthTargets = morphs(mesh, "mouth");
  const expressionTargets = morphs(mesh, "expression");
  const phase = Math.random() * Math.PI * 2;
  const leftFootIk = footRuntime(mesh, "left");
  const rightFootIk = footRuntime(mesh, "right");
  return {
    mesh,
    phase,
    blinkTargets,
    mouthTargets,
    expressionTargets,
    jaw: bind(bone(mesh, ["\u3042", "\u820c", "\u53e3"], [/jaw|mouth/i])),
    mouthValue: 0,
    expressionValue: 0,
    nextExpressionAt: 2 + Math.random() * 4,
    nextBlinkAt: 1 + Math.random() * 3,
    lifeTime: 0,
    blinkStartedAt: 0,
    blinkDuration: 0.19,
    blinkKind: null,
    blinkPeak: 0,
    breathClip: null,
    breathAction: null,
    eyes: eyes(mesh),
    body,
    gazeStartYaw: 0,
    gazeStartPitch: 0,
    gazeYaw: 0,
    gazePitch: 0,
    gazeTargetYaw: 0,
    gazeTargetPitch: 0,
    gazeElapsed: 0,
    gazeDuration: 0.2,
    nextGazeAt: 0.5 + Math.random(),
    microYaw: 0,
    microPitch: 0,
    microTargetYaw: 0,
    microTargetPitch: 0,
    nextMicroAt: 0.2 + Math.random() * 0.5,
    swayNoise: {},
    anchorPosition: anchor.getWorldPosition(new THREE.Vector3()),
    anchorVelocity: new THREE.Vector3(),
    posturePitch: 0,
    postureRoll: 0,
    centerPosition: posBind(body.center?.bone ?? body.hips?.bone ?? null),
    leftFoot: undefined,
    rightFoot: undefined,
    leftFootIk,
    rightFootIk,
    nextFootStepAt: Infinity,
    footStepStartedAt: -Infinity,
    footStepSide: null,
    footStepScale: 1,
    forceFootStep: false,
    balanceTestOffsetX: 0,
  };
}

function applyBone(
  binding: BoneOffsetBinding | undefined,
  offset: any,
  motion: MotionController,
): void {
  if (!binding) return;
  if (!motionControlsBone(motion, binding.name))
    binding.bone.quaternion.multiply(binding.lastOffset.clone().invert());
  binding.bone.quaternion.multiply(offset).normalize();
  binding.lastOffset.copy(offset);
}
function applyPosition(
  binding: PositionOffsetBinding | undefined,
  offset: any,
  motion: MotionController,
): void {
  if (!binding) return;
  if (!motionControlsBone(motion, binding.name))
    binding.bone.position.sub(binding.lastOffset);
  binding.bone.position.add(offset);
  binding.lastOffset.copy(offset);
}
function setTarget(
  runtime: FootIkRuntime,
  target: any,
  _motion: MotionController,
): void {
  const binding = runtime.binding;
  const parent = binding.bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  const desiredLocal = parent.worldToLocal(target.clone()); // CCD may rewrite the controller as a side effect of solving the opposite leg. A contact anchor is absolute, so never re-add a stale local delta here.
  binding.bone.position.copy(desiredLocal);
  binding.lastOffset.set(0, 0, 0);
}
function restoreFootPose(
  runtime: FootIkRuntime,
  motion: MotionController,
): void {
  runtime.linkBases.forEach(({ bone, quaternion, name }) => {
    if (!motionControlsBone(motion, name)) bone.quaternion.copy(quaternion);
  });
  runtime.linkBases = [];
}
function solveAnchoredFoot(runtime: FootIkRuntime): void {
  const definition = runtime.solver.iks?.[0];
  const links = definition?.links ?? [];
  const bones =
    runtime.solver.mesh?.skeleton?.bones ?? runtime.solver.bones ?? [];
  runtime.linkBases = links.map((link: any) => {
    const bone = bones[link.index];
    return { bone, name: bone.name, quaternion: bone.quaternion.clone() };
  });
  runtime.solver.update();
}
function restoreD(mesh: any, side: "left" | "right"): void {
  const prefix = side === "left" ? JP.left : JP.right;
  [
    `${prefix}${JP.foot}D`,
    `${prefix}${JP.knee}D`,
    `${prefix}${JP.ankle}D`,
  ].forEach((name) => {
    const bone = mesh.skeleton?.bones?.find(
      (candidate: any) => candidate.name === name,
    );
    const base = bone?.userData?.lifeDBaseQuaternion;
    if (bone && base) bone.quaternion.copy(base);
  });
}
function syncD(
  runtime: FootIkRuntime,
  mesh: any,
  side: "left" | "right",
): void {
  const prefix = side === "left" ? JP.left : JP.right;
  [
    [`${prefix}${JP.foot}`, `${prefix}${JP.foot}D`],
    [`${prefix}${JP.knee}`, `${prefix}${JP.knee}D`],
    [`${prefix}${JP.ankle}`, `${prefix}${JP.ankle}D`],
  ].forEach(([sourceName, destName]) => {
    const source = mesh.skeleton?.bones?.find(
      (b: any) => b.name === sourceName,
    );
    const dest = mesh.skeleton?.bones?.find((b: any) => b.name === destName);
    const sourceBase = runtime.linkBases.find(
      (entry) => entry.name === sourceName,
    )?.quaternion;
    if (!source || !dest || !sourceBase) return;
    const destBase =
      dest.userData.lifeDBaseQuaternion ?? dest.quaternion.clone();
    dest.userData.lifeDBaseQuaternion = destBase;
    const delta = sourceBase.clone().invert().multiply(source.quaternion);
    dest.quaternion.copy(destBase).multiply(delta).normalize();
  });
}

function writeMorph(
  targets: LifeController["blinkTargets"],
  value: number,
  motion: MotionController,
  poseAdvanced: boolean,
): void {
  targets.forEach((target) => {
    const influences = target.node.morphTargetInfluences as number[];
    if (!influences) return;
    const current = Number(influences[target.index]) || 0;
    const mixer =
      poseAdvanced && motionControlsMorph(motion, target.name, target.index);
    const base = THREE.MathUtils.clamp(
      mixer ? current : current - target.lastProcedural,
      0,
      1,
    );
    const add = (1 - base) * THREE.MathUtils.clamp(value, 0, 1);
    influences[target.index] = THREE.MathUtils.clamp(base + add, 0, 1);
    target.baseValue = base;
    target.lastProcedural = add;
  });
}
function blink(life: LifeController): number {
  if (!life.blinkKind) return 0;
  const p = (life.lifeTime - life.blinkStartedAt) / life.blinkDuration;
  if (p >= 1) {
    life.blinkKind = null;
    return 0;
  }
  return blinkEnvelope(life.blinkKind, p) * life.blinkPeak;
}
function startBlink(life: LifeController, kind?: BlinkKind): void {
  if (!life.blinkTargets.length || life.blinkKind) return;
  const r = Math.random();
  const s = state.lifeSettings;
  life.blinkKind =
    kind ??
    (r < s.doubleBlinkChance
      ? "double"
      : r < s.doubleBlinkChance + s.softBlinkChance
        ? "soft"
        : "full");
  life.blinkStartedAt = life.lifeTime;
  life.blinkDuration =
    (life.blinkKind === "double" ? 0.38 : 0.18) *
    THREE.MathUtils.lerp(0.78, 1.3, s.blinkDuration);
  life.blinkPeak = life.blinkKind === "soft" ? 0.62 : 0.96;
  life.nextBlinkAt = life.lifeTime + 1.4 + Math.random() * 4.8;
}

function gaze(life: LifeController, delta: number): void {
  const s = state.lifeSettings;
  if (s.followPointer) {
    life.gazeTargetYaw = pointerX * 0.18 * s.gazeRange;
    life.gazeTargetPitch = pointerY * 0.1 * s.gazeRange;
  } else if (life.lifeTime >= life.nextGazeAt) {
    life.gazeStartYaw = life.gazeYaw;
    life.gazeStartPitch = life.gazePitch;
    life.gazeTargetYaw = normal() * 0.065 * s.gazeRange;
    life.gazeTargetPitch = normal() * 0.035 * s.gazeRange;
    life.gazeElapsed = 0;
    life.gazeDuration = 0.12 + Math.random() * 0.24;
    life.nextGazeAt = life.lifeTime + 0.45 + Math.random() * 1.15;
  }
  life.gazeElapsed += delta;
  const t = minimumJerk(life.gazeElapsed / Math.max(0.001, life.gazeDuration));
  life.gazeYaw = THREE.MathUtils.lerp(life.gazeStartYaw, life.gazeTargetYaw, t);
  life.gazePitch = THREE.MathUtils.lerp(
    life.gazeStartPitch,
    life.gazeTargetPitch,
    t,
  );
  if (life.lifeTime >= life.nextMicroAt) {
    life.microTargetYaw = normal() * 0.0038 * s.microSaccade;
    life.microTargetPitch = normal() * 0.0018 * s.microSaccade;
    life.nextMicroAt = life.lifeTime + 0.28 + Math.random() * 0.72;
  }
  const a = 1 - Math.exp(-delta * 36);
  life.microYaw += (life.microTargetYaw - life.microYaw) * a;
  life.microPitch += (life.microTargetPitch - life.microPitch) * a;
}

function posture(life: LifeController, motion: MotionController): void {
  // PMX models do not share a reliable local spine axis. Until the model-specific pose-preserving solver validates that axis, never rotate the torso procedurally: a small generic pitch is enough to create a visible shrimp-back. Keep every trunk/shoulder binding at its motion pose.
  [
    life.body.center,
    life.body.hips,
    life.body.spineLower,
    life.body.spineUpper,
    life.body.shoulderLeft,
    life.body.shoulderRight,
    life.body.neck,
    life.body.head,
  ].forEach((b) => applyBone(b, IDENTITY, motion));
}

function stance(life: LifeController, motion: MotionController): void {
  const left = life.leftFootIk;
  const right = life.rightFootIk;
  if (!left || !right || !state.lifeSettings.footReplant) return;
  restoreFootPose(left, motion);
  restoreFootPose(right, motion);
  restoreD(life.mesh, "left");
  restoreD(life.mesh, "right");
  life.mesh.updateWorldMatrix(true, true);
  const lc = left.plantedTarget
    .clone()
    .setY(left.floorHeight + left.contactOffset);
  const rc = right.plantedTarget
    .clone()
    .setY(right.floorHeight + right.contactOffset);
  let leftGoal = lc.clone();
  let rightGoal = rc.clone();
  const mid = lc.clone().add(rc).multiplyScalar(0.5);
  const width = Math.max(0.12, Math.abs(lc.x - rc.x));
  const pelvis = life.body.hips?.bone ?? life.body.center?.bone;
  const com = pelvis?.getWorldPosition(new THREE.Vector3()) ?? mid.clone();
  com.x += life.balanceTestOffsetX;
  const lateral = com.x - mid.x;
  if (
    !life.footStepSide &&
    (life.forceFootStep || Math.abs(lateral) > width * 0.18)
  ) {
    life.footStepSide = lateral >= 0 ? "right" : "left";
    life.footStepStartedAt = life.lifeTime;
  }
  // COM correction is lateral only.  Giving a static standing rig an invented
  // forward target or translating the center bone makes its upper chain solve
  // as a backward arch (the former "limbo" pose).
  if (!life.footStepSide) {
    setTarget(left, lc, motion);
    setTarget(right, rc, motion);
    applyPosition(life.centerPosition, new THREE.Vector3(), motion);
  } else {
    const p = THREE.MathUtils.clamp(
      (life.lifeTime - life.footStepStartedAt) / 0.82,
      0,
      1,
    );
    const e = minimumJerk(p);
    const swing = life.footStepSide === "left" ? left : right;
    const planted = life.footStepSide === "left" ? right : left;
    const start = swing.plantedTarget
      .clone()
      .setY(swing.floorHeight + swing.contactOffset);
    const end = swing.plantedTarget
      .clone()
      .setY(swing.floorHeight + swing.contactOffset);
    // The support correction chooses the foot; it must not pull the swing
    // controller through the other leg. Keep this corrective first step
    // vertical and let a later planted step establish lateral spacing.
    const target = start.lerp(end, e);
    target.y += Math.sin(Math.PI * e) * 0.14;
    const plantedGoal = planted.plantedTarget
      .clone()
      .setY(planted.floorHeight + planted.contactOffset);
    if (life.footStepSide === "left") {
      leftGoal = target;
      rightGoal = plantedGoal;
    } else {
      rightGoal = target;
      leftGoal = plantedGoal;
    }
    setTarget(swing, target, motion);
    setTarget(planted, plantedGoal, motion);
    applyPosition(life.centerPosition, new THREE.Vector3(), motion);
    if (p >= 1) {
      swing.plantedTarget.copy(end).setY(swing.restTarget.y);
      life.footStepSide = null;
      life.forceFootStep = false;
      life.footStepScale = 1;
      life.balanceTestOffsetX = 0;
    }
  }
  life.mesh.updateWorldMatrix(true, true);
  setTarget(left, leftGoal, motion);
  setTarget(right, rightGoal, motion);
  // Solve only the two explicit PMX foot chains.  Running the global PMX
  // animation helper here also applies unrelated grants and deforms a held
  // pose.  Keeping the solver local makes the life layer additive and lets us
  // preserve the incoming motion pose on every frame.
  solveAnchoredFoot(left);
  syncD(left, life.mesh, "left");
  solveAnchoredFoot(right);
  syncD(right, life.mesh, "right");
  life.mesh.skeleton?.update?.();
  life.mesh.updateWorldMatrix(true, true);
}

export function updateLife(
  life: LifeController,
  motion: MotionController,
  delta: number,
  poseAdvanced = true,
): void {
  life.lifeTime += delta;
  if (!state.lifeSettings.enabled) {
    writeMorph(life.blinkTargets, 0, motion, poseAdvanced);
    writeMorph(life.mouthTargets, 0, motion, poseAdvanced);
    writeMorph(life.expressionTargets, 0, motion, poseAdvanced);
    life.eyes.forEach((b) => applyBone(b, IDENTITY, motion));
    return;
  }
  if (life.lifeTime >= life.nextBlinkAt) startBlink(life);
  writeMorph(
    life.blinkTargets,
    blink(life) * state.lifeSettings.blinkStrength,
    motion,
    poseAdvanced,
  );
  gaze(life, delta);
  const eye = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.clamp(life.gazePitch + life.microPitch, -0.06, 0.06),
      THREE.MathUtils.clamp(life.gazeYaw + life.microYaw, -0.13, 0.13),
      0,
    ),
  );
  life.eyes.forEach((b) => applyBone(b, eye, motion));
  const breath = Math.max(
    0,
    Math.sin(
      ((life.lifeTime * state.lifeSettings.breathRate) / 60) * Math.PI * 2 +
        life.phase,
    ),
  );
  life.mouthValue +=
    (0.008 + breath * 0.025 - life.mouthValue) * (1 - Math.exp(-delta * 4));
  writeMorph(life.mouthTargets, life.mouthValue, motion, poseAdvanced);
  if (life.lifeTime >= life.nextExpressionAt) {
    life.expressionValue = 0.035 + Math.random() * 0.06;
    life.nextExpressionAt = life.lifeTime + 3 + Math.random() * 5;
  }
  life.expressionValue *= Math.exp(-delta * 0.42);
  writeMorph(
    life.expressionTargets,
    life.expressionValue,
    motion,
    poseAdvanced,
  );
  applyBone(
    life.jaw,
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(life.mouthValue * 0.045, 0, 0),
    ),
    motion,
  );
  posture(life, motion);
  stance(life, motion);
}
export function forceBlink(
  life: LifeController,
  _motion: MotionController,
  kind: BlinkKind = "full",
): void {
  startBlink(life, kind);
}
export function forceFootReplant(life: LifeController): void {
  life.footStepSide = null;
  life.forceFootStep = true;
  life.footStepScale = 1.6;
}
export function blinkMorphNames(life: LifeController): string[] {
  return [...new Set(life.blinkTargets.map((target) => target.name))];
}
