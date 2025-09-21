import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

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

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
};
let jumpRequested = false;

const clock = new THREE.Clock();

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

function onKeyDown(event) {
  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = true;
      break;
    case 'Space':
      jumpRequested = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      moveState.sprint = true;
      break;
    default:
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = false;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      moveState.sprint = false;
      break;
    default:
      break;
  }
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const bigint = parseInt(value, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function createProceduralTexture({
  baseColor = '#ffffff',
  accentColor = '#dddddd',
  noiseStrength = 0.25,
  vignette = 0.15,
  size = 64,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const base = hexToRgb(baseColor);
  const accent = hexToRgb(accentColor);

  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (x + y * size) * 4;
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const vignetteFactor = 1 - vignette * distance;
      const random = Math.random() * noiseStrength - noiseStrength / 2;
      imageData.data[index] = THREE.MathUtils.clamp(
        base.r + (accent.r - 128) * random,
        0,
        255
      );
      imageData.data[index + 1] = THREE.MathUtils.clamp(
        base.g + (accent.g - 128) * random,
        0,
        255
      );
      imageData.data[index + 2] = THREE.MathUtils.clamp(
        base.b + (accent.b - 128) * random,
        0,
        255
      );
      imageData.data[index + 3] = 255 * vignetteFactor;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  return texture;
}

const textures = {
  grass: createProceduralTexture({
    baseColor: '#4a9c47',
    accentColor: '#6fd25f',
    noiseStrength: 0.6,
  }),
  dirt: createProceduralTexture({
    baseColor: '#6b4a2f',
    accentColor: '#56331a',
    noiseStrength: 0.4,
  }),
  stone: createProceduralTexture({
    baseColor: '#8c8c8c',
    accentColor: '#cccccc',
    noiseStrength: 0.2,
  }),
  sand: createProceduralTexture({
    baseColor: '#d7c27a',
    accentColor: '#f0e4a0',
    noiseStrength: 0.35,
  }),
  water: createProceduralTexture({
    baseColor: '#2c70c9',
    accentColor: '#4fa4ff',
    noiseStrength: 0.5,
  }),
  leaf: createProceduralTexture({
    baseColor: '#3f7c35',
    accentColor: '#79c35a',
    noiseStrength: 0.6,
  }),
  log: createProceduralTexture({
    baseColor: '#725032',
    accentColor: '#9c7045',
    noiseStrength: 0.45,
  }),
  cloud: createProceduralTexture({
    baseColor: '#f7f8fb',
    accentColor: '#d9e5ff',
    noiseStrength: 0.2,
    vignette: 0.02,
  }),
};

const blockMaterials = {
  grass: new THREE.MeshStandardMaterial({ map: textures.grass }),
  dirt: new THREE.MeshStandardMaterial({ map: textures.dirt }),
  stone: new THREE.MeshStandardMaterial({ map: textures.stone }),
  sand: new THREE.MeshStandardMaterial({ map: textures.sand }),
  water: new THREE.MeshStandardMaterial({
    map: textures.water,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  }),
  leaf: new THREE.MeshStandardMaterial({ map: textures.leaf }),
  log: new THREE.MeshStandardMaterial({ map: textures.log }),
  cloud: new THREE.MeshStandardMaterial({
    map: textures.cloud,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  }),
};

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

class ValueNoise2D {
  constructor(seed = 1) {
    this.seed = seed;
  }

  hash(x, y) {
    const s = Math.sin(x * 374761393 + y * 668265263 + this.seed * 951.1357);
    return s - Math.floor(s);
  }

  smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const sx = this.smoothstep(x - x0);
    const sy = this.smoothstep(y - y0);

    const n0 = this.hash(x0, y0);
    const n1 = this.hash(x1, y0);
    const ix0 = THREE.MathUtils.lerp(n0, n1, sx);

    const n2 = this.hash(x0, y1);
    const n3 = this.hash(x1, y1);
    const ix1 = THREE.MathUtils.lerp(n2, n3, sx);

    return THREE.MathUtils.lerp(ix0, ix1, sy);
  }
}

const noiseGenerator = new ValueNoise2D(1337);

const worldConfig = {
  chunkSize: 48,
  maxHeight: 20,
  baseHeight: 6,
  waterLevel: 8,
};

function terrainHeight(x, z) {
  const frequency1 = 0.06;
  const frequency2 = 0.12;
  const amplitude1 = 8;
  const amplitude2 = 3;

  const n1 = noiseGenerator.noise(x * frequency1, z * frequency1);
  const n2 = noiseGenerator.noise(x * frequency2 + 100, z * frequency2 + 100);
  const combined = n1 * amplitude1 + n2 * amplitude2;
  const height = worldConfig.baseHeight + combined;
  return Math.floor(THREE.MathUtils.clamp(height, 2, worldConfig.maxHeight));
}

function randomAt(x, z, offset = 0) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + offset * 43758.5453 + worldConfig.chunkSize);
  return value - Math.floor(value);
}

