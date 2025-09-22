import { generateChunk, worldConfig } from './generation.js';

function chunkKey(x, z) {
  return `${x}|${z}`;
}

function worldToChunk(value) {
  const halfSize = worldConfig.chunkSize / 2;
  return Math.floor((value + halfSize) / worldConfig.chunkSize);
}

export function createChunkManager({ scene, blockMaterials, viewDistance = 1 }) {
  const loadedChunks = new Map();
  const solidBlocks = new Set();
  const waterColumns = new Set();
  let lastCenterKey = null;

  function ensureChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      return;
    }
    const chunk = generateChunk(blockMaterials, chunkX, chunkZ);
    chunk.group.children.forEach((child) => {
      if (!child.isInstancedMesh) {
        return;
      }
      const { type } = child.userData;
      if (!type) {
        return;
      }
      child.userData.chunkKey = key;
    });
    scene.add(chunk.group);
    chunk.solidBlockKeys.forEach((block) => solidBlocks.add(block));
    chunk.waterColumnKeys.forEach((column) => waterColumns.add(column));
    loadedChunks.set(key, chunk);
  }

  function disposeChunk(key) {
    const chunk = loadedChunks.get(key);
    if (!chunk) {
      return;
    }

    scene.remove(chunk.group);
    chunk.solidBlockKeys.forEach((block) => solidBlocks.delete(block));
    chunk.waterColumnKeys.forEach((column) => waterColumns.delete(column));
    loadedChunks.delete(key);
  }

  function update(position) {
    const centerChunkX = worldToChunk(position.x);
    const centerChunkZ = worldToChunk(position.z);
    const centerKey = chunkKey(centerChunkX, centerChunkZ);

    if (centerKey === lastCenterKey && loadedChunks.size > 0) {
      return;
    }

    const needed = new Set();
    for (let dx = -viewDistance; dx <= viewDistance; dx++) {
      for (let dz = -viewDistance; dz <= viewDistance; dz++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        const key = chunkKey(chunkX, chunkZ);
        needed.add(key);
        ensureChunk(chunkX, chunkZ);
      }
    }

    Array.from(loadedChunks.keys()).forEach((key) => {
      if (!needed.has(key)) {
        disposeChunk(key);
      }
    });

    lastCenterKey = centerKey;
  }

  function dispose() {
    Array.from(loadedChunks.keys()).forEach((key) => disposeChunk(key));
  }

  function getChunkForMesh(mesh) {
    if (!mesh?.isInstancedMesh) {
      return null;
    }
    const key = mesh.userData?.chunkKey;
    if (!key) {
      return null;
    }
    return loadedChunks.get(key) ?? null;
  }

  function getBlockFromIntersection(intersection) {
    if (!intersection || typeof intersection.instanceId !== 'number') {
      return null;
    }
    const mesh = intersection.object;
    if (!mesh?.isInstancedMesh) {
      return null;
    }
    const chunk = getChunkForMesh(mesh);
    if (!chunk) {
      return null;
    }
    const { type } = mesh.userData || {};
    if (!type) {
      return null;
    }
    const typeData = chunk.typeData?.get(type);
    if (!typeData) {
      return null;
    }
    const entry = typeData.entries[intersection.instanceId];
    if (!entry) {
      return null;
    }
    return {
      chunk,
      type,
      instanceId: intersection.instanceId,
      entry,
    };
  }

  function removeBlockInstance({ chunk, type, instanceId }) {
    if (!chunk || typeof instanceId !== 'number' || !chunk.typeData) {
      return null;
    }
    const typeData = chunk.typeData.get(type);
    if (!typeData) {
      return null;
    }
    const { entries, mesh } = typeData;
    if (!mesh || !mesh.isInstancedMesh) {
      return null;
    }
    if (instanceId < 0 || instanceId >= entries.length) {
      return null;
    }

    const lastIndex = entries.length - 1;
    const removed = entries[instanceId];

    if (!removed) {
      return null;
    }

    if (instanceId !== lastIndex) {
      const swapped = entries[lastIndex];
      entries[instanceId] = swapped;
      mesh.setMatrixAt(instanceId, swapped.matrix);
      if (typeof mesh.setColorAt === 'function') {
        mesh.setColorAt(instanceId, swapped.color ?? mesh.userData?.defaultColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (chunk.blockLookup) {
        const swappedInfo = chunk.blockLookup.get(swapped.key);
        if (swappedInfo) {
          swappedInfo.index = instanceId;
        }
      }
      swapped.index = instanceId;
    }

    entries.pop();
    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    if (chunk.blockLookup) {
      chunk.blockLookup.delete(removed.key);
    }
    if (removed.isSolid) {
      chunk.solidBlockKeys.delete(removed.key);
      solidBlocks.delete(removed.key);
    }
    if (removed.isWater) {
      chunk.waterColumnKeys.delete(`${removed.position.x}|${removed.position.z}`);
      waterColumns.delete(`${removed.position.x}|${removed.position.z}`);
    }

    return removed;
  }

  return {
    update,
    dispose,
    solidBlocks,
    waterColumns,
    getBlockFromIntersection,
    removeBlockInstance,
  };
}

export function chunkIndexFromWorld(x, z) {
  return {
    x: worldToChunk(x),
    z: worldToChunk(z),
  };
}
