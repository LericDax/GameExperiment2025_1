import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectNearbyFlowerPOIs } from '../environment/environment-index.js';

describe('environment-index helpers', () => {
  it('collects flower decorations as points of interest within radius', () => {
    const flowerEntries = [
      { id: 'flower-alpha', position: { x: 2, y: 0, z: 3 }, type: 'flowers' },
      { id: 'flower-beta', position: { x: 48, y: 0, z: 0 }, type: 'flowers' },
    ];
    const flowerGroup = {
      key: 'flowers-1',
      type: 'flowers',
      instanceIndices: [0, 1],
      entries: flowerEntries,
    };
    const chunkManager = {
      decorationTypeIndex: new Map([[
        'flowers',
        new Set([flowerGroup]),
      ]]),
    };

    const origin = { x: 0, y: 0, z: 0 };
    const results = collectNearbyFlowerPOIs({ chunkManager, origin, radius: 12 });

    assert.ok(Array.isArray(results), 'expected helper to return an array of POIs');
    assert.strictEqual(results.length, 1, 'expected only the nearby flower to be included');
    const [first] = results;
    assert.deepStrictEqual(first.position, flowerEntries[0].position);
    assert.strictEqual(first.id, 'flower-alpha');
    assert.strictEqual(first.type, 'flowers');
  });
});
