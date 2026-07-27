# Procedural behavior model

MMD LAB treats the loaded VMD as the primary performance. The procedural layer is intentionally low-amplitude and additive: it must not replace authored animation or continuously overwrite the same pose.

## Blinking

- Blink output is written through the model's MMD morph targets (`morphTargetInfluences`), not by scaling eyelids or injecting a shader effect.
- The controller first searches for full-eye morphs such as `まばたき`, `瞬き`, `blink`, and `eye close`. If a full-eye target is unavailable, paired left/right wink morphs are used.
- Inter-blink timing is sampled from a bounded log-normal distribution, producing occasional short and long intervals rather than a metronomic cadence.
- Soft, complete, and double blinks are mixed probabilistically. Closing is faster than reopening, and the original morph value is restored exactly at the end.
- Blink contributions are non-accumulating. The controller records the base morph value and only adds its temporary contribution above it.

Reference observations include a mean inter-blink interval of 7.4 seconds with large variation and a high proportion of incomplete blinks in one 240 fps study, plus optoelectronic measurements reporting faster closing than opening.

## Gaze and head coordination

- Eye rotations use a minimum-jerk transition between fixation targets.
- Saccade duration increases with angular amplitude, using a small bounded approximation of the human saccadic main sequence.
- Micro-saccades are low-amplitude stochastic offsets with short response times.
- The head, neck, and upper torso follow only a fraction of the eye movement to avoid robotic whole-head tracking.
- Large gaze shifts can probabilistically trigger a blink.

## Respiration and quiet-standing motion

- Respiration is an additive animation distributed over the lower spine, upper chest, shoulders, and neck.
- Rate, depth, and slow rate variation are independent controls.
- Quiet-standing motion is divided into center, hips, lower/upper spine, left/right shoulders, neck, and head.
- Each body segment combines slow oscillation, a secondary frequency, and bounded stochastic drift. Opposing hip and torso components avoid moving the whole body as one rigid block.

Research on quiet standing describes center-of-pressure sway as a stochastic process containing slow and fast components, while respiration measurably interacts with postural sway. The implementation uses those qualitative constraints rather than attempting a medical or biomechanical simulation.

## Direct dynamics and XR

- Pointer raycasting selects meshes and locates the world-space contact point.
- Poke mode distributes an impulse over nearby dynamic rigid bodies with radial falloff.
- Pull mode applies a damped spring force toward the pointer target rather than teleporting the rigid body.
- Physics tuning is split into front/back/side hair, skirt, cloth, accessories, chest, torso, hips, arms, and legs.
- XR controllers use world-space rays compatible with the same poke path as desktop input.

## Sources

- Three.js AnimationMixer: https://threejs.org/docs/pages/AnimationMixer.html
- Three.js Mesh morph targets: https://threejs.org/docs/pages/Mesh.html
- Three.js Raycaster: https://threejs.org/docs/pages/Raycaster.html
- Three.js VRButton: https://threejs.org/docs/pages/VRButton.html
- Spontaneous blinking, optoelectronic study: https://pubmed.ncbi.nlm.nih.gov/18565090/
- 240 fps spontaneous blink analysis: https://pubmed.ncbi.nlm.nih.gov/30893187/
- Human saccade main sequence: https://pmc.ncbi.nlm.nih.gov/articles/PMC6782780/
- Quiet-standing sway characteristics: https://pmc.ncbi.nlm.nih.gov/articles/PMC4393163/
- Respiration and postural sway: https://pmc.ncbi.nlm.nih.gov/articles/PMC3387343/
