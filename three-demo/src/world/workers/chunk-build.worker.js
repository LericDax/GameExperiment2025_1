import * as THREE from 'three';
import { createChunkBuildTask, initializeWorldGeneration } from '../generation.js';
import { initializeFluidRegistry } from '../fluids/fluid-registry.js';

const builders = new Map();
const activeBuilderKeys = new Set();

const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope &&
  typeof self.document === 'undefined';

const postFromWorker = (message, transferables = undefined) => {
  if (typeof self === 'undefined' || typeof self.postMessage !== 'function') {
    return;
  }
  if (Array.isArray(transferables) && transferables.length > 0) {
    self.postMessage(message, transferables);
  } else {
    self.postMessage(message);
  }
};

const toTransferableSet = (value, transferables = new Set(), seen = new Set()) => {
  if (value == null) {
    return transferables;
  }

  if (typeof value !== 'object') {
    return transferables;
  }

  if (seen.has(value)) {
    return transferables;
  }

  seen.add(value);

  const registerBuffer = (buffer) => {
    if (!buffer) {
      return;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return;
    }
    transferables.add(buffer);
  };

  if (value instanceof ArrayBuffer) {
    registerBuffer(value);
    return transferables;
  }

  if (ArrayBuffer.isView(value)) {
    registerBuffer(value.buffer);
    return transferables;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  if (value instanceof Map) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  if (value instanceof Set) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  Object.values(value).forEach((entry) =>
    toTransferableSet(entry, transferables, seen),
  );
  return transferables;
};

const normalizeBudget = (value) => {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

const serializeError = (error) => {
  if (!error) {
    return null;
  }
  const message = error?.message ?? String(error);
  const name = error?.name ?? 'Error';
  const stack = error?.stack ?? null;
  return { name, message, stack };
};

const toFiniteNumber = (value) => {
  if (Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeDetailLevel = (value) => {
  if (Number.isFinite(value)) {
    return value <= 0 ? 'retention' : 'core';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      [
        'retention',
        'retain',
        'retained',
        'low',
        'minimal',
        'lod',
      ].includes(normalized)
    ) {
      return 'retention';
    }
    if (
      ['core', 'high', 'full', 'default', 'primary', 'standard'].includes(
        normalized,
      )
    ) {
      return 'core';
    }
  }
  return 'core';
};

const normalizeChunkCoordinate = (payload, axis) => {
  const index = axis === 'x' ? 0 : 1;
  const arrayCandidates = [
    Array.isArray(payload?.chunkCoordinates) ? payload.chunkCoordinates : null,
    Array.isArray(payload?.chunk) ? payload.chunk : null,
    Array.isArray(payload?.coordinates) ? payload.coordinates : null,
    Array.isArray(payload?.coords) ? payload.coords : null,
    Array.isArray(payload?.position) ? payload.position : null,
    Array.isArray(payload?.origin) ? payload.origin : null,
    Array.isArray(payload?.location) ? payload.location : null,
    Array.isArray(payload?.chunk?.coordinates) ? payload.chunk.coordinates : null,
    Array.isArray(payload?.chunk?.coords) ? payload.chunk.coords : null,
    Array.isArray(payload?.chunk?.position) ? payload.chunk.position : null,
    Array.isArray(payload?.chunk?.origin) ? payload.chunk.origin : null,
    Array.isArray(payload?.chunk?.location) ? payload.chunk.location : null,
  ];
  for (let i = 0; i < arrayCandidates.length; i += 1) {
    const candidate = arrayCandidates[i];
    if (!candidate) {
      continue;
    }
    const numeric = toFiniteNumber(candidate[index]);
    if (numeric !== null) {
      return numeric;
    }
  }

  const containers = [
    payload,
    payload?.chunk,
    payload?.chunk?.coordinates,
    payload?.chunk?.coords,
    payload?.chunk?.position,
    payload?.chunk?.origin,
    payload?.chunk?.location,
    payload?.chunk?.center,
    payload?.chunk?.chunk,
    payload?.coordinates,
    payload?.coords,
    payload?.position,
    payload?.origin,
    payload?.location,
  ];
  const fieldNames = [
    `chunk${axis.toUpperCase()}`,
    axis,
    axis.toUpperCase(),
    axis === 'x' ? 'col' : 'row',
    axis === 'x' ? 'column' : 'depth',
    axis === 'x' ? 'i' : 'k',
    axis === 'x' ? 'indexX' : 'indexZ',
  ];

  for (let i = 0; i < containers.length; i += 1) {
    const container = containers[i];
    if (!container || typeof container !== 'object') {
      continue;
    }
    for (let j = 0; j < fieldNames.length; j += 1) {
      const fieldName = fieldNames[j];
      if (!(fieldName in container)) {
        continue;
      }
      const numeric = toFiniteNumber(container[fieldName]);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return 0;
};

const ensurePlainObject = (value) => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value;
};

const collectTransferableCandidates = (value, target = []) => {
  if (!value) {
    return target;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry) {
        target.push(entry);
      }
    });
    return target;
  }
  if (value instanceof Set) {
    value.forEach((entry) => {
      if (entry) {
        target.push(entry);
      }
    });
  }
  return target;
};

let worldInitialized = false;
let lastWorldOptionsSignature = null;

const ensureGenerationEnvironment = (worldOptions = {}) => {
  const signature = JSON.stringify(worldOptions ?? {});
  if (!worldInitialized || signature !== lastWorldOptionsSignature) {
    initializeWorldGeneration({ THREE, worldOptions });
    initializeFluidRegistry({ THREE });
    worldInitialized = true;
    lastWorldOptionsSignature = signature;
  }
};

const rehydrateBlockMaterialRecord = (value = {}) => {
  const transparent = value?.transparent === true;
  const depthWrite = value?.depthWrite !== false;
  const opacity = Number.isFinite(value?.opacity) ? value.opacity : 1;
  const userData = ensurePlainObject(value?.userData);
  return {
    transparent,
    depthWrite,
    opacity,
    userData,
  };
};

const rehydrateBlockMaterials = (serialized = {}) => {
  const entries = ensurePlainObject(serialized);
  const fallback = rehydrateBlockMaterialRecord(entries.__defaults);
  const registry = {};
  Object.entries(entries).forEach(([key, value]) => {
    if (key === '__defaults') {
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    registry[key] = rehydrateBlockMaterialRecord(value);
  });
  return new Proxy(registry, {
    get(target, property) {
      if (typeof property === 'string') {
        if (Object.prototype.hasOwnProperty.call(target, property)) {
          return target[property];
        }
        return fallback;
      }
      return target[property];
    },
    set() {
      return false;
    },
  });
};

const normalizeStartOptions = (payload = {}) => {
  const chunkX = normalizeChunkCoordinate(payload, 'x');
  const chunkZ = normalizeChunkCoordinate(payload, 'z');

  const detailCandidates = [
    payload.detailLevel,
    payload.detail,
    payload?.detail?.level,
    payload?.detail?.mode,
    payload?.detail?.detailLevel,
    payload?.options?.detailLevel,
    payload?.options?.detail?.level,
    payload?.options?.detail?.mode,
  ];
  let detailLevel = 'core';
  for (let i = 0; i < detailCandidates.length; i += 1) {
    const candidate = detailCandidates[i];
    if (candidate === undefined || candidate === null) {
      continue;
    }
    if (typeof candidate === 'string' || Number.isFinite(candidate)) {
      detailLevel = normalizeDetailLevel(candidate);
      break;
    }
  }

  const worldOptionsCandidates = [
    payload.worldOptions,
    payload.options?.worldOptions,
    payload.options?.world,
    payload.world,
    payload.options?.worldConfig,
    payload.worldConfig,
  ];
  let worldOptions = {};
  for (let i = 0; i < worldOptionsCandidates.length; i += 1) {
    const candidate = worldOptionsCandidates[i];
    if (candidate && typeof candidate === 'object') {
      worldOptions = candidate;
      break;
    }
  }

  const blockMaterialCandidates = [
    payload.blockMaterials,
    payload.options?.blockMaterials,
    payload.options?.builder?.blockMaterials,
  ];
  let blockMaterials = {};
  for (let i = 0; i < blockMaterialCandidates.length; i += 1) {
    const candidate = blockMaterialCandidates[i];
    if (candidate && typeof candidate === 'object') {
      blockMaterials = candidate;
      break;
    }
  }

  const engineCandidates = [
    payload.engine,
    payload.options?.engine,
    payload.options?.terrainEngine,
    payload.options?.enginePayload,
    payload.enginePayload,
  ];
  let engine = null;
  for (let i = 0; i < engineCandidates.length; i += 1) {
    const candidate = engineCandidates[i];
    if (candidate && typeof candidate === 'object') {
      engine = candidate;
      break;
    }
  }

  const builderOptions = ensurePlainObject(payload?.options?.builder);
  const includeBlockPlacementsCandidates = [
    payload.includeBlockPlacements,
    payload.options?.includeBlockPlacements,
    builderOptions.includeBlockPlacements,
  ];
  let includeBlockPlacements = null;
  for (let i = 0; i < includeBlockPlacementsCandidates.length; i += 1) {
    const candidate = includeBlockPlacementsCandidates[i];
    if (candidate !== undefined) {
      includeBlockPlacements = Boolean(candidate);
      break;
    }
  }

  const normalized = { ...builderOptions };
  normalized.chunkX = Number.isFinite(chunkX) ? chunkX : 0;
  normalized.chunkZ = Number.isFinite(chunkZ) ? chunkZ : 0;
  normalized.detailLevel = detailLevel;
  normalized.worldOptions = ensurePlainObject(worldOptions);
  normalized.blockMaterials = rehydrateBlockMaterials(blockMaterials);
  if (engine) {
    normalized.engine = engine;
  }
  if (includeBlockPlacements !== null) {
    normalized.includeBlockPlacements = includeBlockPlacements;
  }
  return normalized;
};

const createBuilder = (options = {}) => {
  let task = null;
  let done = false;
  let payload = null;
  let errorInfo = null;

  const ensureTask = () => {
    if (task || done) {
      return;
    }
    try {
      ensureGenerationEnvironment(options.worldOptions);
      task = createChunkBuildTask({
        chunkX: Number.isFinite(options.chunkX) ? options.chunkX : 0,
        chunkZ: Number.isFinite(options.chunkZ) ? options.chunkZ : 0,
        blockMaterials: options.blockMaterials,
        detailLevel: options.detailLevel ?? 'core',
        requireWorkerPayload: true,
      });
      task.setRequiresWorkerPayload?.(true);
    } catch (error) {
      errorInfo = serializeError(error);
      done = true;
      task = null;
    }
  };

  const finalizePayload = () => {
    if (!task || payload !== null) {
      return;
    }
    try {
      payload = task.exportPayloadSnapshot();
    } catch (error) {
      errorInfo = serializeError(error);
      payload = null;
    }
  };

  return {
    step(budget) {
      const normalizedBudget = normalizeBudget(budget);
      if (done) {
        return { processed: 0, done: true };
      }
      if (normalizedBudget <= 0) {
        return { processed: 0, done: false };
      }

      ensureTask();
      if (!task) {
        done = true;
        return { processed: 0, done: true };
      }

      try {
        const result = task.step(normalizedBudget) ?? {};
        const processed = Math.max(0, Number(result.processed) || 0);
        done = result.done === true;
        if (done) {
          finalizePayload();
        }
        return { processed, done };
      } catch (error) {
        errorInfo = serializeError(error);
        done = true;
        payload = null;
        return { processed: 0, done: true };
      }
    },
    takePayload() {
      finalizePayload();
      const result = payload;
      payload = null;
      try {
        task?.releaseCachedPayload?.();
      } catch (error) {
        if (!errorInfo) {
          errorInfo = serializeError(error);
        }
      }
      task = null;
      return result;
    },
    takeError() {
      const error = errorInfo;
      errorInfo = null;
      return error;
    },
    cancel() {
      try {
        task?.releaseCachedPayload?.();
      } catch (error) {
        errorInfo = serializeError(error);
      }
      task = null;
      payload = null;
      done = true;
    },
    isDone() {
      return done;
    },
  };
};

const handleStartMessage = ({ key, payload }) => {
  if (!key) {
    return;
  }
  const existing = builders.get(key);
  if (existing) {
    existing.cancel();
    builders.delete(key);
    activeBuilderKeys.delete(key);
  }
  try {
    const normalizedOptions = normalizeStartOptions(payload ?? {});
    const builder = createBuilder(normalizedOptions);
    builders.set(key, builder);
    activeBuilderKeys.add(key);
  } catch (error) {
    builders.delete(key);
    activeBuilderKeys.delete(key);
    const response = {
      key,
      processed: 0,
      done: true,
      error: serializeError(error),
    };
    postFromWorker(response);
  }
};

const handleStepMessage = (message) => {
  const { key } = message;
  if (!key) {
    return;
  }
  if (!activeBuilderKeys.has(key)) {
    const response = {
      key,
      processed: 0,
      done: true,
      error: serializeError(
        new Error(`Chunk build step received before start for key ${key}`),
      ),
    };
    postFromWorker(response);
    return;
  }
  const builder = builders.get(key);
  if (!builder) {
    const response = { key, processed: 0, done: true };
    activeBuilderKeys.delete(key);
    postFromWorker(response);
    return;
  }
  const payload = message.payload;
  const budgetCandidate =
    message.budget ??
    payload?.budget ??
    payload?.count ??
    payload?.limit ??
    payload ??
    0;
  const budget = budgetCandidate;
  const { processed = 0, done = false } = builder.step(budget);
  const response = { key, processed, done };
  let transferables = undefined;
  if (done) {
    const rawResult = builder.takePayload();
    const errorInfo = builder.takeError();
    if (rawResult !== null && rawResult !== undefined) {
      let resultPayload = rawResult;
      const manualTransferables = [];
      if (typeof rawResult === 'object' && rawResult !== null) {
        if (rawResult.metadata !== undefined) {
          response.metadata = rawResult.metadata;
        }
        if (rawResult.payload !== undefined) {
          resultPayload = rawResult.payload;
        }
        collectTransferableCandidates(rawResult.transferables, manualTransferables);
        collectTransferableCandidates(
          rawResult.payloadTransferables,
          manualTransferables,
        );
      }
      response.payload = resultPayload;
      const transferableSet = toTransferableSet(resultPayload);
      if (manualTransferables.length > 0) {
        manualTransferables.forEach((entry) => {
          if (entry) {
            transferableSet.add(entry);
          }
        });
      }
      if (transferableSet.size > 0) {
        transferables = Array.from(transferableSet);
      }
    }
    if (errorInfo) {
      response.error = errorInfo;
    }
    builders.delete(key);
    activeBuilderKeys.delete(key);
  }
  postFromWorker(response, transferables);
};

const handleCancelMessage = ({ key }) => {
  if (!key) {
    return;
  }
  const builder = builders.get(key);
  if (!builder) {
    return;
  }
  builder.cancel();
  builders.delete(key);
  activeBuilderKeys.delete(key);
};

const handleMessageEvent = (event) => {
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return;
  }
  const { type } = data;
  switch (type) {
    case 'start':
      handleStartMessage(data);
      break;
    case 'step':
      handleStepMessage(data);
      break;
    case 'cancel':
      handleCancelMessage(data);
      break;
    default:
      break;
  }
};

if (isWorkerScope) {
  self.addEventListener('message', handleMessageEvent);
}

export const createChunkBuildWorker = () => {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment.');
  }
  return new Worker(new URL('./chunk-build.worker.js', import.meta.url), {
    type: 'module',
  });
};

