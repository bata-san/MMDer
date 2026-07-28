import fs from 'node:fs/promises';
import * as THREE from 'three';
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';

const modelPath = process.argv[2];
if (!modelPath) throw new Error('Usage: node scripts/verify-leg-ik.mjs <model.pmx>');

const raw = await fs.readFile(modelPath);
const data = new MMDParser.Parser().parsePmx(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), true);
const bones = data.bones.map((source) => {
  const bone = new THREE.Bone();
  bone.name = source.name;
  return bone;
});

data.bones.forEach((source, index) => {
  const bone = bones[index];
  const parent = source.parentIndex >= 0 ? bones[source.parentIndex] : null;
  const absolute = new THREE.Vector3().fromArray(source.position);
  if (parent) {
    const parentAbsolute = new THREE.Vector3().fromArray(data.bones[source.parentIndex].position);
    bone.position.copy(absolute.sub(parentAbsolute));
    parent.add(bone);
  } else {
    bone.position.copy(absolute);
  }
});
const roots = bones.filter((_, index) => data.bones[index].parentIndex < 0);
roots.forEach((root) => root.updateWorldMatrix(true, true));
const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
roots.forEach((root) => mesh.add(root));
mesh.bind(new THREE.Skeleton(bones));
const iks = data.bones.flatMap((source, index) => source.ik ? [{
  target: index,
  effector: source.ik.effector,
  iteration: source.ik.iteration,
  maxAngle: source.ik.maxAngle * 4,
  links: source.ik.links,
}] : []);

function bone(name) {
  const value = bones.find((item) => item.name === name);
  if (!value) throw new Error(`Missing bone: ${name}`);
  return value;
}

function rotateToward(link, end, target) {
  link.updateWorldMatrix(true, false);
  end.updateWorldMatrix(true, false);
  const origin = link.getWorldPosition(new THREE.Vector3());
  const from = end.getWorldPosition(new THREE.Vector3()).sub(origin);
  const to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const parentWorld = link.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
  link.quaternion.premultiply(localDelta).normalize();
  link.updateWorldMatrix(true, false);
}

function verify(side, names) {
  const hip = bone(names.hip);
  const knee = bone(names.knee);
  const ankle = bone(names.ankle);
  const controller = bone(names.controller);
  const start = ankle.getWorldPosition(new THREE.Vector3());
  const legLength = hip.getWorldPosition(new THREE.Vector3()).distanceTo(knee.getWorldPosition(new THREE.Vector3()))
    + knee.getWorldPosition(new THREE.Vector3()).distanceTo(start);
  // Same scale as the application test: a clear but reachable replant.
  const target = start.clone().add(new THREE.Vector3(side === 'left' ? 0.22 : -0.22, legLength * 0.09, legLength * 0.055));
  const controllerWorld = controller.getWorldPosition(new THREE.Vector3());
  const targetLocal = controller.parent.worldToLocal(target.clone());
  const controllerLocal = controller.parent.worldToLocal(controllerWorld.clone());
  controller.position.add(targetLocal.sub(controllerLocal));
  mesh.updateMatrixWorld(true);
  const ik = iks.find((candidate) => candidate.target === bones.indexOf(controller));
  if (!ik) throw new Error(`Missing PMX IK definition for ${controller.name}`);
  new CCDIKSolver(mesh, [ik]).update();
  const end = ankle.getWorldPosition(new THREE.Vector3());
  const error = end.distanceTo(target);
  const lift = end.y - start.y;
  const result = { side, chain: [hip.name, knee.name, ankle.name], legLength: Number(legLength.toFixed(4)), targetLift: Number((target.y - start.y).toFixed(4)), actualLift: Number(lift.toFixed(4)), targetError: Number(error.toFixed(5)) };
  if (error > 0.035 || lift < legLength * 0.045) throw new Error(`IK verification failed: ${JSON.stringify(result)}`);
  return result;
}

const result = [
  verify('left', { hip: '左足', knee: '左ひざ', ankle: '左足首', controller: '左足ＩＫ' }),
  verify('right', { hip: '右足', knee: '右ひざ', ankle: '右足首', controller: '右足ＩＫ' }),
];
console.log(JSON.stringify({ model: data.metadata.modelName, bones: data.bones.length, result }, null, 2));
