import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { initializeWorldGeneration, generateChunk } from '../generation.js';
import * as placement from '../voxel-object-placement.js';

const makeCoordinateKey = (x, y, z) => `${Math.round(x)}|${Math.round(y)}|${Math.round(z)}`;

test('cryoshard structures remain non-occluding when meshed into chunks', async (t) => {
  initializeWorldGeneration({ THREE });

  const target = { x: 0, z: 0 };
  const placements = [];

  placement.__setTestPlacementHook(({ addBlock, groundHeight, biome, worldX, worldZ }) => {
    if (worldX !== target.x || worldZ !== target.z) {
      return;
    }

    const cryoshardY = groundHeight + 1;
    const stoneY = cryoshardY;
    const cryoshardKey = makeCoordinateKey(worldX, cryoshardY, worldZ);
    const stoneKey = makeCoordinateKey(worldX + 1, stoneY, worldZ);

    placements.push({
      cryoshard: { key: cryoshardKey, position: { x: worldX, y: cryoshardY, z: worldZ } },
      stone: { key: stoneKey, position: { x: worldX + 1, y: stoneY, z: worldZ } },
    });

    addBlock('cryoshard_glass', worldX, cryoshardY, worldZ, biome, {
      collisionMode: 'soft',
    });
    addBlock('stone', worldX + 1, stoneY, worldZ, biome, {
      collisionMode: 'solid',
    });
  });

  try {
    const blockMaterials = {
      cryoshard_glass: {
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      },
      stone: {
        transparent: false,
        opacity: 1,
        depthWrite: true,
      },
    };

    const chunk = generateChunk(blockMaterials, 0, 0);

    assert.ok(chunk, 'expected chunk generation to succeed');
    assert.ok(placements.length > 0, 'expected test placement hook to fire');

    const { cryoshard, stone } = placements[0];

    const cryoshardEntry = chunk.blockLookup.get(cryoshard.key);
    assert.ok(cryoshardEntry, 'cryoshard entry should be present in block lookup');

    const stoneEntry = chunk.blockLookup.get(stone.key);
    assert.ok(stoneEntry, 'stone entry should be present in block lookup');

    assert.equal(
      chunk.solidBlockKeys.has(cryoshard.key),
      false,
      'cryoshard coordinate should not be marked as a solid block',
    );
    assert.equal(
      chunk.solidBlockKeys.has(stone.key),
      true,
      'stone coordinate should remain marked as solid',
    );

    const cryoshardInstances = chunk.typeData.get('cryoshard_glass')?.entries ?? [];
    const stoneInstances = chunk.typeData.get('stone')?.entries ?? [];

    assert.ok(
      cryoshardInstances.some((entry) => entry.coordinateKey === cryoshard.key),
      'cryoshard instance should remain in instanced mesh data',
    );
    assert.ok(
      stoneInstances.some((entry) => entry.coordinateKey === stone.key),
      'stone instance behind cryoshard should remain instanced',
    );

    assert.equal(
      cryoshardEntry.isOccluding,
      false,
      'cryoshard entry should be marked as non-occluding after meshing',
    );
  } finally {
    placement.__setTestPlacementHook(null);
  }
});
