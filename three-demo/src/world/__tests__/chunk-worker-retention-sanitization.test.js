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
const { finalizeChunkMeshes } = await import('../finalize-chunk-meshes.js');

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
  return {
    registry,
    dispose: () => createdMaterials.forEach((mat) => mat.dispose?.()),
  };
}

test('worker retention finalize drops heavy payload structures', async () => {
  const { registry: blockMaterials, dispose } = createBlockMaterials();
  const task = generationModule.createChunkBuildTask({
    chunkX: 0,
    chunkZ: 0,
    blockMaterials,
    detailLevel: 'retention',
    requireWorkerPayload: true,
  });
  let done = false;
  while (!done) {
    done = Boolean(task.step(32)?.done);
  }
  const payload = task.exportPayloadSnapshot();
  task.releaseCachedPayload?.();

  payload.detailLevel = 'retention';

  const rawResult = finalizeChunkMeshes(payload, blockMaterials, THREE);
  const rawMeshCount = rawResult.chunkGroup?.children?.length ?? 0;

  const scene = new THREE.Scene();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 0,
    maxActivationsPerUpdate: 0,
    maxDisposalsPerUpdate: 0,
  });

  try {
    const entry = {
      chunkX: payload.chunkX,
      chunkZ: payload.chunkZ,
      detailLevel: payload.detailLevel,
      desiredDetailLevel: payload.detailLevel,
      metadata: { payload },
    };
    const chunk = manager.__finalizeWorkerChunkForTest(entry, { payload });

    assert.equal(chunk.detailLevel, 'retention');
    assert.equal(chunk.blockLookup, null, 'low-detail chunks should drop block lookup tables');

    assert.ok(chunk.typeData instanceof Map);
    chunk.typeData.forEach((record) => {
      assert.equal('entries' in record, false, 'type data should omit instanced entry arrays');
      assert.equal('allEntries' in record, false, 'type data should omit full entry caches');
      assert.ok(record.mesh, 'type data should retain instanced meshes');
    });

    assert.ok(chunk.decorationData instanceof Map);
    chunk.decorationData.forEach((record) => {
      assert.ok(Array.isArray(record.entries));
      assert.equal(record.entries.length, 0);
    });

    assert.ok(chunk.prototypeInstances instanceof Map);
    assert.ok(chunk.prototypeInstances.size > 0, 'expected prototype metadata to remain available');
    chunk.prototypeInstances.forEach((record) => {
      assert.ok(Array.isArray(record.blockEntries));
      record.blockEntries.forEach((blockEntry) => {
        assert.equal('entry' in blockEntry, false, 'prototype metadata should omit live entry references');
        assert.ok(blockEntry.entryKey, 'prototype metadata should retain entry keys');
      });
    });

    assert.equal(
      chunk.group?.children?.length ?? 0,
      rawMeshCount,
      'sanitization should preserve the number of chunk meshes',
    );
  } finally {
    await manager.dispose?.();
    dispose();
  }
});

