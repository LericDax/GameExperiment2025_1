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

test('retention detail chunk payload omits occupancy data', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const task = generationModule.createChunkBuildTask({
    chunkX: 0,
    chunkZ: 0,
    blockMaterials,
    detailLevel: 'retention',
    requireWorkerPayload: true,
  });

  try {
    let done = false;
    while (!done) {
      const result = task.step(64);
      if (!result) {
        break;
      }
      done = result.done === true;
    }

    const payload = task.exportPayloadSnapshot();
    assert.ok(payload, 'retention payload should be produced');
    assert.ok(!('occupancy' in payload) || payload.occupancy == null);
  } finally {
    task.releaseCachedPayload({ cancel: true });
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('retention worker payload finalization skips caching while core detail caches', async () => {
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 1,
    maxPreloadPerUpdate: 1,
    maxActivationsPerUpdate: 1,
    payloadCacheSize: 4,
  });

  try {
    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 1,
      maxPreload: 0,
      force: true,
    });

    const buildRetentionPayload = () => {
      const task = generationModule.createChunkBuildTask({
        chunkX: 1,
        chunkZ: 0,
        blockMaterials,
        detailLevel: 'retention',
        requireWorkerPayload: true,
      });
      let done = false;
      while (!done) {
        const result = task.step(Number.POSITIVE_INFINITY);
        done = result?.done === true;
      }
      const payload = task.exportPayloadSnapshot();
      task.releaseCachedPayload?.();
      payload.detailLevel = 'retention';
      return payload;
    };

    const retentionPayload = buildRetentionPayload();
    const retentionEntry = {
      key: '1|0',
      chunkX: 1,
      chunkZ: 0,
      detailLevel: 'retention',
      desiredDetailLevel: 'retention',
      workerPayload: { payload: retentionPayload },
      metadata: { mode: 'worker', inflight: false, payload: retentionPayload },
      waitingForCapacity: false,
      pendingBudget: 0,
      unlimited: false,
      active: false,
      awaitingPersistenceScheduling: false,
      pendingChunk: null,
      persistenceResult: null,
      resolve: null,
      reject: null,
      promise: null,
    };

    let resolvedRetentionChunk = null;
    retentionEntry.resolve = (chunk) => {
      resolvedRetentionChunk = chunk;
    };

    manager.__finalizePendingEntryForTest(retentionEntry);

    assert.ok(
      resolvedRetentionChunk,
      'retention chunk should resolve during finalization',
    );
    assert.equal(
      resolvedRetentionChunk?.__cachePayload ?? null,
      null,
      'retention detail chunks should not retain cache payload snapshots',
    );

    let cacheSnapshot = manager.__getPayloadCacheSnapshotForTest();
    assert.equal(
      cacheSnapshot.length,
      0,
      'payload cache should remain empty after retention finalization',
    );

    manager.__processPendingActivationsForTest(Number.POSITIVE_INFINITY);
    cacheSnapshot = manager.__getPayloadCacheSnapshotForTest();
    assert.equal(
      cacheSnapshot.length,
      0,
      'payload cache should ignore retention chunks when activated',
    );

    const buildCorePayload = () => {
      const task = generationModule.createChunkBuildTask({
        chunkX: 0,
        chunkZ: 0,
        blockMaterials,
        detailLevel: 'core',
        requireWorkerPayload: true,
      });
      let done = false;
      while (!done) {
        const result = task.step(Number.POSITIVE_INFINITY);
        done = result?.done === true;
      }
      const payload = task.exportPayloadSnapshot();
      task.releaseCachedPayload?.();
      payload.detailLevel = 'core';
      return payload;
    };

    const corePayload = buildCorePayload();
    const coreEntry = {
      key: '0|0',
      chunkX: 0,
      chunkZ: 0,
      detailLevel: 'core',
      desiredDetailLevel: 'core',
      workerPayload: { payload: corePayload },
      metadata: { mode: 'worker', inflight: false, payload: corePayload },
      waitingForCapacity: false,
      pendingBudget: 0,
      unlimited: false,
      active: false,
      awaitingPersistenceScheduling: false,
      pendingChunk: null,
      persistenceResult: null,
      resolve: null,
      reject: null,
      promise: null,
    };

    let resolvedCoreChunk = null;
    coreEntry.resolve = (chunk) => {
      resolvedCoreChunk = chunk;
    };

    manager.__finalizePendingEntryForTest(coreEntry);

    assert.ok(resolvedCoreChunk, 'core chunk should resolve during finalization');

    cacheSnapshot = manager.__getPayloadCacheSnapshotForTest();
    assert.ok(
      cacheSnapshot.some((entry) => entry?.key === coreEntry.key),
      'core chunks should populate the payload cache',
    );
    assert.equal(
      cacheSnapshot.every((entry) => entry?.detailLevel === 'core'),
      true,
      'cached payload entries should report core detail level',
    );
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

