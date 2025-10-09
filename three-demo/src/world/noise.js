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
  ridge: createRidgedSampler,
  ridged: createRidgedSampler,
  worley: createWorleySampler,
  sine: createAnisotropicSineSampler,
  anisotropicSine: createAnisotropicSineSampler,
  warp: createDomainWarpSampler,
  domainWarp: createDomainWarpSampler,
  diffusion: createDiffusionSampler,
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
      'FractalPinkNoise',
      'FractalBrownNoise',
      'FractalBlueNoise',
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

function createAnisotropicSineSampler({
  seed = 1,
  orientation = Math.PI / 4,
  harmonics = 3,
  phaseOffset = 0,
  bias = 0,
  harmonicFalloff = 1,
}) {
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
      const phaseJitter = random2D(jitterSeed, i, 0) * Math.PI * 2;
      value +=
        Math.sin(u * i + phaseJitter) *
        Math.cos(v * i + phaseJitter * 0.5) *
        harmonicWeight;
      weight += harmonicWeight;
    }

    const normalized = weight > 0 ? value / weight : 0;
    return clamp(normalized + bias, -1, 1);
  };
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

function createValueNoise(seed, octaveIndex) {
  const octaveSeed = hashSeed(seed, octaveIndex + 1);
  return new ValueNoise2D(octaveSeed);
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
