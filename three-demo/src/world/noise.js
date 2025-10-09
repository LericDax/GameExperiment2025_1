export class ValueNoise2D {
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
    const ix0 = lerp(n0, n1, sx);

    const n2 = this.hash(x0, y1);
    const n3 = this.hash(x1, y1);
    const ix1 = lerp(n2, n3, sx);

    return lerp(ix0, ix1, sy);
  }
}

export function projectSampleCoordinates(
  x,
  z,
  { frequency = 1, phase = { x: 0, z: 0 }, domainWarp = { x: 0, z: 0 } } = {},
) {
  return {
    x: (x + domainWarp.x) * frequency + phase.x,
    z: (z + domainWarp.z) * frequency + phase.z,
  };
}

export function combineDomainWarp(baseWarp = { x: 0, z: 0 }, deltaWarp = { x: 0, z: 0 }) {
  return {
    x: baseWarp.x + deltaWarp.x,
    z: baseWarp.z + deltaWarp.z,
  };
}

export function createNoiseSampler(type, config = {}) {
  const factory = NOISE_WAVEFORM_FACTORIES[type];
  if (!factory) {
    throw new Error(`Unknown noise waveform: ${type}`);
  }
  return factory({ ...config });
}

export const NOISE_WAVEFORM_FACTORIES = Object.freeze({
  fbm: createFbmSampler,
  FBM: createFbmSampler,
  turbulence: createTurbulenceSampler,
  Turbulence: createTurbulenceSampler,
  ridge: createRidgedSampler,
  ridged: createRidgedSampler,
  RidgedFBM: createRidgedSampler,
  billow: createBillowSampler,
  Billow: createBillowSampler,
  pinkNoise: createPinkNoiseSampler,
  PinkNoise: createPinkNoiseSampler,
  FractalPinkNoise: createPinkNoiseSampler,
  brownNoise: createBrownNoiseSampler,
  BrownNoise: createBrownNoiseSampler,
  FractalBrownNoise: createBrownNoiseSampler,
  redNoise: createRedNoiseSampler,
  RedNoise: createRedNoiseSampler,
  greenNoise: createGreenNoiseSampler,
  GreenNoise: createGreenNoiseSampler,
  blackNoise: createBlackNoiseSampler,
  BlackNoise: createBlackNoiseSampler,
  greyNoise: createGreyNoiseSampler,
  GreyNoise: createGreyNoiseSampler,
  violetNoise: createVioletNoiseSampler,
  VioletNoise: createVioletNoiseSampler,
  velvetNoise: createVelvetNoiseSampler,
  VelvetNoise: createVelvetNoiseSampler,
  blueNoise: createBlueNoiseSampler,
  BlueNoise: createBlueNoiseSampler,
  FractalBlueNoise: createBlueNoiseSampler,
  whiteNoise: createWhiteNoiseSampler,
  WhiteNoise: createWhiteNoiseSampler,
  worley: createWorleySampler,
  Worley: createWorleySampler,
  valueNoise: createValueNoiseSampler,
  ValueNoise: createValueNoiseSampler,
  gradientNoise: createGradientNoiseSampler,
  GradientNoise: createGradientNoiseSampler,
  simplexNoise: createSimplexNoiseSampler,
  SimplexNoise: createSimplexNoiseSampler,
  sine: createAnisotropicSineSampler,
  anisotropicSine: createAnisotropicSineSampler,
  AnisotropicSine: createAnisotropicSineSampler,
  cosine: createAnisotropicCosineSampler,
  anisotropicCosine: createAnisotropicCosineSampler,
  AnisotropicCosine: createAnisotropicCosineSampler,
  square: createAnisotropicSquareSampler,
  anisotropicSquare: createAnisotropicSquareSampler,
  AnisotropicSquare: createAnisotropicSquareSampler,
  sawtooth: createAnisotropicSawtoothSampler,
  anisotropicSawtooth: createAnisotropicSawtoothSampler,
  AnisotropicSawtooth: createAnisotropicSawtoothSampler,
  triangle: createAnisotropicTriangleSampler,
  anisotropicTriangle: createAnisotropicTriangleSampler,
  AnisotropicTriangle: createAnisotropicTriangleSampler,
  pulse: createAnisotropicPulseSampler,
  anisotropicPulse: createAnisotropicPulseSampler,
  AnisotropicPulse: createAnisotropicPulseSampler,
  warp: createDomainWarpSampler,
  domainWarp: createDomainWarpSampler,
  DomainWarp: createDomainWarpSampler,
  diffusion: createDiffusionSampler,
  Diffusion: createDiffusionSampler,
});

