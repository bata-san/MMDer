export type AssetKind = 'model' | 'motion' | 'texture';
export type PhysicsPart =
  | 'hairFront'
  | 'hairBack'
  | 'hairSide'
  | 'ears'
  | 'skirt'
  | 'cloth'
  | 'accessory'
  | 'chest'
  | 'torso'
  | 'hips'
  | 'arms'
  | 'legs';
export type BodyRegion =
  | 'center'
  | 'hips'
  | 'spineLower'
  | 'spineUpper'
  | 'shoulderLeft'
  | 'shoulderRight'
  | 'neck'
  | 'head';
export type MotionScope = 'active' | 'selected' | 'all';
export type BlinkKind = 'soft' | 'full' | 'double';
export type InteractionMode = 'select' | 'move' | 'poke';

export interface StoredAsset {
  id: string;
  kind: AssetKind;
  name: string;
  path: string;
  file: File;
  savedAt: number;
}

export interface MotionController {
  mesh: any;
  mixer: any;
  clips: Map<string, any>;
  actions: Map<string, any>;
  current: any | null;
  currentName: string;
}

export interface BlinkMorphTarget {
  node: any;
  name: string;
  index: number;
  lastProcedural: number;
  baseValue: number;
}

export interface BoneOffsetBinding {
  bone: any;
  name: string;
  lastOffset: any;
}

export interface PositionOffsetBinding {
  bone: any;
  name: string;
  lastOffset: any;
}

export interface FootIkRuntime {
  binding: PositionOffsetBinding;
  solver: any;
  floorHeight: number;
  /** World-space controller location at the unmodified pose. */
  restTarget: any;
  /** Controller height minus the visual ankle height at rest. */
  contactOffset: number;
  /** Persistent planted contact; it is updated only after a completed step. */
  plantedTarget: any;
  /** Unmodified local rotations captured immediately before the prior solve. */
  linkBases: Array<{ bone: any; quaternion: any; name: string }>;
}

export interface LegIkChain {
  hip: any;
  knee: any;
  ankle: any;
  lastHipOffset: any;
  lastKneeOffset: any;
  floorHeight: number;
  legLength: number;
}

export interface LifeController {
  mesh: any;
  phase: number;
  blinkTargets: BlinkMorphTarget[];
  mouthTargets: BlinkMorphTarget[];
  expressionTargets: BlinkMorphTarget[];
  jaw?: BoneOffsetBinding;
  mouthValue: number;
  expressionValue: number;
  nextExpressionAt: number;
  nextBlinkAt: number;
  lifeTime: number;
  blinkStartedAt: number;
  blinkDuration: number;
  blinkKind: BlinkKind | null;
  blinkPeak: number;
  breathClip: any | null;
  breathAction: any | null;
  eyes: BoneOffsetBinding[];
  body: Partial<Record<BodyRegion, BoneOffsetBinding>>;
  gazeStartYaw: number;
  gazeStartPitch: number;
  gazeYaw: number;
  gazePitch: number;
  gazeTargetYaw: number;
  gazeTargetPitch: number;
  gazeElapsed: number;
  gazeDuration: number;
  nextGazeAt: number;
  microYaw: number;
  microPitch: number;
  microTargetYaw: number;
  microTargetPitch: number;
  nextMicroAt: number;
  swayNoise: Partial<Record<BodyRegion, number>>;
  anchorPosition: any;
  anchorVelocity: any;
  posturePitch: number;
  postureRoll: number;
  centerPosition?: PositionOffsetBinding;
  leftFoot?: PositionOffsetBinding;
  rightFoot?: PositionOffsetBinding;
  leftFootIk?: FootIkRuntime;
  rightFootIk?: FootIkRuntime;
  nextFootStepAt: number;
  footStepStartedAt: number;
  footStepSide: 'left' | 'right' | null;
  footStepScale: number;
  forceFootStep: boolean;
  /** Test-only COM offset used by the life lab; zero during normal editing. */
  balanceTestOffsetX: number;
  /** Persistent local correction that keeps the pelvis above the support midpoint. */
  balanceCenterOffsetX: number;
  leftLegIk?: LegIkChain;
  rightLegIk?: LegIkChain;
}

export interface PhysicsRuntime {
  engine: any;
  accumulator: number;
  fixedStep: number;
  maxSubSteps: number;
  warmupSteps: number;
  enabled: boolean;
}

export interface SceneModel {
  id: string;
  mesh: any;
  file: File;
  name: string;
  visible: boolean;
  physics: PhysicsRuntime | null;
  motion: MotionController;
  life: LifeController;
}

export interface PhysicsPartSettings {
  enabled: boolean;
  response: number;
  damping: number;
  gravity: number;
  wind: number;
}

export interface PhysicsSettings {
  stiffness: number;
  damping: number;
  gravity: number;
  wind: number;
  turbulence: number;
  quality: number;
  air: number;
  parts: Record<PhysicsPart, PhysicsPartSettings>;
}

export interface ToonSettings {
  specular: number;
  shadowLift: number;
}

export interface LifeSettings {
  enabled: boolean;
  blinkActivity: number;
  blinkStrength: number;
  doubleBlinkChance: number;
  softBlinkChance: number;
  blinkDuration: number;
  blinkOnGaze: number;
  breathRate: number;
  breathDepth: number;
  breathVariation: number;
  gazeActivity: number;
  gazeRange: number;
  gazeDwell: number;
  headFollow: number;
  microSaccade: number;
  followPointer: boolean;
  sway: number;
  swaySpeed: number;
  swayIrregularity: number;
  inertiaResponse: number;
  postureRecovery: number;
  weightShift: number;
  footReplant: number;
  segments: Record<BodyRegion, number>;
}

export interface InteractionSettings {
  mode: InteractionMode;
  groundLock: boolean;
  dragResponse: number;
  pokeStrength: number;
  pokeRadius: number;
  shockwaveSpeed: number;
}

export interface AppState {
  models: SceneModel[];
  active: SceneModel | null;
  selectedModels: SceneModel[];
  motionScope: MotionScope;
  duration: number;
  elapsed: number;
  playing: boolean;
  loop: boolean;
  outline: boolean;
  outlineScale: number;
  environment: any | null;
  environmentStrength: number;
  assets: StoredAsset[];
  rigHandles: any[];
  physics: boolean;
  motionBlend: number;
  loopBlend: number;
  physicsSettings: PhysicsSettings;
  toonSettings: ToonSettings;
  lifeSettings: LifeSettings;
  interactionSettings: InteractionSettings;
  xrPresenting: boolean;
  /** Metres above/below the detected XR local floor. */
  xrFloorHeight: number;
  /** Metres per second for controller-stick locomotion. */
  xrMoveSpeed: number;
  renderScale: number;
}
