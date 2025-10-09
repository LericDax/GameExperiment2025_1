import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineDomainWarp,
  createNoiseSampler,
  projectSampleCoordinates,
} from '../noise.js';

const SAMPLE_POINTS = [
  [0, 0],
  [13.37, -5.75],
  [101.5, 47.25],
];

function assertDeterministicScalar(type, config = {}) {
  const samplerA = createNoiseSampler(type, { seed: 42, ...config });
  const samplerB = createNoiseSampler(type, { seed: 42, ...config });
  const samplerC = createNoiseSampler(type, { seed: 43, ...config });

  let differenceDetected = false;

  for (const [x, z] of SAMPLE_POINTS) {
    const a = samplerA(x, z);
    const b = samplerB(x, z);
    const c = samplerC(x, z);
    assert.ok(Math.abs(a - b) < 1e-9, `${type} sampler should be deterministic`);
    assert.ok(a >= -1 - 1e-6 && a <= 1 + 1e-6, `${type} sample should stay within [-1, 1]`);
    if (!differenceDetected && Math.abs(a - c) > 1e-6) {
      differenceDetected = true;
    }
  }

  assert.ok(differenceDetected, `${type} sampler should vary with seed`);
}

test('FBM sampler is repeatable and bounded', () => {
  assertDeterministicScalar('fbm', { octaves: 4, gain: 0.45, lacunarity: 2.1 });
});

test('Turbulence sampler is repeatable and bounded', () => {
  assertDeterministicScalar('turbulence', {
    octaves: 4,
    gain: 0.5,
    lacunarity: 2.2,
  });
});

test('Ridged sampler is repeatable and bounded', () => {
  assertDeterministicScalar('ridge', {
    octaves: 3,
    gain: 0.55,
    lacunarity: 1.9,
    ridgeSharpness: 2.5,
  });
});

test('Billow sampler is repeatable and bounded', () => {
  assertDeterministicScalar('billow', {
    octaves: 3,
    gain: 0.45,
    lacunarity: 1.8,
  });
});

