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

const fluidRegistryModule = await import('../fluids/fluid-registry.js');
fluidRegistryModule.initializeFluidRegistry({ THREE });

const { createChunkManager } = await import('../chunk-manager.js');
const worldOptions = generationModule.getWorldOptions();

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

test('chunk payload cache enforces capacity and strips voxel buffers', async () => {
  const scene = new THREE.Scene();
  const origin = new THREE.Vector3(0, 0, 0);
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 4,
    maxDisposalsPerUpdate: 0,
    maxActivationsPerUpdate: 4,
    payloadCacheSize: 2,
  });

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    const chunkSize = Number.isFinite(worldOptions?.chunkSize)
      ? worldOptions.chunkSize
      : 16;
    const positions = [
      new THREE.Vector3(chunkSize, 0, 0),
      new THREE.Vector3(chunkSize * 2, 0, 0),
    ];

    for (const position of positions) {
      manager.update(position, {
        viewDistance: 0,
        retainDistance: 0,
        maxPreload: 0,
        force: true,
      });
      await manager.flush();
    }

    const cacheSnapshot = manager.__getPayloadCacheSnapshotForTest();
    assert.ok(Array.isArray(cacheSnapshot), 'cache snapshot should be materialized as an array');
    assert.ok(cacheSnapshot.length > 0, 'expected cache to retain at least one entry');
    assert.ok(cacheSnapshot.length <= 2, 'cache should not exceed configured capacity');
    assert.ok(
      cacheSnapshot.some((entry) => entry?.key === '2|0'),
      'newly cached chunks should be present in the payload cache',
    );

    cacheSnapshot.forEach((entry) => {
      assert.ok(entry.key, 'cache entry should include a chunk key');
      assert.ok(entry.payload, 'cache entry should include a payload');
      assert.strictEqual(
        entry.payload.blockPlacements,
        null,
        'cached payload should not retain block placement buffers',
      );

      const occupancy = entry.payload.occupancy ?? {};
      assert.strictEqual(
        occupancy.types,
        undefined,
        'cached occupancy should omit type buffers',
      );
      assert.strictEqual(
        occupancy.placements,
        undefined,
        'cached occupancy should omit placement buffers',
      );
      assert.strictEqual(
        occupancy.fluid,
        undefined,
        'cached occupancy should omit fluid occupancy buffers',
      );

      Object.values(occupancy).forEach((value) => {
        if (value && typeof value === 'object') {
          assert.ok(!ArrayBuffer.isView(value), 'cached occupancy metadata should be lightweight');
        }
      });
    });
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});
