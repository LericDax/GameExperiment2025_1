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
  bandsFbm: createBandsFbmSampler,
  BandsFBM: createBandsFbmSampler,
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
  gaborNoise: createGaborNoiseSampler,
  GaborNoise: createGaborNoiseSampler,
  waveletNoise: createWaveletNoiseSampler,
  WaveletNoise: createWaveletNoiseSampler,
  spectralNoise: createSpectralNoiseSampler,
  SpectralNoise: createSpectralNoiseSampler,
  poissonBlueMask: createPoissonBlueMaskSampler,
  PoissonBlueMask: createPoissonBlueMaskSampler,
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
  wavetable: createWavetableSampler,
  Wavetable: createWavetableSampler,
  fmComposite: createFmCompositeSampler,
  FMComposite: createFmCompositeSampler,
  amComposite: createAmCompositeSampler,
  AMComposite: createAmCompositeSampler,
  ringMod: createRingModSampler,
  RingMod: createRingModSampler,
  phaseDistortedSine: createPhaseDistortedSineSampler,
  PhaseDistortedSine: createPhaseDistortedSineSampler,
  pulseWidthModulation: createPulseWidthModulationSampler,
  PulseWidthModulation: createPulseWidthModulationSampler,
  additiveHarmonicStack: createAdditiveHarmonicStackSampler,
  AdditiveHarmonicStack: createAdditiveHarmonicStackSampler,
  subtractiveFilterBank: createSubtractiveFilterBankSampler,
  SubtractiveFilterBank: createSubtractiveFilterBankSampler,
  granularNoise: createGranularNoiseSampler,
  GranularNoise: createGranularNoiseSampler,
  sampleAndHold: createSampleAndHoldSampler,
  SampleAndHold: createSampleAndHoldSampler,
  noiseChorus: createNoiseChorusSampler,
  NoiseChorus: createNoiseChorusSampler,
  resonantFilterField: createResonantFilterFieldSampler,
  ResonantFilterField: createResonantFilterFieldSampler,
  reverberantDecayField: createReverberantDecayFieldSampler,
  ReverberantDecayField: createReverberantDecayFieldSampler,
  hyperbolicTangentField: createHyperbolicTangentFieldSampler,
  HyperbolicTangentField: createHyperbolicTangentFieldSampler,
  sigmoidStepField: createSigmoidStepFieldSampler,
  SigmoidStepField: createSigmoidStepFieldSampler,
  exponentialField: createExponentialFieldSampler,
  ExponentialField: createExponentialFieldSampler,
  sdfPrimitives: createSdfPrimitivesSampler,
  SDFPrimitives: createSdfPrimitivesSampler,
  multifractalBlend: createMultifractalBlendSampler,
  MultifractalBlend: createMultifractalBlendSampler,
  warpedFbm: createWarpedFbmSampler,
  WarpedFBM: createWarpedFbmSampler,
  warp: createDomainWarpSampler,
  domainWarp: createDomainWarpSampler,
  DomainWarp: createDomainWarpSampler,
  curlNoise: createCurlNoiseSampler,
  CurlNoise: createCurlNoiseSampler,
  cellEdgeDistance: createCellEdgeDistanceSampler,
  CellEdgeDistance: createCellEdgeDistanceSampler,
  terraceQuantized: createTerraceQuantizedSampler,
  TerraceQuantized: createTerraceQuantizedSampler,
  voronoiBlend: createVoronoiBlendSampler,
  VoronoiBlend: createVoronoiBlendSampler,
  noiseMixWaveset: createNoiseMixWavesetSampler,
  NoiseMixWaveset: createNoiseMixWavesetSampler,
  diffusion: createDiffusionSampler,
  isotropicDiffusion: createDiffusionSampler,
  Diffusion: createDiffusionSampler,
  IsotropicDiffusion: createDiffusionSampler,
  anisotropicDiffusion: createAnisotropicDiffusionSampler,
  AnisotropicDiffusion: createAnisotropicDiffusionSampler,
  hydraulicErosion: createHydraulicErosionSampler,
  HydraulicErosion: createHydraulicErosionSampler,
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

function createBandsFbmSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
  bandFrequency = 1,
  bandStrength = 0.75,
  bandSharpness = 2,
  orientation = Math.PI / 4,
  harmonics = 3,
  harmonicFalloff = 1,
  phaseOffset = 0,
  bandBias = 0,
} = {}) {
  const fbmSeed = hashSeed(seed, 563);
  const bandSeed = hashSeed(seed, 577);
  const baseFbm = createFbmSampler({
    seed: fbmSeed,
    octaves,
    gain,
    lacunarity,
  });
  const bandSampler = createAnisotropicSineSampler({
    seed: bandSeed,
    orientation,
    harmonics,
    harmonicFalloff,
    phaseOffset,
    bias: bandBias,
  });
  const frequency = Math.max(1e-3, Math.abs(bandFrequency));
  const sharpness = Math.max(0.1, bandSharpness);
  const strength = clamp(bandStrength, 0, 1);

  return (x, z) => {
    const fbmSample = baseFbm(x, z);
    const bandValue = bandSampler(x * frequency, z * frequency);
    const bandMask = Math.pow(clamp(1 - Math.abs(bandValue), 0, 1), sharpness);
    const modulation = strength * bandMask + (1 - strength);
    const combined = fbmSample * modulation;
    return clamp(combined, -1, 1);
  };
}

