import { generateChunk, worldConfig } from './generation.js';
import { disposeFluidSurface } from './fluids/fluid-registry.js';

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
  const softBlocks = new Set();
  const waterColumns = new Set();
  const isDevBuild = Boolean(import.meta.env && import.meta.env.DEV);
  let lastCenterKey = null;
  const fluidVisibilityWarnings = new Map();

  const extractFluidType = (type) => {
    if (typeof type !== 'string') {
      return null;
    }
    if (!type.startsWith('fluid:')) {
      return null;
    }
    const segments = type.split(':');
    return segments[1] ?? null;
  };

  const countColumns = (columns) => {
    if (!columns) {
      return 0;
    }
    if (columns instanceof Map) {
      return columns.size;
    }
    if (Array.isArray(columns)) {
      return columns.length;
    }
    if (typeof columns === 'object') {
      return Object.keys(columns).length;
    }
    return 0;
  };

  const updateFluidWarningsForChunk = (chunk) => {
    if (!chunk) {
      return;
    }
    const fluidColumnsByType =
      chunk?.fluidColumns instanceof Map
        ? chunk.fluidColumns
        : chunk?.fluidColumnsByType instanceof Map
        ? chunk.fluidColumnsByType
        : null;
    const surfacesByType = new Map();
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      const type = extractFluidType(surface.userData?.type);
      if (!type) {
        return;
      }
      surfacesByType.set(type, (surfacesByType.get(type) ?? 0) + 1);
    });
    const warnings = [];
    if (fluidColumnsByType instanceof Map) {
      fluidColumnsByType.forEach((columns, fluidType) => {
        const columnCount = countColumns(columns);
        if (columnCount === 0) {
          return;
        }
        const surfaceCount = surfacesByType.get(fluidType) ?? 0;
        if (surfaceCount === 0) {
          warnings.push({
            chunkKey: chunk.key,
            fluidType,
            columnCount,
          });
          console.warn(
            `[fluid warning] Chunk ${chunk.key} has ${columnCount} ${fluidType} column(s) but no rendered surfaces.`,
          );
        }
      });
    }
    chunk.fluidWarnings = warnings;
    if (warnings.length > 0) {
      fluidVisibilityWarnings.set(chunk.key, warnings);
    } else {
      fluidVisibilityWarnings.delete(chunk.key);
    }
  };

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
    chunk.key = key;
    scene.add(chunk.group);
    (chunk.solidBlockKeys ?? []).forEach((block) => solidBlocks.add(block));
    (chunk.softBlockKeys ?? []).forEach((block) => softBlocks.add(block));
    (chunk.waterColumnKeys ?? []).forEach((column) => waterColumns.add(column));
    loadedChunks.set(key, chunk);
    updateFluidWarningsForChunk(chunk);
  }

  function disposeChunk(key) {
    const chunk = loadedChunks.get(key);
    if (!chunk) {
      return;
    }

    scene.remove(chunk.group);
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      if (surface.userData?.safetyFallback && surface.material?.dispose) {
        surface.material.dispose();
      }
      surface.geometry?.dispose?.();
      disposeFluidSurface(surface);
    });
    (chunk.solidBlockKeys ?? []).forEach((block) => solidBlocks.delete(block));
    (chunk.softBlockKeys ?? []).forEach((block) => softBlocks.delete(block));
    (chunk.waterColumnKeys ?? []).forEach((column) => waterColumns.delete(column));
    fluidVisibilityWarnings.delete(key);
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

  function refreshChunks() {
    Array.from(loadedChunks.keys()).forEach((key) => disposeChunk(key));
    lastCenterKey = null;
  }

  function getLoadedChunks() {
    return Array.from(loadedChunks.values());
  }

  function getFluidVisibilityWarnings() {
    const aggregated = [];
    fluidVisibilityWarnings.forEach((warnings) => {
      aggregated.push(...warnings);
    });
    return aggregated;
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
        const warnings = [];

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

          const fluidColumnsByType =
            chunk?.fluidColumns ?? chunk?.fluidColumnsByType ?? null;
          if (fluidColumnsByType instanceof Map) {
            fluidColumnsByType.forEach((columns, fluidType) => {
              if (!columns) {
                return;
              }
              const iterateColumns =
                columns instanceof Map
                  ? columns.values()
                  : Array.isArray(columns)
                  ? columns
                  : Object.values(columns);
              for (const column of iterateColumns) {
                if (!column) {
                  continue;
                }
                const columnKey = column.key ?? `${column.x}|${column.z}`;
                const surfaceY =
                  typeof column.surfaceY === 'number'
                    ? column.surfaceY
                    : typeof column.maxY === 'number'
                    ? column.maxY
                    : null;
                const bottomY =
                  typeof column.bottomY === 'number'
                    ? column.bottomY
                    : typeof column.minY === 'number'
                    ? column.minY
                    : null;
                const representativeY =
                  surfaceY !== null
                    ? surfaceY - 0.5
                    : bottomY !== null
                    ? bottomY + 0.5
                    : 0;
                const colorHex =
                  column?.color && typeof column.color.getHexString === 'function'
                    ? `#${column.color.getHexString()}`
                    : column?.color ?? null;
                blocks.push({
                  key: `fluid:${fluidType}:${columnKey}`,
                  type: `fluid:${fluidType}`,
                  position: {
                    x: column.x ?? 0,
                    y: representativeY,
                    z: column.z ?? 0,
                  },
                  isSolid: false,
                  isWater: fluidType === 'water',
                  collisionMode: 'liquid',
                  meshVisible: true,
                  materialVisible: true,
                  fluid: {
                    surfaceY,
                    bottomY,
                    depth:
                      typeof column.depth === 'number'
                        ? column.depth
                        : surfaceY !== null && bottomY !== null
                        ? Math.max(0, surfaceY - bottomY)
                        : null,
                    color: colorHex,
                    shoreline: column?.shoreline ?? null,
                  },
                });
              }
            });
          }

          totalBlocks += blocks.length;
          const chunkWarnings = chunk.fluidWarnings ?? fluidVisibilityWarnings.get(key) ?? [];
          if (chunkWarnings.length > 0) {
            warnings.push(...chunkWarnings);
          }
          chunks.push({
            key,
            chunkX: chunk.chunkX,
            chunkZ: chunk.chunkZ,
            blockCount: blocks.length,
            blocks,
            warnings: chunkWarnings,
          });
        });

        return {
          generatedAt: Date.now(),
          chunkCount: chunks.length,
          totalBlocks,
          chunks,
          fluidWarnings: warnings,
        };
      };

  function getChunkForMesh(mesh) {
    if (!mesh) {
      return null;
    }
    const key = mesh.userData?.chunkKey;
    if (!key) {
      return null;
    }
    return loadedChunks.get(key) ?? null;
  }

  function getBlockFromIntersection(intersection) {
    if (!intersection) {
      return null;
    }
    const mesh = intersection.object;
    const chunk = getChunkForMesh(mesh);
    if (!chunk) {
      return null;
    }
    const { type } = mesh.userData || {};
    const instanceId = typeof intersection.instanceId === 'number' ? intersection.instanceId : null;

    if (mesh.isInstancedMesh && instanceId !== null) {
      if (!type) {
        return null;
      }
      const typeData = chunk.typeData?.get(type);
      if (!typeData) {
        return null;
      }
      const entry = typeData.entries[instanceId];
      if (!entry) {
        return null;
      }
      return {
        chunk,
        type,
        instanceId,
        entry,
      };
    }

    if (typeof type === 'string' && type.startsWith('fluid:')) {
      const fluidType = type.slice('fluid:'.length);
      const fluidColumnsByType =
        chunk?.fluidColumns instanceof Map
          ? chunk.fluidColumns
          : chunk?.fluidColumnsByType instanceof Map
          ? chunk.fluidColumnsByType
          : null;
      if (!fluidColumnsByType) {
        return null;
      }
      const columns = fluidColumnsByType.get(fluidType);
      if (!(columns instanceof Map) || columns.size === 0) {
        return null;
      }
      const point = intersection.point ?? null;
      const rounded = (value) =>
        Number.isFinite(value) ? Math.floor(value + 0.5) : null;
      const columnX = point ? rounded(point.x) : null;
      const columnZ = point ? rounded(point.z) : null;
      let columnKey = null;
      let column = null;
      if (columnX !== null && columnZ !== null) {
        columnKey = `${columnX}|${columnZ}`;
        column = columns.get(columnKey) ?? null;
      }
      if (!column) {
        for (const candidate of columns.values()) {
          if (
            candidate &&
            (candidate.x === columnX || columnX === null) &&
            (candidate.z === columnZ || columnZ === null)
          ) {
            columnKey = candidate.key ?? `${candidate.x}|${candidate.z}`;
            column = candidate;
            break;
          }
        }
      }
      if (!column) {
        return null;
      }

      const surfaceY =
        typeof column.surfaceY === 'number'
          ? column.surfaceY
          : typeof column.maxY === 'number'
          ? column.maxY
          : null;
      const bottomY =
        typeof column.bottomY === 'number'
          ? column.bottomY
          : typeof column.minY === 'number'
          ? column.minY
          : null;
      const depth =
        typeof column.depth === 'number'
          ? column.depth
          : surfaceY !== null && bottomY !== null
          ? Math.max(0, surfaceY - bottomY)
          : null;
      const representativeY =
        surfaceY !== null
          ? surfaceY - 0.5
          : bottomY !== null
          ? bottomY + 0.5
          : point && Number.isFinite(point.y)
          ? point.y
          : 0;
      const colorHex =
        column?.color && typeof column.color.getHexString === 'function'
          ? `#${column.color.getHexString()}`
          : column?.color ?? null;
      const flowDirection =
        column?.flowDirection && typeof column.flowDirection.x === 'number'
          ? {
              x: column.flowDirection.x,
              z:
                typeof column.flowDirection.y === 'number'
                  ? column.flowDirection.y
                  : typeof column.flowDirection.z === 'number'
                  ? column.flowDirection.z
                  : 0,
            }
          : null;

      const resolvedKey = columnKey ?? column.key ?? `${column.x}|${column.z}`;
      const entry = {
        key: `fluid:${fluidType}:${resolvedKey}`,
        coordinateKey: resolvedKey,
        type: `fluid:${fluidType}`,
        position: {
          x: column.x ?? columnX ?? 0,
          y: representativeY,
          z: column.z ?? columnZ ?? 0,
        },
        isSolid: false,
        isWater: fluidType === 'water',
        collisionMode: 'liquid',
        fluid: {
          type: fluidType,
          surfaceY,
          bottomY,
          depth,
          color: colorHex,
          shoreline: column?.shoreline ?? null,
          flowStrength: column?.flowStrength ?? null,
          flowDirection,
          neighbors: column?.neighbors ?? null,
        },
      };

      return {
        chunk,
        type: entry.type,
        instanceId: null,
        entry,
      };
    }

    return null;
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

  return {
    update,
    dispose,
    refreshChunks,
    solidBlocks,
    softBlocks,
    waterColumns,
    getLoadedChunks,
    getFluidVisibilityWarnings,
    getBlockFromIntersection,
    removeBlockInstance,
    ...(debugSnapshot ? { debugSnapshot } : {}),
  };
}

export function chunkIndexFromWorld(x, z) {
  return {
    x: worldToChunk(x),
    z: worldToChunk(z),
  };
}
