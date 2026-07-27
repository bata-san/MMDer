import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { setNotice } from './dom.js';
import { controls, renderer, resizeScene, scene, stage } from './scene.js';
import { state } from './state.js';

function setXrStageMode(enabled: boolean): void {
  if (enabled) {
    stage.scale.setScalar(0.1);
    stage.position.set(0, 0, -2);
  } else {
    stage.scale.setScalar(1);
    stage.position.set(0, 0, 0);
  }
  stage.updateMatrixWorld(true);
}

function createControllerRay(index: number): void {
  const controller = renderer.xr.getController(index);
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x4a90e2, transparent: true, opacity: 0.65 });
  const ray = new THREE.Line(geometry, material);
  ray.name = `XR_CONTROLLER_RAY_${index}`;
  ray.scale.z = 3;
  controller.add(ray);
  scene.add(controller);
}

export function setupXr(): void {
  createControllerRay(0);
  createControllerRay(1);
  const xrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
  }) as HTMLElement;
  xrButton.id = 'xr-button';
  Object.assign(xrButton.style, {
    position: 'static',
    width: 'auto',
    minWidth: '82px',
    height: '28px',
    padding: '0 10px',
    margin: '0',
    borderRadius: '4px',
    fontSize: '10px',
    lineHeight: '26px',
    opacity: '1',
  });
  document.querySelector('.status')?.append(xrButton);

  renderer.xr.addEventListener('sessionstart', () => {
    state.xrPresenting = true;
    controls.enabled = false;
    setXrStageMode(true);
    renderer.setPixelRatio(1);
    renderer.xr.setFoveation?.(1);
    setNotice('VR MODE — LOCAL FLOOR');
  });
  renderer.xr.addEventListener('sessionend', () => {
    state.xrPresenting = false;
    controls.enabled = true;
    setXrStageMode(false);
    resizeScene();
    setNotice();
  });
}
