import type { BlinkKind } from './types.js';

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function minimumJerk(value: number): number {
  const t = clamp01(value);
  return t * t * t * (10 + t * (-15 + t * 6));
}

export function singleBlinkEnvelope(progress: number): number {
  const t = clamp01(progress);
  const closeEnd = 0.31;
  const holdEnd = 0.40;
  if (t <= closeEnd) return smoothstep(t / closeEnd);
  if (t <= holdEnd) return 1;
  return 1 - smoothstep((t - holdEnd) / (1 - holdEnd));
}

export function blinkEnvelope(kind: BlinkKind, progress: number): number {
  const t = clamp01(progress);
  if (kind !== 'double') return singleBlinkEnvelope(t);
  if (t < 0.45) return singleBlinkEnvelope(t / 0.45);
  if (t < 0.57) return 0;
  return singleBlinkEnvelope((t - 0.57) / 0.43) * 0.9;
}
