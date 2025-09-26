import { generateChunk, worldConfig } from './generation.js';
import { disposeFluidSurface } from './fluids/fluid-registry.js';

function chunkKey(x, z) {
  return `${x}|${z}`;
}

function worldToChunk(value) {
  const halfSize = worldConfig.chunkSize / 2;
  return Math.floor((value + halfSize) / worldConfig.chunkSize);
}

function normalizeDistance(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(fallback ?? 0));
  }
  return Math.max(0, Math.floor(numeric));
}

export function createChunkManager({
  scene,
  blockMaterials,
  viewDistance = 1,
  retainDistance: initialRetainDistance,
}) {
  const loadedChunks = new Map();
  const solidBlocks = new Set();
  const softBlocks = new Set();
  const waterColumns = new Set();
  const isDevBuild = Boolean(import.meta.env && import.meta.env.DEV);
  let lastCenterKey = null;
  let lastEffectiveRadius = 0;
  let currentViewDistance = normalizeDistance(viewDistance, 1);
  let retentionDistance = Math.max(
    currentViewDistance,
    normalizeDistance(initialRetainDistance, currentViewDistance)
  );

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
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.userData = surface.userData || {};
      surface.userData.chunkKey = key;
    });
    scene.add(chunk.group);
    (chunk.solidBlockKeys ?? []).forEach((block) => solidBlocks.add(block));
    (chunk.softBlockKeys ?? []).forEach((block) => softBlocks.add(block));
    (chunk.waterColumnKeys ?? []).forEach((column) => waterColumns.add(column));
    loadedChunks.set(key, chunk);
  }

  function disposeChunk(key) {
    const chunk = loadedChunks.get(key);
    if (!chunk) {
      return;
    }

    scene.remove(chunk.group);
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.geometry?.dispose?.();
      disposeFluidSurface(surface);
    });
    (chunk.solidBlockKeys ?? []).forEach((block) => solidBlocks.delete(block));
    (chunk.softBlockKeys ?? []).forEach((block) => softBlocks.delete(block));
    (chunk.waterColumnKeys ?? []).forEach((column) => waterColumns.delete(column));
    loadedChunks.delete(key);
  }

  function update(position, options = {}) {
    const { loadRadius, skipUnload = false, force = false } = options ?? {};
    const centerChunkX = worldToChunk(position.x);
    const centerChunkZ = worldToChunk(position.z);
    const centerKey = chunkKey(centerChunkX, centerChunkZ);

    const desiredRadius = Math.max(
      retentionDistance,
      currentViewDistance,
      normalizeDistance(loadRadius, 0)
    );

    if (
      centerKey === lastCenterKey &&
      loadedChunks.size > 0 &&
      desiredRadius <= lastEffectiveRadius &&
      !force
    ) {
      return;
    }

    for (let dx = -desiredRadius; dx <= desiredRadius; dx++) {
      for (let dz = -desiredRadius; dz <= desiredRadius; dz++) {
        const chunkX = centerChunkX + dx;
        const chunkZ = centerChunkZ + dz;
        ensureChunk(chunkX, chunkZ);
      }
    }

    if (!skipUnload) {
      const unloadRadius = retentionDistance;
      loadedChunks.forEach((chunk, key) => {
        const chunkX =
          typeof chunk?.chunkX === 'number'
            ? chunk.chunkX
            : Number.parseInt(key.split('|')[0], 10);
        const chunkZ =
          typeof chunk?.chunkZ === 'number'
            ? chunk.chunkZ
            : Number.parseInt(key.split('|')[1], 10);
        const distanceX = Math.abs(chunkX - centerChunkX);
        const distanceZ = Math.abs(chunkZ - centerChunkZ);
        if (distanceX > unloadRadius || distanceZ > unloadRadius) {
          disposeChunk(key);
        }
      });
    }

    lastCenterKey = centerKey;
    lastEffectiveRadius = desiredRadius;
  }

  function dispose() {
    Array.from(loadedChunks.keys()).forEach((key) => disposeChunk(key));
  }

  function computeMaterialVisibility(material) {
    if (!material) {
      return true;
    }
    if (Array.isArray(material)) {
      return material.some((entry) => entry?.visible !== false);
    }
    return material.visible !== false;
  }

  const debugSnapshot = !isDevBuild
    ? undefined
    : () => {
        const chunks = [];
        let totalBlocks = 0;

        loadedChunks.forEach((chunk, key) => {
          const blocks = [];

          if (chunk?.typeData) {
            chunk.typeData.forEach((typeData, type) => {
              if (!typeData) {
                return;
              }
              const { mesh, entries } = typeData;
              const meshVisible = mesh?.visible !== false;
              const materialVisible = computeMaterialVisibility(mesh?.material);

              entries.forEach((entry) => {
                if (!entry?.position) {
                  return;
                }
                blocks.push({
                  key: entry.key,
                  type,
                  position: {
                    x: entry.position.x,
                    y: entry.position.y,
                    z: entry.position.z,
                  },
                  isSolid: Boolean(entry.isSolid),
                  isWater: Boolean(entry.isWater),
                  collisionMode: entry.collisionMode ?? null,
                  meshVisible,
                  materialVisible,
                });
              });
            });
          }

          totalBlocks += blocks.length;
          chunks.push({
            key,
            chunkX: chunk.chunkX,
            chunkZ: chunk.chunkZ,
            blockCount: blocks.length,
            blocks,
          });
        });

        return {
          generatedAt: Date.now(),
          chunkCount: chunks.length,
          totalBlocks,
          chunks,
        };
      };

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
    const { entries, mesh, tintAttribute } = typeData;
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

    const writeTint = (index, tintColor) => {
      if (!tintAttribute) {
        return;
      }
      const tint = tintColor ?? mesh.userData?.defaultTint;
      if (!tint) {
        return;
      }
      const offset = index * 3;
      tintAttribute.array[offset] = tint.r;
      tintAttribute.array[offset + 1] = tint.g;
      tintAttribute.array[offset + 2] = tint.b;
    };

    if (instanceId !== lastIndex) {
      const swapped = entries[lastIndex];
      entries[instanceId] = swapped;
      mesh.setMatrixAt(instanceId, swapped.matrix);
      writeTint(instanceId, swapped.tintColor);
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
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }

    if (chunk.blockLookup) {
      chunk.blockLookup.delete(removed.key);
      if (removed.coordinateKey && removed.coordinateKey !== removed.key) {
        chunk.blockLookup.delete(removed.coordinateKey);
      }
    }
    if (removed.isSolid) {
      const coordinateKey = removed.coordinateKey ?? removed.key;
      chunk.solidBlockKeys.delete(coordinateKey);
      solidBlocks.delete(coordinateKey);
    }
    if (removed.collisionMode === 'soft') {
      const coordinateKey = removed.coordinateKey ?? removed.key;
      chunk.softBlockKeys.delete(coordinateKey);
      softBlocks.delete(coordinateKey);
    }
    if (removed.isWater) {
      chunk.waterColumnKeys.delete(`${removed.position.x}|${removed.position.z}`);
      waterColumns.delete(`${removed.position.x}|${removed.position.z}`);
    }

    return removed;
  }

  function preloadAround(position, distance) {
    const preloadRadius = Math.max(
      retentionDistance,
      normalizeDistance(distance, retentionDistance)
    );
    update(position, { loadRadius: preloadRadius, skipUnload: true, force: true });
  }

  function setViewDistance(distance) {
    currentViewDistance = normalizeDistance(distance, currentViewDistance);
    lastEffectiveRadius = 0;
  }

  function setRetentionDistance(distance) {
    retentionDistance = Math.max(
      currentViewDistance,
      normalizeDistance(distance, retentionDistance)
    );
    lastEffectiveRadius = 0;
  }

  function getViewDistance() {
    return currentViewDistance;
  }

  function getRetentionDistance() {
    return retentionDistance;
  }

  return {
    update,
    dispose,
    solidBlocks,
    softBlocks,
    waterColumns,
    getBlockFromIntersection,
    removeBlockInstance,
    preloadAround,
    setViewDistance,
    setRetentionDistance,
    getViewDistance,
    getRetentionDistance,
    ...(debugSnapshot ? { debugSnapshot } : {}),
  };
}

export function chunkIndexFromWorld(x, z) {
  return {
    x: worldToChunk(x),
    z: worldToChunk(z),
  };
}
