import * as THREE from 'three';
import { createChunkBuildTask, initializeWorldGeneration } from '../generation.js';
import { initializeFluidRegistry } from '../fluids/fluid-registry.js';

const builders = new Map();
const activeBuilderKeys = new Set();
const pendingStartRecords = new Map();

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

const registerTransferable = (value, target) => {
  if (!value) {
    return;
  }
  if (ArrayBuffer.isView(value)) {
    target.add(value.buffer);
    return;
  }
  if (value instanceof ArrayBuffer) {
    target.add(value);
  }
};

const normalizeBufferLike = (value) => {
  if (!value) {
    return null;
  }
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    value.buffer instanceof ArrayBuffer &&
    typeof value.byteLength === 'number'
  ) {
    try {
      return new Uint8Array(value.buffer, value.byteOffset ?? 0, value.byteLength);
    } catch (error) {
      console.warn('[chunk-build.worker] Failed to normalize buffer-like payload', error);
    }
  }
  return null;
};

const normalizeBufferArray = (source) => {
  if (!source) {
    return [];
  }
  const entries = Array.isArray(source)
    ? source
    : source instanceof Set
    ? Array.from(source)
    : [source];
  const result = [];
  entries.forEach((entry) => {
    const normalized = normalizeBufferLike(entry);
    if (normalized) {
      result.push(normalized);
    }
  });
  return result;
};

