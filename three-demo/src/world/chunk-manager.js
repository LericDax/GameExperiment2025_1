import * as THREE from 'three';

import { generateChunk, worldConfig } from './generation.js';
import { disposeFluidSurface } from './fluids/fluid-registry.js';

function chunkKey(x, z) {
  return `${x}|${z}`;
}

function worldToChunk(value) {
  const halfSize = worldConfig.chunkSize / 2;
  return Math.floor((value + halfSize) / worldConfig.chunkSize);
}

function normalizeDistance(value, fallback = 0) {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    const fallbackNumeric = Number(fallback);
    if (!Number.isFinite(fallbackNumeric)) {
      return 0;
    }
    return Math.max(0, Math.floor(fallbackNumeric));
  }
  return Math.max(0, Math.floor(numeric));
}

function resolveBudget(value, fallback) {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(numeric));
  }
  const fallbackNumeric = Number(fallback);
  if (Number.isFinite(fallbackNumeric)) {
    return Math.max(0, Math.floor(fallbackNumeric));
  }
  return 0;
}

function ensureWaterColumnMap(source) {
  if (!source) {
    return new Map();
  }
  if (source instanceof Map) {
    return source;
  }
  const map = new Map();
  if (source instanceof Set) {
    source.forEach((key) => {
      map.set(key, null);
    });
    return map;
  }
  if (Array.isArray(source)) {
    source.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length === 0) {
        return;
      }
      const [key, value = null] = entry;
      map.set(key, value);
    });
    return map;
  }
  if (typeof source === 'object') {
    Object.entries(source).forEach(([key, value]) => {
      map.set(key, value);
    });
  }
  return map;
}

function normalizeWaterColumnBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    return null;
  }
  const resolveValue = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const bottomCandidates = [
    bounds.bottomY,
    bounds.minY,
    bounds.yMin,
    bounds.min,
  ];
  const surfaceCandidates = [
    bounds.surfaceY,
    bounds.maxY,
    bounds.yMax,
    bounds.max,
  ];
  let bottom = null;
  for (let i = 0; i < bottomCandidates.length && bottom === null; i += 1) {
    bottom = resolveValue(bottomCandidates[i]);
  }
  let surface = null;
  for (let i = 0; i < surfaceCandidates.length && surface === null; i += 1) {
    surface = resolveValue(surfaceCandidates[i]);
  }
  if (bottom === null && surface === null) {
    return null;
  }
  if (bottom === null) {
    bottom = surface;
  }
  if (surface === null) {
    surface = bottom;
  }
  const min = Math.min(bottom, surface);
  const max = Math.max(bottom, surface);
  return {
    bottomY: min,
    surfaceY: max,
  };
}

