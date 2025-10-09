import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_KAMEA_NAMES,
  getCanonicalKameaMatrix,
  listCanonicalKameaNames,
  deriveKameaSeed,
  createDeterministicSeed,
  createDeterministicRng,
  encodeUnit,
  encodeBipolar,
  encodeZScore,
  encodePhase,
  encodeProbability,
  projectToOperatorSpace,
  projectToTerrainSpace,
  resampleMatrix,
  createDeterministicSamplingHook,
} from '../kamea.js';

function assertMatrixClose(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let y = 0; y < actual.length; y += 1) {
    assert.equal(actual[y].length, expected[y].length);
    for (let x = 0; x < actual[y].length; x += 1) {
      const diff = Math.abs(actual[y][x] - expected[y][x]);
      assert.ok(diff <= epsilon, `difference ${diff} exceeds tolerance`);
    }
  }
}

test('canonical Kamea matrices can be listed and retrieved deterministically', () => {
  assert.deepEqual(listCanonicalKameaNames(), CANONICAL_KAMEA_NAMES);
  const saturn = getCanonicalKameaMatrix('Saturn 3x3');
  assert.deepEqual(saturn, [
    [4, 9, 2],
    [3, 5, 7],
    [8, 1, 6],
  ]);
  const anotherSaturn = getCanonicalKameaMatrix('Saturn 3x3');
  assert.notStrictEqual(anotherSaturn, saturn, 'matrix instances are cloned');
  const seed = deriveKameaSeed('Saturn 3x3');
  const seededAgain = deriveKameaSeed('Saturn 3x3');
  assert.equal(seed, seededAgain, 'deriveKameaSeed should be deterministic');
});

test('deterministic seed helper yields reproducible pseudo-random sequences', () => {
  const seed = createDeterministicSeed('example', 42);
  const rngA = createDeterministicRng(seed);
  const rngB = createDeterministicRng(seed);
  const sequenceA = Array.from({ length: 5 }, () => rngA());
  const sequenceB = Array.from({ length: 5 }, () => rngB());
  assert.deepEqual(sequenceA, sequenceB);
});

test('encoder helpers normalize values correctly', () => {
  const matrix = [
    [1, 2],
    [3, 4],
  ];
  const unit = encodeUnit(matrix);
  assertMatrixClose(unit, [
    [0, 1 / 3],
    [2 / 3, 1],
  ]);
  const bipolar = encodeBipolar(matrix);
  assertMatrixClose(bipolar, [
    [-1, -1 / 3],
    [1 / 3, 1],
  ]);
  const zScore = encodeZScore(matrix);
  const mean = 2.5;
  const variance = ((1 - mean) ** 2 + (2 - mean) ** 2 + (3 - mean) ** 2 + (4 - mean) ** 2) / 4;
  const std = Math.sqrt(variance);
  assert.ok(Math.abs(zScore[0][0] - (1 - mean) / std) < 1e-9);
  assert.ok(Math.abs(zScore[1][1] - (4 - mean) / std) < 1e-9);
  const phase = encodePhase(matrix);
  assertMatrixClose(phase, [
    [0, (2 * Math.PI) / 3],
    [(4 * Math.PI) / 3, 2 * Math.PI],
  ]);
  const { rowNormalized, columnNormalized } = encodeProbability(matrix);
  assert.deepEqual(rowNormalized, [
    [1 / 3, 2 / 3],
    [3 / 7, 4 / 7],
  ]);
  assert.deepEqual(columnNormalized, [
    [1 / 4, 2 / 6],
    [3 / 4, 4 / 6],
  ]);
});

test('encoders gracefully handle uniform matrices', () => {
  const matrix = [
    [5, 5],
    [5, 5],
  ];
  const unit = encodeUnit(matrix);
  unit.forEach((row) => row.forEach((value) => assert.equal(value, 0.5)));
  const bipolar = encodeBipolar(matrix);
  bipolar.forEach((row) => row.forEach((value) => assert.equal(value, 0)));
  const zScore = encodeZScore(matrix);
  zScore.forEach((row) => row.forEach((value) => assert.equal(value, 0)));
  const phase = encodePhase(matrix);
  phase.forEach((row) => row.forEach((value) => assert.equal(value, Math.PI)));
  const { rowNormalized, columnNormalized } = encodeProbability(matrix);
  rowNormalized.forEach((row) => row.forEach((value) => assert.equal(value, 0.5)));
  columnNormalized.forEach((row) => row.forEach((value) => assert.equal(value, 0.5)));
});

test('resampling is tile-aware and deterministic with hooks', () => {
  const source = [
    [0, 1],
    [1, 0],
  ];
  const hookA = createDeterministicSamplingHook(123, { jitter: 0.1 });
  const hookB = createDeterministicSamplingHook(123, { jitter: 0.1 });
  const hookC = createDeterministicSamplingHook(321, { jitter: 0.1 });
  const sampleA = resampleMatrix(source, 4, 4, { samplingHook: hookA });
  const sampleB = resampleMatrix(source, 4, 4, { samplingHook: hookB });
  const sampleC = resampleMatrix(source, 4, 4, { samplingHook: hookC });
  assert.deepEqual(sampleA, sampleB, 'identical seeds should match');
  assert.notDeepEqual(sampleA, sampleC, 'different seeds should diverge');
  const tileSample = resampleMatrix(source, 2, 2, { tile: true });
  assert.deepEqual(tileSample, source);
});

test('operator and terrain projections respect requested dimensions', () => {
  const source = getCanonicalKameaMatrix('Mars 5x5');
  const operator = projectToOperatorSpace(source, 3);
  assert.equal(operator.length, 3);
  operator.forEach((row) => assert.equal(row.length, 3));
  const terrain = projectToTerrainSpace(source, 8, 4, { interpolation: 'bicubic' });
  assert.equal(terrain.length, 4);
  terrain.forEach((row) => assert.equal(row.length, 8));
});