function createGaborNoiseSampler({
  seed = 1,
  frequency = 1,
  impulses = 6,
  bandwidth = 2.5,
} = {}) {
  const impulseCount = Math.max(1, Math.floor(impulses));
  const baseFrequency = Math.max(1e-3, Math.abs(frequency));
  const envelopeWidth = Math.max(0.5, Math.abs(bandwidth));
  const gaussianFalloff = 1 / (envelopeWidth * envelopeWidth);
  const radius = Math.max(
    1,
    Math.ceil(envelopeWidth * Math.sqrt(Math.log(1000))),
  );
  const impulseSeeds = new Array(impulseCount).fill(null).map((_, index) => ({
    offsetSeedX: hashSeed(seed, 337 + index * 17),
    offsetSeedZ: hashSeed(seed, 389 + index * 19),
    orientationSeed: hashSeed(seed, 557 + index * 29),
    phaseSeed: hashSeed(seed, 673 + index * 31),
  }));

  return (x, z) => {
    const sx = x * baseFrequency;
    const sz = z * baseFrequency;
    const ix = Math.floor(sx);
    const iz = Math.floor(sz);
    let total = 0;
    let weightSum = 0;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const cellX = ix + dx;
        const cellZ = iz + dz;

        for (let i = 0; i < impulseSeeds.length; i += 1) {
          const seeds = impulseSeeds[i];
          const offsetX = random2D(seeds.offsetSeedX, cellX, cellZ) - 0.5;
          const offsetZ = random2D(seeds.offsetSeedZ, cellX, cellZ) - 0.5;
          const orientation =
            random2D(seeds.orientationSeed, cellX, cellZ) * Math.PI * 2;
          const cosTheta = Math.cos(orientation);
          const sinTheta = Math.sin(orientation);
          const phase = random2D(seeds.phaseSeed, cellX, cellZ) * Math.PI * 2;
          const centerX = cellX + offsetX;
          const centerZ = cellZ + offsetZ;
          const dxSample = sx - centerX;
          const dzSample = sz - centerZ;
          const dist2 = dxSample * dxSample + dzSample * dzSample;
          const weight = Math.exp(-dist2 * gaussianFalloff);
          if (weight < 1e-6) {
            continue;
          }
          const projection = dxSample * cosTheta + dzSample * sinTheta;
          const wave = Math.cos(2 * Math.PI * projection + phase);
          total += wave * weight;
          weightSum += weight;
        }
      }
    }

    const normalized = weightSum > 0 ? total / weightSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createWaveletNoiseSampler({
  seed = 1,
  period = 32,
  octaves = 4,
  modesPerOctave = 4,
  gain = 0.5,
} = {}) {
  const periodSize = Math.max(2, Math.floor(period));
  const octaveCount = Math.max(1, Math.floor(octaves));
  const modeCount = Math.max(1, Math.floor(modesPerOctave));
  const normalizedGain = clamp(gain, 0, 1);
  const maxMode = Math.max(1, Math.floor(periodSize / 2));

  const modeParameters = new Array(octaveCount)
    .fill(null)
    .map((_, octave) => {
      const amplitude = Math.pow(normalizedGain, octave);
      const frequencyMultiplier = Math.pow(2, octave);
      return new Array(modeCount).fill(null).map((__, modeIndex) => {
        const baseSeed = hashSeed(seed, 911 + octave * 73 + modeIndex * 19);
        const rx = random2D(baseSeed, 0, 0);
        const rz = random2D(baseSeed, 17.11, 43.7);
        const kx = 1 + Math.floor(rx * maxMode);
        const kz = 1 + Math.floor(rz * maxMode);
        const phase = random2D(baseSeed, 73.17, 19.31) * Math.PI * 2;
        return {
          kx: kx * frequencyMultiplier,
          kz: kz * frequencyMultiplier,
          amplitude,
          phase,
        };
      });
    });

  return (x, z) => {
    const u = wrap01(x / periodSize);
    const v = wrap01(z / periodSize);
    let total = 0;
    let weightSum = 0;

    for (const octaveModes of modeParameters) {
      for (const mode of octaveModes) {
        if (mode.amplitude <= 0) {
          continue;
        }
        const angle = 2 * Math.PI * (mode.kx * u + mode.kz * v) + mode.phase;
        const value = Math.sin(angle) * mode.amplitude;
        total += value;
        weightSum += mode.amplitude;
      }
    }

    const normalized = weightSum > 0 ? total / weightSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createSpectralNoiseSampler({
  seed = 1,
  octaves = 6,
  lacunarity = 2,
  slope = -1,
  weights,
  frequencyMultipliers,
  baseSampler = 'value',
} = {}) {
  const hasWeights = Array.isArray(weights) && weights.length > 0;
  const hasFrequencies =
    Array.isArray(frequencyMultipliers) && frequencyMultipliers.length > 0;
  const weightLength = hasWeights ? weights.length : 0;
  const frequencyLength = hasFrequencies ? frequencyMultipliers.length : 0;
  const fallbackOctaves = Math.max(1, Math.floor(octaves));
  const octaveCount =
    weightLength > 0 && frequencyLength > 0
      ? Math.min(weightLength, frequencyLength)
      : weightLength > 0
      ? weightLength
      : frequencyLength > 0
      ? frequencyLength
      : fallbackOctaves;
  const spectralLacunarity = Math.max(1e-3, Math.abs(lacunarity));
  const normalizedBase =
    typeof baseSampler === 'string' ? baseSampler.toLowerCase() : 'value';

  const amplitudeWeights = hasWeights
    ? weights
        .slice(0, octaveCount)
        .map((weight) => Math.max(0, Math.abs(weight)))
    : null;
  const frequencies = hasFrequencies
    ? frequencyMultipliers
        .slice(0, octaveCount)
        .map((value) => Math.max(1e-3, Math.abs(value)))
    : new Array(octaveCount)
        .fill(null)
        .map((_, index) => Math.pow(spectralLacunarity, index));

  const layerSamplers = new Array(octaveCount)
    .fill(null)
    .map((_, index) => {
      const layerSeed = hashSeed(seed, 401 + index * 37);
      if (
        normalizedBase === 'gradient' ||
        normalizedBase === 'gradientnoise'
      ) {
        const gradient = new GradientNoise2D(layerSeed);
        return (lx, lz) => gradient.noise(lx, lz);
      }
      if (
        normalizedBase === 'simplex' ||
        normalizedBase === 'simplexnoise'
      ) {
        const simplex = new SimplexNoise2D(layerSeed);
        return (lx, lz) => simplex.noise(lx, lz);
      }
      if (normalizedBase === 'white' || normalizedBase === 'whitenoise') {
        return (lx, lz) => toSignedRange(random2D(layerSeed, lx, lz));
      }
      const valueNoise = createValueNoise(seed, index);
      return (lx, lz) => toSignedRange(valueNoise.noise(lx, lz));
    });

  const weightsPerLayer =
    amplitudeWeights ??
    frequencies.map((frequency) => Math.pow(frequency, slope));
  const weightSum = weightsPerLayer.reduce((sum, weight) => sum + weight, 0);

  return (x, z) => {
    let total = 0;

    for (let i = 0; i < octaveCount; i += 1) {
      const sample = layerSamplers[i](x * frequencies[i], z * frequencies[i]);
      total += sample * weightsPerLayer[i];
    }

    const normalized = weightSum > 1e-9 ? total / weightSum : 0;
    return clamp(normalized, -1, 1);
  };
}

function createPoissonBlueMaskSampler({
  seed = 1,
  frequency = 1,
  radius = 2,
  falloff = 1.5,
  bias = 0,
} = {}) {
  const density = Math.max(1e-3, Math.abs(frequency));
  const cellRadius = Math.max(1, Math.floor(radius));
  const influenceRadius = Math.max(0.5, Math.abs(radius));
  const falloffStrength = Math.max(0.1, Math.abs(falloff));
  const biasNormalized = clamp(bias, -1, 1);
  const prioritySeed = hashSeed(seed, 1039);
  const offsetSeedX = hashSeed(seed, 1063);
  const offsetSeedZ = hashSeed(seed, 1097);

  function cellPriority(ix, iz) {
    return random2D(prioritySeed, ix, iz);
  }

  function cellHasFeature(ix, iz) {
    const centerPriority = cellPriority(ix, iz);
    for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
      for (let dz = -cellRadius; dz <= cellRadius; dz += 1) {
        if (dx === 0 && dz === 0) {
          continue;
        }
        if (dx * dx + dz * dz > cellRadius * cellRadius) {
          continue;
        }
        const neighborPriority = cellPriority(ix + dx, iz + dz);
        if (neighborPriority > centerPriority) {
          return false;
        }
      }
    }
    return true;
  }

  function cellOffset(ix, iz) {
    const ox = random2D(offsetSeedX, ix, iz);
    const oz = random2D(offsetSeedZ, ix, iz);
    return { x: ox, z: oz };
  }

  return (x, z) => {
    const sx = x * density;
    const sz = z * density;
    const gx = Math.floor(sx);
    const gz = Math.floor(sz);
    let best = 0;
    const searchRadius = cellRadius + 1;

    for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
      for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
        const cellX = gx + dx;
        const cellZ = gz + dz;
        if (!cellHasFeature(cellX, cellZ)) {
          continue;
        }
        const { x: offsetX, z: offsetZ } = cellOffset(cellX, cellZ);
        const centerX = cellX + offsetX;
        const centerZ = cellZ + offsetZ;
        const dxSample = sx - centerX;
        const dzSample = sz - centerZ;
        const distance = Math.hypot(dxSample, dzSample);
        const influence = Math.max(1e-3, influenceRadius * falloffStrength);
        const normalized = Math.max(0, 1 - distance / influence);
        if (normalized > best) {
          best = normalized;
        }
      }
    }

    const value = clamp(best * 2 - 1 + biasNormalized, -1, 1);
    return value;
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

function resolveSamplerSpec(spec, fallbackType, seed, salt) {
  if (typeof spec === 'function') {
    return spec;
  }
  if (spec && typeof spec === 'object') {
    const type = spec.type ?? fallbackType;
    const config = spec.config ?? {};
    return createNoiseSampler(type, {
      seed: hashSeed(seed, salt),
      ...config,
    });
  }
  const normalized =
    typeof spec === 'string' && spec.length > 0 ? spec : fallbackType;
  return createNoiseSampler(normalized, { seed: hashSeed(seed, salt) });
}

function createWaveShapeEvaluator(shape) {
  const normalized =
    typeof shape === 'string' ? shape.toLowerCase() : 'sine';
  if (normalized === 'square') {
    return (phase) => (Math.sin(phase) >= 0 ? 1 : -1);
  }
  if (normalized === 'triangle') {
    return (phase) => {
      const t = wrap01(phase / TWO_PI);
      return 1 - 4 * Math.abs(t - 0.5);
    };
  }
  if (normalized === 'saw' || normalized === 'sawtooth') {
    return (phase) => {
      const t = wrap01(phase / TWO_PI);
      return t * 2 - 1;
    };
  }
  if (normalized === 'pulse') {
    return (phase) => (wrap01(phase / TWO_PI) < 0.5 ? 1 : -1);
  }
  return (phase) => Math.sin(phase);
}

function normalizeArrayRange(values) {
  const maxAbs = values.reduce(
    (max, value) => Math.max(max, Math.abs(Number.isFinite(value) ? value : 0)),
    0,
  );
  if (maxAbs < 1e-6) {
    return values.map(() => 0);
  }
  return values.map((value) => clamp((value ?? 0) / maxAbs, -1, 1));
}

function buildWaveTable(source, fallbackLength, seed) {
  if (Array.isArray(source) && source.length >= 2) {
    return normalizeArrayRange(source);
  }
  const length = Math.max(2, Math.floor(fallbackLength ?? 64));
  const baseSeed = hashSeed(seed, 1201);
  const harmonicSeed = hashSeed(seed, 1205);
  const table = new Array(length).fill(0).map((_, index) => {
    const t = index / length;
    const base = Math.sin(t * TWO_PI);
    const harmonic = Math.sin(
      t * TWO_PI * 3 + random2D(harmonicSeed, index, length) * TWO_PI,
    );
    const random = toSignedRange(random2D(baseSeed, index, length - index));
    return base * 0.6 + harmonic * 0.3 + random * 0.35;
  });
  return normalizeArrayRange(table);
}

function sampleWavetable(table, position) {
  if (!table || table.length === 0) {
    return 0;
  }
  const size = table.length;
  const wrapped = wrap01(position);
  const scaled = wrapped * size;
  const index0 = Math.floor(scaled) % size;
  const index1 = (index0 + 1) % size;
  const t = scaled - Math.floor(scaled);
  return lerp(table[index0], table[index1], t);
}

function createWavetableSampler({
  seed = 1,
  table,
  tableLength = 64,
  morph = 0,
  morphTable,
  morphDepth = 0.5,
  morphFrequency = 0.2,
  frequency = 1,
  phaseOffset = 0,
  orientation = Math.PI / 4,
  drift = 0,
  amplitude = 1,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const baseTable = buildWaveTable(table, tableLength, hashSeed(seed, 1211));
  const morphTarget = buildWaveTable(
    morphTable,
    baseTable.length,
    hashSeed(seed, 1217),
  );
  const morphBias = clamp(morph, 0, 1);
  const morphStrength = clamp(morphDepth, 0, 1);
  const driftSeed = hashSeed(seed, 1223);
  const normalizedAmplitude = clamp(Math.abs(amplitude), 0, 2);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const v = -x * sinAngle + z * cosAngle;
    const driftPhase = random2D(driftSeed, Math.floor(u), Math.floor(v));
    const morphOscillation = Math.sin(
      v * morphFrequency * TWO_PI + driftPhase * TWO_PI,
    );
    const morphAmount = clamp(
      morphBias + morphStrength * (morphOscillation * 0.5 + 0.5),
      0,
      1,
    );
    const phase = u * frequency + phaseOffset + drift * morphAmount;
    const baseSample = sampleWavetable(baseTable, phase);
    const morphSample = sampleWavetable(
      morphTarget,
      phase + morphAmount * 0.25,
    );
    const blended = lerp(baseSample, morphSample, morphAmount);
    return clamp(blended * normalizedAmplitude, -1, 1);
  };
}

function createFmCompositeSampler({
  seed = 1,
  carrierShape = 'sine',
  carrierFrequency = 1,
  modulator = 'simplexNoise',
  modulatorFrequency = 0.5,
  modulationIndex = 1,
  modulationDepth = 0.5,
  feedback = 0,
  orientation = Math.PI / 4,
  modulatorOrientationOffset = Math.PI / 3,
  phaseOffset = 0,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const modOrientation = orientation + modulatorOrientationOffset;
  const modCos = Math.cos(modOrientation);
  const modSin = Math.sin(modOrientation);
  const modSampler = resolveSamplerSpec(modulator, 'simplexNoise', seed, 1231);
  const feedbackSampler = resolveSamplerSpec(
    { type: 'valueNoise' },
    'valueNoise',
    seed,
    1237,
  );
  const carrierEvaluator = createWaveShapeEvaluator(carrierShape);
  const normalizedIndex = Math.max(0, Math.abs(modulationIndex));
  const normalizedDepth = clamp(modulationDepth, 0, 2);
  const feedbackAmount = clamp(feedback, 0, 1);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const mu = x * modCos + z * modSin;
    const mv = -x * modSin + z * modCos;
    const modSignal = modSampler(mu * modulatorFrequency, mv * modulatorFrequency);
    const feedbackSignal =
      feedbackAmount > 0
        ? feedbackSampler(
            (x + modSignal * feedbackAmount) * carrierFrequency,
            (z - modSignal * feedbackAmount) * carrierFrequency,
          )
        : 0;
    const fmPhase =
      u * carrierFrequency * TWO_PI +
      phaseOffset * TWO_PI +
      modSignal * normalizedIndex * TWO_PI +
      feedbackSignal * feedbackAmount * Math.PI;
    const amplitude = 1 + normalizedDepth * modSignal * 0.5;
    const value = carrierEvaluator(fmPhase) * clamp(amplitude, -2, 2);
    return clamp(value, -1, 1);
  };
}

function createAmCompositeSampler({
  seed = 1,
  carrierShape = 'sine',
  carrierFrequency = 1,
  modulator = 'valueNoise',
  modulatorFrequency = 0.5,
  modulationDepth = 0.75,
  orientation = Math.PI / 4,
  phaseOffset = 0,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const modSampler = resolveSamplerSpec(modulator, 'valueNoise', seed, 1243);
  const carrierEvaluator = createWaveShapeEvaluator(carrierShape);
  const depth = clamp(modulationDepth, 0, 1.5);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const modValue =
      (modSampler(x * modulatorFrequency, z * modulatorFrequency) + 1) * 0.5;
    const amplitude = clamp(1 - depth + depth * modValue * 2, 0, 2);
    const carrier = carrierEvaluator(u * carrierFrequency * TWO_PI + phaseOffset * TWO_PI);
    return clamp(carrier * amplitude, -1, 1);
  };
}

function createRingModSampler({
  seed = 1,
  carrierShape = 'sine',
  carrierFrequency = 1,
  modulator = 'simplexNoise',
  modulatorShape = null,
  modulatorFrequency = 0.75,
  orientation = Math.PI / 4,
  modulatorOrientationOffset = Math.PI / 6,
  depth = 1,
  phaseOffset = 0,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const modOrientation = orientation + modulatorOrientationOffset;
  const modCos = Math.cos(modOrientation);
  const modSin = Math.sin(modOrientation);
  const carrierEvaluator = createWaveShapeEvaluator(carrierShape);
  const modSampler = resolveSamplerSpec(modulator, 'simplexNoise', seed, 1249);
  const modEvaluator =
    modulatorShape != null ? createWaveShapeEvaluator(modulatorShape) : null;
  const normalizedDepth = clamp(depth, 0, 1.5);
  const carrierPhaseOffset = random2D(hashSeed(seed, 1251), 0, 0) * TWO_PI;
  const modPhaseOffset = random2D(hashSeed(seed, 1253), 0, 0) * TWO_PI;

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const carrier = carrierEvaluator(
      u * carrierFrequency * TWO_PI + phaseOffset * TWO_PI + carrierPhaseOffset,
    );
    const mu = x * modCos + z * modSin;
    const mv = -x * modSin + z * modCos;
    const modNoise = modSampler(
      mu * modulatorFrequency,
      mv * modulatorFrequency,
    );
    const modValue =
      modEvaluator != null
        ? clamp(
            modEvaluator(mu * modulatorFrequency * TWO_PI + modPhaseOffset) *
              0.8 +
              modNoise * 0.2,
            -1,
            1,
          )
        : modNoise;
    const combined = carrier * modValue * normalizedDepth;
    return clamp(combined, -1, 1);
  };
}

function createPhaseDistortedSineSampler({
  seed = 1,
  frequency = 1,
  orientation = Math.PI / 4,
  phaseOffset = 0,
  distortionAmount = 1,
  distortionBias = 0,
  distortionFrequency = 0.5,
  modulator = 'valueNoise',
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const modSampler = resolveSamplerSpec(modulator, 'valueNoise', seed, 1255);
  const amount = clamp(distortionAmount, 0, 4);
  const bias = clamp(distortionBias, -2, 2);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const v = -x * sinAngle + z * cosAngle;
    const modValue = modSampler(
      v * distortionFrequency,
      u * distortionFrequency,
    );
    const distortion = Math.tanh(modValue * amount + bias);
    const phase =
      u * frequency * TWO_PI + phaseOffset * TWO_PI + distortion * Math.PI;
    return clamp(Math.sin(phase), -1, 1);
  };
}

function createPulseWidthModulationSampler({
  seed = 1,
  frequency = 1,
  baseDutyCycle = 0.5,
  modulationDepth = 0.4,
  modulatorFrequency = 0.35,
  orientation = Math.PI / 4,
  phaseOffset = 0,
  bias = 0,
  modulator = 'valueNoise',
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const modSampler = resolveSamplerSpec(modulator, 'valueNoise', seed, 1267);
  const depth = clamp(modulationDepth, 0, 0.9);
  const baseDuty = clamp(baseDutyCycle, 0.05, 0.95);
  const biasNormalized = clamp(bias, -1, 1);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    const v = -x * sinAngle + z * cosAngle;
    const modValue = modSampler(u * modulatorFrequency, v * modulatorFrequency);
    const duty = clamp(baseDuty + modValue * depth * 0.5, 0.05, 0.95);
    const phase = wrap01(u * frequency + phaseOffset);
    const gate = phase < duty ? 1 : -1;
    const lateral = Math.cos(v * frequency * 0.5 * TWO_PI);
    const sample = gate * lateral + biasNormalized;
    return clamp(sample, -1, 1);
  };
}

function createAdditiveHarmonicStackSampler({
  seed = 1,
  harmonics = 5,
  harmonicFalloff = 1,
  frequency = 1,
  orientation = Math.PI / 4,
  detune = 0,
  phaseOffset = 0,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const harmonicCount = Math.max(1, Math.floor(harmonics));
  const falloff = Math.max(0.01, harmonicFalloff);
  const detuneAmount = clamp(detune, -0.5, 0.5);
  const phaseSeed = hashSeed(seed, 1279);

  return (x, z) => {
    const u = x * cosAngle + z * sinAngle;
    let total = 0;
    let weight = 0;
    for (let i = 1; i <= harmonicCount; i += 1) {
      const harmonicWeight = 1 / Math.pow(i, falloff);
      const phaseJitter = random2D(phaseSeed, i, Math.floor(u)) * TWO_PI;
      const detuneRatio = 1 + detuneAmount * (i - 1);
      const sample = Math.sin(
        u * frequency * detuneRatio * TWO_PI +
          phaseOffset * TWO_PI +
          phaseJitter,
      );
      total += sample * harmonicWeight;
      weight += harmonicWeight;
    }
    const normalized = weight > 0 ? total / weight : 0;
    return clamp(normalized, -1, 1);
  };
}

function createSubtractiveFilterBankSampler({
  seed = 1,
  source = 'whiteNoise',
  filterBands,
  frequency = 1,
  resonance = 0.5,
  orientation = Math.PI / 4,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const baseSampler = resolveSamplerSpec(source, 'whiteNoise', seed, 1285);
  const bands = (filterBands && filterBands.length > 0
    ? filterBands
    : [
        { center: 0.5, width: 0.75, gain: 1 },
        { center: 1.2, width: 0.5, gain: -0.45 },
        { center: 2.2, width: 0.35, gain: 0.3 },
      ]
  ).map((band, index) => ({
    center: Math.max(1e-3, Math.abs(band.center ?? (index + 1))),
    width: Math.max(0.05, Math.abs(band.width ?? 0.5)),
    gain: band.gain ?? 1,
  }));
  const normalizedResonance = clamp(resonance, 0, 2);

  return (x, z) => {
    let total = 0;
    let weight = 0;
    for (const band of bands) {
      const offset = band.width * 0.5;
      const forward = baseSampler(
        (x + cosAngle * offset) * frequency * band.center,
        (z + sinAngle * offset) * frequency * band.center,
      );
      const backward = baseSampler(
        (x - cosAngle * offset) * frequency * band.center,
        (z - sinAngle * offset) * frequency * band.center,
      );
      const bandPass = (forward - backward) * 0.5;
      const attenuated =
        baseSampler(x * frequency * band.center, z * frequency * band.center) -
        bandPass * normalizedResonance;
      total += clamp(attenuated, -1, 1) * band.gain;
      weight += Math.abs(band.gain);
    }
    const normalized = weight > 1e-6 ? total / weight : 0;
    return clamp(normalized, -1, 1);
  };
}

function createGranularNoiseSampler({
  seed = 1,
  density = 2,
  grainSize = 1,
  falloff = 2,
  jitter = 0.4,
  randomness = 0.6,
} = {}) {
  const grainsPerCell = Math.max(1, Math.floor(density));
  const fractional = clamp(density - grainsPerCell, 0, 0.999);
  const falloffStrength = Math.max(0.5, falloff);
  const grainScale = Math.max(0.2, grainSize);
  const jitterAmount = clamp(jitter, 0, 1);
  const randomnessAmount = clamp(randomness, 0, 1);
  const amplitudeSeeds = new Array(grainsPerCell).fill(null).map((_, index) => ({
    offsetSeedX: hashSeed(seed, 1291 + index * 13),
    offsetSeedZ: hashSeed(seed, 1297 + index * 17),
    amplitudeSeed: hashSeed(seed, 1301 + index * 19),
  }));
  const probabilitySeed = hashSeed(seed, 1307);

  return (x, z) => {
    const gx = Math.floor(x / grainScale);
    const gz = Math.floor(z / grainScale);
    let total = 0;
    let weight = 0;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cellX = gx + dx;
        const cellZ = gz + dz;
        const cellBaseProbability = random2D(probabilitySeed, cellX, cellZ);
        const activeFraction =
          cellBaseProbability < fractional ? grainsPerCell + 1 : grainsPerCell;
        for (let i = 0; i < activeFraction; i += 1) {
          const seeds = amplitudeSeeds[i % amplitudeSeeds.length];
          const ox =
            (random2D(seeds.offsetSeedX, cellX, cellZ) - 0.5) *
            jitterAmount *
            grainScale;
          const oz =
            (random2D(seeds.offsetSeedZ, cellX, cellZ) - 0.5) *
            jitterAmount *
            grainScale;
          const centerX = (cellX + ox) * grainScale;
          const centerZ = (cellZ + oz) * grainScale;
          const dxSample = x - centerX;
          const dzSample = z - centerZ;
          const distance = Math.hypot(dxSample, dzSample);
          const influence = Math.exp(-Math.pow(distance, falloffStrength));
          if (influence < 1e-4) {
            continue;
          }
          const amplitude =
            toSignedRange(random2D(seeds.amplitudeSeed, cellX, cellZ)) *
            (1 - randomnessAmount * 0.5) +
            randomnessAmount * (Math.sin(distance * TWO_PI) * 0.5);
          total += amplitude * influence;
          weight += influence;
        }
      }
    }

    const normalized = weight > 1e-6 ? total / weight : 0;
    return clamp(normalized, -1, 1);
  };
}

function createSampleAndHoldSampler({
  seed = 1,
  cellSize = 2,
  jitter = 0.2,
  smoothness = 0,
  bias = 0,
} = {}) {
  const size = Math.max(0.5, Math.abs(cellSize));
  const jitterAmount = clamp(jitter, 0, 1);
  const smooth = clamp(smoothness, 0, 1);
  const biasNormalized = clamp(bias, -1, 1);
  const valueSeed = hashSeed(seed, 1313);
  const jitterSeedX = hashSeed(seed, 1319);
  const jitterSeedZ = hashSeed(seed, 1321);

  return (x, z) => {
    const gx = Math.floor(x / size);
    const gz = Math.floor(z / size);
    const baseValue = toSignedRange(random2D(valueSeed, gx, gz));
    const offsetX =
      (random2D(jitterSeedX, gx, gz) - 0.5) * jitterAmount * size;
    const offsetZ =
      (random2D(jitterSeedZ, gx, gz) - 0.5) * jitterAmount * size;
    const sample = baseValue + biasNormalized;

    if (smooth <= 0) {
      return clamp(sample, -1, 1);
    }

    const nx = Math.floor((x + offsetX) / size);
    const nz = Math.floor((z + offsetZ) / size);
    const neighborValue = toSignedRange(random2D(valueSeed, nx, nz));
    const blended = lerp(sample, neighborValue + biasNormalized, smooth);
    return clamp(blended, -1, 1);
  };
}

function createNoiseChorusSampler({
  seed = 1,
  baseType = 'simplexNoise',
  voices = 3,
  detune = 0.03,
  spread = 0.5,
  frequency = 1,
} = {}) {
  const voiceCount = Math.max(1, Math.floor(voices));
  const detuneAmount = clamp(detune, -0.2, 0.2);
  const spreadAmount = Math.max(0, spread);
  const voiceSamplers = new Array(voiceCount).fill(null).map((_, index) =>
    resolveSamplerSpec(baseType, baseType, seed, 1327 + index * 7),
  );

  return (x, z) => {
    let total = 0;
    for (let i = 0; i < voiceCount; i += 1) {
      const sampler = voiceSamplers[i];
      const voicePosition = i - (voiceCount - 1) / 2;
      const detuneRatio = 1 + detuneAmount * voicePosition;
      const offsetX =
        (random2D(hashSeed(seed, 1361 + i * 11), Math.floor(x), Math.floor(z)) -
          0.5) *
        spreadAmount;
      const offsetZ =
        (random2D(hashSeed(seed, 1373 + i * 13), Math.floor(z), Math.floor(x)) -
          0.5) *
        spreadAmount;
      total += sampler(
        (x + offsetX) * frequency * detuneRatio,
        (z + offsetZ) * frequency * detuneRatio,
      );
    }
    const normalized = total / voiceCount;
    return clamp(normalized, -1, 1);
  };
}

function createResonantFilterFieldSampler({
  seed = 1,
  source = 'valueNoise',
  resonance = 1.2,
  q = 0.8,
  frequency = 1,
  bandwidth = 0.75,
  orientation = Math.PI / 4,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const baseSampler = resolveSamplerSpec(source, 'valueNoise', seed, 1381);
  const normalizedResonance = clamp(resonance, 0, 5);
  const normalizedQ = clamp(q, 0.1, 3);
  const offset = Math.max(0.1, Math.abs(bandwidth));

  return (x, z) => {
    const base = baseSampler(x * frequency, z * frequency);
    const forward = baseSampler(
      (x + cosAngle * offset) * frequency,
      (z + sinAngle * offset) * frequency,
    );
    const backward = baseSampler(
      (x - cosAngle * offset) * frequency,
      (z - sinAngle * offset) * frequency,
    );
    const bandPass = (forward - backward) * 0.5;
    const resonant = base + bandPass * normalizedResonance;
    const damped = resonant / (1 + normalizedResonance * normalizedQ);
    return clamp(damped, -1, 1);
  };
}

function createReverberantDecayFieldSampler({
  seed = 1,
  source = 'valueNoise',
  taps = 4,
  decay = 0.6,
  delay = 1.5,
  diffusion = 0.25,
  frequency = 1,
  orientation = Math.PI / 4,
} = {}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);
  const baseSampler = resolveSamplerSpec(source, 'valueNoise', seed, 1387);
  const tapCount = Math.max(1, Math.floor(taps));
  const decayFactor = clamp(decay, 0, 0.95);
  const stepDistance = Math.max(0.1, Math.abs(delay));
  const diffusionAmount = clamp(diffusion, 0, 2);
  const jitterSeedX = hashSeed(seed, 1393);
  const jitterSeedZ = hashSeed(seed, 1399);

  return (x, z) => {
    let total = 0;
    let weight = 0;
    let sampleX = x;
    let sampleZ = z;

    for (let i = 0; i < tapCount; i += 1) {
      const attenuation = Math.pow(decayFactor, i);
      const jitterX =
        (random2D(jitterSeedX, i, Math.floor(x)) - 0.5) * diffusionAmount;
      const jitterZ =
        (random2D(jitterSeedZ, i, Math.floor(z)) - 0.5) * diffusionAmount;
      const sample = baseSampler(
        (sampleX + jitterX) * frequency,
        (sampleZ + jitterZ) * frequency,
      );
      total += sample * attenuation;
      weight += attenuation;
      sampleX -= cosAngle * stepDistance;
      sampleZ -= sinAngle * stepDistance;
    }

    const normalized = weight > 1e-6 ? total / weight : 0;
    return clamp(normalized, -1, 1);
  };
}

function createHyperbolicTangentFieldSampler({
  seed = 1,
  source = 'valueNoise',
  gain = 1.5,
  bias = 0,
  mix = 1,
} = {}) {
  const baseSampler = resolveSamplerSpec(source, 'valueNoise', seed, 1403);
  const normalizedGain = Math.max(0, Math.abs(gain));
  const normalizedBias = clamp(bias, -2, 2);
  const blend = clamp(mix, 0, 1);

  return (x, z) => {
    const base = baseSampler(x, z);
    const shaped = Math.tanh(base * normalizedGain + normalizedBias);
    const value = lerp(base, shaped, blend);
    return clamp(value, -1, 1);
  };
}

function createSigmoidStepFieldSampler({
  seed = 1,
  source = 'valueNoise',
  threshold = 0,
  steepness = 6,
  low = -1,
  high = 1,
  mix = 1,
} = {}) {
  const baseSampler = resolveSamplerSpec(source, 'valueNoise', seed, 1409);
  const normalizedThreshold = clamp(threshold, -1, 1);
  const slope = Math.max(0.1, Math.abs(steepness));
  const lowValue = clamp(low, -1, 1);
  const highValue = clamp(high, -1, 1);
  const blend = clamp(mix, 0, 1);

  return (x, z) => {
    const base = baseSampler(x, z);
    const shifted = base - normalizedThreshold;
    const logistic = 1 / (1 + Math.exp(-shifted * slope));
    const plateau = lerp(lowValue, highValue, logistic);
    const shaped = clamp(plateau, -1, 1);
    const value = lerp(base, shaped, blend);
    return clamp(value, -1, 1);
  };
}

function createExponentialFieldSampler({
  seed = 1,
  source = 'valueNoise',
  decay = 1.5,
  bias = 0,
  invert = false,
  mix = 1,
  offset = 0,
} = {}) {
  const baseSampler = resolveSamplerSpec(source, 'valueNoise', seed, 1417);
  const attenuation = Math.max(1e-3, Math.abs(decay));
  const normalizedBias = clamp(bias, -1, 1);
  const blend = clamp(mix, 0, 1);
  const offsetNormalized = clamp(offset, -1, 1);

  return (x, z) => {
    const base = baseSampler(x, z);
    const normalized = clamp((base + 1) * 0.5 + normalizedBias, 0, 1);
    const envelope = Math.exp(-normalized * attenuation);
    const shaped = invert ? envelope : 1 - envelope;
    const remapped = clamp(shaped * 2 - 1 + offsetNormalized, -1, 1);
    const value = lerp(base, remapped, blend);
    return clamp(value, -1, 1);
  };
}

function createSdfPrimitivesSampler({
  seed = 1,
  primitive = 'circle',
  cellSize = 12,
  radius = 0.35,
  jitter = 0.2,
  smoothness = 0.2,
  rotationJitter = 0,
  invert = false,
} = {}) {
  const normalizedPrimitive =
    typeof primitive === 'string' ? primitive.toLowerCase() : 'circle';
  const size = Math.max(1, Math.abs(cellSize));
  const radiusRatio = clamp(radius, 0.05, 0.9);
  const jitterAmount = clamp(jitter, 0, 0.49) * size;
  const softness = Math.max(1e-3, smoothness) * size;
  const rotationRange = clamp(rotationJitter, 0, 1) * Math.PI;
  const offsetSeedX = hashSeed(seed, 1421);
  const offsetSeedZ = hashSeed(seed, 1427);
  const rotationSeed = hashSeed(seed, 1433);

  return (x, z) => {
    const scaledX = x / size;
    const scaledZ = z / size;
    const cellX = Math.floor(scaledX);
    const cellZ = Math.floor(scaledZ);
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = cellX + dx;
        const cz = cellZ + dz;
        const centerX =
          (cx + 0.5) * size + (random2D(offsetSeedX, cx, cz) - 0.5) * 2 * jitterAmount;
        const centerZ =
          (cz + 0.5) * size + (random2D(offsetSeedZ, cz, cx) - 0.5) * 2 * jitterAmount;
        const angle = rotationRange > 0
          ? (random2D(rotationSeed, cx, cz) - 0.5) * rotationRange
          : 0;
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);
        const localX = x - centerX;
        const localZ = z - centerZ;
        const rotatedX = localX * cosAngle - localZ * sinAngle;
        const rotatedZ = localX * sinAngle + localZ * cosAngle;
        const extent = radiusRatio * size;

        let distance;
        if (normalizedPrimitive === 'square' || normalizedPrimitive === 'box') {
          distance = signedDistanceBox(rotatedX, rotatedZ, extent, extent);
        } else if (normalizedPrimitive === 'diamond') {
          distance = Math.abs(rotatedX) + Math.abs(rotatedZ) - extent;
        } else if (normalizedPrimitive === 'cross') {
          const arm = extent * 0.5;
          const bar = extent * 0.2;
          const vertical = signedDistanceBox(rotatedX, rotatedZ, bar, arm);
          const horizontal = signedDistanceBox(rotatedX, rotatedZ, arm, bar);
          distance = Math.min(vertical, horizontal);
        } else {
          distance = Math.hypot(rotatedX, rotatedZ) - extent;
        }

        if (distance < bestDistance) {
          bestDistance = distance;
        }
      }
    }

    const normalizedDistance = clamp(-bestDistance / softness, -1, 1);
    const shaped = invert ? -normalizedDistance : normalizedDistance;
    return clamp(shaped, -1, 1);
  };
}

