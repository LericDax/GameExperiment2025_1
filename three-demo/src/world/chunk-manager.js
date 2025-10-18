import * as THREE from 'three';

import {
  createChunkBuildTask,
  createChunkWorkerStartPayload,
  getWorldOptions,
  buildInstancedBlockMesh,
  makeBlockKey,
  isBlockOccluding,
} from './generation.js';
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
import { mergeSnapshotWithJournals } from './persist/snapshot.ts';

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

  return {
    snapshot,
    journals,
    metadata: metadata ?? null,
    payload: payload ?? null,
    fallback,
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
  maxPreloadPerUpdate = 2,
  maxDisposalsPerUpdate = 1,
  maxActivationsPerUpdate = 2,
  payloadCacheSize = 0,
  // Additional chunk radius allowed beyond the retention distance before
  // disposal kicks in. This gives callers a way to keep edge chunks alive
  // a little longer (or indefinitely with Infinity) to hide visual pops.
  disposalMargin = 0,
  chunkPersistenceQueue: providedChunkPersistenceQueue = undefined,
  chunkPersistenceTimeout = DEFAULT_CHUNK_STORE_TIMEOUT_MS,
}) {
  const loadedChunks = new Map();
  const solidBlocks = new Set();
  const softBlocks = new Set();
  const waterColumns = new Map();
  const decorationGroupsByKey = new Map();
  const decorationOwnersIndex = new Map();
  const prototypeRemovalGuards = new Set();
  const chunkDisposalQueue = [];
  const scheduledChunkDisposals = new Set();
  const raycastTargets = new Set();
  const isDevBuild = Boolean(import.meta.env && import.meta.env.DEV);
  const eventListeners = new Map();
  const defaultDisposalBudget = resolveBudget(maxDisposalsPerUpdate, 1);
  const defaultActivationBudget = resolveBudget(maxActivationsPerUpdate, 2);
  const defaultPreloadBurst = (() => {
    const numeric = Number(maxPreloadPerUpdate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 2;
    }
    return Math.max(1, Math.floor(numeric));
  })();
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
  const preloadQueue = [];
  const pendingPreloadEntries = new Map();
  const pendingActivations = [];
  const pendingActivationByKey = new Map();
  const chunkJobQueue = [];
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
  const chunkPersistenceJobs = new Map();
  let chunkJobPumpActive = false;
  let chunkJobPumpPromise = null;
  const chunkBuildWorker = ensureChunkBuildWorkerInstance();
  const workerEnabled = Boolean(chunkBuildWorker);
  const workerDisposables = [];
  const retentionDisposalMargin = normalizeDistance(disposalMargin, 0);
  const DETAIL_LEVEL_CORE = 'core';
  const DETAIL_LEVEL_RETENTION = 'retention';
  const DETAIL_LEVELS = [DETAIL_LEVEL_RETENTION, DETAIL_LEVEL_CORE];
  const normalizeDetailLevel = (value) => {
    if (value === DETAIL_LEVEL_RETENTION || value === DETAIL_LEVEL_CORE) {
      return value;
    }
    return DETAIL_LEVEL_CORE;
  };
  const detailLevelRank = (value) =>
    DETAIL_LEVELS.indexOf(normalizeDetailLevel(value));
  const resolveDetailLevelForDistance = (maxDistance, finiteViewRadius) => {
    if (!Number.isFinite(finiteViewRadius)) {
      return DETAIL_LEVEL_CORE;
    }
    return maxDistance <= finiteViewRadius
      ? DETAIL_LEVEL_CORE
      : DETAIL_LEVEL_RETENTION;
  };
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
  let lastFiniteViewRadius = Number.isFinite(currentViewDistance)
    ? Math.max(0, Math.floor(currentViewDistance))
    : Math.max(0, Math.floor(lastFiniteViewDistance));

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
    if (!workerEnabled || !chunkBuildWorker) {
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

        const message = {
          type: 'start',
          key: entryKey,
          payload: startPayload ?? {},
        };
        if (startPersistence !== undefined && startPersistence !== null) {
          message.persistence = startPersistence;
        }
        const transferables = Array.isArray(startTransferables)
          ? startTransferables
          : Array.isArray(metadata?.buffers)
          ? metadata.buffers
          : [];
        chunkBuildWorker.postMessage(message, transferables);
      },
      step(budget) {
        chunkBuildWorker.postMessage({ type: 'step', key: entryKey, budget });
      },
      cancel() {
        chunkBuildWorker.postMessage({ type: 'cancel', key: entryKey });
      },
    };
  }

  function createChunkJobMetadata(entry) {
    const metadata = {
      mode: workerEnabled && chunkBuildWorker ? 'worker' : 'local',
      controller: null,
      buffers: [],
      started: false,
      inflight: false,
      payload: null,
      startPayload: null,
      startPersistence: null,
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

  function finalizeWorkerChunk(entry, workerPayload = null) {
    const payload =
      workerPayload?.payload ?? entry?.metadata?.payload ?? null;
    if (!payload) {
      throw new Error('Chunk worker payload unavailable.');
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

    const chunk = {
      chunkX: entry.chunkX,
      chunkZ: entry.chunkZ,
      group: meshResult.chunkGroup,
      solidBlockKeys: derivedCollisionKeys.solidBlockKeys,
      softBlockKeys: derivedCollisionKeys.softBlockKeys,
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
    if (entry?.metadata) {
      entry.metadata.payload = null;
    }
    if (workerPayload) {
      workerPayload.payload = null;
    }
    return chunk;
  }

  if (workerEnabled && chunkBuildWorker) {
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

    chunkBuildWorker.addEventListener('message', handleWorkerMessage);
    chunkBuildWorker.addEventListener('error', handleWorkerError);
    workerDisposables.push(() => {
      chunkBuildWorker.removeEventListener('message', handleWorkerMessage);
      chunkBuildWorker.removeEventListener('error', handleWorkerError);
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
        if (Array.isArray(material)) {
          material.forEach((mat) => mat?.dispose?.());
        } else {
          material?.dispose?.();
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
    try {
      registerGeneratedChunk(chunk);
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
    if (settle && record.entry) {
      record.entry.resolve?.(null);
      record.entry.reject = null;
      record.entry.resolve = null;
    }
    if (record.entry) {
      record.entry.pendingChunk = null;
    }
    if (disposeChunk) {
      releasePendingChunkResources(record.chunk);
    }
    record.entry = null;
    record.chunk = null;
  }

  function enqueuePendingActivation(record) {
    if (!record || !record.key) {
      return;
    }
    if (pendingActivationByKey.has(record.key)) {
      dropPendingActivation(record.key, { disposeChunk: true, settle: true });
    }
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
    return resolveDetailLevelForDistance(maxDistance, lastFiniteViewRadius);
  }

  function upgradePendingChunkRecord(record, targetDetailLevel) {
    const normalizedTarget = normalizeDetailLevel(targetDetailLevel);
    if (!record) {
      return false;
    }
    const { entry } = record;
    if (!entry) {
      return false;
    }
    try {
      if (record.chunk) {
        releasePendingChunkResources(record.chunk);
      }
      const upgradeTask = createChunkBuildTask({
        chunkX: entry.chunkX,
        chunkZ: entry.chunkZ,
        blockMaterials,
        detailLevel: normalizedTarget,
      });
      let done = false;
      while (!done) {
        const stepResult = upgradeTask.step(Number.POSITIVE_INFINITY);
        if (!stepResult) {
          break;
        }
        done = stepResult.done === true;
      }
      let payloadForCache = null;
      if (typeof upgradeTask.exportPayloadSnapshot === 'function') {
        payloadForCache = upgradeTask.exportPayloadSnapshot();
      }
      const upgradedChunk = upgradeTask.finalize();
      if (payloadForCache) {
        payloadForCache.detailLevel = normalizedTarget;
        upgradedChunk.__cachePayload = payloadForCache;
      }
      upgradedChunk.detailLevel = normalizedTarget;
      upgradedChunk.desiredDetailLevel = normalizedTarget;
      if (upgradedChunk.__cachePayload) {
        upgradedChunk.__cachePayload.detailLevel = normalizedTarget;
      }
      record.chunk = upgradedChunk;
      entry.detailLevel = normalizedTarget;
      entry.desiredDetailLevel = normalizedTarget;
      entry.workerPayload = null;
      entry.metadata = null;
      entry.task = null;
      return true;
    } catch (error) {
      console.error('[chunk-manager] Failed to upgrade chunk detail', error);
      return false;
    }
  }

  function processPendingActivations(limit = defaultActivationBudget) {
    if (pendingActivations.length === 0) {
      return 0;
    }

    const unlimited = !Number.isFinite(limit);
    let budget = unlimited
      ? pendingActivations.length
      : Math.max(0, Math.floor(limit));
    let processed = 0;
    const initialLength = pendingActivations.length;

    for (let i = 0; i < initialLength; i += 1) {
      if (!unlimited && processed >= budget) {
        break;
      }
      const record = pendingActivations.shift();
      if (!record) {
        continue;
      }
      pendingActivationByKey.delete(record.key);
      const { entry, chunk } = record;
      if (!entry || !chunk) {
        record.entry = null;
        record.chunk = null;
        continue;
      }

      const requiredDetail = computeRequiredDetailForChunk(
        chunk.chunkX,
        chunk.chunkZ,
      );
      if (
        detailLevelRank(requiredDetail) <
        detailLevelRank(DETAIL_LEVEL_RETENTION)
      ) {
        pendingActivationByKey.set(record.key, record);
        pendingActivations.push(record);
        continue;
      }

      const chunkDetail = normalizeDetailLevel(chunk.detailLevel);
      if (detailLevelRank(chunkDetail) < detailLevelRank(requiredDetail)) {
        const upgraded = upgradePendingChunkRecord(record, requiredDetail);
        if (!upgraded) {
          pendingActivationByKey.set(record.key, record);
          pendingActivations.push(record);
          continue;
        }
      }

      record.chunk.detailLevel = normalizeDetailLevel(requiredDetail);
      record.chunk.desiredDetailLevel = record.chunk.detailLevel;
      activatePendingChunkRecord(record);
      processed += 1;
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
    const queueIndex = preloadQueue.indexOf(entry);
    if (queueIndex >= 0) {
      preloadQueue.splice(queueIndex, 1);
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
      }
      const pendingRecord = {
        key: entry.key,
        chunk,
        entry,
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
    }
    entry.workerPayload = null;
    entry.pendingChunk = null;
    const queueIndex = preloadQueue.indexOf(entry);
    if (queueIndex >= 0) {
      preloadQueue.splice(queueIndex, 1);
    }
    for (let i = chunkJobQueue.length - 1; i >= 0; i -= 1) {
      if (chunkJobQueue[i] === entry) {
        chunkJobQueue.splice(i, 1);
      }
    }
    pendingPreloadEntries.delete(entry.key);
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
    entry.task?.releaseCachedPayload?.();
  }

  async function runChunkJobPump() {
    try {
      while (chunkJobQueue.length > 0) {
        const entry = chunkJobQueue.shift();
        if (!entry) {
          continue;
        }
        entry.active = false;
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
                controller.step(stepBudget);
              } catch (error) {
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

        const wasUnlimited = entry.unlimited === true;

        if (done) {
          finalizePendingEntry(entry);
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
    if (unlimited) {
      entry.unlimited = true;
      entry.pendingBudget = Number.POSITIVE_INFINITY;
      entry.stepHint = Number.POSITIVE_INFINITY;
    } else if (!entry.unlimited) {
      const previousBudget = Number.isFinite(entry.pendingBudget)
        ? entry.pendingBudget
        : 0;
      entry.pendingBudget = previousBudget + normalizedBudget;
      entry.stepHint = Math.max(entry.stepHint || 0, normalizedBudget);
    }
    if (!chunkPersistenceQueue) {
      scheduleChunkJobEntry(entry);
      return promise;
    }

    const persistenceState = entry.persistenceState ?? 'ready';
    if (persistenceState === 'ready' || persistenceState === 'failed') {
      scheduleChunkJobEntry(entry);
      return promise;
    }

    if (persistenceState === 'idle' || persistenceState === 'pending') {
      awaitChunkPersistenceAndReschedule(entry);
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
    for (let y = startY; y >= minYLimit; y -= 1) {
      const candidateKey = `${coordinates.x}|${y}|${coordinates.z}`;
      if (solidBlocks.has(candidateKey)) {
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

  function resolveChunkKeySet(
    chunk,
    property,
    { createIfMissing = false } = {},
  ) {
    if (!chunk) {
      return null;
    }
    const current = chunk[property];
    if (current instanceof Set) {
      return current;
    }
    if (current === undefined || current === null) {
      if (!createIfMissing) {
        return null;
      }
      const next = new Set();
      chunk[property] = next;
      return next;
    }
    const iterable =
      current && typeof current[Symbol.iterator] === 'function' ? current : [];
    const next = new Set(iterable);
    chunk[property] = next;
    return next;
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
      if (entry.isSolid) {
        const chunkSolidKeys = resolveChunkKeySet(chunk, 'solidBlockKeys', {
          createIfMissing: true,
        });
        chunkSolidKeys?.add(coordinateKey);
        solidBlocks.add(coordinateKey);
      }
      if (entry.collisionMode === 'soft') {
        const chunkSoftKeys = resolveChunkKeySet(chunk, 'softBlockKeys', {
          createIfMissing: true,
        });
        chunkSoftKeys?.add(coordinateKey);
        softBlocks.add(coordinateKey);
      }
    }
  }

  function removeEntryFromChunkMesh(chunk, entry, { preserveMetadata = false } = {}) {
    const coordinateKey = entry?.coordinateKey ?? entry?.key;
    const removeCollisionKeys = () => {
      if (!chunk || !entry || !coordinateKey) {
        return;
      }
      if (entry.isSolid) {
        const chunkSolidKeys = resolveChunkKeySet(chunk, 'solidBlockKeys');
        chunkSolidKeys?.delete(coordinateKey);
        solidBlocks.delete(coordinateKey);
      }
      if (entry.collisionMode === 'soft') {
        const chunkSoftKeys = resolveChunkKeySet(chunk, 'softBlockKeys');
        chunkSoftKeys?.delete(coordinateKey);
        softBlocks.delete(coordinateKey);
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


  function registerGeneratedChunk(chunk) {
    if (!chunk) {
      return;
    }
    const { chunkX, chunkZ } = chunk;
    const key = chunkKey(chunkX, chunkZ);
    if (loadedChunks.has(key)) {
      return;
    }

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
    if (!hasEmittedFirstChunkMeshed) {
      hasEmittedFirstChunkMeshed = true;
      dispatchChunkEvent(ChunkManagerEvents.FIRST_CHUNK_MESHED, {
        chunkX,
        chunkZ,
        chunkKey: key,
      });
    }
    (chunk.solidBlockKeys ?? []).forEach((block) => solidBlocks.add(block));
    (chunk.softBlockKeys ?? []).forEach((block) => softBlocks.add(block));
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
    loadedChunks.set(key, chunk);

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
      return;
    }
    const blocking = options.blocking === true;
    const centerChunkX =
      typeof options.centerChunkX === 'number' ? options.centerChunkX : chunkX;
    const centerChunkZ =
      typeof options.centerChunkZ === 'number' ? options.centerChunkZ : chunkZ;
    const urgentBurst = Math.max(1, defaultPreloadBurst);
    let entry = pendingPreloadEntries.get(key);
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
    const pendingEntry = pendingPreloadEntries.get(key);
    if (pendingEntry) {
      cancelPendingEntry(pendingEntry);
    }
    const chunk = loadedChunks.get(key);
    if (!chunk) {
      return;
    }

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
      return;
    }

    refreshCacheForWorldChange();

    const { urgent = false } = options;
    const requestedDetailLevel = normalizeDetailLevel(options.detailLevel);
    const dx = chunkX - centerChunkX;
    const dz = chunkZ - centerChunkZ;
    const priority = dx * dx + dz * dz;

    const existing = pendingPreloadEntries.get(key);
    const pendingActivationRecord =
      pendingActivationByKey.get(key) ?? existing?.pendingChunk ?? null;

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
          if (pendingActivationRecord.chunk) {
            pendingActivationRecord.chunk.desiredDetailLevel =
              requestedDetailLevel;
          }
          reprioritize = true;
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
      }
      if (changed) {
        queueDirty = true;
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
    };
    entry.metadata = createChunkJobMetadata(entry);
    updateEntryPersistenceMetadata(entry);
    entry.task = createChunkBuildTask({
      chunkX,
      chunkZ,
      blockMaterials,
      requireWorkerPayload: entry.metadata?.mode === 'worker',
      detailLevel: entry.detailLevel,
    });
    pendingPreloadEntries.set(key, entry);
    preloadQueue.push(entry);
    queueDirty = true;
    return entry;
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
        cancelPendingEntry(entry);
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

    const unlimitedPromises = [];
    let index = 0;
    while (index < preloadQueue.length) {
      const entry = preloadQueue[index];
      if (!entry) {
        index += 1;
        continue;
      }
      if (entry.finalized || entry.cancelled || loadedChunks.has(entry.key)) {
        cancelPendingEntry(entry);
        continue;
      }
      if (entry.unlimited) {
        index += 1;
        continue;
      }

      if (unlimited) {
        const promise = startChunkJob(entry, { unlimited: true });
        if (promise) {
          unlimitedPromises.push(promise);
        }
        index += 1;
        continue;
      }

      if (remainingBudget <= 0) {
        break;
      }

      if (entry.urgent) {
        const burst = Math.max(defaultPreloadBurst, remainingBudget);
        const stepBudget = Math.max(1, burst);
        startChunkJob(entry, { budget: stepBudget });
        remainingBudget = Math.max(0, remainingBudget - stepBudget);
        if (remainingBudget <= 0) {
          break;
        }
        index += 1;
        continue;
      }

      const remainingEntries = preloadQueue.length - index;
      let stepBudget = Math.max(
        1,
        Math.floor(remainingBudget / Math.max(1, remainingEntries)) || 1,
      );
      stepBudget = Math.min(stepBudget, remainingBudget);

      startChunkJob(entry, { budget: stepBudget });
      remainingBudget = Math.max(0, remainingBudget - stepBudget);

      if (remainingBudget <= 0) {
        break;
      }

      index += 1;
    }

    if (unlimitedPromises.length > 0) {
      return Promise.all(unlimitedPromises);
    }

    return 0;
  }

  function update(position, options = {}) {
    if (!position) {
      return;
    }

    refreshCacheForWorldChange();

    const centerChunkX = worldToChunk(position.x);
    const centerChunkZ = worldToChunk(position.z);
    const centerKey = chunkKey(centerChunkX, centerChunkZ);


    if (options.camera) {
      lastCamera = options.camera;
    }
    const camera = options.camera ?? lastCamera;
    const shouldUpdateVisibility = Boolean(camera);

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

    const centerChanged = centerKey !== lastCenterKey;
    const viewChanged = desiredViewDistance !== currentViewDistance;
    const retentionChanged = desiredRetention !== retentionDistance;
    const queueHasWork = preloadQueue.length > 0;
    const disposalQueueHasWork = chunkDisposalQueue.length > 0;
    const activationQueueHasWork = pendingActivations.length > 0;

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

      if (shouldUpdateVisibility) {
        updateChunkVisibility(camera);
      }

      return;
    }

    currentViewDistance = desiredViewDistance;
    retentionDistance = desiredRetention;

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

    lastCenterChunkX = centerChunkX;
    lastCenterChunkZ = centerChunkZ;
    hasLastCenter = true;
    lastFiniteViewRadius = finiteView;

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

    prunePreloadQueue(centerChunkX, centerChunkZ, retentionRadiusWithMargin);

    const guaranteeRadius = Math.min(finiteView, 1);

    for (let dx = -guaranteeRadius; dx <= guaranteeRadius; dx += 1) {
      for (let dz = -guaranteeRadius; dz <= guaranteeRadius; dz += 1) {
        ensureChunk(centerChunkX + dx, centerChunkZ + dz, {
          blocking: force,
          centerChunkX,
          centerChunkZ,
        });
      }
    }

    if (finiteView > guaranteeRadius) {
      for (let dx = -finiteView; dx <= finiteView; dx += 1) {
        for (let dz = -finiteView; dz <= finiteView; dz += 1) {
          const maxDistance = Math.max(Math.abs(dx), Math.abs(dz));
          if (maxDistance <= guaranteeRadius) {
            continue;
          }
          const detailLevel = resolveDetailLevelForDistance(
            maxDistance,
            finiteView,
          );
          schedulePreload(
            centerChunkX + dx,
            centerChunkZ + dz,
            centerChunkX,
            centerChunkZ,
            {
              urgent: detailLevel === DETAIL_LEVEL_CORE,
              detailLevel,
            },
          );
        }
      }
    }

    if (finiteRetention > finiteView) {
      for (let dx = -finiteRetention; dx <= finiteRetention; dx += 1) {
        for (let dz = -finiteRetention; dz <= finiteRetention; dz += 1) {
          const maxDistance = Math.max(Math.abs(dx), Math.abs(dz));
          if (maxDistance <= finiteView) {
            continue;
          }
          const detailLevel = resolveDetailLevelForDistance(
            maxDistance,
            finiteView,
          );
          schedulePreload(
            centerChunkX + dx,
            centerChunkZ + dz,
            centerChunkX,
            centerChunkZ,
            { detailLevel },
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
      if (
        distanceX > retentionRadiusWithMargin ||
        distanceZ > retentionRadiusWithMargin
      ) {
        queueChunkForDisposal(key);
      } else {
        cancelChunkDisposal(key);
      }
    });

    flushChunkDisposals();

    lastCenterKey = centerKey;

    if (force) {
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

    processPendingActivations(activationBudget);

    flushChunkDisposals();


    if (shouldUpdateVisibility) {
      updateChunkVisibility(camera);
    }

  }

  async function flush({ includeDisposals = true } = {}) {
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
    preloadQueue.length = 0;
    pendingPreloadEntries.clear();
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
    chunkPersistenceJobs.clear();
    chunkPersistenceQueue?.dispose?.();
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
    return Array.from(raycastTargets);
  }

  function preloadAround(position, distance, options = {}) {
    if (!position) {
      return;
    }
    const force = options.force === true;
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
    const minimumBurst = Math.max(1, defaultPreloadBurst * 2);
    let normalizedBudget = effectiveBudget;
    if (normalizedBudget === Number.POSITIVE_INFINITY) {
      normalizedBudget = Number.POSITIVE_INFINITY;
    } else if (!Number.isFinite(normalizedBudget) || normalizedBudget <= 0) {
      normalizedBudget = minimumBurst;
    } else {
      normalizedBudget = Math.max(normalizedBudget, minimumBurst);
    }

    const updateResult = update(position, {
      viewDistance: warmView,
      retainDistance: targetRetention,
      maxPreload:
        force || normalizedBudget === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : normalizedBudget,
      force,
    });
    if (updateResult && typeof updateResult.then === 'function') {
      updateResult.catch((error) => {
        console.error('[chunk-manager] preloadAround forced update failed', error);
      });
    }
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
      if (entry.isSolid && coordinateKey) {
        chunk.solidBlockKeys?.delete(coordinateKey);
        solidBlocks.delete(coordinateKey);
        if (entry.position) {
          const settleKey = `${Math.round(entry.position.x)}|${Math.round(entry.position.z)}`;
          settleColumnKeys.add(settleKey);
        }
      }
      if (entry.collisionMode === 'soft' && coordinateKey) {
        chunk.softBlockKeys?.delete(coordinateKey);
        softBlocks.delete(coordinateKey);
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
    solidBlocks,
    softBlocks,
    waterColumns,
    events,
    getBlockFromIntersection,
    removeBlockInstance,
    removeDecorationInstance,
    removeDecorationGroup,
    preloadAround,
    setViewDistance,
    setRetentionDistance,
    getViewDistance,
    getRetentionDistance,
    getRaycastTargets,
    ...(debugSnapshot ? { debugSnapshot } : {}),
  };

  Object.defineProperty(managerApi, '__getPendingEntryForTest', {
    value: (key) => {
      if (key == null) {
        return null;
      }
      return pendingPreloadEntries.get(String(key)) ?? null;
    },
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