export const NOISE_WAVEFORM_CATALOG = Object.freeze([
  {
    category: 'Core noise waveforms',
    ids: [
      'FBM',
      'Turbulence',
      'RidgedFBM',
      'Worley',
      'Billow',
      'ValueNoise',
      'GradientNoise',
      'SimplexNoise',
    ],
  },
  {
    category: 'Analytic / trigonometric waveforms',
    ids: [
      'AnisotropicSine',
      'AnisotropicCosine',
      'AnisotropicSquare',
      'AnisotropicSawtooth',
      'AnisotropicTriangle',
      'AnisotropicPulse',
    ],
  },
  {
    category: 'Fractal / spectral variants',
    ids: [
      'PinkNoise',
      'BrownNoise',
      'RedNoise',
      'GreenNoise',
      'BlackNoise',
      'GreyNoise',
      'VioletNoise',
      'VelvetNoise',
      'BlueNoise',
      'WhiteNoise',
    ],
  },
  {
    category: 'Structural / geometric',
    ids: [
      'DomainWarp',
      'CurlNoise',
      'CellEdgeDistance',
      'TerraceQuantized',
      'VoronoiBlend',
    ],
  },
  {
    category: 'Diffusion / smoothing',
    ids: ['IsotropicDiffusion', 'AnisotropicDiffusion', 'HydraulicErosion'],
  },
  {
    category: 'Hybrid / procedural',
    ids: ['BandsFBM', 'WarpedFBM', 'NoiseMixWaveset'],
  },
  {
    category: 'Spectral / stochastic',
    ids: ['GaborNoise', 'WaveletNoise', 'SpectralNoise', 'PoissonBlueMask'],
  },
  {
    category: 'Synth-inspired waveforms',
    ids: [
      'Wavetable',
      'FMComposite',
      'AMComposite',
      'RingMod',
      'PhaseDistortedSine',
      'PulseWidthModulation',
      'AdditiveHarmonicStack',
      'SubtractiveFilterBank',
      'GranularNoise',
      'SampleAndHold',
      'NoiseChorus',
      'ResonantFilterField',
      'ReverberantDecayField',
    ],
  },
  {
    category: 'Exotic / emergent',
    ids: [
      'HyperbolicTangentField',
      'SigmoidStepField',
      'ExponentialField',
      'SDFPrimitives',
      'MultifractalBlend',
    ],
  },
]);

function createFbmSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
}) {
  const octaveNoises = new Array(Math.max(1, Math.floor(octaves)))
    .fill(null)
    .map((_, index) => createValueNoise(seed, index));

  return (x, z) => {
    let total = 0;
    let amplitudeSum = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaveNoises.length; i += 1) {
      const noise = octaveNoises[i];
      const sample = toSignedRange(noise.noise(x * frequency, z * frequency));
      total += sample * amplitude;
      amplitudeSum += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    const normalized = amplitudeSum > 0 ? total / amplitudeSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createTurbulenceSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
}) {
  const octaveNoises = new Array(Math.max(1, Math.floor(octaves)))
    .fill(null)
    .map((_, index) => createValueNoise(seed, index));

  return (x, z) => {
    let total = 0;
    let amplitudeSum = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaveNoises.length; i += 1) {
      const noise = octaveNoises[i];
      const sample = Math.abs(
        toSignedRange(noise.noise(x * frequency, z * frequency)),
      );
      total += sample * amplitude;
      amplitudeSum += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    const normalized = amplitudeSum > 0 ? total / amplitudeSum : 0;
    return clamp(normalized * 2 - 1, -1, 1);
  };
}

function createBillowSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
}) {
  const octaveNoises = new Array(Math.max(1, Math.floor(octaves)))
    .fill(null)
    .map((_, index) => createValueNoise(seed, index));

  return (x, z) => {
    let total = 0;
    let amplitudeSum = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaveNoises.length; i += 1) {
      const noise = octaveNoises[i];
      const base = toSignedRange(noise.noise(x * frequency, z * frequency));
      const sample = 2 * Math.abs(base) - 1;
      total += sample * amplitude;
      amplitudeSum += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    const normalized = amplitudeSum > 0 ? total / amplitudeSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createSpectralNoiseSampler({
  seed = 1,
  octaves = 6,
  lacunarity = 2,
  slope = -1,
}) {
  const octaveCount = Math.max(1, Math.floor(octaves));
  const spectralLacunarity = Math.max(1e-3, Math.abs(lacunarity));
  const noiseLayers = new Array(octaveCount)
    .fill(null)
    .map((_, index) => createValueNoise(seed, index));
  const frequencies = new Array(octaveCount)
    .fill(null)
    .map((_, index) => Math.pow(spectralLacunarity, index));
  const weights = frequencies.map((frequency) => Math.pow(frequency, slope));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  return (x, z) => {
    let total = 0;

    for (let i = 0; i < octaveCount; i += 1) {
      const sample = toSignedRange(
        noiseLayers[i].noise(x * frequencies[i], z * frequencies[i]),
      );
      total += sample * weights[i];
    }

    const normalized = weightSum > 0 ? total / weightSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createPinkNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 73),
    octaves,
    lacunarity,
    slope: -1,
  });
}

function createBrownNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 89),
    octaves,
    lacunarity,
    slope: -2,
  });
}

function createRedNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 151),
    octaves,
    lacunarity,
    slope: -2,
  });
}

function createGreenNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 163),
    octaves,
    lacunarity,
    slope: -0.5,
  });
}

function createBlackNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 179),
    octaves,
    lacunarity,
    slope: -3,
  });
}

function createGreyNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 193),
    octaves,
    lacunarity,
    slope: -0.2,
  });
}

function createVioletNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 199),
    octaves,
    lacunarity,
    slope: 2,
  });
}

function createVelvetNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 211),
    octaves,
    lacunarity,
    slope: 0.5,
  });
}

function createBlueNoiseSampler({ seed = 1, octaves = 6, lacunarity = 2 } = {}) {
  return createSpectralNoiseSampler({
    seed: hashSeed(seed, 97),
    octaves,
    lacunarity,
    slope: 1,
  });
}

function createWhiteNoiseSampler({ seed = 1 } = {}) {
  const whiteSeed = hashSeed(seed, 131);
  return (x, z) => {
    const value = toSignedRange(random2D(whiteSeed, x, z));
    return clamp(value, -1, 1);
  };
}

function createRidgedSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
  ridgeSharpness = 2,
}) {
  const baseSampler = createFbmSampler({
    seed: seed * 1.37 + 11,
    octaves,
    gain,
    lacunarity,
  });

  return (x, z) => {
    const sample = baseSampler(x, z);
    const inverted = 1 - Math.abs(sample);
    const sharpened = Math.pow(clamp(inverted, 0, 1), ridgeSharpness);
    return clamp(sharpened * 2 - 1, -1, 1);
  };
}

function createWorleySampler({
  seed = 1,
  jitter = 0.75,
  falloff = 1,
  distance = 'euclidean',
}) {
  const jitterSeedX = seed * 1.91 + 17;
  const jitterSeedZ = seed * 1.53 + 31;

  return (x, z) => {
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    let minDistance = Number.POSITIVE_INFINITY;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = cellX + dx;
        const cz = cellZ + dz;
        const rx = random2D(jitterSeedX, cx, cz) * jitter;
        const rz = random2D(jitterSeedZ, cx, cz) * jitter;
        const px = cx + rx;
        const pz = cz + rz;
        const dxp = x - px;
        const dzp = z - pz;
        const candidate =
          distance === 'manhattan'
            ? Math.abs(dxp) + Math.abs(dzp)
            : Math.hypot(dxp, dzp);
        if (candidate < minDistance) {
          minDistance = candidate;
        }
      }
    }

    const normalized = Math.exp(-minDistance * falloff);
    return clamp(normalized * 2 - 1, -1, 1);
  };
}

const TWO_PI = Math.PI * 2;

function normalizeAngle01(angle) {
  const normalized = angle / TWO_PI;
  return normalized - Math.floor(normalized);
}

function createAnisotropicWaveformSampler(
  waveformFn,
  {
    seed = 1,
    orientation = Math.PI / 4,
    harmonics = 3,
    phaseOffset = 0,
    bias = 0,
    harmonicFalloff = 1,
    ...waveformConfig
  } = {},
) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const harmonicCount = Math.max(1, Math.floor(harmonics));
  const jitterSeed = seed * 1.23 + 19;

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle + phaseOffset;
    const v = -x * sinAngle + z * cosAngle + phaseOffset;
    let value = 0;
    let weight = 0;

    for (let i = 1; i <= harmonicCount; i += 1) {
      const harmonicWeight = 1 / Math.pow(i, harmonicFalloff);
      const phaseJitter = random2D(jitterSeed, i, 0) * TWO_PI;
      value +=
        waveformFn({
          u,
          v,
          harmonic: i,
          phase: phaseJitter,
          config: waveformConfig,
        }) * harmonicWeight;
      weight += harmonicWeight;
    }

    const normalized = weight > 0 ? value / weight : 0;
    return clamp(normalized + bias, -1, 1);
  };
}

