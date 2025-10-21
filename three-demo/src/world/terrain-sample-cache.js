const DEFAULT_MAX_ENTRIES = 200000;
const ACTIVE_CHUNK_SAMPLE_BUDGET = DEFAULT_MAX_ENTRIES;

const cache = new Map();
let maxEntries = DEFAULT_MAX_ENTRIES;
let cacheHits = 0;
let cacheMisses = 0;

const chunkProfiles = [];

const isDevBuild = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.DEV);

const normalizeCoordinate = (value) => {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return Math.floor(value);
};

const makeKey = (x, z) => {
  const nx = normalizeCoordinate(x);
  const nz = normalizeCoordinate(z);
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
    return null;
  }
  return `${nx}|${nz}`;
};

const parseKey = (key) => {
  if (typeof key !== 'string') {
    return null;
  }
  const [xStr, zStr] = key.split('|');
  if (xStr === undefined || zStr === undefined) {
    return null;
  }
  const x = Number.parseInt(xStr, 10);
  const z = Number.parseInt(zStr, 10);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  return { x, z };
};

const enforceLimit = () => {
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
    cache.clear();
    return;
  }
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
};

export const getTerrainSampleCacheStats = () => {
  const totalRequests = cacheHits + cacheMisses;
  const hitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;
  return {
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate,
  };
};

export const setTerrainSampleCacheLimit = (limit) => {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    maxEntries = 0;
  } else {
    const nextLimit = Math.floor(numeric);
    if (nextLimit > ACTIVE_CHUNK_SAMPLE_BUDGET) {
      console.warn(
        '[terrain-cache] cache limit exceeds active chunk budget',
        {
          limit: nextLimit,
          budget: ACTIVE_CHUNK_SAMPLE_BUDGET,
        },
      );
    }
    maxEntries = nextLimit;
  }
  enforceLimit();
  return maxEntries;
};

export const primeTerrainSample = (x, z, sample) => {
  const key = makeKey(x, z);
  if (!key) {
    return false;
  }
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, sample ?? null);
  enforceLimit();
  return true;
};

export const sampleColumnWithCache = (x, z, sampler) => {
  const key = makeKey(x, z);
  if (!key) {
    return null;
  }
  if (cache.has(key)) {
    cacheHits += 1;
    const cached = cache.get(key);
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  cacheMisses += 1;
  const sample = typeof sampler === 'function' ? sampler(x, z) : null;
  cache.set(key, sample ?? null);
  enforceLimit();
  return sample ?? null;
};

const normalizeBounds = ({ minX, maxX, minZ, maxZ }) => {
  const normalizedMinX = normalizeCoordinate(minX);
  const normalizedMaxX = normalizeCoordinate(maxX);
  const normalizedMinZ = normalizeCoordinate(minZ);
  const normalizedMaxZ = normalizeCoordinate(maxZ);
  if (
    !Number.isFinite(normalizedMinX) ||
    !Number.isFinite(normalizedMaxX) ||
    !Number.isFinite(normalizedMinZ) ||
    !Number.isFinite(normalizedMaxZ)
  ) {
    return null;
  }
  const minWorldX = Math.min(normalizedMinX, normalizedMaxX);
  const maxWorldX = Math.max(normalizedMinX, normalizedMaxX);
  const minWorldZ = Math.min(normalizedMinZ, normalizedMaxZ);
  const maxWorldZ = Math.max(normalizedMinZ, normalizedMaxZ);
  return {
    minX: minWorldX,
    maxX: maxWorldX,
    minZ: minWorldZ,
    maxZ: maxWorldZ,
  };
};

export const invalidateTerrainSampleRange = ({
  minX,
  maxX,
  minZ,
  maxZ,
}) => {
  const bounds = normalizeBounds({ minX, maxX, minZ, maxZ });
  if (!bounds) {
    return 0;
  }
  let removed = 0;
  cache.forEach((value, key) => {
    const coords = parseKey(key);
    if (!coords) {
      cache.delete(key);
      removed += 1;
      return;
    }
    if (
      coords.x >= bounds.minX &&
      coords.x <= bounds.maxX &&
      coords.z >= bounds.minZ &&
      coords.z <= bounds.maxZ
    ) {
      cache.delete(key);
      removed += 1;
    }
  });
  return removed;
};

export const pruneTerrainSampleCacheOutsideBounds = ({
  minX,
  maxX,
  minZ,
  maxZ,
}) => {
  const bounds = normalizeBounds({ minX, maxX, minZ, maxZ });
  if (!bounds) {
    return 0;
  }
  let removed = 0;
  cache.forEach((value, key) => {
    const coords = parseKey(key);
    if (!coords) {
      cache.delete(key);
      removed += 1;
      return;
    }
    if (
      coords.x < bounds.minX ||
      coords.x > bounds.maxX ||
      coords.z < bounds.minZ ||
      coords.z > bounds.maxZ
    ) {
      cache.delete(key);
      removed += 1;
    }
  });
  return removed;
};

export const pruneTerrainSampleCache = ({ maxEntries: limit } = {}) => {
  if (limit !== undefined) {
    setTerrainSampleCacheLimit(limit);
  } else {
    enforceLimit();
  }
  return cache.size;
};

const chunkWorldMin = (chunk, chunkSize) => chunk * chunkSize - chunkSize / 2;
const chunkWorldMax = (chunk, chunkSize) => chunkWorldMin(chunk, chunkSize) + chunkSize - 1;

export const invalidateTerrainSamplesForChunk = ({
  chunkX,
  chunkZ,
  chunkSize,
  padding = 0,
}) => {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    return 0;
  }
  const minX = chunkWorldMin(chunkX, chunkSize) - padding;
  const maxX = chunkWorldMax(chunkX, chunkSize) + padding;
  const minZ = chunkWorldMin(chunkZ, chunkSize) - padding;
  const maxZ = chunkWorldMax(chunkZ, chunkSize) + padding;
  return invalidateTerrainSampleRange({ minX, maxX, minZ, maxZ });
};