function createMultifractalBlendSampler({
  seed = 1,
  baseType = 'simplexNoise',
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
  exponent = 1.2,
  exponentSlope = 0.1,
  mix = 1,
  offset = 0,
} = {}) {
  const octaveCount = Math.max(1, Math.floor(octaves));
  const normalizedGain = Math.max(0, Math.abs(gain));
  const normalizedLacunarity = Math.max(1, Math.abs(lacunarity));
  const baseSampler = resolveSamplerSpec(baseType, 'simplexNoise', seed, 1439);
  const additionalSamplers = new Array(Math.max(0, octaveCount - 1))
    .fill(null)
    .map((_, index) =>
      resolveSamplerSpec(baseType, 'simplexNoise', seed, 1447 + index * 11),
    );
  const samplers = [baseSampler, ...additionalSamplers];
  const mixAmount = clamp(mix, 0, 1);
  const offsetNormalized = clamp(offset, -1, 1);

  return (x, z) => {
    let frequency = 1;
    let amplitude = 1;
    let total = 0;
    let amplitudeSum = 0;

    for (let i = 0; i < samplers.length; i += 1) {
      const sampler = samplers[i];
      const sample = sampler(x * frequency, z * frequency);
      const power = Math.max(0.1, exponent + exponentSlope * i);
      const shaped = Math.sign(sample) * Math.pow(Math.abs(sample), power);
      total += shaped * amplitude;
      amplitudeSum += amplitude;
      amplitude *= normalizedGain;
      frequency *= normalizedLacunarity;
    }

    const normalized = amplitudeSum > 0 ? total / amplitudeSum : 0;
    const offsetValue = clamp(normalized + offsetNormalized, -1, 1);
    const baseValue = baseSampler(x, z);
    const blended = lerp(baseValue, offsetValue, mixAmount);
    return clamp(blended, -1, 1);
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

function createWarpedFbmSampler({
  seed = 1,
  octaves = 5,
  gain = 0.5,
  lacunarity = 2,
  warpStrength = 0.75,
  warpScale = 1,
  warpOctaves = 2,
  warpGain = 0.5,
  warpLacunarity = 2,
  warpMix = 1,
} = {}) {
  const baseSeed = hashSeed(seed, 631);
  const warpSeed = hashSeed(seed, 677);
  const baseSampler = createFbmSampler({
    seed: baseSeed,
    octaves,
    gain,
    lacunarity,
  });
  const warpSampler = createDomainWarpSampler({
    seed: warpSeed,
    strength: warpStrength,
    scale: warpScale,
    octaves: warpOctaves,
    gain: warpGain,
    lacunarity: warpLacunarity,
  });
  const blend = clamp(warpMix, 0, 1);

  return (x, z) => {
    const baseSample = baseSampler(x, z);
    if (blend <= 0) {
      return baseSample;
    }

    const warp = warpSampler(x, z);
    const warpedSample = baseSampler(x + warp.x, z + warp.z);
    const mixed = lerp(baseSample, warpedSample, blend);
    return clamp(mixed, -1, 1);
  };
}

function createCurlNoiseSampler({
  seed = 1,
  strength = 0.75,
  frequency = 1,
  step = 0.5,
} = {}) {
  const curlNoise = new SimplexNoise2D(hashSeed(seed, 227));
  const eps = Math.max(1e-3, Math.abs(step));
  const freq = Math.max(1e-3, Math.abs(frequency));

  return (x, z) => {
    const sx = x * freq;
    const sz = z * freq;
    const dNx =
      curlNoise.noise(sx + eps, sz) - curlNoise.noise(sx - eps, sz);
    const dNz =
      curlNoise.noise(sx, sz + eps) - curlNoise.noise(sx, sz - eps);
    const curlX = (dNz / (2 * eps)) * strength;
    const curlZ = (-dNx / (2 * eps)) * strength;

    let vx = clamp(curlX, -1, 1);
    let vz = clamp(curlZ, -1, 1);
    const magnitude = Math.hypot(vx, vz);
    if (magnitude > 1) {
      vx /= magnitude;
      vz /= magnitude;
    }

    return { x: vx, z: vz };
  };
}

function createCellEdgeDistanceSampler({
  seed = 1,
  jitter = 0.75,
  falloff = 1,
  distance = 'euclidean',
} = {}) {
  const jitterSeedX = seed * 1.91 + 17;
  const jitterSeedZ = seed * 1.53 + 31;
  const shapedFalloff = Math.max(1e-3, Math.abs(falloff));

  return (x, z) => {
    const distances = collectVoronoiDistances(
      x,
      z,
      jitterSeedX,
      jitterSeedZ,
      jitter,
      distance,
    );
    const f1 = distances[0] ?? 0;
    const f2 = distances[1] ?? f1;
    const edgeDistance = Math.max(0, f2 - f1);
    const normalized = Math.exp(-edgeDistance * shapedFalloff);
    return clamp(normalized * 2 - 1, -1, 1);
  };
}

function createTerraceQuantizedSampler({
  seed = 1,
  steps = 5,
  smoothness = 0.1,
  bias = 0,
} = {}) {
  const baseNoise = createValueNoise(seed * 1.79 + 23, 0);
  const terraceSteps = Math.max(2, Math.floor(steps));
  const blend = clamp(smoothness, 0, 1);

  return (x, z) => {
    const sample = toSignedRange(baseNoise.noise(x, z));
    const normalized = clamp((sample + 1) * 0.5 + bias, 0, 1);
    const scaled = normalized * (terraceSteps - 1);
    const index = Math.floor(scaled);
    const fraction = scaled - index;
    const baseValue = index / (terraceSteps - 1);
    const nextValue =
      index + 1 <= terraceSteps - 1
        ? (index + 1) / (terraceSteps - 1)
        : baseValue;
    const terraced = lerp(baseValue, nextValue, fraction * blend);
    return clamp(terraced * 2 - 1, -1, 1);
  };
}

function createVoronoiBlendSampler({
  seed = 1,
  jitter = 0.75,
  distance = 'euclidean',
  blendExponent = 1,
  bias = 0,
} = {}) {
  const jitterSeedX = seed * 2.11 + 41;
  const jitterSeedZ = seed * 1.73 + 59;
  const exponent = Math.max(1e-3, Math.abs(blendExponent));

  return (x, z) => {
    const distances = collectVoronoiDistances(
      x,
      z,
      jitterSeedX,
      jitterSeedZ,
      jitter,
      distance,
    );
    const f1 = distances[0] ?? 0;
    const f2 = distances[1] ?? f1;
    const ratio = f2 <= 1e-6 ? 0 : Math.max(0, f2 - f1) / Math.max(f2, 1e-6);
    const shaped = Math.pow(clamp(ratio, 0, 1), exponent);
    const biased = clamp(shaped + bias, 0, 1);
    return clamp(biased * 2 - 1, -1, 1);
  };
}

function createNoiseMixWavesetSampler({
  seed = 1,
  sources,
  mixFrequency = 1,
  softmaxTemperature = 0.75,
  mixBias = 0,
} = {}) {
  const defaultSources = [
    { type: 'fbm' },
    { type: 'ridge' },
    { type: 'turbulence' },
  ];
  const sourceList =
    Array.isArray(sources) && sources.length > 0 ? sources : defaultSources;
  const resolvedSources = sourceList.map((source, index) => {
    const rawType = source?.type ?? source?.id ?? 'fbm';
    const normalizedType =
      typeof rawType === 'string' &&
      rawType.toLowerCase() !== 'noisemixwaveset'
        ? rawType
        : 'fbm';
    const config = { ...(source?.config ?? {}) };
    const amplitude = clamp(Math.abs(source?.amplitude ?? 1), 0, 1);
    const samplerSeed = hashSeed(seed, 751 + index * 37);
    const weightSeed = hashSeed(seed, 863 + index * 61);
    const sampler = createNoiseSampler(normalizedType, {
      seed: samplerSeed,
      ...config,
    });
    const weightNoise = createValueNoise(weightSeed, 0);
    return { sampler, weightNoise, amplitude };
  });
  const frequency = Math.max(1e-3, Math.abs(mixFrequency));
  const temperature = Math.max(0.05, Math.abs(softmaxTemperature));
  const bias = clamp(mixBias, -1, 1);

  return (x, z) => {
    if (resolvedSources.length === 0) {
      return 0;
    }

    let weightSum = 0;
    const weights = new Array(resolvedSources.length);
    const samples = new Array(resolvedSources.length);

    for (let i = 0; i < resolvedSources.length; i += 1) {
      const entry = resolvedSources[i];
      const weightSample = toSignedRange(
        entry.weightNoise.noise(x * frequency, z * frequency),
      );
      const weight = Math.exp(weightSample / temperature);
      weights[i] = weight;
      weightSum += weight;

      const sample = clamp(entry.sampler(x, z), -1, 1) * entry.amplitude;
      samples[i] = clamp(sample, -1, 1);
    }

    if (weightSum <= 1e-9) {
      return 0;
    }

    let mixed = 0;
    for (let i = 0; i < resolvedSources.length; i += 1) {
      mixed += (weights[i] / weightSum) * samples[i];
    }

    return clamp(mixed + bias, -1, 1);
  };
}

function collectVoronoiDistances(
  x,
  z,
  jitterSeedX,
  jitterSeedZ,
  jitter,
  distance,
) {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const distances = [];

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
      distances.push(candidate);
    }
  }

  distances.sort((a, b) => a - b);
  return distances;
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
    const average =
      neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
    const blended = lerp(center, average, smooth);
    return clamp(toSignedRange(blended), -1, 1);
  };
}