const SPECTRAL_NOISE_CASES = [
  {
    label: 'Pink noise',
    aliases: ['pinkNoise', 'PinkNoise', 'FractalPinkNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Brown noise',
    aliases: ['brownNoise', 'BrownNoise', 'FractalBrownNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Red noise',
    aliases: ['redNoise', 'RedNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Green noise',
    aliases: ['greenNoise', 'GreenNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Black noise',
    aliases: ['blackNoise', 'BlackNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Grey noise',
    aliases: ['greyNoise', 'GreyNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Violet noise',
    aliases: ['violetNoise', 'VioletNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Velvet noise',
    aliases: ['velvetNoise', 'VelvetNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'Blue noise',
    aliases: ['blueNoise', 'BlueNoise', 'FractalBlueNoise'],
    config: { octaves: 5, lacunarity: 2.05 },
  },
  {
    label: 'White noise',
    aliases: ['whiteNoise', 'WhiteNoise'],
    config: {},
  },
];

for (const { label, aliases, config } of SPECTRAL_NOISE_CASES) {
  for (const alias of aliases) {
    test(`${label} sampler (${alias}) is repeatable and bounded`, () => {
      assertDeterministicScalar(alias, config);
    });
  }
}

const STOCHASTIC_NOISE_CASES = [
  {
    label: 'Spectral noise',
    aliases: ['spectralNoise', 'SpectralNoise'],
    config: {
      octaves: 5,
      lacunarity: 1.9,
      slope: -0.75,
      baseSampler: 'gradient',
    },
  },
  {
    label: 'Gabor noise',
    aliases: ['gaborNoise', 'GaborNoise'],
    config: { frequency: 1.15, impulses: 5, bandwidth: 2.25 },
  },
  {
    label: 'Wavelet noise',
    aliases: ['waveletNoise', 'WaveletNoise'],
    config: { period: 28, octaves: 3, modesPerOctave: 5, gain: 0.55 },
  },
  {
    label: 'Poisson blue mask',
    aliases: ['poissonBlueMask', 'PoissonBlueMask'],
    config: { frequency: 0.85, radius: 2.5, falloff: 1.25 },
  },
];

for (const { label, aliases, config } of STOCHASTIC_NOISE_CASES) {
  for (const alias of aliases) {
    test(`${label} sampler (${alias}) is repeatable and bounded`, () => {
      assertDeterministicScalar(alias, config);
    });
  }
}

test('Worley sampler is repeatable and bounded', () => {
  assertDeterministicScalar('worley', { jitter: 0.65, falloff: 1.25 });
});

test('Value noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('valueNoise');
});

test('Gradient noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('gradientNoise');
});

test('Simplex noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('simplexNoise');
});

test('Anisotropic sine sampler is repeatable and bounded', () => {
  assertDeterministicScalar('sine', {
    orientation: Math.PI / 6,
    harmonics: 4,
    harmonicFalloff: 1.2,
    phaseOffset: 0.3,
    bias: 0,
  });
});

test('Anisotropic cosine sampler is repeatable and bounded', () => {
  assertDeterministicScalar('cosine', {
    orientation: Math.PI / 3,
    harmonics: 3,
    harmonicFalloff: 1.1,
    phaseOffset: 0.15,
  });
});

test('Anisotropic square sampler respects duty cycle deterministically', () => {
  assertDeterministicScalar('square', {
    orientation: Math.PI / 5,
    phaseOffset: 0.25,
    harmonics: 2,
    dutyCycle: 0.4,
  });
});

test('Anisotropic sawtooth sampler is repeatable and bounded', () => {
  assertDeterministicScalar('sawtooth', {
    orientation: Math.PI / 7,
    phaseOffset: -0.1,
    harmonics: 2,
  });
});

test('Anisotropic triangle sampler is repeatable and bounded', () => {
  assertDeterministicScalar('triangle', {
    orientation: Math.PI / 8,
    phaseOffset: 0.35,
    harmonics: 3,
  });
});

test('Anisotropic pulse sampler honors duty cycle and thresholds', () => {
  assertDeterministicScalar('pulse', {
    orientation: Math.PI / 9,
    phaseOffset: -0.2,
    harmonics: 2,
    dutyCycle: 0.3,
    highValue: 0.85,
    lowValue: -0.6,
  });
});

const SYNTH_WAVEFORM_CASES = [
  {
    label: 'Wavetable',
    aliases: ['wavetable', 'Wavetable'],
    config: {
      tableLength: 48,
      morph: 0.35,
      morphDepth: 0.55,
      morphFrequency: 0.25,
      frequency: 0.85,
      phaseOffset: 0.15,
      orientation: Math.PI / 5,
      drift: 0.2,
      amplitude: 0.9,
    },
  },
  {
    label: 'FM composite',
    aliases: ['fmComposite', 'FMComposite'],
    config: {
      carrierShape: 'triangle',
      carrierFrequency: 0.95,
      modulatorFrequency: 0.6,
      modulationIndex: 1.4,
      modulationDepth: 0.6,
      orientation: Math.PI / 6,
      modulatorOrientationOffset: Math.PI / 5,
      phaseOffset: 0.2,
      feedback: 0.35,
      modulator: { type: 'valueNoise', config: { octaves: 3, gain: 0.55 } },
    },
  },
  {
    label: 'AM composite',
    aliases: ['amComposite', 'AMComposite'],
    config: {
      carrierShape: 'saw',
      carrierFrequency: 1.1,
      modulatorFrequency: 0.7,
      modulationDepth: 0.8,
      orientation: Math.PI / 7,
      phaseOffset: 0.12,
      modulator: 'simplexNoise',
    },
  },
  {
    label: 'Ring modulation',
    aliases: ['ringMod', 'RingMod'],
    config: {
      carrierShape: 'sine',
      carrierFrequency: 0.9,
      modulatorShape: 'triangle',
      modulatorFrequency: 0.55,
      orientation: Math.PI / 8,
      modulatorOrientationOffset: Math.PI / 4,
      depth: 0.85,
      phaseOffset: 0.05,
    },
  },
  {
    label: 'Phase distorted sine',
    aliases: ['phaseDistortedSine', 'PhaseDistortedSine'],
    config: {
      frequency: 0.9,
      orientation: Math.PI / 7,
      phaseOffset: 0.08,
      distortionAmount: 1.3,
      distortionBias: -0.15,
      distortionFrequency: 0.55,
      modulator: 'simplexNoise',
    },
  },
  {
    label: 'Pulse width modulation',
    aliases: ['pulseWidthModulation', 'PulseWidthModulation'],
    config: {
      frequency: 0.95,
      baseDutyCycle: 0.45,
      modulationDepth: 0.5,
      modulatorFrequency: 0.4,
      orientation: Math.PI / 5,
      phaseOffset: 0.1,
      bias: 0.1,
      modulator: 'gradientNoise',
    },
  },
  {
    label: 'Additive harmonic stack',
    aliases: ['additiveHarmonicStack', 'AdditiveHarmonicStack'],
    config: {
      harmonics: 6,
      harmonicFalloff: 1.25,
      frequency: 0.8,
      orientation: Math.PI / 6,
      detune: 0.08,
      phaseOffset: 0.1,
    },
  },
  {
    label: 'Subtractive filter bank',
    aliases: ['subtractiveFilterBank', 'SubtractiveFilterBank'],
    config: {
      source: 'whiteNoise',
      frequency: 0.85,
      resonance: 0.65,
      orientation: Math.PI / 4,
      filterBands: [
        { center: 0.6, width: 0.8, gain: 0.9 },
        { center: 1.4, width: 0.6, gain: -0.5 },
        { center: 2.1, width: 0.4, gain: 0.35 },
      ],
    },
  },
  {
    label: 'Granular noise',
    aliases: ['granularNoise', 'GranularNoise'],
    config: {
      density: 2.5,
      grainSize: 1.4,
      falloff: 2.1,
      jitter: 0.55,
      randomness: 0.45,
    },
  },
  {
    label: 'Sample and hold',
    aliases: ['sampleAndHold', 'SampleAndHold'],
    config: {
      cellSize: 1.8,
      jitter: 0.35,
      smoothness: 0.45,
      bias: 0.1,
    },
  },
  {
    label: 'Noise chorus',
    aliases: ['noiseChorus', 'NoiseChorus'],
    config: {
      baseType: 'simplexNoise',
      voices: 4,
      detune: 0.04,
      spread: 0.6,
      frequency: 0.9,
    },
  },
  {
    label: 'Resonant filter field',
    aliases: ['resonantFilterField', 'ResonantFilterField'],
    config: {
      source: 'gradientNoise',
      resonance: 1.4,
      q: 0.85,
      frequency: 0.95,
      bandwidth: 0.65,
      orientation: Math.PI / 5,
    },
  },
  {
    label: 'Reverberant decay field',
    aliases: ['reverberantDecayField', 'ReverberantDecayField'],
    config: {
      source: 'valueNoise',
      taps: 5,
      decay: 0.6,
      delay: 1.25,
      diffusion: 0.35,
      frequency: 0.9,
      orientation: Math.PI / 6,
    },
  },
];

for (const { label, aliases, config } of SYNTH_WAVEFORM_CASES) {
  for (const alias of aliases) {
    test(`${label} sampler (${alias}) is repeatable and bounded`, () => {
      assertDeterministicScalar(alias, config);
    });
  }
}

test('Diffusion sampler is repeatable and bounded', () => {
  assertDeterministicScalar('diffusion', { smoothing: 0.6 });
});

test('Anisotropic diffusion sampler honors orientation and anisotropy deterministically', () => {
  assertDeterministicScalar('anisotropicDiffusion', {
    smoothing: 0.65,
    orientation: Math.PI / 4,
    anisotropy: 0.75,
    step: 1.25,
  });
});

test('Hydraulic erosion sampler is repeatable and bounded', () => {
  assertDeterministicScalar('hydraulicErosion', {
    smoothing: 0.35,
    erosionRate: 0.4,
    depositionRate: 0.3,
    step: 1.1,
  });
});

test('Cell edge distance sampler is repeatable and bounded', () => {
  assertDeterministicScalar('cellEdgeDistance', {
    jitter: 0.6,
    falloff: 1.35,
  });
});

test('Terrace quantized sampler is repeatable and bounded', () => {
  assertDeterministicScalar('terraceQuantized', {
    steps: 6,
    smoothness: 0.25,
    bias: 0.05,
  });
});

test('Voronoi blend sampler is repeatable and bounded', () => {
  assertDeterministicScalar('voronoiBlend', {
    jitter: 0.7,
    blendExponent: 1.4,
  });
});

const HYBRID_NOISE_CASES = [
  {
    label: 'Bands FBM',
    aliases: ['bandsFbm', 'BandsFBM'],
    config: {
      octaves: 4,
      gain: 0.45,
      lacunarity: 2.15,
      bandFrequency: 1.6,
      bandStrength: 0.7,
      bandSharpness: 2.3,
      orientation: Math.PI / 5,
      harmonics: 4,
      harmonicFalloff: 1.2,
      phaseOffset: 0.2,
      bandBias: 0.05,
    },
  },
  {
    label: 'Warped FBM',
    aliases: ['warpedFbm', 'WarpedFBM'],
    config: {
      octaves: 4,
      gain: 0.5,
      lacunarity: 2.3,
      warpStrength: 0.8,
      warpScale: 0.75,
      warpOctaves: 3,
      warpGain: 0.55,
      warpLacunarity: 2.1,
      warpMix: 0.9,
    },
  },
  {
    label: 'Noise mix waveset',
    aliases: ['noiseMixWaveset', 'NoiseMixWaveset'],
    config: {
      mixFrequency: 0.85,
      softmaxTemperature: 0.65,
      mixBias: 0.05,
      sources: [
        { type: 'fbm', config: { octaves: 3, gain: 0.45 }, amplitude: 0.9 },
        {
          type: 'ridge',
          config: { ridgeSharpness: 2.6, gain: 0.4 },
          amplitude: 0.85,
        },
        { type: 'blueNoise', amplitude: 0.6 },
      ],
    },
  },
];

for (const { label, aliases, config } of HYBRID_NOISE_CASES) {
  for (const alias of aliases) {
    test(`${label} sampler (${alias}) is repeatable and bounded`, () => {
      assertDeterministicScalar(alias, config);
    });
  }
}

const EXOTIC_WAVEFORM_CASES = [
  {
    label: 'Hyperbolic tangent field',
    aliases: ['hyperbolicTangentField', 'HyperbolicTangentField'],
    config: { source: 'simplexNoise', gain: 1.75, bias: 0.2, mix: 0.8 },
  },
  {
    label: 'Sigmoid step field',
    aliases: ['sigmoidStepField', 'SigmoidStepField'],
    config: {
      source: 'gradientNoise',
      threshold: 0.1,
      steepness: 7,
      low: -0.8,
      high: 0.9,
      mix: 0.9,
    },
  },
  {
    label: 'Exponential field',
    aliases: ['exponentialField', 'ExponentialField'],
    config: {
      source: 'fbm',
      decay: 1.8,
      bias: 0.05,
      invert: true,
      mix: 0.65,
      offset: -0.1,
    },
  },
  {
    label: 'SDF primitives field',
    aliases: ['sdfPrimitives', 'SDFPrimitives'],
    config: {
      primitive: 'square',
      cellSize: 9,
      radius: 0.4,
      jitter: 0.25,
      smoothness: 0.3,
      rotationJitter: 0.5,
    },
  },
  {
    label: 'Multifractal blend',
    aliases: ['multifractalBlend', 'MultifractalBlend'],
    config: {
      baseType: 'simplexNoise',
      octaves: 4,
      gain: 0.55,
      lacunarity: 2.15,
      exponent: 1.35,
      exponentSlope: 0.15,
      mix: 0.85,
      offset: 0.05,
    },
  },
];

for (const { label, aliases, config } of EXOTIC_WAVEFORM_CASES) {
  for (const alias of aliases) {
    test(`${label} sampler (${alias}) is repeatable and bounded`, () => {
      assertDeterministicScalar(alias, config);
    });
  }
}

test('Domain warp sampler produces repeatable vector offsets', () => {
  const samplerA = createNoiseSampler('warp', {
    seed: 4242,
    strength: 0.75,
    scale: 0.9,
    octaves: 2,
  });
  const samplerB = createNoiseSampler('warp', {
    seed: 4242,
    strength: 0.75,
    scale: 0.9,
    octaves: 2,
  });
  const samplerC = createNoiseSampler('warp', {
    seed: 1337,
    strength: 0.75,
    scale: 0.9,
    octaves: 2,
  });

  let differenceDetected = false;

  for (const [x, z] of SAMPLE_POINTS) {
    const warpA = samplerA(x, z);
    const warpB = samplerB(x, z);
    const warpC = samplerC(x, z);
    assert.deepEqual(warpA, warpB, 'domain warp should be deterministic');
    const magnitude = Math.hypot(warpA.x, warpA.z);
    assert.ok(magnitude <= 1 + 1e-6, 'warp magnitude should remain normalized');
    if (!differenceDetected && (Math.abs(warpA.x - warpC.x) > 1e-6 || Math.abs(warpA.z - warpC.z) > 1e-6)) {
      differenceDetected = true;
    }
  }

  assert.ok(differenceDetected, 'domain warp should vary with seed');
});

test('Curl noise sampler produces repeatable vector offsets', () => {
  const samplerA = createNoiseSampler('curlNoise', {
    seed: 777,
    strength: 0.85,
    frequency: 0.75,
    step: 0.35,
  });
  const samplerB = createNoiseSampler('curlNoise', {
    seed: 777,
    strength: 0.85,
    frequency: 0.75,
    step: 0.35,
  });
  const samplerC = createNoiseSampler('curlNoise', {
    seed: 778,
    strength: 0.85,
    frequency: 0.75,
    step: 0.35,
  });

  let differenceDetected = false;

  for (const [x, z] of SAMPLE_POINTS) {
    const warpA = samplerA(x, z);
    const warpB = samplerB(x, z);
    const warpC = samplerC(x, z);
    assert.ok(
      Math.abs(warpA.x - warpB.x) < 1e-9 && Math.abs(warpA.z - warpB.z) < 1e-9,
      'curl noise warp should be deterministic',
    );
    const magnitude = Math.hypot(warpA.x, warpA.z);
    assert.ok(magnitude <= 1 + 1e-6, 'curl noise warp magnitude should remain normalized');
    if (
      !differenceDetected &&
      (Math.abs(warpA.x - warpC.x) > 1e-6 || Math.abs(warpA.z - warpC.z) > 1e-6)
    ) {
      differenceDetected = true;
    }
  }

  assert.ok(differenceDetected, 'curl noise warp should vary with seed');
});

test('projectSampleCoordinates applies frequency, phase, and domain warp', () => {
  const coords = projectSampleCoordinates(2, -3, {
    frequency: 2,
    phase: { x: 0.5, z: -0.25 },
    domainWarp: { x: 1, z: -2 },
  });
  assert.equal(coords.x, (2 + 1) * 2 + 0.5);
  assert.equal(coords.z, (-3 - 2) * 2 - 0.25);
});

test('combineDomainWarp merges offsets additively', () => {
  const combined = combineDomainWarp({ x: 0.25, z: -0.4 }, { x: -0.1, z: 0.6 });
  assert.ok(Math.abs(combined.x - 0.15) < 1e-12);
  assert.ok(Math.abs(combined.z - 0.2) < 1e-12);
});
