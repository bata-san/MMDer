import * as THREE from 'three';
import { loadModel } from './models.js';
import { camera, controls, renderScene, renderer, scene } from './scene.js';
import { state } from './state.js';

const TEST_MODEL = '/@fs/C:/Users/Kawabata Haruki/AppData/Local/Temp/nonomi-ik-inspect/Nonomi_Set1_Hi_1.0/Nonomi_BunnyB_Hi_1.0.pmx';

function panel(message: string): HTMLPreElement {
  const element = document.createElement('pre');
  element.style.cssText = 'position:fixed;z-index:10000;right:18px;top:62px;margin:0;padding:16px;background:#0b1220e8;color:#e6f2ff;border:1px solid #3d82c8;border-radius:8px;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;pointer-events:none';
  element.textContent = message;
  document.body.append(element);
  return element;
}

export async function startIkLab(): Promise<void> {
  const report = panel('IK LAB\n指定PMXを読み込み中…');
  try {
    state.playing = false;
    state.physics = false;
    state.lifeSettings.enabled = false;
    const response = await fetch(TEST_MODEL);
    if (!response.ok) throw new Error(`test model fetch: ${response.status}`);
    const file = new File([await response.arrayBuffer()], decodeURIComponent(TEST_MODEL.split('/').at(-1) || 'ik-test.pmx'));
    const item = await loadModel(file);
    if (!item?.life.leftFootIk) throw new Error('左足IKコントローラが検出できません');
    const skinnedMeshes: any[] = [];
    item.mesh.traverse((node: any) => { if (node.isSkinnedMesh && node.geometry?.attributes?.skinIndex) skinnedMeshes.push(node); });
    const renderMesh = skinnedMeshes.find((node) => ['左足', '左ひざ', '左足首'].every((name) => node.skeleton?.bones?.some((bone: any) => bone.name === name)));
    if (!renderMesh) throw new Error(`脚を持つSkinnedMeshが見つかりません (${skinnedMeshes.length}件を走査)`);
    // Debug rendering must make the *skinned surface* readable as well as the
    // bones. PMX toon materials can be near-black in an isolated test scene,
    // so use a neutral, light-independent material only inside this lab.
    renderMesh.material = new THREE.MeshBasicMaterial({
      color: 0x91d8ff,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    });
    const ik = item.life.leftFootIk;
    const ankle = item.mesh.skeleton.bones.find((bone: any) => bone.name === '左足首');
    if (!ankle) throw new Error('左足首が検出できません');
    item.mesh.updateWorldMatrix(true, true);
    const start = ankle.getWorldPosition(new THREE.Vector3());
    const ankleIndex = renderMesh.skeleton.bones.findIndex((bone: any) => bone.name === '左足首D');
    const legBoneIndices = new Set([ankleIndex, ...['左足D', '左ひざD', '左足先EX'].map((name) => renderMesh.skeleton.bones.findIndex((bone: any) => bone.name === name)).filter((index) => index >= 0)]);
    const skinIndex = renderMesh.geometry.attributes.skinIndex;
    const skinWeight = renderMesh.geometry.attributes.skinWeight;
    let vertexIndex = -1;
    let strongestLegWeight = 0;
    for (let index = 0; index < skinIndex.count; index += 1) {
      const indices = [skinIndex.getX(index), skinIndex.getY(index), skinIndex.getZ(index), skinIndex.getW(index)];
      const weights = [skinWeight.getX(index), skinWeight.getY(index), skinWeight.getZ(index), skinWeight.getW(index)];
      const contribution = weights.reduce((best, weight, slot) => legBoneIndices.has(indices[slot]) ? Math.max(best, weight) : best, 0);
      if (contribution > strongestLegWeight) { strongestLegWeight = contribution; vertexIndex = index; }
    }
    if (vertexIndex < 0 || strongestLegWeight < 0.01) {
      const used = new Set<number>();
      for (let index = 0; index < skinIndex.count; index += 1) [skinIndex.getX(index), skinIndex.getY(index), skinIndex.getZ(index), skinIndex.getW(index)].forEach((value) => used.add(value));
      throw new Error(`左脚チェーンに紐づくスキニング頂点が見つかりません: bones=${renderMesh.skeleton.bones.length} ankle=${ankleIndex} legIndices=${JSON.stringify([...legBoneIndices])} usedRange=${Math.min(...used)}-${Math.max(...used)} usedLeg=${[...legBoneIndices].filter((index) => used.has(index)).join(',')}`);
    }
    const position = renderMesh.geometry.attributes.position;
    const skinnedVertex = () => renderMesh.localToWorld(renderMesh.applyBoneTransform(vertexIndex, new THREE.Vector3(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex))));
    const vertexStart = skinnedVertex();
    // Procedural replant test: shift the center of mass beyond the support
    // interval, then generate the swing-foot target from that loss of balance.
    const rightFoot = item.mesh.skeleton.bones.find((bone: any) => bone.name === '右足ＩＫ');
    const pelvis = item.mesh.skeleton.bones.find((bone: any) => /^(下半身|センター|腰|hips|pelvis)$/i.test(bone.name));
    if (!rightFoot || !pelvis) throw new Error('支持脚または重心ボーンが検出できません');
    const leftSupport = ik.binding.bone.getWorldPosition(new THREE.Vector3());
    const rightSupport = rightFoot.getWorldPosition(new THREE.Vector3());
    const supportMid = (leftSupport.x + rightSupport.x) * 0.5;
    const supportWidth = Math.max(0.1, Math.abs(leftSupport.x - rightSupport.x));
    const simulatedCom = pelvis.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(supportWidth * 0.34, 0, 0));
    const outsideSupport = Math.abs(simulatedCom.x - supportMid) > supportWidth * 0.18;
    if (!outsideSupport) throw new Error('重心が支持域を越えず、ステップは発火しません');
    // Swing target is placed under the shifted COM with natural toe clearance.
    const target = leftSupport.clone().add(new THREE.Vector3((simulatedCom.x - supportMid) * 0.75, 0.38, 0.48));
    const parent = ik.binding.bone.parent;
    const before = ik.binding.bone.getWorldPosition(new THREE.Vector3());
    ik.binding.bone.position.add(parent.worldToLocal(target.clone()).sub(parent.worldToLocal(before.clone())));
    item.mesh.updateWorldMatrix(true, true);
    for (let iteration = 0; iteration < 4; iteration += 1) ik.solver.update();
    item.mesh.updateWorldMatrix(true, true);
    // Tda式は描画頂点を通常の足ボーンではなく D ボーンで保持する。
    // PMXの通常IK解を、実際に重み付けされた変形チェーンへ伝播する。
    const copyWorldTransform = (sourceName: string, destinationName: string) => {
      const source = item.mesh.skeleton.bones.find((bone: any) => bone.name === sourceName);
      const destination = item.mesh.skeleton.bones.find((bone: any) => bone.name === destinationName);
      if (!source || !destination?.parent) return;
      const worldPosition = source.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = source.getWorldQuaternion(new THREE.Quaternion());
      destination.position.copy(destination.parent.worldToLocal(worldPosition));
      destination.quaternion.copy(destination.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQuaternion));
      destination.updateWorldMatrix(true, true);
    };
    copyWorldTransform('左足', '左足D');
    copyWorldTransform('左ひざ', '左ひざD');
    copyWorldTransform('左足首', '左足首D');
    // CCD updates bone transforms; force the skinned vertex palette to be
    // rebuilt before the next renderer pass so the visible mesh proves it.
    renderMesh.skeleton.update();
    const vertexEnd = skinnedVertex();
    const end = ankle.getWorldPosition(new THREE.Vector3());
    const error = end.distanceTo(target);
    const lift = end.y - start.y;
    const vertexShift = vertexEnd.distanceTo(vertexStart);
    // The lab must prove the bend visually, not merely report a number.
    // SkeletonHelper follows the same bones the IK solver has just modified.
    const helper = new THREE.SkeletonHelper(item.mesh);
    (helper.material as any).color.set(0x40a6ff);
    (helper.material as any).linewidth = 3;
    scene.add(helper);
    const targetMarker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), new THREE.MeshBasicMaterial({ color: 0x42d392 }));
    targetMarker.position.copy(target);
    scene.add(targetMarker);
    const startMarker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff7aa2 }));
    startMarker.position.copy(start);
    scene.add(startMarker);
    // Make the procedural decision readable in one frame: orange is the COM
    // after the intentional lean, yellow is the support interval / swing path,
    // pink is the planted foot and green is the generated landing target.
    const comMarker = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffa940 }));
    comMarker.position.copy(simulatedCom);
    scene.add(comMarker);
    const supportLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        leftSupport.clone().setY(Math.min(leftSupport.y, rightSupport.y) + 0.025),
        rightSupport.clone().setY(Math.min(leftSupport.y, rightSupport.y) + 0.025),
      ]),
      new THREE.LineBasicMaterial({ color: 0xf5ca5a }),
    );
    scene.add(supportLine);
    const swingPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start.clone(), target.clone()]),
      new THREE.LineDashedMaterial({ color: 0xffd84a, dashSize: 0.16, gapSize: 0.09 }),
    );
    swingPath.computeLineDistances();
    scene.add(swingPath);
    const focus = new THREE.Vector3().lerpVectors(ankle.getWorldPosition(new THREE.Vector3()), item.mesh.skeleton.bones.find((bone: any) => bone.name === '左足')!.getWorldPosition(new THREE.Vector3()), 0.5);
    camera.position.copy(focus).add(new THREE.Vector3(8, 2.5, 13));
    controls.target.copy(focus);
    controls.update();
    // Keep a one-shot capture hook in the lab only.  Capturing directly from
    // the renderer avoids browser/desktop scaling and proves the rendered pose.
    renderScene();
    const capture = renderer.domElement.toDataURL('image/jpeg', 0.92);
    const captureImage = document.createElement('img');
    captureImage.id = 'ik-lab-render-capture';
    captureImage.alt = 'IK lab renderer capture';
    captureImage.src = capture;
    captureImage.style.display = 'none';
    document.body.append(captureImage);
    report.textContent = `IK LAB — プロシージャル重心移動→ステップ\nモデル: ${item.name}\n状態: 支持域外 → 左脚ステップ発火\n重心偏位: ${(simulatedCom.x - supportMid).toFixed(4)}\n支持幅: ${supportWidth.toFixed(4)}\n\nリフト: ${lift.toFixed(4)}\n前方移動: ${(end.z - start.z).toFixed(4)}\n目標誤差: ${error.toFixed(5)}\n脚頂点の重み: ${strongestLegWeight.toFixed(3)}\n頂点移動: ${vertexShift.toFixed(4)}\n\n${error < 0.02 && lift > 0.2 && vertexShift > 0.05 ? 'PASS: 重心移動からメッシュ変形まで確認' : 'FAIL: メッシュ変形未確認'}`;
  } catch (error) {
    report.textContent = `IK LAB FAILED\n${error instanceof Error ? error.message : String(error)}`;
  }
}
