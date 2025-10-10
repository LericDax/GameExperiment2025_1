import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork } from '../tfms/operators.js';

test('resolveTransfer unwraps object identifiers', () => {
  const network = createTfmsNetwork({
    seed: 202,
    operators: [
      {
        id: 'object-transfer',
        type: 'fbm',
        amplitude: 0,
        weight: 1,
        bias: 0,
        transfer: { id: 'smoothstep' },
      },
    ],
    modulationMatrix: [],
  });

  const result = network.evaluate({ x: 0, z: 0 });
  const operatorResult = result.operators[0];

  assert.equal(
    typeof operatorResult.transferred,
    'number',
    'resolved transfer should be callable',
  );
  assert.equal(
    operatorResult.transferred,
    0.5,
    'smoothstep transfer should clamp zero input to midpoint',
  );
});