const extractNumericDescriptor = (source) => {
  if (source === null || source === undefined) {
    return null;
  }
  if (Number.isFinite(source)) {
    return source;
  }
  if (typeof source === 'string' && source.length > 0) {
    const parsed = Number(source);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (!source || typeof source !== 'object') {
    return null;
  }

  const numericFields = [
    'voxelRevision',
    'voxelVersion',
    'revision',
    'version',
    'tick',
    'journalTick',
    'snapshotTick',
    'timestamp',
    'updatedAt',
    'lastUpdatedAt',
    'expectedRevision',
    'expectedTick',
    'targetRevision',
  ];
  for (let i = 0; i < numericFields.length; i += 1) {
    const value = toFiniteNumber(source[numericFields[i]]);
    if (value !== null) {
      return value;
    }
  }

  const nestedKeys = ['metadata', 'state', 'result'];
  for (let i = 0; i < nestedKeys.length; i += 1) {
    const key = nestedKeys[i];
    if (source[key] && typeof source[key] === 'object') {
      const nested = extractNumericDescriptor(source[key]);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
};

const extractVoxelSourceDescriptor = (source) => {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const descriptor = {
    payload: null,
    snapshot: null,
    journals: [],
    buffers: [],
    metadata: null,
    revision: null,
    expectedRevision: null,
    transferables: new Set(),
  };

  if (source.payload && typeof source.payload === 'object') {
    descriptor.payload = source.payload;
  }

  const snapshotCandidates = [
    source.snapshot,
    source.baseSnapshot,
    source.snapshotBuffer,
    source.payload?.snapshot,
    source.payload?.baseSnapshot,
    source.payload?.snapshotBuffer,
  ];
  for (let i = 0; i < snapshotCandidates.length && !descriptor.snapshot; i += 1) {
    const normalized = normalizeBufferLike(snapshotCandidates[i]);
    if (normalized) {
      descriptor.snapshot = normalized;
    }
  }

  const journalCandidates = [
    source.journals,
    source.journal,
    source.payload?.journals,
    source.payload?.journal,
  ];
  journalCandidates.forEach((candidate) => {
    const normalized = normalizeBufferArray(candidate);
    if (normalized.length > 0) {
      normalized.forEach((entry) => descriptor.journals.push(entry));
    }
  });

  const bufferCandidates = [source.buffers, source.payload?.buffers];
  bufferCandidates.forEach((candidate) => {
    const normalized = normalizeBufferArray(candidate);
    if (normalized.length > 0) {
      normalized.forEach((entry) => descriptor.buffers.push(entry));
    }
  });

  if (source.metadata && typeof source.metadata === 'object') {
    descriptor.metadata = source.metadata;
  } else if (source.payload?.metadata && typeof source.payload.metadata === 'object') {
    descriptor.metadata = source.payload.metadata;
  }

  const providedTransferables = normalizeBufferArray(
    source.transferables ?? source.payload?.transferables ?? null,
  );
  providedTransferables.forEach((entry) => {
    registerTransferable(entry, descriptor.transferables);
  });

  if (descriptor.snapshot) {
    registerTransferable(descriptor.snapshot, descriptor.transferables);
  }
  descriptor.journals.forEach((entry) => registerTransferable(entry, descriptor.transferables));
  descriptor.buffers.forEach((entry) => registerTransferable(entry, descriptor.transferables));

  descriptor.revision = extractNumericDescriptor(source);
  descriptor.expectedRevision = extractNumericDescriptor(
    source.expectedRevision ?? source.targetRevision ?? null,
  );

  const hasSnapshot = Boolean(descriptor.snapshot);
  const hasJournals = descriptor.journals.length > 0;
  const hasBuffers = descriptor.buffers.length > 0;
  const hasPayload = descriptor.payload && typeof descriptor.payload === 'object';

  if (!hasSnapshot && !hasJournals && !hasBuffers && !hasPayload) {
    return null;
  }

  return descriptor;
};

const hasVoxelSourceData = (descriptor) => {
  if (!descriptor || typeof descriptor !== 'object') {
    return false;
  }
  if (descriptor.payload && typeof descriptor.payload === 'object') {
    return true;
  }
  if (descriptor.snapshot) {
    return true;
  }
  if (Array.isArray(descriptor.journals) && descriptor.journals.length > 0) {
    return true;
  }
  if (Array.isArray(descriptor.buffers) && descriptor.buffers.length > 0) {
    return true;
  }
  return false;
};

const guardLatestVoxelRevision = (resolvedPayload, options = {}, descriptor = {}) => {
  const expectedCandidates = [
    options?.voxelRevision,
    descriptor?.expectedRevision,
    descriptor?.metadata?.expectedRevision,
    descriptor?.payload?.expectedRevision,
  ];
  let expectedRevision = null;
  for (let i = 0; i < expectedCandidates.length && expectedRevision === null; i += 1) {
    expectedRevision = toFiniteNumber(expectedCandidates[i]);
  }
  if (expectedRevision === null) {
    return;
  }

  const actualCandidates = [
    descriptor?.revision,
    descriptor?.payload?.voxelRevision,
    descriptor?.payload?.revision,
    descriptor?.payload?.version,
    descriptor?.metadata?.voxelRevision,
    descriptor?.metadata?.revision,
    descriptor?.metadata?.version,
    resolvedPayload?.voxelRevision,
    resolvedPayload?.revision,
    resolvedPayload?.version,
  ];
  let actualRevision = null;
  for (let i = 0; i < actualCandidates.length && actualRevision === null; i += 1) {
    actualRevision = toFiniteNumber(actualCandidates[i]);
  }
  if (actualRevision === null) {
    return;
  }
  if (actualRevision < expectedRevision) {
    throw new Error(
      `Received stale voxel payload (expected revision >= ${expectedRevision}, got ${actualRevision}).`,
    );
  }
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

const normalizePersistenceStartInfo = (raw) => {
  if (raw == null) {
    return {
      state: 'none',
      shouldBypass: false,
      payload: null,
      metadata: null,
      transferables: [],
      error: null,
      promise: null,
    };
  }

  const hasContainerFields =
    typeof raw === 'object' &&
    raw !== null &&
    (Object.prototype.hasOwnProperty.call(raw, 'state') ||
      Object.prototype.hasOwnProperty.call(raw, 'status') ||
      Object.prototype.hasOwnProperty.call(raw, 'result') ||
      Object.prototype.hasOwnProperty.call(raw, 'payload') ||
      Object.prototype.hasOwnProperty.call(raw, 'metadata') ||
      Object.prototype.hasOwnProperty.call(raw, 'error') ||
      Object.prototype.hasOwnProperty.call(raw, 'promise') ||
      Object.prototype.hasOwnProperty.call(raw, 'transferables') ||
      Object.prototype.hasOwnProperty.call(raw, 'payloadTransferables'));

  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof raw.then === 'function' &&
    !hasContainerFields
  ) {
    return {
      state: 'pending',
      shouldBypass: false,
      payload: null,
      metadata: null,
      transferables: [],
      error: null,
      promise: raw,
    };
  }

  const container =
    raw && typeof raw === 'object' ? raw : Object.create(null);

  let promise = null;
  const candidatePromises = [
    container.promise,
    container.promiseLike,
    container.resultPromise,
    container.pending,
  ];
  for (let i = 0; i < candidatePromises.length && !promise; i += 1) {
    const candidate = candidatePromises[i];
    if (candidate && typeof candidate.then === 'function') {
      promise = candidate;
    }
  }
  if (!promise && typeof raw === 'object' && raw !== null && typeof raw.then === 'function') {
    promise = raw;
  }
  if (!promise && typeof container.then === 'function') {
    promise = container;
  }

  const stateValue =
    typeof container.state === 'string'
      ? container.state
      : typeof container.status === 'string'
      ? container.status
      : promise
      ? 'pending'
      : 'ready';

  const transfers = [];
  collectTransferableCandidates(container.transferables, transfers);
  if (transfers.length === 0) {
    collectTransferableCandidates(container.payloadTransferables, transfers);
  }

  let metadata = container.metadata ?? null;
  const errorInfo = container.error ?? container.errorInfo ?? null;
  const serializedError = errorInfo ? serializeError(errorInfo) : null;

  let resultValue = null;
  if (Object.prototype.hasOwnProperty.call(container, 'result')) {
    resultValue = container.result;
  } else if (
    Object.prototype.hasOwnProperty.call(container, 'payload') &&
    container.payload !== undefined
  ) {
    resultValue = container.payload;
  } else {
    resultValue = raw;
  }

  let payload = resultValue;
  if (resultValue && typeof resultValue === 'object') {
    if (Object.prototype.hasOwnProperty.call(resultValue, 'payload')) {
      const innerPayload = resultValue.payload;
      if (innerPayload !== undefined) {
        payload = innerPayload;
      }
    }
    if (
      metadata == null &&
      Object.prototype.hasOwnProperty.call(resultValue, 'metadata')
    ) {
      metadata = resultValue.metadata;
    }
    if (transfers.length === 0) {
      collectTransferableCandidates(resultValue.transferables, transfers);
      if (transfers.length === 0) {
        collectTransferableCandidates(
          resultValue.payloadTransferables,
          transfers,
        );
      }
    }
  }

  const voxelSourceCandidates = [payload, resultValue, container, raw];
  let voxelSources = null;
  for (let i = 0; i < voxelSourceCandidates.length && !voxelSources; i += 1) {
    const descriptor = extractVoxelSourceDescriptor(voxelSourceCandidates[i]);
    if (descriptor && hasVoxelSourceData(descriptor)) {
      voxelSources = descriptor;
    }
  }
  if (voxelSources) {
    if (!voxelSources.metadata && metadata && typeof metadata === 'object') {
      voxelSources.metadata = metadata;
    }
    const descriptorTransfers =
      voxelSources.transferables instanceof Set
        ? Array.from(voxelSources.transferables)
        : Array.isArray(voxelSources.transferables)
        ? voxelSources.transferables
        : [];
    if (descriptorTransfers.length > 0) {
      descriptorTransfers.forEach((entry) => {
        if (entry) {
          transfers.push(entry);
        }
      });
    }
  }

  const shouldBypass =
    stateValue === 'ready' && payload !== null && payload !== undefined;

  return {
    state: stateValue,
    shouldBypass,
    payload,
    metadata,
    transferables: transfers,
    error: serializedError,
    promise: promise ?? null,
    voxelSources,
  };
};

const createPersistenceBuilder = ({
  payload,
  metadata,
  transferables,
  error,
}) => {
  let done = false;
  let storedPayload = payload ?? null;
  let storedMetadata = metadata ?? null;
  let storedTransferables = Array.isArray(transferables)
    ? transferables.filter((entry) => Boolean(entry))
    : [];
  const storedError = error ?? null;

  return {
    step() {
      if (done) {
        return { processed: 0, done: true };
      }
      done = true;
      return { processed: 0, done: true };
    },
    takePayload() {
      if (!done) {
        done = true;
      }
      const hasPayload = storedPayload !== null && storedPayload !== undefined;
      const hasMetadata = storedMetadata !== null && storedMetadata !== undefined;
      const hasTransferables = storedTransferables.length > 0;
      if (!hasPayload && !hasMetadata && !hasTransferables) {
        return null;
      }
      const result = {};
      if (hasMetadata) {
        result.metadata = storedMetadata;
      }
      if (hasPayload) {
        result.payload = storedPayload;
      }
      if (hasTransferables) {
        result.payloadTransferables = storedTransferables.slice();
      }
      storedPayload = null;
      storedMetadata = null;
      storedTransferables = [];
      return result;
    },
    takeError() {
      return storedError;
    },
    cancel() {
      done = true;
      storedPayload = null;
      storedMetadata = null;
      storedTransferables = [];
    },
    isDone() {
      return done;
    },
  };
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

  const revisionCandidates = [
    payload.voxelRevision,
    payload.voxelVersion,
    payload.revision,
    payload.version,
    payload.tick,
    payload.expectedRevision,
    payload.expectedTick,
    payload.targetRevision,
  ];
  for (let i = 0; i < revisionCandidates.length; i += 1) {
    const value = toFiniteNumber(revisionCandidates[i]);
    if (value !== null) {
      normalized.voxelRevision = value;
      break;
    }
  }

  const voxelSources = extractVoxelSourceDescriptor(payload);
  if (voxelSources && hasVoxelSourceData(voxelSources)) {
    normalized.voxelSources = voxelSources;
    if (normalized.voxelRevision === undefined || normalized.voxelRevision === null) {
      const candidateRevision = toFiniteNumber(voxelSources.revision);
      if (candidateRevision !== null) {
        normalized.voxelRevision = candidateRevision;
      }
    }
  }

  return normalized;
};

const createPrebakedVoxelBuilder = (options = {}, descriptor = null) => {
  let done = false;
  let payload = null;
  let errorInfo = null;

  const finalizePayload = () => {
    if (done && payload !== null) {
      return;
    }
    done = true;
    try {
      const transferables = new Set();
      if (descriptor?.transferables instanceof Set) {
        descriptor.transferables.forEach((entry) => registerTransferable(entry, transferables));
      } else if (Array.isArray(descriptor?.transferables)) {
        descriptor.transferables.forEach((entry) => registerTransferable(entry, transferables));
      }

      let basePayload = null;
      if (descriptor?.payload && typeof descriptor.payload === 'object') {
        basePayload = { ...descriptor.payload };
      } else {
        basePayload = {
          chunkX: Number.isFinite(options.chunkX) ? options.chunkX : 0,
          chunkZ: Number.isFinite(options.chunkZ) ? options.chunkZ : 0,
          detailLevel: options.detailLevel ?? 'core',
          worldOptions: ensurePlainObject(options.worldOptions),
        };
      }

      if (descriptor?.metadata && typeof descriptor.metadata === 'object') {
        basePayload.metadata = descriptor.metadata;
      }

      const resolvedRevision =
        toFiniteNumber(descriptor?.revision) ??
        toFiniteNumber(descriptor?.payload?.voxelRevision) ??
        toFiniteNumber(descriptor?.payload?.revision) ??
        toFiniteNumber(descriptor?.metadata?.voxelRevision) ??
        toFiniteNumber(descriptor?.metadata?.revision);
      if (resolvedRevision !== null && basePayload.voxelRevision === undefined) {
        basePayload.voxelRevision = resolvedRevision;
      }
      if (
        (basePayload.voxelRevision === undefined || basePayload.voxelRevision === null) &&
        toFiniteNumber(options?.voxelRevision) !== null
      ) {
        basePayload.voxelRevision = toFiniteNumber(options.voxelRevision);
      }

      if (
        descriptor?.snapshot ||
        (Array.isArray(descriptor?.journals) && descriptor.journals.length > 0)
      ) {
        const persistencePayload = {
          snapshot: descriptor.snapshot ?? null,
          journals: Array.isArray(descriptor.journals)
            ? descriptor.journals.map((entry) => entry)
            : [],
        };
        if (descriptor.metadata && typeof descriptor.metadata === 'object') {
          persistencePayload.metadata = descriptor.metadata;
        }
        basePayload.persistence = persistencePayload;
        basePayload.voxelState = persistencePayload;
        if (descriptor.snapshot) {
          registerTransferable(descriptor.snapshot, transferables);
        }
        if (Array.isArray(descriptor.journals)) {
          descriptor.journals.forEach((entry) => registerTransferable(entry, transferables));
        }
      }

      if (Array.isArray(descriptor?.buffers) && descriptor.buffers.length > 0) {
        basePayload.buffers = descriptor.buffers.map((entry) => entry);
        descriptor.buffers.forEach((entry) => registerTransferable(entry, transferables));
      }

      const manualTransfers = Array.from(transferables).filter(Boolean);
      if (manualTransfers.length > 0) {
        const existing = Array.isArray(basePayload.payloadTransferables)
          ? basePayload.payloadTransferables.filter(Boolean)
          : [];
        basePayload.payloadTransferables = existing.concat(manualTransfers);
      }

      guardLatestVoxelRevision(basePayload, options, descriptor ?? {});

      payload = basePayload;
    } catch (error) {
      errorInfo = serializeError(error);
      payload = null;
    }
  };

  return {
    step() {
      if (!done) {
        finalizePayload();
      }
      return { processed: 0, done: true };
    },
    takePayload() {
      finalizePayload();
      const result = payload;
      payload = null;
      return result;
    },
    takeError() {
      const error = errorInfo;
      errorInfo = null;
      return error;
    },
    cancel() {
      done = true;
      payload = null;
    },
    isDone() {
      return done;
    },
  };
};

const createBuilder = (options = {}) => {
  if (hasVoxelSourceData(options?.voxelSources)) {
    return createPrebakedVoxelBuilder(options, options.voxelSources);
  }
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
      const taskOptions = {
        chunkX: Number.isFinite(options.chunkX) ? options.chunkX : 0,
        chunkZ: Number.isFinite(options.chunkZ) ? options.chunkZ : 0,
        blockMaterials: options.blockMaterials,
        detailLevel: options.detailLevel ?? 'core',
        requireWorkerPayload: true,
      };
      if (options.includeBlockPlacements !== undefined) {
        taskOptions.includeBlockPlacementsInPayload = Boolean(
          options.includeBlockPlacements,
        );
      }
      task = createChunkBuildTask(taskOptions);
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

const startBuilderForKey = (
  key,
  normalizedOptions = {},
  persistenceInfo = null,
) => {
  if (!key) {
    return;
  }
  pendingStartRecords.delete(key);
  const info =
    persistenceInfo ?? {
      state: 'ready',
      shouldBypass: false,
      payload: null,
      metadata: null,
      transferables: [],
      error: null,
      promise: null,
    };
  const infoVoxelSources = hasVoxelSourceData(info?.voxelSources)
    ? info.voxelSources
    : null;
  const optionVoxelSources = hasVoxelSourceData(normalizedOptions?.voxelSources)
    ? normalizedOptions.voxelSources
    : null;
  const combinedVoxelSources = infoVoxelSources || optionVoxelSources;

  const effectiveOptions = { ...normalizedOptions };
  if (
    (effectiveOptions.voxelRevision === undefined ||
      effectiveOptions.voxelRevision === null) &&
    combinedVoxelSources
  ) {
    const candidateRevision =
      toFiniteNumber(combinedVoxelSources?.revision) ??
      toFiniteNumber(combinedVoxelSources?.expectedRevision);
    if (candidateRevision !== null) {
      effectiveOptions.voxelRevision = candidateRevision;
    }
  }
  if (combinedVoxelSources && !effectiveOptions.voxelSources) {
    effectiveOptions.voxelSources = combinedVoxelSources;
  }

  const builder = info.shouldBypass
    ? createPersistenceBuilder({
        payload: info.payload,
        metadata: info.metadata,
        transferables: info.transferables,
        error: info.error,
      })
    : hasVoxelSourceData(combinedVoxelSources)
    ? createPrebakedVoxelBuilder(effectiveOptions, combinedVoxelSources)
    : createBuilder(effectiveOptions);
  if (info.error && builder && !builder.__persistenceError) {
    builder.__persistenceError = info.error;
  }
  builders.set(key, builder);
  activeBuilderKeys.add(key);
};

const settleStartFailure = (key, error) => {
  builders.delete(key);
  activeBuilderKeys.delete(key);
  pendingStartRecords.delete(key);
  if (!key) {
    return;
  }
  postFromWorker({
    key,
    processed: 0,
    done: true,
    error: serializeError(error),
  });
};

const handleStartMessage = (message) => {
  const { key, payload, persistence } = message ?? {};
  if (!key) {
    return;
  }
  const existing = builders.get(key);
  if (existing) {
    existing.cancel();
    builders.delete(key);
    activeBuilderKeys.delete(key);
  }
  const pendingRecord = pendingStartRecords.get(key);
  if (pendingRecord) {
    pendingRecord.cancelled = true;
    pendingStartRecords.delete(key);
  }
  try {
    const payloadPersistence = payload?.persistence;
    const sanitizedPayload =
      payload && typeof payload === 'object'
        ? { ...payload, persistence: undefined }
        : payload;
    const normalizedOptions = normalizeStartOptions(sanitizedPayload ?? {});
    const persistenceInfo = normalizePersistenceStartInfo(
      persistence ?? payloadPersistence ?? null,
    );
    if (persistenceInfo.promise && !persistenceInfo.shouldBypass) {
      const record = {
        normalizedOptions,
        cancelled: false,
      };
      pendingStartRecords.set(key, record);
      const resolveWithResult = (result) => {
        const current = pendingStartRecords.get(key);
        if (current !== record || current?.cancelled) {
          return;
        }
        let resolvedInfo = null;
        try {
          const candidate =
            result &&
            typeof result === 'object' &&
            (Object.prototype.hasOwnProperty.call(result, 'state') ||
              Object.prototype.hasOwnProperty.call(result, 'status') ||
              Object.prototype.hasOwnProperty.call(result, 'result') ||
              Object.prototype.hasOwnProperty.call(result, 'payload') ||
              Object.prototype.hasOwnProperty.call(result, 'metadata'))
              ? result
              : { state: 'ready', result };
          resolvedInfo = normalizePersistenceStartInfo(candidate);
        } catch (error) {
          settleStartFailure(key, error);
          return;
        }
        try {
          startBuilderForKey(key, normalizedOptions, resolvedInfo);
        } catch (error) {
          settleStartFailure(key, error);
        }
      };

      Promise.resolve(persistenceInfo.promise)
        .then((result) => {
          resolveWithResult(result);
        })
        .catch((error) => {
          const current = pendingStartRecords.get(key);
          if (current !== record || current?.cancelled) {
            return;
          }
          const fallbackInfo = {
            state: 'failed',
            shouldBypass: false,
            payload: null,
            metadata: null,
            transferables: [],
            error: serializeError(error),
            promise: null,
          };
          try {
            startBuilderForKey(key, normalizedOptions, fallbackInfo);
          } catch (startError) {
            settleStartFailure(key, startError);
          }
        })
        .finally(() => {
          const current = pendingStartRecords.get(key);
          if (current === record) {
            pendingStartRecords.delete(key);
          }
        });
      return;
    }

    startBuilderForKey(key, normalizedOptions, persistenceInfo);
  } catch (error) {
    settleStartFailure(key, error);
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
    let persistenceError = null;
    if (builder && builder.__persistenceError) {
      persistenceError = builder.__persistenceError;
      builder.__persistenceError = null;
    }
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
    } else if (persistenceError) {
      response.error = persistenceError;
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
  const pendingRecord = pendingStartRecords.get(key);
  if (pendingRecord) {
    pendingRecord.cancelled = true;
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

