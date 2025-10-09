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

test('Pink noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('pinkNoise', { octaves: 5, lacunarity: 2.05 });
});

test('Brown noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('brownNoise', { octaves: 5, lacunarity: 2.05 });
});

test('Blue noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('blueNoise', { octaves: 5, lacunarity: 2.05 });
});

test('White noise sampler is repeatable and bounded', () => {
  assertDeterministicScalar('whiteNoise');
});

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

test('Diffusion sampler is repeatable and bounded', () => {
  assertDeterministicScalar('diffusion', { smoothing: 0.6 });
});

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
