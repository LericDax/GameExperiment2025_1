import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork } from '../tfms/operators.js';

test('createTfmsNetwork sanitizes invalid transfer outputs', () => {
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => {
    logs.push(args);
  };

  try {
    const network = createTfmsNetwork({
      operators: [
        {
          id: 'invalid-operator',
          type: 'fbm',
          amplitude: 4,
          frequency: 2,
          weight: 7,
          bias: 3,
          transfer: 'broken',
        },
      ],
      modulationMatrix: [
        {
          source: 0,
          target: 0,
          routing: 'amplitude',
          gain: Number.POSITIVE_INFINITY,
        },
      ],
      transferFunctions: {
        broken: () => Number.NaN,
      },
    });

    const first = network.evaluate({ x: 0, z: 0 });
    const second = network.evaluate({ x: 1, z: 1 });

    assert.equal(
      first.envelope,
      3,
      'invalid transfer output should fall back to operator bias',
    );
    assert.equal(
      first.rawEnvelope,
      3,
      'raw envelope should mirror sanitized envelope when falling back to bias',
    );
    assert.equal(
      first.operators[0].value,
      3,
      'weighted operator value should be clamped to the bias',
    );
    assert.equal(
      first.operators[0].transferred,
      0,
      'invalid transfer outputs should be zeroed before weighting',
    );
    assert.equal(
      first.operators[0].amplitude,
      4,
      'non-finite modulation should be ignored when computing amplitude',
    );
    assert.equal(
      second.operators[0].value,
      3,
      'subsequent evaluations should keep using sanitized state',
    );
    assert.equal(logs.length, 1, 'invalid transfer should only be logged once');
    assert.equal(
      logs[0][0],
      '[tfms] invalid transfer output',
      'log should label invalid transfer outputs',
    );
    assert.deepEqual(
      logs[0][1],
      { operator: 'invalid-operator', index: 0 },
      'log payload should include operator identifier',
    );
  } finally {
    console.warn = originalWarn;
  }
});
