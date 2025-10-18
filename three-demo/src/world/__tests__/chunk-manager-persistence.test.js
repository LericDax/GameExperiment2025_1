import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
const VOXEL_RECT_OP_ID = 3;

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
  const loads = [];
  const saves = [];
  let disposed = false;
  return {
    enqueueLoad(request) {
      loads.push(request);
      return Promise.resolve({ snapshot: null, journalStats: { entries: 0, bytes: 0 } });
    },
    enqueueSave(request) {
      saves.push(request);
      return Promise.resolve({ ok: true });
    },
    dispose() {
      disposed = true;
    },
    __records: { loads, saves, get disposed() {
      return disposed;
    } },
  };
}

function decodeFirstVarint(data) {
  if (!(data instanceof Uint8Array)) {
    return null;
  }
  let value = 0;
  let shift = 0;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i];
    const slice = byte & 0x7f;
    value |= slice << shift;
    if ((byte & 0x80) === 0) {
      return value >>> 0;
    }
    shift += 7;
  }
  return null;
}

test('block removal records a journal entry and flushes via autosave pass', async () => {
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const queue = createStubPersistenceQueue();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 4,
    maxDisposalsPerUpdate: 0,
    maxActivationsPerUpdate: 4,
    chunkPersistenceQueue: queue,
  });

  try {
    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    assert.ok(queue.__records.loads.length >= 1, 'chunk load should query persistence queue');

    const chunk = manager.__getLoadedChunkForTest('0|0');
    assert.ok(chunk, 'expected origin chunk to be loaded');

    const stateBefore = manager.__getChunkPersistenceStateForTest('0|0');
    assert.ok(stateBefore, 'expected chunk persistence state before removal');

    const populatedTypeEntry = Array.from(chunk.typeData.entries()).find(([, info]) =>
      Array.isArray(info?.entries) && info.entries.length > 0,
    );
    assert.ok(populatedTypeEntry, 'expected at least one block type to contain entries');

    const [type] = populatedTypeEntry;
    const removed = manager.removeBlockInstance({ chunk, type, instanceId: 0 });
    assert.ok(removed, 'removeBlockInstance should return removal summary');

    await manager.__runAutosavePassForTest();
    await manager.flush();

    const journalSave = queue.__records.saves.find((entry) => entry?.type === 'journal');
    assert.ok(journalSave, 'autosave pass should persist journal payloads');
    assert.strictEqual(journalSave.chunkKey, '0|0', 'journal should target the edited chunk key');
    assert.ok(journalSave.payload instanceof Uint8Array, 'journal payload should be a byte buffer');

    const opId = decodeFirstVarint(journalSave.payload);
    assert.strictEqual(opId, VOXEL_RECT_OP_ID, 'block removal should encode as voxel rect op');

    const state = manager.__getChunkPersistenceStateForTest('0|0');
    assert.ok(state, 'chunk persistence state should remain available after autosave');
    assert.strictEqual(state.stats.entries, 1);
    assert.ok(state.stats.bytes >= journalSave.payload.byteLength);
  } catch (error) {
    throw error;
  } finally {
    await manager.dispose();
    assert.ok(queue.__records.disposed, 'disposal should tear down persistence queue');
    createdMaterials.forEach((material) => {
      material.dispose?.();
    });
  }
});

test('compaction pass stores merged snapshot when requested', async () => {
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const queue = createStubPersistenceQueue();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 2,
    maxDisposalsPerUpdate: 0,
    maxActivationsPerUpdate: 2,
    chunkPersistenceQueue: queue,
  });

  try {
    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    const state = manager.__getChunkPersistenceStateForTest('0|0');
    assert.ok(state, 'chunk should provide persistence state after load');

    const snapshotPayload = new Uint8Array([1, 2, 3, 4]);
    const marked = manager.__markChunkForCompactionForTest('0|0', snapshotPayload);
    assert.ok(marked, 'should mark chunk for compaction when snapshot is available');

    state.stats.entries = 5;
    state.stats.bytes = 99;

    await manager.__runCompactionPassForTest();

    const snapshotSave = queue.__records.saves.find((entry) => entry?.type === 'snapshot');
    assert.ok(snapshotSave, 'compaction pass should persist snapshot payloads');
    assert.strictEqual(snapshotSave.chunkKey, '0|0');
    assert.strictEqual(snapshotSave.payload, snapshotPayload);

    assert.strictEqual(state.needsCompaction, false, 'compaction should reset pending flag');
    assert.strictEqual(state.stats.entries, 0, 'compaction should reset journal entry count');
    assert.strictEqual(state.stats.bytes, 0, 'compaction should reset journal byte counter');
  } catch (error) {
    throw error;
  } finally {
    await manager.dispose();
    assert.ok(queue.__records.disposed, 'disposal should tear down persistence queue');
    createdMaterials.forEach((material) => {
      material.dispose?.();
    });
  }
});
