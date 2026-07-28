import * as THREE from 'three';
import { loadModel } from './models.js';
import { state } from './state.js';

const TEST_MODEL = '/@fs/C:/Users/Kawabata Haruki/AppData/Local/Temp/mmd-ik-inspect/Tda式初音ミクV4X_Ver1.00/Tda式初音ミクV4X_Ver1.00.pmx';

function panel(message: string): HTMLPreElement {
  const element = document.createElement('pre');
  element.style.cssText = 'position:fixed;z-index:10000;left:18px;top:62px;margin:0;padding:16px;background:#0b1220e8;color:#e6f2ff;border:1px solid #3d82c8;border-radius:8px;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;pointer-events:none';
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
    const file = new File([await response.arrayBuffer()], 'Tda式初音ミクV4X_Ver1.00.pmx');
    const item = await loadModel(file);
    if (!item?.life.leftFootIk) throw new Error('左足IKコントローラが検出できません');
    const ik = item.life.leftFootIk;
    const ankle = item.mesh.skeleton.bones.find((bone: any) => bone.name === '左足首');
    if (!ankle) throw new Error('左足首が検出できません');
    item.mesh.updateWorldMatrix(true, true);
    const start = ankle.getWorldPosition(new THREE.Vector3());
    const target = ik.binding.bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.22, 0.92, 0.56));
    const parent = ik.binding.bone.parent;
    const before = ik.binding.bone.getWorldPosition(new THREE.Vector3());
    ik.binding.bone.position.add(parent.worldToLocal(target.clone()).sub(parent.worldToLocal(before.clone())));
    item.mesh.updateWorldMatrix(true, true);
    ik.solver.update();
    item.mesh.updateWorldMatrix(true, true);
    const end = ankle.getWorldPosition(new THREE.Vector3());
    const error = end.distanceTo(target);
    const lift = end.y - start.y;
    report.textContent = `IK LAB — 実ランタイム検証\nモデル: ${item.name}\nチェーン: 左足 → 左ひざ → 左足首\n\n開始Y: ${start.y.toFixed(4)}\n目標Y: ${target.y.toFixed(4)}\n到達Y: ${end.y.toFixed(4)}\nリフト: ${lift.toFixed(4)}\n目標誤差: ${error.toFixed(5)}\n\n${error < 0.02 && lift > 0.4 ? 'PASS: 足IKがターゲットへ到達' : 'FAIL: IK未到達'}`;
  } catch (error) {
    report.textContent = `IK LAB FAILED\n${error instanceof Error ? error.message : String(error)}`;
  }
}
