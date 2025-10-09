import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork } from '../tfms/operators.js';

test('createTfmsNetwork integrates supplied Kamea patch', () => {
  const patch = {
    temperament: 'Test',
    seed: 1,
    operatorCount: 1,
    fmMatrix: [[0.5]],
    fmStrength: 0.3,
    warp: {
      strength: 1,
      primary: [{ x: 0.25, z: -0.1 }],
      companion: [{ x: 0.1, z: 0.25 }],
    },
    phase: { strength: 1, x: [0.5], z: [-0.25] },
    spectral: {
      profile: 'custom',
      filters: [() => 0.5],
      conductance: [0.2],
    },
    gating: {
      bank: ['fbm'],
      weights: { fbm: 0.5 },
      biases: { fbm: 0.2 },
      logits: { fbm: 0.7 },
    },
  };

  const network = createTfmsNetwork({
    seed: 42,
    operators: [
      {
        id: 'primary',
        type: 'fbm',
        amplitude: 1,
        frequency: 1,
        weight: 1,
        bias: 0,
      },
    ],
    modulationMatrix: [],
    transferFunctions: {},
    tectonic: {},
    kameaPatch: patch,
  });

  const operatorsConfig = network.getOperators();
  assert.equal(operatorsConfig.length, 1);
  assert.equal(operatorsConfig[0].weight, 0.5);
  assert.equal(operatorsConfig[0].bias, 0.2);

  // Warm up once so FM modulation can reference prior state.
  network.evaluate({ x: 0, z: 0 });
  const result = network.evaluate({ x: 0, z: 0 });
  const output = result.operators[0];

  const expectedWarpX = patch.warp.primary[0].x + patch.warp.companion[0].x;
  const expectedWarpZ = patch.warp.primary[0].z + patch.warp.companion[0].z;
  assert.ok(Math.abs(output.domainWarp.x - expectedWarpX) < 1e-9);
  assert.ok(Math.abs(output.domainWarp.z - expectedWarpZ) < 1e-9);
  assert.ok(Math.abs(output.phase.x - patch.phase.x[0]) < 1e-9);
  assert.ok(Math.abs(output.phase.z - patch.phase.z[0]) < 1e-9);
  assert.ok(output.amplitude > 1, 'FM and conductance should boost amplitude');
  assert.ok(Math.abs(output.transferred - 0.5) < 1e-9);
  assert.ok(Math.abs(output.value - 0.45) < 1e-6);

  assert.strictEqual(network.getKameaPatch(), patch);
});