function sineWaveform({ u, v, harmonic, phase }) {
  return (
    Math.sin(u * harmonic + phase) *
    Math.cos(v * harmonic + phase * 0.5)
  );
}

function cosineWaveform({ u, v, harmonic, phase }) {
  return (
    Math.cos(u * harmonic + phase) *
    Math.cos(v * harmonic + phase * 0.5)
  );
}

function squareWaveform({ u, v, harmonic, phase, config }) {
  const dutyCycle = clamp(config?.dutyCycle ?? 0.5, 0.01, 0.99);
  const normalized = normalizeAngle01(u * harmonic + phase);
  const gate = normalized < dutyCycle ? 1 : -1;
  return gate * Math.cos(v * harmonic + phase * 0.5);
}

function sawtoothWaveform({ u, v, harmonic, phase }) {
  const normalized = normalizeAngle01(u * harmonic + phase);
  const saw = normalized * 2 - 1;
  return saw * Math.cos(v * harmonic + phase * 0.5);
}

function triangleWaveform({ u, v, harmonic, phase }) {
  const normalized = normalizeAngle01(u * harmonic + phase);
  const tri = 1 - 4 * Math.abs(normalized - 0.5);
  return tri * Math.cos(v * harmonic + phase * 0.5);
}

function pulseWaveform({ u, v, harmonic, phase, config }) {
  const dutyCycle = clamp(config?.dutyCycle ?? 0.2, 0.01, 0.99);
  const highValue = clamp(config?.highValue ?? 1, -1, 1);
  const lowValue = clamp(config?.lowValue ?? -1, -1, 1);
  const normalized = normalizeAngle01(u * harmonic + phase);
  const gate = normalized < dutyCycle ? highValue : lowValue;
  return gate * Math.cos(v * harmonic + phase * 0.5);
}

function createAnisotropicSineSampler(config = {}) {
  return createAnisotropicWaveformSampler(sineWaveform, config);
}

function createAnisotropicCosineSampler(config = {}) {
  return createAnisotropicWaveformSampler(cosineWaveform, config);
}

function createAnisotropicSquareSampler({ harmonics = 1, ...config } = {}) {
  return createAnisotropicWaveformSampler(squareWaveform, {
    ...config,
    harmonics,
  });
}

function createAnisotropicSawtoothSampler({ harmonics = 1, ...config } = {}) {
  return createAnisotropicWaveformSampler(sawtoothWaveform, {
    ...config,
    harmonics,
  });
}

function createAnisotropicTriangleSampler({ harmonics = 1, ...config } = {}) {
  return createAnisotropicWaveformSampler(triangleWaveform, {
    ...config,
    harmonics,
  });
}

function createAnisotropicPulseSampler({ harmonics = 1, ...config } = {}) {
  return createAnisotropicWaveformSampler(pulseWaveform, {
    ...config,
    harmonics,
  });
}

