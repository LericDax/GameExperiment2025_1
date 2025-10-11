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

test('createChunkBuildTask completes after multiple incremental steps', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const task = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
    });

    const firstResult = task.step(1);
    assert.ok(!firstResult.done, 'a single column budget should not finish the chunk');
    assert.ok(
      (firstResult.processed ?? 0) > 0,
      'initial incremental step should process work',
    );

    let iterations = 1;
    let totalProcessed = firstResult.processed ?? 0;
    let done = firstResult.done;

    while (!done) {
      const { done: stepDone, processed } = task.step(128);
      iterations += 1;
      totalProcessed += processed ?? 0;
      if (!stepDone) {
        assert.ok(
          (processed ?? 0) > 0,
          'subsequent steps should continue to process work',
        );
      }
      done = stepDone;
    }

    assert.ok(iterations > 1, 'expected chunk build to require multiple steps');
    assert.ok(totalProcessed > 0, 'chunk build should process measurable work');

    const chunk = task.finalize();
    assert.equal(chunk.chunkX, 0);
    assert.equal(chunk.chunkZ, 0);
    assert.ok(chunk.group?.isGroup, 'finalized chunk should include a group container');

    assert.throws(() => task.finalize(), /Chunk already finalized/);
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('preload queue preserves partial tasks until forced to drain', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const createdManagers = [];
  const createdMaterials = [];

  const createManager = () => {
    const scene = new THREE.Scene();
    const materials = createBlockMaterials();
    const manager = createChunkManager({
      scene,
      blockMaterials: materials.registry,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });
    createdManagers.push(manager);
    createdMaterials.push(materials);
    return { scene, manager, materials };
  };

  const { scene, manager } = createManager();

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 0,
    maxPreload: 0,
    force: true,
  });

  assert.ok(
    scene.getObjectByName('chunk_0_0'),
    'expected origin chunk to load during forced bootstrap',
  );

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
  });

  assert.ok(
    !scene.getObjectByName('chunk_1_0'),
    'neighbor chunk should remain pending when no preload budget is available',
  );

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
    force: true,
  });

  assert.ok(
    scene.getObjectByName('chunk_1_0'),
    'forcing an update should drain pending preload tasks in the same frame',
  );

  const { scene: infiniteScene, manager: infiniteManager } = createManager();

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 0,
    maxPreload: 0,
    force: true,
  });

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
  });

  assert.ok(
    !infiniteScene.getObjectByName('chunk_1_0'),
    'chunk should stay pending before infinite budget drains it',
  );

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: Number.POSITIVE_INFINITY,
  });

  assert.ok(
    infiniteScene.getObjectByName('chunk_1_0'),
    'infinite preload budget should drain every active chunk build task immediately',
  );

  while (createdManagers.length > 0) {
    const instance = createdManagers.pop();
    const materials = createdMaterials.pop();
    try {
      instance.dispose();
    } finally {
      materials?.createdMaterials?.forEach((material) => material.dispose?.());
    }
  }
});
