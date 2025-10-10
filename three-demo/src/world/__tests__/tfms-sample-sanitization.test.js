import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork } from '../tfms/operators.js';

test('createTfmsNetwork clamps invalid raw samples before accumulation', () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const network = createTfmsNetwork({
      operators: [
        {
          id: 'nan-raw-operator',
          type: 'fbm',
          amplitude: 1,
          frequency: 1,
          tectonic: { weight: 1 },
          transfer: 'nanifyRaw',
        },
      ],
      transferFunctions: {
        nanifyRaw(value, sample) {
          sample.raw = Number.NaN;
          return value;
        },
      },
    });

    const first = network.evaluate({ x: 0, z: 0 });
    const second = network.evaluate({ x: 1, z: 1 });

    assert.equal(warnings.length, 1, 'invalid raw sample should only warn once');
    assert.equal(
      warnings[0][0],
      '[tfms] invalid sample raw',
      'sanitizer should log invalid raw sample warning',
    );
    assert.deepEqual(
      warnings[0][1],
      { operator: 'nan-raw-operator', index: 0 },
      'warning payload should include operator metadata',
    );

    assert.ok(Number.isFinite(first.envelope), 'envelope should be finite');
    assert.ok(
      Number.isFinite(first.tectonic),
      'tectonic accumulator should remain finite',
    );
    assert.ok(
      Number.isFinite(first.operators[0].raw),
      'operator raw output should be sanitized',
    );

    assert.ok(
      Number.isFinite(second.tectonic),
      'subsequent evaluations should remain finite',
    );
  } finally {
    console.warn = originalWarn;
  }
});
