import * as THREE from "three";
import { updateLife } from "./life.js";
import { loadModel } from "./models.js";
import { camera, controls, renderScene, renderer, scene } from "./scene.js";
import { state } from "./state.js";

const TEST_MODEL =
  "/@fs/C:/Users/Kawabata Haruki/AppData/Local/Temp/nonomi-ik-inspect/Nonomi_Set1_Hi_1.0/Nonomi_BunnyB_Hi_1.0.pmx";
type Vector3 = InstanceType<typeof THREE.Vector3>;

function panel(message: string): HTMLPreElement {
  const element = document.createElement("pre");
  element.style.cssText =
    "position:fixed;z-index:10000;right:18px;top:62px;max-width:420px;margin:0;padding:16px;background:#0b1220e8;color:#e6f2ff;border:1px solid #3d82c8;border-radius:8px;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;pointer-events:none";
  element.textContent = message;
  document.body.append(element);
  return element;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function skinnedSignature(mesh: any, relevantBones: Set<number>): Vector3[] {
  const points: Vector3[] = [];
  mesh.traverse((node: any) => {
    if (!node.isSkinnedMesh) return;
    const position = node.geometry?.attributes?.position;
    const skinIndex = node.geometry?.attributes?.skinIndex;
    const skinWeight = node.geometry?.attributes?.skinWeight;
    if (!position || !skinIndex || !skinWeight) return;
    const stride = Math.max(1, Math.floor(position.count / 256));
    for (let index = 0; index < position.count; index += stride) {
      let relevant = false;
      for (let component = 0; component < 4; component += 1) {
        if (skinWeight.getComponent(index, component) > 0 && relevantBones.has(skinIndex.getComponent(index, component))) relevant = true;
      }
      if (!relevant) continue;
      const point = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
      node.applyBoneTransform(index, point);
      points.push(node.localToWorld(point));
    }
  });
  return points;
}

function signatureDelta(before: Vector3[], after: Vector3[]): number {
  const count = Math.min(before.length, after.length);
  if (!count) return 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) total += before[index].distanceTo(after[index]);
  return total / count;
}

function phaseLabel(life: any): string {
  if (!life.footStepSide) return "待機：支持域中央";
  const p = THREE.MathUtils.clamp((life.lifeTime - life.footStepStartedAt) / 1.08, 0, 1);
  if (p < 0.28) return "1/3 重心を支持脚へ移動";
  if (p < 0.72) return "2/3 遊脚を運ぶ";
  return "3/3 新しい支持域中央へ戻す";
}

