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

function createStubPersistenceQueue() {
  return {
    enqueueLoad() {
      return Promise.resolve(null);
    },
    enqueueSave() {
      return Promise.resolve(null);
    },
    dispose() {},
  };
}

function cloneTransform(transform) {
  if (transform instanceof Float32Array || Array.isArray(transform)) {
    return Array.from(transform);
  }
  return [];
}

function cloneEntityRecord(record) {
  if (!record) {
    return { id: '', typeId: '', transform: [], meta: null };
  }
  return {
    id: String(record.id ?? ''),
    typeId: String(record.typeId ?? ''),
    transform: cloneTransform(record.transform),
    meta:
      record.meta && typeof record.meta === 'object'
        ? JSON.parse(JSON.stringify(record.meta))
        : record.meta ?? null,
  };
}

function createStubEntityStore() {
  const loads = [];
  const appends = [];
  const compactions = [];
  const removals = [];
  const statsByKey = new Map();
  let nextAppendStats = null;

  return {
    loadChunkEntities({ cx, cz }) {
      const key = `${cx}|${cz}`;
      loads.push({ key, cx, cz });
      const stats = statsByKey.get(key) ?? { entries: 0, bytes: 0 };
      return { snapshot: [], stats };
    },
    async appendEntityDeltas({ key, deltas }) {
      const normalizedDeltas = Array.isArray(deltas)
        ? deltas
            .map((delta) => {
              if (!delta) {
                return null;
              }
              if (delta.kind === 'place') {
                return {
                  kind: 'place',
                  record: cloneEntityRecord(delta.record),
                };
              }
              if (delta.kind === 'remove') {
                return { kind: 'remove', id: String(delta.id ?? '') };
              }
              return delta;
            })
            .filter(Boolean)
        : [];
      const previous = statsByKey.get(key) ?? { entries: 0, bytes: 0 };
      const result = nextAppendStats
        ? {
            entries: Math.max(0, Math.floor(nextAppendStats.entries ?? 0)),
            bytes: Math.max(0, Math.floor(nextAppendStats.bytes ?? 0)),
          }
        : {
            entries: previous.entries + normalizedDeltas.length,
            bytes: previous.bytes + normalizedDeltas.length * 16,
          };
      nextAppendStats = null;
      statsByKey.set(key, result);
      appends.push({ key, deltas: normalizedDeltas, stats: result });
      return result;
    },
    async compactChunkEntities({ key, records, deltas }) {
      const normalizedRecords = Array.isArray(records)
        ? records.map((record) => cloneEntityRecord(record))
        : [];
      const normalizedDeltas = Array.isArray(deltas)
        ? deltas.map((delta) => ({ ...delta }))
        : [];
      compactions.push({ key, records: normalizedRecords, deltas: normalizedDeltas });
      statsByKey.set(key, { entries: 0, bytes: 0 });
      return { entries: 0, bytes: 0 };
    },
    async removeChunkEntities({ key }) {
      removals.push({ key });
      statsByKey.delete(key);
      return { ok: true };
    },
    __records: {
      loads,
      appends,
      compactions,
      removals,
      statsByKey,
    },
    __setNextAppendStats(stats) {
      nextAppendStats = {
        entries: Math.max(0, Math.floor(stats?.entries ?? 0)),
        bytes: Math.max(0, Math.floor(stats?.bytes ?? 0)),
      };
    },
  };
}

test('entity persistence integration flushes, compacts, and disposes correctly', async () => {
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const persistenceQueue = createStubPersistenceQueue();
  const entityStore = createStubEntityStore();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 4,
    maxDisposalsPerUpdate: 0,
    maxActivationsPerUpdate: 4,
    chunkPersistenceQueue: persistenceQueue,
    entityStore,
    entityAutosaveIntervalMs: 1_000_000,
  });

  const origin = new THREE.Vector3(0, 0, 0);
  let disposed = false;

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    assert.ok(
      manager.__getLoadedChunkForTest('0|0'),
      'expected origin chunk to be available after bootstrap',
    );
    assert.ok(entityStore.__records.loads.length >= 1, 'entity store should load chunk state');

    const transform = new Float32Array(16);
    transform[0] = 1;
    transform[5] = 1;
    transform[10] = 1;
    transform[15] = 1;

    entityStore.__setNextAppendStats({ entries: 4096, bytes: 256 * 1024 });

    assert.equal(
      manager.recordEntityPlacement({
        id: 'entity-1',
        typeId: 'test-entity',
        transform,
        meta: { foo: 'bar' },
      }),
      true,
      'placement should be recorded',
    );
    assert.equal(
      manager.recordEntityRemoval({ id: 'entity-1' }),
      true,
      'removal should succeed for placed entity',
    );

    await manager.__runEntityAutosavePassForTest();

    assert.equal(entityStore.__records.appends.length, 1);
    const firstAppend = entityStore.__records.appends[0];
    assert.equal(firstAppend.key, '0|0');
    assert.deepEqual(
      firstAppend.deltas.map((delta) => delta.kind),
      ['place', 'remove'],
      'autosave should persist placement and removal deltas',
    );
    const placedRecord = firstAppend.deltas[0].record;
    assert.equal(placedRecord.id, 'entity-1');
    assert.equal(placedRecord.typeId, 'test-entity');
    assert.equal(placedRecord.meta.foo, 'bar');
    assert.equal(placedRecord.transform[12], 0);
    assert.equal(placedRecord.transform[14], 0);

    const stateAfterAutosave = manager.__getChunkEntityStateForTest('0|0');
    assert.ok(stateAfterAutosave, 'chunk entity state should exist after autosave');
    assert.equal(stateAfterAutosave.needsCompaction, true);

    await manager.__runEntityCompactionPassForTest();

    assert.equal(entityStore.__records.compactions.length, 1);
    const compaction = entityStore.__records.compactions[0];
    assert.equal(compaction.key, '0|0');
    assert.equal(compaction.records.length, 0, 'compaction should run with no live records');

    const stateAfterCompaction = manager.__getChunkEntityStateForTest('0|0');
    assert.ok(stateAfterCompaction, 'state should remain after compaction');
    assert.equal(stateAfterCompaction.needsCompaction, false);
    assert.deepEqual(stateAfterCompaction.stats, { entries: 0, bytes: 0 });

    const secondTransform = new Float32Array(transform);
    secondTransform[12] = 1;

    assert.equal(
      manager.recordEntityPlacement({
        id: 'entity-2',
        typeId: 'test-entity',
        transform: secondTransform,
        meta: null,
      }),
      true,
      'second placement should mark chunk dirty again',
    );

    assert.equal(entityStore.__records.appends.length, 1);

    await manager.dispose();
    disposed = true;

    assert.equal(
      entityStore.__records.appends.length,
      2,
      'dispose should flush pending entity deltas',
    );
    const finalAppend = entityStore.__records.appends[1];
    assert.equal(finalAppend.key, '0|0');
    assert.deepEqual(finalAppend.deltas.map((delta) => delta.kind), ['place']);
    assert.equal(finalAppend.deltas[0].record.id, 'entity-2');

    assert.equal(entityStore.__records.removals.length, 1);
    assert.equal(entityStore.__records.removals[0].key, '0|0');
  } finally {
    if (!disposed) {
      await manager.dispose();
    }
    createdMaterials.forEach((material) => {
      material.dispose?.();
    });
  }
});