const instancedData = {
  grass: [],
  dirt: [],
  stone: [],
  sand: [],
  water: [],
  leaf: [],
  log: [],
  cloud: [],
};

const solidTypes = new Set(['grass', 'dirt', 'stone', 'sand', 'leaf', 'log']);
const solidBlocks = new Set();

function blockKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

const matrix = new THREE.Matrix4();

function addBlock(type, x, y, z) {
  matrix.setPosition(x, y, z);
  instancedData[type].push(matrix.clone());
  if (solidTypes.has(type)) {
    solidBlocks.add(blockKey(x, y, z));
  }
}

function addTree(x, z, groundHeight) {
  const treeHeight = 3 + Math.floor(randomAt(x, z, 2) * 3);
  for (let y = 1; y <= treeHeight; y++) {
    addBlock('log', x, groundHeight + y, z);
  }

  const canopyRadius = 2;
  const canopyCenter = groundHeight + treeHeight;
  for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
    for (let dy = -canopyRadius; dy <= canopyRadius; dy++) {
      for (let dz = -canopyRadius; dz <= canopyRadius; dz++) {
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= canopyRadius + (dy === canopyRadius ? 0 : -0.3)) {
          addBlock('leaf', x + dx, canopyCenter + dy, z + dz);
        }
      }
    }
  }
}

function addCloud(x, y, z) {
  const blocks = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 1],
    [-1, 0, -1],
  ];
  blocks.forEach(([dx, dy, dz]) => addBlock('cloud', x + dx, y + dy, z + dz));
}

const halfSize = worldConfig.chunkSize / 2;
for (let x = -halfSize; x < halfSize; x++) {
  for (let z = -halfSize; z < halfSize; z++) {
    const height = terrainHeight(x, z);
    const surfaceType = height <= worldConfig.waterLevel + 1 ? 'sand' : 'grass';

    for (let y = 0; y <= height; y++) {
      if (y === height) {
        addBlock(surfaceType, x, y, z);
      } else if (y < height - 4) {
        addBlock('stone', x, y, z);
      } else {
        addBlock('dirt', x, y, z);
      }
    }

    if (height < worldConfig.waterLevel) {
      for (let y = height + 1; y <= worldConfig.waterLevel; y++) {
        addBlock('water', x, y, z);
      }
    } else if (surfaceType === 'grass' && randomAt(x, z, 1) > 0.92) {
      addTree(x, z, height);
    }

    if (randomAt(x, z, 5) > 0.98 && height > worldConfig.waterLevel + 4) {
      const shrubHeight = height + 1;
      addBlock('leaf', x, shrubHeight, z);
      if (randomAt(x + 10, z + 10, 6) > 0.6) {
        addBlock('leaf', x, shrubHeight + 1, z);
      }
    }
  }
}

for (let i = 0; i < 8; i++) {
  const cx = (randomAt(i * 7, i * 13, 3) - 0.5) * worldConfig.chunkSize;
  const cz = (randomAt(i * 5, i * 11, 4) - 0.5) * worldConfig.chunkSize;
  const cy = worldConfig.waterLevel + 15 + randomAt(i * 3, i * 9, 8) * 8;
  addCloud(Math.round(cx), Math.round(cy), Math.round(cz));
}

function buildInstancedMeshes() {
  Object.entries(instancedData).forEach(([type, matrices]) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      blockGeometry,
      blockMaterials[type],
      matrices.length
    );
    matrices.forEach((m, index) => mesh.setMatrixAt(index, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = ['cloud', 'water'].includes(type) ? false : true;
    mesh.receiveShadow = type !== 'cloud';
    scene.add(mesh);
  });
}

