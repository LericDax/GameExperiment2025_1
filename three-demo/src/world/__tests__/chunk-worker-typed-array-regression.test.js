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
  return {
    registry,
    dispose: () => createdMaterials.forEach((material) => material.dispose?.()),
  };
}

function findPayloadWithTransform(records) {
  if (!Array.isArray(records)) {
    return null;
  }
  for (const record of records) {
    const entryPayloads = Array.isArray(record?.entryPayloads)
      ? record.entryPayloads
      : [];
    for (const entry of entryPayloads) {
      if (entry?.matrix && entry?.position) {
        return entry;
      }
    }
  }
  return null;
}

test('retention worker payload keeps typed arrays while lean cache snapshot is plain arrays', async () => {
  const { registry: blockMaterials, dispose } = createBlockMaterials();

  try {
    const candidateChunks = [];
    const searchRange = 3;
    for (let x = -searchRange; x <= searchRange; x += 1) {
      for (let z = -searchRange; z <= searchRange; z += 1) {
        candidateChunks.push({ chunkX: x, chunkZ: z });
      }
    }

    let retentionTask = null;
    let retentionPayload = null;
    let typedEntry = null;
    let targetChunk = null;

    for (const coords of candidateChunks) {
      const task = generationModule.createChunkBuildTask({
        chunkX: coords.chunkX,
        chunkZ: coords.chunkZ,
        blockMaterials,
        detailLevel: 'core',
        requireWorkerPayload: true,
      });

      let done = false;
      while (!done) {
        done = Boolean(task.step(32)?.done);
      }

      const payload = task.exportPayloadSnapshot();
      const entry = findPayloadWithTransform(payload?.typeMetadata);
      if (entry) {
        payload.detailLevel = 'retention';
        retentionTask = task;
        retentionPayload = payload;
        typedEntry = entry;
        targetChunk = coords;
        break;
      }

      task.releaseCachedPayload?.();
    }

    assert.ok(typedEntry, 'expected to find retention payload with instanced metadata');
    assert.ok(targetChunk, 'target chunk coordinates should be resolved');
    assert.ok(ArrayBuffer.isView(typedEntry.matrix), 'matrix should remain a typed array');
    assert.ok(typedEntry.matrix instanceof Float32Array, 'matrix should be Float32Array');
    assert.ok(!Array.isArray(typedEntry.matrix));
    assert.ok(ArrayBuffer.isView(typedEntry.position), 'position should remain a typed array');
    assert.ok(typedEntry.position instanceof Float32Array, 'position should be Float32Array');
    assert.ok(!Array.isArray(typedEntry.position));

    const scene = new THREE.Scene();
    const manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 4,
      maxActivationsPerUpdate: 4,
      maxDisposalsPerUpdate: 0,
      payloadCacheSize: 4,
    });

    try {
      const leanPayload = manager.__createLeanCachePayloadForTest?.(retentionPayload);
      assert.ok(leanPayload, 'expected lean cache payload to be produced');
      const leanEntry = findPayloadWithTransform(leanPayload.typeMetadata);
      assert.ok(leanEntry, 'expected lean payload to retain instanced metadata');
      assert.ok(Array.isArray(leanEntry.matrix));
      assert.ok(!ArrayBuffer.isView(leanEntry.matrix));
      assert.deepStrictEqual(leanEntry.matrix, Array.from(typedEntry.matrix));
      assert.ok(Array.isArray(leanEntry.position));
      assert.ok(!ArrayBuffer.isView(leanEntry.position));
      assert.deepStrictEqual(leanEntry.position, Array.from(typedEntry.position));
    } finally {
      await manager.dispose();
    }

    retentionTask?.releaseCachedPayload?.();
  } finally {
    dispose();
  }
});
