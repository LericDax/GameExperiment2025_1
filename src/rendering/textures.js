import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const bigint = parseInt(value, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(baseSeed, label) {
  let hash = baseSeed >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x45d9f3b);
    hash = (hash ^ (hash >>> 16)) >>> 0;
  }
  return hash >>> 0;
}

function createProceduralTexture({
  baseColor = '#ffffff',
  accentColor = '#dddddd',
  noiseStrength = 0.25,
  vignette = 0.15,
  size = 64,
  random = Math.random,
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
      const randomValue = random() * noiseStrength - noiseStrength / 2;
      imageData.data[index] = THREE.MathUtils.clamp(
        base.r + (accent.r - 128) * randomValue,
        0,
        255
      );
      imageData.data[index + 1] = THREE.MathUtils.clamp(
        base.g + (accent.g - 128) * randomValue,
        0,
        255
      );
      imageData.data[index + 2] = THREE.MathUtils.clamp(
        base.b + (accent.b - 128) * randomValue,
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
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

export function createBlockMaterials({ seed = 1337 } = {}) {
  const textureFor = (key, config) =>
    createProceduralTexture({
      ...config,
      random: createSeededRandom(hashSeed(seed, key)),
    });

  const textures = {
    grass: textureFor('grass', {
      baseColor: '#4a9c47',
      accentColor: '#6fd25f',
      noiseStrength: 0.6,
    }),
    dirt: textureFor('dirt', {
      baseColor: '#6b4a2f',
      accentColor: '#56331a',
      noiseStrength: 0.4,
    }),
    stone: textureFor('stone', {
      baseColor: '#8c8c8c',
      accentColor: '#cccccc',
      noiseStrength: 0.2,
    }),
    sand: textureFor('sand', {
      baseColor: '#d7c27a',
      accentColor: '#f0e4a0',
      noiseStrength: 0.35,
    }),
    water: textureFor('water', {
      baseColor: '#2c70c9',
      accentColor: '#4fa4ff',
      noiseStrength: 0.5,
    }),
    leaf: textureFor('leaf', {
      baseColor: '#3f7c35',
      accentColor: '#79c35a',
      noiseStrength: 0.6,
    }),
    log: textureFor('log', {
      baseColor: '#725032',
      accentColor: '#9c7045',
      noiseStrength: 0.45,
    }),
    cloud: textureFor('cloud', {
      baseColor: '#f7f8fb',
      accentColor: '#d9e5ff',
      noiseStrength: 0.2,
      vignette: 0.02,
    }),
  };

  return {
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
}
