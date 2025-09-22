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

  return {
    update,
    dispose,
    solidBlocks,
    waterColumns,
  };
}

export function chunkIndexFromWorld(x, z) {
  return {
    x: worldToChunk(x),
    z: worldToChunk(z),
  };
}
