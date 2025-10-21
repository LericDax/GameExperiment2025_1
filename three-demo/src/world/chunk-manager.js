import * as THREE from 'three';

import {
  createChunkBuildTask,
  createChunkWorkerStartPayload,
  getWorldOptions,
  buildInstancedBlockMesh,
  makeBlockKey,
  isBlockOccluding,
} from './generation.js';
import { createChunkBlockIndex, isChunkBlockIndex } from './chunk-block-index.js';
import { finalizeChunkMeshes } from './finalize-chunk-meshes.js';
import { deriveCollisionKeySetsFromMesh } from './collision-key-utils.js';
import { pruneOccludedInstancedEntries } from './instanced-occlusion-utils.js';
import { serializeInstancedEntry } from './chunk-payload-serializers.js';
import {
  createFluidSurface,
  disposeFluidSurface,
  applyFluidSurfaceMetadata,
} from './fluids/fluid-registry.js';
import { buildFluidGeometry } from './fluids/fluid-geometry.js';
import {
  invalidateTerrainSamplesForChunk,
  pruneTerrainSampleCacheOutsideRadius,
  clearTerrainSampleCache,
} from './terrain-sample-cache.js';
import { createChunkBuildWorker } from './workers/chunk-build.worker.js';
import {
  createChunkStoreQueue,
  DEFAULT_CHUNK_STORE_TIMEOUT_MS,
} from './persist/chunk-store-queue.js';
import {
  DEFAULT_COMPACTION_THRESHOLDS,
  mergeSnapshotWithJournals,
  shouldCompactJournal,
} from './persist/snapshot.ts';
import { encodeJournalOps, JournalOpId } from './persist/journal.ts';
import { WORLD_BUDGET } from './world-settings.js';

export const ChunkManagerEvents = Object.freeze({
  FIRST_CHUNK_MESHED: 'first-chunk-meshed',
});

const worldConfig = getWorldOptions();

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

function serializeError(error) {
  if (!error) {
    return null;
  }
  const message = error?.message ?? String(error);
  const name = error?.name ?? 'Error';
  const stack = error?.stack ?? null;
  return { name, message, stack };
}

function cloneEntityMeta(meta) {
  if (meta == null) {
    return meta ?? null;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(meta);
    } catch (error) {
      console.debug('[chunk-manager] Failed to structuredClone entity meta', error);
    }
  }
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch (error) {
    console.debug('[chunk-manager] Failed to clone entity meta via JSON', error);
  }
  return meta;
}

function normalizeEntityTransform(transform) {
  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  if (transform instanceof Float32Array) {
    const limit = Math.min(transform.length, 16);
    for (let i = 0; i < limit; i += 1) {
      matrix[i] = Number.isFinite(transform[i]) ? transform[i] : matrix[i];
    }
    return matrix;
  }
  if (Array.isArray(transform)) {
    const limit = Math.min(transform.length, 16);
    for (let i = 0; i < limit; i += 1) {
      const value = Number(transform[i]);
      matrix[i] = Number.isFinite(value) ? value : matrix[i];
    }
  }
  return matrix;
}

function clonePersistedEntityRecord(record) {
  if (!record) {
    return null;
  }
  const normalizedId = String(record.id ?? '');
  if (!normalizedId) {
    return null;
  }
  return {
    id: normalizedId,
    typeId: String(record.typeId ?? ''),
    transform: normalizeEntityTransform(record.transform),
    meta: cloneEntityMeta(record.meta),
  };
}

function normalizeEntityStats(stats) {
  return {
    entries: Math.max(0, Math.floor(stats?.entries ?? 0)),
    bytes: Math.max(0, Math.floor(stats?.bytes ?? 0)),
  };
}

function applyEntityDeltaToRecords(records, delta, entityIndex, key) {
  if (!records || !delta) {
    return;
  }
  if (delta.kind === 'place') {
    const cloned = clonePersistedEntityRecord(delta.record);
    if (!cloned) {
      return;
    }
    records.set(cloned.id, cloned);
    if (entityIndex && key) {
      entityIndex.set(cloned.id, key);
    }
    return;
  }
  const normalizedId = String(delta.id ?? '');
  if (!normalizedId) {
    return;
  }
  records.delete(normalizedId);
  entityIndex?.delete(normalizedId);
}

function resolveChunkKeyFromTransform(transform) {
  if (!(transform instanceof Float32Array) && !Array.isArray(transform)) {
    return {
      key: chunkKey(0, 0),
      chunkX: 0,
      chunkZ: 0,
    };
  }
  const x = Number(transform[12] ?? 0);
  const z = Number(transform[14] ?? 0);
  const chunkX = worldToChunk(Number.isFinite(x) ? x : 0);
  const chunkZ = worldToChunk(Number.isFinite(z) ? z : 0);
  return {
    key: chunkKey(chunkX, chunkZ),
    chunkX,
    chunkZ,
  };
}

function createPreloadBucketQueue({ detailLevels, normalizeDetailLevel }) {
  const detailOrder = Array.isArray(detailLevels)
    ? [...detailLevels]
    : [];
  const fallbackDetail = detailOrder[detailOrder.length - 1] ?? 'core';
  const buckets = new Map(detailOrder.map((level) => [level, []]));
  let entryDetails = new WeakMap();
  const status = { pendingBuildsThrottled: false };

  const resolveBucketKey = (entry) => {
    if (!entry) {
      return fallbackDetail;
    }
    const requestedDetail =
      entry.desiredDetailLevel ?? entry.detailLevel ?? fallbackDetail;
    return normalizeDetailLevel(requestedDetail ?? fallbackDetail);
  };

  const getBucket = (level) => {
    const normalized = normalizeDetailLevel(level ?? fallbackDetail);
    return buckets.get(normalized) ?? buckets.get(fallbackDetail);
  };

  const removeFromBucket = (entry, level) => {
    if (!entry) {
      return false;
    }
    const bucket = getBucket(level);
    if (!bucket) {
      return false;
    }
    const index = bucket.indexOf(entry);
    if (index === -1) {
      return false;
    }
    bucket.splice(index, 1);
    return true;
  };

  const totalLength = () => {
    let total = 0;
    detailOrder.forEach((level) => {
      total += getBucket(level)?.length ?? 0;
    });
    return total;
  };

  const indexOfEntry = (entry) => {
    if (!entry) {
      return -1;
    }
    const currentDetail = entryDetails.get(entry) ?? null;
    if (currentDetail) {
      const bucket = getBucket(currentDetail);
      const bucketIndex = bucket.indexOf(entry);
      if (bucketIndex !== -1) {
        let offset = 0;
        for (const level of detailOrder) {
          if (level === currentDetail) {
            return offset + bucketIndex;
          }
          offset += getBucket(level)?.length ?? 0;
        }
        return bucketIndex;
      }
    }
    let offset = 0;
    for (const level of detailOrder) {
      const bucket = getBucket(level);
      const bucketIndex = bucket.indexOf(entry);
      if (bucketIndex !== -1) {
        entryDetails.set(entry, level);
        return offset + bucketIndex;
      }
      offset += bucket.length;
    }
    return -1;
  };

  const getByIndex = (index) => {
    if (index < 0) {
      return undefined;
    }
    let offset = index;
    for (const level of detailOrder) {
      const bucket = getBucket(level);
      if (offset < bucket.length) {
        return bucket[offset];
      }
      offset -= bucket.length;
    }
    return undefined;
  };

  return {
    push(entry) {
      if (!entry) {
        return;
      }
      const bucketKey = resolveBucketKey(entry);
      getBucket(bucketKey).push(entry);
      entryDetails.set(entry, bucketKey);
    },
    update(entry) {
      if (!entry || !entryDetails.has(entry)) {
        return;
      }
      const nextDetail = resolveBucketKey(entry);
      const currentDetail = entryDetails.get(entry);
      if (currentDetail === nextDetail) {
        return;
      }
      const removed = removeFromBucket(entry, currentDetail);
      if (!removed) {
        return;
      }
      getBucket(nextDetail).push(entry);
      entryDetails.set(entry, nextDetail);
    },
    remove(entry) {
      if (!entry) {
        return false;
      }
      const currentDetail = entryDetails.get(entry);
      if (currentDetail && removeFromBucket(entry, currentDetail)) {
        entryDetails.delete(entry);
        return true;
      }
      let removed = false;
      for (const level of detailOrder) {
        if (removeFromBucket(entry, level)) {
          removed = true;
          break;
        }
      }
      if (removed) {
        entryDetails.delete(entry);
      }
      return removed;
    },
    get(index) {
      return getByIndex(index);
    },
    indexOf(entry) {
      return indexOfEntry(entry);
    },
    sort(compareFn) {
      detailOrder.forEach((level) => {
        getBucket(level).sort(compareFn);
      });
    },
    clear() {
      detailOrder.forEach((level) => {
        const bucket = getBucket(level);
        bucket.length = 0;
      });
      entryDetails = new WeakMap();
    },
    isEmpty() {
      return totalLength() === 0;
    },
    forEach(callback) {
      detailOrder.forEach((level) => {
        const bucket = getBucket(level);
        bucket.forEach((entry, index) => {
          callback(entry, level, index);
        });
      });
    },
    forEachReverse(callback) {
      for (let levelIndex = detailOrder.length - 1; levelIndex >= 0; levelIndex -= 1) {
        const level = detailOrder[levelIndex];
        const bucket = getBucket(level);
        for (let i = bucket.length - 1; i >= 0; i -= 1) {
          callback(bucket[i], level, i);
        }
      }
    },
    getBucketEntries(level) {
      return getBucket(level);
    },
    getBucketSize(level) {
      return getBucket(level)?.length ?? 0;
    },
    get length() {
      return totalLength();
    },
    get status() {
      return status;
    },
    setStatus(key, value) {
      if (!key) {
        return;
      }
      status[key] = Boolean(value);
    },
    getStatus(key) {
      return status[key];
    },
  };
}

const sharedArrayBufferCtor =
  typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : null;

function addTransferableBuffer(buffer, targetSet) {
  if (!buffer) {
    return;
  }
  if (sharedArrayBufferCtor && buffer instanceof sharedArrayBufferCtor) {
    return;
  }
  if (buffer instanceof ArrayBuffer) {
    targetSet.add(buffer);
  }
}

function scanTransferableCandidate(candidate, targetSet, seen) {
  if (candidate == null) {
    return;
  }
  if (candidate instanceof ArrayBuffer) {
    addTransferableBuffer(candidate, targetSet);
    return;
  }
  if (ArrayBuffer.isView(candidate)) {
    addTransferableBuffer(candidate.buffer, targetSet);
    return;
  }
  if (typeof candidate !== 'object') {
    return;
  }
  if (seen.has(candidate)) {
    return;
  }
  seen.add(candidate);
  if (Array.isArray(candidate)) {
    candidate.forEach((value) =>
      scanTransferableCandidate(value, targetSet, seen),
    );
    return;
  }
  if (candidate instanceof Set) {
    candidate.forEach((value) =>
      scanTransferableCandidate(value, targetSet, seen),
    );
    return;
  }
  if (candidate instanceof Map) {
    candidate.forEach((value) =>
      scanTransferableCandidate(value, targetSet, seen),
    );
  }
}

function extractPersistenceTransferables(result) {
  if (result == null) {
    return [];
  }
  const buffers = new Set();
  const seen = new Set();
  const scan = (candidate) =>
    scanTransferableCandidate(candidate, buffers, seen);

  if (
    result instanceof ArrayBuffer ||
    ArrayBuffer.isView(result) ||
    Array.isArray(result) ||
    result instanceof Set
  ) {
    scan(result);
  }

  if (result && typeof result === 'object') {
    scan(result.transferables);
    scan(result.payloadTransferables);
    if ('buffers' in result) {
      scan(result.buffers);
    }
    const payload = result.payload;
    if (payload && typeof payload === 'object') {
      scan(payload.transferables);
      scan(payload.payloadTransferables);
      if ('buffers' in payload) {
        scan(payload.buffers);
      }
    }
  }

  return Array.from(buffers);
}

function updateEntryPersistenceMetadata(entry, { stateOverride } = {}) {
  if (!entry || !entry.metadata || entry.metadata.mode !== 'worker') {
    return;
  }
  const rawState = stateOverride ?? entry.persistenceState ?? 'ready';
  const state = rawState === 'idle' ? 'pending' : rawState;
  const metadata = entry.metadata;
  const persistenceDescriptor = {
    state,
    result: null,
    transferables: [],
  };
  let transferables = [];
  if (state === 'ready') {
    const result = entry.persistenceResult ?? null;
    persistenceDescriptor.result = result;
    transferables = extractPersistenceTransferables(result);
    if (result?.syntheticFallback === true) {
      persistenceDescriptor.syntheticFallback = true;
    }
  } else if (state === 'failed') {
    persistenceDescriptor.result = null;
    const errorInfo = serializeError(entry.persistenceError);
    if (errorInfo) {
      persistenceDescriptor.error = errorInfo;
    }
  } else {
    persistenceDescriptor.result = null;
  }
  persistenceDescriptor.transferables = transferables;
  metadata.startPersistence = persistenceDescriptor;
  metadata.buffers = transferables;
}

function cloneByteArray(source) {
  if (!source) {
    return null;
  }
  if (source instanceof Uint8Array) {
    return source.slice();
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source).slice();
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  }
  return null;
}

function normalizeJournalPayloads(journals) {
  if (!Array.isArray(journals)) {
    return [];
  }
  const normalized = [];
  journals.forEach((entry) => {
    const clone = cloneByteArray(entry);
    if (clone && clone.byteLength > 0) {
      normalized.push(clone);
    }
  });
  return normalized;
}

function materializeVoxelField(snapshotBuffer, journalBuffers) {
  if (!snapshotBuffer || snapshotBuffer.byteLength === 0) {
    return null;
  }
  if (!Array.isArray(journalBuffers) || journalBuffers.length === 0) {
    return null;
  }
  try {
    const mergeResult = mergeSnapshotWithJournals(snapshotBuffer, journalBuffers);
    return {
      voxelField: mergeResult.state ?? null,
      mergedSnapshot: mergeResult.payload ?? null,
      journalOps: mergeResult.journalOps ?? 0,
      journalBytes: mergeResult.journalBytes ?? 0,
    };
  } catch (error) {
    console.warn('[chunk-manager] Failed to merge chunk snapshot with journals.', error);
    return null;
  }
}

function applyVoxelFieldToPayload(payload, voxelField, metadata = null) {
  if (!payload || !voxelField) {
    return null;
  }
  const occupancy = payload.occupancy;
  if (!occupancy) {
    return null;
  }
  const { width, height, depth, types } = occupancy;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth) ||
    width !== voxelField.sizeX ||
    height !== voxelField.sizeY ||
    depth !== voxelField.sizeZ
  ) {
    return null;
  }
  if (!(voxelField.blocks instanceof Uint16Array)) {
    return null;
  }
  const blockCount = voxelField.blocks.length;
  if (blockCount !== width * height * depth) {
    return null;
  }
  if (types instanceof Uint16Array && types.length === blockCount) {
    types.set(voxelField.blocks);
  } else {
    occupancy.types = new Uint16Array(voxelField.blocks);
  }
  if (metadata && typeof metadata === 'object') {
    if (Number.isFinite(metadata.minY)) {
      occupancy.minY = Math.floor(metadata.minY);
    }
    if (Number.isFinite(metadata.maxY)) {
      occupancy.maxY = Math.floor(metadata.maxY);
    }
  }
  return payload;
}

function buildPersistenceResult(entry, { snapshot, journals, metadata, mergeInfo }) {
  let payload = null;
  let fallback = true;
  try {
    if (entry?.task?.exportPayloadSnapshot) {
      payload = entry.task.exportPayloadSnapshot();
    }
  } catch (error) {
    console.warn('[chunk-manager] Failed to materialize fallback chunk payload.', error);
    payload = null;
  }

  if (payload && mergeInfo?.voxelField) {
    const applied = applyVoxelFieldToPayload(payload, mergeInfo.voxelField, metadata);
    if (applied) {
      payload = applied;
      fallback = false;
    }
  }

  const hasSnapshot = snapshot instanceof Uint8Array || snapshot instanceof ArrayBuffer;
  const hasJournals = Array.isArray(journals) && journals.length > 0;
  const hasMergeState = Boolean(mergeInfo?.voxelField);
  const hasPersistedState = hasSnapshot || hasJournals || hasMergeState;
  const syntheticFallback = fallback && !hasPersistedState;

  if (syntheticFallback) {
    payload = null;
  }

  return {
    snapshot,
    journals,
    metadata: metadata ?? null,
    payload: payload ?? null,
    fallback,
    syntheticFallback,
    hasPersistedState: hasPersistedState,
    voxelField: mergeInfo?.voxelField ?? null,
    mergedSnapshot: mergeInfo?.mergedSnapshot ?? null,
    journalStats: mergeInfo
      ? { entries: mergeInfo.journalOps ?? 0, bytes: mergeInfo.journalBytes ?? 0 }
      : null,
  };
}

function normalizePersistenceResultForEntry(entry, rawResult) {
  if (!rawResult || typeof rawResult !== 'object') {
    return buildPersistenceResult(entry, {
      snapshot: null,
      journals: [],
      metadata: null,
      mergeInfo: null,
    });
  }

  let container = rawResult;
  if (
    Object.prototype.hasOwnProperty.call(container, 'result') &&
    container.result &&
    typeof container.result === 'object'
  ) {
    container = container.result;
  }

  const directPayload = container?.payload;
  if (directPayload && typeof directPayload === 'object' && !Array.isArray(directPayload)) {
    const hasSnapshotFields =
      Object.prototype.hasOwnProperty.call(directPayload, 'snapshot') ||
      Object.prototype.hasOwnProperty.call(directPayload, 'journals') ||
      Object.prototype.hasOwnProperty.call(directPayload, 'baseSnapshot');
    if (!hasSnapshotFields) {
      return {
        snapshot: null,
        journals: [],
        metadata: container?.metadata ?? rawResult?.metadata ?? null,
        payload: directPayload,
        fallback: false,
        hasPersistedState: true,
        voxelField: null,
        mergedSnapshot: null,
        journalStats: null,
      };
    }
    container = { ...container, ...directPayload };
  }

  const metadata = container?.metadata ?? rawResult?.metadata ?? null;
  const snapshotSource =
    container?.snapshot ?? container?.baseSnapshot ?? rawResult?.snapshot ?? rawResult?.baseSnapshot ?? null;
  const snapshot = cloneByteArray(snapshotSource);
  const journals = normalizeJournalPayloads(
    container?.journals ?? container?.journal ?? rawResult?.journals ?? rawResult?.journal ?? [],
  );
  const mergeInfo = snapshot && journals.length > 0 ? materializeVoxelField(snapshot, journals) : null;

  return buildPersistenceResult(entry, {
    snapshot,
    journals,
    metadata,
    mergeInfo,
  });
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

let chunkBuildWorkerInstance = null;
let chunkBuildWorkerFailed = false;
let chunkBuildWorkerFactoryOverride = null;
let chunkPersistenceQueueFactoryOverride = null;

function disposeCurrentChunkBuildWorker() {
  if (!chunkBuildWorkerInstance) {
    return;
  }
  try {
    chunkBuildWorkerInstance.terminate?.();
  } catch (error) {
    console.warn('[chunk-manager] Failed to dispose chunk build worker', error);
  }
  chunkBuildWorkerInstance = null;
}

export function __setChunkBuildWorkerFactoryForTest(factory) {
  disposeCurrentChunkBuildWorker();
  chunkBuildWorkerFailed = false;
  chunkBuildWorkerFactoryOverride = typeof factory === 'function' ? factory : null;
}

export function __resetChunkBuildWorkerFactoryForTest() {
  __setChunkBuildWorkerFactoryForTest(null);
}

export function __setChunkPersistenceQueueFactoryForTest(factory) {
  chunkPersistenceQueueFactoryOverride =
    typeof factory === 'function' ? factory : null;
}

export function __resetChunkPersistenceQueueFactoryForTest() {
  __setChunkPersistenceQueueFactoryForTest(null);
}

const enableChunkBuildWorker = (() => {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : null;
  if (globalScope?.__ENABLE_CHUNK_WORKER__ === true) {
    return true;
  }
  if (globalScope?.__DISABLE_CHUNK_WORKER__ === true) {
    return false;
  }
  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    const flag =
      import.meta.env.VITE_ENABLE_CHUNK_WORKER ??
      import.meta.env.VITE_CHUNK_WORKER ??
      null;
    if (typeof flag === 'string') {
      const normalized = flag.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    } else if (typeof flag === 'boolean') {
      return flag;
    }
  }
  // Default to the worker path when the environment supports Worker and the
  // host has not explicitly opted out. This keeps chunk generation off the
  // main thread for typical browser builds.
  return typeof Worker !== 'undefined';
})();

function shouldUseChunkBuildWorker() {
  if (chunkBuildWorkerFactoryOverride) {
    return true;
  }
  if (!enableChunkBuildWorker) {
    return false;
  }
  if (typeof Worker === 'undefined') {
    return false;
  }
  if (chunkBuildWorkerFailed) {
    return false;
  }
  return true;
}

function ensureChunkBuildWorkerInstance() {
  if (!shouldUseChunkBuildWorker()) {
    return null;
  }
  if (chunkBuildWorkerInstance) {
    return chunkBuildWorkerInstance;
  }
  try {
    const workerFactory = chunkBuildWorkerFactoryOverride ?? createChunkBuildWorker;
    chunkBuildWorkerInstance = workerFactory();
  } catch (error) {
    chunkBuildWorkerFailed = true;
    chunkBuildWorkerInstance = null;
    console.warn('[chunk-manager] Failed to create chunk build worker', error);
  }
  return chunkBuildWorkerInstance;
}


const fluidNeighborOffsets = [
  { key: 'px', dx: 1, dz: 0, opposite: 'nx' },
  { key: 'nx', dx: -1, dz: 0, opposite: 'px' },
  { key: 'pz', dx: 0, dz: 1, opposite: 'nz' },
  { key: 'nz', dx: 0, dz: -1, opposite: 'pz' },
];

const blockNeighborOffsets = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

function parseBlockCoordinateKey(key) {
  if (typeof key !== 'string') {
    return null;
  }
  const parts = key.split('|');
  if (parts.length !== 3) {
    return null;
  }
  const x = Number.parseInt(parts[0], 10);
  const y = Number.parseInt(parts[1], 10);
  const z = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}


