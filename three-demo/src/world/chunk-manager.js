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
  const waterColumns = new Set();
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


  function ensureChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      return;
    }
    const chunk = generateChunk(blockMaterials, chunkX, chunkZ);
    chunk.group.frustumCulled = false;
    chunk.decorationGroups = chunk.decorationGroups ?? new Map();
    chunk.decorationGroupsByOwner = chunk.decorationGroupsByOwner ?? new Map();
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
    if (chunk.boundsBox) {
      chunk.boundsBox.makeEmpty?.();
    }
    chunk.decorationGroups?.clear?.();
    chunk.decorationGroupsByOwner?.clear?.();
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
    if (!intersection || !intersection.object) {
      return null;
    }
    const mesh = intersection.object;
    if (mesh.userData?.decorationGroup) {
      const chunk = getChunkForMesh(mesh);
      if (!chunk) {
        return null;
      }
      const groupKey = mesh.userData.decorationGroup.key;
      if (!groupKey) {
        return null;
      }
      const group = chunk.decorationGroups?.get(groupKey);
      if (!group) {
        return null;
      }
      return {
        chunk,
        type: group.type ?? mesh.userData?.type ?? null,
        decorationGroup: {
          ...mesh.userData.decorationGroup,
          mesh,
        },
      };
    }
    if (typeof intersection.instanceId !== 'number') {
      return null;
    }
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

  function removeDecorationGroup({ chunk, groupKey }) {
    if (!chunk || !groupKey) {
      return null;
    }
    const groups = chunk.decorationGroups;
    if (!groups || !groups.has(groupKey)) {
      return null;
    }
    const metadata = groups.get(groupKey);
    const { mesh, placementKeys = [], ownerKey } = metadata ?? {};

    if (mesh?.parent) {
      mesh.parent.remove(mesh);
    }
    mesh?.geometry?.dispose?.();
    metadata?.tintAttribute?.dispose?.();

    if (chunk.blockLookup) {
      chunk.blockLookup.delete(groupKey);
      placementKeys.forEach((key) => {
        chunk.blockLookup.delete(key);
      });
    }

    groups.delete(groupKey);
    if (chunk.decorationGroupsByOwner && ownerKey) {
      const ownerSet = chunk.decorationGroupsByOwner.get(ownerKey);
      if (ownerSet) {
        ownerSet.delete(groupKey);
        if (ownerSet.size === 0) {
          chunk.decorationGroupsByOwner.delete(ownerKey);
        }
      }
    }

    return metadata;
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

    if (removed?.key && chunk.decorationGroupsByOwner) {
      const ownerGroups = chunk.decorationGroupsByOwner.get(removed.key);
      if (ownerGroups && ownerGroups.size > 0) {
        Array.from(ownerGroups).forEach((groupKey) => {
          removeDecorationGroup({ chunk, groupKey });
        });
      }
    }

    return removed;
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