function createAnisotropicDiffusionSampler({
  seed = 1,
  smoothing = 0.6,
  orientation = 0,
  anisotropy = 0.5,
  step = 1,
} = {}) {
  const baseNoise = new ValueNoise2D(hashSeed(seed, 211));
  const smooth = clamp(smoothing, 0, 1);
  const anisotropicWeight = clamp(anisotropy, 0, 1);
  const distance = Math.max(1e-3, Math.abs(step));

  return (x, z) => {
    const angle = orientation;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const stepX = dirX * distance;
    const stepZ = dirZ * distance;
    const perpX = -dirZ * distance;
    const perpZ = dirX * distance;

    const center = baseNoise.noise(x, z);
    const axialAverage =
      (baseNoise.noise(x + stepX, z + stepZ) +
        baseNoise.noise(x - stepX, z - stepZ)) /
      2;
    const lateralAverage =
      (baseNoise.noise(x + perpX, z + perpZ) +
        baseNoise.noise(x - perpX, z - perpZ)) /
      2;

    const axialWeight = 0.5 + anisotropicWeight / 2;
    const lateralWeight = 1 - axialWeight;
    const orientedBlend = axialAverage * axialWeight + lateralAverage * lateralWeight;
    const blended = lerp(center, orientedBlend, smooth);
    return clamp(toSignedRange(blended), -1, 1);
  };
}

