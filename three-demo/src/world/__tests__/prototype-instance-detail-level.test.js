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

async function buildChunk(detailLevel) {
  const { registry: blockMaterials, dispose } = createBlockMaterials();
  const task = generationModule.createChunkBuildTask({
    chunkX: 0,
    chunkZ: 0,
    blockMaterials,
    detailLevel,
  });
  let done = false;
  while (!done) {
    done = Boolean(task.step(32)?.done);
  }
  const chunk = task.finalize();
  return { chunk, dispose };
}

test('retention detail omits live prototype entries while core retains them', async () => {
  const { chunk: coreChunk, dispose: disposeCore } = await buildChunk('core');
  const { chunk: retentionChunk, dispose: disposeRetention } = await buildChunk(
    'retention',
  );

  try {
    const coreRecords = Array.from(coreChunk.prototypeInstances.values());
    assert.ok(coreRecords.length > 0, 'expected prototypes in core chunk');
    const coreEntries = coreRecords.flatMap((record) => record.blockEntries ?? []);
    const coreHasLiveEntry = coreEntries.some(
      (entry) => entry && typeof entry.entry === 'object',
    );
    assert.ok(coreHasLiveEntry, 'core detail should expose live prototype entries');

    const retentionRecords = Array.from(retentionChunk.prototypeInstances.values());
    assert.ok(
      retentionRecords.length > 0,
      'expected prototypes in retention chunk for metadata check',
    );
    const retentionEntries = retentionRecords.flatMap(
      (record) => record.blockEntries ?? [],
    );
    assert.ok(
      retentionEntries.length > 0,
      'retention chunk should expose prototype metadata records',
    );
    const retentionHasLiveEntry = retentionEntries.some(
      (entry) => entry && typeof entry.entry === 'object',
    );
    assert.equal(
      retentionHasLiveEntry,
      false,
      'retention detail should not expose live prototype entry objects',
    );
  } finally {
    disposeCore();
    disposeRetention();
  }
});
