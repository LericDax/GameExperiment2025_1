import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgbNormalized(hex) {
  const value = hex.replace('#', '');
  const bigint = parseInt(value, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
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

function hash2D(seed, x, y) {
  let h = seed ^ Math.imul(x, 0x27d4eb2d);
  h = Math.imul(h ^ Math.imul(y, 0x165667b1), 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function gradient2D(seed, x, y) {
  const angle = hash2D(seed, x, y) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const WHITE = { r: 1, g: 1, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };

export class TextureEngine {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
  }

  color(hex) {
    return hexToRgbNormalized(hex);
  }

  mix(colorA, colorB, t) {
    const amount = clamp(t, 0, 1);
    return {
      r: lerp(colorA.r, colorB.r, amount),
      g: lerp(colorA.g, colorB.g, amount),
      b: lerp(colorA.b, colorB.b, amount),
    };
  }

  lighten(color, amount) {
    return this.mix(color, WHITE, amount);
  }

  darken(color, amount) {
    return this.mix(color, BLACK, amount);
  }

  ensureRgba(color) {
    const r = clamp(color.r ?? 0, 0, 1);
    const g = clamp(color.g ?? 0, 0, 1);
    const b = clamp(color.b ?? 0, 0, 1);
    const a = clamp(color.a ?? 1, 0, 1);
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
      a: Math.round(a * 255),
    };
  }

  samplePerlin(baseSeed, u, v) {
    const x = Math.floor(u);
    const y = Math.floor(v);
    const xf = u - x;
    const yf = v - y;

    const topLeft = gradient2D(baseSeed, x, y);
    const topRight = gradient2D(baseSeed, x + 1, y);
    const bottomLeft = gradient2D(baseSeed, x, y + 1);
    const bottomRight = gradient2D(baseSeed, x + 1, y + 1);

    const dotTopLeft = topLeft.x * xf + topLeft.y * yf;
    const dotTopRight = topRight.x * (xf - 1) + topRight.y * yf;
    const dotBottomLeft = bottomLeft.x * xf + bottomLeft.y * (yf - 1);
    const dotBottomRight = bottomRight.x * (xf - 1) + bottomRight.y * (yf - 1);

    const uFade = fade(xf);
    const vFade = fade(yf);

    const lerpTop = lerp(dotTopLeft, dotTopRight, uFade);
    const lerpBottom = lerp(dotBottomLeft, dotBottomRight, uFade);

    return lerp(lerpTop, lerpBottom, vFade);
  }

  sampleFractalNoise(baseSeed, u, v, options = {}) {
    const {
      scale = 4,
      octaves = 4,
      persistence = 0.5,
      lacunarity = 2,
      variant = 'default',
    } = options;
    const seed = hashSeed(baseSeed, `fractal:${variant}`);
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;
    let total = 0;

    for (let i = 0; i < octaves; i++) {
      const octaveSeed = hashSeed(seed, `octave:${i}`);
      const value = this.samplePerlin(
        octaveSeed,
        u * scale * frequency,
        v * scale * frequency
      );
      total += value * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    if (maxAmplitude === 0) {
      return 0.5;
    }

    const normalized = total / maxAmplitude;
    return clamp(normalized * 0.5 + 0.5, 0, 1);
  }

  sampleRidgeNoise(baseSeed, u, v, options = {}) {
    const { sharpness = 2, variant = 'ridge' } = options;
    const base = this.sampleFractalNoise(baseSeed, u, v, {
      ...options,
      variant: `${variant}:base`,
    });
    const ridge = 1 - Math.abs(base * 2 - 1);
    return Math.pow(ridge, sharpness);
  }

  sampleWorley(baseSeed, u, v, options = {}) {
    const { scale = 4, jitter = 1, variant = 'worley', distancePower = 1 } = options;
    const seed = hashSeed(baseSeed, `worley:${variant}`);
    const x = u * scale;
    const y = v * scale;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    let minDistance = Infinity;

    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cellX + ox;
        const ny = cellY + oy;
        const pointSeed = hashSeed(seed, `${nx},${ny}`);
        const rng = createSeededRandom(pointSeed);
        const featureX = nx + rng() * jitter;
        const featureY = ny + rng() * jitter;
        const dx = featureX - x;
        const dy = featureY - y;
        const distance = Math.pow(Math.sqrt(dx * dx + dy * dy), distancePower);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
    }

    const normalization = Math.pow(Math.sqrt(2), distancePower);
    return clamp(minDistance / normalization, 0, 1);
  }

  sampleBands(baseSeed, u, v, options = {}) {
    const {
      frequency = 5,
      angle = 0,
      thickness = 1.5,
      variant = 'bands',
      turbulence = 0,
    } = options;
    const seed = hashSeed(baseSeed, `bands:${variant}`);
    const radians = (angle * Math.PI) / 180;
    const centeredU = u - 0.5;
    const centeredV = v - 0.5;
    const projected =
      centeredU * Math.cos(radians) + centeredV * Math.sin(radians);

    let offset = 0;
    if (turbulence > 0) {
      offset =
        (this.sampleFractalNoise(seed, u, v, {
          scale: frequency * 2,
          octaves: 2,
          persistence: 0.5,
          variant: `${variant}:turbulence`,
        }) -
          0.5) *
        turbulence;
    }

    const value = Math.sin((projected + offset) * Math.PI * frequency);
    const stripes = Math.abs(value);
    const mask = Math.pow(1 - stripes, thickness);
    return clamp(mask, 0, 1);
  }

  sampleRings(baseSeed, u, v, options = {}) {
    const { frequency = 8, sharpness = 2.5, variant = 'rings', offset = 0 } = options;
    const seed = hashSeed(baseSeed, `rings:${variant}`);
    const dx = u - 0.5;
    const dy = v - 0.5;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const jitter =
      (this.sampleFractalNoise(seed, u, v, {
        scale: frequency * 0.5,
        octaves: 2,
        persistence: 0.8,
        variant: `${variant}:jitter`,
      }) -
        0.5) *
      0.02;
    const wave = Math.sin((radius + offset + jitter) * Math.PI * frequency);
    const normalized = 0.5 - 0.5 * wave;
    return Math.pow(normalized, sharpness);
  }

  createTexture(label, { size = 64, generator, wrap = THREE.RepeatWrapping, filter = THREE.NearestFilter }) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const seed = hashSeed(this.seed, label);
    const rng = createSeededRandom(seed);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (x + y * size) * 4;
        const u = x / size;
        const v = y / size;
        const color = generator({
          x,
          y,
          u,
          v,
          seed,
          random: rng,
          noise: (options) => this.sampleFractalNoise(seed, u, v, options),
          ridge: (options) => this.sampleRidgeNoise(seed, u, v, options),
          worley: (options) => this.sampleWorley(seed, u, v, options),
          bands: (options) => this.sampleBands(seed, u, v, options),
          rings: (options) => this.sampleRings(seed, u, v, options),
          color: (hex) => this.color(hex),
          mix: (a, b, t) => this.mix(a, b, t),
          lighten: (c, amount) => this.lighten(c, amount),
          darken: (c, amount) => this.darken(c, amount),
        });
        const rgba = this.ensureRgba(color);
        imageData.data[index] = rgba.r;
        imageData.data[index + 1] = rgba.g;
        imageData.data[index + 2] = rgba.b;
        imageData.data[index + 3] = rgba.a;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = wrap;
    texture.magFilter = filter;
    texture.minFilter = filter;
    return texture;
  }
}

export { createSeededRandom, hashSeed };