function createDomainWarpSampler({
  seed = 1,
  strength = 0.5,
  scale = 1,
  octaves = 1,
  gain = 0.5,
  lacunarity = 2,
}) {
  const octaveCount = Math.max(1, Math.floor(octaves));
  const noiseX = new Array(octaveCount)
    .fill(null)
    .map((_, index) => createValueNoise(seed * 1.11 + 101, index));
  const noiseZ = new Array(octaveCount)
    .fill(null)
    .map((_, index) => createValueNoise(seed * 1.53 + 211, index));

  return (x, z) => {
    let offsetX = 0;
    let offsetZ = 0;
    let amplitude = strength;
    let frequency = scale;

    for (let i = 0; i < octaveCount; i += 1) {
      const nx = toSignedRange(noiseX[i].noise(x * frequency, z * frequency));
      const nz = toSignedRange(noiseZ[i].noise(x * frequency, z * frequency));
      offsetX += nx * amplitude;
      offsetZ += nz * amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return {
      x: clamp(offsetX, -1, 1),
      z: clamp(offsetZ, -1, 1),
    };
  };
}

function createDiffusionSampler({ seed = 1, smoothing = 0.5 }) {
  const baseNoise = new ValueNoise2D(seed * 1.61 + 97);
  const smooth = clamp(smoothing, 0, 1);

  return (x, z) => {
    const center = baseNoise.noise(x, z);
    const neighbors = [
      baseNoise.noise(x + 1, z),
      baseNoise.noise(x - 1, z),
      baseNoise.noise(x, z + 1),
      baseNoise.noise(x, z - 1),
    ];
    const average = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
    const blended = lerp(center, average, smooth);
    return clamp(toSignedRange(blended), -1, 1);
  };
}

function createValueNoiseSampler({ seed = 1 }) {
  const baseNoise = createValueNoise(seed, 0);
  return (x, z) => {
    const sample = toSignedRange(baseNoise.noise(x, z));
    return clamp(sample, -1, 1);
  };
}

function createGradientNoiseSampler({ seed = 1 }) {
  const gradientNoise = new GradientNoise2D(hashSeed(seed, 31));
  return (x, z) => {
    const sample = gradientNoise.noise(x, z);
    return clamp(sample, -1, 1);
  };
}

function createSimplexNoiseSampler({ seed = 1 }) {
  const simplexNoise = new SimplexNoise2D(hashSeed(seed, 53));
  return (x, z) => {
    return simplexNoise.noise(x, z);
  };
}

function createValueNoise(seed, octaveIndex) {
  const octaveSeed = hashSeed(seed, octaveIndex + 1);
  return new ValueNoise2D(octaveSeed);
}

class GradientNoise2D {
  constructor(seed = 1) {
    this.seed = seed;
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  dotGradient(ix, iz, x, z) {
    const angle = random2D(this.seed, ix, iz) * Math.PI * 2;
    const gx = Math.cos(angle);
    const gz = Math.sin(angle);
    const dx = x - ix;
    const dz = z - iz;
    return gx * dx + gz * dz;
  }

  noise(x, z) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const sx = this.fade(x - x0);
    const sz = this.fade(z - z0);

    const n0 = this.dotGradient(x0, z0, x, z);
    const n1 = this.dotGradient(x1, z0, x, z);
    const ix0 = lerp(n0, n1, sx);

    const n2 = this.dotGradient(x0, z1, x, z);
    const n3 = this.dotGradient(x1, z1, x, z);
    const ix1 = lerp(n2, n3, sx);

    return lerp(ix0, ix1, sz);
  }
}

class SimplexNoise2D {
  constructor(seed = 1) {
    this.seed = seed;
    this.gradients = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
  }

  gradient(ix, iz) {
    const r = random2D(this.seed, ix, iz) * this.gradients.length;
    const index = Math.floor(r) % this.gradients.length;
    return this.gradients[index];
  }

  noise(xin, zin) {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (xin + zin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(zin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Z0 = j - t;
    const x0 = xin - X0;
    const z0 = zin - Z0;

    const i1 = x0 > z0 ? 1 : 0;
    const j1 = x0 > z0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const z1 = z0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const z2 = z0 - 1 + 2 * G2;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - z0 * z0;
    if (t0 > 0) {
      const [gx0, gz0] = this.gradient(i, j);
      t0 *= t0;
      n0 = t0 * t0 * (gx0 * x0 + gz0 * z0);
    }

    let t1 = 0.5 - x1 * x1 - z1 * z1;
    if (t1 > 0) {
      const [gx1, gz1] = this.gradient(i + i1, j + j1);
      t1 *= t1;
      n1 = t1 * t1 * (gx1 * x1 + gz1 * z1);
    }

    let t2 = 0.5 - x2 * x2 - z2 * z2;
    if (t2 > 0) {
      const [gx2, gz2] = this.gradient(i + 1, j + 1);
      t2 *= t2;
      n2 = t2 * t2 * (gx2 * x2 + gz2 * z2);
    }

    const value = 70 * (n0 + n1 + n2);
    return clamp(value, -1, 1);
  }
}

function hashSeed(seed, salt) {
  const prime1 = 501125321;
  const prime2 = 1136930381;
  return Math.sin(seed * prime1 + salt * prime2) * 43758.5453123;
}

function random2D(seed, x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed * 0.1337) * 43758.5453;
  return n - Math.floor(n);
}

function toSignedRange(value) {
  return value * 2 - 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