export function createChunkManager({
  scene,
  blockMaterials,
  viewDistance = 1,
  retainDistance: initialRetainDistance,
  maxPreloadPerUpdate: initialMaxPreloadPerUpdate = 2,
  maxDisposalsPerUpdate: initialMaxDisposalsPerUpdate = 1,
  maxActivationsPerUpdate: initialMaxActivationsPerUpdate = 2,
  payloadCacheSize = 0,
  // Additional chunk radius allowed beyond the retention distance before
  // disposal kicks in. This gives callers a way to keep edge chunks alive
  // a little longer (or indefinitely with Infinity) to hide visual pops.
  disposalMargin = 0,
  chunkPersistenceQueue: providedChunkPersistenceQueue = undefined,
  chunkPersistenceTimeout = DEFAULT_CHUNK_STORE_TIMEOUT_MS,
  entityStore = null,
  entityAutosaveIntervalMs = undefined,
  entityCompactionThresholds = undefined,
  budgetCallbacks = undefined,
  workerBroker: providedWorkerBroker = null,
}) {
  const loadedChunks = new Map();

  const resolveChunkTouchTimestamp = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  function touchLoadedChunkRecord(key, chunk = loadedChunks.get(key), timestamp) {
    if (!key || !chunk) {
      return null;
    }
    const resolvedTimestamp =
      typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? timestamp
        : resolveChunkTouchTimestamp();
    chunk.lastTouchedAt = resolvedTimestamp;
    if (loadedChunks.get(key) !== chunk) {
      loadedChunks.set(key, chunk);
    }
    return chunk;
  }
  const scoutPreviewMemoryByChunk = new Map();
  const scoutPreviewMemoryTotals = {
    vertexBytes: 0,
    colorBytes: 0,
    indexBytes: 0,
  };

  function subtractScoutPreviewTotals(stats) {
    if (!stats) {
      return;
    }
    scoutPreviewMemoryTotals.vertexBytes = Math.max(
      0,
      scoutPreviewMemoryTotals.vertexBytes - (stats.vertexBytes ?? 0),
    );
    scoutPreviewMemoryTotals.colorBytes = Math.max(
      0,
      scoutPreviewMemoryTotals.colorBytes - (stats.colorBytes ?? 0),
    );
    scoutPreviewMemoryTotals.indexBytes = Math.max(
      0,
      scoutPreviewMemoryTotals.indexBytes - (stats.indexBytes ?? 0),
    );
  }

  function addScoutPreviewTotals(stats) {
    if (!stats) {
      return;
    }
    scoutPreviewMemoryTotals.vertexBytes += stats.vertexBytes ?? 0;
    scoutPreviewMemoryTotals.colorBytes += stats.colorBytes ?? 0;
    scoutPreviewMemoryTotals.indexBytes += stats.indexBytes ?? 0;
  }

  function normalizeScoutPreviewStats(stats) {
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    const normalizeBytes = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
      }
      return Math.max(0, Math.floor(numeric));
    };
    const normalizeCount = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
      }
      return Math.max(0, Math.floor(numeric));
    };
    const vertexBytes = normalizeBytes(stats.vertexBytes);
    const colorBytes = normalizeBytes(stats.colorBytes);
    const indexBytes = normalizeBytes(stats.indexBytes);
    const vertexCount = normalizeCount(stats.vertexCount);
    const indexCount = normalizeCount(stats.indexCount);
    const totalBytes = vertexBytes + colorBytes + indexBytes;
    return {
      vertexBytes,
      colorBytes,
      indexBytes,
      vertexCount,
      indexCount,
      totalBytes,
    };
  }

  function setScoutPreviewMemoryForChunkKey(key, stats, coordinates = null) {
    if (!key) {
      return null;
    }
    const previous = scoutPreviewMemoryByChunk.get(key) ?? null;
    if (previous) {
      subtractScoutPreviewTotals(previous);
      if (coordinates) {
        emitScoutPreviewCleared({
          key,
          chunkX: coordinates.chunkX ?? null,
          chunkZ: coordinates.chunkZ ?? null,
          stats: previous,
        });
      }
    }
    if (!stats) {
      scoutPreviewMemoryByChunk.delete(key);
      return null;
    }
    const normalized = normalizeScoutPreviewStats(stats);
    if (!normalized) {
      scoutPreviewMemoryByChunk.delete(key);
      return null;
    }
    scoutPreviewMemoryByChunk.set(key, normalized);
    addScoutPreviewTotals(normalized);
    emitScoutPreviewTracked({
      key,
      chunkX: coordinates?.chunkX ?? null,
      chunkZ: coordinates?.chunkZ ?? null,
      stats: normalized,
    });
    return normalized;
  }

  function clearScoutPreviewMemoryForChunkKey(key, coordinates = null) {
    if (!key || !scoutPreviewMemoryByChunk.has(key)) {
      return;
    }
    const previous = scoutPreviewMemoryByChunk.get(key);
    subtractScoutPreviewTotals(previous);
    scoutPreviewMemoryByChunk.delete(key);
    emitScoutPreviewCleared({
      key,
      chunkX: coordinates?.chunkX ?? null,
      chunkZ: coordinates?.chunkZ ?? null,
      stats: previous ?? null,
    });
  }

  function getScoutPreviewMemoryTotals() {
    const vertexBytes = scoutPreviewMemoryTotals.vertexBytes;
    const colorBytes = scoutPreviewMemoryTotals.colorBytes;
    const indexBytes = scoutPreviewMemoryTotals.indexBytes;
    const chunkCount = scoutPreviewMemoryByChunk.size;
    const totalBytes = vertexBytes + colorBytes + indexBytes;
    const perChunkAverageBytes =
      chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0;
    return {
      vertexBytes,
      colorBytes,
      indexBytes,
      totalBytes,
      trackedChunkCount: chunkCount,
      perChunkAverageBytes,
    };
  }
  const solidBlocks = createChunkBlockIndex({
    chunkSize: worldConfig.chunkSize,
  });
  const softBlocks = createChunkBlockIndex({
    chunkSize: worldConfig.chunkSize,
  });
  const waterColumns = new Map();
  const decorationGroupsByKey = new Map();
  const decorationOwnersIndex = new Map();
  const prototypeRemovalGuards = new Set();
  const chunkDisposalQueue = [];
  const scheduledChunkDisposals = new Set();
  function resolveResidentChunkCap() {
    const options = getWorldOptions();
    const candidate = Number(options?.budget?.residentChunks);
    if (Number.isFinite(candidate)) {
      return Math.max(0, Math.floor(candidate));
    }
    const fallback = Number(WORLD_BUDGET?.residentChunks);
    if (Number.isFinite(fallback)) {
      return Math.max(0, Math.floor(fallback));
    }
    return Number.POSITIVE_INFINITY;
  }

  function resolvePendingBuildCap() {
    const options = getWorldOptions();
    const candidate = Number(options?.budget?.pendingBuilds);
    if (Number.isFinite(candidate)) {
      return Math.max(0, Math.floor(candidate));
    }
    const fallback = Number(WORLD_BUDGET?.pendingBuilds);
    if (Number.isFinite(fallback)) {
      return Math.max(0, Math.floor(fallback));
    }
    return Number.POSITIVE_INFINITY;
  }

  function resolveMeshCommitCap() {
    const options = getWorldOptions();
    const candidate = Number(options?.budget?.meshCommits);
    if (Number.isFinite(candidate)) {
      return Math.max(0, Math.floor(candidate));
    }
    const fallback = Number(WORLD_BUDGET?.meshCommits);
    if (Number.isFinite(fallback)) {
      return Math.max(0, Math.floor(fallback));
    }
    return Number.POSITIVE_INFINITY;
  }

  function ensureResidentCapacityForChunk(
    key,
    { protectedKeys = [] } = {},
  ) {
    if (!key) {
      return [];
    }
    const cap = resolveResidentChunkCap();
    if (!Number.isFinite(cap)) {
      return [];
    }
    const alreadyLoaded = loadedChunks.has(key);
    const projectedSize = loadedChunks.size + (alreadyLoaded ? 0 : 1);
    let overBudget = projectedSize - cap;
    if (overBudget <= 0) {
      return [];
    }
    const protectedSet = new Set();
    const addProtectedKey = (candidate) => {
      if (!candidate) {
        return;
      }
      const normalized = String(candidate);
      if (!normalized) {
        return;
      }
      protectedSet.add(normalized);
    };
    addProtectedKey(key);
    if (Array.isArray(protectedKeys)) {
      protectedKeys.forEach(addProtectedKey);
    } else if (protectedKeys instanceof Set) {
      protectedKeys.forEach(addProtectedKey);
    } else {
      addProtectedKey(protectedKeys);
    }

    const evictionCandidates = [];
    loadedChunks.forEach((chunk, chunkKey) => {
      if (protectedSet.has(chunkKey) || scheduledChunkDisposals.has(chunkKey)) {
        return;
      }
      const lastTouchedAt = Number.isFinite(chunk?.lastTouchedAt)
        ? chunk.lastTouchedAt
        : Number.NEGATIVE_INFINITY;
      evictionCandidates.push({ key: chunkKey, lastTouchedAt });
    });
    if (evictionCandidates.length === 0) {
      processChunkDisposalQueue(Number.POSITIVE_INFINITY);
      return [];
    }
    evictionCandidates.sort((a, b) => {
      if (a.lastTouchedAt === b.lastTouchedAt) {
        return a.key.localeCompare(b.key);
      }
      return a.lastTouchedAt - b.lastTouchedAt;
    });
    const queuedKeys = [];
    for (const candidate of evictionCandidates) {
      if (overBudget <= 0) {
        break;
      }
      queueChunkForDisposal(candidate.key, { front: true });
      queuedKeys.push(candidate.key);
      overBudget -= 1;
    }
    if (queuedKeys.length > 0 || overBudget > 0) {
      processChunkDisposalQueue(Number.POSITIVE_INFINITY);
    }
    return queuedKeys;
  }
  const raycastTargets = new Set();
  const isDevBuild = Boolean(import.meta.env && import.meta.env.DEV);
  const eventListeners = new Map();
  const budgetCallbacksNormalized = (() => {
    if (!budgetCallbacks || typeof budgetCallbacks !== 'object') {
      return {
        chunkMeshed: null,
        chunkDisposed: null,
        scoutPreviewTracked: null,
        scoutPreviewCleared: null,
      };
    }
    return {
      chunkMeshed:
        typeof budgetCallbacks.onChunkMeshed === 'function'
          ? budgetCallbacks.onChunkMeshed
          : null,
      chunkDisposed:
        typeof budgetCallbacks.onChunkDisposed === 'function'
          ? budgetCallbacks.onChunkDisposed
          : null,
      scoutPreviewTracked:
        typeof budgetCallbacks.onScoutPreviewTracked === 'function'
          ? budgetCallbacks.onScoutPreviewTracked
          : null,
      scoutPreviewCleared:
        typeof budgetCallbacks.onScoutPreviewCleared === 'function'
          ? budgetCallbacks.onScoutPreviewCleared
          : null,
    };
  })();

  const notifyBudgetCallback = (callback, payload, label) => {
    if (typeof callback !== 'function') {
      return;
    }
    try {
      callback(payload);
    } catch (error) {
      console.warn(`[chunk-manager] budget callback ${label} failed`, error);
    }
  };

  const emitChunkMeshed = (payload) =>
    notifyBudgetCallback(
      budgetCallbacksNormalized.chunkMeshed,
      payload,
      'onChunkMeshed',
    );
  const emitChunkDisposed = (payload) =>
    notifyBudgetCallback(
      budgetCallbacksNormalized.chunkDisposed,
      payload,
      'onChunkDisposed',
    );
  const emitScoutPreviewTracked = (payload) =>
    notifyBudgetCallback(
      budgetCallbacksNormalized.scoutPreviewTracked,
      payload,
      'onScoutPreviewTracked',
    );
  const emitScoutPreviewCleared = (payload) =>
    notifyBudgetCallback(
      budgetCallbacksNormalized.scoutPreviewCleared,
      payload,
      'onScoutPreviewCleared',
    );

  const accumulateAttributeBytes = (attribute, state) => {
    if (!attribute) {
      return;
    }
    if (Array.isArray(attribute)) {
      attribute.forEach((entry) => accumulateAttributeBytes(entry, state));
      return;
    }
    const source =
      attribute.array ??
      attribute.data?.array ??
      null;
    if (!source || state.seenArrays.has(source)) {
      return;
    }
    const byteLength = Number(source.byteLength);
    if (Number.isFinite(byteLength) && byteLength > 0) {
      state.totalBytes += byteLength;
    }
    state.attributeCount += 1;
    state.seenArrays.add(source);
  };

  const accumulateIndexBytes = (index, state) => {
    if (!index || !index.array) {
      return;
    }
    accumulateAttributeBytes(index, state);
  };

  const accumulateObjectGeometryBytes = (object, state) => {
    if (!object) {
      return;
    }
    const geometry = object.geometry ?? null;
    if (geometry && !state.seenGeometries.has(geometry)) {
      state.seenGeometries.add(geometry);
      const attributes = geometry.attributes ?? {};
      Object.values(attributes).forEach((attr) => accumulateAttributeBytes(attr, state));
      accumulateIndexBytes(geometry.index ?? null, state);
      const morphAttributes = geometry.morphAttributes ?? {};
      Object.values(morphAttributes).forEach((entry) => {
        if (Array.isArray(entry)) {
          entry.forEach((attr) => accumulateAttributeBytes(attr, state));
        } else {
          accumulateAttributeBytes(entry, state);
        }
      });
    }
    if (object.instanceMatrix) {
      accumulateAttributeBytes(object.instanceMatrix, state);
    }
    if (object.instanceColor) {
      accumulateAttributeBytes(object.instanceColor, state);
    }
    if (object.userData?.tintAttribute) {
      accumulateAttributeBytes(object.userData.tintAttribute, state);
    }
  };

  const computeChunkMemoryStatsForBudget = (chunk) => {
    const state = {
      totalBytes: 0,
      attributeCount: 0,
      meshCount: 0,
      seenArrays: new Set(),
      seenGeometries: new Set(),
    };
    const visitObject = (object) => {
      if (!object) {
        return;
      }
      if (
        object.isMesh ||
        object.isInstancedMesh ||
        object.isPoints ||
        object.isLine ||
        object.isLineSegments
      ) {
        state.meshCount += 1;
        accumulateObjectGeometryBytes(object, state);
      }
    };
    if (chunk?.group?.traverse) {
      chunk.group.traverse((child) => {
        visitObject(child);
      });
    }
    if (Array.isArray(chunk?.fluidSurfaces)) {
      chunk.fluidSurfaces.forEach((surface) => visitObject(surface));
    }
    if (chunk?.decorationGroups instanceof Map) {
      chunk.decorationGroups.forEach((group) => {
        if (group?.mesh) {
          visitObject(group.mesh);
        }
      });
    }
    return {
      geometryBytes: Math.max(0, Math.floor(state.totalBytes)),
      attributeCount: state.attributeCount,
      meshCount: state.meshCount,
    };
  };
  const chunkUpgradeStateByKey = new Map();
  const activeChunkUpgradeQueue = [];
  let maxPreloadPerUpdate = 0;
  let maxDisposalsPerUpdate = 0;
  let maxActivationsPerUpdate = 0;

  let defaultDisposalBudget = 0;
  let defaultActivationBudget = 0;
  let defaultPreloadBurst = 2;
  let derivedChunkColumnsPerChunk = 1;
  let derivedChunkThroughput = 0;
  let derivedActivationFloor = 0;
  let derivedDisposalFloor = 0;
  let derivedPreloadChunkBurst = 1;
  let derivedPreloadChunkWarmup = 1;

  const PRELOAD_CHUNK_MINIMUM_BURST_MULTIPLIER = 2;
  const PRELOAD_CHUNK_WARMUP_MULTIPLIER = 4;
  const PRELOAD_DIRECTIONAL_CHUNK_CAP = 4;

  const normalizeChunkCount = (value) => {
    if (value === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    return Math.max(1, Math.floor(numeric));
  };

  const chunkCountToColumnBudget = (chunkCount) => {
    if (chunkCount === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    const numeric = Number(chunkCount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    const columnsPerChunk = Math.max(1, Math.floor(derivedChunkColumnsPerChunk));
    return Math.max(1, Math.ceil(numeric * columnsPerChunk));
  };

  const computeMinimumChunkBurst = (chunkThroughput) => {
    if (chunkThroughput === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    const normalized = normalizeChunkCount(chunkThroughput);
    if (normalized <= 0) {
      return 1;
    }
    return Math.max(1, normalized * PRELOAD_CHUNK_MINIMUM_BURST_MULTIPLIER);
  };

  const computeWarmupChunkBudget = (chunkThroughput) => {
    if (chunkThroughput === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    const normalized = normalizeChunkCount(chunkThroughput);
    if (normalized <= 0) {
      return Math.max(1, PRELOAD_CHUNK_WARMUP_MULTIPLIER);
    }
    const warmup = Math.max(
      normalized,
      normalized * PRELOAD_CHUNK_WARMUP_MULTIPLIER,
    );
    return Math.max(warmup, computeMinimumChunkBurst(normalized));
  };

  const normalizeStreamingBudgetInput = (value) => {
    if (value === Number.POSITIVE_INFINITY) {
      return { valid: true, value: Number.POSITIVE_INFINITY, clampedToZero: false };
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return { valid: false, value: 0, clampedToZero: false };
    }
    const floored = Math.floor(numeric);
    if (floored < 0) {
      return { valid: true, value: 0, clampedToZero: true };
    }
    return { valid: true, value: floored, clampedToZero: false };
  };

  const getStreamingBudgetValue = (kind) => {
    switch (kind) {
      case 'preload':
        return maxPreloadPerUpdate;
      case 'activation':
        return maxActivationsPerUpdate;
      case 'disposal':
      default:
        return maxDisposalsPerUpdate;
    }
  };

  const setStreamingBudgetValue = (kind, value) => {
    switch (kind) {
      case 'preload':
        maxPreloadPerUpdate = value;
        break;
      case 'activation':
        maxActivationsPerUpdate = value;
        break;
      case 'disposal':
      default:
        maxDisposalsPerUpdate = value;
        break;
    }
  };

  const recomputeStreamingBudgetDefaults = () => {
    const resolvedDisposal = resolveBudget(maxDisposalsPerUpdate, 1);
    const resolvedActivation = resolveBudget(maxActivationsPerUpdate, 2);
    const numeric = Number(maxPreloadPerUpdate);

    const chunkSizeValue = Number.isFinite(worldConfig?.chunkSize)
      ? worldConfig.chunkSize
      : Number(worldConfig?.chunk?.size);
    const normalizedChunkSize =
      Number.isFinite(chunkSizeValue) && chunkSizeValue > 0
        ? Math.max(1, Math.floor(chunkSizeValue))
        : 48;
    derivedChunkColumnsPerChunk = Math.max(
      1,
      normalizedChunkSize * normalizedChunkSize,
    );

    let effectivePreloadBudget = 0;
    if (maxPreloadPerUpdate === Number.POSITIVE_INFINITY) {
      derivedChunkThroughput = Number.POSITIVE_INFINITY;
      effectivePreloadBudget = Number.POSITIVE_INFINITY;
    } else if (!Number.isFinite(numeric) || numeric <= 0) {
      derivedChunkThroughput = 0;
      effectivePreloadBudget = 0;
    } else {
      const floored = Math.max(1, Math.floor(numeric));
      effectivePreloadBudget = Math.max(floored, derivedChunkColumnsPerChunk);
      derivedChunkThroughput = Math.max(
        1,
        Math.ceil(effectivePreloadBudget / derivedChunkColumnsPerChunk),
      );
    }

    if (effectivePreloadBudget !== Number.POSITIVE_INFINITY) {
      maxPreloadPerUpdate = effectivePreloadBudget;
    }

    const chunkMinimumBurst = computeMinimumChunkBurst(derivedChunkThroughput);
    const chunkWarmupBudget = computeWarmupChunkBudget(derivedChunkThroughput);

    derivedPreloadChunkBurst =
      chunkMinimumBurst === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.floor(chunkMinimumBurst));
    derivedPreloadChunkWarmup =
      chunkWarmupBudget === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(derivedPreloadChunkBurst, Math.floor(chunkWarmupBudget));

    const maximumChunkPreloadRequest =
      derivedPreloadChunkWarmup === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : derivedPreloadChunkWarmup + PRELOAD_DIRECTIONAL_CHUNK_CAP;

    derivedActivationFloor = maximumChunkPreloadRequest;
    derivedDisposalFloor = maximumChunkPreloadRequest;

    defaultDisposalBudget = Math.max(resolvedDisposal, derivedDisposalFloor);
    defaultActivationBudget = Math.max(resolvedActivation, derivedActivationFloor);

    if (effectivePreloadBudget === Number.POSITIVE_INFINITY) {
      defaultPreloadBurst = 2;
    } else if (effectivePreloadBudget > 0) {
      const minimumBurstColumns = chunkCountToColumnBudget(
        derivedPreloadChunkBurst,
      );
      defaultPreloadBurst = Math.max(
        1,
        Math.floor(Math.max(effectivePreloadBudget, minimumBurstColumns)),
      );
    } else {
      defaultPreloadBurst = 2;
    }
  };

  const applyInitialStreamingBudgets = () => {
    const initialBudgets = [
      ['preload', initialMaxPreloadPerUpdate],
      ['disposal', initialMaxDisposalsPerUpdate],
      ['activation', initialMaxActivationsPerUpdate],
    ];
    for (const [kind, initialValue] of initialBudgets) {
      const normalized = normalizeStreamingBudgetInput(initialValue);
      setStreamingBudgetValue(kind, normalized.valid ? normalized.value : 0);
    }
    recomputeStreamingBudgetDefaults();
  };

  const setStreamingBudgets = (budgets = {}) => {
    if (!budgets || typeof budgets !== 'object') {
      console.warn('[chunk-manager] Ignoring invalid streaming budget payload', budgets);
      return;
    }
    let changed = false;

    const applyBudgetChange = (kind) => {
      if (!(kind in budgets)) {
        return;
      }
      const normalized = normalizeStreamingBudgetInput(budgets[kind]);
      if (!normalized.valid) {
        console.warn(`[chunk-manager] Ignoring invalid ${kind} budget`, budgets[kind]);
        return;
      }
      if (normalized.clampedToZero) {
        console.warn(`[chunk-manager] Clamping ${kind} budget to 0`, budgets[kind]);
      }
      const currentValue = getStreamingBudgetValue(kind);
      if (currentValue === normalized.value) {
        return;
      }
      setStreamingBudgetValue(kind, normalized.value);
      changed = true;
    };

    applyBudgetChange('preload');
    applyBudgetChange('activation');
    applyBudgetChange('disposal');

    if (changed) {
      recomputeStreamingBudgetDefaults();
    }
  };

  applyInitialStreamingBudgets();
  const addEventListener = (type, listener) => {
    if (!type || typeof listener !== 'function') {
      return () => {};
    }
    let listeners = eventListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      eventListeners.set(type, listeners);
    }
    listeners.add(listener);
    return () => {
      removeEventListener(type, listener);
    };
  };
  const removeEventListener = (type, listener) => {
    if (!type || typeof listener !== 'function') {
      return;
    }
    const listeners = eventListeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (listeners.size === 0) {
      eventListeners.delete(type);
    }
  };
  const dispatchChunkEvent = (type, detail) => {
    const listeners = eventListeners.get(type);
    if (!listeners || listeners.size === 0) {
      return;
    }
    listeners.forEach((listener) => {
      try {
        listener({ type, detail });
      } catch (error) {
        console.error('[chunk-manager] event listener error', error);
      }
    });
    eventListeners.delete(type);
  };
  const events = {
    addEventListener,
    removeEventListener,
  };
  const defaultUpgradeHysteresis = (() => {
    const upgradeConfig =
      worldConfig?.chunk && typeof worldConfig.chunk === 'object'
        ? worldConfig.chunk.upgrade
        : null;
    const hysteresisFrames = Number.isFinite(upgradeConfig?.hysteresisFrames)
      ? Math.max(0, Math.floor(upgradeConfig.hysteresisFrames))
      : 0;
    const hysteresisRadius = Number.isFinite(upgradeConfig?.hysteresisRadius)
      ? Math.max(0, upgradeConfig.hysteresisRadius)
      : 0;
    return { frames: hysteresisFrames, radius: hysteresisRadius };
  })();
  let hasEmittedFirstChunkMeshed = false;
  let lastCenterKey = null;
  let currentViewDistance = normalizeDistance(viewDistance, 1);
  let retentionDistance = Math.max(
    currentViewDistance,
    normalizeDistance(initialRetainDistance, currentViewDistance + 1),
  );
  let lastFiniteViewDistance = Number.isFinite(currentViewDistance)
    ? currentViewDistance
    : 1;
  let lastFiniteRetentionDistance = Number.isFinite(retentionDistance)
    ? retentionDistance
    : Math.max(lastFiniteViewDistance, 1);
  let lastFiniteRetentionRadius = Number.isFinite(retentionDistance)
    ? retentionDistance
    : Math.max(lastFiniteViewDistance, 1);
  const pendingPreloadEntries = new Map();
  const waitingPreloadEntries = new Map();
  const waitingPreloadQueue = [];
  const pendingActivations = [];
  const pendingActivationByKey = new Map();
  const deferredActivations = [];
  const BUDGET_CONGESTION_WARN_THRESHOLD = 3;
  const BUDGET_CONGESTION_LABELS = {
    resident: 'resident chunk cap',
    pendingBuild: 'pending-build cap',
    activation: 'activation cap',
  };
  const budgetCongestionState = {
    resident: { frames: 0, cap: null, count: 0, details: {} },
    pendingBuild: { frames: 0, cap: null, count: 0, details: {} },
    activation: { frames: 0, cap: null, count: 0, details: {} },
  };
  function formatCapValue(cap) {
    if (cap === Number.POSITIVE_INFINITY) {
      return 'Infinity';
    }
    if (cap === Number.NEGATIVE_INFINITY) {
      return '-Infinity';
    }
    if (cap == null) {
      return 'n/a';
    }
    const numeric = Number(cap);
    if (!Number.isFinite(numeric)) {
      return String(cap);
    }
    return String(Math.max(0, Math.floor(numeric)));
  }
  function updateBudgetCongestionState(
    key,
    { congested, cap, count, details },
  ) {
    const state = budgetCongestionState[key];
    if (!state) {
      return;
    }
    state.cap = cap ?? null;
    state.count = Number.isFinite(count) ? count : 0;
    state.details = details && typeof details === 'object' ? { ...details } : {};
    state.frames = congested ? state.frames + 1 : 0;
    if (
      !isDevBuild ||
      !congested ||
      state.frames !== BUDGET_CONGESTION_WARN_THRESHOLD
    ) {
      return;
    }
    const label = BUDGET_CONGESTION_LABELS[key] ?? key;
    const parts = [`cap=${formatCapValue(cap)}`, `count=${state.count}`];
    Object.entries(state.details).forEach(([detailKey, value]) => {
      if (value == null) {
        return;
      }
      parts.push(`${detailKey}=${value}`);
    });
    parts.push(`frames=${state.frames}`);
    console.warn(`[chunk-manager] ${label} congestion (${parts.join(', ')})`);
  }
  function checkBudgetCongestion({
    activationBudget = Number.POSITIVE_INFINITY,
    activationProcessed = 0,
  } = {}) {
    const residentCap = resolveResidentChunkCap();
    const residentCount = loadedChunks.size;
    const residentCongested =
      Number.isFinite(residentCap) && residentCount > residentCap;
    const residentDetails = {
      over:
        residentCongested && Number.isFinite(residentCap)
          ? residentCount - residentCap
          : 0,
      disposalsQueued: chunkDisposalQueue.length,
    };
    updateBudgetCongestionState('resident', {
      congested: residentCongested,
      cap: residentCap,
      count: residentCount,
      details: residentDetails,
    });

    const pendingBuildCap = resolvePendingBuildCap();
    const activePendingBuilds = pendingPreloadEntries.size;
    const waitingPendingBuilds = waitingPreloadQueue.length;
    const pendingBuildCongested =
      Number.isFinite(pendingBuildCap) &&
      pendingBuildCap >= 0 &&
      (activePendingBuilds > pendingBuildCap ||
        (activePendingBuilds >= pendingBuildCap && waitingPendingBuilds > 0));
    const pendingBuildCount =
      waitingPendingBuilds > 0 ? waitingPendingBuilds : activePendingBuilds;
    updateBudgetCongestionState('pendingBuild', {
      congested: pendingBuildCongested,
      cap: pendingBuildCap,
      count: pendingBuildCount,
      details: {
        active: activePendingBuilds,
        waiting: waitingPendingBuilds,
      },
    });

    const meshCommitCap = resolveMeshCommitCap();
    const pendingActivationCount = pendingActivations.length;
    const deferredActivationCount = deferredActivations.length;
    const totalActivationQueue =
      pendingActivationCount + deferredActivationCount;
    const normalizedActivationBudget = Number.isFinite(activationBudget)
      ? Math.max(0, Math.floor(activationBudget))
      : Number.POSITIVE_INFINITY;
    const processedActivations = Math.max(
      0,
      Math.floor(Number(activationProcessed) || 0),
    );
    const activationCongested = (() => {
      if (totalActivationQueue <= 0) {
        return false;
      }
      if (
        deferredActivationCount > 0 &&
        Number.isFinite(meshCommitCap) &&
        meshCommitCap >= 0
      ) {
        return true;
      }
      if (!Number.isFinite(activationBudget)) {
        return false;
      }
      return processedActivations >= normalizedActivationBudget;
    })();
    const activationCapForMessage = Number.isFinite(activationBudget)
      ? normalizedActivationBudget
      : Number.isFinite(meshCommitCap)
        ? meshCommitCap
        : Number.POSITIVE_INFINITY;
    const activationDetails = {
      pending: pendingActivationCount,
      deferred: deferredActivationCount,
      processed: processedActivations,
      capSource:
        deferredActivationCount > 0 && Number.isFinite(meshCommitCap)
          ? 'mesh-commit'
          : Number.isFinite(activationBudget)
            ? 'frame-budget'
            : 'unbounded',
    };
    updateBudgetCongestionState('activation', {
      congested: activationCongested,
      cap: activationCapForMessage,
      count: totalActivationQueue,
      details: activationDetails,
    });
  }
  const chunkJobQueue = [];
  const dirtyChunks = new Set();
  const chunkJournalQueues = new Map();
  const chunkPersistenceState = new Map();
  const chunksPendingCompaction = new Set();
  const chunkEntityState = new Map();
  const entityDeltaQueues = new Map();
  const dirtyEntityChunks = new Set();
  const entityCompactionQueue = new Set();
  const entityIdIndex = new Map();
  let autosaveTimer = null;
  let autosaveRunning = false;
  let compactionTimer = null;
  let compactionRunning = false;
  let entityAutosaveTimer = null;
  let entityAutosaveRunning = false;
  let entityCompactionTimer = null;
  let entityCompactionRunning = false;
  let nextJournalTick = Math.max(1, Math.floor(Date.now()));
  const AUTOSAVE_INTERVAL_MS = 750;
  const COMPACTION_INTERVAL_MS = 2000;
  const entityAutosaveIntervalCandidate = Number(entityAutosaveIntervalMs);
  const entityAutosaveInterval = Math.max(
    16,
    Math.floor(
      Number.isFinite(entityAutosaveIntervalCandidate)
        ? entityAutosaveIntervalCandidate
        : AUTOSAVE_INTERVAL_MS,
    ),
  );
  const normalizedEntityMaxOps = Number(entityCompactionThresholds?.maxOps);
  const normalizedEntityMaxBytes = Number(entityCompactionThresholds?.maxBytes);
  const entityCompactionThresholdsNormalized = {
    maxOps: Number.isFinite(normalizedEntityMaxOps)
      ? Math.max(0, Math.floor(normalizedEntityMaxOps))
      : DEFAULT_COMPACTION_THRESHOLDS.maxOps,
    maxBytes: Number.isFinite(normalizedEntityMaxBytes)
      ? Math.max(0, Math.floor(normalizedEntityMaxBytes))
      : DEFAULT_COMPACTION_THRESHOLDS.maxBytes,
  };
  const chunkPersistenceQueue = (() => {
    if (providedChunkPersistenceQueue === null) {
      return null;
    }
    if (providedChunkPersistenceQueue !== undefined) {
      return providedChunkPersistenceQueue;
    }
    const factory = chunkPersistenceQueueFactoryOverride ?? createChunkStoreQueue;
    if (typeof factory !== 'function') {
      return null;
    }
    try {
      return factory();
    } catch (error) {
      console.warn('[chunk-manager] Failed to create chunk persistence queue', error);
      return null;
    }
  })();
  const chunkPersistenceTimeoutMs = (() => {
    if (chunkPersistenceTimeout === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    const numeric = Number(chunkPersistenceTimeout);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return DEFAULT_CHUNK_STORE_TIMEOUT_MS;
    }
    return Math.floor(numeric);
  })();
  const workerBroker = providedWorkerBroker ?? null;
  const chunkPersistenceJobs = new Map();
  let chunkJobPumpActive = false;
  let chunkJobPumpPromise = null;
  const chunkBuildWorker = workerBroker
    ? workerBroker.getProcgenWorker?.() ?? null
    : ensureChunkBuildWorkerInstance();
  const workerTarget = workerBroker ?? chunkBuildWorker;
  const workerEnabled = Boolean(workerTarget);
  const workerDisposables = [];
  let workerInflightCount = 0;
  const workerUtilizationSamples = { idle: 0, busy: 0 };
  const retentionDisposalMargin = normalizeDistance(disposalMargin, 0);
  const chunkUnitScale = (() => {
    const chunkSizeValue = Number.isFinite(worldConfig?.chunkSize)
      ? worldConfig.chunkSize
      : Number(worldConfig?.chunk?.size);
    if (Number.isFinite(chunkSizeValue) && chunkSizeValue > 0) {
      return chunkSizeValue;
    }
    return 48;
  })();
  const directionalPreloadDefaults = (() => {
    const chunkOptions =
      worldConfig?.chunk && typeof worldConfig.chunk === 'object'
        ? worldConfig.chunk
        : {};
    const preloadOptions =
      chunkOptions.preload && typeof chunkOptions.preload === 'object'
        ? chunkOptions.preload
        : {};
    const forwardConeAngle = Number.isFinite(preloadOptions.forwardConeAngle)
      ? THREE.MathUtils.clamp(preloadOptions.forwardConeAngle, 0, 180)
      : 120;
    const baseLeadDistance = Number.isFinite(preloadOptions.baseLeadDistance)
      ? Math.max(0, preloadOptions.baseLeadDistance)
      : 0.5;
    const speedLeadScale = Number.isFinite(preloadOptions.speedLeadScale)
      ? Math.max(0, preloadOptions.speedLeadScale)
      : 2.5;
    const rearHysteresis = Number.isFinite(preloadOptions.rearHysteresis)
      ? Math.max(0, preloadOptions.rearHysteresis)
      : 2;
    return {
      forwardConeAngle,
      baseLeadDistance,
      speedLeadScale,
      rearHysteresis,
    };
  })();
  const MAX_FORWARD_LEAD_CHUNKS = 6;
  const REAR_PENALTY_SCALE = 0.6;
  let activeDirectionalContext = null;
  const DETAIL_LEVEL_CORE = 'core';
  const DETAIL_LEVEL_RETENTION = 'retention';
  const DETAIL_LEVEL_SCOUT = 'scout';
  const DETAIL_LEVELS = [
    DETAIL_LEVEL_SCOUT,
    DETAIL_LEVEL_RETENTION,
    DETAIL_LEVEL_CORE,
  ];
  const normalizeDetailLevel = (value) => {
    if (
      value === DETAIL_LEVEL_RETENTION ||
      value === DETAIL_LEVEL_CORE ||
      value === DETAIL_LEVEL_SCOUT
    ) {
      return value;
    }
    return DETAIL_LEVEL_CORE;
  };
  const detailLevelRank = (value) =>
    DETAIL_LEVELS.indexOf(normalizeDetailLevel(value));
  const preloadQueue = createPreloadBucketQueue({
    detailLevels: DETAIL_LEVELS,
    normalizeDetailLevel,
  });
  let pendingBuildThrottleActive = false;

  const compareWaitingPreloadEntries = (a, b) => {
    if (a?.urgent !== b?.urgent) {
      return a?.urgent ? -1 : 1;
    }
    const priorityA = Number.isFinite(a?.priority)
      ? a.priority
      : Number.POSITIVE_INFINITY;
    const priorityB = Number.isFinite(b?.priority)
      ? b.priority
      : Number.POSITIVE_INFINITY;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return 0;
  };

  function setPendingBuildThrottleActive(active) {
    const next = Boolean(active);
    if (pendingBuildThrottleActive === next) {
      return;
    }
    pendingBuildThrottleActive = next;
    if (typeof preloadQueue.setStatus === 'function') {
      preloadQueue.setStatus('pendingBuildsThrottled', next);
    } else if (
      preloadQueue.status &&
      typeof preloadQueue.status === 'object'
    ) {
      preloadQueue.status.pendingBuildsThrottled = next;
    }
  }

  function updatePendingBuildThrottle() {
    setPendingBuildThrottleActive(waitingPreloadQueue.length > 0);
  }

  function removeWaitingPreloadEntry(entry) {
    if (!entry) {
      return;
    }
    const index = waitingPreloadQueue.indexOf(entry);
    if (index >= 0) {
      waitingPreloadQueue.splice(index, 1);
    }
  }

  function queueWaitingPreloadEntry(entry) {
    if (!entry) {
      return;
    }
    removeWaitingPreloadEntry(entry);
    const insertIndex = waitingPreloadQueue.findIndex((candidate) =>
      compareWaitingPreloadEntries(entry, candidate) < 0,
    );
    if (insertIndex === -1) {
      waitingPreloadQueue.push(entry);
    } else {
      waitingPreloadQueue.splice(insertIndex, 0, entry);
    }
  }

  function hasPendingBuildCapacity({ force = false } = {}) {
    if (force) {
      return true;
    }
    const cap = resolvePendingBuildCap();
    if (cap === 0) {
      return false;
    }
    if (!Number.isFinite(cap)) {
      return true;
    }
    return pendingPreloadEntries.size < cap;
  }

  function isPendingBuildCapReached() {
    const cap = resolvePendingBuildCap();
    if (cap === 0) {
      return true;
    }
    if (!Number.isFinite(cap)) {
      return false;
    }
    return pendingPreloadEntries.size >= cap;
  }

  function markEntryWaitingForCapacity(entry) {
    if (!entry || !entry.key) {
      return;
    }
    entry.waitingForCapacity = true;
    waitingPreloadEntries.set(entry.key, entry);
    queueWaitingPreloadEntry(entry);
    updatePendingBuildThrottle();
  }

  function tryActivateWaitingEntry(entry, { force = false } = {}) {
    if (!entry || !entry.key || !waitingPreloadEntries.has(entry.key)) {
      return false;
    }
    if (!hasPendingBuildCapacity({ force })) {
      return false;
    }
    waitingPreloadEntries.delete(entry.key);
    removeWaitingPreloadEntry(entry);
    entry.waitingForCapacity = false;
    pendingPreloadEntries.set(entry.key, entry);
    preloadQueue.push(entry);
    queueDirty = true;
    if (entry.pendingBudget > 0 || entry.unlimited) {
      scheduleChunkJobEntry(entry);
    }
    updatePendingBuildThrottle();
    return true;
  }

  function promoteWaitingPreloadEntries({ force = false } = {}) {
    if (waitingPreloadQueue.length === 0) {
      updatePendingBuildThrottle();
      return;
    }
    while (waitingPreloadQueue.length > 0 && hasPendingBuildCapacity({ force })) {
      const entry = waitingPreloadQueue.shift();
      if (!entry || !waitingPreloadEntries.has(entry.key)) {
        continue;
      }
      waitingPreloadEntries.delete(entry.key);
      entry.waitingForCapacity = false;
      pendingPreloadEntries.set(entry.key, entry);
      preloadQueue.push(entry);
      queueDirty = true;
      if (entry.pendingBudget > 0 || entry.unlimited) {
        scheduleChunkJobEntry(entry);
      }
      if (!force && !hasPendingBuildCapacity()) {
        break;
      }
    }
    updatePendingBuildThrottle();
  }

  function getPendingEntryByKey(key) {
    if (key == null) {
      return null;
    }
    const normalized = String(key);
    if (!normalized) {
      return null;
    }
    return (
      pendingPreloadEntries.get(normalized) ??
      waitingPreloadEntries.get(normalized) ??
      null
    );
  }

  function hasMeshCommitCapacity() {
    const cap = resolveMeshCommitCap();
    if (cap === 0) {
      return false;
    }
    if (!Number.isFinite(cap)) {
      return true;
    }
    return pendingActivations.length < cap;
  }

  function promoteDeferredActivations() {
    const cap = resolveMeshCommitCap();
    if (cap === 0) {
      return;
    }
    while (deferredActivations.length > 0) {
      if (Number.isFinite(cap) && pendingActivations.length >= cap) {
        break;
      }
      const record = deferredActivations.shift();
      if (!record) {
        continue;
      }
      record.waitingForActivation = false;
      pendingActivations.push(record);
    }
  }
  const preloadDebugState = {
    queueSizes: {
      [DETAIL_LEVEL_SCOUT]: 0,
      [DETAIL_LEVEL_RETENTION]: 0,
      [DETAIL_LEVEL_CORE]: 0,
    },
    lastBaseBudget: 0,
    lastBaseBudgetSpent: 0,
    lastScoutTopUp: 0,
    lastScoutTopUpSpent: 0,
    lastScoutTopUpRemaining: 0,
    lastProcessedCounts: {
      [DETAIL_LEVEL_SCOUT]: 0,
      [DETAIL_LEVEL_RETENTION]: 0,
      [DETAIL_LEVEL_CORE]: 0,
    },
    workerEnabled,
    workerInflight: 0,
    workerIdleSamples: 0,
    workerBusySamples: 0,
  };
  const resolveDetailLevelForDistance = (
    maxDistance,
    finiteViewRadius,
    finiteRetentionRadius = finiteViewRadius,
  ) => {
    const viewRadius = Number.isFinite(finiteViewRadius)
      ? Math.max(0, Math.floor(finiteViewRadius))
      : Number.isFinite(finiteRetentionRadius)
      ? Math.max(0, Math.floor(finiteRetentionRadius))
      : Number.POSITIVE_INFINITY;
    if (maxDistance <= viewRadius) {
      return DETAIL_LEVEL_CORE;
    }
    const retentionRadius = Number.isFinite(finiteRetentionRadius)
      ? Math.max(viewRadius, Math.floor(finiteRetentionRadius))
      : Number.POSITIVE_INFINITY;
    if (maxDistance <= retentionRadius) {
      return DETAIL_LEVEL_RETENTION;
    }
    return DETAIL_LEVEL_SCOUT;
  };
  function normalizeDirectionalHintInput(candidate) {
    if (!candidate) {
      return null;
    }
    if (candidate.__normalizedDirectional === true) {
      return candidate;
    }
    const headingSource =
      candidate.heading ?? candidate.forward ?? candidate.direction ?? null;
    if (!headingSource) {
      return null;
    }
    const headingX = Number(headingSource.x);
    const headingZ = Number(
      Object.prototype.hasOwnProperty.call(headingSource, 'z')
        ? headingSource.z
        : headingSource.y,
    );
    if (!Number.isFinite(headingX) || !Number.isFinite(headingZ)) {
      return null;
    }
    const headingLength = Math.hypot(headingX, headingZ);
    if (!Number.isFinite(headingLength) || headingLength === 0) {
      return null;
    }
    const normalizedHeadingX = headingX / headingLength;
    const normalizedHeadingZ = headingZ / headingLength;
    const speedValue = Number(candidate.speed);
    const speedMeters = Number.isFinite(speedValue) ? Math.max(0, speedValue) : 0;
    const speedChunks = speedMeters / chunkUnitScale;
    const forwardBoostRaw =
      directionalPreloadDefaults.baseLeadDistance +
      speedChunks * directionalPreloadDefaults.speedLeadScale;
    const forwardBoost = Math.min(
      MAX_FORWARD_LEAD_CHUNKS,
      Math.max(0, forwardBoostRaw),
    );
    if (forwardBoost <= 0 && directionalPreloadDefaults.rearHysteresis <= 0) {
      return null;
    }
    const halfAngleRadians =
      THREE.MathUtils.degToRad(
        THREE.MathUtils.clamp(
          directionalPreloadDefaults.forwardConeAngle,
          0,
          180,
        ),
      ) / 2;
    const coneCos = Math.cos(halfAngleRadians);
    const forwardExtension = Math.max(0, Math.ceil(forwardBoost));
    const priorityBiasFactor =
      forwardBoost > 0 ? (forwardBoost + 1) * 6 : 0;
    return {
      __normalizedDirectional: true,
      heading: { x: normalizedHeadingX, z: normalizedHeadingZ },
      coneCos,
      forwardBoost,
      forwardExtension,
      rearPenalty: forwardBoost * REAR_PENALTY_SCALE,
      rearHysteresis: directionalPreloadDefaults.rearHysteresis,
      priorityBiasFactor,
    };
  }
  function applyDirectionalDistanceBias(baseDistance, offsetX, offsetZ, context) {
    if (!context || baseDistance <= 0) {
      return baseDistance;
    }
    const { heading, coneCos, forwardBoost, rearPenalty } = context;
    if (!heading) {
      return baseDistance;
    }
    const offsetLength = Math.hypot(offsetX, offsetZ);
    if (!Number.isFinite(offsetLength) || offsetLength === 0) {
      return Math.max(0, baseDistance - forwardBoost);
    }
    const dirX = offsetX / offsetLength;
    const dirZ = offsetZ / offsetLength;
    const dot = heading.x * dirX + heading.z * dirZ;
    if (dot >= coneCos) {
      return Math.max(0, baseDistance - forwardBoost);
    }
    if (dot <= -coneCos) {
      return baseDistance + rearPenalty;
    }
    return baseDistance;
  }
  const payloadCache = new Map();
  const normalizeCacheCapacity = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    return Math.max(0, Math.floor(numeric));
  };
  const computeGenerationSignature = () => {
    const terrain = worldConfig.terrain ?? {};
    const terrainSignature = JSON.stringify({
      baseHeight: terrain.baseHeight ?? null,
      maxHeight: terrain.maxHeight ?? null,
      primaryFrequency: terrain.primaryFrequency ?? null,
      primaryAmplitude: terrain.primaryAmplitude ?? null,
      detailFrequency: terrain.detailFrequency ?? null,
      detailAmplitude: terrain.detailAmplitude ?? null,
      ridgeFrequency: terrain.ridgeFrequency ?? null,
      ridgeStrength: terrain.ridgeStrength ?? null,
      climateHeightInfluence: terrain.climateHeightInfluence ?? null,
      shoreSlopeBias: terrain.shoreSlopeBias ?? null,
      tfms: terrain.tfms ? { ...terrain.tfms } : null,
    });
    const biomeSignature = JSON.stringify(worldConfig.biomes ?? {});
    return [
      worldConfig.chunkSize,
      worldConfig.baseHeight,
      worldConfig.maxHeight,
      worldConfig.waterLevel,
      terrainSignature,
      biomeSignature,
    ].join('|');
  };
  let payloadCacheCapacity = normalizeCacheCapacity(payloadCacheSize);
  let lastCacheSeedHash = worldConfig.seedHash;
  let lastCacheSignature = computeGenerationSignature();

  const clearPayloadCacheEntries = () => {
    payloadCache.clear();
  };

  function ensureJournalQueue(key) {
    if (!key) {
      return [];
    }
    let queue = chunkJournalQueues.get(key);
    if (!queue) {
      queue = [];
      chunkJournalQueues.set(key, queue);
    }
    return queue;
  }

  function initializeChunkPersistenceState(
    key,
    chunk,
    payload,
    persistenceResult,
  ) {
    if (!key || !chunk) {
      return;
    }

    const occupancy = payload?.occupancy ?? null;
    const chunkSize = Number.isFinite(worldConfig.chunkSize)
      ? Math.max(1, Math.floor(worldConfig.chunkSize))
      : 16;
    const minY = Number.isFinite(occupancy?.minY)
      ? Math.floor(occupancy.minY)
      : 0;
    const maxY = Number.isFinite(occupancy?.maxY)
      ? Math.floor(occupancy.maxY)
      : minY;
    const sizeX = Number.isFinite(occupancy?.width)
      ? Math.max(1, Math.floor(occupancy.width))
      : chunkSize;
    const sizeZ = Number.isFinite(occupancy?.depth)
      ? Math.max(1, Math.floor(occupancy.depth))
      : chunkSize;
    const derivedHeight = Number.isFinite(occupancy?.height)
      ? Math.max(1, Math.floor(occupancy.height))
      : Math.max(1, maxY - minY + 1);
    const fallbackHeight = Number.isFinite(worldConfig.maxHeight)
      ? Math.max(1, Math.floor(worldConfig.maxHeight))
      : chunkSize;
    const sizeY = Math.max(1, derivedHeight || fallbackHeight);

    const typeEntries = Array.isArray(payload?.typeIndex?.entries)
      ? payload.typeIndex.entries
      : [];
    const typeIds = new Map();
    typeEntries.forEach((entry) => {
      const type = entry?.type ?? null;
      const id = Number.isFinite(entry?.id) ? Math.floor(entry.id) : null;
      if (type && id !== null) {
        typeIds.set(type, id);
      }
    });

    const stats = {
      entries: Math.max(0, Math.floor(persistenceResult?.journalStats?.entries ?? 0)),
      bytes: Math.max(0, Math.floor(persistenceResult?.journalStats?.bytes ?? 0)),
    };

    const snapshot =
      persistenceResult?.mergedSnapshot ??
      persistenceResult?.snapshot ??
      null;

    chunkPersistenceState.set(key, {
      minY,
      sizeX,
      sizeY,
      sizeZ,
      typeIds,
      snapshot,
      stats,
      needsCompaction: false,
      detailLevel: normalizeDetailLevel(
        chunk?.detailLevel ?? payload?.detailLevel ?? DETAIL_LEVEL_CORE,
      ),
    });
    ensureJournalQueue(key);
  }

  function ensureEntityDeltaQueue(key) {
    if (!key) {
      return [];
    }
    let queue = entityDeltaQueues.get(key);
    if (!queue) {
      queue = [];
      entityDeltaQueues.set(key, queue);
    }
    return queue;
  }

  function updateChunkPersistentEntities(key) {
    if (!key) {
      return;
    }
    const chunk = loadedChunks.get(key);
    const state = chunkEntityState.get(key);
    if (!chunk) {
      return;
    }
    if (!state) {
      chunk.persistentEntities = [];
      return;
    }
    chunk.persistentEntities = Array.from(state.records.values());
  }

  function ensureChunkEntityState(key, chunkX, chunkZ, chunk = null) {
    if (!entityStore || typeof entityStore.loadChunkEntities !== 'function') {
      if (chunk) {
        chunk.persistentEntities = [];
      }
      return null;
    }
    if (!key) {
      if (chunk) {
        chunk.persistentEntities = [];
      }
      return null;
    }
    let state = chunkEntityState.get(key);
    if (state) {
      if (chunk) {
        chunk.persistentEntities = Array.from(state.records.values());
      }
      return state;
    }
    let result = null;
    try {
      result = entityStore.loadChunkEntities({ cx: chunkX, cz: chunkZ }) ?? null;
    } catch (error) {
      console.warn('[chunk-manager] Failed to load chunk entities', error);
    }
    const records = new Map();
    const stats = normalizeEntityStats(result?.stats ?? result?.logStats ?? {});
    const snapshot = Array.isArray(result?.snapshot)
      ? result.snapshot
      : Array.isArray(result?.records)
      ? result.records
      : [];
    snapshot.forEach((record) => {
      const cloned = clonePersistedEntityRecord(record);
      if (!cloned) {
        return;
      }
      records.set(cloned.id, cloned);
      entityIdIndex.set(cloned.id, key);
    });
    const deltas = Array.isArray(result?.deltas) ? result.deltas : [];
    deltas.forEach((delta) => applyEntityDeltaToRecords(records, delta, entityIdIndex, key));
    state = {
      records,
      stats,
      needsCompaction: false,
    };
    chunkEntityState.set(key, state);
    ensureEntityDeltaQueue(key);
    if (shouldCompactJournal(state.stats, entityCompactionThresholdsNormalized)) {
      state.needsCompaction = true;
      entityCompactionQueue.add(key);
      scheduleEntityCompactionTimer();
    }
    if (chunk) {
      chunk.persistentEntities = Array.from(records.values());
    }
    return state;
  }

  function markEntityChunkDirty(key) {
    if (!key || !entityStore) {
      return;
    }
    dirtyEntityChunks.add(key);
    scheduleEntityAutosaveTimer();
  }

  async function flushChunkEntityLog(key) {
    if (!key) {
      return;
    }
    const queue = entityDeltaQueues.get(key);
    if (!queue || queue.length === 0) {
      dirtyEntityChunks.delete(key);
      return;
    }
    if (!entityStore || typeof entityStore.appendEntityDeltas !== 'function') {
      dirtyEntityChunks.delete(key);
      return;
    }
    const deltas = queue.splice(0);
    try {
      const statsResult = await entityStore.appendEntityDeltas({ key, deltas });
      const state = chunkEntityState.get(key);
      if (state) {
        const normalizedStats = normalizeEntityStats(statsResult ?? state.stats ?? {});
        if (!statsResult) {
          normalizedStats.entries = Math.max(0, state.stats.entries + deltas.length);
        }
        state.stats = normalizedStats;
        if (shouldCompactJournal(state.stats, entityCompactionThresholdsNormalized)) {
          state.needsCompaction = true;
          entityCompactionQueue.add(key);
          scheduleEntityCompactionTimer();
        }
      }
      dirtyEntityChunks.delete(key);
    } catch (error) {
      console.warn('[chunk-manager] Failed to append entity deltas', error);
      const existing = entityDeltaQueues.get(key) ?? [];
      entityDeltaQueues.set(key, [...deltas, ...existing]);
      dirtyEntityChunks.add(key);
      scheduleEntityAutosaveTimer();
    }
  }

  async function runEntityAutosavePass() {
    if (entityAutosaveRunning || !entityStore) {
      return;
    }
    entityAutosaveRunning = true;
    try {
      const pendingKeys = Array.from(dirtyEntityChunks.values());
      for (const key of pendingKeys) {
        await flushChunkEntityLog(key);
      }
    } finally {
      entityAutosaveRunning = false;
      if (dirtyEntityChunks.size > 0) {
        scheduleEntityAutosaveTimer();
      }
    }
  }

  function scheduleEntityAutosaveTimer() {
    if (!entityStore || dirtyEntityChunks.size === 0) {
      return;
    }
    if (entityAutosaveTimer !== null || entityAutosaveRunning) {
      return;
    }
    entityAutosaveTimer = setTimeout(() => {
      entityAutosaveTimer = null;
      void runEntityAutosavePass();
    }, entityAutosaveInterval);
  }

  async function runEntityCompactionPass() {
    if (entityCompactionRunning || !entityStore) {
      return;
    }
    if (typeof entityStore.compactChunkEntities !== 'function') {
      entityCompactionQueue.clear();
      return;
    }
    entityCompactionRunning = true;
    try {
      for (const key of Array.from(entityCompactionQueue)) {
        const state = chunkEntityState.get(key);
        if (!state || !state.needsCompaction) {
          entityCompactionQueue.delete(key);
          continue;
        }
        try {
          const records = Array.from(state.records.values())
            .map((record) => clonePersistedEntityRecord(record))
            .filter(Boolean);
          await entityStore.compactChunkEntities({ key, records, deltas: [] });
          state.needsCompaction = false;
          state.stats = { entries: 0, bytes: 0 };
          entityCompactionQueue.delete(key);
        } catch (error) {
          console.warn('[chunk-manager] Failed to compact entity log', error);
        }
      }
    } finally {
      entityCompactionRunning = false;
      if (entityCompactionQueue.size > 0) {
        scheduleEntityCompactionTimer();
      }
    }
  }

  function scheduleEntityCompactionTimer() {
    if (!entityStore || entityCompactionQueue.size === 0) {
      return;
    }
    if (entityCompactionTimer !== null || entityCompactionRunning) {
      return;
    }
    entityCompactionTimer = setTimeout(() => {
      entityCompactionTimer = null;
      void runEntityCompactionPass();
    }, COMPACTION_INTERVAL_MS);
  }

  function cleanupChunkEntityState(key) {
    if (!key) {
      return;
    }
    const state = chunkEntityState.get(key);
    if (state) {
      state.records.forEach((_, entityId) => {
        entityIdIndex.delete(entityId);
      });
    }
    chunkEntityState.delete(key);
    entityDeltaQueues.delete(key);
    dirtyEntityChunks.delete(key);
    entityCompactionQueue.delete(key);
    const chunk = loadedChunks.get(key);
    if (chunk) {
      chunk.persistentEntities = [];
    }
  }

  function markChunkDirty(key) {
    if (!key) {
      return;
    }
    dirtyChunks.add(key);
    scheduleAutosaveTimer();
  }

  function enqueueJournalOpsForChunk(key, ops) {
    if (!key || !Array.isArray(ops) || ops.length === 0) {
      return;
    }
    if (!chunkPersistenceState.has(key)) {
      return;
    }
    const queue = ensureJournalQueue(key);
    ops.forEach((op) => {
      if (op) {
        queue.push(op);
      }
    });
    if (queue.length > 0) {
      markChunkDirty(key);
    }
  }

  function createBlockRemovalJournalOp(chunk, entry) {
    if (!chunk || !entry) {
      return null;
    }
    const key = chunkKey(chunk.chunkX ?? 0, chunk.chunkZ ?? 0);
    const state = chunkPersistenceState.get(key);
    if (!state) {
      return null;
    }

    let localX = null;
    let localY = null;
    let localZ = null;

    if (entry.gridPosition) {
      localX = Math.round(entry.gridPosition.x);
      localY = Math.round(entry.gridPosition.y);
      localZ = Math.round(entry.gridPosition.z);
    } else if (entry.position) {
      const halfSize = worldConfig.chunkSize / 2;
      const originX = chunk.chunkX * worldConfig.chunkSize - halfSize;
      const originZ = chunk.chunkZ * worldConfig.chunkSize - halfSize;
      localX = Math.round(entry.position.x - originX);
      localZ = Math.round(entry.position.z - originZ);
      localY = Math.round(entry.position.y) - state.minY;
    } else if (entry.coordinateKey) {
      const coords = parseBlockCoordinateKey(entry.coordinateKey);
      if (coords) {
        const halfSize = worldConfig.chunkSize / 2;
        const originX = chunk.chunkX * worldConfig.chunkSize - halfSize;
        const originZ = chunk.chunkZ * worldConfig.chunkSize - halfSize;
        localX = Math.round(coords.x - originX);
        localZ = Math.round(coords.z - originZ);
        localY = Math.round(coords.y) - state.minY;
      }
    }

    if (
      localX === null ||
      localY === null ||
      localZ === null ||
      !Number.isFinite(localX) ||
      !Number.isFinite(localY) ||
      !Number.isFinite(localZ)
    ) {
      return null;
    }

    if (
      localX < 0 ||
      localX >= state.sizeX ||
      localZ < 0 ||
      localZ >= state.sizeZ ||
      localY < 0 ||
      localY >= state.sizeY
    ) {
      return null;
    }

    return {
      id: JournalOpId.VOXEL_RECT,
      origin: { x: localX, y: localY, z: localZ },
      size: { x: 1, y: 1, z: 1 },
      block: 0,
    };
  }

  async function flushChunkJournal(key, chunkOverride = null) {
    if (!key) {
      return;
    }
    const queue = chunkJournalQueues.get(key);
    if (!queue || queue.length === 0) {
      dirtyChunks.delete(key);
      return;
    }
    const ops = queue.splice(0);
    if (ops.length === 0) {
      dirtyChunks.delete(key);
      return;
    }
    const payload = encodeJournalOps(ops);
    if (!(payload instanceof Uint8Array) || payload.byteLength === 0) {
      dirtyChunks.delete(key);
      chunkJournalQueues.set(key, []);
      return;
    }

    const chunk = chunkOverride ?? loadedChunks.get(key);
    const storeKey = chunk
      ? {
          cx: Number.isFinite(chunk.chunkX) ? chunk.chunkX : 0,
          cy: 0,
          cz: Number.isFinite(chunk.chunkZ) ? chunk.chunkZ : 0,
        }
      : { cx: 0, cy: 0, cz: 0 };

    try {
      await enqueueChunkPersistenceJob(key, () => {
        if (!chunkPersistenceQueue || typeof chunkPersistenceQueue.enqueueSave !== 'function') {
          return Promise.resolve();
        }
        return chunkPersistenceQueue.enqueueSave({
          key: storeKey,
          chunkKey: key,
          detailLevel: chunk?.detailLevel ?? DETAIL_LEVEL_CORE,
          type: 'journal',
          payload,
          tick: nextJournalTick++,
          timeoutMs: chunkPersistenceTimeoutMs,
        });
      });

      const state = chunkPersistenceState.get(key);
      if (state) {
        state.stats.entries += ops.length;
        state.stats.bytes += payload.byteLength;
        try {
          const mergeResult = mergeSnapshotWithJournals(
            state.snapshot,
            [payload],
            { sizeX: state.sizeX, sizeY: state.sizeY, sizeZ: state.sizeZ },
          );
          if (mergeResult?.payload) {
            state.snapshot = mergeResult.payload;
          }
        } catch (error) {
          console.warn('[chunk-manager] Failed to merge journal payload into snapshot', error);
        }
        if (shouldCompactJournal(state.stats, DEFAULT_COMPACTION_THRESHOLDS)) {
          state.needsCompaction = true;
          chunksPendingCompaction.add(key);
          scheduleCompactionTimer();
        }
      }

      chunkJournalQueues.set(key, []);
      dirtyChunks.delete(key);
    } catch (error) {
      console.warn('[chunk-manager] chunk persistence journal save failed', error);
      const existing = chunkJournalQueues.get(key) ?? [];
      chunkJournalQueues.set(key, [...ops, ...existing]);
      dirtyChunks.add(key);
      scheduleAutosaveTimer();
    }
  }

  async function runAutosavePass() {
    if (autosaveRunning) {
      return;
    }
    autosaveRunning = true;
    try {
      const maxPerPass = Math.max(1, defaultPreloadBurst);
      let processed = 0;
      while (dirtyChunks.size > 0 && processed < maxPerPass) {
        if (chunkJobQueue.length > 0 || chunkJobPumpActive) {
          await waitForNextJobSlice(8);
          processed = 0;
          continue;
        }
        const iterator = dirtyChunks.values().next();
        if (iterator.done) {
          break;
        }
        const key = iterator.value;
        await flushChunkJournal(key);
        processed += 1;
        await waitForNextJobSlice(1);
      }
    } finally {
      autosaveRunning = false;
      if (dirtyChunks.size > 0) {
        scheduleAutosaveTimer();
      }
    }
  }

  function scheduleAutosaveTimer() {
    if (dirtyChunks.size === 0) {
      return;
    }
    if (autosaveTimer !== null || autosaveRunning) {
      return;
    }
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void runAutosavePass();
    }, AUTOSAVE_INTERVAL_MS);
  }

  async function runCompactionPass() {
    if (compactionRunning) {
      return;
    }
    compactionRunning = true;
    try {
      for (const key of Array.from(chunksPendingCompaction)) {
        const state = chunkPersistenceState.get(key);
        if (!state || !state.needsCompaction) {
          chunksPendingCompaction.delete(key);
          continue;
        }
        const chunk = loadedChunks.get(key);
        if (!chunk || !state.snapshot || state.snapshot.byteLength === 0) {
          state.needsCompaction = false;
          chunksPendingCompaction.delete(key);
          continue;
        }
        if (chunkJobQueue.length > 0 || chunkJobPumpActive) {
          await waitForNextJobSlice(8);
        }
        try {
          await enqueueChunkPersistenceJob(key, () => {
            if (!chunkPersistenceQueue || typeof chunkPersistenceQueue.enqueueSave !== 'function') {
              return Promise.resolve();
            }
            return chunkPersistenceQueue.enqueueSave({
              key: {
                cx: Number.isFinite(chunk.chunkX) ? chunk.chunkX : 0,
                cy: 0,
                cz: Number.isFinite(chunk.chunkZ) ? chunk.chunkZ : 0,
              },
              chunkKey: key,
              detailLevel: chunk.detailLevel ?? DETAIL_LEVEL_CORE,
              type: 'snapshot',
              payload: state.snapshot,
              timeoutMs: chunkPersistenceTimeoutMs,
            });
          });
          state.stats.entries = 0;
          state.stats.bytes = 0;
          state.needsCompaction = false;
          chunksPendingCompaction.delete(key);
        } catch (error) {
          console.warn('[chunk-manager] chunk persistence compaction failed', error);
          scheduleCompactionTimer();
          break;
        }
        await waitForNextJobSlice(1);
      }
    } finally {
      compactionRunning = false;
      if (Array.from(chunkPersistenceState.values()).some((state) => state?.needsCompaction)) {
        scheduleCompactionTimer();
      }
    }
  }

  function scheduleCompactionTimer() {
    if (chunksPendingCompaction.size === 0) {
      return;
    }
    if (compactionTimer !== null || compactionRunning) {
      return;
    }
    compactionTimer = setTimeout(() => {
      compactionTimer = null;
      void runCompactionPass();
    }, COMPACTION_INTERVAL_MS);
  }

  const ensureCacheCapacityLimit = () => {
    if (payloadCacheCapacity <= 0) {
      clearPayloadCacheEntries();
      return;
    }
    while (payloadCache.size > payloadCacheCapacity) {
      const oldestKey = payloadCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      payloadCache.delete(oldestKey);
    }
  };

  const setCachedPayload = (key, cachedEntry) => {
    if (!key || !payloadCacheCapacity || !cachedEntry) {
      return;
    }
    const normalizedDetail = normalizeDetailLevel(
      cachedEntry.detailLevel ?? cachedEntry.payload?.detailLevel,
    );
    const normalizedEntry = {
      payload: cachedEntry.payload ?? null,
      detailLevel: normalizedDetail,
    };
    payloadCache.delete(key);
    payloadCache.set(key, normalizedEntry);
    ensureCacheCapacityLimit();
  };

  const takeCachedPayload = (key) => {
    if (!key || !payloadCache.has(key)) {
      return null;
    }
    const value = payloadCache.get(key);
    payloadCache.delete(key);
    if (!value) {
      return null;
    }
    return {
      payload: value.payload ?? null,
      detailLevel: normalizeDetailLevel(
        value.detailLevel ?? value.payload?.detailLevel,
      ),
    };
  };

  const refreshCacheForWorldChange = () => {
    const currentSeed = worldConfig.seedHash;
    if (currentSeed !== lastCacheSeedHash) {
      lastCacheSeedHash = currentSeed;
      lastCacheSignature = computeGenerationSignature();
      clearPayloadCacheEntries();
      return;
    }
    const signature = computeGenerationSignature();
    if (signature !== lastCacheSignature) {
      lastCacheSignature = signature;
      clearPayloadCacheEntries();
    }
  };
  let lastCenterChunkX = 0;
  let lastCenterChunkZ = 0;
  let hasLastCenter = false;
  let spawnColumnKey = null;
  let lastKnownPlayerColumnKey = null;
  let lastFiniteViewRadius = Number.isFinite(currentViewDistance)
    ? Math.max(0, Math.floor(currentViewDistance))
    : Math.max(0, Math.floor(lastFiniteViewDistance));

  const normalizeColumnCoordinates = (input) => {
    if (!input) {
      return null;
    }
    if (typeof input === 'string') {
      return parseColumnCoordinates(input);
    }
    const resolveCandidate = (value, fallback = null) => {
      if (Number.isFinite(value)) {
        return value;
      }
      if (Number.isFinite(fallback)) {
        return fallback;
      }
      return null;
    };
    const xCandidate = resolveCandidate(
      input.x,
      Array.isArray(input) ? input[0] : input.columnX,
    );
    const zCandidate = resolveCandidate(
      input.z,
      Array.isArray(input) ? input[1] : input.columnZ,
    );
    if (!Number.isFinite(xCandidate) || !Number.isFinite(zCandidate)) {
      return null;
    }
    return {
      x: Math.round(xCandidate),
      z: Math.round(zCandidate),
    };
  };

  const toColumnKey = (coordinates) => {
    if (!coordinates) {
      return null;
    }
    const { x, z } = coordinates;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }
    return `${x}|${z}`;
  };

  const collectionHasSolidInColumn = (collection, columnX, columnZ) => {
    if (!collection || !Number.isFinite(columnX) || !Number.isFinite(columnZ)) {
      return false;
    }
    if (typeof collection?.hasColumn === 'function') {
      return collection.hasColumn({ x: columnX, z: columnZ });
    }
    const matchesColumn = (key) => {
      if (typeof key !== 'string') {
        return false;
      }
      const parts = key.split('|');
      if (parts.length !== 3) {
        return false;
      }
      const [xPart, , zPart] = parts;
      const keyX = Number.parseInt(xPart, 10);
      const keyZ = Number.parseInt(zPart, 10);
      if (!Number.isFinite(keyX) || !Number.isFinite(keyZ)) {
        return false;
      }
      return keyX === columnX && keyZ === columnZ;
    };
    if (collection instanceof Set) {
      for (const key of collection) {
        if (matchesColumn(key)) {
          return true;
        }
      }
      return false;
    }
    if (collection instanceof Map) {
      for (const key of collection.keys()) {
        if (matchesColumn(key)) {
          return true;
        }
      }
      return false;
    }
    if (Array.isArray(collection)) {
      for (const key of collection) {
        if (matchesColumn(key)) {
          return true;
        }
      }
      return false;
    }
    if (typeof collection === 'object') {
      for (const key of Object.keys(collection)) {
        if (matchesColumn(key)) {
          return true;
        }
      }
      return false;
    }
    return false;
  };

  function waitForNextJobSlice(timeout) {
    const hasExplicitTimeout = arguments.length > 0;
    const numericTimeout = Number(timeout);
    const normalizedTimeout = Number.isFinite(numericTimeout)
      ? Math.max(0, numericTimeout)
      : undefined;

    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        if (hasExplicitTimeout && normalizedTimeout !== undefined) {
          requestIdleCallback(() => resolve(), { timeout: normalizedTimeout });
        } else {
          requestIdleCallback(() => resolve());
        }
        return;
      }

      if (!hasExplicitTimeout || !Number.isFinite(numericTimeout) || numericTimeout <= 0) {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve());
          return;
        }
        if (typeof setTimeout === 'function') {
          setTimeout(resolve, 0);
          return;
        }
      }

      if (typeof setTimeout === 'function') {
        setTimeout(resolve, Math.max(0, normalizedTimeout ?? 0));
        return;
      }

      if (typeof queueMicrotask === 'function') {
        queueMicrotask(resolve);
        return;
      }
      if (typeof Promise === 'function' && typeof Promise.resolve === 'function') {
        Promise.resolve().then(resolve);
        return;
      }

      resolve();
    });
  }

  function createWorkerJobController(entryKey, metadata) {
    if (!workerEnabled || (!chunkBuildWorker && !workerBroker)) {
      return null;
    }
    return {
      start(options = {}) {
        let startPayload = options;
        let startPersistence = metadata?.startPersistence ?? null;
        let startTransferables = undefined;
        if (
          options &&
          typeof options === 'object' &&
          (Object.prototype.hasOwnProperty.call(options, 'payload') ||
            Object.prototype.hasOwnProperty.call(options, 'persistence') ||
            Object.prototype.hasOwnProperty.call(options, 'transferables'))
        ) {
          startPayload = options.payload ?? {};
          if (options.persistence !== undefined) {
            startPersistence = options.persistence;
          }
          startTransferables = options.transferables;
        } else {
          startPayload = startPayload ?? {};
        }

        const transferables = Array.isArray(startTransferables)
          ? startTransferables
          : Array.isArray(metadata?.buffers)
          ? metadata.buffers
          : [];
        if (workerBroker) {
          workerBroker.requestProcgen({
            type: 'procgen:start',
            key: entryKey,
            payload: startPayload ?? {},
            persistence: startPersistence ?? undefined,
            transferables,
          });
          return;
        }
        const message = {
          type: 'start',
          key: entryKey,
          payload: startPayload ?? {},
        };
        if (startPersistence !== undefined && startPersistence !== null) {
          message.persistence = startPersistence;
        }
        chunkBuildWorker.postMessage(message, transferables);
      },
      step(budget) {
        if (workerBroker) {
          workerBroker.requestProcgen({
            type: 'procgen:step',
            key: entryKey,
            budget,
          });
          return;
        }
        chunkBuildWorker.postMessage({ type: 'step', key: entryKey, budget });
      },
      cancel() {
        if (workerBroker) {
          workerBroker.requestProcgen({
            type: 'procgen:cancel',
            key: entryKey,
          });
          return;
        }
        chunkBuildWorker.postMessage({ type: 'cancel', key: entryKey });
      },
    };
  }

  function createChunkJobMetadata(entry) {
    const metadata = {
      mode: workerEnabled && workerTarget ? 'worker' : 'local',
      controller: null,
      buffers: [],
      started: false,
      inflight: false,
      payload: null,
      startPayload: null,
      startPersistence: null,
      workerStepActive: false,
    };
    if (metadata.mode === 'worker') {
      metadata.startPersistence = { state: 'pending', result: null, transferables: [] };
      const requestedDetailLevel = normalizeDetailLevel(
        entry?.detailLevel ?? entry?.desiredDetailLevel ?? DETAIL_LEVEL_CORE,
      );
      metadata.startPayload = createChunkWorkerStartPayload({
        chunkX: entry?.chunkX ?? 0,
        chunkZ: entry?.chunkZ ?? 0,
        detailLevel: requestedDetailLevel,
        worldOptions: worldConfig,
        blockMaterials,
      });
      metadata.controller = createWorkerJobController(entry.key, metadata);
      if (!metadata.controller) {
        metadata.mode = 'local';
      }
    }
    return metadata;
  }

  function fallbackChunkJobToLocal(entry) {
    if (!entry) {
      return;
    }
    const metadata = entry.metadata;
    if (!metadata) {
      return;
    }
    metadata.mode = 'local';
    metadata.controller = null;
    metadata.started = false;
    metadata.inflight = false;
    if (metadata.workerStepActive) {
      metadata.workerStepActive = false;
      workerInflightCount = Math.max(0, workerInflightCount - 1);
    }
    metadata.payload = null;
    metadata.buffers = [];
    metadata.startPersistence = null;
    entry.workerPayload = null;
    entry.task?.setRequiresWorkerPayload?.(false);
  }

  function computeChunkBoundsFromPayload(entry, payload) {
    const chunkSize = worldConfig.chunkSize;
    const halfSize = chunkSize / 2;
    const defaultBounds = {
      minX: entry.chunkX * chunkSize - halfSize - 0.5,
      maxX: entry.chunkX * chunkSize + halfSize + 0.5,
      minZ: entry.chunkZ * chunkSize - halfSize - 0.5,
      maxZ: entry.chunkZ * chunkSize + halfSize + 0.5,
      minY: -32,
      maxY: worldConfig.maxHeight + 32,
    };
    if (!payload || typeof payload !== 'object') {
      return defaultBounds;
    }
    const heightSummary = payload.heightSummary;
    if (heightSummary && typeof heightSummary === 'object') {
      const minY = Number.isFinite(heightSummary.minHeight)
        ? heightSummary.minHeight - 1
        : defaultBounds.minY;
      const maxY = Number.isFinite(heightSummary.maxHeight)
        ? heightSummary.maxHeight + 1
        : defaultBounds.maxY;
      return {
        ...defaultBounds,
        minY,
        maxY,
      };
    }
    const occupancy = payload.occupancy;
    const normalizeKeys = (value) => {
      if (!value) {
        return [];
      }
      if (Array.isArray(value)) {
        return value;
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      if (typeof value === 'object') {
        return Object.keys(value);
      }
      return [];
    };
    const coordinateKeys = [
      ...normalizeKeys(occupancy?.solidCoordinates),
      ...normalizeKeys(occupancy?.softCoordinates),
    ];
    if (coordinateKeys.length === 0) {
      return defaultBounds;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    coordinateKeys.forEach((key) => {
      const coords = parseBlockCoordinateKey(key);
      if (!coords) {
        return;
      }
      if (Number.isFinite(coords.x)) {
        minX = Math.min(minX, coords.x);
        maxX = Math.max(maxX, coords.x);
      }
      if (Number.isFinite(coords.y)) {
        minY = Math.min(minY, coords.y);
        maxY = Math.max(maxY, coords.y);
      }
      if (Number.isFinite(coords.z)) {
        minZ = Math.min(minZ, coords.z);
        maxZ = Math.max(maxZ, coords.z);
      }
    });
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(maxZ)
    ) {
      return defaultBounds;
    }
    return {
      minX: minX - 0.5,
      maxX: maxX + 0.5,
      minY: minY - 0.5,
      maxY: maxY + 0.5,
      minZ: minZ - 0.5,
      maxZ: maxZ + 0.5,
    };
  }

  function toUint32Array(source) {
    if (source instanceof Uint32Array) {
      return new Uint32Array(source);
    }
    if (ArrayBuffer.isView(source)) {
      return new Uint32Array(source);
    }
    if (Array.isArray(source)) {
      return new Uint32Array(
        source.map((value) => (Number.isFinite(value) ? value : 0)),
      );
    }
    if (source instanceof Set) {
      return new Uint32Array(
        Array.from(source).map((value) => (Number.isFinite(value) ? value : 0)),
      );
    }
    return new Uint32Array(0);
  }

  function serializeDecorationMetadataFromChunk(chunk) {
    if (!chunk) {
      return {
        batches: [],
        groups: [],
        ownerIndex: {},
        typeIndex: {},
      };
    }

    const normalizeDecorationSource = (source) => {
      if (source instanceof Map) {
        return Array.from(source.entries());
      }
      if (source && typeof source === 'object') {
        return Object.entries(source);
      }
      return [];
    };

    const batches = normalizeDecorationSource(chunk.decorationData).map(
      ([type, record]) => {
        if (!type || !record) {
          return null;
        }
        const entries = Array.isArray(record.entries) ? record.entries : [];
        const serializedEntries = entries.map((entry) =>
          serializeInstancedEntry(entry ?? entry?.payload ?? null),
        );
        const entryKeys = entries
          .map((entry) => (entry?.key ? String(entry.key) : null))
          .filter(Boolean);
        const capacityCandidate = Number.isFinite(record.capacity)
          ? record.capacity
          : Number.isFinite(record.mesh?.userData?.capacity)
          ? record.mesh.userData.capacity
          : entries.length;
        return {
          type,
          capacity:
            Number.isFinite(capacityCandidate) && capacityCandidate >= 0
              ? capacityCandidate
              : entries.length,
          entryKeys,
          entries: serializedEntries,
        };
      },
    ).filter(Boolean);

    const groups = normalizeDecorationSource(chunk.decorationGroups)
      .map(([key, metadata]) => {
        if (!metadata) {
          return null;
        }
        const groupKey = metadata.key ?? key ?? null;
        if (!groupKey || !metadata.type) {
          return null;
        }
        const indicesSource = metadata.instanceIndices ?? [];
        const entryIndices = toUint32Array(
          ArrayBuffer.isView(indicesSource) || Array.isArray(indicesSource)
            ? indicesSource
            : indicesSource instanceof Set
            ? Array.from(indicesSource)
            : [],
        );
        return {
          key: String(groupKey),
          type: metadata.type,
          owner:
            metadata.owner !== undefined ? metadata.owner ?? null : null,
          destructible:
            typeof metadata.destructible === 'boolean'
              ? metadata.destructible
              : metadata.destructible ?? true,
          entryIndices,
        };
      })
      .filter(Boolean);

    const ownerIndex = {};
    if (chunk.decorationOwnerIndex instanceof Map) {
      chunk.decorationOwnerIndex.forEach((groups, owner) => {
        const keys = groups instanceof Map
          ? Array.from(groups.keys())
          : groups instanceof Set
          ? Array.from(groups)
          : Array.isArray(groups)
          ? groups.slice()
          : [];
        if (keys.length > 0) {
          ownerIndex[owner] = keys.map((value) => String(value));
        }
      });
    } else if (chunk.decorationOwnerIndex && typeof chunk.decorationOwnerIndex === 'object') {
      Object.entries(chunk.decorationOwnerIndex).forEach(([owner, groups]) => {
        const keys = Array.isArray(groups)
          ? groups.slice()
          : groups instanceof Set
          ? Array.from(groups)
          : groups instanceof Map
          ? Array.from(groups.keys())
          : [];
        if (keys.length > 0) {
          ownerIndex[owner] = keys.map((value) => String(value));
        }
      });
    }

    const typeIndex = {};
    if (chunk.decorationTypeIndex instanceof Map) {
      chunk.decorationTypeIndex.forEach((groups, type) => {
        let keys = [];
        if (groups instanceof Set) {
          keys = Array.from(groups)
            .map((metadata) => metadata?.key ?? null)
            .filter(Boolean);
        } else if (groups instanceof Map) {
          keys = Array.from(groups.keys());
        } else if (Array.isArray(groups)) {
          keys = groups.slice();
        }
        if (keys.length > 0) {
          typeIndex[type] = keys.map((value) => String(value));
        }
      });
    } else if (chunk.decorationTypeIndex && typeof chunk.decorationTypeIndex === 'object') {
      Object.entries(chunk.decorationTypeIndex).forEach(([type, groups]) => {
        let keys = [];
        if (groups instanceof Set) {
          keys = Array.from(groups)
            .map((metadata) => metadata?.key ?? null)
            .filter(Boolean);
        } else if (groups instanceof Map) {
          keys = Array.from(groups.keys());
        } else if (Array.isArray(groups)) {
          keys = groups.slice();
        }
        if (keys.length > 0) {
          typeIndex[type] = keys.map((value) => String(value));
        }
      });
    }

    return { batches, groups, ownerIndex, typeIndex };
  }

  function hexStringToColorArray(value) {
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }
    const color = new THREE.Color(value);
    return new Float32Array([color.r, color.g, color.b]);
  }

  function serializeBiomePayloadFromChunk(chunk, fallbackBiomes = []) {
    if (!chunk || !Array.isArray(chunk.biomes) || chunk.biomes.length === 0) {
      return fallbackBiomes;
    }
    return chunk.biomes.map((biome) => {
      const shader = biome?.shader ?? {};
      return {
        id: biome?.id ?? null,
        label: biome?.label ?? null,
        weight: Number.isFinite(biome?.weight) ? biome.weight : 0,
        samples: Number.isFinite(biome?.weight) ? biome.weight : 0,
        shader: {
          fogColor: hexStringToColorArray(shader.fogColor),
          tintColor: hexStringToColorArray(shader.tintColor),
          tintStrength: Number.isFinite(shader.tintStrength)
            ? shader.tintStrength
            : 1,
        },
      };
    });
  }

  const toCoordinateArray = (source) => {
    if (!source) {
      return [];
    }
    if (Array.isArray(source)) {
      return source.map((value) => String(value));
    }
    if (ArrayBuffer.isView(source)) {
      return Array.from(source, (value) => String(value));
    }
    if (source instanceof Set) {
      return Array.from(source, (value) => String(value));
    }
    if (source instanceof Map) {
      return Array.from(source.keys(), (value) => String(value));
    }
    if (typeof source === 'object') {
      return Object.keys(source);
    }
    return [];
  };

  const normalizeCoordinateIndex = (source) => {
    if (!source || typeof source !== 'object') {
      return {};
    }
    if (source instanceof Map) {
      const normalized = {};
      source.forEach((value, key) => {
        normalized[String(key)] = value;
      });
      return normalized;
    }
    if (Array.isArray(source) || ArrayBuffer.isView(source)) {
      return {};
    }
    return { ...source };
  };

  const normalizeNumericField = (value) =>
    Number.isFinite(value) ? value : Number.isFinite(Number(value)) ? Number(value) : null;

  const createLeanOccupancySnapshot = (source) => {
    if (!source || typeof source !== 'object') {
      return null;
    }
    const occupancy = {
      minY: normalizeNumericField(source.minY),
      maxY: normalizeNumericField(source.maxY),
      width: normalizeNumericField(source.width),
      depth: normalizeNumericField(source.depth),
      height: normalizeNumericField(source.height),
    };
    const solidCoordinates = toCoordinateArray(source.solidCoordinates);
    if (solidCoordinates.length > 0) {
      occupancy.solidCoordinates = solidCoordinates;
    }
    const softCoordinates = toCoordinateArray(source.softCoordinates);
    if (softCoordinates.length > 0) {
      occupancy.softCoordinates = softCoordinates;
    }
    const coordinateIndex = normalizeCoordinateIndex(source.coordinateIndex);
    if (Object.keys(coordinateIndex).length > 0) {
      occupancy.coordinateIndex = coordinateIndex;
    }
    return occupancy;
  };

  const createLeanCachePayload = (basePayload) => {
    if (!basePayload || typeof basePayload !== 'object') {
      return null;
    }
    const leanPayload = {
      ...basePayload,
    };

    if ('blockPlacements' in leanPayload) {
      leanPayload.blockPlacements = null;
    }

    if ('buffers' in leanPayload) {
      delete leanPayload.buffers;
    }

    if (basePayload.occupancy && typeof basePayload.occupancy === 'object') {
      const occupancySnapshot = createLeanOccupancySnapshot(basePayload.occupancy);
      if (occupancySnapshot) {
        leanPayload.occupancy = occupancySnapshot;
      } else {
        delete leanPayload.occupancy;
      }
    }

    return leanPayload;
  };

  function buildCachePayloadFromChunk(chunk, keyOverride = null) {
    if (!chunk) {
      return null;
    }
    let basePayload = chunk.__cachePayload ?? null;
    if (!basePayload) {
      const cacheKey = (() => {
        if (keyOverride) {
          return keyOverride;
        }
        const hasCoords =
          typeof chunk.chunkX === 'number' && typeof chunk.chunkZ === 'number';
        return hasCoords ? chunkKey(chunk.chunkX, chunk.chunkZ) : null;
      })();
      if (cacheKey && payloadCache.has(cacheKey)) {
        basePayload = payloadCache.get(cacheKey)?.payload ?? null;
      }
    }
    if (!basePayload) {
      return null;
    }
    const leanPayload = createLeanCachePayload(basePayload);
    if (!leanPayload) {
      return null;
    }
    const decorations = serializeDecorationMetadataFromChunk(chunk);
    const biomes = serializeBiomePayloadFromChunk(chunk, leanPayload.biomes);
    const detailLevel = normalizeDetailLevel(
      chunk.detailLevel ?? basePayload.detailLevel,
    );
    return {
      ...leanPayload,
      decorations,
      biomes,
      detailLevel,
    };
  }

  const scoutPreviewMaterial = (() => {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    });
    material.name = 'scout-preview';
    material.flatShading = true;
    material.needsUpdate = true;
    return material;
  })();

  const scoutPreviewColorLow = new THREE.Color('#4b5d6a');
  const scoutPreviewColorHigh = new THREE.Color('#c6d4df');
  const scoutPreviewColorScratch = new THREE.Color();

  const createScoutChunkPreview = ({
    group,
    chunkX,
    chunkZ,
    chunkSize,
    summary,
  }) => {
    if (!group || !summary) {
      return null;
    }

    const normalizedChunkSize = Number.isFinite(chunkSize)
      ? Math.max(1, Math.floor(chunkSize))
      : 16;
    const width = Number.isFinite(summary.width)
      ? Math.max(1, Math.floor(summary.width))
      : normalizedChunkSize;
    const depth = Number.isFinite(summary.depth)
      ? Math.max(1, Math.floor(summary.depth))
      : normalizedChunkSize;
    const totalColumns = Math.max(1, width * depth);

    let heightsSource = summary.heights ?? null;
    if (heightsSource instanceof ArrayBuffer) {
      heightsSource = new Int16Array(heightsSource);
    }
    const fallbackHeight = Number.isFinite(summary.minHeight)
      ? summary.minHeight
      : 0;
    const heights = new Float32Array(totalColumns);
    let computedMin = Number.isFinite(summary.minHeight)
      ? summary.minHeight
      : Number.POSITIVE_INFINITY;
    let computedMax = Number.isFinite(summary.maxHeight)
      ? summary.maxHeight
      : Number.NEGATIVE_INFINITY;
    for (let index = 0; index < totalColumns; index += 1) {
      let value = null;
      if (Array.isArray(heightsSource) || ArrayBuffer.isView(heightsSource)) {
        value = heightsSource[index];
      } else if (heightsSource && typeof heightsSource === 'object') {
        value = heightsSource[index] ?? null;
      }
      const numeric = Number(value);
      const heightValue = Number.isFinite(numeric) ? numeric : fallbackHeight;
      heights[index] = heightValue;
      if (!Number.isFinite(summary.minHeight)) {
        computedMin = Math.min(computedMin, heightValue);
      }
      if (!Number.isFinite(summary.maxHeight)) {
        computedMax = Math.max(computedMax, heightValue);
      }
    }
    if (!Number.isFinite(summary.minHeight)) {
      computedMin =
        computedMin === Number.POSITIVE_INFINITY ? fallbackHeight : computedMin;
    }
    if (!Number.isFinite(summary.maxHeight)) {
      computedMax =
        computedMax === Number.NEGATIVE_INFINITY ? computedMin : computedMax;
    }
    const heightRange = Math.max(1, computedMax - computedMin);
    const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

    const vertexCountX = width + 1;
    const vertexCountZ = depth + 1;
    const vertexCount = vertexCountX * vertexCountZ;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    const halfSize = normalizedChunkSize / 2;
    const minWorldX = chunkX * normalizedChunkSize - halfSize - 0.5;
    const minWorldZ = chunkZ * normalizedChunkSize - halfSize - 0.5;
    const stepX = normalizedChunkSize / width;
    const stepZ = normalizedChunkSize / depth;

    for (let vx = 0; vx < vertexCountX; vx += 1) {
      for (let vz = 0; vz < vertexCountZ; vz += 1) {
        const vertexIndex = vx * vertexCountZ + vz;
        let sum = 0;
        let samples = 0;
        for (let dx = 0; dx < 2; dx += 1) {
          for (let dz = 0; dz < 2; dz += 1) {
            const columnX = vx - dx;
            const columnZ = vz - dz;
            if (columnX < 0 || columnX >= width || columnZ < 0 || columnZ >= depth) {
              continue;
            }
            const columnIndex = columnX * depth + columnZ;
            const columnHeight = heights[columnIndex];
            if (Number.isFinite(columnHeight)) {
              sum += columnHeight;
              samples += 1;
            }
          }
        }
        const averagedHeight =
          samples > 0 ? sum / samples : fallbackHeight;
        const positionOffset = vertexIndex * 3;
        positions[positionOffset] = minWorldX + vx * stepX;
        positions[positionOffset + 1] = averagedHeight;
        positions[positionOffset + 2] = minWorldZ + vz * stepZ;

        const normalized = clamp01((averagedHeight - computedMin) / heightRange);
        scoutPreviewColorScratch.copy(scoutPreviewColorLow);
        scoutPreviewColorScratch.lerp(scoutPreviewColorHigh, normalized);
        colors[positionOffset] = scoutPreviewColorScratch.r;
        colors[positionOffset + 1] = scoutPreviewColorScratch.g;
        colors[positionOffset + 2] = scoutPreviewColorScratch.b;
      }
    }

    const indexCount = width * depth * 6;
    const useUint32 = vertexCount > 65535;
    const indices = useUint32
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount);
    let indexOffset = 0;
    for (let vx = 0; vx < width; vx += 1) {
      for (let vz = 0; vz < depth; vz += 1) {
        const a = vx * vertexCountZ + vz;
        const b = (vx + 1) * vertexCountZ + vz;
        const c = (vx + 1) * vertexCountZ + (vz + 1);
        const d = vx * vertexCountZ + (vz + 1);
        indices[indexOffset++] = a;
        indices[indexOffset++] = d;
        indices[indexOffset++] = b;
        indices[indexOffset++] = d;
        indices[indexOffset++] = c;
        indices[indexOffset++] = b;
      }
    }

    const previewStats = {
      vertexCount,
      indexCount,
      vertexBytes: positions?.byteLength ?? positions.length * 4,
      colorBytes: colors?.byteLength ?? colors.length * 4,
      indexBytes: indices?.byteLength ?? indices.length * indices.BYTES_PER_ELEMENT,
    };
    previewStats.totalBytes =
      previewStats.vertexBytes + previewStats.colorBytes + previewStats.indexBytes;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, scoutPreviewMaterial);
    mesh.name = `chunk_${chunkX}_${chunkZ}_scout_preview`;
    mesh.userData = mesh.userData || {};
    mesh.userData.isScoutPreview = true;
    mesh.userData.scoutPreviewStats = previewStats;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -1;

    group.add(mesh);
    group.userData = group.userData || {};
    group.userData.scoutPreviewMesh = mesh;
    group.userData.scoutPreviewStats = previewStats;

    return mesh;
  };

  const finalizeScoutChunk = (entry, payload) => {
    const chunkX = entry?.chunkX ?? 0;
    const chunkZ = entry?.chunkZ ?? 0;
    const summarySource = payload?.heightSummary ?? {};
    const chunkSize = Number.isFinite(worldConfig.chunkSize)
      ? Math.max(1, Math.floor(worldConfig.chunkSize))
      : 16;
    const width = Number.isFinite(summarySource?.width)
      ? Math.max(1, Math.floor(summarySource.width))
      : chunkSize;
    const depth = Number.isFinite(summarySource?.depth)
      ? Math.max(1, Math.floor(summarySource.depth))
      : chunkSize;
    const totalColumns = Math.max(1, width * depth);

    let sourceHeights = summarySource?.heights ?? null;
    if (sourceHeights instanceof ArrayBuffer) {
      sourceHeights = new Int16Array(sourceHeights);
    }
    const heightView = ArrayBuffer.isView(sourceHeights)
      ? sourceHeights
      : Array.isArray(sourceHeights)
      ? sourceHeights
      : null;
    const heights = new Int16Array(totalColumns);
    if (heightView) {
      const limit = Math.min(totalColumns, heightView.length ?? totalColumns);
      for (let index = 0; index < limit; index += 1) {
        const numeric = Number(heightView[index]);
        heights[index] = Number.isFinite(numeric)
          ? Math.max(0, Math.floor(numeric))
          : 0;
      }
    }

    let sourceBiomeIds = summarySource?.biomeIds ?? null;
    if (sourceBiomeIds instanceof ArrayBuffer) {
      sourceBiomeIds = Array.from(new Uint16Array(sourceBiomeIds));
    } else if (ArrayBuffer.isView(sourceBiomeIds)) {
      sourceBiomeIds = Array.from(sourceBiomeIds);
    } else if (sourceBiomeIds == null) {
      sourceBiomeIds = [];
    } else if (!Array.isArray(sourceBiomeIds)) {
      sourceBiomeIds = [sourceBiomeIds];
    }
    const biomeIds = Array.isArray(sourceBiomeIds)
      ? sourceBiomeIds.map((value) =>
          value === null || value === undefined ? null : String(value),
        )
      : [];

    const minHeight = Number.isFinite(summarySource?.minHeight)
      ? summarySource.minHeight
      : Number.isFinite(worldConfig?.baseHeight)
      ? worldConfig.baseHeight
      : 0;
    const maxHeight = Number.isFinite(summarySource?.maxHeight)
      ? summarySource.maxHeight
      : Number.isFinite(worldConfig?.maxHeight)
      ? worldConfig.maxHeight
      : minHeight;

    const summary = {
      width,
      depth,
      minHeight,
      maxHeight,
      heights,
      biomeIds,
    };

    const chunkBiomes = Array.isArray(payload?.biomes) ? payload.biomes : [];
    const group = new THREE.Group();
    group.name = `chunk_${chunkX}_${chunkZ}_scout`;
    group.userData = group.userData || {};
    group.userData.biomes = chunkBiomes;
    group.userData.detailLevel = DETAIL_LEVEL_SCOUT;
    group.userData.scoutSummary = summary;

    const previewMesh = createScoutChunkPreview({
      group,
      chunkX,
      chunkZ,
      chunkSize,
      summary,
    });
    group.visible = Boolean(previewMesh);

    const hasValidCoordinates =
      Number.isFinite(chunkX) && Number.isFinite(chunkZ);
    const previewKey = hasValidCoordinates ? chunkKey(chunkX, chunkZ) : null;
    let normalizedPreviewStats = null;
    if (previewKey) {
      const previewStatsSource = previewMesh?.userData?.scoutPreviewStats ?? null;
      normalizedPreviewStats = setScoutPreviewMemoryForChunkKey(
        previewKey,
        previewStatsSource,
        { chunkX, chunkZ },
      );
      if (normalizedPreviewStats) {
        group.userData.scoutPreviewStats = normalizedPreviewStats;
      } else {
        clearScoutPreviewMemoryForChunkKey(previewKey, { chunkX, chunkZ });
        delete group.userData.scoutPreviewStats;
      }
    }

    const halfSize = chunkSize / 2;
    const fallbackMaxHeight = Number.isFinite(worldConfig?.maxHeight)
      ? worldConfig.maxHeight
      : maxHeight + 32;
    const bounds = {
      minX: chunkX * chunkSize - halfSize - 0.5,
      maxX: chunkX * chunkSize + halfSize + 0.5,
      minZ: chunkZ * chunkSize - halfSize - 0.5,
      maxZ: chunkZ * chunkSize + halfSize + 0.5,
      minY: Number.isFinite(minHeight) ? minHeight - 1 : -32,
      maxY: Number.isFinite(maxHeight) ? maxHeight + 1 : fallbackMaxHeight,
    };

    return {
      chunkX,
      chunkZ,
      group,
      solidBlockKeys: createChunkBlockIndex({
        chunkSize,
        chunkX,
        chunkZ,
      }),
      softBlockKeys: createChunkBlockIndex({
        chunkSize,
        chunkX,
        chunkZ,
      }),
      typeCapacities: new Map(),
      waterColumns: new Map(),
      fluidColumnsByType: new Map(),
      fluidSurfaces: [],
      blockLookup: new Map(),
      fluidBlockKeys: new Set(),
      typeData: new Map(),
      decorationData: new Map(),
      decorationGroups: new Map(),
      decorationOwnerIndex: new Map(),
      decorationTypeIndex: new Map(),
      biomes: chunkBiomes,
      prototypeInstances: new Map(),
      bounds,
      scoutSummary: summary,
      detailLevel: DETAIL_LEVEL_SCOUT,
      scoutPreviewMemory: normalizedPreviewStats
        ? { ...normalizedPreviewStats }
        : null,
    };
  };

  function finalizeWorkerChunk(entry, workerPayload = null) {
    const payload =
      workerPayload?.payload ?? entry?.metadata?.payload ?? null;
    if (!payload) {
      throw new Error('Chunk worker payload unavailable.');
    }
    const chunkKeyString =
      Number.isFinite(entry?.chunkX) && Number.isFinite(entry?.chunkZ)
        ? chunkKey(entry.chunkX, entry.chunkZ)
        : null;
    const payloadDetailLevel = normalizeDetailLevel(
      payload?.detailLevel ??
        entry?.detailLevel ??
        entry?.desiredDetailLevel ??
        DETAIL_LEVEL_CORE,
    );
    if (payloadDetailLevel === DETAIL_LEVEL_SCOUT) {
      return finalizeScoutChunk(entry, payload);
    }
    if (chunkKeyString) {
      clearScoutPreviewMemoryForChunkKey(chunkKeyString, {
        chunkX: entry?.chunkX ?? null,
        chunkZ: entry?.chunkZ ?? null,
      });
    }
    const meshResult = finalizeChunkMeshes(payload, blockMaterials, THREE);
    const derivedCollisionKeys = deriveCollisionKeySetsFromMesh({
      typeData: meshResult.typeData,
      blockLookup: meshResult.blockLookup,
      blockMaterials,
    });
    const occludedKeys = new Set(derivedCollisionKeys.occludedCoordinates ?? []);
    if (derivedCollisionKeys.occludedEntries?.size || occludedKeys.size > 0) {
      const occludedEntries = derivedCollisionKeys.occludedEntries ?? new Set();
      meshResult.blockLookup.forEach((entry, key) => {
        if (!entry || (!occludedKeys.has(key) && !occludedEntries.has(entry))) {
          if (entry) {
            entry.isVisible = true;
          }
          return;
        }
        entry.isVisible = false;
      });
    } else if (meshResult.blockLookup?.forEach) {
      meshResult.blockLookup.forEach((entry) => {
        if (entry) {
          entry.isVisible = true;
        }
      });
    }
    pruneOccludedInstancedEntries({
      typeData: meshResult.typeData,
      occludedEntries: derivedCollisionKeys.occludedEntries,
    });

    const chunkOverrides =
      Number.isFinite(entry?.chunkX) && Number.isFinite(entry?.chunkZ)
        ? { chunkX: entry.chunkX, chunkZ: entry.chunkZ }
        : {};
    const chunkSolidKeys = createChunkBlockIndex({
      chunkSize: worldConfig.chunkSize,
      chunkX: chunkOverrides.chunkX,
      chunkZ: chunkOverrides.chunkZ,
    });
    populateChunkBlockIndex(
      chunkSolidKeys,
      derivedCollisionKeys.solidBlockKeys,
      chunkOverrides,
    );
    const chunkSoftKeys = createChunkBlockIndex({
      chunkSize: worldConfig.chunkSize,
      chunkX: chunkOverrides.chunkX,
      chunkZ: chunkOverrides.chunkZ,
    });
    populateChunkBlockIndex(
      chunkSoftKeys,
      derivedCollisionKeys.softBlockKeys,
      chunkOverrides,
    );

    const chunk = {
      chunkX: entry.chunkX,
      chunkZ: entry.chunkZ,
      group: meshResult.chunkGroup,
      solidBlockKeys: chunkSolidKeys,
      softBlockKeys: chunkSoftKeys,
      typeCapacities: meshResult.typeCapacities,
      waterColumns: meshResult.waterColumns,
      fluidColumnsByType: meshResult.fluidColumnsByType,
      fluidSurfaces: meshResult.fluidSurfaces,
      blockLookup: meshResult.blockLookup,
      fluidBlockKeys: meshResult.fluidBlockKeys,
      typeData: meshResult.typeData,
      decorationData: meshResult.decorationData,
      decorationGroups: meshResult.decorationGroups,
      decorationOwnerIndex: meshResult.decorationOwnerIndex,
      decorationTypeIndex: meshResult.decorationTypeIndex,
      biomes: meshResult.biomes,
      prototypeInstances: meshResult.prototypeInstances,
      bounds: computeChunkBoundsFromPayload(entry, payload),
    };
    chunk.scoutPreviewMemory = null;
    chunk.detailLevel = payloadDetailLevel;
    if (entry?.metadata) {
      entry.metadata.payload = null;
    }
    if (workerPayload) {
      workerPayload.payload = null;
    }
    return chunk;
  }

  if (workerEnabled && workerTarget && workerTarget.addEventListener) {
    const handleWorkerMessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') {
        return;
      }
      const { key } = data;
      if (!key) {
        return;
      }
      const entry = pendingPreloadEntries.get(key);
      if (!entry || entry.finalized || entry.cancelled) {
        return;
      }
      const metadata = entry.metadata;
      if (!metadata || metadata.mode !== 'worker') {
        return;
      }
      metadata.inflight = false;
      if (metadata.workerStepActive) {
        metadata.workerStepActive = false;
        workerInflightCount = Math.max(0, workerInflightCount - 1);
      }
      const processed = Math.max(0, Number(data.processed) || 0);
      const done = data.done === true;

      if (!entry.unlimited && Number.isFinite(entry.pendingBudget)) {
        entry.pendingBudget = Math.max(0, entry.pendingBudget - processed);
        if (processed === 0 && entry.pendingBudget > 0 && done) {
          entry.pendingBudget = 0;
        }
      }

      if (data.error) {
        console.warn(
          `[chunk-manager] chunk worker reported error for job ${entry.key}`,
          data.error,
        );
        metadata.controller?.cancel?.();
        fallbackChunkJobToLocal(entry);
        if (!entry.finalized && !entry.cancelled) {
          entry.active = true;
          chunkJobQueue.push(entry);
          ensureChunkJobPump();
        }
        return;
      }

      if (done && (data.payload === undefined || data.payload === null)) {
        fallbackChunkJobToLocal(entry);
        if (!entry.finalized && !entry.cancelled) {
          entry.active = true;
          chunkJobQueue.push(entry);
          ensureChunkJobPump();
        }
        return;
      }

      if (done) {
        const payload = data.payload ?? null;
        entry.workerPayload = {
          payload,
          metadata: data.metadata ?? null,
        };
        metadata.payload = payload;
        finalizePendingEntry(entry);
        return;
      }

      if (entry.unlimited || entry.pendingBudget > 0) {
        entry.active = true;
        chunkJobQueue.push(entry);
        ensureChunkJobPump();
      }
    };

    const handleWorkerError = (event) => {
      console.error('[chunk-manager] chunk build worker error', event?.error || event);
    };

    workerTarget.addEventListener('message', handleWorkerMessage);
    workerTarget.addEventListener('error', handleWorkerError);
    workerDisposables.push(() => {
      workerTarget.removeEventListener('message', handleWorkerMessage);
      workerTarget.removeEventListener('error', handleWorkerError);
    });
  }

  function ensurePendingEntryPromise(entry) {
    if (!entry) {
      return null;
    }
    if (!entry.promise) {
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
    }
    return entry.promise;
  }

  function enqueueChunkPersistenceJob(key, jobFactory) {
    if (!key || typeof jobFactory !== 'function') {
      return Promise.resolve(null);
    }
    const previous = chunkPersistenceJobs.get(key) ?? Promise.resolve();
    const next = previous.catch(() => null).then(jobFactory);
    chunkPersistenceJobs.set(key, next);
    next
      .catch(() => {})
      .finally(() => {
        const current = chunkPersistenceJobs.get(key);
        if (current === next) {
          chunkPersistenceJobs.delete(key);
        }
      });
    return next;
  }

  function ensureChunkPersistenceForEntry(entry) {
    if (!entry) {
      return Promise.resolve(null);
    }
    if (!chunkPersistenceQueue || typeof chunkPersistenceQueue.enqueueLoad !== 'function') {
      entry.persistenceState = 'ready';
      entry.persistenceResult = null;
      entry.persistenceError = null;
      updateEntryPersistenceMetadata(entry, { stateOverride: 'ready' });
      return Promise.resolve(null);
    }
    if (entry.persistenceState === 'ready' || entry.persistenceState === 'failed') {
      updateEntryPersistenceMetadata(entry);
      return entry.persistencePromise ?? Promise.resolve(entry.persistenceResult ?? null);
    }
    if (entry.persistenceState === 'pending') {
      updateEntryPersistenceMetadata(entry, { stateOverride: 'pending' });
      return entry.persistencePromise ?? Promise.resolve(null);
    }
    updateEntryPersistenceMetadata(entry, { stateOverride: 'pending' });
    entry.persistenceState = 'pending';
    const storeKey = {
      cx: Number.isFinite(entry.chunkX) ? entry.chunkX : 0,
      cy: 0,
      cz: Number.isFinite(entry.chunkZ) ? entry.chunkZ : 0,
    };
    const loadPromise = enqueueChunkPersistenceJob(entry.key, () =>
      chunkPersistenceQueue.enqueueLoad({
        key: storeKey,
        chunkKey: entry.key,
        detailLevel: entry.detailLevel,
        timeoutMs: chunkPersistenceTimeoutMs,
        request: { snapshot: true, journals: true },
      }),
    );
    entry.persistencePromise = loadPromise
      .then((result) => {
        const normalizedResult = normalizePersistenceResultForEntry(entry, result);
        entry.persistenceState = 'ready';
        entry.persistenceResult = normalizedResult;
        entry.persistenceError = null;
        updateEntryPersistenceMetadata(entry, { stateOverride: 'ready' });
        return normalizedResult;
      })
      .catch((error) => {
        entry.persistenceState = 'failed';
        entry.persistenceError = error;
        entry.persistenceResult = null;
        updateEntryPersistenceMetadata(entry, { stateOverride: 'failed' });
        return null;
      })
      .finally(() => {
        entry.persistencePromise = null;
      });
    loadPromise.catch(() => {});
    return entry.persistencePromise;
  }

  function releasePendingChunkResources(chunk) {
    if (!chunk) {
      return;
    }
    const budgetKey =
      chunk.__budgetKey ??
      (Number.isFinite(chunk.chunkX) && Number.isFinite(chunk.chunkZ)
        ? chunkKey(chunk.chunkX, chunk.chunkZ)
        : null);
    if (chunk.__budgetTracked && budgetKey) {
      const normalizedDetail = normalizeDetailLevel(
        chunk.detailLevel ?? chunk.desiredDetailLevel ?? DETAIL_LEVEL_SCOUT,
      );
      emitChunkDisposed({
        key: budgetKey,
        chunkX: Number.isFinite(chunk.chunkX) ? chunk.chunkX : null,
        chunkZ: Number.isFinite(chunk.chunkZ) ? chunk.chunkZ : null,
        detailLevel: normalizedDetail,
        memory: chunk.__budgetStats ?? null,
      });
    }
    chunk.__budgetTracked = false;
    chunk.__budgetStats = null;
    chunk.__budgetKey = null;
    if (Number.isFinite(chunk.chunkX) && Number.isFinite(chunk.chunkZ)) {
      clearScoutPreviewMemoryForChunkKey(chunkKey(chunk.chunkX, chunk.chunkZ), {
        chunkX: chunk.chunkX ?? null,
        chunkZ: chunk.chunkZ ?? null,
      });
    }
    chunk.scoutPreviewMemory = null;
    if (chunk.group?.traverse) {
      chunk.group.traverse((child) => {
        if (!child) {
          return;
        }
        if (child.isInstancedMesh) {
          disposeInstancedMesh(child);
          return;
        }
        if (child.isMesh) {
          child.geometry?.dispose?.();
        }
        const material = child.material;
        const disposeMaterial = (mat) => {
          if (!mat || mat === scoutPreviewMaterial) {
            return;
          }
          mat.dispose?.();
        };
        if (Array.isArray(material)) {
          material.forEach(disposeMaterial);
        } else {
          disposeMaterial(material);
        }
      });
    }
    chunk.group?.clear?.();
    chunk.group = null;

    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.geometry?.dispose?.();
      disposeFluidSurface(surface);
    });

    if (chunk.typeData instanceof Map) {
      chunk.typeData.forEach((record) => {
        if (!record) {
          return;
        }
        if (Array.isArray(record.entries)) {
          record.entries.forEach((entry) => {
            if (!entry) {
              return;
            }
            entry.mesh = null;
            entry.tintAttribute = null;
            entry.index = -1;
          });
          record.entries.length = 0;
        }
        releaseTintAttribute(record.tintAttribute);
        record.mesh = null;
        record.tintAttribute = null;
      });
      chunk.typeData.clear();
    }
    chunk.typeData = null;

    const disposeDecorationRecord = (record) => {
      if (!record) {
        return;
      }
      if (Array.isArray(record.entries)) {
        record.entries.forEach((entry) => {
          if (!entry) {
            return;
          }
          entry.mesh = null;
          entry.tintAttribute = null;
        });
        record.entries.length = 0;
      }
      releaseTintAttribute(record.tintAttribute);
      record.mesh = null;
      record.tintAttribute = null;
    };

    if (chunk.decorationData instanceof Map) {
      chunk.decorationData.forEach(disposeDecorationRecord);
      chunk.decorationData.clear();
    } else if (chunk.decorationData && typeof chunk.decorationData === 'object') {
      Object.values(chunk.decorationData).forEach(disposeDecorationRecord);
    }
    chunk.decorationData = null;
    if (chunk.decorationGroups instanceof Map) {
      chunk.decorationGroups.clear();
    }
    chunk.decorationGroups = null;
    if (chunk.decorationTypeIndex instanceof Map) {
      chunk.decorationTypeIndex.clear();
    }
    chunk.decorationTypeIndex = null;
    if (chunk.decorationOwnerIndex instanceof Map) {
      chunk.decorationOwnerIndex.clear();
    }
    chunk.decorationOwnerIndex = null;
  }

  function activatePendingChunkRecord(record) {
    if (!record) {
      return;
    }
    const { entry, chunk } = record;
    if (!entry || !chunk) {
      record.entry = null;
      record.chunk = null;
      return;
    }
    record.pendingUpgrade = null;
    try {
      const key = chunkKey(chunk.chunkX, chunk.chunkZ);
      ensureResidentCapacityForChunk(key);
      registerGeneratedChunk(chunk, { budgetCheckHandled: true });
      touchLoadedChunkRecord(key, chunk);
      entry.resolve?.(chunk);
    } catch (error) {
      entry.reject?.(error);
    }
    entry.pendingChunk = null;
    entry.resolve = null;
    entry.reject = null;
    record.entry = null;
    record.chunk = null;
  }

  function dropPendingActivation(key, { disposeChunk = false, settle = false } = {}) {
    if (!key) {
      return;
    }
    const record = pendingActivationByKey.get(key);
    if (!record) {
      return;
    }
    pendingActivationByKey.delete(key);
    const index = pendingActivations.indexOf(record);
    if (index >= 0) {
      pendingActivations.splice(index, 1);
    }
    const deferredIndex = deferredActivations.indexOf(record);
    if (deferredIndex >= 0) {
      deferredActivations.splice(deferredIndex, 1);
    }
    record.waitingForActivation = false;
    if (settle && record.entry) {
      record.entry.resolve?.(null);
      record.entry.reject = null;
      record.entry.resolve = null;
    }
    if (record.entry) {
      record.entry.pendingChunk = null;
    }
    if (record.pendingUpgrade) {
      cancelPendingChunkUpgradeJob(record.pendingUpgrade);
    }
    record.pendingUpgrade = null;
    if (disposeChunk) {
      releasePendingChunkResources(record.chunk);
    }
    record.entry = null;
    record.chunk = null;
    promoteDeferredActivations();
  }

  function enqueuePendingActivation(record) {
    if (!record || !record.key) {
      return;
    }
    if (pendingActivationByKey.has(record.key)) {
      dropPendingActivation(record.key, { disposeChunk: true, settle: true });
    }
    if (!hasMeshCommitCapacity()) {
      record.waitingForActivation = true;
      pendingActivationByKey.set(record.key, record);
      deferredActivations.push(record);
      return;
    }
    record.waitingForActivation = false;
    pendingActivationByKey.set(record.key, record);
    pendingActivations.push(record);
  }

  function computeRequiredDetailForChunk(chunkX, chunkZ) {
    if (!hasLastCenter) {
      return DETAIL_LEVEL_CORE;
    }
    const dx = Math.abs(chunkX - lastCenterChunkX);
    const dz = Math.abs(chunkZ - lastCenterChunkZ);
    const maxDistance = Math.max(dx, dz);
    return resolveDetailLevelForDistance(
      maxDistance,
      lastFiniteViewRadius,
      lastFiniteRetentionRadius,
    );
  }

  function resolveUpgradeHysteresisConfig(override) {
    const candidate =
      override && typeof override === 'object' ? override : defaultUpgradeHysteresis;
    const radiusSource = Number.isFinite(candidate?.hysteresisRadius)
      ? candidate.hysteresisRadius
      : Number.isFinite(candidate?.radius)
      ? candidate.radius
      : defaultUpgradeHysteresis.radius;
    const framesSource = Number.isFinite(candidate?.hysteresisFrames)
      ? candidate.hysteresisFrames
      : Number.isFinite(candidate?.frames)
      ? candidate.frames
      : defaultUpgradeHysteresis.frames;
    return {
      radius: Math.max(0, radiusSource),
      frames: Math.max(0, Math.floor(framesSource)),
    };
  }

  function ensureChunkUpgradeState(key) {
    if (!key) {
      return null;
    }
    let state = chunkUpgradeStateByKey.get(key);
    if (state) {
      return state;
    }
    state = {
      framesInRange: 0,
      inProgress: false,
      entry: null,
      targetDetail: null,
    };
    chunkUpgradeStateByKey.set(key, state);
    return state;
  }

  function finalizeChunkUpgradeTask(task, targetDetailLevel) {
    if (!task) {
      return null;
    }
    const normalizedTarget = normalizeDetailLevel(targetDetailLevel);
    let payloadForCache = null;
    if (typeof task.exportPayloadSnapshot === 'function') {
      payloadForCache = task.exportPayloadSnapshot();
    }
    const upgradedChunk = task.finalize();
    if (!upgradedChunk) {
      return null;
    }
    if (payloadForCache) {
      payloadForCache.detailLevel = normalizedTarget;
      upgradedChunk.__cachePayload = payloadForCache;
    }
    upgradedChunk.detailLevel = normalizedTarget;
    upgradedChunk.desiredDetailLevel = normalizedTarget;
    if (upgradedChunk.__cachePayload) {
      upgradedChunk.__cachePayload.detailLevel = normalizedTarget;
    }
    task.releaseCachedPayload?.();
    return upgradedChunk;
  }

  function cancelActiveChunkUpgrade(key, { disposeTask = false } = {}) {
    if (!key) {
      return;
    }
    const state = chunkUpgradeStateByKey.get(key);
    if (!state) {
      return;
    }
    if (state.entry) {
      const queueIndex = activeChunkUpgradeQueue.indexOf(state.entry);
      if (queueIndex >= 0) {
        activeChunkUpgradeQueue.splice(queueIndex, 1);
      }
      if (disposeTask) {
        try {
          state.entry.task?.releaseCachedPayload?.({ cancel: true });
        } catch (error) {
          console.debug('[chunk-manager] upgrade task release failed', error);
        }
      }
      state.entry = null;
    }
    state.inProgress = false;
    state.targetDetail = null;
    state.framesInRange = 0;
  }

  function applyChunkRenderUpgrade({ key, chunk, upgradedChunk }) {
    if (!key || !chunk || !upgradedChunk) {
      return false;
    }

    const previousGroups =
      chunk.decorationGroups instanceof Map
        ? Array.from(chunk.decorationGroups.values())
        : [];
    previousGroups.forEach((group) => unregisterDecorationGroup(group));

    const chunkOverrides =
      Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};
    const existingSolidIndex = resolveChunkBlockIndex(chunk, 'solidBlockKeys');
    existingSolidIndex?.forEach((block) =>
      solidBlocks.delete(block, chunkOverrides),
    );
    const existingSoftIndex = resolveChunkBlockIndex(chunk, 'softBlockKeys');
    existingSoftIndex?.forEach((block) =>
      softBlocks.delete(block, chunkOverrides),
    );
    if (chunk.waterColumns instanceof Map) {
      chunk.waterColumns.forEach((_, columnKey) => waterColumns.delete(columnKey));
    } else if (chunk.waterColumnKeys instanceof Set) {
      chunk.waterColumnKeys.forEach((columnKey) => waterColumns.delete(columnKey));
    }

    if (chunk.group?.traverse) {
      chunk.group.traverse((child) => {
        if (child?.isInstancedMesh) {
          untrackRaycastTarget(child);
        }
      });
    }
    if (chunk.group?.parent) {
      chunk.group.parent.remove(chunk.group);
    }

    releasePendingChunkResources(chunk);

    chunk.group = upgradedChunk.group;
    const nextSolidIndex = createChunkBlockIndex({
      chunkSize: worldConfig.chunkSize,
      chunkX: chunkOverrides.chunkX,
      chunkZ: chunkOverrides.chunkZ,
    });
    populateChunkBlockIndex(
      nextSolidIndex,
      upgradedChunk.solidBlockKeys,
      chunkOverrides,
    );
    chunk.solidBlockKeys = nextSolidIndex;
    const nextSoftIndex = createChunkBlockIndex({
      chunkSize: worldConfig.chunkSize,
      chunkX: chunkOverrides.chunkX,
      chunkZ: chunkOverrides.chunkZ,
    });
    populateChunkBlockIndex(
      nextSoftIndex,
      upgradedChunk.softBlockKeys,
      chunkOverrides,
    );
    chunk.softBlockKeys = nextSoftIndex;
    chunk.typeCapacities =
      upgradedChunk.typeCapacities instanceof Map
        ? upgradedChunk.typeCapacities
        : new Map(upgradedChunk.typeCapacities ?? []);
    chunk.blockLookup =
      upgradedChunk.blockLookup instanceof Map
        ? upgradedChunk.blockLookup
        : new Map(upgradedChunk.blockLookup ?? []);
    chunk.typeData =
      upgradedChunk.typeData instanceof Map
        ? upgradedChunk.typeData
        : new Map(upgradedChunk.typeData ?? []);
    chunk.decorationData =
      upgradedChunk.decorationData instanceof Map
        ? upgradedChunk.decorationData
        : new Map(upgradedChunk.decorationData ?? []);
    chunk.biomes = upgradedChunk.biomes ?? chunk.biomes;
    chunk.prototypeInstances =
      upgradedChunk.prototypeInstances instanceof Map
        ? upgradedChunk.prototypeInstances
        : new Map(upgradedChunk.prototypeInstances ?? []);
    chunk.bounds = upgradedChunk.bounds ?? chunk.bounds;
    chunk.scoutSummary = upgradedChunk.scoutSummary ?? chunk.scoutSummary ?? null;
    chunk.fluidSurfaces = Array.isArray(upgradedChunk.fluidSurfaces)
      ? upgradedChunk.fluidSurfaces
      : [];

    const chunkWaterColumnSource =
      upgradedChunk.waterColumns ?? upgradedChunk.waterColumnKeys ?? null;
    const chunkWaterColumns = ensureWaterColumnMap(chunkWaterColumnSource);
    const normalizedWaterColumns = new Map();
    chunkWaterColumns.forEach((bounds, columnKey) => {
      const normalized =
        bounds === null ? null : normalizeWaterColumnBounds(bounds);
      normalizedWaterColumns.set(columnKey, normalized);
      waterColumns.set(columnKey, normalized);
    });
    chunk.waterColumns = normalizedWaterColumns;
    chunk.waterColumnKeys = new Set(normalizedWaterColumns.keys());

    if (upgradedChunk.fluidBlockKeys instanceof Set) {
      chunk.fluidBlockKeys = new Set(upgradedChunk.fluidBlockKeys);
    } else if (Array.isArray(upgradedChunk.fluidBlockKeys)) {
      chunk.fluidBlockKeys = new Set(upgradedChunk.fluidBlockKeys);
    } else if (
      upgradedChunk.fluidBlockKeys &&
      typeof upgradedChunk.fluidBlockKeys === 'object'
    ) {
      chunk.fluidBlockKeys = new Set(
        Object.keys(upgradedChunk.fluidBlockKeys).filter(Boolean),
      );
    } else {
      chunk.fluidBlockKeys = new Set();
    }

    if (upgradedChunk.fluidColumnsByType instanceof Map) {
      chunk.fluidColumnsByType = new Map(
        Array.from(upgradedChunk.fluidColumnsByType.entries()).map(
          ([type, columns]) => [
            type,
            columns instanceof Map ? new Map(columns) : new Map(columns ?? []),
          ],
        ),
      );
    } else if (
      upgradedChunk.fluidColumnsByType &&
      typeof upgradedChunk.fluidColumnsByType === 'object'
    ) {
      const fluidMap = new Map();
      Object.entries(upgradedChunk.fluidColumnsByType).forEach(
        ([type, columns]) => {
          if (columns instanceof Map) {
            fluidMap.set(type, new Map(columns));
          } else if (Array.isArray(columns)) {
            fluidMap.set(type, new Map(columns));
          }
        },
      );
      chunk.fluidColumnsByType = fluidMap;
    } else {
      chunk.fluidColumnsByType = new Map();
    }

    const chunkWaterColumnsMap = chunk.fluidColumnsByType.get('water');
    if (chunkWaterColumnsMap instanceof Map) {
      chunkWaterColumnsMap.forEach((column, columnKey) => {
        const normalized = normalizedWaterColumns.get(columnKey);
        if (!normalized || !column) {
          return;
        }
        column.bottomY = normalized.bottomY;
        column.minY = Math.min(column.minY ?? normalized.bottomY, normalized.bottomY);
        column.surfaceY = normalized.surfaceY;
        column.maxY = Math.max(column.maxY ?? normalized.surfaceY, normalized.surfaceY);
        column.depth = Math.max(0.05, column.surfaceY - column.bottomY);
      });
    }

    chunk.decorationGroups = new Map();
    chunk.decorationOwnerIndex = new Map();
    chunk.decorationTypeIndex = new Map();
    const nextDecorationGroups =
      upgradedChunk.decorationGroups instanceof Map
        ? Array.from(upgradedChunk.decorationGroups.values())
        : [];
    nextDecorationGroups.forEach((group) => {
      registerDecorationGroup(key, group, chunk);
    });

    const updatedSolidIndex = resolveChunkBlockIndex(chunk, 'solidBlockKeys');
    updatedSolidIndex?.forEach((block) =>
      solidBlocks.add(block, chunkOverrides),
    );
    const updatedSoftIndex = resolveChunkBlockIndex(chunk, 'softBlockKeys');
    updatedSoftIndex?.forEach((block) =>
      softBlocks.add(block, chunkOverrides),
    );

    chunk.detailLevel = normalizeDetailLevel(upgradedChunk.detailLevel);
    chunk.desiredDetailLevel = chunk.detailLevel;
    chunk.__cachePayload = upgradedChunk.__cachePayload ?? null;
    if (chunk.__cachePayload) {
      chunk.__cachePayload.detailLevel = chunk.detailLevel;
    }

    chunk.group.frustumCulled = false;
    applyChunkBounds(chunk);
    chunk.group?.traverse?.((child) => {
      if (!child?.isInstancedMesh) {
        return;
      }
      const { type } = child.userData || {};
      if (!type) {
        return;
      }
      child.userData.chunkKey = key;
      trackRaycastTarget(child);
    });
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.userData = surface.userData || {};
      surface.userData.chunkKey = key;
    });
    scene.add(chunk.group);

    return true;
  }

  function scheduleActiveChunkUpgrade({ key, chunk, targetDetailLevel }) {
    if (!key || !chunk) {
      return false;
    }
    const state = ensureChunkUpgradeState(key);
    if (!state || state.inProgress) {
      return false;
    }
    const normalizedTarget = normalizeDetailLevel(targetDetailLevel);
    const task = createChunkBuildTask({
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      blockMaterials,
      detailLevel: normalizedTarget,
      scoutPreviewBuilder: createScoutChunkPreview,
    });
    const entry = {
      key,
      chunk,
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      targetDetailLevel: normalizedTarget,
      task,
    };
    activeChunkUpgradeQueue.push(entry);
    state.inProgress = true;
    state.entry = entry;
    state.framesInRange = 0;
    state.targetDetail = normalizedTarget;
    return true;
  }

  const PENDING_UPGRADE_JOB_KIND = 'pending-upgrade';

  function createPendingChunkUpgradeJob({
    record,
    targetDetailLevel,
    task,
  }) {
    if (!record || !record.entry || !task) {
      return null;
    }
    const normalizedDetail = normalizeDetailLevel(targetDetailLevel);
    return {
      kind: PENDING_UPGRADE_JOB_KIND,
      key: `${record.entry.key}:upgrade`,
      record,
      entry: record.entry,
      task,
      targetDetailLevel: normalizedDetail,
      pendingBudget: 0,
      stepHint: defaultPreloadBurst,
      unlimited: false,
      active: false,
      finalized: false,
      cancelled: false,
    };
  }

  function finalizePendingChunkUpgradeJob(job) {
    if (!job || job.finalized) {
      return;
    }
    job.finalized = true;
    job.active = false;
    const { record } = job;
    const targetDetail = normalizeDetailLevel(job.targetDetailLevel);
    try {
      const upgradedChunk = finalizeChunkUpgradeTask(job.task, targetDetail);
      if (!upgradedChunk) {
        throw new Error('upgrade-task-empty');
      }
      if (record) {
        if (record.chunk && record.chunk !== upgradedChunk) {
          releasePendingChunkResources(record.chunk);
        }
        record.chunk = upgradedChunk;
        record.chunk.detailLevel = targetDetail;
        record.chunk.desiredDetailLevel = targetDetail;
        if (record.entry) {
          record.entry.detailLevel = targetDetail;
          record.entry.desiredDetailLevel = targetDetail;
          if (record.entry.waitingForCapacity) {
            queueWaitingPreloadEntry(record.entry);
          } else {
            preloadQueue.update(record.entry);
          }
          record.entry.workerPayload = null;
          record.entry.metadata = null;
          record.entry.task = null;
          record.entry.pendingChunk = record;
        }
        record.pendingUpgrade = null;
      }
    } catch (error) {
      console.error('[chunk-manager] Failed to finalize pending chunk upgrade', error);
      if (record) {
        record.pendingUpgrade = null;
      }
    } finally {
      job.task?.releaseCachedPayload?.();
      job.task = null;
    }
  }

  function cancelPendingChunkUpgradeJob(job) {
    if (!job || job.finalized) {
      return;
    }
    job.cancelled = true;
    job.finalized = true;
    job.active = false;
    const index = chunkJobQueue.indexOf(job);
    if (index >= 0) {
      chunkJobQueue.splice(index, 1);
    }
    try {
      job.task?.releaseCachedPayload?.({ cancel: true });
    } catch (error) {
      console.debug('[chunk-manager] Failed to release pending upgrade task', error);
    }
    job.task = null;
    if (job.record && job.record.pendingUpgrade === job) {
      job.record.pendingUpgrade = null;
    }
  }

  function schedulePendingChunkUpgradeJob(job, { budget } = {}) {
    if (!job || job.finalized || job.cancelled) {
      return;
    }
    const burst = Math.max(1, defaultPreloadBurst);
    const pendingBudget = Number.isFinite(job.pendingBudget)
      ? job.pendingBudget
      : 0;
    const granted = Math.max(1, Math.floor(budget ?? burst));
    job.pendingBudget = pendingBudget + granted;
    job.stepHint = Math.max(1, job.stepHint || burst, granted);
    if (!job.active) {
      job.active = true;
      chunkJobQueue.push(job);
    }
    ensureChunkJobPump();
  }

  function finalizeActiveChunkUpgrade(entry) {
    if (!entry || !entry.task) {
      return;
    }
    const { key, chunk, targetDetailLevel, task } = entry;
    const state = chunkUpgradeStateByKey.get(key) ?? null;
    let upgradedChunk = null;
    try {
      upgradedChunk = finalizeChunkUpgradeTask(task, targetDetailLevel);
      if (!upgradedChunk) {
        cancelActiveChunkUpgrade(key, { disposeTask: true });
        return;
      }
      if (!loadedChunks.has(key) || loadedChunks.get(key) !== chunk) {
        releasePendingChunkResources(upgradedChunk);
        cancelActiveChunkUpgrade(key, { disposeTask: false });
        return;
      }
      applyChunkRenderUpgrade({ key, chunk, upgradedChunk });
    } catch (error) {
      console.error('[chunk-manager] Failed to finalize chunk upgrade', error);
      cancelActiveChunkUpgrade(key, { disposeTask: true });
      return;
    } finally {
      if (state) {
        state.inProgress = false;
        state.entry = null;
        state.framesInRange = 0;
        state.targetDetail = null;
      }
    }
  }

  function processActiveChunkUpgrades(stepBudget = defaultPreloadBurst) {
    if (activeChunkUpgradeQueue.length === 0) {
      return;
    }
    const unlimited = stepBudget === Number.POSITIVE_INFINITY;
    const normalizedBudget = unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(stepBudget));
    for (let index = 0; index < activeChunkUpgradeQueue.length; ) {
      const entry = activeChunkUpgradeQueue[index];
      if (!entry || !entry.task) {
        activeChunkUpgradeQueue.splice(index, 1);
        continue;
      }
      const { key, chunk, task } = entry;
      if (!loadedChunks.has(key) || loadedChunks.get(key) !== chunk) {
        cancelActiveChunkUpgrade(key, { disposeTask: true });
        activeChunkUpgradeQueue.splice(index, 1);
        continue;
      }
      let done = false;
      try {
        if (unlimited) {
          do {
            const result = task.step(normalizedBudget);
            done = Boolean(result?.done);
          } while (!done);
        } else {
          const result = task.step(normalizedBudget);
          done = Boolean(result?.done);
        }
      } catch (error) {
        console.error('[chunk-manager] active chunk upgrade failed', error);
        cancelActiveChunkUpgrade(key, { disposeTask: true });
        activeChunkUpgradeQueue.splice(index, 1);
        continue;
      }
      if (done) {
        finalizeActiveChunkUpgrade(entry);
        activeChunkUpgradeQueue.splice(index, 1);
      } else {
        index += 1;
      }
    }
  }

  function upgradePendingChunkRecord(record, targetDetailLevel) {
    const normalizedTarget = normalizeDetailLevel(targetDetailLevel);
    if (!record) {
      return false;
    }
    const { entry, chunk } = record;
    if (!entry || !chunk) {
      return false;
    }
    const currentDetail = normalizeDetailLevel(chunk.detailLevel);
    const currentRank = detailLevelRank(currentDetail);
    const requiredRank = detailLevelRank(normalizedTarget);
    if (currentRank >= requiredRank) {
      chunk.detailLevel = normalizedTarget;
      chunk.desiredDetailLevel = normalizedTarget;
      entry.detailLevel = normalizedTarget;
      entry.desiredDetailLevel = normalizedTarget;
      return true;
    }

    entry.desiredDetailLevel = normalizedTarget;
    chunk.desiredDetailLevel = normalizedTarget;

    const existingJob = record.pendingUpgrade ?? null;
    if (existingJob) {
      if (existingJob.finalized || existingJob.cancelled) {
        record.pendingUpgrade = null;
      } else {
        const existingRank = detailLevelRank(
          normalizeDetailLevel(existingJob.targetDetailLevel),
        );
        if (existingRank < requiredRank) {
          cancelPendingChunkUpgradeJob(existingJob);
        } else {
          schedulePendingChunkUpgradeJob(existingJob, {
            budget: existingJob.stepHint || defaultPreloadBurst,
          });
          return false;
        }
      }
    }

    let upgradeTask = null;
    try {
      upgradeTask = createChunkBuildTask({
        chunkX: entry.chunkX,
        chunkZ: entry.chunkZ,
        blockMaterials,
        detailLevel: normalizedTarget,
        scoutPreviewBuilder: createScoutChunkPreview,
      });
    } catch (error) {
      console.error('[chunk-manager] Failed to create upgrade task', error);
      return false;
    }

    const upgradeJob = createPendingChunkUpgradeJob({
      record,
      targetDetailLevel: normalizedTarget,
      task: upgradeTask,
    });
    if (!upgradeJob) {
      upgradeTask?.releaseCachedPayload?.({ cancel: true });
      return false;
    }
    record.pendingUpgrade = upgradeJob;
    schedulePendingChunkUpgradeJob(upgradeJob, {
      budget: defaultPreloadBurst,
    });
    return false;
  }

  function processPendingActivations(limit = defaultActivationBudget) {
    if (
      pendingActivations.length === 0 &&
      deferredActivations.length === 0
    ) {
      return 0;
    }

    const cap = resolveMeshCommitCap();
    if (cap === 0) {
      return 0;
    }

    promoteDeferredActivations();

    const unlimited = !Number.isFinite(limit);
    let budget = unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(limit));
    let processed = 0;

    const takeNextRecord = () => {
      if (pendingActivations.length === 0) {
        promoteDeferredActivations();
      }
      if (pendingActivations.length === 0) {
        return null;
      }
      const next = pendingActivations.shift();
      if (next) {
        next.waitingForActivation = false;
      }
      return next;
    };

    let record = takeNextRecord();
    while (record && (unlimited || processed < budget)) {
      pendingActivationByKey.delete(record.key);
      const { entry, chunk } = record;
      if (!entry || !chunk) {
        record.entry = null;
        record.chunk = null;
        record = takeNextRecord();
        continue;
      }

      const requiredDetail = computeRequiredDetailForChunk(
        chunk.chunkX,
        chunk.chunkZ,
      );
      if (
        detailLevelRank(requiredDetail) <
        detailLevelRank(DETAIL_LEVEL_SCOUT)
      ) {
        pendingActivationByKey.set(record.key, record);
        pendingActivations.push(record);
        record = takeNextRecord();
        continue;
      }

      const chunkDetail = normalizeDetailLevel(chunk.detailLevel);
      if (detailLevelRank(chunkDetail) < detailLevelRank(requiredDetail)) {
        const upgraded = upgradePendingChunkRecord(record, requiredDetail);
        if (!upgraded) {
          pendingActivationByKey.set(record.key, record);
          pendingActivations.push(record);
          record = takeNextRecord();
          continue;
        }
      }

      record.chunk.detailLevel = normalizeDetailLevel(requiredDetail);
      record.chunk.desiredDetailLevel = record.chunk.detailLevel;
      activatePendingChunkRecord(record);
      processed += 1;
      record = takeNextRecord();
    }

    if (!record) {
      promoteDeferredActivations();
    }

    return processed;
  }

  function finalizePendingEntry(entry) {
    if (!entry || entry.finalized) {
      return;
    }
    entry.finalized = true;
    entry.awaitingPersistenceScheduling = false;
    entry.pendingBudget = 0;
    entry.unlimited = false;
    entry.active = false;
    if (entry.waitingForCapacity) {
      removeWaitingPreloadEntry(entry);
      waitingPreloadEntries.delete(entry.key);
    } else {
      preloadQueue.remove(entry);
    }
    pendingPreloadEntries.delete(entry.key);
    try {
      let payloadForCache = null;
      if (entry.workerPayload?.payload) {
        payloadForCache = entry.workerPayload.payload;
      } else if (entry.metadata?.payload) {
        payloadForCache = entry.metadata.payload;
      } else if (entry.task?.exportPayloadSnapshot) {
        payloadForCache = entry.task.exportPayloadSnapshot();
      }
      let chunk;
      if (entry.workerPayload) {
        chunk = finalizeWorkerChunk(entry, entry.workerPayload);
      } else if (entry.metadata?.mode === 'worker') {
        chunk = finalizeWorkerChunk(entry);
      } else {
        chunk = entry.task.finalize();
      }
      if (chunk && payloadForCache) {
        payloadForCache.detailLevel = entry.detailLevel;
        chunk.__cachePayload = payloadForCache;
      }
      if (chunk) {
        chunk.detailLevel = entry.detailLevel;
        chunk.desiredDetailLevel = entry.desiredDetailLevel;
        chunk.__persistenceResult = entry.persistenceResult ?? null;
      }
      const pendingRecord = {
        key: entry.key,
        chunk,
        entry,
        pendingUpgrade: null,
      };
      entry.pendingChunk = pendingRecord;
      entry.task?.releaseCachedPayload?.();
      const shouldDeferActivation = (() => {
        if (!hasLastCenter) {
          return false;
        }
        const distanceX = Math.abs(entry.chunkX - lastCenterChunkX);
        const distanceZ = Math.abs(entry.chunkZ - lastCenterChunkZ);
        return (
          Number.isFinite(lastFiniteViewRadius) &&
          (distanceX > lastFiniteViewRadius || distanceZ > lastFiniteViewRadius)
        );
      })();
      if (shouldDeferActivation) {
        enqueuePendingActivation(pendingRecord);
      } else {
        activatePendingChunkRecord(pendingRecord);
      }
      entry.resolve?.(pendingRecord.chunk ?? null);
      entry.resolve = null;
      entry.reject = null;
      entry.promise = null;
    } catch (error) {
      entry.reject?.(error);
      entry.resolve = null;
      entry.reject = null;
      entry.promise = null;
    }
    if (entry.metadata) {
      entry.metadata.inflight = false;
      entry.metadata.payload = null;
      entry.metadata = null;
    }
    entry.workerPayload = null;
    updatePendingBuildThrottle();
    promoteWaitingPreloadEntries();
  }

  function cancelPendingEntry(entry, { resolveWith = null } = {}) {
    if (!entry || entry.finalized) {
      return;
    }
    entry.cancelled = true;
    entry.finalized = true;
    entry.awaitingPersistenceScheduling = false;
    entry.pendingBudget = 0;
    entry.unlimited = false;
    entry.active = false;
    if (entry.metadata?.mode === 'worker') {
      try {
        entry.metadata.controller?.cancel?.();
      } catch (error) {
        console.debug(
          `[chunk-manager] Failed to cancel worker job ${entry.key}`,
          error,
        );
      }
      entry.metadata.inflight = false;
      entry.metadata.payload = null;
      if (entry.metadata.workerStepActive) {
        entry.metadata.workerStepActive = false;
        workerInflightCount = Math.max(0, workerInflightCount - 1);
      }
    }
    entry.workerPayload = null;
    entry.pendingChunk = null;
    if (entry.waitingForCapacity) {
      removeWaitingPreloadEntry(entry);
      waitingPreloadEntries.delete(entry.key);
    } else {
      preloadQueue.remove(entry);
    }
    for (let i = chunkJobQueue.length - 1; i >= 0; i -= 1) {
      if (chunkJobQueue[i] === entry) {
        chunkJobQueue.splice(i, 1);
      }
    }
    pendingPreloadEntries.delete(entry.key);
    updatePendingBuildThrottle();
    promoteWaitingPreloadEntries();
    const promise = ensurePendingEntryPromise(entry);
    if (promise) {
      try {
        entry.resolve?.(resolveWith);
      } catch (error) {
        console.warn(
          `[chunk-manager] Failed to resolve cancelled chunk job ${entry.key}.`,
          error,
        );
      }
    }
    entry.task?.releaseCachedPayload?.({ cancel: true });
  }

  async function runChunkJobPump() {
    try {
      while (chunkJobQueue.length > 0) {
        const entry = chunkJobQueue.shift();
        if (!entry) {
          continue;
        }
        entry.active = false;
        if (entry.waitingForCapacity) {
          continue;
        }
        if (entry.finalized || entry.cancelled) {
          continue;
        }

        if (!entry.unlimited) {
          const finiteBudget = Number.isFinite(entry.pendingBudget)
            ? entry.pendingBudget
            : 0;
          if (finiteBudget <= 0) {
            continue;
          }
        }

        const stepHint = Math.max(
          1,
          Math.floor(entry.stepHint || defaultPreloadBurst),
        );
        const stepBudget = entry.unlimited
          ? Math.max(stepHint, defaultPreloadBurst)
          : Math.max(
              1,
              Math.min(
                Number.isFinite(entry.pendingBudget)
                  ? entry.pendingBudget
                  : stepHint,
                stepHint,
              ),
            );

        const metadata = entry.metadata;
        if (metadata?.mode === 'worker') {
          if (metadata.inflight) {
            continue;
          }
          const controller = metadata.controller;
          if (!controller) {
            fallbackChunkJobToLocal(entry);
          } else {
            if (!metadata.started) {
              const persistenceState = entry.persistenceState ?? 'ready';
              if (persistenceState === 'pending' || persistenceState === 'idle') {
                awaitChunkPersistenceAndReschedule(entry);
                continue;
              }
              updateEntryPersistenceMetadata(entry);
              const transferables = Array.isArray(metadata.buffers)
                ? metadata.buffers
                : [];
              const basePersistence = metadata.startPersistence ?? {
                state: persistenceState,
                result: entry.persistenceResult ?? null,
                transferables: [],
              };
              const startPersistence = {
                ...basePersistence,
                transferables,
              };
              try {
                controller.start({
                  payload: metadata.startPayload ?? {},
                  persistence: startPersistence,
                  transferables,
                });
                metadata.started = true;
                metadata.buffers = [];
                metadata.startPersistence = {
                  ...startPersistence,
                  transferables: [],
                };
              } catch (error) {
                console.warn(
                  `[chunk-manager] Failed to start worker job ${entry.key}`,
                  error,
                );
                fallbackChunkJobToLocal(entry);
              }
            }
            if (metadata.mode === 'worker') {
              try {
                metadata.inflight = true;
                if (!metadata.workerStepActive) {
                  metadata.workerStepActive = true;
                  workerInflightCount += 1;
                }
                controller.step(stepBudget);
              } catch (error) {
                if (metadata.workerStepActive) {
                  metadata.workerStepActive = false;
                  workerInflightCount = Math.max(
                    0,
                    workerInflightCount - 1,
                  );
                }
                metadata.inflight = false;
                console.warn(
                  `[chunk-manager] Failed to step worker job ${entry.key}`,
                  error,
                );
                fallbackChunkJobToLocal(entry);
              }
              const wasUnlimited = entry.unlimited === true;
              if (chunkJobQueue.length > 0) {
                const hasUnlimitedPending =
                  wasUnlimited ||
                  chunkJobQueue.some((queuedEntry) => queuedEntry?.unlimited);
                if (!hasUnlimitedPending) {
                  // Yield immediately so browsers without requestIdleCallback still pace frames.
                  await waitForNextJobSlice();
                }
              }
              continue;
            }
          }
        }

        let result;
        try {
          result = entry.task.step(stepBudget);
        } catch (error) {
          console.error('[chunk-manager] chunk job failed', error);
          pendingPreloadEntries.delete(entry.key);
          entry.reject?.(error);
          entry.finalized = true;
          continue;
        }

        const processed = Math.max(0, Number(result?.processed) || 0);
        const done = Boolean(result?.done);

        if (!entry.unlimited && Number.isFinite(entry.pendingBudget)) {
          entry.pendingBudget = Math.max(0, entry.pendingBudget - processed);
          if (processed === 0 && entry.pendingBudget > 0) {
            entry.pendingBudget = 0;
          }
        }

        if (!done && entry.kind === PENDING_UPGRADE_JOB_KIND) {
          const burst = Math.max(1, entry.stepHint || defaultPreloadBurst);
          entry.pendingBudget = Math.max(entry.pendingBudget ?? 0, burst);
        }

        const wasUnlimited = entry.unlimited === true;

        if (done) {
          if (entry.kind === PENDING_UPGRADE_JOB_KIND) {
            finalizePendingChunkUpgradeJob(entry);
          } else {
            finalizePendingEntry(entry);
          }
        } else if (entry.unlimited || entry.pendingBudget > 0) {
          entry.active = true;
          chunkJobQueue.push(entry);
        }

        if (chunkJobQueue.length > 0) {
          const hasUnlimitedPending =
            wasUnlimited ||
            chunkJobQueue.some((queuedEntry) => queuedEntry?.unlimited);
          if (!hasUnlimitedPending) {
            // Yield immediately so browsers without requestIdleCallback still pace frames.
            await waitForNextJobSlice();
          }
        }
      }
    } catch (error) {
      console.error('[chunk-manager] chunk job pump error', error);
    } finally {
      chunkJobPumpActive = false;
      chunkJobPumpPromise = null;
    }
  }

  function ensureChunkJobPump() {
    if (chunkJobPumpActive) {
      return chunkJobPumpPromise;
    }
    chunkJobPumpActive = true;
    chunkJobPumpPromise = runChunkJobPump();
    return chunkJobPumpPromise;
  }

  function scheduleChunkJobEntry(entry) {
    if (!entry || entry.finalized || entry.cancelled) {
      return;
    }
    if (entry.waitingForCapacity) {
      return;
    }
    if (!entry.active) {
      entry.active = true;
      chunkJobQueue.push(entry);
    }
    ensureChunkJobPump();
  }

  function awaitChunkPersistenceAndReschedule(entry) {
    if (!entry || entry.finalized || entry.cancelled) {
      return null;
    }
    const persistencePromise =
      entry.persistencePromise ?? ensureChunkPersistenceForEntry(entry);
    if (!persistencePromise || typeof persistencePromise.finally !== 'function') {
      if (!entry.finalized && !entry.cancelled) {
        scheduleChunkJobEntry(entry);
      }
      return null;
    }
    if (entry.awaitingPersistenceScheduling) {
      return persistencePromise;
    }
    entry.awaitingPersistenceScheduling = true;
    persistencePromise.finally(() => {
      entry.awaitingPersistenceScheduling = false;
      if (!entry.finalized && !entry.cancelled) {
        scheduleChunkJobEntry(entry);
      }
    });
    return persistencePromise;
  }

  function startChunkJob(entry, { budget = defaultPreloadBurst, unlimited = false } = {}) {
    if (!entry || entry.finalized) {
      return null;
    }
    const promise = ensurePendingEntryPromise(entry);
    const normalizedBudget = unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(Number(budget) || 0) || 1);
    let acceptedBudget = 0;
    if (unlimited) {
      entry.unlimited = true;
      entry.pendingBudget = Number.POSITIVE_INFINITY;
      entry.stepHint = Number.POSITIVE_INFINITY;
      acceptedBudget = Number.POSITIVE_INFINITY;
    } else if (!entry.unlimited) {
      const previousBudget = Number.isFinite(entry.pendingBudget)
        ? entry.pendingBudget
        : 0;
      entry.pendingBudget = previousBudget + normalizedBudget;
      entry.stepHint = Math.max(entry.stepHint || 0, normalizedBudget);
      acceptedBudget = normalizedBudget;
    }
    if (entry.waitingForCapacity) {
      if (promise && typeof promise === 'object') {
        promise.acceptedBudget = 0;
      }
      return promise;
    }
    if (!chunkPersistenceQueue) {
      scheduleChunkJobEntry(entry);
      if (promise && typeof promise === 'object') {
        promise.acceptedBudget = acceptedBudget;
      }
      return promise;
    }

    const persistenceState = entry.persistenceState ?? 'ready';
    if (persistenceState === 'ready' || persistenceState === 'failed') {
      scheduleChunkJobEntry(entry);
      if (promise && typeof promise === 'object') {
        promise.acceptedBudget = acceptedBudget;
      }
      return promise;
    }

    if (persistenceState === 'idle' || persistenceState === 'pending') {
      awaitChunkPersistenceAndReschedule(entry);
    }

    if (promise && typeof promise === 'object') {
      promise.acceptedBudget = acceptedBudget;
    }
    return promise;
  }
  let queueDirty = false;
  let urgentPreloadBoost = 0;

  const chunkCullFrustum = new THREE.Frustum();
  const chunkCullMatrix = new THREE.Matrix4();
  const chunkCullPadding = 1.5;
  let lastCamera = null;

  function parseColumnCoordinates(columnKey) {
    if (typeof columnKey !== 'string') {
      return null;
    }
    const parts = columnKey.split('|');
    if (parts.length < 2) {
      return null;
    }
    const x = Number.parseInt(parts[0], 10);
    const z = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }
    return { x, z };
  }

  function rebuildFluidSurface(chunk, type = 'water') {
    if (!chunk) {
      return false;
    }
    if (!(chunk.fluidColumnsByType instanceof Map)) {
      return false;
    }
    const columns = chunk.fluidColumnsByType.get(type);
    if (!(columns instanceof Map) || columns.size === 0) {
      return false;
    }

    const geometry = buildFluidGeometry({
      THREE,
      columns: Array.from(columns.values()),
    });
    const positionAttribute = geometry.getAttribute('position');
    if (!positionAttribute || positionAttribute.count === 0) {
      geometry.dispose();
      return false;
    }

    if (!Array.isArray(chunk.fluidSurfaces)) {
      chunk.fluidSurfaces = [];
    }

    const surface = chunk.fluidSurfaces.find(
      (mesh) => mesh?.userData?.fluidType === type,
    );
    if (!surface) {
      const mesh = createFluidSurface({ type, geometry });
      mesh.userData = mesh.userData || {};
      mesh.userData.type = `fluid:${type}`;
      mesh.userData.chunkKey = chunkKey(chunk.chunkX, chunk.chunkZ);
      applyFluidSurfaceMetadata(mesh, geometry);
      chunk.fluidSurfaces.push(mesh);
      chunk.group?.add(mesh);
      return true;
    }

    const previousGeometry = surface.geometry;
    surface.geometry = geometry;
    applyFluidSurfaceMetadata(surface, geometry);
    if (previousGeometry) {
      previousGeometry.dispose();
    }
    return true;
  }

  function settleFluidColumn(chunk, columnKey) {
    if (!chunk || !columnKey) {
      return false;
    }
    if (!(chunk.waterColumns instanceof Map)) {
      return false;
    }
    let metadata = chunk.waterColumns.get(columnKey);

    const coordinates = parseColumnCoordinates(columnKey);
    if (!coordinates) {
      return false;
    }

    const columnsByType =
      chunk.fluidColumnsByType instanceof Map ? chunk.fluidColumnsByType : null;
    const waterColumnStore = columnsByType?.get('water');
    const column = waterColumnStore instanceof Map ? waterColumnStore.get(columnKey) : null;

    if (!metadata) {
      if (!column) {
        return false;
      }
      metadata = {
        bottomY: Number.isFinite(column.bottomY) ? column.bottomY : column.surfaceY,
        surfaceY: Number.isFinite(column.surfaceY) ? column.surfaceY : column.bottomY,
      };
      chunk.waterColumns.set(columnKey, metadata);
      waterColumns.set(columnKey, metadata);
    }

    const surfaceY = Number.isFinite(metadata.surfaceY)
      ? metadata.surfaceY
      : Number.isFinite(column?.surfaceY)
      ? column.surfaceY
      : worldConfig.waterLevel + 0.5;
    const currentBottom = Number.isFinite(metadata.bottomY)
      ? metadata.bottomY
      : Number.isFinite(column?.bottomY)
      ? column.bottomY
      : surfaceY;

    if (!Number.isFinite(surfaceY) || !Number.isFinite(currentBottom)) {
      return false;
    }

    const startY = Math.floor(currentBottom - 0.5);
    const minYLimit = Number.isFinite(chunk.bounds?.minY)
      ? Math.floor(chunk.bounds.minY - 1)
      : -64;
    let supportTop = null;
    const chunkOverrides =
      Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};
    for (let y = startY; y >= minYLimit; y -= 1) {
      const candidateKey = `${coordinates.x}|${y}|${coordinates.z}`;
      if (solidBlocks.has(candidateKey, chunkOverrides)) {
        supportTop = y + 0.5;
        break;
      }
    }

    if (supportTop === null) {
      supportTop = minYLimit + 0.5;
    }

    if (!(supportTop < currentBottom - 1e-4)) {
      return false;
    }

    metadata.bottomY = supportTop;
    metadata.surfaceY = surfaceY;
    chunk.waterColumns.set(columnKey, metadata);
    waterColumns.set(columnKey, metadata);
    if (chunk.waterColumnKeys instanceof Set) {
      chunk.waterColumnKeys.add(columnKey);
    }

    if (column) {
      column.bottomY = supportTop;
      column.minY = Math.min(column.minY ?? supportTop, supportTop);
      column.surfaceY = surfaceY;
      column.maxY = Math.max(column.maxY ?? surfaceY, surfaceY);
      column.depth = Math.max(0.05, column.surfaceY - column.bottomY);
      if (!column.neighbors) {
        column.neighbors = {};
      }
      fluidNeighborOffsets.forEach((offset) => {
        const neighborKey = `${column.x + offset.dx}|${column.z + offset.dz}`;
        const neighborColumn = waterColumnStore?.get(neighborKey) ?? null;
        if (neighborColumn) {
          if (!neighborColumn.neighbors) {
            neighborColumn.neighbors = {};
          }
          neighborColumn.neighbors[offset.opposite] = {
            hasFluid: true,
            surfaceY: column.surfaceY,
            bottomY: column.bottomY,
            foamHint: Math.max(0, neighborColumn.surfaceY - column.surfaceY),
          };
          column.neighbors[offset.key] = {
            hasFluid: true,
            surfaceY: neighborColumn.surfaceY,
            bottomY: neighborColumn.bottomY,
            foamHint: Math.max(0, column.surfaceY - neighborColumn.surfaceY),
          };
        } else {
          column.neighbors[offset.key] = {
            hasFluid: false,
            surfaceY,
            bottomY: supportTop,
            foamHint: 0,
          };
        }
      });
    }

    rebuildFluidSurface(chunk, 'water');
    return true;
  }

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
      loadedChunks.forEach((chunk, key) => {
        touchLoadedChunkRecord(key, chunk);
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

    loadedChunks.forEach((chunk, key) => {
      touchLoadedChunkRecord(key, chunk);
      if (!chunk?.group) {
        return;
      }
      const visible = chunk.boundsBox
        ? chunkCullFrustum.intersectsBox(chunk.boundsBox)
        : true;
      chunk.group.visible = visible;
    });
  }

  function isRaycastTargetMesh(mesh) {
    if (!mesh?.isInstancedMesh) {
      return false;
    }
    const type = mesh.userData?.type;
    if (typeof type !== 'string') {
      return false;
    }
    return !type.startsWith('fluid:');
  }

  function trackRaycastTarget(mesh) {
    if (isRaycastTargetMesh(mesh)) {
      raycastTargets.add(mesh);
    }
  }

  function untrackRaycastTarget(mesh) {
    if (!mesh) {
      return;
    }
    raycastTargets.delete(mesh);
  }

  function ensureTypeRecord(chunk, type) {
    if (!chunk || !type) {
      return null;
    }
    if (!(chunk.typeData instanceof Map)) {
      chunk.typeData = new Map();
    }
    let record = chunk.typeData.get(type);
    if (record) {
      return record;
    }
    const capacitySource = chunk.typeCapacities instanceof Map
      ? chunk.typeCapacities.get(type)
      : null;
    const capacity = Math.max(1, Number.isInteger(capacitySource) ? capacitySource : 1);
    const { mesh, tintAttribute } = buildInstancedBlockMesh({
      THREE,
      blockMaterials,
      type,
      entries: [],
      capacity,
    });
    mesh.count = 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }
    mesh.userData = mesh.userData || {};
    mesh.userData.chunkKey = chunkKey(chunk.chunkX, chunk.chunkZ);
    chunk.group?.add(mesh);
    trackRaycastTarget(mesh);
    record = {
      entries: [],
      mesh,
      tintAttribute,
      capacity,
    };
    chunk.typeData.set(type, record);
    return record;
  }

  function ensureDecorationStore(chunk) {
    if (!chunk) {
      return null;
    }
    if (chunk.decorationData instanceof Map) {
      return chunk.decorationData;
    }
    if (chunk.decorationData && typeof chunk.decorationData === 'object') {
      const map = new Map();
      Object.entries(chunk.decorationData).forEach(([key, value]) => {
        map.set(key, value);
        trackRaycastTarget(value?.mesh);
      });
      chunk.decorationData = map;
      return map;
    }
    return null;
  }

  function releaseTintAttribute(attribute) {
    if (!attribute || typeof attribute !== 'object') {
      return;
    }
    if ('array' in attribute) {
      attribute.array = null;
    }
    attribute.needsUpdate = false;
  }

  function disposeInstancedMesh(mesh) {
    if (!mesh?.isInstancedMesh) {
      return;
    }

    const geometry = mesh.geometry;
    const tintAttribute =
      mesh.userData?.biomeTintAttribute ??
      (typeof geometry?.getAttribute === 'function'
        ? geometry.getAttribute('biomeTint')
        : geometry?.attributes?.biomeTint ?? null);

    if (tintAttribute) {
      releaseTintAttribute(tintAttribute);
    }

    if (geometry?.deleteAttribute) {
      geometry.deleteAttribute('biomeTint');
    } else if (geometry?.attributes && geometry.attributes.biomeTint) {
      delete geometry.attributes.biomeTint;
    }

    geometry?.dispose?.();

    if (mesh.userData) {
      mesh.userData.biomeTintAttribute = null;
      mesh.userData.chunkKey = null;
    }

    mesh.geometry = null;
  }

  function getDecorationRecord(chunk, type) {
    if (!chunk || !type) {
      return null;
    }
    const store = ensureDecorationStore(chunk);
    if (!store) {
      return null;
    }
    const record = store.get(type);
    if (!record || !Array.isArray(record.entries) || !record.mesh?.isInstancedMesh) {
      return null;
    }
    return record;
  }

  function resolveDecorationGroup(chunk, entry) {
    if (!chunk || !entry) {
      return null;
    }
    if (!(chunk.decorationGroups instanceof Map)) {
      return entry.decorationGroup ?? null;
    }
    const candidates = [];
    if (entry.decorationGroup?.key) {
      candidates.push(entry.decorationGroup.key);
    }
    if (typeof entry.decorationGroupKey === 'string') {
      candidates.push(entry.decorationGroupKey);
    }
    if (entry.key) {
      candidates.push(entry.key);
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const key = candidates[i];
      if (!key || !chunk.decorationGroups.has(key)) {
        continue;
      }
      const group = chunk.decorationGroups.get(key);
      if (group) {
        entry.decorationGroup = group;
        entry.decorationGroupKey = group.key ?? key;
        if (!Array.isArray(group.instanceIndices)) {
          group.instanceIndices = Array.isArray(group.instanceIndices)
            ? group.instanceIndices.filter((value) => Number.isInteger(value))
            : [];
        }
        if (!Array.isArray(group.hiddenEntries)) {
          group.hiddenEntries = [];
        }
        return group;
      }
    }
    if (entry.decorationGroup) {
      if (!Array.isArray(entry.decorationGroup.instanceIndices)) {
        entry.decorationGroup.instanceIndices = [];
      }
      if (!Array.isArray(entry.decorationGroup.hiddenEntries)) {
        entry.decorationGroup.hiddenEntries = [];
      }
    }
    return entry.decorationGroup ?? null;
  }

  function getDecorationGroupsForType(chunk, type) {
    if (!chunk || !type) {
      return [];
    }
    if (chunk.decorationTypeIndex instanceof Map && chunk.decorationTypeIndex.has(type)) {
      return Array.from(chunk.decorationTypeIndex.get(type)).filter(Boolean);
    }
    if (chunk.decorationGroups instanceof Map) {
      return Array.from(chunk.decorationGroups.values()).filter(
        (group) => group && group.type === type,
      );
    }
    return [];
  }

  function ensureGroupHasHiddenList(group) {
    if (!group) {
      return null;
    }
    if (!Array.isArray(group.hiddenEntries)) {
      group.hiddenEntries = [];
    }
    return group.hiddenEntries;
  }

  function resolveChunkBlockIndex(
    chunk,
    property,
    { createIfMissing = false } = {},
  ) {
    if (!chunk) {
      return null;
    }
    const current = chunk[property];
    if (isChunkBlockIndex(current)) {
      return current;
    }
    const hasCurrent = current !== undefined && current !== null;
    if (!hasCurrent && !createIfMissing) {
      return null;
    }
    const overrides =
      Number.isFinite(chunk.chunkX) && Number.isFinite(chunk.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};
    const index = createChunkBlockIndex({
      chunkSize: worldConfig.chunkSize,
      chunkX: overrides.chunkX,
      chunkZ: overrides.chunkZ,
    });
    if (hasCurrent) {
      const applyKey = (key) => {
        const coords = parseBlockCoordinateKey(key);
        if (!coords) {
          return;
        }
        index.add(coords, overrides);
      };
      if (current instanceof Set || Array.isArray(current)) {
        current.forEach(applyKey);
      } else if (current && typeof current.forEach === 'function') {
        current.forEach((value, keyCandidate) => {
          if (typeof keyCandidate === 'string') {
            applyKey(keyCandidate);
          } else {
            applyKey(value);
          }
        });
      } else if (current && typeof current === 'object') {
        Object.keys(current).forEach(applyKey);
      }
    }
    if (hasCurrent || createIfMissing) {
      chunk[property] = index;
      return index;
    }
    return null;
  }

  function populateChunkBlockIndex(index, source, overrides = {}) {
    if (!index || !source) {
      return;
    }
    const applyKey = (key) => {
      const coords = parseBlockCoordinateKey(key);
      if (!coords) {
        return;
      }
      index.add(coords, overrides);
    };
    if (isChunkBlockIndex(source)) {
      source.forEach((key) => applyKey(key));
      return;
    }
    if (source instanceof Set || Array.isArray(source)) {
      source.forEach(applyKey);
      return;
    }
    if (typeof source?.forEach === 'function') {
      source.forEach((value, keyCandidate) => {
        if (typeof keyCandidate === 'string') {
          applyKey(keyCandidate);
        } else {
          applyKey(value);
        }
      });
      return;
    }
    if (typeof source === 'object') {
      Object.keys(source).forEach(applyKey);
      return;
    }
    if (typeof source?.[Symbol.iterator] === 'function') {
      for (const value of source) {
        applyKey(value);
      }
    }
  }

  function addEntryToChunkMesh(chunk, entry) {
    if (!chunk || !entry) {
      return;
    }
    if (entry.isDecoration) {
      const record = getDecorationRecord(chunk, entry.type);
      if (!record) {
        return;
      }
      const { entries, mesh, tintAttribute } = record;
      if (Number.isInteger(entry.index) && entry.index >= 0) {
        entry.isHidden = false;
        return;
      }
      const capacity = Number.isInteger(mesh.instanceMatrix?.count)
        ? mesh.instanceMatrix.count
        : mesh.count ?? entries.length;
      if (entries.length >= capacity) {
        return;
      }
      const index = entries.length;
      entries.push(entry);
      entry.index = index;
      mesh.setMatrixAt(index, entry.matrix);
      mesh.count = entries.length;
      mesh.instanceMatrix.needsUpdate = true;
      const tint = entry.tintColor ?? mesh.userData?.defaultTint;
      if (tintAttribute && tint) {
        const offset = index * 3;
        tintAttribute.array[offset] = tint.r;
        tintAttribute.array[offset + 1] = tint.g;
        tintAttribute.array[offset + 2] = tint.b;
        tintAttribute.needsUpdate = true;
      }
      entry.mesh = mesh;
      entry.tintAttribute = tintAttribute;
      entry.isHidden = false;
      entry.isVisible = true;
      const group = resolveDecorationGroup(chunk, entry);
      if (group && Array.isArray(group.instanceIndices)) {
        if (!group.instanceIndices.includes(index)) {
          group.instanceIndices.push(index);
          group.instanceIndices.sort((a, b) => a - b);
        }
        const hiddenList = ensureGroupHasHiddenList(group);
        const hiddenIndex = hiddenList.indexOf(entry);
        if (hiddenIndex >= 0) {
          hiddenList.splice(hiddenIndex, 1);
        }
      }
      return;
    }
    const record = ensureTypeRecord(chunk, entry.type);
    if (!record) {
      return;
    }
    const { entries, mesh, tintAttribute } = record;
    if (Number.isInteger(entry.index) && entry.index >= 0) {
      return;
    }
    const capacity = mesh.instanceMatrix.count;
    if (entries.length >= capacity) {
      return;
    }
    const index = entries.length;
    entries.push(entry);
    entry.index = index;
    mesh.setMatrixAt(index, entry.matrix);
    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    const tint = entry.tintColor ?? mesh.userData?.defaultTint;
    if (tintAttribute && tint) {
      const offset = index * 3;
      tintAttribute.array[offset] = tint.r;
      tintAttribute.array[offset + 1] = tint.g;
      tintAttribute.array[offset + 2] = tint.b;
      tintAttribute.needsUpdate = true;
    }
    entry.mesh = mesh;
    entry.tintAttribute = tintAttribute;
    entry.isVisible = true;
    const coordinateKey = entry.coordinateKey ?? entry.key;
    if (coordinateKey) {
      const coords = parseBlockCoordinateKey(coordinateKey);
      if (coords) {
        const overrides =
          Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
            ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
            : {};
        if (entry.isSolid) {
          const chunkSolidKeys = resolveChunkBlockIndex(
            chunk,
            'solidBlockKeys',
            { createIfMissing: true },
          );
          chunkSolidKeys?.add(coords, overrides);
          solidBlocks.add(coords, overrides);
        }
        if (entry.collisionMode === 'soft') {
          const chunkSoftKeys = resolveChunkBlockIndex(
            chunk,
            'softBlockKeys',
            { createIfMissing: true },
          );
          chunkSoftKeys?.add(coords, overrides);
          softBlocks.add(coords, overrides);
        }
      }
    }
  }

  function removeEntryFromChunkMesh(chunk, entry, { preserveMetadata = false } = {}) {
    const coordinateKey = entry?.coordinateKey ?? entry?.key;
    const removeCollisionKeys = () => {
      if (!chunk || !entry || !coordinateKey) {
        return;
      }
      const coords = parseBlockCoordinateKey(coordinateKey);
      if (!coords) {
        return;
      }
      const overrides =
        Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
          ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
          : {};
      if (entry.isSolid) {
        const chunkSolidKeys = resolveChunkBlockIndex(chunk, 'solidBlockKeys');
        chunkSolidKeys?.delete(coords, overrides);
        solidBlocks.delete(coords, overrides);
      }
      if (entry.collisionMode === 'soft') {
        const chunkSoftKeys = resolveChunkBlockIndex(chunk, 'softBlockKeys');
        chunkSoftKeys?.delete(coords, overrides);
        softBlocks.delete(coords, overrides);
      }
    };
    if (!chunk || !entry || !chunk.typeData) {
      if (entry) {
        entry.index = -1;
        entry.mesh = null;
        entry.tintAttribute = null;
      }
      removeCollisionKeys();
      return;
    }
    if (entry.isDecoration) {
      const record = getDecorationRecord(chunk, entry.type);
      if (!record) {
        entry.index = -1;
        entry.mesh = null;
        entry.tintAttribute = null;
        if (!preserveMetadata) {
          entry.isHidden = false;
        }
        removeCollisionKeys();
        return;
      }
      const { entries, mesh, tintAttribute } = record;
      const index = entry.index;
      const entryGroup = resolveDecorationGroup(chunk, entry);
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
        entry.index = -1;
        entry.mesh = null;
        entry.tintAttribute = null;
        if (!preserveMetadata) {
          entry.isHidden = false;
          if (entryGroup) {
            const hiddenList = ensureGroupHasHiddenList(entryGroup);
            const hiddenIndex = hiddenList.indexOf(entry);
            if (hiddenIndex >= 0) {
              hiddenList.splice(hiddenIndex, 1);
            }
          }
        }
        removeCollisionKeys();
        return;
      }
      const lastIndex = entries.length - 1;
      const swapped = entries[lastIndex];
      if (index !== lastIndex) {
        entries[index] = swapped;
        mesh.setMatrixAt(index, swapped.matrix);
        const tint = swapped.tintColor ?? mesh.userData?.defaultTint;
        if (tintAttribute && tint) {
          const offset = index * 3;
          tintAttribute.array[offset] = tint.r;
          tintAttribute.array[offset + 1] = tint.g;
          tintAttribute.array[offset + 2] = tint.b;
        }
        swapped.index = index;
      }
      entries.pop();
      mesh.count = entries.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (tintAttribute) {
        tintAttribute.needsUpdate = true;
      }
      const typeGroups = getDecorationGroupsForType(chunk, entry.type);
      typeGroups.forEach((group) => {
        if (!group || !Array.isArray(group.instanceIndices)) {
          return;
        }
        for (let i = group.instanceIndices.length - 1; i >= 0; i -= 1) {
          const value = group.instanceIndices[i];
          if (value === index) {
            group.instanceIndices.splice(i, 1);
          } else if (value === lastIndex && index !== lastIndex) {
            group.instanceIndices[i] = index;
          }
        }
        if (!preserveMetadata && Array.isArray(group.hiddenEntries)) {
          const hiddenIndex = group.hiddenEntries.indexOf(entry);
          if (hiddenIndex >= 0) {
            group.hiddenEntries.splice(hiddenIndex, 1);
          }
        }
      });
      if (entryGroup) {
        const hiddenList = ensureGroupHasHiddenList(entryGroup);
        if (preserveMetadata) {
          if (!hiddenList.includes(entry)) {
            hiddenList.push(entry);
          }
        } else {
          const hiddenIndex = hiddenList.indexOf(entry);
          if (hiddenIndex >= 0) {
            hiddenList.splice(hiddenIndex, 1);
          }
        }
      }
      entry.index = -1;
      entry.mesh = null;
      entry.tintAttribute = null;
      entry.isHidden = preserveMetadata;
      removeCollisionKeys();
      return;
    }
    const record = chunk.typeData.get(entry.type);
    if (!record) {
      entry.index = -1;
      entry.mesh = null;
      entry.tintAttribute = null;
      removeCollisionKeys();
      return;
    }
    const { entries, mesh, tintAttribute } = record;
    const index = entry.index;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      entry.index = -1;
      entry.mesh = null;
      entry.tintAttribute = null;
      removeCollisionKeys();
      return;
    }
    const lastIndex = entries.length - 1;
    if (index !== lastIndex) {
      const swapped = entries[lastIndex];
      entries[index] = swapped;
      mesh.setMatrixAt(index, swapped.matrix);
      const tint = swapped.tintColor ?? mesh.userData?.defaultTint;
      if (tintAttribute && tint) {
        const offset = index * 3;
        tintAttribute.array[offset] = tint.r;
        tintAttribute.array[offset + 1] = tint.g;
        tintAttribute.array[offset + 2] = tint.b;
      }
      swapped.index = index;
    }
    entries.pop();
    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (tintAttribute) {
      tintAttribute.needsUpdate = true;
    }
    entry.index = -1;
    entry.mesh = null;
    entry.tintAttribute = null;
    entry.isHidden = false;
    removeCollisionKeys();
  }

  function computeBlockVisibility(chunk, entry) {
    if (!chunk || !entry || !entry.position) {
      return false;
    }
    const baseX = Math.round(entry.position.x);
    const baseY = Math.round(entry.position.y);
    const baseZ = Math.round(entry.position.z);
    const resolveOccluding = (candidate) => {
      if (!candidate) {
        return false;
      }
      if (typeof candidate.isOccluding === 'boolean') {
        return candidate.isOccluding;
      }
      return isBlockOccluding(candidate, blockMaterials);
    };

    for (let i = 0; i < blockNeighborOffsets.length; i += 1) {
      const offset = blockNeighborOffsets[i];
      const neighborKey = makeBlockKey(
        baseX + offset.dx,
        baseY + offset.dy,
        baseZ + offset.dz,
      );
      const neighborEntry = chunk.blockLookup?.get(neighborKey);
      if (neighborEntry && neighborEntry !== entry) {
        if (resolveOccluding(neighborEntry)) {
          continue;
        }
      }
      if (chunk.fluidBlockKeys?.has(neighborKey)) {
        return true;
      }
      if (!neighborEntry || !resolveOccluding(neighborEntry)) {
        return true;
      }
    }
    return false;
  }

  function refreshBlockVisibility(chunk, positions) {
    if (!chunk || !(chunk.blockLookup instanceof Map)) {
      return;
    }
    const targets = new Map();
    const appendPosition = (pos) => {
      if (!pos) {
        return;
      }
      const key = makeBlockKey(pos.x, pos.y, pos.z);
      targets.set(key, pos);
    };
    (Array.isArray(positions) ? positions : []).forEach((pos) => {
      if (!pos) {
        return;
      }
      appendPosition(pos);
      blockNeighborOffsets.forEach((offset) => {
        appendPosition({
          x: pos.x + offset.dx,
          y: pos.y + offset.dy,
          z: pos.z + offset.dz,
        });
      });
    });
    targets.forEach((pos, key) => {
      const entry = chunk.blockLookup.get(key);
      if (!entry) {
        return;
      }
      const shouldBeVisible = computeBlockVisibility(chunk, entry);
      const currentlyVisible = Number.isInteger(entry.index) && entry.index >= 0;
      if (shouldBeVisible && !currentlyVisible) {
        addEntryToChunkMesh(chunk, entry);
      } else if (!shouldBeVisible && currentlyVisible) {
        removeEntryFromChunkMesh(chunk, entry, { preserveMetadata: entry.isDecoration });
      }
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


  function registerGeneratedChunk(chunk, options = {}) {
    if (!chunk) {
      return;
    }
    const { chunkX, chunkZ } = chunk;
    const key = chunkKey(chunkX, chunkZ);
    const budgetHandled = options?.budgetCheckHandled === true;
    if (!budgetHandled) {
      ensureResidentCapacityForChunk(key, {
        protectedKeys: options?.protectedKeys,
      });
    }
    if (loadedChunks.has(key)) {
      touchLoadedChunkRecord(key);
      return;
    }

    initializeChunkPersistenceState(
      key,
      chunk,
      chunk.__cachePayload ?? null,
      chunk.__persistenceResult ?? null,
    );
    chunk.__persistenceResult = null;

    ensureChunkEntityState(key, chunkX, chunkZ, chunk);

    chunk.group.frustumCulled = false;
    applyChunkBounds(chunk);
    chunk.group.traverse((child) => {
      if (!child?.isInstancedMesh) {
        return;
      }
      const { type } = child.userData || {};
      if (!type) {
        return;
      }
      child.userData.chunkKey = key;
      trackRaycastTarget(child);
    });
    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.userData = surface.userData || {};
      surface.userData.chunkKey = key;
    });
    scene.add(chunk.group);
    const chunkOverrides =
      Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};
    const chunkSolidIndex = resolveChunkBlockIndex(
      chunk,
      'solidBlockKeys',
      { createIfMissing: true },
    );
    chunkSolidIndex?.forEach((block) =>
      solidBlocks.add(block, chunkOverrides),
    );
    const chunkSoftIndex = resolveChunkBlockIndex(
      chunk,
      'softBlockKeys',
      { createIfMissing: true },
    );
    chunkSoftIndex?.forEach((block) =>
      softBlocks.add(block, chunkOverrides),
    );
    const chunkWaterColumnSource =
      chunk.waterColumns ?? chunk.waterColumnKeys ?? null;
    const chunkWaterColumns = ensureWaterColumnMap(chunkWaterColumnSource);
    const normalizedWaterColumns = new Map();
    chunkWaterColumns.forEach((bounds, columnKey) => {
      const normalized =
        bounds === null ? null : normalizeWaterColumnBounds(bounds);
      normalizedWaterColumns.set(columnKey, normalized);
      waterColumns.set(columnKey, normalized);
    });
    chunk.waterColumns = normalizedWaterColumns;
    chunk.waterColumnKeys = new Set(normalizedWaterColumns.keys());

    if (chunk.fluidBlockKeys instanceof Set) {
      chunk.fluidBlockKeys = new Set(chunk.fluidBlockKeys);
    } else if (Array.isArray(chunk.fluidBlockKeys)) {
      chunk.fluidBlockKeys = new Set(chunk.fluidBlockKeys);
    } else if (chunk.fluidBlockKeys && typeof chunk.fluidBlockKeys === 'object') {
      chunk.fluidBlockKeys = new Set(Object.keys(chunk.fluidBlockKeys));
    } else {
      chunk.fluidBlockKeys = new Set();
    }

    if (chunk.fluidColumnsByType instanceof Map) {
      chunk.fluidColumnsByType = new Map(
        Array.from(chunk.fluidColumnsByType.entries()).map(([type, columns]) => [
          type,
          columns instanceof Map ? columns : new Map(columns ?? []),
        ]),
      );
    } else if (chunk.fluidColumnsByType && typeof chunk.fluidColumnsByType === 'object') {
      const fluidMap = new Map();
      Object.entries(chunk.fluidColumnsByType).forEach(([type, columns]) => {
        if (columns instanceof Map) {
          fluidMap.set(type, columns);
        } else if (Array.isArray(columns)) {
          fluidMap.set(type, new Map(columns));
        }
      });
      chunk.fluidColumnsByType = fluidMap;
    } else {
      chunk.fluidColumnsByType = new Map();
    }
    const chunkWaterColumnsMap = chunk.fluidColumnsByType.get('water');
    if (chunkWaterColumnsMap instanceof Map) {
      chunkWaterColumnsMap.forEach((column, columnKey) => {
        const normalized = normalizedWaterColumns.get(columnKey);
        if (!normalized || !column) {
          return;
        }
        column.bottomY = normalized.bottomY;
        column.minY = Math.min(column.minY ?? normalized.bottomY, normalized.bottomY);
        column.surfaceY = normalized.surfaceY;
        column.maxY = Math.max(column.maxY ?? normalized.surfaceY, normalized.surfaceY);
        column.depth = Math.max(0.05, column.surfaceY - column.bottomY);
      });
    }

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
    touchLoadedChunkRecord(key, chunk);

    chunk.__budgetKey = key;
    const normalizedDetailLevel = normalizeDetailLevel(
      chunk.detailLevel ?? chunk.desiredDetailLevel ?? DETAIL_LEVEL_SCOUT,
    );
    if (
      detailLevelRank(normalizedDetailLevel) >
      detailLevelRank(DETAIL_LEVEL_SCOUT)
    ) {
      const memoryStats = computeChunkMemoryStatsForBudget(chunk);
      chunk.__budgetTracked = true;
      chunk.__budgetStats = memoryStats;
      emitChunkMeshed({
        key,
        chunkX,
        chunkZ,
        detailLevel: normalizedDetailLevel,
        memory: memoryStats,
      });
    } else {
      chunk.__budgetTracked = false;
      chunk.__budgetStats = null;
    }

    if (!hasEmittedFirstChunkMeshed) {
      const normalizedDetail = normalizeDetailLevel(
        chunk.detailLevel ?? chunk.desiredDetailLevel ?? DETAIL_LEVEL_SCOUT,
      );
      const isCoreDetail =
        detailLevelRank(normalizedDetail) >=
        detailLevelRank(DETAIL_LEVEL_CORE);

      const isCenterChunk =
        hasLastCenter &&
        chunkX === lastCenterChunkX &&
        chunkZ === lastCenterChunkZ;

      const targetColumnCoordinates = (() => {
        const lastKnown = parseColumnCoordinates(lastKnownPlayerColumnKey);
        if (lastKnown) {
          return lastKnown;
        }
        return parseColumnCoordinates(spawnColumnKey);
      })();

      let spawnColumnReady = false;
      if (targetColumnCoordinates) {
        const { x: columnX, z: columnZ } = targetColumnCoordinates;
        const columnChunkX = worldToChunk(columnX);
        const columnChunkZ = worldToChunk(columnZ);
        if (chunkX === columnChunkX && chunkZ === columnChunkZ) {
          spawnColumnReady =
            collectionHasSolidInColumn(chunk.solidBlockKeys, columnX, columnZ) ||
            collectionHasSolidInColumn(solidBlocks, columnX, columnZ);
        }
      }

      if (isCenterChunk && isCoreDetail && spawnColumnReady) {
        hasEmittedFirstChunkMeshed = true;
        dispatchChunkEvent(ChunkManagerEvents.FIRST_CHUNK_MESHED, {
          chunkX,
          chunkZ,
          chunkKey: key,
        });
      }
    }

    if (chunk.__cachePayload) {
      if (payloadCacheCapacity > 0) {
        const cachePayload = buildCachePayloadFromChunk(chunk, key);
        if (cachePayload) {
          setCachedPayload(key, {
            payload: cachePayload,
            detailLevel: normalizeDetailLevel(
              chunk.detailLevel ?? cachePayload.detailLevel,
            ),
          });
        }
      }
      chunk.__cachePayload = null;
    }
  }

  function ensureChunk(chunkX, chunkZ, options = {}) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      touchLoadedChunkRecord(key);
      return;
    }
    const blocking = options.blocking === true;
    const centerChunkX =
      typeof options.centerChunkX === 'number' ? options.centerChunkX : chunkX;
    const centerChunkZ =
      typeof options.centerChunkZ === 'number' ? options.centerChunkZ : chunkZ;
    const urgentBurst = Math.max(1, defaultPreloadBurst);
    let entry = getPendingEntryByKey(key);
    if (!entry) {
      entry = schedulePreload(chunkX, chunkZ, centerChunkX, centerChunkZ, {
        urgent: true,
        detailLevel: DETAIL_LEVEL_CORE,
      });
    } else if (!entry.urgent) {
      entry.urgent = true;
      queueDirty = true;
    }

    if (
      detailLevelRank(entry.desiredDetailLevel) < detailLevelRank(DETAIL_LEVEL_CORE)
    ) {
      entry.desiredDetailLevel = DETAIL_LEVEL_CORE;
      if (entry.waitingForCapacity) {
        queueWaitingPreloadEntry(entry);
        tryActivateWaitingEntry(entry);
      } else {
        preloadQueue.update(entry);
      }
    }

    if (!entry) {
      return;
    }

    if (blocking) {
      startChunkJob(entry, { unlimited: true });
      return;
    }

    startChunkJob(entry, { budget: urgentBurst });
    urgentPreloadBoost = Math.max(urgentPreloadBoost, urgentBurst);
  }

  function cancelChunkDisposal(key) {
    if (!scheduledChunkDisposals.has(key)) {
      return;
    }
    scheduledChunkDisposals.delete(key);
    for (let i = chunkDisposalQueue.length - 1; i >= 0; i -= 1) {
      if (chunkDisposalQueue[i] === key) {
        chunkDisposalQueue.splice(i, 1);
      }
    }
  }

  function queueChunkForDisposal(key, { front = false } = {}) {
    if (!key || scheduledChunkDisposals.has(key) || !loadedChunks.has(key)) {
      return;
    }
    if (front) {
      chunkDisposalQueue.unshift(key);
    } else {
      chunkDisposalQueue.push(key);
    }
    scheduledChunkDisposals.add(key);
  }

  function processChunkDisposalQueue(limit = Number.POSITIVE_INFINITY) {
    if (chunkDisposalQueue.length === 0) {
      return 0;
    }

    const unlimited = !Number.isFinite(limit);
    let budget = unlimited
      ? chunkDisposalQueue.length
      : Math.max(0, Math.floor(limit));
    let processed = 0;

    while (chunkDisposalQueue.length > 0 && (unlimited || processed < budget)) {
      const key = chunkDisposalQueue.shift();
      scheduledChunkDisposals.delete(key);
      if (!loadedChunks.has(key)) {
        continue;
      }
      disposeChunk(key);
      processed += 1;
    }

    return processed;
  }

  function disposeChunk(key) {
    cancelChunkDisposal(key);
    dropPendingActivation(key, { disposeChunk: true, settle: true });
    cancelActiveChunkUpgrade(key, { disposeTask: true });
    chunkUpgradeStateByKey.delete(key);
    const pendingEntry = getPendingEntryByKey(key);
    if (pendingEntry) {
      cancelPendingEntry(pendingEntry);
    }
    const chunk = loadedChunks.get(key);
    if (!chunk) {
      return;
    }

    if (chunk.__budgetTracked) {
      const normalizedDetail = normalizeDetailLevel(
        chunk.detailLevel ?? chunk.desiredDetailLevel ?? DETAIL_LEVEL_SCOUT,
      );
      emitChunkDisposed({
        key: chunk.__budgetKey ?? key,
        chunkX: Number.isFinite(chunk.chunkX) ? chunk.chunkX : null,
        chunkZ: Number.isFinite(chunk.chunkZ) ? chunk.chunkZ : null,
        detailLevel: normalizedDetail,
        memory: chunk.__budgetStats ?? null,
      });
    }
    chunk.__budgetTracked = false;
    chunk.__budgetStats = null;
    chunk.__budgetKey = null;

    const pendingJournalOps = chunkJournalQueues.get(key) ?? [];
    const pendingFlush =
      pendingJournalOps.length > 0
        ? flushChunkJournal(key, chunk).catch((error) => {
            console.warn(
              '[chunk-manager] Failed to flush chunk journal before disposal',
              error,
            );
          })
        : null;
    if (pendingFlush) {
      pendingFlush.finally(() => {
        chunkJournalQueues.delete(key);
        chunkPersistenceState.delete(key);
        chunksPendingCompaction.delete(key);
        dirtyChunks.delete(key);
      });
    } else {
      chunkJournalQueues.delete(key);
      chunkPersistenceState.delete(key);
      chunksPendingCompaction.delete(key);
      dirtyChunks.delete(key);
    }

    const pendingEntityDeltas = entityDeltaQueues.get(key) ?? [];
    const entityFlushPromise =
      pendingEntityDeltas.length > 0
        ? flushChunkEntityLog(key).catch((error) => {
            console.warn(
              '[chunk-manager] Failed to flush entity log before disposal',
              error,
            );
          })
        : Promise.resolve();
    const entityRemovalPromise =
      entityStore && typeof entityStore.removeChunkEntities === 'function'
        ? entityFlushPromise
            .then(() => entityStore.removeChunkEntities({ key }))
            .catch((error) => {
              console.warn(
                '[chunk-manager] Failed to remove chunk entities during disposal',
                error,
              );
            })
        : entityFlushPromise.catch(() => {});
    entityRemovalPromise.finally(() => {
      cleanupChunkEntityState(key);
    });

    if (
      chunkPersistenceQueue &&
      typeof chunkPersistenceQueue.enqueueSave === 'function'
    ) {
      const storeKey = {
        cx: Number.isFinite(chunk.chunkX) ? chunk.chunkX : 0,
        cy: 0,
        cz: Number.isFinite(chunk.chunkZ) ? chunk.chunkZ : 0,
      };
      enqueueChunkPersistenceJob(key, () =>
        chunkPersistenceQueue.enqueueSave({
          key: storeKey,
          chunkKey: key,
          detailLevel: chunk.detailLevel ?? DETAIL_LEVEL_CORE,
          payload: chunk.__cachePayload ?? null,
          timeoutMs: chunkPersistenceTimeoutMs,
        }),
      ).catch((error) => {
        console.warn('[chunk-manager] chunk persistence save failed', error);
      });
    }

    refreshCacheForWorldChange();
    if (payloadCacheCapacity > 0) {
      const cachePayload = buildCachePayloadFromChunk(chunk, key);
      if (cachePayload) {
        setCachedPayload(key, {
          payload: cachePayload,
          detailLevel: chunk.detailLevel,
        });
      }
    }
    if (chunk.__cachePayload) {
      chunk.__cachePayload = null;
    }

    invalidateTerrainSamplesForChunk({
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      chunkSize: worldConfig.chunkSize,
    });

    const instancedMeshes = new Set();
    if (chunk.group?.isObject3D) {
      chunk.group.traverse((child) => {
        if (child?.isInstancedMesh) {
          instancedMeshes.add(child);
        }
      });
    }

    if (chunk.typeData instanceof Map) {
      chunk.typeData.forEach((typeData) => {
        if (typeData?.mesh?.isInstancedMesh) {
          instancedMeshes.add(typeData.mesh);
        }
      });
    }

    const enqueueDecorationMesh = (record) => {
      if (record?.mesh?.isInstancedMesh) {
        instancedMeshes.add(record.mesh);
      }
    };

    if (chunk.decorationData instanceof Map) {
      chunk.decorationData.forEach(enqueueDecorationMesh);
    } else if (chunk.decorationData && typeof chunk.decorationData === 'object') {
      Object.values(chunk.decorationData).forEach(enqueueDecorationMesh);
    }

    instancedMeshes.forEach((mesh) => {
      untrackRaycastTarget(mesh);
      disposeInstancedMesh(mesh);
      mesh.parent?.remove(mesh);
    });

    scene.remove(chunk.group);
    chunk.group?.clear?.();
    chunk.group = null;

    (chunk.fluidSurfaces ?? []).forEach((surface) => {
      surface.geometry?.dispose?.();
      disposeFluidSurface(surface);
    });
    const chunkOverrides =
      Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};
    resolveChunkBlockIndex(chunk, 'solidBlockKeys')?.forEach((block) =>
      solidBlocks.delete(block, chunkOverrides),
    );
    resolveChunkBlockIndex(chunk, 'softBlockKeys')?.forEach((block) =>
      softBlocks.delete(block, chunkOverrides),
    );
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
    if (chunk.typeData instanceof Map) {
      chunk.typeData.forEach((record) => {
        if (!record) {
          return;
        }
        if (Array.isArray(record.entries)) {
          record.entries.forEach((entry) => {
            if (!entry) {
              return;
            }
            entry.mesh = null;
            entry.tintAttribute = null;
            entry.index = -1;
          });
          record.entries.length = 0;
        }
        releaseTintAttribute(record.tintAttribute);
        record.mesh = null;
        record.tintAttribute = null;
      });
      chunk.typeData.clear();
    }
    chunk.typeData = null;

    const disposeDecorationRecord = (record) => {
      if (!record) {
        return;
      }
      if (Array.isArray(record.entries)) {
        record.entries.forEach((entry) => {
          if (!entry) {
            return;
          }
          entry.mesh = null;
          entry.tintAttribute = null;
          if (entry.decorationGroup) {
            entry.decorationGroup = null;
          }
        });
        record.entries.length = 0;
      }
      releaseTintAttribute(record.tintAttribute);
      record.mesh = null;
      record.tintAttribute = null;
    };

    if (chunk.decorationData instanceof Map) {
      chunk.decorationData.forEach(disposeDecorationRecord);
      chunk.decorationData.clear();
    } else if (chunk.decorationData && typeof chunk.decorationData === 'object') {
      Object.values(chunk.decorationData).forEach(disposeDecorationRecord);
    }
    chunk.decorationData = null;

    if (chunk.decorationGroups instanceof Map) {
      chunk.decorationGroups.clear();
    }
    chunk.decorationGroups = null;
    if (chunk.decorationTypeIndex instanceof Map) {
      chunk.decorationTypeIndex.clear();
    }
    chunk.decorationTypeIndex = null;
    if (chunk.decorationOwnerIndex instanceof Map) {
      chunk.decorationOwnerIndex.clear();
    }
    chunk.decorationOwnerIndex = null;
    if (chunk.boundsBox) {
      chunk.boundsBox.makeEmpty?.();
    }
    loadedChunks.delete(key);
  }

  function schedulePreload(
    chunkX,
    chunkZ,
    centerChunkX,
    centerChunkZ,
    options = {},
  ) {
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      touchLoadedChunkRecord(key);
      return;
    }

    refreshCacheForWorldChange();

    const { urgent = false } = options;
    const maxDistance = options.maxDistance;
    const requestedDetailLevel = normalizeDetailLevel(options.detailLevel);
    const dx = chunkX - centerChunkX;
    const dz = chunkZ - centerChunkZ;
    const chunkDistance = Math.max(Math.abs(dx), Math.abs(dz));
    let priority = dx * dx + dz * dz;
    if (activeDirectionalContext?.priorityBiasFactor > 0) {
      const offsetLength = Math.hypot(dx, dz);
      if (Number.isFinite(offsetLength) && offsetLength > 0) {
        const dot =
          activeDirectionalContext.heading.x * (dx / offsetLength) +
          activeDirectionalContext.heading.z * (dz / offsetLength);
        priority -= dot * activeDirectionalContext.priorityBiasFactor;
      } else {
        priority -= activeDirectionalContext.priorityBiasFactor;
      }
    }

    const activeEntry = pendingPreloadEntries.get(key) ?? null;
    const waitingEntry = activeEntry ? null : waitingPreloadEntries.get(key) ?? null;
    const existing = activeEntry ?? waitingEntry ?? null;
    const pendingActivationRecord =
      pendingActivationByKey.get(key) ?? existing?.pendingChunk ?? null;

    if (
      !existing &&
      !pendingActivationRecord &&
      Number.isFinite(maxDistance) &&
      chunkDistance > maxDistance
    ) {
      return null;
    }

    if (!existing && pendingActivationRecord) {
      const pendingEntry = pendingActivationRecord.entry ?? null;
      const nextUrgent = Boolean(urgent);
      let reprioritize = false;
      if (pendingEntry) {
        if (typeof pendingEntry.priority === 'number') {
          pendingEntry.priority = priority;
        }
        if (nextUrgent && !pendingEntry.urgent) {
          pendingEntry.urgent = true;
          reprioritize = true;
        }
        if (
          detailLevelRank(pendingEntry.desiredDetailLevel) <
          detailLevelRank(requestedDetailLevel)
        ) {
          pendingEntry.desiredDetailLevel = requestedDetailLevel;
          if (pendingEntry.waitingForCapacity) {
            queueWaitingPreloadEntry(pendingEntry);
            tryActivateWaitingEntry(pendingEntry);
          } else {
            preloadQueue.update(pendingEntry);
          }
          if (pendingActivationRecord.chunk) {
            pendingActivationRecord.chunk.desiredDetailLevel =
              requestedDetailLevel;
          }
          reprioritize = true;
        } else if (pendingEntry.waitingForCapacity) {
          queueWaitingPreloadEntry(pendingEntry);
          tryActivateWaitingEntry(pendingEntry);
        }
      }

      if (reprioritize) {
        const index = pendingActivations.indexOf(pendingActivationRecord);
        if (index > 0) {
          pendingActivations.splice(index, 1);
          pendingActivations.unshift(pendingActivationRecord);
        } else if (index === -1) {
          pendingActivations.unshift(pendingActivationRecord);
        }
      }

      if (!pendingActivationRecord.__warnedRequeueWhileDeferred) {
        console.warn(
          '[chunk-manager] Ignoring preload request for deferred chunk',
          key,
        );
        pendingActivationRecord.__warnedRequeueWhileDeferred = true;
      }

      return pendingEntry;
    }

    if (existing) {
      let changed = false;
      if (existing.priority !== priority) {
        existing.priority = priority;
        changed = true;
      }
      const nextUrgent = Boolean(urgent);
      if (existing.urgent !== nextUrgent) {
        existing.urgent = nextUrgent;
        changed = true;
      }
      if (
        detailLevelRank(requestedDetailLevel) >
        detailLevelRank(existing.desiredDetailLevel)
      ) {
        existing.desiredDetailLevel = requestedDetailLevel;
        changed = true;
        if (existing.waitingForCapacity) {
          queueWaitingPreloadEntry(existing);
        } else {
          preloadQueue.update(existing);
        }
      } else if (existing.waitingForCapacity) {
        queueWaitingPreloadEntry(existing);
      }
      if (!existing.waitingForCapacity && changed) {
        queueDirty = true;
      }
      if (existing.waitingForCapacity) {
        tryActivateWaitingEntry(existing);
      }
      return existing;
    }

    if (payloadCacheCapacity > 0) {
      const cachedEntry = takeCachedPayload(key);
      if (cachedEntry?.payload) {
        const cachedDetail = normalizeDetailLevel(cachedEntry.detailLevel);
        const desiredDetail =
          detailLevelRank(cachedDetail) >= detailLevelRank(requestedDetailLevel)
            ? cachedDetail
            : requestedDetailLevel;
        const entry = {
          key,
          chunkX,
          chunkZ,
          priority,
          urgent: Boolean(urgent),
          task: null,
          pendingBudget: 0,
          promise: null,
          resolve: null,
          reject: null,
          active: false,
          unlimited: false,
          finalized: true,
          cancelled: false,
          stepHint: defaultPreloadBurst,
          detailLevel: cachedDetail,
          desiredDetailLevel: desiredDetail,
          metadata: { mode: 'cache', inflight: false, payload: cachedEntry.payload },
          workerPayload: { payload: cachedEntry.payload },
          pendingChunk: null,
          persistenceState: 'ready',
          persistencePromise: null,
          persistenceResult: cachedEntry.payload ?? null,
          persistenceError: null,
          waitingForCapacity: false,
        };
        ensurePendingEntryPromise(entry);
        const chunk = finalizeWorkerChunk(entry, entry.workerPayload);
        if (chunk) {
          chunk.detailLevel = entry.detailLevel;
          chunk.desiredDetailLevel = entry.desiredDetailLevel;
          chunk.__cachePayload = cachedEntry.payload;
          if (chunk.__cachePayload) {
            chunk.__cachePayload.detailLevel = entry.detailLevel;
          }
          const pendingRecord = {
            key: entry.key,
            chunk,
            entry,
          };
          entry.pendingChunk = pendingRecord;
          enqueuePendingActivation(pendingRecord);
        }
        return entry;
      }
    }

    const entry = {
      key,
      chunkX,
      chunkZ,
      priority,
      urgent: Boolean(urgent),
      task: null,
      pendingBudget: 0,
      promise: null,
      resolve: null,
      reject: null,
      active: false,
      unlimited: false,
      finalized: false,
      cancelled: false,
      stepHint: defaultPreloadBurst,
      detailLevel: requestedDetailLevel,
      desiredDetailLevel: requestedDetailLevel,
      metadata: null,
      workerPayload: null,
      pendingChunk: null,
      persistenceState: chunkPersistenceQueue ? 'idle' : 'ready',
      persistencePromise: null,
      persistenceResult: null,
      persistenceError: null,
      waitingForCapacity: false,
    };
    entry.metadata = createChunkJobMetadata(entry);
    updateEntryPersistenceMetadata(entry);
    entry.task = createChunkBuildTask({
      chunkX,
      chunkZ,
      blockMaterials,
      requireWorkerPayload: entry.metadata?.mode === 'worker',
      detailLevel: entry.detailLevel,
      scoutPreviewBuilder: createScoutChunkPreview,
    });
    if (isPendingBuildCapReached()) {
      markEntryWaitingForCapacity(entry);
      return entry;
    }
    pendingPreloadEntries.set(key, entry);
    preloadQueue.push(entry);
    queueDirty = true;
    return entry;
  }

  function prunePreloadQueue(
    centerChunkX,
    centerChunkZ,
    maxDistance,
    directionalContext = null,
  ) {
    if (preloadQueue.isEmpty()) {
      return;
    }
    let removedAny = false;
    for (let i = preloadQueue.length - 1; i >= 0; i -= 1) {
      const entry = preloadQueue.get(i);
      if (!entry) {
        continue;
      }
      const offsetX = entry.chunkX - centerChunkX;
      const offsetZ = entry.chunkZ - centerChunkZ;
      const dx = Math.abs(offsetX);
      const dz = Math.abs(offsetZ);
      let allowedDistance = maxDistance;
      if (
        Number.isFinite(allowedDistance) &&
        directionalContext?.rearHysteresis > 0
      ) {
        const offsetLength = Math.hypot(offsetX, offsetZ);
        if (Number.isFinite(offsetLength) && offsetLength > 0) {
          const dot =
            directionalContext.heading.x * (offsetX / offsetLength) +
            directionalContext.heading.z * (offsetZ / offsetLength);
          if (dot <= -directionalContext.coneCos) {
            allowedDistance += directionalContext.rearHysteresis;
          }
        }
      }
      if (
        Number.isFinite(allowedDistance) &&
        (dx > allowedDistance || dz > allowedDistance)
      ) {
        cancelPendingEntry(entry);
        removedAny = true;
        continue;
      }
      let priority = offsetX * offsetX + offsetZ * offsetZ;
      if (directionalContext?.priorityBiasFactor > 0) {
        const offsetLength = Math.hypot(offsetX, offsetZ);
        if (Number.isFinite(offsetLength) && offsetLength > 0) {
          const dot =
            directionalContext.heading.x * (offsetX / offsetLength) +
            directionalContext.heading.z * (offsetZ / offsetLength);
          priority -= dot * directionalContext.priorityBiasFactor;
        } else {
          priority -= directionalContext.priorityBiasFactor;
        }
      }
      if (priority !== entry.priority) {
        entry.priority = priority;
        removedAny = true;
      }
    }
    if (removedAny) {
      queueDirty = true;
    }
  }

  function recordEntityPlacement({ id, typeId, transform, meta }) {
    if (!entityStore) {
      return false;
    }
    const normalizedId = String(id ?? '');
    const normalizedTypeId = String(typeId ?? '');
    if (!normalizedId || !normalizedTypeId) {
      return false;
    }
    const normalizedTransform = normalizeEntityTransform(transform);
    const translationX = Number.isFinite(normalizedTransform[12])
      ? normalizedTransform[12]
      : 0;
    const translationZ = Number.isFinite(normalizedTransform[14])
      ? normalizedTransform[14]
      : 0;
    const { x: chunkX, z: chunkZ } = chunkIndexFromWorld(
      translationX,
      translationZ,
    );
    const key = chunkKey(chunkX, chunkZ);
    const previousKey = entityIdIndex.get(normalizedId);
    if (previousKey && previousKey !== key) {
      const previousState = chunkEntityState.get(previousKey);
      if (previousState) {
        previousState.records.delete(normalizedId);
        ensureEntityDeltaQueue(previousKey).push({ kind: 'remove', id: normalizedId });
        markEntityChunkDirty(previousKey);
        updateChunkPersistentEntities(previousKey);
      }
    }
    let state = chunkEntityState.get(key);
    if (!state) {
      state = ensureChunkEntityState(key, chunkX, chunkZ) ?? {
        records: new Map(),
        stats: { entries: 0, bytes: 0 },
        needsCompaction: false,
      };
      if (!chunkEntityState.has(key)) {
        chunkEntityState.set(key, state);
      }
    }
    const record = {
      id: normalizedId,
      typeId: normalizedTypeId,
      transform: normalizedTransform,
      meta: cloneEntityMeta(meta),
    };
    state.records.set(normalizedId, record);
    entityIdIndex.set(normalizedId, key);
    const queue = ensureEntityDeltaQueue(key);
    const queuedRecord = clonePersistedEntityRecord(record);
    if (queuedRecord) {
      queue.push({ kind: 'place', record: queuedRecord });
    }
    markEntityChunkDirty(key);
    updateChunkPersistentEntities(key);
    return true;
  }

  function recordEntityRemoval({ id }) {
    if (!entityStore) {
      return false;
    }
    const normalizedId = String(id ?? '');
    if (!normalizedId) {
      return false;
    }
    let key = entityIdIndex.get(normalizedId) ?? null;
    if (!key) {
      for (const [candidateKey, state] of chunkEntityState.entries()) {
        if (state?.records?.has(normalizedId)) {
          key = candidateKey;
          break;
        }
      }
    }
    if (!key) {
      return false;
    }
    const state = chunkEntityState.get(key);
    if (!state) {
      return false;
    }
    state.records.delete(normalizedId);
    entityIdIndex.delete(normalizedId);
    ensureEntityDeltaQueue(key).push({ kind: 'remove', id: normalizedId });
    markEntityChunkDirty(key);
    updateChunkPersistentEntities(key);
    return true;
  }

  function processPreloadQueue(limit) {
    if (preloadQueue.isEmpty()) {
      if (workerEnabled) {
        if (workerInflightCount > 0) {
          workerUtilizationSamples.busy += 1;
        } else {
          workerUtilizationSamples.idle += 1;
        }
      }
      preloadDebugState.queueSizes[DETAIL_LEVEL_SCOUT] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_SCOUT);
      preloadDebugState.queueSizes[DETAIL_LEVEL_RETENTION] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_RETENTION);
      preloadDebugState.queueSizes[DETAIL_LEVEL_CORE] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_CORE);
      preloadDebugState.lastBaseBudget = 0;
      preloadDebugState.lastBaseBudgetSpent = 0;
      preloadDebugState.lastScoutTopUp = 0;
      preloadDebugState.lastScoutTopUpSpent = 0;
      preloadDebugState.lastScoutTopUpRemaining = 0;
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_SCOUT] = 0;
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_RETENTION] = 0;
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_CORE] = 0;
      preloadDebugState.workerInflight = workerInflightCount;
      preloadDebugState.workerIdleSamples = workerUtilizationSamples.idle;
      preloadDebugState.workerBusySamples = workerUtilizationSamples.busy;
      return 0;
    }

    const unlimited = limit === Number.POSITIVE_INFINITY;
    let remainingBudget = unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(Number(limit) || 0));

    if (unlimited) {
      urgentPreloadBoost = 0;
    } else if (urgentPreloadBoost > 0) {
      remainingBudget += urgentPreloadBoost;
      urgentPreloadBoost = 0;
    }

    if (queueDirty) {
      preloadQueue.sort((a, b) => {
        if (a.urgent !== b.urgent) {
          return a.urgent ? -1 : 1;
        }
        return a.priority - b.priority;
      });
      queueDirty = false;
    }

    if (workerEnabled) {
      if (workerInflightCount > 0) {
        workerUtilizationSamples.busy += 1;
      } else {
        workerUtilizationSamples.idle += 1;
      }
    }

    const unlimitedPromises = [];
    let globalIndex = 0;
    let baseBudgetSpent = 0;
    let scoutBudgetSpent = 0;
    const processedCounts = {
      [DETAIL_LEVEL_SCOUT]: 0,
      [DETAIL_LEVEL_RETENTION]: 0,
      [DETAIL_LEVEL_CORE]: 0,
    };

    const normalizedTopUp = Number(maxPreloadPerUpdate);
    let scoutReserve = 0;
    if (workerEnabled && workerInflightCount === 0) {
      if (normalizedTopUp === Number.POSITIVE_INFINITY) {
        scoutReserve = Math.max(defaultPreloadBurst, 0);
      } else if (Number.isFinite(normalizedTopUp)) {
        scoutReserve = Math.max(0, Math.floor(normalizedTopUp));
      }
    }

    const baseBudgetInitial = unlimited
      ? Number.POSITIVE_INFINITY
      : remainingBudget;
    const scoutReserveInitial = scoutReserve;

    const allocateBudget = (requested, isScout) => {
      const desired = Math.max(0, Math.floor(Number(requested) || 0));
      if (desired <= 0) {
        return {
          granted: 0,
          commit() {
            return { used: 0, base: 0, reserve: 0 };
          },
        };
      }

      const reserveGrant = isScout && scoutReserve > 0
        ? Math.min(desired, scoutReserve)
        : 0;
      const remainingRequest = desired - reserveGrant;
      const baseGrant = remainingRequest > 0
        ? Math.min(remainingRequest, remainingBudget)
        : 0;
      const granted = reserveGrant + baseGrant;

      return {
        granted,
        commit(used = granted) {
          if (granted <= 0) {
            return { used: 0, base: 0, reserve: 0 };
          }
          const normalizedUsed = Math.max(
            0,
            Math.min(granted, Math.floor(Number(used) || 0)),
          );
          if (normalizedUsed <= 0) {
            return { used: 0, base: 0, reserve: 0 };
          }

          const reserveUsed = Math.min(reserveGrant, normalizedUsed);
          const baseUsed = Math.min(
            baseGrant,
            normalizedUsed - reserveUsed,
          );

          if (reserveUsed > 0) {
            scoutReserve -= reserveUsed;
            scoutBudgetSpent += reserveUsed;
          }

          if (baseUsed > 0) {
            remainingBudget -= baseUsed;
            baseBudgetSpent += baseUsed;
          }

          return {
            used: reserveUsed + baseUsed,
            base: baseUsed,
            reserve: reserveUsed,
          };
        },
      };
    };

    const finalizeAndReturn = () => {
      preloadDebugState.queueSizes[DETAIL_LEVEL_SCOUT] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_SCOUT);
      preloadDebugState.queueSizes[DETAIL_LEVEL_RETENTION] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_RETENTION);
      preloadDebugState.queueSizes[DETAIL_LEVEL_CORE] =
        preloadQueue.getBucketSize(DETAIL_LEVEL_CORE);
      preloadDebugState.lastBaseBudget = baseBudgetInitial;
      preloadDebugState.lastBaseBudgetSpent = baseBudgetSpent;
      preloadDebugState.lastScoutTopUp = scoutReserveInitial;
      preloadDebugState.lastScoutTopUpSpent = scoutBudgetSpent;
      preloadDebugState.lastScoutTopUpRemaining = scoutReserve;
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_SCOUT] =
        processedCounts[DETAIL_LEVEL_SCOUT];
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_RETENTION] =
        processedCounts[DETAIL_LEVEL_RETENTION];
      preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_CORE] =
        processedCounts[DETAIL_LEVEL_CORE];
      preloadDebugState.workerInflight = workerInflightCount;
      preloadDebugState.workerIdleSamples = workerUtilizationSamples.idle;
      preloadDebugState.workerBusySamples = workerUtilizationSamples.busy;
      if (unlimitedPromises.length > 0) {
        return Promise.all(unlimitedPromises);
      }
      return 0;
    };

    const detailOrder = [
      DETAIL_LEVEL_CORE,
      DETAIL_LEVEL_RETENTION,
      DETAIL_LEVEL_SCOUT,
    ];

    const activeDetails = detailOrder.filter((detail) => {
      const bucketSize = preloadQueue.getBucketSize(detail);
      return Number.isFinite(bucketSize) && bucketSize > 0;
    });

    const detailBudgetCaps = new Map();
    const detailBudgetSpent = new Map();
    if (unlimited || activeDetails.length === 0) {
      activeDetails.forEach((detail) => {
        detailBudgetCaps.set(detail, Number.POSITIVE_INFINITY);
        detailBudgetSpent.set(detail, 0);
      });
    } else {
      let remainingShare = baseBudgetInitial;
      activeDetails.forEach((detail, index) => {
        const remainingBuckets = activeDetails.length - index;
        if (remainingBuckets <= 0) {
          detailBudgetCaps.set(detail, 0);
          detailBudgetSpent.set(detail, 0);
          return;
        }
        let share = Math.floor(remainingShare / remainingBuckets);
        const remainder = remainingShare % remainingBuckets;
        if (remainder > 0) {
          share += 1;
        }
        share = Math.max(0, Math.min(share, remainingShare));
        detailBudgetCaps.set(detail, share);
        detailBudgetSpent.set(detail, 0);
        remainingShare -= share;
      });
      if (remainingShare > 0) {
        const lastDetail = activeDetails[activeDetails.length - 1];
        const current = detailBudgetCaps.get(lastDetail) ?? 0;
        detailBudgetCaps.set(lastDetail, current + remainingShare);
      }
    }

    const chunkColumnBudget = Number.isFinite(derivedChunkColumnsPerChunk)
      ? derivedChunkColumnsPerChunk
      : 0;

    for (const detail of detailOrder) {
      const bucket = preloadQueue.getBucketEntries(detail);
      if (!Array.isArray(bucket) || bucket.length === 0) {
        continue;
      }
      let i = 0;
      while (i < bucket.length) {
        const entry = bucket[i];
        if (!entry) {
          i += 1;
          globalIndex += 1;
          continue;
        }
        if (entry.finalized || entry.cancelled || loadedChunks.has(entry.key)) {
          cancelPendingEntry(entry);
          continue;
        }
        if (entry.unlimited) {
          i += 1;
          globalIndex += 1;
          continue;
        }

        const isScout = detail === DETAIL_LEVEL_SCOUT;

        if (unlimited) {
          const promise = startChunkJob(entry, { unlimited: true });
          if (promise) {
            unlimitedPromises.push(promise);
          }
          processedCounts[detail] += 1;
          i += 1;
          globalIndex += 1;
          continue;
        }

        const combinedBudget = remainingBudget + (isScout ? scoutReserve : 0);
        if (combinedBudget <= 0) {
          return finalizeAndReturn();
        }

        let stepBudget;
        if (entry.urgent) {
          const burst = Math.max(defaultPreloadBurst, combinedBudget);
          stepBudget = Math.max(1, burst);
        } else {
          const remainingEntries = Math.max(
            1,
            preloadQueue.length - globalIndex,
          );
          stepBudget = Math.max(
            1,
            Math.floor(combinedBudget / remainingEntries) || 1,
          );
          stepBudget = Math.min(stepBudget, combinedBudget);
        }

        if (isScout && scoutReserve > 0) {
          stepBudget = Math.min(stepBudget, scoutReserve);
        }

        const detailCap = detailBudgetCaps.get(detail);
        const detailSpent = detailBudgetSpent.get(detail) ?? 0;
        const remainingDetailCap = unlimited
          ? Number.POSITIVE_INFINITY
          : Math.max(0, (detailCap ?? 0) - detailSpent);

        if (!unlimited && remainingDetailCap <= 0 && (!isScout || scoutReserve <= 0)) {
          i += 1;
          globalIndex += 1;
          continue;
        }

        if (!unlimited) {
          const availableTotal = Math.max(
            0,
            Math.min(
              remainingDetailCap + (isScout ? scoutReserve : 0),
              combinedBudget,
            ),
          );
          if (availableTotal <= 0) {
            i += 1;
            globalIndex += 1;
            continue;
          }
          stepBudget = Math.min(stepBudget, availableTotal);
          if (!entry.urgent && chunkColumnBudget > 0) {
            const target = Math.min(availableTotal, chunkColumnBudget);
            if (target > stepBudget) {
              stepBudget = target;
            }
          }
        } else if (!entry.urgent && chunkColumnBudget > 0) {
          const target = Math.min(combinedBudget, chunkColumnBudget);
          if (target > stepBudget) {
            stepBudget = target;
          }
        }

        if (stepBudget <= 0) {
          i += 1;
          globalIndex += 1;
          continue;
        }

        if (entry.urgent && chunkColumnBudget > 0) {
          stepBudget = Math.min(stepBudget, chunkColumnBudget);
        }

        const allocation = allocateBudget(stepBudget, isScout);
        const grantedBudget = allocation.granted;
        if (grantedBudget <= 0) {
          return finalizeAndReturn();
        }

        const jobPromise = startChunkJob(entry, { budget: grantedBudget });
        const acceptedBudget = Math.max(
          0,
          Math.floor(Number(jobPromise?.acceptedBudget ?? 0) || 0),
        );
        const commitResult = allocation.commit(acceptedBudget);

        if (!unlimited) {
          const spentTotal = detailBudgetSpent.get(detail) ?? 0;
          detailBudgetSpent.set(detail, spentTotal + Math.max(0, commitResult.base));
        }

        processedCounts[detail] += 1;

        i += 1;
        globalIndex += 1;

        if (remainingBudget <= 0 && (!isScout || scoutReserve <= 0)) {
          return finalizeAndReturn();
        }
      }
    }

    return finalizeAndReturn();
  }

  function update(position, options = {}) {
    if (!position) {
      return;
    }

    refreshCacheForWorldChange();
    activeDirectionalContext = null;

    const centerChunkX = worldToChunk(position.x);
    const centerChunkZ = worldToChunk(position.z);
    const centerKey = chunkKey(centerChunkX, centerChunkZ);

    const upgradeHysteresis = resolveUpgradeHysteresisConfig(
      options.upgradeHysteresis,
    );


    if (options.camera) {
      lastCamera = options.camera;
    }
    const camera = options.camera ?? lastCamera;
    const shouldUpdateVisibility = Boolean(camera);
    const skipLowPriorityPreload =
      typeof options.shouldSkipLowPriorityPreload === 'function'
        ? options.shouldSkipLowPriorityPreload
        : () => false;

    const previousRetentionDistance = retentionDistance;

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
    const disposalBudget = resolveBudget(
      options.maxDisposals,
      defaultDisposalBudget,
    );
    const activationBudget = resolveBudget(
      options.maxActivations,
      defaultActivationBudget,
    );
    const force = Boolean(options.force);
    let directionalHint = normalizeDirectionalHintInput(
      options.directionalHint ?? null,
    );
    if (
      directionalHint &&
      directionalHint.forwardBoost <= 0 &&
      directionalHint.rearHysteresis <= 0
    ) {
      directionalHint = null;
    }

    const centerChanged = centerKey !== lastCenterKey;
    const viewChanged = desiredViewDistance !== currentViewDistance;
    const retentionChanged = desiredRetention !== retentionDistance;
    const queueHasWork = !preloadQueue.isEmpty();
    const disposalQueueHasWork = chunkDisposalQueue.length > 0;
    const activationQueueHasWork =
      pendingActivations.length > 0 || deferredActivations.length > 0;

    const flushChunkDisposals = (overrideBudget = disposalBudget) => {
      if (force && overrideBudget === 0) {
        processChunkDisposalQueue(Number.POSITIVE_INFINITY);
        return;
      }
      if (overrideBudget > 0) {
        processChunkDisposalQueue(overrideBudget);
      }
    };

    if (
      !force &&
      !centerChanged &&
      !viewChanged &&
      !retentionChanged &&
      !queueHasWork &&
      !disposalQueueHasWork &&
      !activationQueueHasWork
    ) {
      checkBudgetCongestion({
        activationBudget,
        activationProcessed: 0,
      });

      if (shouldUpdateVisibility) {
        updateChunkVisibility(camera);
      }

      return;
    }

    currentViewDistance = desiredViewDistance;
    retentionDistance = desiredRetention;
    activeDirectionalContext = directionalHint;

    if (Number.isFinite(currentViewDistance)) {
      lastFiniteViewDistance = Math.max(
        0,
        Math.floor(currentViewDistance),
      );
    }

    if (Number.isFinite(retentionDistance)) {
      lastFiniteRetentionDistance = Math.max(
        lastFiniteViewDistance,
        Math.floor(retentionDistance),
      );
    }

    const fallbackViewDistance = Number.isFinite(currentViewDistance)
      ? Math.max(0, Math.floor(currentViewDistance))
      : lastFiniteViewDistance;
    const finiteView = Math.max(0, fallbackViewDistance);

    const fallbackRetentionDistance = Number.isFinite(retentionDistance)
      ? Math.max(finiteView, Math.floor(retentionDistance))
      : Math.max(finiteView, lastFiniteRetentionDistance);
    const finiteRetention = Math.max(finiteView, fallbackRetentionDistance);

    const upgradeRadiusThreshold = Number.isFinite(finiteView)
      ? Math.max(0, finiteView - upgradeHysteresis.radius)
      : Number.POSITIVE_INFINITY;
    const forwardExtension = Math.max(0, directionalHint?.forwardExtension ?? 0);

    lastCenterChunkX = centerChunkX;
    lastCenterChunkZ = centerChunkZ;
    hasLastCenter = true;
    const columnFromPosition = normalizeColumnCoordinates(position);
    const newColumnKey = toColumnKey(columnFromPosition);
    if (newColumnKey) {
      lastKnownPlayerColumnKey = newColumnKey;
    }
    lastFiniteViewRadius = finiteView;
    lastFiniteRetentionRadius = finiteRetention;

    if (
      retentionChanged &&
      Number.isFinite(previousRetentionDistance) &&
      Number.isFinite(finiteRetention) &&
      finiteRetention < previousRetentionDistance
    ) {
      pruneTerrainSampleCacheOutsideRadius({
        centerChunkX,
        centerChunkZ,
        chunkRadius: finiteRetention,
        chunkSize: worldConfig.chunkSize,
      });
    }

    const disposalMarginValue = Number.isFinite(retentionDisposalMargin)
      ? retentionDisposalMargin
      : Number.POSITIVE_INFINITY;
    const retentionRadiusWithMargin =
      disposalMarginValue === Number.POSITIVE_INFINITY ||
      !Number.isFinite(finiteRetention)
        ? Number.POSITIVE_INFINITY
        : finiteRetention + disposalMarginValue;

    const retentionRadiusForPrune = Number.isFinite(retentionRadiusWithMargin)
      ? retentionRadiusWithMargin + forwardExtension
      : retentionRadiusWithMargin;
    prunePreloadQueue(
      centerChunkX,
      centerChunkZ,
      retentionRadiusForPrune,
      directionalHint,
    );

    const guaranteeRadius = Math.min(finiteView, 1);
    const retentionSchedulingRadius = Number.isFinite(finiteRetention)
      ? Math.max(
          Math.floor(finiteRetention),
          Math.floor(finiteRetention + forwardExtension),
        )
      : Number.POSITIVE_INFINITY;

    const viewLoopRadiusCandidate = finiteView + forwardExtension;
    const viewLoopRadius = Number.isFinite(retentionSchedulingRadius)
      ? Math.min(viewLoopRadiusCandidate, retentionSchedulingRadius)
      : viewLoopRadiusCandidate;

    for (let dx = -guaranteeRadius; dx <= guaranteeRadius; dx += 1) {
      for (let dz = -guaranteeRadius; dz <= guaranteeRadius; dz += 1) {
        ensureChunk(centerChunkX + dx, centerChunkZ + dz, {
          blocking: force,
          centerChunkX,
          centerChunkZ,
        });
      }
    }

    if (viewLoopRadius > guaranteeRadius) {
      for (let dx = -viewLoopRadius; dx <= viewLoopRadius; dx += 1) {
        for (let dz = -viewLoopRadius; dz <= viewLoopRadius; dz += 1) {
          const maxDistance = Math.max(Math.abs(dx), Math.abs(dz));
          if (maxDistance <= guaranteeRadius) {
            continue;
          }
          const biasedDistance = directionalHint
            ? applyDirectionalDistanceBias(maxDistance, dx, dz, directionalHint)
            : maxDistance;
          const detailLevel = resolveDetailLevelForDistance(
            biasedDistance,
            finiteView,
            finiteRetention,
          );
          if (skipLowPriorityPreload(detailLevel)) {
            continue;
          }
          schedulePreload(
            centerChunkX + dx,
            centerChunkZ + dz,
            centerChunkX,
            centerChunkZ,
            {
              urgent: detailLevel === DETAIL_LEVEL_CORE,
              detailLevel,
              maxDistance: retentionSchedulingRadius,
            },
          );
        }
      }
    }

    const retentionLoopRadius = retentionSchedulingRadius;

    if (
      Number.isFinite(retentionLoopRadius) &&
      retentionLoopRadius > viewLoopRadius
    ) {
      for (let dx = -retentionLoopRadius; dx <= retentionLoopRadius; dx += 1) {
        for (let dz = -retentionLoopRadius; dz <= retentionLoopRadius; dz += 1) {
          const maxDistance = Math.max(Math.abs(dx), Math.abs(dz));
          if (maxDistance <= viewLoopRadius) {
            continue;
          }
          const detailLevel = resolveDetailLevelForDistance(
            directionalHint
              ? applyDirectionalDistanceBias(maxDistance, dx, dz, directionalHint)
              : maxDistance,
            finiteView,
            finiteRetention,
          );
          if (skipLowPriorityPreload(detailLevel)) {
            continue;
          }
          schedulePreload(
            centerChunkX + dx,
            centerChunkZ + dz,
            centerChunkX,
            centerChunkZ,
            { detailLevel, maxDistance: retentionSchedulingRadius },
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
      const offsetX = chunkX - centerChunkX;
      const offsetZ = chunkZ - centerChunkZ;
      const distanceX = Math.abs(offsetX);
      const distanceZ = Math.abs(offsetZ);
      let allowedDistance = retentionRadiusWithMargin;
      if (Number.isFinite(allowedDistance) && directionalHint) {
        const offsetLength = Math.hypot(offsetX, offsetZ);
        if (Number.isFinite(offsetLength) && offsetLength > 0) {
          const dot =
            directionalHint.heading.x * (offsetX / offsetLength) +
            directionalHint.heading.z * (offsetZ / offsetLength);
          if (dot >= directionalHint.coneCos) {
            allowedDistance += forwardExtension;
          } else if (dot <= -directionalHint.coneCos) {
            allowedDistance += directionalHint.rearHysteresis;
          }
        } else {
          allowedDistance += forwardExtension;
        }
      } else if (Number.isFinite(allowedDistance) && forwardExtension > 0) {
        allowedDistance += forwardExtension;
      }
      if (
        Number.isFinite(allowedDistance) &&
        (distanceX > allowedDistance || distanceZ > allowedDistance)
      ) {
        cancelActiveChunkUpgrade(key, { disposeTask: true });
        chunkUpgradeStateByKey.delete(key);
        queueChunkForDisposal(key);
        return;
      }

      cancelChunkDisposal(key);

      const requiredDetail = computeRequiredDetailForChunk(chunkX, chunkZ);
      const normalizedRequired = normalizeDetailLevel(requiredDetail);
      const currentDetail = normalizeDetailLevel(chunk.detailLevel);
      const currentDesired = normalizeDetailLevel(chunk.desiredDetailLevel);
      const requiredRank = detailLevelRank(normalizedRequired);
      const currentRank = detailLevelRank(currentDetail);
      if (detailLevelRank(currentDesired) !== requiredRank) {
        chunk.desiredDetailLevel = normalizedRequired;
      }

      if (requiredRank > currentRank) {
        const state = ensureChunkUpgradeState(key);
        if (state) {
          state.targetDetail = normalizedRequired;
          const maxDistance = Math.max(distanceX, distanceZ);
          const withinRadius = maxDistance <= upgradeRadiusThreshold;
          if (withinRadius) {
            state.framesInRange += 1;
          } else {
            state.framesInRange = 0;
          }
          if (!state.inProgress && state.framesInRange >= upgradeHysteresis.frames) {
            scheduleActiveChunkUpgrade({
              key,
              chunk,
              targetDetailLevel: normalizedRequired,
            });
          }
        }
        return;
      }

      const state = chunkUpgradeStateByKey.get(key);
      if (state) {
        if (state.inProgress) {
          const pendingRank = detailLevelRank(
            normalizeDetailLevel(
              state.entry?.targetDetailLevel ?? state.targetDetail ?? currentDetail,
            ),
          );
          if (pendingRank > requiredRank) {
            cancelActiveChunkUpgrade(key, { disposeTask: true });
          }
        }
        state.framesInRange = 0;
        state.targetDetail = null;
      }
    });

    flushChunkDisposals();

    activeDirectionalContext = null;

    lastCenterKey = centerKey;

    if (force) {
      checkBudgetCongestion({
        activationBudget,
        activationProcessed: 0,
      });
      const completion = (async () => {
        await flush({ includeDisposals: true });
        if (shouldUpdateVisibility) {
          updateChunkVisibility(camera);
        }
      })();
      return completion;
    }

    const hasUnlimitedPreload =
      preloadBudget === Number.POSITIVE_INFINITY;
    const normalizedPreloadBudget = hasUnlimitedPreload
      ? Number.POSITIVE_INFINITY
      : preloadBudget;

    const shouldProcessPreload = hasUnlimitedPreload
      ? queueHasWork
      : normalizedPreloadBudget > 0 || urgentPreloadBoost > 0;

    if (shouldProcessPreload) {
      const preloadResult = processPreloadQueue(
        hasUnlimitedPreload
          ? Number.POSITIVE_INFINITY
          : normalizedPreloadBudget,
      );
      if (preloadResult && typeof preloadResult.then === 'function') {
        preloadResult.catch((error) => {
          console.error('[chunk-manager] preload queue error', error);
        });
      }
    }

    const activationProcessed = processPendingActivations(activationBudget);

    processActiveChunkUpgrades();

    flushChunkDisposals();

    activeDirectionalContext = null;

    checkBudgetCongestion({
      activationBudget,
      activationProcessed,
    });


    if (shouldUpdateVisibility) {
      updateChunkVisibility(camera);
    }

  }

  async function flush({ includeDisposals = true } = {}) {
    promoteWaitingPreloadEntries({ force: true });
    const pendingEntries = Array.from(pendingPreloadEntries.values());
    if (pendingEntries.length > 0) {
      const promises = pendingEntries
        .map((entry) => startChunkJob(entry, { unlimited: true }))
        .filter(Boolean);
      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
    if (chunkJobPumpPromise) {
      try {
        await chunkJobPumpPromise;
      } catch (error) {
        console.error('[chunk-manager] chunk job pump failed during flush', error);
      }
    }
    if (activeChunkUpgradeQueue.length > 0) {
      processActiveChunkUpgrades(Number.POSITIVE_INFINITY);
    }
    processPendingActivations(Number.POSITIVE_INFINITY);
    if (includeDisposals) {
      processChunkDisposalQueue(Number.POSITIVE_INFINITY);
    }
    if (chunkPersistenceJobs.size > 0) {
      const pendingJobs = Array.from(chunkPersistenceJobs.values()).map((job) =>
        job.catch(() => {}),
      );
      if (pendingJobs.length > 0) {
        await Promise.all(pendingJobs);
      }
    }
    if (entityStore) {
      await runEntityAutosavePass();
      await runEntityCompactionPass();
    }
  }

  async function dispose() {
    await flush({ includeDisposals: true });
    Array.from(pendingActivationByKey.keys()).forEach((key) => {
      dropPendingActivation(key, { disposeChunk: true, settle: true });
    });
    pendingActivations.length = 0;
    pendingActivationByKey.clear();
    chunkDisposalQueue.length = 0;
    scheduledChunkDisposals.clear();
    Array.from(loadedChunks.keys()).forEach((key) => disposeChunk(key));
    preloadQueue.clear();
    pendingPreloadEntries.clear();
    waitingPreloadEntries.clear();
    waitingPreloadQueue.length = 0;
    setPendingBuildThrottleActive(false);
    queueDirty = false;
    lastCenterKey = null;
    hasLastCenter = false;
    clearTerrainSampleCache();
    raycastTargets.clear();
    clearPayloadCacheEntries();
    while (workerDisposables.length > 0) {
      const disposeListener = workerDisposables.pop();
      try {
        disposeListener?.();
      } catch (error) {
        console.warn('[chunk-manager] Failed to dispose worker listener', error);
      }
    }
    dirtyChunks.clear();
    chunkJournalQueues.clear();
    chunkPersistenceState.clear();
    chunksPendingCompaction.clear();
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (compactionTimer !== null) {
      clearTimeout(compactionTimer);
      compactionTimer = null;
    }
    chunkEntityState.clear();
    entityDeltaQueues.clear();
    dirtyEntityChunks.clear();
    entityCompactionQueue.clear();
    entityIdIndex.clear();
    if (entityAutosaveTimer !== null) {
      clearTimeout(entityAutosaveTimer);
      entityAutosaveTimer = null;
    }
    if (entityCompactionTimer !== null) {
      clearTimeout(entityCompactionTimer);
      entityCompactionTimer = null;
    }
    chunkPersistenceJobs.clear();
    chunkPersistenceQueue?.dispose?.();
    deferredActivations.length = 0;
  }

  function setViewDistance(distance) {
    currentViewDistance = normalizeDistance(distance, currentViewDistance);
    if (Number.isFinite(currentViewDistance)) {
      lastFiniteViewDistance = Math.max(0, Math.floor(currentViewDistance));
    }
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
    if (Number.isFinite(retentionDistance)) {
      lastFiniteRetentionDistance = Math.max(
        lastFiniteViewDistance,
        Math.floor(retentionDistance),
      );
    }
  }

  function getViewDistance() {
    return currentViewDistance;
  }

  function getRetentionDistance() {
    return retentionDistance;
  }

  function getRaycastTargets() {
    raycastTargets.forEach((mesh) => {
      const key = mesh?.userData?.chunkKey;
      if (typeof key === 'string' && key) {
        touchLoadedChunkRecord(key);
      }
    });
    return Array.from(raycastTargets);
  }

  function preloadAround(position, distance, options = {}) {
    if (!position) {
      return;
    }
    const {
      directionalHint: requestedDirectionalHint = null,
      maxPreload: requestedMaxPreload,
      viewDistance: requestedViewDistance,
      upgradeHysteresis,
      force: requestedForce,
    } = options;
    const force = requestedForce === true;
    const directionalHint = requestedDirectionalHint
      ? normalizeDirectionalHintInput(requestedDirectionalHint)
      : null;
    const targetRetention = Math.max(
      currentViewDistance,
      normalizeDistance(distance, retentionDistance),
    );
    setRetentionDistance(targetRetention);

    const warmView = Math.max(
      currentViewDistance,
      Math.min(
        targetRetention,
        normalizeDistance(requestedViewDistance, currentViewDistance),
      ),
    );

    const directionalBoostChunks =
      directionalHint?.forwardBoost > 0
        ? Math.min(
            PRELOAD_DIRECTIONAL_CHUNK_CAP,
            Math.max(0, Math.ceil(directionalHint.forwardBoost)),
          )
        : 0;

    const chunkMinimumBurst =
      derivedPreloadChunkBurst === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(1, derivedPreloadChunkBurst);
    const minimumBurstColumns =
      chunkMinimumBurst === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : chunkCountToColumnBudget(chunkMinimumBurst);

    const chunkWarmupWithBoost = (() => {
      if (derivedPreloadChunkWarmup === Number.POSITIVE_INFINITY) {
        return Number.POSITIVE_INFINITY;
      }
      const baseWarmup = Math.max(
        chunkMinimumBurst,
        derivedPreloadChunkWarmup,
      );
      return baseWarmup + directionalBoostChunks;
    })();

    const fallbackColumnBudget =
      chunkWarmupWithBoost === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : chunkCountToColumnBudget(chunkWarmupWithBoost);

    let requestedMaxPreloadColumns = requestedMaxPreload;
    if (requestedMaxPreloadColumns !== Number.POSITIVE_INFINITY) {
      const numericRequestedMaxPreload = Number(requestedMaxPreloadColumns);
      if (Number.isFinite(numericRequestedMaxPreload)) {
        requestedMaxPreloadColumns = chunkCountToColumnBudget(
          numericRequestedMaxPreload,
        );
      }
    }

    const desiredBudget = resolveBudget(
      requestedMaxPreloadColumns,
      fallbackColumnBudget,
    );
    const effectiveBudget =
      desiredBudget === 0 ? minimumBurstColumns : desiredBudget;
    let normalizedBudget = effectiveBudget;
    if (normalizedBudget === Number.POSITIVE_INFINITY) {
      normalizedBudget = Number.POSITIVE_INFINITY;
    } else if (!Number.isFinite(normalizedBudget) || normalizedBudget <= 0) {
      normalizedBudget = minimumBurstColumns;
    } else if (
      minimumBurstColumns > 0 &&
      Number.isFinite(minimumBurstColumns)
    ) {
      normalizedBudget = Math.max(normalizedBudget, minimumBurstColumns);
    }
    if (
      minimumBurstColumns === Number.POSITIVE_INFINITY &&
      normalizedBudget !== Number.POSITIVE_INFINITY
    ) {
      normalizedBudget = Number.POSITIVE_INFINITY;
    }

    const pendingBuildsThrottled = typeof preloadQueue.getStatus === 'function'
      ? preloadQueue.getStatus('pendingBuildsThrottled') === true
      : preloadQueue.status?.pendingBuildsThrottled === true;
    const shouldSkipLowPriorityPreload = (detailLevel) => {
      if (!pendingBuildsThrottled || force) {
        return false;
      }
      return (
        detailLevelRank(detailLevel) < detailLevelRank(DETAIL_LEVEL_CORE)
      );
    };
    const updateParams = {
      viewDistance: warmView,
      retainDistance: targetRetention,
      maxPreload:
        force || normalizedBudget === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : normalizedBudget,
      upgradeHysteresis,
      force,
      shouldSkipLowPriorityPreload,
    };
    if (directionalHint) {
      updateParams.directionalHint = directionalHint;
    }
    const updateResult = update(position, updateParams);
    if (updateResult && typeof updateResult.then === 'function') {
      updateResult.catch((error) => {
        console.error('[chunk-manager] preloadAround forced update failed', error);
      });
    }
  }

  function preloadDirectional(position, directionalHint, options = {}) {
    if (!position) {
      return;
    }
    if (!directionalHint || typeof directionalHint !== 'object') {
      preloadAround(position, options.distance, options);
      return;
    }
    const { distance, ...rest } = options;
    preloadAround(position, distance, { ...rest, directionalHint });
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

  function getStreamingStats() {
    const previewTotals = getScoutPreviewMemoryTotals();
    let scoutChunkCount = 0;
    loadedChunks.forEach((chunk) => {
      if (chunk?.detailLevel === DETAIL_LEVEL_SCOUT) {
        scoutChunkCount += 1;
      }
    });
    return {
      generatedAt: Date.now(),
      loadedChunkCount: loadedChunks.size,
      scoutChunkCount,
      previewMemory: previewTotals,
    };
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

        const congestionSnapshot = Object.fromEntries(
          Object.entries(budgetCongestionState).map(([key, value]) => {
            const details =
              value.details && typeof value.details === 'object'
                ? { ...value.details }
                : {};
            return [
              key,
              {
                frames: value.frames,
                cap: value.cap,
                count: value.count,
                details,
              },
            ];
          }),
        );

        return {
          generatedAt: Date.now(),
          chunkCount: chunks.length,
          totalBlocks,
          streamingBudgets: {
            configured: {
              preload: maxPreloadPerUpdate,
              activation: maxActivationsPerUpdate,
              disposal: maxDisposalsPerUpdate,
            },
            defaults: {
              preloadBurst: defaultPreloadBurst,
              activation: defaultActivationBudget,
              disposal: defaultDisposalBudget,
            },
            derived: {
              chunkColumnsPerChunk: derivedChunkColumnsPerChunk,
              chunkThroughputPerFrame: derivedChunkThroughput,
              activationFloor: derivedActivationFloor,
              disposalFloor: derivedDisposalFloor,
              preloadChunkBurst: derivedPreloadChunkBurst,
              preloadChunkWarmup: derivedPreloadChunkWarmup,
              directionalChunkBoostCap: PRELOAD_DIRECTIONAL_CHUNK_CAP,
            },
          },
          streamingStats: getStreamingStats(),
          budgetCongestion: congestionSnapshot,
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
    if (typeData) {
      const entry = typeData.entries[intersection.instanceId];
      if (!entry) {
        return null;
      }
      return {
        chunk,
        type,
        instanceId: intersection.instanceId,
        entry,
        isDecoration: false,
      };
    }
    const decorationRecord = chunk.decorationData?.get(type);
    if (!decorationRecord || !Array.isArray(decorationRecord.entries)) {
      return null;
    }
    const decorationEntry = decorationRecord.entries[intersection.instanceId];
    if (!decorationEntry) {
      return null;
    }
    return {
      chunk,
      type,
      instanceId: intersection.instanceId,
      entry: decorationEntry,
      isDecoration: true,
    };
  }

  function removeBlockInstancesBulk({ chunk, type, entries: removalEntries }) {
    if (!chunk) {
      return [];
    }
    const candidates = Array.isArray(removalEntries) ? removalEntries : [];
    if (candidates.length === 0) {
      return [];
    }

    const uniqueEntries = [];
    const seenKeys = new Set();

    candidates.forEach((candidate) => {
      const rawEntry = candidate?.entry ?? candidate;
      if (!rawEntry) {
        return;
      }
      const key = rawEntry.coordinateKey ?? rawEntry.key;
      if (!key || seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      let entry = rawEntry;
      if (chunk.blockLookup?.has(key)) {
        const lookup = chunk.blockLookup.get(key);
        if (lookup) {
          entry = lookup;
        }
      }
      if (!entry) {
        return;
      }
      uniqueEntries.push(entry);
    });

    if (uniqueEntries.length === 0) {
      return [];
    }

    const removedEntries = [];
    const prototypeRefs = [];
    const settleColumnKeys = new Set();
    const visibilityPositions = [];
    const chunkOverrides =
      Number.isFinite(chunk?.chunkX) && Number.isFinite(chunk?.chunkZ)
        ? { chunkX: chunk.chunkX, chunkZ: chunk.chunkZ }
        : {};

    uniqueEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      removedEntries.push(entry);
      if (entry.prototypeKey) {
        prototypeRefs.push({ prototypeKey: entry.prototypeKey, entryKey: entry.key });
      }
      if (Number.isInteger(entry.index) && entry.index >= 0) {
        removeEntryFromChunkMesh(chunk, entry);
      }
      if (chunk.blockLookup) {
        if (entry.key) {
          chunk.blockLookup.delete(entry.key);
        }
        if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
          chunk.blockLookup.delete(entry.coordinateKey);
        }
      }
      const coordinateKey = entry.coordinateKey ?? entry.key;
      if (coordinateKey) {
        const coords = parseBlockCoordinateKey(coordinateKey);
        if (entry.isSolid && coords) {
          resolveChunkBlockIndex(chunk, 'solidBlockKeys')?.delete(
            coords,
            chunkOverrides,
          );
          solidBlocks.delete(coords, chunkOverrides);
        }
        if (entry.collisionMode === 'soft' && coords) {
          resolveChunkBlockIndex(chunk, 'softBlockKeys')?.delete(
            coords,
            chunkOverrides,
          );
          softBlocks.delete(coords, chunkOverrides);
        }
        if (entry.isSolid && coords && entry.position) {
          const settleKey = `${Math.round(entry.position.x)}|${Math.round(entry.position.z)}`;
          settleColumnKeys.add(settleKey);
        }
      }
      if (entry.isWater && entry.position) {
        const columnKey = `${entry.position.x}|${entry.position.z}`;
        chunk.waterColumns?.delete?.(columnKey);
        if (chunk.waterColumnKeys instanceof Set) {
          chunk.waterColumnKeys.delete(columnKey);
        }
        waterColumns.delete(columnKey);
      }
      if (coordinateKey && chunk.fluidBlockKeys instanceof Set) {
        chunk.fluidBlockKeys.delete(coordinateKey);
      }
      if (chunk.typeCapacities instanceof Map && entry.type) {
        const previous = chunk.typeCapacities.get(entry.type) ?? 0;
        chunk.typeCapacities.set(entry.type, Math.max(0, previous - 1));
      }
      if (entry.position) {
        visibilityPositions.push({
          x: Math.round(entry.position.x),
          y: Math.round(entry.position.y),
          z: Math.round(entry.position.z),
        });
      } else if (coordinateKey) {
        const coords = parseBlockCoordinateKey(coordinateKey);
        if (coords) {
          visibilityPositions.push(coords);
        }
      }
      entry.index = -1;
      entry.mesh = null;
      entry.tintAttribute = null;
    });

    prototypeRefs.forEach(({ prototypeKey, entryKey }) => {
      removePrototypePlacement(chunk, prototypeKey, entryKey);
    });

    settleColumnKeys.forEach((columnKey) => {
      if (columnKey) {
        settleFluidColumn(chunk, columnKey);
      }
    });

    const chunkVisibilityBuckets = new Map();
    visibilityPositions.forEach((pos) => {
      if (!pos) {
        return;
      }
      const chunkX = worldToChunk(pos.x);
      const chunkZ = worldToChunk(pos.z);
      if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
        return;
      }
      const key = chunkKey(chunkX, chunkZ);
      let bucket = chunkVisibilityBuckets.get(key);
      if (!bucket) {
        const targetChunk =
          chunk && chunk.chunkX === chunkX && chunk.chunkZ === chunkZ
            ? chunk
            : loadedChunks.get(key);
        if (!targetChunk) {
          return;
        }
        bucket = { chunk: targetChunk, positions: [] };
        chunkVisibilityBuckets.set(key, bucket);
      }
      bucket.positions.push(pos);
    });

    chunkVisibilityBuckets.forEach(({ chunk: targetChunk, positions }) => {
      refreshBlockVisibility(targetChunk, positions);
    });

    if (removedEntries.length > 0) {
      const key = chunkKey(chunk.chunkX ?? 0, chunk.chunkZ ?? 0);
      const journalOps = removedEntries
        .map((entry) => createBlockRemovalJournalOp(chunk, entry))
        .filter(Boolean);
      if (journalOps.length > 0) {
        enqueueJournalOpsForChunk(key, journalOps);
      }
    }

    return removedEntries;
  }

  function removeDecorationInstance({ chunk, type, instanceId, entry: providedEntry = null }) {
    if (!chunk) {
      return [];
    }
    const record = chunk.decorationData?.get(type);
    if (!record || !Array.isArray(record.entries) || record.entries.length === 0) {
      return [];
    }
    const entries = record.entries;
    let targetEntry = null;
    if (providedEntry && entries.includes(providedEntry)) {
      targetEntry = providedEntry;
    } else if (Number.isInteger(instanceId) && instanceId >= 0 && instanceId < entries.length) {
      targetEntry = entries[instanceId];
    }
    if (!targetEntry) {
      return [];
    }
    const groups = [];
    if (targetEntry.decorationGroup) {
      groups.push(targetEntry.decorationGroup);
    } else {
      const typeGroups = chunk.decorationTypeIndex?.get(type);
      if (typeGroups) {
        typeGroups.forEach((group) => {
          if (!group || !Array.isArray(group.instanceIndices)) {
            return;
          }
          if (group.instanceIndices.includes(targetEntry.index ?? instanceId)) {
            groups.push(group);
          }
        });
      }
    }
    const uniqueGroups = groups.length > 0 ? Array.from(new Set(groups)) : [];
    const summaries = uniqueGroups.length > 0
      ? removeDecorationGroupsBulk({ chunk, type, groups: uniqueGroups })
      : [];
    if (targetEntry.prototypeKey) {
      removePrototypePlacement(chunk, targetEntry.prototypeKey, targetEntry.key);
    }
    return summaries;
  }


  function removeBlockInstance({ chunk, type, instanceId }) {
    if (!chunk || typeof instanceId !== 'number' || !(chunk.typeData instanceof Map)) {
      return null;
    }
    const typeData = chunk.typeData.get(type);
    if (!typeData || !Array.isArray(typeData.entries)) {
      return null;
    }
    if (instanceId < 0 || instanceId >= typeData.entries.length) {
      return null;
    }
    const target = typeData.entries[instanceId];
    const removed = removeBlockInstancesBulk({ chunk, type, entries: [target] });
    return removed.length > 0 ? removed[0] : null;
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

    if (!mesh && Array.isArray(groups)) {
      for (let i = 0; i < groups.length; i += 1) {
        const metadata = groups[i];
        if (!metadata || (metadata.type && metadata.type !== type)) {
          continue;
        }
        if (metadata.mesh?.isInstancedMesh) {
          mesh = metadata.mesh;
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
    const hiddenRemovalEntries = new Set();
    const summaries = [];

    uniqueGroups.forEach((group) => {
      const sanitized = Array.from(new Set(group.instanceIndices || []))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < entries.length)
        .sort((a, b) => a - b);
      const hiddenEntries = Array.isArray(group.hiddenEntries)
        ? group.hiddenEntries.filter(Boolean)
        : [];
      if (sanitized.length === 0 && hiddenEntries.length === 0) {
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
      validGroups.push({ group, indices: sanitized, hiddenEntries });
      sanitized.forEach((index) => removalIndicesSet.add(index));
      hiddenEntries.forEach((entry) => {
        if (entry) {
          hiddenRemovalEntries.add(entry);
        }
      });
    });

    if (validGroups.length === 0) {
      return summaries;
    }

    const indicesToRemove = Array.from(removalIndicesSet).sort((a, b) => a - b);
    if (indicesToRemove.length === 0 && hiddenRemovalEntries.size === 0) {
      validGroups.forEach(({ group }) => unregisterDecorationGroup(group));
      return summaries;
    }

    const removalGroupsSet = new Set(validGroups.map(({ group }) => group));
    const peers = chunk.decorationTypeIndex?.get(type)
      ? Array.from(chunk.decorationTypeIndex.get(type)).filter(
          (metadata) => !removalGroupsSet.has(metadata),
        )
      : Array.from(chunk.decorationGroups.values()).filter(
          (metadata) => !removalGroupsSet.has(metadata) && metadata.type === type,
        );

    const targetEntries = indicesToRemove
      .map((index) => ({ index, entry: entries[index] }))
      .filter(({ entry }) => Boolean(entry));

    if (targetEntries.length === 0 && hiddenRemovalEntries.size === 0) {
      validGroups.forEach(({ group }) => unregisterDecorationGroup(group));
      return summaries;
    }

    const removedEntries = [];
    const removedEntryObjects = new Set();
    const visibilityPositions = [];

    targetEntries
      .sort((a, b) => b.index - a.index)
      .forEach(({ entry, index }) => {
        if (!entry) {
          return;
        }
        removeEntryFromChunkMesh(chunk, entry);
        removedEntries.push({ entry, index });
        removedEntryObjects.add(entry);
        if (entry.position) {
          visibilityPositions.push({
            x: Math.round(entry.position.x),
            y: Math.round(entry.position.y),
            z: Math.round(entry.position.z),
          });
        } else if (entry.coordinateKey) {
          const coords = parseBlockCoordinateKey(entry.coordinateKey);
          if (coords) {
            visibilityPositions.push(coords);
          }
        }
      });

    hiddenRemovalEntries.forEach((entry) => {
      if (!entry || removedEntryObjects.has(entry)) {
        return;
      }
      removeEntryFromChunkMesh(chunk, entry);
      removedEntries.push({ entry, index: Number.isInteger(entry.index) ? entry.index : -1 });
      removedEntryObjects.add(entry);
      if (entry.position) {
        visibilityPositions.push({
          x: Math.round(entry.position.x),
          y: Math.round(entry.position.y),
          z: Math.round(entry.position.z),
        });
      } else if (entry.coordinateKey) {
        const coords = parseBlockCoordinateKey(entry.coordinateKey);
        if (coords) {
          visibilityPositions.push(coords);
        }
      }
    });

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
    const firstAffectedIndex = indicesToRemove[0] ?? 0;
    const peersProcessed = peers.length;
    const remainingCount = entries.length;

    validGroups.forEach(({ group }) => {
      group.instanceIndices = [];
      unregisterDecorationGroup(group);
    });

    const removalLookup = new Set(removedEntries.map(({ index }) => index));
    validGroups.forEach(({ group, indices, hiddenEntries }) => {
      const hiddenRemovedCount = Array.isArray(hiddenEntries)
        ? hiddenEntries.filter(Boolean).length
        : 0;
      const removedCount =
        indices.filter((index) => removalLookup.has(index)).length + hiddenRemovedCount;
      summaries.push({
        chunk,
        groupKey: group.key ?? null,
        removedCount,
        peersProcessed,
        firstAffectedIndex,
        remainingCount,
      });
    });

    if (visibilityPositions.length > 0) {
      const chunkVisibilityBuckets = new Map();
      visibilityPositions.forEach((pos) => {
        if (!pos) {
          return;
        }
        const chunkX = worldToChunk(pos.x);
        const chunkZ = worldToChunk(pos.z);
        if (!Number.isFinite(chunkX) || !Number.isFinite(chunkZ)) {
          return;
        }
        const key = chunkKey(chunkX, chunkZ);
        let bucket = chunkVisibilityBuckets.get(key);
        if (!bucket) {
          const targetChunk =
            chunk && chunk.chunkX === chunkX && chunk.chunkZ === chunkZ
              ? chunk
              : loadedChunks.get(key);
          if (!targetChunk) {
            return;
          }
          bucket = { chunk: targetChunk, positions: [] };
          chunkVisibilityBuckets.set(key, bucket);
        }
        bucket.positions.push(pos);
      });

      chunkVisibilityBuckets.forEach(({ chunk: targetChunk, positions }) => {
        refreshBlockVisibility(targetChunk, positions);
      });
    }

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

  const managerApi = {
    update,
    dispose,
    flush,
    setStreamingBudgets,
    setPlayerSpawnColumn(column) {
      spawnColumnKey = toColumnKey(normalizeColumnCoordinates(column));
    },
    solidBlocks,
    softBlocks,
    waterColumns,
    events,
    getBlockFromIntersection,
    removeBlockInstance,
    removeDecorationInstance,
    removeDecorationGroup,
    recordEntityPlacement,
    recordEntityRemoval,
    preloadAround,
    preloadDirectional,
    setViewDistance,
    setRetentionDistance,
    getViewDistance,
    getRetentionDistance,
    getRaycastTargets,
    getStreamingStats,
    ...(debugSnapshot ? { debugSnapshot } : {}),
  };

  Object.defineProperty(managerApi, '__getStreamingBudgetsForTest', {
    value: () => ({
      preload: maxPreloadPerUpdate,
      activation: maxActivationsPerUpdate,
      disposal: maxDisposalsPerUpdate,
      defaultPreloadBurst,
      defaultActivationBudget,
      defaultDisposalBudget,
      derivedChunkColumnsPerChunk,
      derivedChunkThroughput,
      derivedActivationFloor,
      derivedDisposalFloor,
    }),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getFiniteRadiiForTest', {
    value: () => ({
      view: lastFiniteViewRadius,
      retention: lastFiniteRetentionRadius,
    }),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getPendingEntryForTest', {
    value: (key) => {
      if (key == null) {
        return null;
      }
      return getPendingEntryByKey(String(key));
    },
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getChunkJobQueueSnapshotForTest', {
    value: () =>
      chunkJobQueue.map((entry) => ({
        key: entry?.key ?? null,
        kind: entry?.kind ?? 'preload',
        pendingBudget: entry?.pendingBudget ?? null,
        unlimited: entry?.unlimited === true,
      })),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getLoadedChunkForTest', {
    value: (key) => {
      if (key == null) {
        return null;
      }
      return loadedChunks.get(String(key)) ?? null;
    },
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getPayloadCacheSnapshotForTest', {
    value: () =>
      Array.from(payloadCache.entries()).map(([key, entry]) => ({
        key,
        detailLevel: entry?.detailLevel ?? null,
        payload: entry?.payload ?? null,
      })),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getChunkPersistenceStateForTest', {
    value: (key) => {
      if (key == null) {
        return null;
      }
      return chunkPersistenceState.get(String(key)) ?? null;
    },
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__runAutosavePassForTest', {
    value: () => runAutosavePass(),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__runCompactionPassForTest', {
    value: () => runCompactionPass(),
    enumerable: false,
  });

  if (isDevBuild) {
    Object.defineProperty(managerApi, '__getPreloadDebugCounters', {
      value: () => ({
        queueSizes: {
          scout: preloadDebugState.queueSizes[DETAIL_LEVEL_SCOUT],
          retention: preloadDebugState.queueSizes[DETAIL_LEVEL_RETENTION],
          core: preloadDebugState.queueSizes[DETAIL_LEVEL_CORE],
        },
        lastBaseBudget: preloadDebugState.lastBaseBudget,
        lastBaseBudgetSpent: preloadDebugState.lastBaseBudgetSpent,
        lastScoutTopUp: preloadDebugState.lastScoutTopUp,
        lastScoutTopUpSpent: preloadDebugState.lastScoutTopUpSpent,
        lastScoutTopUpRemaining: preloadDebugState.lastScoutTopUpRemaining,
        lastProcessedCounts: {
          scout:
            preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_SCOUT],
          retention:
            preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_RETENTION],
          core: preloadDebugState.lastProcessedCounts[DETAIL_LEVEL_CORE],
        },
        workerEnabled: preloadDebugState.workerEnabled,
        workerInflight: preloadDebugState.workerInflight,
        workerIdleSamples: preloadDebugState.workerIdleSamples,
        workerBusySamples: preloadDebugState.workerBusySamples,
      }),
      enumerable: false,
    });
  }

  Object.defineProperty(managerApi, '__getChunkEntityStateForTest', {
    value: (key) => {
      if (key == null) {
        return null;
      }
      return chunkEntityState.get(String(key)) ?? null;
    },
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__enqueuePendingActivationForTest', {
    value: (record) => enqueuePendingActivation(record),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__processPendingActivationsForTest', {
    value: (limit) => processPendingActivations(limit),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getPendingActivationKeysForTest', {
    value: () => Array.from(pendingActivationByKey.keys()),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__upgradePendingChunkRecordForTest', {
    value: (record, detailLevel) => upgradePendingChunkRecord(record, detailLevel),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__runEntityAutosavePassForTest', {
    value: () => runEntityAutosavePass(),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__runEntityCompactionPassForTest', {
    value: () => runEntityCompactionPass(),
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__markChunkForCompactionForTest', {
    value: (key, snapshotOverride = null) => {
      if (key == null) {
        return false;
      }
      const normalizedKey = String(key);
      const state = chunkPersistenceState.get(normalizedKey);
      if (!state) {
        return false;
      }
      if (snapshotOverride instanceof Uint8Array && snapshotOverride.byteLength > 0) {
        state.snapshot = snapshotOverride;
      }
      if (!(state.snapshot instanceof Uint8Array) || state.snapshot.byteLength === 0) {
        return false;
      }
      state.needsCompaction = true;
      chunksPendingCompaction.add(normalizedKey);
      return true;
    },
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__getChunkPersistenceJobCountForTest', {
    value: () => chunkPersistenceJobs.size,
    enumerable: false,
  });

  Object.defineProperty(managerApi, '__isChunkJobPumpActiveForTest', {
    value: () => chunkJobPumpActive,
    enumerable: false,
  });

  return managerApi;
}

export function chunkIndexFromWorld(x, z) {
  return {
    x: worldToChunk(x),
    z: worldToChunk(z),
  };
}
