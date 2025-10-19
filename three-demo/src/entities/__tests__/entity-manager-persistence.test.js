import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const previousBiomeModuleMap = globalThis.__BIOME_MODULE_MAP__;
const previousVoxelModuleMap = globalThis.__VOXEL_OBJECT_MODULE_MAP__;

globalThis.__BIOME_MODULE_MAP__ = {};
globalThis.__VOXEL_OBJECT_MODULE_MAP__ = {};

test.after(() => {
  if (previousBiomeModuleMap === undefined) {
    delete globalThis.__BIOME_MODULE_MAP__;
  } else {
    globalThis.__BIOME_MODULE_MAP__ = previousBiomeModuleMap;
  }

  if (previousVoxelModuleMap === undefined) {
    delete globalThis.__VOXEL_OBJECT_MODULE_MAP__;
  } else {
    globalThis.__VOXEL_OBJECT_MODULE_MAP__ = previousVoxelModuleMap;
  }
});

const { createEntityManager } = await import('../entity-manager.js');

function createChunkManagerStub() {
  const placements = [];
  const removals = [];
  return {
    placements,
    removals,
    recordEntityPlacement(payload) {
      placements.push(payload);
      return true;
    },
    recordEntityRemoval(payload) {
      removals.push(payload);
      return true;
    },
  };
}

function registerSimpleEntity(manager, typeId) {
  manager.registerEntityType({
    id: typeId,
    create: () => {
      const root = new THREE.Object3D();
      return {
        root,
        setPosition(position) {
          root.position.copy(position);
        },
      };
    },
  });
}

test('persistent entities notify the chunk manager on spawn and despawn', () => {
  const chunkManager = createChunkManagerStub();
  const scene = new THREE.Scene();
  const manager = createEntityManager({
    scene,
    THREE,
    chunkManager,
    autoRegister: false,
  });

  const typeId = 'persistent-test-entity';
  registerSimpleEntity(manager, typeId);

  const position = new THREE.Vector3(2, 3, 4);
  const persistenceMeta = { lootTable: 'alpha' };
  const entity = manager.spawnEntity(typeId, {
    position,
    persist: true,
    persistenceMeta,
  });

  assert.equal(chunkManager.placements.length, 1, 'placement should be recorded once');
  const [placement] = chunkManager.placements;

  assert.equal(placement.id, entity.id);
  assert.equal(placement.typeId, typeId);
  assert.equal(placement.transform.length, 16, 'transform should contain 16 elements');

  entity.root.updateMatrixWorld();
  const expectedTransform = entity.root.matrixWorld.toArray(new Float32Array(16));
  assert.deepEqual(
    Array.from(placement.transform),
    Array.from(expectedTransform),
    'recorded transform should match the entity world matrix',
  );
  assert.deepEqual(placement.meta, persistenceMeta, 'persistence metadata should be forwarded');

  manager.despawnEntity(entity.id);
  assert.equal(chunkManager.removals.length, 1, 'removal should be recorded once');
  assert.deepEqual(chunkManager.removals[0], { id: entity.id });
});

test('non-persistent entities do not interact with the chunk manager', () => {
  const chunkManager = createChunkManagerStub();
  const scene = new THREE.Scene();
  const manager = createEntityManager({
    scene,
    THREE,
    chunkManager,
    autoRegister: false,
  });

  const typeId = 'non-persistent-test-entity';
  registerSimpleEntity(manager, typeId);

  const entity = manager.spawnEntity(typeId, {
    position: new THREE.Vector3(1, 2, 3),
    persist: false,
  });

  assert.equal(chunkManager.placements.length, 0, 'no placement should be recorded');
  assert.equal(chunkManager.removals.length, 0, 'no removal should be recorded');

  manager.despawnEntity(entity.id);
  assert.equal(chunkManager.placements.length, 0, 'placement should remain untouched');
  assert.equal(chunkManager.removals.length, 0, 'removal should remain untouched');
});
