import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function mashSeed(seed, salt) {
  let h = seed >>> 0;
  h ^= salt + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return h >>> 0;
}

export function createSeededRandom(seed, salt = 0) {
  return mulberry32(mashSeed(seed, salt));
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const bigint = parseInt(value, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

export function createProceduralTexture(
  {
    baseColor = '#ffffff',
    accentColor = '#dddddd',
    noiseStrength = 0.25,
    vignette = 0.15,
    size = 64,
  },
  rng
) {
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
      const random = rng() * noiseStrength - noiseStrength / 2;
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
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

const textureSalts = {
  grass: 0x137f,
  dirt: 0x2a3f,
  stone: 0x3f21,
  sand: 0x42c9,
  water: 0x5b33,
  leaf: 0x6c47,
  log: 0x7de1,
  cloud: 0x8f55,
};

export function buildTexturePalette(seed) {
  return {
    grass: createProceduralTexture(
      {
        baseColor: '#4a9c47',
        accentColor: '#6fd25f',
        noiseStrength: 0.6,
      },
      createSeededRandom(seed, textureSalts.grass)
    ),
    dirt: createProceduralTexture(
      {
        baseColor: '#6b4a2f',
        accentColor: '#56331a',
        noiseStrength: 0.4,
      },
      createSeededRandom(seed, textureSalts.dirt)
    ),
    stone: createProceduralTexture(
      {
        baseColor: '#8c8c8c',
        accentColor: '#cccccc',
        noiseStrength: 0.2,
      },
      createSeededRandom(seed, textureSalts.stone)
    ),
    sand: createProceduralTexture(
      {
        baseColor: '#d7c27a',
        accentColor: '#f0e4a0',
        noiseStrength: 0.35,
      },
      createSeededRandom(seed, textureSalts.sand)
    ),
    water: createProceduralTexture(
      {
        baseColor: '#2c70c9',
        accentColor: '#4fa4ff',
        noiseStrength: 0.5,
      },
      createSeededRandom(seed, textureSalts.water)
    ),
    leaf: createProceduralTexture(
      {
        baseColor: '#3f7c35',
        accentColor: '#79c35a',
        noiseStrength: 0.6,
      },
      createSeededRandom(seed, textureSalts.leaf)
    ),
    log: createProceduralTexture(
      {
        baseColor: '#725032',
        accentColor: '#9c7045',
        noiseStrength: 0.45,
      },
      createSeededRandom(seed, textureSalts.log)
    ),
    cloud: createProceduralTexture(
      {
        baseColor: '#f7f8fb',
        accentColor: '#d9e5ff',
        noiseStrength: 0.2,
        vignette: 0.02,
      },
      createSeededRandom(seed, textureSalts.cloud)
    ),
  };
}

export { mulberry32 as createMulberry32 };