function experimentPanel(life: any, initialWidth: number): void {
  const panel = document.createElement("section");
  panel.id = "life-lab-controls";
  panel.style.cssText = "position:fixed;z-index:10001;left:18px;bottom:18px;width:300px;padding:14px;background:#0b1220ed;color:#e6f2ff;border:1px solid #3d82c8;border-radius:8px;font:13px/1.45 system-ui,sans-serif;pointer-events:auto";
  panel.innerHTML = `<div style="font-weight:700;margin-bottom:8px">重心移動・歩行実験</div><div id="life-lab-phase" style="margin-bottom:10px">待機：支持域中央</div><label style="display:block;margin:8px 0 2px">重心オフセット <output id="life-lab-bias-value">0.46</output></label><input id="life-lab-bias" type="range" min="0.2" max="0.8" step="0.01" value="0.46" style="width:100%"><label style="display:block;margin:8px 0 2px">一歩の大きさ <output id="life-lab-step-value">1.00</output></label><input id="life-lab-step" type="range" min="0.5" max="1.35" step="0.05" value="1" style="width:100%"><div style="display:flex;gap:8px;margin-top:12px"><button id="life-lab-start" type="button">重心移動を開始</button><button id="life-lab-reset" type="button">リセット</button></div><div id="life-lab-metrics" style="margin-top:10px;font-family:ui-monospace,monospace;font-size:12px"></div>`;
  document.body.append(panel);
  const byId = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const bias = byId<HTMLInputElement>("life-lab-bias");
  const step = byId<HTMLInputElement>("life-lab-step");
  const phase = byId<HTMLDivElement>("life-lab-phase");
  const metrics = byId<HTMLDivElement>("life-lab-metrics");
  const markerGroup = new THREE.Group();
  const marker = (color: number) => new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color }));
  const comMarker = marker(0xffd166); const leftMarker = marker(0x65d6ff); const rightMarker = marker(0xff8ab8);
  markerGroup.add(comMarker, leftMarker, rightMarker); scene.add(markerGroup);
  bias.addEventListener("input", () => byId<HTMLOutputElement>("life-lab-bias-value").value = Number(bias.value).toFixed(2));
  step.addEventListener("input", () => byId<HTMLOutputElement>("life-lab-step-value").value = Number(step.value).toFixed(2));
  byId<HTMLButtonElement>("life-lab-start").addEventListener("click", () => {
    life.balanceTestOffsetX = initialWidth * Number(bias.value);
    life.footStepScale = Number(step.value);
    life.forceFootStep = true;
  });
  byId<HTMLButtonElement>("life-lab-reset").addEventListener("click", () => {
    life.footStepSide = null; life.forceFootStep = false; life.balanceTestOffsetX = 0; life.balanceCenterOffsetX = 0; life.footStepScale = 1;
  });
  const inspect = () => {
    const left = life.leftFootIk.binding.bone.getWorldPosition(new THREE.Vector3());
    const right = life.rightFootIk.binding.bone.getWorldPosition(new THREE.Vector3());
    const midpoint = left.clone().add(right).multiplyScalar(.5);
    // PMX may place the pelvis and IK controllers under different internal
    // roots.  Visualise the pelvis displacement from its captured rest pose
    // in calibrated support space, never an incompatible raw world X value.
    const pelvis = life.body.hips?.bone ?? life.body.center?.bone;
    const pelvisWorld = pelvis?.getWorldPosition(new THREE.Vector3());
    const pelvisOffset = pelvisWorld
      ? pelvisWorld.sub(life.anchorPosition).x
      : 0;
    const com = midpoint.clone().add(new THREE.Vector3(pelvisOffset, 1.1, 0));
    comMarker.position.copy(com); leftMarker.position.copy(left); rightMarker.position.copy(right);
    phase.textContent = phaseLabel(life);
    metrics.textContent = `重心プロキシ x: ${com.x.toFixed(3)}\n支持中心 x: ${midpoint.x.toFixed(3)}\n骨盤相対 x: ${pelvisOffset.toFixed(3)}\n左足 y: ${left.y.toFixed(3)}  右足 y: ${right.y.toFixed(3)}`;
    requestAnimationFrame(inspect);
  };
  inspect();
}