export const releaseTerrainSamplesForChunk = (
  chunkX,
  chunkZ,
  { chunkSize, padding = 0 } = {},
) => {
  const normalizedChunkSize = Number.isFinite(chunkSize)
    ? Math.max(1, Math.floor(chunkSize))
    : null;
  if (!normalizedChunkSize) {
    return 0;
  }
  const normalizedPadding = Number.isFinite(padding)
    ? Math.max(0, Math.floor(padding))
    : 0;
  return invalidateTerrainSamplesForChunk({
    chunkX,
    chunkZ,
    chunkSize: normalizedChunkSize,
    padding: normalizedPadding,
  });
};

export const pruneTerrainSampleCacheOutsideRadius = ({
  centerChunkX,
  centerChunkZ,
  chunkRadius,
  chunkSize,
}) => {
  if (
    !Number.isFinite(centerChunkX) ||
    !Number.isFinite(centerChunkZ) ||
    !Number.isFinite(chunkRadius) ||
    chunkRadius < 0 ||
    !Number.isFinite(chunkSize) ||
    chunkSize <= 0
  ) {
    return 0;
  }
  const minChunkX = centerChunkX - chunkRadius;
  const maxChunkX = centerChunkX + chunkRadius;
  const minChunkZ = centerChunkZ - chunkRadius;
  const maxChunkZ = centerChunkZ + chunkRadius;
  const minX = chunkWorldMin(minChunkX, chunkSize);
  const maxX = chunkWorldMax(maxChunkX, chunkSize);
  const minZ = chunkWorldMin(minChunkZ, chunkSize);
  const maxZ = chunkWorldMax(maxChunkZ, chunkSize);
  return pruneTerrainSampleCacheOutsideBounds({ minX, maxX, minZ, maxZ });
};

export const clearTerrainSampleCache = () => {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  chunkProfiles.length = 0;
};

export const recordChunkSamplingProfile = ({
  chunkX,
  chunkZ,
  hitsBefore,
  missesBefore,
  hitsAfter,
  missesAfter,
}) => {
  const hitDelta = hitsAfter - hitsBefore;
  const missDelta = missesAfter - missesBefore;
  const entry = {
    chunkX,
    chunkZ,
    hitDelta,
    missDelta,
    hits: hitsAfter,
    misses: missesAfter,
    timestamp: Date.now(),
  };
  chunkProfiles.push(entry);
  const previous = chunkProfiles[chunkProfiles.length - 2];
  if (previous && isDevBuild) {
    const adjacent =
      Math.abs(previous.chunkX - chunkX) <= 1 &&
      Math.abs(previous.chunkZ - chunkZ) <= 1;
    if (adjacent) {
      console.debug('[terrain-cache] chunk sampling profile', {
        current: entry,
        previous,
      });
      console.assert(
        hitDelta >= previous.hitDelta,
        '[terrain-cache] expected cache hits to increase when traversing adjacent chunks',
        {
          current: entry,
          previous,
        },
      );
    }
  }
  return entry;
};

export const getRecentChunkSamplingProfiles = () => chunkProfiles.slice(-8);
