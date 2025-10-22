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

function overrideTypedArrayConstructors(allocationLog) {
  const entries = [
    ['Uint16Array', globalThis.Uint16Array],
    ['Int32Array', globalThis.Int32Array],
    ['Uint8Array', globalThis.Uint8Array],
  ];
  entries.forEach(([name, Original]) => {
    const Override = class extends Original {
      constructor(...args) {
        super(...args);
        allocationLog.push({
          name,
          length: this.length,
          stack: new Error().stack ?? '',
        });
      }
    };
    Object.defineProperty(Override, 'name', { value: name, configurable: true });
    Object.setPrototypeOf(Override, Original);
    globalThis[name] = Override;
  });
  return () => {
    entries.forEach(([name, Original]) => {
      globalThis[name] = Original;
    });
  };
}

test('solid interior voxels remain hidden but tracked in block lookup', () => {
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

    const interiorEntry = chunk.blockLookup.get(interiorKey);
    assert.ok(
      interiorEntry,
      'hidden interior block should still be registered in the block lookup',
    );
    assert.equal(interiorEntry.isVisible, false, 'hidden interior block should be flagged');

    const surfaceTypeRecord = chunk.typeData.get(surfaceEntry.type);
    assert.ok(surfaceTypeRecord, 'expected type data for the surface block type');
    assert.equal(
      surfaceTypeRecord.mesh.count,
      surfaceTypeRecord.entries.length,
      'instanced mesh count should match the visible entry list',
    );
    assert.ok(
      surfaceTypeRecord.entries.every((entry) => entry.isVisible !== false),
      'visible entries should never be flagged hidden',
    );

    const interiorTypeRecord = chunk.typeData.get(interiorEntry.type);
    assert.ok(interiorTypeRecord, 'hidden block type should be tracked in type data');
    assert.equal(
      interiorTypeRecord.entries.some((entry) => entry?.key === interiorKey),
      false,
      'hidden block record should not appear in the visible instancing list',
    );
    const hiddenRecord = interiorTypeRecord.allEntries?.find(
      (entry) => entry?.key === interiorKey,
    );
    assert.ok(hiddenRecord, 'allEntries should retain the hidden interior record');
    assert.strictEqual(
      hiddenRecord,
      interiorEntry,
      'block lookup should reference the retained hidden record instance',
    );
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('chunk hydration restores hidden block records in block lookup', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const task = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
    });
    task.setRequiresWorkerPayload(true);
    let done = false;
    while (!done) {
      const result = task.step(Number.POSITIVE_INFINITY);
      done = result?.done === true;
    }
    const hydratedChunk = task.finalize();

    const surfaceHeight = generationModule.terrainHeight(0, 0);
    assert.ok(Number.isFinite(surfaceHeight), 'terrain height should be finite');

    const surfaceKey = generationModule.makeBlockKey(0, surfaceHeight, 0);
    const interiorKey = generationModule.makeBlockKey(0, surfaceHeight - 1, 0);

    const surfaceEntry = hydratedChunk.blockLookup.get(surfaceKey);
    assert.ok(surfaceEntry, 'hydrated chunk should expose a visible surface entry');
    assert.equal(surfaceEntry.isVisible, true, 'hydrated surface entry should be visible');

    const interiorEntry = hydratedChunk.blockLookup.get(interiorKey);
    assert.ok(
      interiorEntry,
      'hydrated chunk should retain the hidden interior block entry in the lookup',
    );
    assert.equal(interiorEntry.isVisible, false, 'hydrated hidden entry should be flagged');

    const surfaceTypeRecord = hydratedChunk.typeData.get(surfaceEntry.type);
    assert.ok(surfaceTypeRecord, 'hydrated chunk should have type data for surface blocks');
    assert.equal(
      surfaceTypeRecord.mesh.count,
      surfaceTypeRecord.entries.length,
      'hydrated instanced mesh count should reflect visible entries only',
    );
    assert.ok(
      surfaceTypeRecord.entries.every((entry) => entry.isVisible !== false),
      'hydrated visible entries should be flagged as visible',
    );

    const interiorTypeRecord = hydratedChunk.typeData.get(interiorEntry.type);
    assert.ok(
      interiorTypeRecord,
      'hydrated chunk should include type data for the hidden interior block type',
    );
    assert.equal(
      interiorTypeRecord.entries.some((entry) => entry?.key === interiorKey),
      false,
      'hydrated hidden block record should be excluded from visible instancing',
    );
    const hydratedHiddenRecord = interiorTypeRecord.allEntries?.find(
      (entry) => entry?.key === interiorKey,
    );
    assert.ok(hydratedHiddenRecord, 'hydrated allEntries should contain the hidden record');
    assert.strictEqual(
      hydratedHiddenRecord,
      interiorEntry,
      'hydrated block lookup should share the hidden record reference',
    );
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('retention detail finalize avoids occupancy buffers', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const task = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
      detailLevel: 'retention',
      requireWorkerPayload: false,
    });

    let done = false;
    while (!done) {
      const result = task.step(Number.POSITIVE_INFINITY);
      done = result?.done === true;
    }

    const allocations = [];
    const restoreTypedArrays = overrideTypedArrayConstructors(allocations);
    let chunk;
    try {
      chunk = task.finalize();
    } finally {
      restoreTypedArrays();
    }

    assert.ok(chunk, 'finalize should return a chunk instance');
    assert.equal(
      chunk.detailLevel,
      'retention',
      'chunk detail level should reflect retention mode',
    );
    assert.equal(
      chunk.fluidSurfaces.length,
      0,
      'low-detail chunk should not construct fluid surfaces',
    );
    const fluidChild = chunk.group.children.find((child) =>
      child?.userData?.type?.startsWith?.('fluid:'),
    );
    assert.equal(
      fluidChild,
      undefined,
      'chunk group should not contain fluid surface meshes in retention mode',
    );

    const occupancyAllocations = allocations.filter((allocation) =>
      allocation.stack?.includes('ensureOccupancyArrays'),
    );
    assert.equal(
      occupancyAllocations.length,
      0,
      'retention finalize should not allocate occupancy buffers',
    );
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('retention finalize clears placement references while meshes persist', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const surfaceHeight = generationModule.terrainHeight(0, 0);
    assert.ok(Number.isFinite(surfaceHeight), 'terrain height should be finite');
    const surfaceKey = generationModule.makeBlockKey(0, surfaceHeight, 0);

    const retentionTask = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
      detailLevel: 'retention',
    });

    let done = false;
    while (!done) {
      const result = retentionTask.step(Number.POSITIVE_INFINITY);
      done = result?.done === true;
    }

    retentionTask.setRequiresWorkerPayload(true);
    retentionTask.setRequiresWorkerPayload(false);

    const retentionChunk = retentionTask.finalize();
    assert.strictEqual(
      retentionChunk.blockLookup,
      null,
      'retention chunk should not retain block lookup references when payloads are disabled',
    );
    assert.ok(retentionChunk.typeData instanceof Map, 'retention chunk should expose type data');
    let instanceTotal = 0;
    retentionChunk.typeData.forEach((record, type) => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(record, 'entries'),
        false,
        `retention type data for ${type} should omit per-entry arrays`,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(record, 'allEntries'),
        false,
        `retention type data for ${type} should omit cloned placement arrays`,
      );
      assert.ok(record.mesh?.isInstancedMesh, 'retention meshes should still render');
      instanceTotal += Number.isFinite(record.mesh?.count) ? record.mesh.count : 0;
    });
    assert.ok(instanceTotal > 0, 'retention chunk should still emit instanced geometry');

    const coreTask = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
      detailLevel: 'core',
      requireWorkerPayload: true,
    });

    done = false;
    while (!done) {
      const result = coreTask.step(Number.POSITIVE_INFINITY);
      done = result?.done === true;
    }

    const coreChunk = coreTask.finalize();
    const coreEntry = coreChunk.blockLookup.get(surfaceKey);
    assert.ok(coreEntry, 'core chunk should expose the surface placement entry');
    assert.ok(coreEntry.payload, 'core chunk should serialize placement payloads');
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});
