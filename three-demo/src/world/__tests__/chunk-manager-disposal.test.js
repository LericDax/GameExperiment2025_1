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

const worldSettingsModule = await import('../world-settings.js');
const { applyWorldOptions, resetWorldOptions } = worldSettingsModule;

const { createChunkManager, chunkIndexFromWorld } = await import(
  '../chunk-manager.js'
);

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

function createStubChunk(chunkX, chunkZ) {
  const group = new THREE.Group();
  group.name = `chunk_${chunkX}_${chunkZ}`;
  return {
    chunkX,
    chunkZ,
    group,
    detailLevel: 'core',
    desiredDetailLevel: 'core',
    lastTouchedAt: 0,
    blockLookup: new Map(),
    solidBlockKeys: new Map(),
    softBlockKeys: new Map(),
    waterColumns: new Map(),
    waterColumnKeys: new Set(),
    fluidBlockKeys: new Set(),
    fluidColumnsByType: new Map(),
    fluidSurfaces: [],
    typeData: new Map(),
    decorationGroups: new Map(),
    decorationData: new Map(),
    decorationTypeIndex: new Map(),
    decorationOwnerIndex: new Map(),
    prototypeInstances: new Map(),
    typeCapacities: new Map(),
    bounds: {
      min: new THREE.Vector3(0, 0, 0),
      max: new THREE.Vector3(0, 0, 0),
    },
  };
}

test('queued chunk disposal flushes within the baseline budget', async () => {
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 1,
    maxDisposalsPerUpdate: 0,
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

    assert.ok(
      scene.getObjectByName('chunk_0_0'),
      'expected the origin chunk to load immediately',
    );

    const farPosition = new THREE.Vector3(1024, 0, 1024);
    const farChunk = chunkIndexFromWorld(farPosition.x, farPosition.z);
    const farChunkName = `chunk_${farChunk.x}_${farChunk.z}`;

    assert.notStrictEqual(
      farChunkName,
      'chunk_0_0',
      'far position should resolve to a different chunk',
    );

    manager.update(farPosition, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
    });
    await manager.flush();

    assert.ok(
      !scene.getObjectByName('chunk_0_0'),
      'chunk scheduled for disposal should retire within the baseline budget',
    );
    assert.ok(
      scene.getObjectByName(farChunkName),
      'new center chunk should remain loaded after disposal runs',
    );
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => {
      material.dispose?.();
    });
  }
});

test('chunk disposal releases instanced geometries', async () => {
  const originalDispose = THREE.BufferGeometry.prototype.dispose;
  const disposedGeometries = new Set();
  THREE.BufferGeometry.prototype.dispose = function patchedDispose(...args) {
    disposedGeometries.add(this.uuid);
    return originalDispose.apply(this, args);
  };

  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 1,
    maxDisposalsPerUpdate: 0,
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

    const chunkGroup = scene.getObjectByName('chunk_0_0');
    assert.ok(chunkGroup, 'expected the origin chunk to load immediately');

    const instancedMeshes = [];
    chunkGroup.traverse((child) => {
      if (child?.isInstancedMesh && child.geometry) {
        instancedMeshes.push(child);
      }
    });

    assert.notStrictEqual(
      instancedMeshes.length,
      0,
      'expected loaded chunk to include instanced meshes',
    );

    const instancedGeometries = instancedMeshes
      .map((mesh) => mesh.geometry)
      .filter(Boolean);

    const farPosition = new THREE.Vector3(1024, 0, 1024);
    manager.update(farPosition, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
    });

    manager.update(farPosition, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    assert.ok(
      !scene.getObjectByName('chunk_0_0'),
      'forcing an update should dispose of the loaded chunk',
    );

    instancedMeshes.forEach((mesh) => {
      assert.strictEqual(mesh.geometry, null, 'disposed meshes should lose geometry');
      assert.strictEqual(mesh.userData?.chunkKey ?? null, null);
    });

    instancedGeometries.forEach((geometry) => {
      assert.ok(
        disposedGeometries.has(geometry.uuid),
        'instanced geometries should be disposed during chunk teardown',
      );
      const tintAttribute = geometry.getAttribute
        ? geometry.getAttribute('biomeTint')
        : geometry.attributes?.biomeTint;
      assert.ok(!tintAttribute, 'biomeTint attribute should be removed from disposed geometries');
    });
  } finally {
    THREE.BufferGeometry.prototype.dispose = originalDispose;
    await manager.dispose();
    createdMaterials.forEach((material) => {
      material.dispose?.();
    });
  }
});

