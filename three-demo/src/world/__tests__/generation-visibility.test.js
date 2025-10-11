import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const biomeDefinition = JSON.parse(
  await readFile(new URL('../biomes/temperate.json', import.meta.url), 'utf8'),
);
globalThis.__BIOME_MODULE_MAP__ = {
  './temperate.json': biomeDefinition,
};

const voxelObjectDefinition = JSON.parse(
  await readFile(
    new URL('../voxel-objects/small-plants/temperate_shrub.json', import.meta.url),
    'utf8',
  ),
);
globalThis.__VOXEL_OBJECT_MODULE_MAP__ = {
  './small-plants/temperate_shrub.json': voxelObjectDefinition,
};

const generationModule = await import('../generation.js');
generationModule.initializeWorldGeneration({ THREE });

function createBlockMaterials() {
  const createdMaterials = new Set();
  const registry = new Proxy(
    {},
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }
        if (typeof property !== 'string') {
          return target[property];
        }
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        target[property] = material;
        createdMaterials.add(material);
        return material;
      },
    },
  );
  return { registry, createdMaterials };
}

test('solid interior voxels do not materialize instanced entries', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const chunk = generationModule.generateChunk(blockMaterials, 0, 0);
    const surfaceHeight = generationModule.terrainHeight(0, 0);
    assert.ok(Number.isFinite(surfaceHeight), 'terrain height should be finite');

    const surfaceKey = generationModule.makeBlockKey(0, surfaceHeight, 0);
    const interiorKey = generationModule.makeBlockKey(0, surfaceHeight - 1, 0);

    const surfaceEntry = chunk.blockLookup.get(surfaceKey);
    assert.ok(surfaceEntry, 'expected a visible surface entry at the sampled column');
    assert.equal(surfaceEntry.isVisible, true, 'surface entry should be marked visible');

    assert.ok(
      chunk.solidBlockKeys.has(interiorKey),
      'interior coordinate should still be tracked as a solid block',
    );
    assert.ok(
      !chunk.blockLookup.has(interiorKey),
      'hidden interior block should not materialize an instanced entry',
    );
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});
