export type AssetKind = 'model' | 'motion' | 'texture';
export type PhysicsPart = 'hair' | 'cloth' | 'body';

export interface StoredAsset {
  id: string;
  kind: AssetKind;
  name: string;
  path: string;
  file: File;
  savedAt: number;
}

export interface BlinkBinding {
  node: any;
  index: number;
  base: number;
}

export interface MotionController {
  mesh: any;
  mixer: any;
  clips: Map<string, any>;
  actions: Map<string, any>;
  current: any | null;
  currentName: string;
  breath: number;
  head: number;
  blink: number;
  nextBlink: number;
  bones: { chest?: any; head?: any };
  morphs: BlinkBinding[];
}

export interface SceneModel {
  mesh: any;
  file: File;
  name: string;
  visible: boolean;
  physics: any | null;
  motion: MotionController;
}

export interface PhysicsSettings {
  stiffness: number;
  damping: number;
  gravity: number;
  wind: number;
  turbulence: number;
  quality: number;
  air: number;
  parts: Record<PhysicsPart, boolean>;
}

export interface SkinSettings {
  specular: number;
  wetness: number;
  roughnessMap: number;
}

export interface AppState {
  models: SceneModel[];
  active: SceneModel | null;
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
  livingMotion: boolean;
  physicsSettings: PhysicsSettings;
  skinSettings: SkinSettings;
}
