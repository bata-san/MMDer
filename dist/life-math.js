export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
export function smoothstep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}
export function minimumJerk(value) {
    const t = clamp01(value);
    return t * t * t * (10 + t * (-15 + t * 6));
}
export function singleBlinkEnvelope(progress) {
    const t = clamp01(progress);
    const closeEnd = 0.31;
    const holdEnd = 0.40;
    if (t <= closeEnd)
        return smoothstep(t / closeEnd);
    if (t <= holdEnd)
        return 1;
    return 1 - smoothstep((t - holdEnd) / (1 - holdEnd));
}
export function blinkEnvelope(kind, progress) {
    const t = clamp01(progress);
    if (kind !== 'double')
        return singleBlinkEnvelope(t);
    if (t < 0.45)
        return singleBlinkEnvelope(t / 0.45);
    if (t < 0.57)
        return 0;
    return singleBlinkEnvelope((t - 0.57) / 0.43) * 0.9;
}
