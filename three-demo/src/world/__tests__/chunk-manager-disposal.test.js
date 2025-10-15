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

test('queued chunk disposal flushes when forcing updates', async () => {
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

    assert.ok(
      scene.getObjectByName('chunk_0_0'),
      'chunk scheduled for disposal should remain before the queue drains',
    );

    manager.update(farPosition, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    assert.ok(
      !scene.getObjectByName('chunk_0_0'),
      'forcing an update should flush the disposal queue',
    );
    assert.ok(
      scene.getObjectByName(farChunkName),
      'new center chunk should remain loaded after forced disposal',
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
