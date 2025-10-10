import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork } from '../tfms/operators.js';

test('resolveTransfer walks string aliases in override map', () => {
  const transferCalls = [];
  const network = createTfmsNetwork({
    seed: 101,
    operators: [
      {
        id: 'alias-test',
        type: 'fbm',
        amplitude: 0,
        weight: 1,
        bias: 0,
        transfer: 'custom-alias',
      },
    ],
    modulationMatrix: [],
    transferFunctions: {
      'custom-alias': 'base-transfer',
      'base-transfer': (value, sample) => {
        transferCalls.push({ value, sample });
        return 0.25;
      },
    },
  });

  const result = network.evaluate({ x: 0, z: 0 });

  assert.equal(transferCalls.length, 1, 'alias should resolve to callable transfer');
  assert.equal(
    result.operators[0].transferred,
    0.25,
    'resolved transfer should control operator output',
  );
});