buildInstancedMeshes();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(20, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const waterMaterial = blockMaterials.water;
let waveTime = 0;

const playerEyeHeight = 1.7;
const playerHeight = 1.8;
const playerRadius = 0.35;
const gravity = 18;
const jumpVelocity = 7.8;
let verticalVelocity = 0;
let isGrounded = false;
controls.getObject().position.set(0, worldConfig.waterLevel + playerEyeHeight + 1, 0);

function clampToWorld(position) {
  const min = -halfSize + 1;
  const max = halfSize - 1;
  position.x = THREE.MathUtils.clamp(position.x, min, max);
  position.z = THREE.MathUtils.clamp(position.z, min, max);
}

function sampleHeight(x, z) {
  return terrainHeight(Math.round(x), Math.round(z));
}

const collisionOffsets = [
  [0, 0],
  [playerRadius, 0],
  [-playerRadius, 0],
  [0, playerRadius],
  [0, -playerRadius],
  [playerRadius, playerRadius],
  [playerRadius, -playerRadius],
  [-playerRadius, playerRadius],
  [-playerRadius, -playerRadius],
];

function collidesAt(position) {
  const playerFeet = position.y - playerEyeHeight;
  const minY = Math.floor(playerFeet + 0.6);
  const maxY = Math.floor(playerFeet + playerHeight);
  if (minY > maxY) {
    return false;
  }

  for (const [dx, dz] of collisionOffsets) {
    const sampleX = position.x + dx;
    const sampleZ = position.z + dz;
    const blockX = Math.round(sampleX);
    const blockZ = Math.round(sampleZ);
    for (let y = minY; y <= maxY; y++) {
      if (solidBlocks.has(blockKey(blockX, y, blockZ))) {
        return true;
      }
    }
  }

  return false;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  const { forward, backward, left, right, sprint } = moveState;
  const direction = new THREE.Vector3();
  direction.z = Number(forward) - Number(backward);
  direction.x = Number(right) - Number(left);
  if (direction.lengthSq() > 0) {
    direction.normalize();
    const baseSpeed = 5.2;
    const sprintBonus = sprint && forward ? 3.2 : 0;
    const moveSpeed = baseSpeed + sprintBonus;
    const moveX = direction.x * moveSpeed * delta;
    const moveZ = direction.z * moveSpeed * delta;

    const yaw = controls.getObject().rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const worldX = moveX * cos - moveZ * sin;
    const worldZ = moveZ * cos + moveX * sin;

    const currentPosition = controls.getObject().position;
    const attemptPosition = currentPosition.clone();
    attemptPosition.x += worldX;
    attemptPosition.z += worldZ;

    if (!collidesAt(attemptPosition)) {
      currentPosition.copy(attemptPosition);
    } else {
      const attemptX = currentPosition.clone();
      attemptX.x += worldX;
      if (!collidesAt(attemptX)) {
        currentPosition.x = attemptX.x;
      }

      const attemptZ = currentPosition.clone();
      attemptZ.z += worldZ;
      if (!collidesAt(attemptZ)) {
        currentPosition.z = attemptZ.z;
      }
    }
  }

  clampToWorld(controls.getObject().position);

  const position = controls.getObject().position;
  const terrainY = sampleHeight(position.x, position.z);
  if (jumpRequested && isGrounded) {
    verticalVelocity = jumpVelocity;
    isGrounded = false;
  }
  jumpRequested = false;

  verticalVelocity -= gravity * delta;
  const previousY = position.y;
  position.y += verticalVelocity * delta;

  if (collidesAt(position) && verticalVelocity > 0) {
    position.y = previousY;
    verticalVelocity = 0;
  }

  let groundClamp = terrainY + playerEyeHeight;
  if (terrainY < worldConfig.waterLevel) {
    groundClamp = Math.max(groundClamp, worldConfig.waterLevel + playerEyeHeight);
  }

  if (position.y <= groundClamp) {
    position.y = groundClamp;
    verticalVelocity = 0;
    isGrounded = true;
  } else {
    isGrounded = false;
  }

  waveTime += delta;
  const waveOffset = (Math.sin(waveTime * 0.8) + 1) * 0.06;
  waterMaterial.map.offset.y = waveOffset;

  renderer.render(scene, camera);
}

animate();
