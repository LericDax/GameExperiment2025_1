import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

import { createBlockMaterials } from './rendering/textures.js';
import { generateWorld, terrainHeight, worldConfig } from './world/generation.js';
import { createPlayerControls } from './player/controls.js';

const overlay = document.getElementById('overlay');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9d6ff);
scene.fog = new THREE.Fog(0xa9d6ff, 20, 140);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
camera.position.set(0, 25, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

const blockMaterials = createBlockMaterials();
const { meshes, solidBlocks, waterColumns } = generateWorld(blockMaterials);
meshes.forEach((mesh) => scene.add(mesh));

const playerControls = createPlayerControls({
  scene,
  camera,
  renderer,
  overlay,
  worldConfig,
  terrainHeight,
  solidBlocks,
  waterColumns,
});

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(20, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const waterMaterial = blockMaterials.water;
let waveTime = 0;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  playerControls.update(delta);

  waveTime += delta;
  const waveOffset = (Math.sin(waveTime * 0.8) + 1) * 0.06;
  waterMaterial.map.offset.y = waveOffset;

  renderer.render(scene, camera);
}

animate();