function createHydraulicErosionSampler({
  seed = 1,
  smoothing = 0.4,
  erosionRate = 0.45,
  depositionRate = 0.25,
  step = 1,
} = {}) {
  const baseNoise = new ValueNoise2D(hashSeed(seed, 223));
  const smooth = clamp(smoothing, 0, 1);
  const erosion = clamp(erosionRate, 0, 1);
  const deposition = clamp(depositionRate, 0, 1);
  const distance = Math.max(1e-3, Math.abs(step));

  return (x, z) => {
    const offsets = [
      [distance, 0],
      [-distance, 0],
      [0, distance],
      [0, -distance],
      [distance, distance],
      [-distance, distance],
      [distance, -distance],
      [-distance, -distance],
    ];

    const center = baseNoise.noise(x, z);
    const neighborSamples = offsets.map(([dx, dz]) =>
      baseNoise.noise(x + dx, z + dz),
    );

    let lowestNeighbor = neighborSamples[0];
    let highestNeighbor = neighborSamples[0];
    let sumNeighbors = 0;

    for (let i = 0; i < neighborSamples.length; i += 1) {
      const sample = neighborSamples[i];
      if (sample < lowestNeighbor) {
        lowestNeighbor = sample;
      }
      if (sample > highestNeighbor) {
        highestNeighbor = sample;
      }
      sumNeighbors += sample;
    }

    const average = sumNeighbors / neighborSamples.length;
    const erosionAmount = Math.max(0, center - lowestNeighbor) * erosion;
    const depositionAmount = Math.max(0, highestNeighbor - center) * deposition;
    const eroded = center - erosionAmount + depositionAmount;
    const smoothed = lerp(eroded, average, smooth);
    const normalized = clamp(smoothed, 0, 1);
    return clamp(toSignedRange(normalized), -1, 1);
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

function signedDistanceBox(x, z, halfSizeX, halfSizeZ) {
  const hx = Math.max(1e-6, halfSizeX);
  const hz = Math.max(1e-6, halfSizeZ);
  const dx = Math.abs(x) - hx;
  const dz = Math.abs(z) - hz;
  const outsideX = Math.max(dx, 0);
  const outsideZ = Math.max(dz, 0);
  const outsideDistance = Math.hypot(outsideX, outsideZ);
  const insideDistance = Math.min(Math.max(dx, dz), 0);
  return outsideDistance + insideDistance;
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

function wrap01(value) {
  const fractional = value - Math.floor(value);
  return fractional < 0 ? fractional + 1 : fractional;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
