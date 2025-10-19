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

test('pending activations upgrade via chunk job queue before activation', async () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const scene = new THREE.Scene();

  let manager;
  try {
    manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
      maxActivationsPerUpdate: 1,
    });

    const scoutTask = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
      detailLevel: 'scout',
    });
    let taskDone = false;
    while (!taskDone) {
      const result = scoutTask.step(4);
      taskDone = Boolean(result?.done);
    }
    const pendingChunk = scoutTask.finalize();
    pendingChunk.chunkX = 0;
    pendingChunk.chunkZ = 0;
    pendingChunk.detailLevel = 'scout';
    pendingChunk.desiredDetailLevel = 'scout';
    scoutTask.releaseCachedPayload?.();

    const entry = {
      key: '0|0',
      chunkX: 0,
      chunkZ: 0,
      detailLevel: 'scout',
      desiredDetailLevel: 'scout',
      pendingChunk: null,
      workerPayload: null,
      metadata: null,
      task: null,
    };
    const record = {
      key: entry.key,
      entry,
      chunk: pendingChunk,
      pendingUpgrade: null,
    };
    entry.pendingChunk = record;

    manager.__enqueuePendingActivationForTest(record);
    const processed = manager.__processPendingActivationsForTest(1);
    assert.equal(processed, 0, 'activation should defer while upgrade job pending');

    const jobSnapshot = manager.__getChunkJobQueueSnapshotForTest();
    assert.ok(
      jobSnapshot.some(
        (job) => job.kind === 'pending-upgrade' && job.key === `${entry.key}:upgrade`,
      ),
      'expected upgrade job to enqueue on chunk job queue',
    );

    assert.equal(
      manager.__getLoadedChunkForTest(entry.key),
      null,
      'chunk should remain unloaded until upgrade completes',
    );

    await manager.flush();

    const activatedChunk = manager.__getLoadedChunkForTest(entry.key);
    assert.ok(activatedChunk, 'chunk should load after upgrade finishes');
    assert.equal(activatedChunk.detailLevel, 'core');
    assert.equal(activatedChunk.desiredDetailLevel, 'core');

    const remainingKeys = manager.__getPendingActivationKeysForTest();
    assert.equal(remainingKeys.length, 0, 'pending activation queue should be empty after flush');
  } finally {
    await manager?.dispose?.();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});
