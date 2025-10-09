import assert from 'node:assert/strict';
import test from 'node:test';

import {
  kamea_to_fm_matrix,
  kamea_to_warp,
  kamea_to_phase,
  kamea_to_spectral,
  make_kamea_patch,
} from '../kamea-patch.js';
import { getCanonicalKameaMatrix } from '../kamea.js';

const EPSILON = 1e-9;

function approximatelyEqual(a, b, tolerance = EPSILON) {
  return Math.abs(a - b) <= tolerance;
}

test('kamea warp companion vectors rotate primary vectors by 90 degrees', () => {
  const warp = kamea_to_warp('Saturn 3x3', { operatorCount: 3, strength: 0.5 });
  assert.equal(warp.primary.length, 3);
  assert.equal(warp.companion.length, 3);
  for (let index = 0; index < 3; index += 1) {
    const primary = warp.primary[index];
    const companion = warp.companion[index];
    assert.ok(primary, 'primary vector should be defined');
    assert.ok(companion, 'companion vector should be defined');
    assert.ok(
      approximatelyEqual(companion.x, -primary.z),
      'companion.x should equal -primary.z',
    );
    assert.ok(
      approximatelyEqual(companion.z, primary.x),
      'companion.z should equal primary.x',
    );
  }
});

test('kamea spectral conversion honours injected FFT/IFFT and enforces symmetry', () => {
  const matrix = getCanonicalKameaMatrix('Saturn 3x3');
  const fftCalls = [];
  const ifftCalls = [];
  const fakeSpectrum = [
    [
      { re: 1, im: 0 },
      { re: 0.5, im: 0.25 },
      { re: -0.1, im: 0.4 },
    ],
    [
      { re: 0.2, im: -0.3 },
      { re: 0.1, im: 0.15 },
      { re: -0.35, im: 0.05 },
    ],
    [
      { re: 0.05, im: -0.45 },
      { re: -0.12, im: 0.33 },
      { re: 0.25, im: -0.2 },
    ],
  ];
  const spectral = kamea_to_spectral(matrix, {
    operatorCount: 2,
    profile: 'custom',
    fft: (input) => {
      fftCalls.push(input);
      return fakeSpectrum.map((row) => row.map((cell) => ({ ...cell })));
    },
    ifft: (input) => {
      ifftCalls.push(input.map((row) => row.map((cell) => ({ ...cell }))));
      return input.map((row) => row.map((cell) => cell.re));
    },
    customProfile: (radius) => (radius < 0.75 ? 1 : 0),
  });
  assert.equal(fftCalls.length, 1);
  assert.equal(ifftCalls.length, 1);
  const spectrumPassedToIfft = ifftCalls[0];
  const conjugatePair = spectrumPassedToIfft[2][1];
  const original = spectrumPassedToIfft[1][2];
  assert.ok(
    approximatelyEqual(conjugatePair.re, original.re),
    'Hermitian symmetry should preserve real parts',
  );
  assert.ok(
    approximatelyEqual(conjugatePair.im, -original.im),
    'Hermitian symmetry should conjugate imaginary parts',
  );
  assert.equal(spectral.filters.length, 2);
  const filtered = spectral.filters[0](0.25);
  assert.ok(Number.isFinite(filtered));
});

test('make_kamea_patch produces deterministic patches with normalized gating', () => {
  const options = {
    operatorCount: 4,
    modulationStrength: 0.7,
    spectralProfile: 'band',
    seed: 99,
  };
  const patchA = make_kamea_patch('Mars 5x5', options);
  const patchB = make_kamea_patch('Mars 5x5', options);
  assert.deepEqual(patchA.fmMatrix, patchB.fmMatrix);
  assert.deepEqual(patchA.warp, patchB.warp);
  assert.deepEqual(patchA.phase, patchB.phase);
  assert.deepEqual(patchA.spectral.conductance, patchB.spectral.conductance);
  assert.deepEqual(patchA.gating.weights, patchB.gating.weights);
  assert.deepEqual(patchA.gating.biases, patchB.gating.biases);
  const fmMatrix = kamea_to_fm_matrix('Mars 5x5', {
    operatorCount: 4,
    strength: 0.7,
  });
  assert.equal(fmMatrix.length, 4);
  patchA.gating.bank.forEach((waveform) => {
    assert.ok(waveform in patchA.gating.weights);
  });
  const weightSum = Object.values(patchA.gating.weights).reduce(
    (acc, value) => acc + value,
    0,
  );
  assert.ok(approximatelyEqual(weightSum, 1), 'gating weights should sum to 1');
});

test('kamea phase mapping yields per-operator offsets', () => {
  const phase = kamea_to_phase('Venus 7x7', { operatorCount: 5, strength: 0.4 });
  assert.equal(phase.x.length, 5);
  assert.equal(phase.z.length, 5);
  phase.x.forEach((value) => {
    assert.ok(Number.isFinite(value));
  });
  phase.z.forEach((value) => {
    assert.ok(Number.isFinite(value));
  });
});