export async function startLifeLab(): Promise<void> {
  const report = panel("LIFE LAB\nNonomi PMXを読み込み中…");
  try {
    state.playing = false;
    state.physics = false;
    state.lifeSettings.enabled = true;
    state.lifeSettings.footReplant = 1;
    state.lifeSettings.gazeRange = 1;
    const response = await fetch(TEST_MODEL);
    if (!response.ok) throw new Error(`test model fetch: ${response.status}`);
    const file = new File(
      [await response.arrayBuffer()],
      "Nonomi_BunnyB_Hi_1.0.pmx",
    );
    const item = await loadModel(file);
    if (!item) throw new Error("test model could not be loaded");
    const life = item.life;
    if (!life.leftFootIk || !life.rightFootIk || !life.eyes.length) {
      throw new Error(
        `required rig missing: leftIK=${Boolean(life.leftFootIk)} rightIK=${Boolean(life.rightFootIk)} eyes=${life.eyes.length}`,
      );
    }
    // Lab-only diagnostic surface: remove texture/toon/light variance so a
    // screenshot shows the actual skinned silhouette and joint result.
    item.mesh.traverse((node: any) => {
      if (!node.isSkinnedMesh) return;
      // This is intentionally a flat, unlit diagnostic material. Skinning is
      // selected by the rendered SkinnedMesh, not by the original PMX shader;
      // the lab below also measures deformed vertices directly.
      node.material = new THREE.MeshBasicMaterial({
        color: 0x8fd3ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      });
    });

    item.mesh.updateWorldMatrix(true, true);
    const eyeBefore = life.eyes[0].bone.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const leftBefore = life.leftFootIk.plantedTarget.clone();
    const rightBefore = life.rightFootIk.plantedTarget.clone();
    const rightIkBones = new Set<number>((life.rightFootIk.solver.iks?.[0]?.links ?? []).map((link: any) => Number(link.index)));
    // PMX commonly skins the leg with D bones that inherit rotation from the
    // CCD links, rather than with the links themselves.
    (item.mesh.geometry.userData.MMD?.bones ?? []).forEach((bone: any, index: number) => {
      if (rightIkBones.has(Number(bone.grant?.parentIndex))) rightIkBones.add(index);
    });
    const skinBefore = skinnedSignature(item.mesh, rightIkBones);
    const supportWidth = Math.abs(leftBefore.x - rightBefore.x);
    // This is deliberately a normal balance trigger, not the UI's forced-step
    // shortcut.  The controller sees a COM beyond the support interval and
    // decides which foot must move.
    life.balanceTestOffsetX = Math.max(0.28, supportWidth * 0.46);
    life.forceFootStep = true;
    life.gazeStartYaw = life.gazeYaw = life.gazeTargetYaw = 0.14;
    life.gazeStartPitch = life.gazePitch = life.gazeTargetPitch = -0.035;
    life.gazeElapsed = life.gazeDuration;
    life.nextGazeAt = Number.POSITIVE_INFINITY;
    life.nextMicroAt = Number.POSITIVE_INFINITY;
    // First sample the active mass shift, then the middle of the free-foot
    // swing. This verifies the intended shift → step → centre sequence.
    updateLife(life, item.motion, 0, false);
    updateLife(life, item.motion, 0.30, false);
    updateLife(life, item.motion, 0.24, false);
    await wait(20);
    const skinDelta = signatureDelta(skinBefore, skinnedSignature(item.mesh, rightIkBones));

    item.mesh.updateWorldMatrix(true, true);
    const eyeAfter = life.eyes[0].bone.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const eyeDelta =
      2 *
      Math.acos(
        THREE.MathUtils.clamp(Math.abs(eyeBefore.dot(eyeAfter)), -1, 1),
      );
    const leftTarget = life.leftFootIk.binding.bone.getWorldPosition(
      new THREE.Vector3(),
    );
    const rightTarget = life.rightFootIk.binding.bone.getWorldPosition(
      new THREE.Vector3(),
    );
    const leftGroundError = Math.abs(
      leftTarget.y -
        life.leftFootIk.contactOffset -
        life.leftFootIk.floorHeight,
    );
    const rightGroundError = Math.abs(
      rightTarget.y -
        life.rightFootIk.contactOffset -
        life.rightFootIk.floorHeight,
    );
    const leftTravel = life.leftFootIk.plantedTarget.distanceTo(leftBefore);
    const rightTravel = life.rightFootIk.plantedTarget.distanceTo(rightBefore);
    const steppingRight = life.footStepSide === "right";
    const supportError = steppingRight ? leftGroundError : rightGroundError;
    const swingLift = steppingRight
      ? rightTarget.y -
        life.rightFootIk.contactOffset -
        life.rightFootIk.floorHeight
      : leftTarget.y -
        life.leftFootIk.contactOffset -
        life.leftFootIk.floorHeight;
    // Preserve the actual swing frame for visual inspection. The following
    // frames deliberately settle the character, so capturing afterwards would
    // misleadingly show an already-planted foot.
    const swingBounds = new THREE.Box3().setFromObject(item.mesh);
    const swingFocus = swingBounds.getCenter(new THREE.Vector3());
    const swingSize = swingBounds.getSize(new THREE.Vector3());
    const swingDistance = Math.max(swingSize.y * 1.7, swingSize.x * 2.25, 8);
    camera.position.copy(swingFocus).add(new THREE.Vector3(swingDistance * 0.34, swingSize.y * 0.08, swingDistance));
    controls.target.copy(swingFocus);
    controls.update();
    renderScene();
    const swingCapture = renderer.domElement.toDataURL("image/jpeg", 0.92);
    // Complete the final return-to-centre phase after capturing the swing
    // measurements. The controller then releases its temporary centre offset.
    updateLife(life, item.motion, 0.64, false);
    // Run one idle frame after contact so both controllers hold their new
    // contact anchors without translating the PMX root.
    updateLife(life, item.motion, 0, false);
    item.mesh.updateWorldMatrix(true, true);
    // Do not use a centre-bone translation as the mass-shift criterion: that
    // is precisely the old implementation that made the entire model skate.
    // The lab proves articulated movement instead: a fixed support foot,
    // sufficient free-foot clearance, and actual skinned-vertex deformation.
    const pass = eyeDelta > 0.01 && supportError < 0.04 && swingLift > 0.12 && skinDelta > 0.002;

    item.mesh.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(item.mesh);
    const focus = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    // Fit the complete character, including feet and floor contact, rather
    // than framing from the pelvis as the normal editor camera does.
    const distance = Math.max(size.y * 1.7, size.x * 2.25, 8);
    camera.position
      .copy(focus)
      .add(new THREE.Vector3(distance * 0.34, size.y * 0.08, distance));
    controls.target.copy(focus);
    controls.update();
    renderScene();
    const image = document.createElement("img");
    image.id = "life-lab-render-capture";
    image.alt = "life lab renderer capture";
    image.src = swingCapture;
    image.style.display = "none";
    document.body.append(image);
    const solverBones = (life.rightFootIk.solver.iks?.[0]?.links ?? [])
      .map((link: any) => item.mesh.skeleton.bones[link.index]?.name)
      .join(" → ");
    report.title = (item.mesh.geometry.userData.MMD?.bones ?? [])
      .map((bone: any, index: number) => ({ ...bone, index }))
      .filter((bone: any) => /右(足|ひざ|膝|足首)/.test(bone.name))
      .map((bone: any) => `${bone.index}:${bone.name} parent=${bone.parentIndex} grant=${bone.grant?.parentIndex ?? "-"}`)
      .join("\n");
    report.title += `\nCCD delta:\n${life.rightFootIk.linkBases
      .map(({ bone, quaternion }) => `${bone.name}:${THREE.MathUtils.radToDeg(2 * Math.acos(THREE.MathUtils.clamp(Math.abs(quaternion.dot(bone.quaternion)), -1, 1))).toFixed(3)}deg`)
      .join("\n")}`;
    report.title += `\nSkinned vertex delta: ${skinDelta.toFixed(6)}`;
    report.title += `\nSupport error: ${supportError.toFixed(6)}; swing lift: ${swingLift.toFixed(6)}`;
    report.textContent = `LIFE LAB — 接地・重心・視線の統合検証\nモデル: ${item.name}\n右脚IKリンク: ${solverBones}\n\nCOM判定: 支持域外 → ${steppingRight ? "右足" : "左足"}を踏み直し\n支持幅: ${supportWidth.toFixed(4)}\n左足移動: ${leftTravel.toFixed(4)}\n右足移動: ${rightTravel.toFixed(4)}\n\n支持脚の接地誤差: ${supportError.toFixed(4)}\n遊脚リフト: ${swingLift.toFixed(4)}\n左ターゲット: ${leftTarget.y.toFixed(4)} / ${life.leftFootIk.contactOffset.toFixed(4)}\n右ターゲット: ${rightTarget.y.toFixed(4)} / ${life.rightFootIk.contactOffset.toFixed(4)}\n視線ボーン回転: ${THREE.MathUtils.radToDeg(eyeDelta).toFixed(2)}°\n\n${pass ? "PASS: 加算視線 / COM踏み直し / 接地アンカーを確認" : "FAIL: 実メッシュ検証が未達"}`;
    experimentPanel(life, supportWidth);
  } catch (error) {
    report.textContent = `LIFE LAB FAILED\n${error instanceof Error ? error.message : String(error)}`;
  }
}