export function createChunkManager({
  scene,
  blockMaterials,
  viewDistance = 1,
  retainDistance: initialRetainDistance,
  maxPreloadPerUpdate = 2,
}) {
  const loadedChunks = new Map();
  const solidBlocks = new Set();
  const softBlocks = new Set();
  const waterColumns = new Map();
  const decorationGroupsByKey = new Map();
  const decorationOwnersIndex = new Map();
  const prototypeRemovalGuards = new Set();
  const isDevBuild = Boolean(import.meta.env && import.meta.env.DEV);
  let lastCenterKey = null;
  let currentViewDistance = normalizeDistance(viewDistance, 1);
  let retentionDistance = Math.max(
    currentViewDistance,
    normalizeDistance(initialRetainDistance, currentViewDistance + 1),
  );
  const preloadQueue = [];
  const pendingPreloadKeys = new Set();
  let queueDirty = false;

  const chunkCullFrustum = new THREE.Frustum();
  const chunkCullMatrix = new THREE.Matrix4();
  const chunkCullPadding = 1.5;
  let lastCamera = null;

  function applyChunkBounds(chunk) {
    if (!chunk) {
      return;
    }

    const { chunkSize, maxHeight } = worldConfig;
    const halfSize = chunkSize / 2;
    const fallbackMinX = chunk.chunkX * chunkSize - halfSize - 0.5;
    const fallbackMaxX = chunk.chunkX * chunkSize + halfSize + 0.5;
    const fallbackMinZ = chunk.chunkZ * chunkSize - halfSize - 0.5;
    const fallbackMaxZ = chunk.chunkZ * chunkSize + halfSize + 0.5;
    const bounds = chunk.bounds ?? {};
    const minX = Number.isFinite(bounds.minX) ? bounds.minX : fallbackMinX;
    const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : fallbackMaxX;
    const minZ = Number.isFinite(bounds.minZ) ? bounds.minZ : fallbackMinZ;
    const maxZ = Number.isFinite(bounds.maxZ) ? bounds.maxZ : fallbackMaxZ;
    const minY = Number.isFinite(bounds.minY) ? bounds.minY : -32;
    const maxY = Number.isFinite(bounds.maxY)
      ? bounds.maxY
      : maxHeight + 32;

    const box = chunk.boundsBox ?? new THREE.Box3();
    box.min.set(minX - chunkCullPadding, minY - chunkCullPadding, minZ - chunkCullPadding);
    box.max.set(maxX + chunkCullPadding, maxY + chunkCullPadding, maxZ + chunkCullPadding);
    chunk.boundsBox = box;
  }

  function updateChunkVisibility(camera) {
    if (!camera) {
      loadedChunks.forEach((chunk) => {
        if (chunk?.group) {
          chunk.group.visible = true;
        }
      });
      return;
    }

    chunkCullMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    chunkCullFrustum.setFromProjectionMatrix(chunkCullMatrix);

    loadedChunks.forEach((chunk) => {
      if (!chunk?.group) {
        return;
      }
      const visible = chunk.boundsBox
        ? chunkCullFrustum.intersectsBox(chunk.boundsBox)
        : true;
      chunk.group.visible = visible;
    });
  }

  function registerDecorationGroup(chunkKey, group, chunkOverride = null) {
    if (!group || !group.key) {
      return;
    }
    group.chunkKey = chunkKey;
    decorationGroupsByKey.set(group.key, group);
    const chunk = chunkOverride ?? loadedChunks.get(chunkKey);
    if (chunk) {
      if (!chunk.decorationGroups) {
        chunk.decorationGroups = new Map();
      }
      chunk.decorationGroups.set(group.key, group);
      if (!chunk.decorationTypeIndex) {
        chunk.decorationTypeIndex = new Map();
      }
      if (group.type) {
        let typeBucket = chunk.decorationTypeIndex.get(group.type);
        if (!typeBucket) {
          typeBucket = new Set();
          chunk.decorationTypeIndex.set(group.type, typeBucket);
        }
        typeBucket.add(group);
      }
      if (group.owner !== null && group.owner !== undefined) {
        if (!chunk.decorationOwnerIndex) {
          chunk.decorationOwnerIndex = new Map();
        }
        let ownerGroups = chunk.decorationOwnerIndex.get(group.owner);
        if (!ownerGroups) {
          ownerGroups = new Map();
          chunk.decorationOwnerIndex.set(group.owner, ownerGroups);
        }
        ownerGroups.set(group.key, group);
      }
    }
    if (group.owner !== null && group.owner !== undefined) {
      let ownerGroups = decorationOwnersIndex.get(group.owner);
      if (!ownerGroups) {
        ownerGroups = new Map();
        decorationOwnersIndex.set(group.owner, ownerGroups);
      }
      ownerGroups.set(group.key, group);
    }
  }

  function unregisterDecorationGroup(group) {
    if (!group || !group.key) {
      return;
    }
    decorationGroupsByKey.delete(group.key);
    if (group.owner !== null && group.owner !== undefined) {
      const ownerGroups = decorationOwnersIndex.get(group.owner);
      if (ownerGroups) {
        ownerGroups.delete(group.key);
        if (ownerGroups.size === 0) {
          decorationOwnersIndex.delete(group.owner);
        }
      }
    }
    const chunk = group.chunkKey ? loadedChunks.get(group.chunkKey) : null;
    if (chunk) {
      chunk.decorationGroups?.delete(group.key);
      if (group.owner !== null && group.owner !== undefined) {
        const ownerGroups = chunk.decorationOwnerIndex?.get(group.owner);
        if (ownerGroups) {
          ownerGroups.delete(group.key);
          if (ownerGroups.size === 0) {
            chunk.decorationOwnerIndex?.delete(group.owner);
          }
        }
      }
      if (group.type && chunk.decorationTypeIndex) {
        const typeBucket = chunk.decorationTypeIndex.get(group.type);
        if (typeBucket) {
          typeBucket.delete(group);
          if (typeBucket.size === 0) {
            chunk.decorationTypeIndex.delete(group.type);
          }
        }
      }
    }
  }


  function ensureChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      return;
    }
    const chunk = generateChunk(blockMaterials, chunkX, chunkZ);
    chunk.group.frustumCulled = false;
    applyChunkBounds(chunk);
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
    const chunkWaterColumnSource =
      chunk.waterColumns ?? chunk.waterColumnKeys ?? null;
    const chunkWaterColumns = ensureWaterColumnMap(chunkWaterColumnSource);
    const normalizedWaterColumns = new Map();
    chunkWaterColumns.forEach((bounds, columnKey) => {
      const normalized = bounds === null
        ? null
        : normalizeWaterColumnBounds(bounds);
      normalizedWaterColumns.set(columnKey, normalized);
      waterColumns.set(columnKey, normalized);
    });
    chunk.waterColumns = normalizedWaterColumns;
    chunk.waterColumnKeys = new Set(normalizedWaterColumns.keys());
    if (!chunk.decorationGroups) {
      chunk.decorationGroups = new Map();
    }
    if (!chunk.decorationOwnerIndex) {
      chunk.decorationOwnerIndex = new Map();
    }
    if (!chunk.decorationTypeIndex) {
      chunk.decorationTypeIndex = new Map();
      chunk.decorationGroups.forEach((metadata) => {
        if (!metadata || !metadata.type) {
          return;
        }
        let typeBucket = chunk.decorationTypeIndex.get(metadata.type);
        if (!typeBucket) {
          typeBucket = new Set();
          chunk.decorationTypeIndex.set(metadata.type, typeBucket);
        }
        typeBucket.add(metadata);
      });
    }
    if (!chunk.prototypeInstances) {
      chunk.prototypeInstances = new Map();
    } else if (!(chunk.prototypeInstances instanceof Map)) {
      chunk.prototypeInstances = new Map(chunk.prototypeInstances);
    }
    chunk.decorationGroups.forEach((group) => {
      registerDecorationGroup(key, group, chunk);
    });
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
    if (chunk.waterColumns instanceof Map) {
      chunk.waterColumns.forEach((_, columnKey) => waterColumns.delete(columnKey));
    } else if (chunk.waterColumnKeys instanceof Set) {
      chunk.waterColumnKeys.forEach((columnKey) => waterColumns.delete(columnKey));
    }
    if (chunk.decorationGroups) {
      Array.from(chunk.decorationGroups.values()).forEach((group) => {
        unregisterDecorationGroup(group);
      });
    }
    if (chunk.boundsBox) {
      chunk.boundsBox.makeEmpty?.();
    }
    loadedChunks.delete(key);
  }

  function schedulePreload(chunkX, chunkZ, centerChunkX, centerChunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key) || pendingPreloadKeys.has(key)) {
      return;
    }
    const dx = chunkX - centerChunkX;
    const dz = chunkZ - centerChunkZ;
    const priority = dx * dx + dz * dz;
    pendingPreloadKeys.add(key);
    preloadQueue.push({ key, chunkX, chunkZ, priority });
    queueDirty = true;
  }

  function prunePreloadQueue(centerChunkX, centerChunkZ, maxDistance) {
    if (preloadQueue.length === 0) {
      return;
    }
    let removedAny = false;
    for (let i = preloadQueue.length - 1; i >= 0; i -= 1) {
      const entry = preloadQueue[i];
      const dx = Math.abs(entry.chunkX - centerChunkX);
      const dz = Math.abs(entry.chunkZ - centerChunkZ);
      if (dx > maxDistance || dz > maxDistance) {
        preloadQueue.splice(i, 1);
        pendingPreloadKeys.delete(entry.key);
        removedAny = true;
        continue;
      }
      const priority = dx * dx + dz * dz;
      if (priority !== entry.priority) {
        entry.priority = priority;
        removedAny = true;
      }
    }
    if (removedAny) {
      queueDirty = true;
    }
  }

  function processPreloadQueue(limit) {
    if (preloadQueue.length === 0) {
      return 0;
    }

    let budget = limit;
    if (!Number.isFinite(budget)) {
      budget = preloadQueue.length;
    } else {
      budget = Math.max(0, Math.floor(budget));
    }

    if (budget <= 0) {
      return 0;
    }

    if (queueDirty) {
      preloadQueue.sort((a, b) => a.priority - b.priority);
      queueDirty = false;
    }

    let processed = 0;
    while (preloadQueue.length > 0 && processed < budget) {
      const next = preloadQueue.shift();
      pendingPreloadKeys.delete(next.key);
      if (loadedChunks.has(next.key)) {
        continue;
      }
      ensureChunk(next.chunkX, next.chunkZ);
      processed += 1;
    }

    return processed;
  }

  function update(position, options = {}) {
    if (!position) {
      return;
    }

    const centerChunkX = worldToChunk(position.x);
    const centerChunkZ = worldToChunk(position.z);
    const centerKey = chunkKey(centerChunkX, centerChunkZ);


    if (options.camera) {
      lastCamera = options.camera;
    }
    const camera = options.camera ?? lastCamera;
    const shouldUpdateVisibility = Boolean(camera);

    const desiredViewDistance = Math.max(
      0,
      normalizeDistance(options.viewDistance, currentViewDistance),
    );
    const desiredRetention = Math.max(
      desiredViewDistance,
      normalizeDistance(options.retainDistance, retentionDistance),
    );
    const preloadBudget = resolveBudget(
      options.maxPreload,
      maxPreloadPerUpdate,
    );
    const force = Boolean(options.force);

    const centerChanged = centerKey !== lastCenterKey;
    const viewChanged = desiredViewDistance !== currentViewDistance;
    const retentionChanged = desiredRetention !== retentionDistance;
    const queueHasWork = preloadQueue.length > 0;

    if (
      !force &&
      !centerChanged &&
      !viewChanged &&
      !retentionChanged &&
      !queueHasWork
    ) {

      if (shouldUpdateVisibility) {
        updateChunkVisibility(camera);
      }

      return;
    }

    currentViewDistance = desiredViewDistance;
    retentionDistance = desiredRetention;

    const finiteView = Number.isFinite(currentViewDistance)
      ? currentViewDistance
      : 0;
    const finiteRetention = Number.isFinite(retentionDistance)
      ? retentionDistance
      : finiteView;

    prunePreloadQueue(centerChunkX, centerChunkZ, finiteRetention);

    for (let dx = -finiteView; dx <= finiteView; dx += 1) {
      for (let dz = -finiteView; dz <= finiteView; dz += 1) {
        ensureChunk(centerChunkX + dx, centerChunkZ + dz);

      }
    }

    if (finiteRetention > finiteView) {
      for (let dx = -finiteRetention; dx <= finiteRetention; dx += 1) {
        for (let dz = -finiteRetention; dz <= finiteRetention; dz += 1) {
          const maxDistance = Math.max(Math.abs(dx), Math.abs(dz));
          if (maxDistance <= finiteView) {
            continue;
          }
          schedulePreload(
            centerChunkX + dx,
            centerChunkZ + dz,
            centerChunkX,
            centerChunkZ,
          );
        }
      }
    }


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
      if (distanceX > finiteRetention || distanceZ > finiteRetention) {
        disposeChunk(key);
      }
    });

    lastCenterKey = centerKey;

    if (preloadBudget === Number.POSITIVE_INFINITY) {
      processPreloadQueue(Number.POSITIVE_INFINITY);

      if (shouldUpdateVisibility) {
        updateChunkVisibility(camera);
      }

      return;
    }

    if (force && preloadBudget === 0) {
      // Ensure at least one chunk is processed when forcing an update.
      processPreloadQueue(maxPreloadPerUpdate);

      if (shouldUpdateVisibility) {
        updateChunkVisibility(camera);
      }

      return;
    }

    if (preloadBudget > 0) {
      processPreloadQueue(preloadBudget);
    }


    if (shouldUpdateVisibility) {
      updateChunkVisibility(camera);
    }

  }

  function dispose() {
    Array.from(loadedChunks.keys()).forEach((key) => disposeChunk(key));
    preloadQueue.length = 0;
    pendingPreloadKeys.clear();
    queueDirty = false;
    lastCenterKey = null;
  }

  function setViewDistance(distance) {
    currentViewDistance = normalizeDistance(distance, currentViewDistance);
    if (
      retentionDistance !== Number.POSITIVE_INFINITY &&
      currentViewDistance > retentionDistance
    ) {
      retentionDistance = currentViewDistance;
    }
  }

  function setRetentionDistance(distance) {
    if (retentionDistance === Number.POSITIVE_INFINITY) {
      return;
    }
    const desired = normalizeDistance(distance, retentionDistance);
    retentionDistance = Math.max(currentViewDistance, desired);
  }

  function getViewDistance() {
    return currentViewDistance;
  }

  function getRetentionDistance() {
    return retentionDistance;
  }

  function preloadAround(position, distance, options = {}) {
    if (!position) {
      return;
    }
    const targetRetention = Math.max(
      currentViewDistance,
      normalizeDistance(distance, retentionDistance),
    );
    setRetentionDistance(targetRetention);

    const warmView = Math.max(
      currentViewDistance,
      Math.min(
        targetRetention,
        normalizeDistance(options.viewDistance, currentViewDistance),
      ),
    );

    const desiredBudget = resolveBudget(
      options.maxPreload,
      maxPreloadPerUpdate * 4,
    );
    const effectiveBudget =
      desiredBudget === 0 ? maxPreloadPerUpdate * 2 : desiredBudget;

    update(position, {
      viewDistance: warmView,
      retainDistance: targetRetention,
      maxPreload:
        effectiveBudget === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : Math.max(effectiveBudget, maxPreloadPerUpdate * 2),
      force: true,
    });
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

  function removeBlockInstancesBulk({ chunk, type, entries: removalEntries }) {
    if (!chunk || !chunk.typeData) {
      return [];
    }
    const typeData = chunk.typeData.get(type);
    if (!typeData) {
      return [];
    }
    const { entries, mesh, tintAttribute } = typeData;
    if (!mesh?.isInstancedMesh || !Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    const candidates = Array.isArray(removalEntries) ? removalEntries : [];
    const indices = [];
    const seen = new Set();

    candidates.forEach((candidate) => {
      if (!candidate) {
        return;
      }
      const entry = candidate.entry ?? candidate;
      if (!entry) {
        return;
      }
      let index = Number.isInteger(candidate.instanceId)
        ? candidate.instanceId
        : Number.isInteger(entry.index)
        ? entry.index
        : null;
      if (entry.key && chunk.blockLookup?.has(entry.key)) {
        const lookup = chunk.blockLookup.get(entry.key);
        if (Number.isInteger(lookup?.index)) {
          index = lookup.index;
        }
      }
      if (!Number.isInteger(index)) {
        return;
      }
      if (index < 0 || index >= entries.length) {
        return;
      }
      if (seen.has(index)) {
        return;
      }
      const current = entries[index];
      if (!current || (entry.key && current.key !== entry.key)) {
        return;
      }
      seen.add(index);
      indices.push(index);
    });

    if (indices.length === 0) {
      return [];
    }

    indices.sort((a, b) => a - b);
    const removalSet = new Set(indices);
    const removedEntries = [];
    const prototypeRefs = [];

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

    let writeIndex = 0;
    const totalEntries = entries.length;
    for (let readIndex = 0; readIndex < totalEntries; readIndex += 1) {
      const entry = entries[readIndex];
      if (!entry) {
        continue;
      }
      if (removalSet.has(readIndex)) {
        removedEntries.push(entry);
        if (entry.prototypeKey) {
          prototypeRefs.push({ prototypeKey: entry.prototypeKey, entryKey: entry.key });
        }
        if (chunk.blockLookup) {
          chunk.blockLookup.delete(entry.key);
          if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
            chunk.blockLookup.delete(entry.coordinateKey);
          }
        }
        if (entry.isSolid) {
          const coordinateKey = entry.coordinateKey ?? entry.key;
          chunk.solidBlockKeys.delete(coordinateKey);
          solidBlocks.delete(coordinateKey);
        }
        if (entry.collisionMode === 'soft') {
          const coordinateKey = entry.coordinateKey ?? entry.key;
          chunk.softBlockKeys.delete(coordinateKey);
          softBlocks.delete(coordinateKey);
        }
        if (entry.isWater) {
          const columnKey = `${entry.position.x}|${entry.position.z}`;
          chunk.waterColumns?.delete?.(columnKey);
          if (chunk.waterColumnKeys instanceof Set) {
            chunk.waterColumnKeys.delete(columnKey);
          }
          waterColumns.delete(columnKey);
        }
        entry.index = -1;
        continue;
      }

      if (writeIndex !== readIndex) {
        entries[writeIndex] = entry;
        mesh.setMatrixAt(writeIndex, entry.matrix);
        writeTint(writeIndex, entry.tintColor);
      }
      entry.index = writeIndex;
      if (chunk.blockLookup) {
        if (entry.key) {
          const lookup = chunk.blockLookup.get(entry.key);
          if (lookup) {
            lookup.index = writeIndex;
          }
        }
        if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
          const coordinateEntry = chunk.blockLookup.get(entry.coordinateKey);
          if (coordinateEntry) {
            coordinateEntry.index = writeIndex;
          }
        }
      }
      writeIndex += 1;
    }

    while (entries.length > writeIndex) {
      entries.pop();
    }

    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }

    prototypeRefs.forEach(({ prototypeKey, entryKey }) => {
      removePrototypePlacement(chunk, prototypeKey, entryKey);
    });

    return removedEntries;
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
      const columnKey = `${removed.position.x}|${removed.position.z}`;
      chunk.waterColumns?.delete?.(columnKey);
      if (chunk.waterColumnKeys instanceof Set) {
        chunk.waterColumnKeys.delete(columnKey);
      }
      waterColumns.delete(columnKey);
    }

    if (removed.prototypeKey) {
      removePrototypePlacement(chunk, removed.prototypeKey, removed.key);
    }

    return removed;
  }

  function removeDecorationGroupsBulk({ chunk, type, groups }) {
    if (!chunk || !type) {
      return [];
    }

    const decorationStore = chunk.decorationData;
    const decorationRecord =
      decorationStore instanceof Map
        ? decorationStore.get(type)
        : decorationStore && typeof decorationStore === 'object'
        ? decorationStore[type]
        : null;

    let mesh = decorationRecord?.mesh ?? null;
    const entries = decorationRecord?.entries ?? null;
    let tintAttribute = decorationRecord?.tintAttribute ?? null;

    if (!mesh && Array.isArray(groups)) {
      for (let i = 0; i < groups.length; i += 1) {
        const metadata = groups[i];
        if (!metadata || (metadata.type && metadata.type !== type)) {
          continue;
        }
        if (metadata.mesh?.isInstancedMesh) {
          mesh = metadata.mesh;
          tintAttribute = metadata.tintAttribute ?? mesh.userData?.biomeTintAttribute ?? null;
          break;
        }
      }
    }

    if (!mesh) {
      (Array.isArray(groups) ? groups : []).forEach((group) => {
        if (group) {
          unregisterDecorationGroup(group);
        }
      });
      return [];
    }

    if (!mesh.isInstancedMesh || !Array.isArray(entries) || entries.length === 0) {
      (Array.isArray(groups) ? groups : []).forEach((group) => {
        if (group) {
          unregisterDecorationGroup(group);
        }
      });
      return [];
    }

    const uniqueGroups = [];
    const seenKeys = new Set();
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      if (!group || (group.type && group.type !== type)) {
        return;
      }
      const key = group.key ?? group;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      uniqueGroups.push(group);
    });

    if (uniqueGroups.length === 0) {
      return [];
    }

    const validGroups = [];
    const removalIndicesSet = new Set();
    const summaries = [];

    uniqueGroups.forEach((group) => {
      const sanitized = Array.from(new Set(group.instanceIndices || []))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < entries.length)
        .sort((a, b) => a - b);
      if (sanitized.length === 0) {
        unregisterDecorationGroup(group);
        summaries.push({
          chunk,
          groupKey: group.key ?? null,
          removedCount: 0,
          peersProcessed: 0,
          firstAffectedIndex: null,
          remainingCount: entries.length,
        });
        return;
      }
      validGroups.push({ group, indices: sanitized });
      sanitized.forEach((index) => removalIndicesSet.add(index));
    });

    if (validGroups.length === 0) {
      return summaries;
    }

    const indicesToRemove = Array.from(removalIndicesSet).sort((a, b) => a - b);
    if (indicesToRemove.length === 0) {
      validGroups.forEach(({ group }) => unregisterDecorationGroup(group));
      return summaries;
    }

    const removalSet = new Set(indicesToRemove);
    const removalGroupsSet = new Set(validGroups.map(({ group }) => group));
    const peers = chunk.decorationTypeIndex?.get(type)
      ? Array.from(chunk.decorationTypeIndex.get(type)).filter(
          (metadata) => !removalGroupsSet.has(metadata),
        )
      : Array.from(chunk.decorationGroups.values()).filter(
          (metadata) => !removalGroupsSet.has(metadata) && metadata.type === type,
        );

    const removedEntries = [];
    for (let i = indicesToRemove.length - 1; i >= 0; i -= 1) {
      const index = indicesToRemove[i];
      if (index < 0 || index >= entries.length) {
        continue;
      }
      const [removedEntry] = entries.splice(index, 1);
      if (removedEntry) {
        removedEntries.push({ entry: removedEntry, index });
      }
    }

    if (removedEntries.length === 0) {
      validGroups.forEach(({ group }) => unregisterDecorationGroup(group));
      return summaries;
    }

    removedEntries.forEach(({ entry }) => {
      if (!entry || !chunk.blockLookup) {
        return;
      }
      chunk.blockLookup.delete(entry.key);
      if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
        chunk.blockLookup.delete(entry.coordinateKey);
      }
    });

    const adjustIndex = (index) => {
      let offset = 0;
      for (let i = 0; i < indicesToRemove.length; i += 1) {
        if (indicesToRemove[i] < index) {
          offset += 1;
        } else {
          break;
        }
      }
      return index - offset;
    };

    peers.forEach((metadata) => {
      if (!Array.isArray(metadata.instanceIndices)) {
        return;
      }
      const updated = [];
      metadata.instanceIndices.forEach((instanceIndex) => {
        if (removalSet.has(instanceIndex)) {
          return;
        }
        updated.push(adjustIndex(instanceIndex));
      });
      metadata.instanceIndices = updated;
    });

    const firstAffectedIndex = indicesToRemove[0] ?? 0;
    for (let index = firstAffectedIndex; index < entries.length; index += 1) {
      const entry = entries[index];
      mesh.setMatrixAt(index, entry.matrix);
      entry.index = index;
      if (tintAttribute) {
        const tint = entry.tintColor ?? mesh.userData?.defaultTint;
        if (tint) {
          const offset = index * 3;
          tintAttribute.array[offset] = tint.r;
          tintAttribute.array[offset + 1] = tint.g;
          tintAttribute.array[offset + 2] = tint.b;
        }
      }
    }
    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }

    const peersProcessed = peers.length;
    const remainingCount = entries.length;

    validGroups.forEach(({ group }) => {
      group.instanceIndices = [];
      unregisterDecorationGroup(group);
    });

    const removalLookup = new Set(removedEntries.map(({ index }) => index));
    validGroups.forEach(({ group, indices }) => {
      const removedCount = indices.filter((index) => removalLookup.has(index)).length;
      summaries.push({
        chunk,
        groupKey: group.key ?? null,
        removedCount,
        peersProcessed,
        firstAffectedIndex,
        remainingCount,
      });
    });

    if (
      isDevBuild &&
      import.meta.env?.VITE_DEBUG_DECORATION_REMOVAL !== undefined
    ) {
      summaries
        .filter((summary) => summary.groupKey && summary.removedCount > 0)
        .forEach((summary) => {
          console.debug('[chunk-manager] decoration removal', {
            groupKey: summary.groupKey,
            removed: summary.removedCount,
            peersProcessed: summary.peersProcessed,
            firstAffectedIndex: summary.firstAffectedIndex,
            remainingCount: summary.remainingCount,
          });
        });
    }

    return summaries;
  }

  function removeDecorationGroup(groupKey) {
    const group = decorationGroupsByKey.get(groupKey);
    if (!group) {
      return null;
    }
    const chunk = group.chunkKey ? loadedChunks.get(group.chunkKey) : null;
    if (!chunk || !group.type || !chunk.typeData) {
      unregisterDecorationGroup(group);
      return null;
    }

    const summaries = removeDecorationGroupsBulk({
      chunk,
      type: group.type,
      groups: [group],
    });
    return (
      summaries.find(
        (summary) => summary.groupKey === group.key && summary.removedCount > 0,
      ) ?? null
    );
  }

  function removePrototypePlacement(chunk, prototypeKey, skipEntryKey = null) {
    if (!chunk || !chunk.prototypeInstances || !prototypeKey) {
      return;
    }
    if (prototypeRemovalGuards.has(prototypeKey)) {
      return;
    }
    const record = chunk.prototypeInstances.get(prototypeKey);
    if (!record) {
      return;
    }

    prototypeRemovalGuards.add(prototypeKey);
    try {
      const grouped = new Map();
      const blockEntries = Array.isArray(record.blockEntries)
        ? record.blockEntries
        : [];

      blockEntries.forEach((blockEntry) => {
        if (!blockEntry) {
          return;
        }
        const { type, entry } = blockEntry;
        if (!type || !entry) {
          return;
        }
        if (skipEntryKey && entry.key === skipEntryKey) {
          return;
        }
        const typeData = chunk.typeData?.get(type);
        if (!typeData || !Array.isArray(typeData.entries) || typeData.entries.length === 0) {
          return;
        }
        const lookup = entry.key ? chunk.blockLookup?.get(entry.key) : null;
        const index = Number.isInteger(lookup?.index)
          ? lookup.index
          : Number.isInteger(entry.index)
          ? entry.index
          : null;
        if (!Number.isInteger(index) || index < 0) {
          return;
        }
        if (!grouped.has(type)) {
          grouped.set(type, []);
        }
        grouped.get(type).push(entry);
      });

      grouped.forEach((entries, type) => {
        if (!entries || entries.length === 0) {
          return;
        }
        removeBlockInstancesBulk({ chunk, type, entries });
      });
      record.blockEntries = [];

      const decorationKeys = Array.isArray(record.decorationKeys)
        ? record.decorationKeys.filter(Boolean)
        : [];
      if (decorationKeys.length > 0) {
        const uniqueGroups = new Map();
        decorationKeys.forEach((groupKey) => {
          if (uniqueGroups.has(groupKey)) {
            return;
          }
          const group = chunk.decorationGroups?.get(groupKey) ?? null;
          if (!group) {
            removeDecorationGroup(groupKey);
            return;
          }
          uniqueGroups.set(groupKey, group);
        });

        const groupsByType = new Map();
        uniqueGroups.forEach((group, groupKey) => {
          if (!group.type) {
            removeDecorationGroup(groupKey);
            return;
          }
          let bucket = groupsByType.get(group.type);
          if (!bucket) {
            bucket = [];
            groupsByType.set(group.type, bucket);
          }
          bucket.push(group);
        });

        groupsByType.forEach((groups, type) => {
          if (!groups || groups.length === 0) {
            return;
          }
          removeDecorationGroupsBulk({ chunk, type, groups });
        });
      }
      record.decorationKeys = [];

      chunk.prototypeInstances.delete(prototypeKey);
    } finally {
      prototypeRemovalGuards.delete(prototypeKey);
    }
  }

  return {
    update,
    dispose,
    solidBlocks,
    softBlocks,
    waterColumns,
    getBlockFromIntersection,
    removeBlockInstance,
    removeDecorationGroup,
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