test('resident chunk cap evicts the oldest chunk first', async () => {
  resetWorldOptions();
  applyWorldOptions({
    budget: { residentChunks: 2, pendingBuilds: 12, meshCommits: 12 },
  });

  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 0,
    maxDisposalsPerUpdate: 0,
    maxActivationsPerUpdate: 0,
  });

  try {
    const records = [
      { chunkX: 0, chunkZ: 0 },
      { chunkX: 1, chunkZ: 0 },
      { chunkX: 2, chunkZ: 0 },
    ].map(({ chunkX, chunkZ }) => {
      const key = `${chunkX}|${chunkZ}`;
      const entry = {
        key,
        chunkX,
        chunkZ,
        detailLevel: 'core',
        desiredDetailLevel: 'core',
        resolve: () => {},
        reject: () => {},
        pendingChunk: null,
      };
      return {
        key,
        entry,
        chunk: createStubChunk(chunkX, chunkZ),
        pendingUpgrade: null,
      };
    });

    records.forEach((record) => manager.__enqueuePendingActivationForTest(record));
    manager.__processPendingActivationsForTest(Number.POSITIVE_INFINITY);

    assert.equal(
      manager.__getLoadedChunkForTest('0|0'),
      null,
      'oldest chunk should be disposed once the resident cap is exceeded',
    );
    assert.ok(
      manager.__getLoadedChunkForTest('1|0'),
      'newer chunk should remain resident after eviction runs',
    );
    assert.ok(
      manager.__getLoadedChunkForTest('2|0'),
      'newest chunk should remain resident after eviction runs',
    );

    const debug = manager.debugSnapshot?.();
    if (debug) {
      const residentBudget = debug.budgetCongestion?.resident;
      assert.ok(
        residentBudget && residentBudget.cap === 2,
        'resident congestion snapshot should expose the configured cap when available',
      );
    }
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
    resetWorldOptions();
  }
});

test('pending-build cap pauses scheduling until active jobs resolve', async () => {
  resetWorldOptions();
  applyWorldOptions({
    budget: { pendingBuilds: 1, residentChunks: 12, meshCommits: 12 },
  });

  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 2,
    maxDisposalsPerUpdate: 0,
  });

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 1,
      maxPreload: 0,
    });

    const neighborKeys = [
      '1|0',
      '-1|0',
      '0|1',
      '0|-1',
    ];

    const pendingEntries = neighborKeys
      .map((key) => manager.__getPendingEntryForTest(key))
      .filter(Boolean);

    assert.ok(
      pendingEntries.length >= 2,
      'expected multiple neighbors to queue while the pending-build cap is active',
    );

    const waitingEntries = pendingEntries.filter((entry) => entry.waitingForCapacity);
    assert.ok(
      waitingEntries.length >= 1,
      'throttle should mark extra entries as waiting for capacity',
    );

    const activeEntries = pendingEntries.filter((entry) => !entry.waitingForCapacity);
    assert.ok(
      activeEntries.length <= 1,
      'only one active job should run when pending-build cap is one',
    );

    const snapshotBefore = manager.__getChunkJobQueueSnapshotForTest();
    assert.ok(
      snapshotBefore.length <= 1,
      'chunk job queue should not admit more work while throttle is engaged',
    );

    const debug = manager.debugSnapshot?.();
    if (debug) {
      const pendingBudget = debug.budgetCongestion?.pendingBuild;
      assert.ok(
        pendingBudget && pendingBudget.count >= 1 && pendingBudget.cap === 1,
        'pending-build congestion snapshot should reflect the enforced limit',
      );
    }

    await manager.flush();

    neighborKeys.forEach((key) => {
      assert.equal(
        manager.__getPendingEntryForTest(key),
        null,
        `pending entry ${key} should resolve after flushing the backlog`,
      );
      const chunkName = `chunk_${key.replace('|', '_')}`;
      assert.ok(
        scene.getObjectByName(chunkName),
        `chunk ${chunkName} should load once capacity frees up`,
      );
    });
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
    resetWorldOptions();
  }
});

test('mesh-commit cap defers pending activations until capacity frees up', async () => {
  resetWorldOptions();
  applyWorldOptions({
    budget: { meshCommits: 2, residentChunks: 12, pendingBuilds: 12 },
  });

  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 0,
    maxActivationsPerUpdate: 0,
  });

  try {
    const records = [];
    for (let i = 0; i < 4; i += 1) {
      const chunkX = i;
      const chunkZ = 10 + i;
      const key = `${chunkX}|${chunkZ}`;
      const entry = {
        key,
        chunkX,
        chunkZ,
        detailLevel: 'core',
        desiredDetailLevel: 'core',
        resolve: () => {},
        reject: () => {},
        pendingChunk: null,
      };
      const record = {
        key,
        entry,
        chunk: null,
        pendingUpgrade: null,
      };
      records.push(record);
      manager.__enqueuePendingActivationForTest(record);
    }

    records.slice(0, 2).forEach((record, index) => {
      assert.equal(
        record.waitingForActivation,
        false,
        `record ${index} should acquire immediate activation capacity`,
      );
    });
    records.slice(2).forEach((record, index) => {
      assert.equal(
        record.waitingForActivation,
        true,
        `record ${index + 2} should wait for capacity once the mesh-commit cap is reached`,
      );
    });

    manager.__processPendingActivationsForTest(2);
    manager.__processPendingActivationsForTest(Number.POSITIVE_INFINITY);

    assert.deepStrictEqual(
      manager.__getPendingActivationKeysForTest(),
      [],
      'pending activation queue should be empty after draining',
    );

    records.forEach((record, index) => {
      assert.equal(
        record.waitingForActivation,
        false,
        `record ${index} should clear the waiting flag once processing catches up`,
      );
    });

    const debug = manager.debugSnapshot?.();
    if (debug) {
      const activationBudget = debug.budgetCongestion?.activation;
      assert.ok(
        activationBudget && activationBudget.cap === 2,
        'activation congestion snapshot should expose mesh-commit cap details',
      );
    }
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
    resetWorldOptions();
  }
});
