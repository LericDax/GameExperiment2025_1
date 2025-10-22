import { createTerrainEngine } from './terrain-engine.js';
import {
  configureVoxelObjectPlacement,
  populateColumnWithVoxelObjects,
} from './voxel-object-placement.js';
import {
  createFluidSurface,
  isFluidType,
  resolveFluidPresence,
} from './fluids/fluid-registry.js';
import { buildFluidGeometry } from './fluids/fluid-geometry.js';
import { buildLumenRibbonGeometry } from './fluids/lumen-ribbon-geometry.js';
import {
  initializeFluidDebug,
  logFluidDebug,
} from './fluids/fluid-debug.js';
import {
  cloneDecorationOptions,
  createDecorationMeshBatches,
} from './voxel-object-decoration-mesh.js';
import {
  serializeInstancedEntry,
  deserializeInstancedEntry,
} from './chunk-payload-serializers.js';
import {
  chunkWorldBounds,
  MAX_OCCUPANCY_COORDINATE_SNAPSHOT,
} from './chunk-build-core.js';
import { buildChunkPayload } from './world/chunk-build-core.js';
import { finalizeChunkMeshes } from './finalize-chunk-meshes.js';
import { deriveCollisionKeySetsFromMesh } from './collision-key-utils.js';
import { pruneOccludedInstancedEntries } from './instanced-occlusion-utils.js';
import { resolveBiomeTintMultiplier } from './color-utils.js';
import { worldOptions, applyWorldOptions } from './world-settings.js';
import { configureSectorObjectPlanner } from './sector-object-planner.js';
import { isBlockOccluding } from './block-occlusion.js';
import {
  sampleColumnWithCache,
  getTerrainSampleCacheStats,
  recordChunkSamplingProfile,
  primeTerrainSample,
  releaseTerrainSamplesForChunk,
  clearTerrainSampleCache,
} from './terrain-sample-cache.js';
export { worldOptions, getWorldOptions, applyWorldOptions } from './world-settings.js';
export { isBlockOccluding } from './block-occlusion.js';

const MESHING_MODE_STORAGE_KEY = 'voxelMeshingMode';

const normalizeMeshingMode = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['legacy', 'old', 'classic', 'cubes'].includes(normalized)) {
    return 'legacy';
  }
  if (['compare', 'both', 'debug'].includes(normalized)) {
    return 'compare';
  }
  if (['greedy', 'new', 'modern', 'default'].includes(normalized)) {
    return 'greedy';
  }
  return null;
};

let meshingDebugMode = 'greedy';

const persistMeshingMode = (mode) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(MESHING_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('[browser] [meshing debug] failed to persist meshing mode', error);
  }
};

const resolveMeshingModeFromQuery = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('meshing')) {
      return null;
    }
    return normalizeMeshingMode(params.get('meshing'));
  } catch (error) {
    console.warn('[browser] [meshing debug] failed to resolve query mode', error);
    return null;
  }
};

const resolveMeshingModeFromStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage?.getItem(MESHING_MODE_STORAGE_KEY);
    return normalizeMeshingMode(stored);
  } catch (error) {
    console.warn('[browser] [meshing debug] failed to resolve stored mode', error);
    return null;
  }
};

export const getMeshingDebugMode = () => meshingDebugMode;

export const isLegacyMeshingEnabled = () => meshingDebugMode === 'legacy';

export const setMeshingDebugMode = (mode, { persist = true } = {}) => {
  const normalized = normalizeMeshingMode(mode) ?? 'greedy';
  meshingDebugMode = normalized;
  if (persist) {
    persistMeshingMode(normalized);
  }
  return meshingDebugMode;
};

export const initializeMeshingDebug = ({
  defaultMode = 'greedy',
  persistDefault = false,
  forceDefault = false,
} = {}) => {
  const fromQuery = resolveMeshingModeFromQuery();
  if (fromQuery) {
    return setMeshingDebugMode(fromQuery, { persist: false });
  }

  if (!forceDefault) {
    const fromStorage = resolveMeshingModeFromStorage();
    if (fromStorage) {
      return setMeshingDebugMode(fromStorage, { persist: false });
    }
  }

  return setMeshingDebugMode(defaultMode, { persist: persistDefault });
};

export const makeBlockKey = (x, y, z) =>
  `${Math.round(x)}|${Math.round(y)}|${Math.round(z)}`;

export const sanitizePrototypeInstanceRecordForLowDetail = (record) => {
  if (!record) {
    return null;
  }
  const sourceEntries = Array.isArray(record.blockEntries)
    ? record.blockEntries
    : [];
  const sanitizedEntries = [];
  sourceEntries.forEach((entryRecord) => {
    if (!entryRecord) {
      return;
    }
    const entry = entryRecord.entry ?? null;
    const coordinateKey = (() => {
      if (entryRecord.coordinateKey) {
        return entryRecord.coordinateKey;
      }
      if (entry?.coordinateKey) {
        return entry.coordinateKey;
      }
      if (entry?.position) {
        const { x = 0, y = 0, z = 0 } = entry.position;
        return makeBlockKey(x, y, z);
      }
      return null;
    })();
    const sanitized = {
      type: entryRecord.type ?? entry?.type ?? null,
      entryKey:
        entryRecord.entryKey ?? entry?.key ?? coordinateKey ?? null,
    };
    if (coordinateKey) {
      sanitized.coordinateKey = coordinateKey;
    }
    if (entryRecord.entryPayload) {
      sanitized.entryPayload = entryRecord.entryPayload;
    }
    sanitizedEntries.push(sanitized);
  });
  const sanitizedDecorationKeys = Array.isArray(record.decorationKeys)
    ? record.decorationKeys
        .map((value) =>
          value === null || value === undefined ? null : String(value),
        )
        .filter(Boolean)
    : [];
  record.blockEntries = sanitizedEntries;
  record.decorationKeys = sanitizedDecorationKeys;
  return record;
};

let sharedBlockGeometry = null;

export const ensureBlockGeometry = (THREE) => {
  if (!sharedBlockGeometry) {
    sharedBlockGeometry = new THREE.BoxGeometry(1, 1, 1);
  }
  return sharedBlockGeometry;
};

export const buildInstancedBlockMesh = ({
  THREE,
  blockMaterials,
  type,
  entries = [],
  capacity,
}) => {
  const instanceCapacity = Math.max(
    1,
    Number.isInteger(capacity) && capacity > 0
      ? capacity
      : Array.isArray(entries)
      ? entries.length
      : 0,
  );
  const geometry = ensureBlockGeometry(THREE).clone();
  const mesh = new THREE.InstancedMesh(
    geometry,
    blockMaterials[type],
    instanceCapacity,
  );
  mesh.userData.defaultTint = new THREE.Color(1, 1, 1);

  const entryCount = Array.isArray(entries) ? entries.length : 0;
  const tintArray = new Float32Array(instanceCapacity * 3);
  const tintAttribute = new THREE.InstancedBufferAttribute(tintArray, 3);
  tintAttribute.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('biomeTint', tintAttribute);

  for (let index = 0; index < entryCount; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    mesh.setMatrixAt(index, entry.matrix);
    entry.index = index;
    const tint = entry.tintColor ?? mesh.userData.defaultTint;
    const offset = index * 3;
    tintAttribute.array[offset] = tint.r;
    tintAttribute.array[offset + 1] = tint.g;
    tintAttribute.array[offset + 2] = tint.b;
    entry.mesh = mesh;
    entry.tintAttribute = tintAttribute;
  }

  mesh.count = entryCount;
  mesh.instanceMatrix.needsUpdate = entryCount > 0;
  tintAttribute.needsUpdate = entryCount > 0;
  mesh.castShadow = ['cloud', 'water'].includes(type) ? false : true;
  mesh.receiveShadow = type !== 'cloud';
  mesh.frustumCulled = false;
  mesh.userData.type = type;
  mesh.userData.biomePalette = true;
  mesh.userData.biomeTintAttribute = tintAttribute;
  mesh.userData.capacity = instanceCapacity;

  return { mesh, tintAttribute };
};

initializeFluidDebug({ defaultEnabled: false, persistDefault: true, forceDefault: true });

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

let THREERef = null;
let terrainEngine = null;
let worldSeedHash = worldOptions.seedHash >>> 0;

function ensureThree() {
  if (!THREERef) {
    throw new Error('World generation requires initialization with a THREE instance');
  }
  return THREERef;
}

function ensureTerrainEngine() {
  if (!terrainEngine) {
    throw new Error('World generation requires the terrain engine to be initialized');
  }
  return terrainEngine;
}

function disposeTerrainEngineInstance(instance) {
  if (!instance) {
    return;
  }
  instance.dispose?.();
  instance.biomeEngine?.dispose?.();
}

export function initializeWorldGeneration({ THREE, worldOptions: overrides } = {}) {
  if (!THREE) {
    throw new Error('initializeWorldGeneration requires a THREE instance');
  }

  THREERef = THREE;

  if (overrides) {
    applyWorldOptions(overrides);
  }

  clearTerrainSampleCache();

  worldSeedHash = worldOptions.seedHash >>> 0;

  if (terrainEngine) {
    disposeTerrainEngineInstance(terrainEngine);
  }

  initializeMeshingDebug({ defaultMode: 'greedy', persistDefault: true, forceDefault: false });
  terrainEngine = createTerrainEngine({
    THREE,
    seed: worldSeedHash,
    worldConfig: worldOptions,
  });
  configureVoxelObjectPlacement({ seedHash: worldSeedHash });
  configureSectorObjectPlanner({ seedHash: worldSeedHash });
}

export function terrainHeight(x, z) {
  const engine = ensureTerrainEngine();
  const sample = engine.sampleColumn(x, z);
  const clampRange =
    worldOptions.terrain?.clamp ?? { min: 2, max: worldOptions.maxHeight };
  const minHeight = clampRange.min ?? 2;
  const maxHeight = clampRange.max ?? worldOptions.maxHeight;
  return Math.floor(clamp(sample.height, minHeight, maxHeight));
}

export function sampleBiomeAt(x, z) {
  const engine = ensureTerrainEngine();
  return engine.getBiomeAt(x, z);
}

export function getRegisteredBiomes() {
  const engine = ensureTerrainEngine();
  const biomeEngine = engine.biomeEngine;
  if (!biomeEngine || !Array.isArray(biomeEngine.biomes)) {
    return [];
  }
  return biomeEngine.biomes.map((biome) => ({
    id: biome.id,
    label: biome.label,
    tags: Array.isArray(biome.tags) ? [...biome.tags] : [],
  }));
}

function hashCoordinate(x, z, offset = 0, seed = worldSeedHash) {
  const seedLow = seed & 0xffff;
  const seedHigh = (seed >>> 16) & 0xffff;
  let h = Math.imul((x | 0) ^ (seedLow || 1), 374761393);
  h = Math.imul(h + Math.imul((z | 0) ^ (seedHigh || 1), 668265263), 1274126177);
  h ^= h >>> 15;
  const seedMix = ((seed >>> 1) | 1) & 0x7fffffff;
  h = Math.imul(h + Math.imul((offset | 0) ^ seedMix, 1597334677), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h ^ seed, 3266489917);
  h ^= h >>> 16;
  return h >>> 0;
}

export function randomAt(x, z, offset = 0) {
  const hashed = hashCoordinate(
    Math.floor(x),
    Math.floor(z),
    Math.floor(offset),
    worldSeedHash,
  );
  return hashed / 4294967296;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function sampleBiomeCoverage({
  biomeId,
  sampleCount = 4096,
  radius = 2048,
  centerX = 0,
  centerZ = 0,
} = {}) {
  if (!biomeId) {
    throw new Error('sampleBiomeCoverage requires a biomeId to evaluate.');
  }

  const engine = ensureTerrainEngine();
  const targetId = String(biomeId);
  const requestedSamples = Math.max(1, Math.floor(sampleCount));
  const effectiveRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const originX = Number.isFinite(centerX) ? centerX : 0;
  const originZ = Number.isFinite(centerZ) ? centerZ : 0;

  let matches = 0;
  let validSamples = 0;
  const counts = new Map();

  for (let index = 0; index < requestedSamples; index += 1) {
    const progress = (index + 0.5) / requestedSamples;
    const distance = Math.sqrt(progress) * effectiveRadius;
    const angle = index * GOLDEN_ANGLE;
    const sampleX = Math.round(originX + Math.cos(angle) * distance);
    const sampleZ = Math.round(originZ + Math.sin(angle) * distance);
    const sample = engine.getBiomeAt(sampleX, sampleZ);
    const biome = sample?.biome ?? null;
    if (!biome?.id) {
      continue;
    }
    validSamples += 1;
    const id = String(biome.id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (id === targetId) {
      matches += 1;
    }
  }

  const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const coverage = validSamples > 0 ? matches / validSamples : 0;

  return {
    biomeId: targetId,
    matches,
    samples: validSamples,
    requestedSamples,
    coverage,
    radius: effectiveRadius,
    center: { x: originX, z: originZ },
    counts: sortedCounts.map(([id, count]) => ({
      id,
      count,
      share: validSamples > 0 ? count / validSamples : 0,
    })),
  };
}

const solidTypes = new Set(['grass', 'dirt', 'stone', 'sand', 'leaf', 'log', 'snow']);

function addCloud(addBlock, x, y, z) {
  const blocks = [
    [0, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 1],
    [-1, 0, -1],
  ];
  blocks.forEach(([dx, dy, dz]) => addBlock('cloud', x + dx, y + dy, z + dz, null));
}

const DETAIL_LEVEL_CORE = 'core';
const DETAIL_LEVEL_RETENTION = 'retention';
const DETAIL_LEVEL_SCOUT = 'scout';

const normalizeDetailMode = (detailLevel) => {
  if (detailLevel === DETAIL_LEVEL_SCOUT) {
    return DETAIL_LEVEL_SCOUT;
  }
  if (detailLevel === DETAIL_LEVEL_RETENTION) {
    return DETAIL_LEVEL_RETENTION;
  }
  return DETAIL_LEVEL_CORE;
};

const sanitizeSerializableForWorker = (value, seen = new WeakSet()) => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value ?? null;
  }

  if (typeof value === 'function') {
    return undefined;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
  }

  if (ArrayBuffer.isView(value)) {
    if (typeof value.slice === 'function') {
      return value.slice();
    }
    return new value.constructor(value);
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  if (Array.isArray(value)) {
    const result = [];
    value.forEach((entry) => {
      const sanitized = sanitizeSerializableForWorker(entry, seen);
      if (sanitized !== undefined) {
        result.push(sanitized);
      }
    });
    return result;
  }

  if (value instanceof Map) {
    const map = new Map();
    value.forEach((entry, key) => {
      const sanitized = sanitizeSerializableForWorker(entry, seen);
      if (sanitized !== undefined) {
        map.set(key, sanitized);
      }
    });
    return map;
  }

  if (value instanceof Set) {
    const set = new Set();
    value.forEach((entry) => {
      const sanitized = sanitizeSerializableForWorker(entry, seen);
      if (sanitized !== undefined) {
        set.add(sanitized);
      }
    });
    return set;
  }

  if (value?.isColor) {
    return {
      r: Number.isFinite(value.r) ? value.r : 0,
      g: Number.isFinite(value.g) ? value.g : 0,
      b: Number.isFinite(value.b) ? value.b : 0,
    };
  }

  if (value?.isVector3) {
    return {
      x: Number.isFinite(value.x) ? value.x : 0,
      y: Number.isFinite(value.y) ? value.y : 0,
      z: Number.isFinite(value.z) ? value.z : 0,
    };
  }

  if (value?.isEuler) {
    return {
      x: Number.isFinite(value.x) ? value.x : 0,
      y: Number.isFinite(value.y) ? value.y : 0,
      z: Number.isFinite(value.z) ? value.z : 0,
      order: typeof value.order === 'string' ? value.order : 'XYZ',
    };
  }

  if (value?.isQuaternion) {
    return {
      x: Number.isFinite(value.x) ? value.x : 0,
      y: Number.isFinite(value.y) ? value.y : 0,
      z: Number.isFinite(value.z) ? value.z : 0,
      w: Number.isFinite(value.w) ? value.w : 1,
    };
  }

  if (value?.isMatrix4 && typeof value.toArray === 'function') {
    const elements = new Array(16).fill(0);
    value.toArray(elements, 0);
    return { elements };
  }

  if (value?.isMesh || value?.isObject3D) {
    const userData = sanitizeSerializableForWorker(value.userData ?? {}, seen);
    const payload = {
      type: typeof value.type === 'string' ? value.type : 'Object3D',
    };
    if (typeof value.name === 'string' && value.name.length > 0) {
      payload.name = value.name;
    }
    if (userData && typeof userData === 'object') {
      payload.userData = userData;
    }
    return payload;
  }

  const result = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === 'function') {
      return;
    }
    const sanitized = sanitizeSerializableForWorker(entry, seen);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  });
  return result;
};

const DEFAULT_WORKER_BLOCK_MATERIAL = Object.freeze({
  transparent: false,
  opacity: 1,
  depthWrite: true,
  userData: {},
});

const sanitizeWorldOptionsForWorker = (options = worldOptions) => {
  if (!options || typeof options !== 'object') {
    return {};
  }
  return sanitizeSerializableForWorker(options);
};

const sanitizeBlockMaterialRecordForWorker = (material = null) => {
  const transparent = material?.transparent === true;
  const depthWrite = material?.depthWrite !== false;
  const opacity = Number.isFinite(material?.opacity) ? material.opacity : 1;
  const userData = sanitizeSerializableForWorker(material?.userData ?? {});
  const normalizedUserData =
    userData && typeof userData === 'object' ? userData : {};
  return {
    transparent,
    opacity,
    depthWrite,
    userData: normalizedUserData,
  };
};

const sanitizeBlockMaterialsForWorker = (materials) => {
  const sanitized = {
    __defaults: sanitizeBlockMaterialRecordForWorker(
      DEFAULT_WORKER_BLOCK_MATERIAL,
    ),
  };
  if (!materials || typeof materials !== 'object') {
    return sanitized;
  }

  const registerEntry = (key, material) => {
    if (typeof key !== 'string' || key.length === 0) {
      return;
    }
    sanitized[key] = sanitizeBlockMaterialRecordForWorker(material);
  };

  if (materials instanceof Map) {
    materials.forEach((material, key) => {
      registerEntry(key, material);
    });
    return sanitized;
  }

  if (Array.isArray(materials)) {
    materials.forEach((material, index) => {
      registerEntry(String(index), material);
    });
    return sanitized;
  }

  Object.keys(materials).forEach((key) => {
    registerEntry(key, materials[key]);
  });

  return sanitized;
};

/**
 * Constructs a structured-clone-friendly payload that chunk workers can use
 * to initialize a build task. The payload includes spatial coordinates,
 * the requested detail level, and sanitized world configuration details such
 * as terrain parameters and seed values.
 *
 * @param {Object} params
 * @param {number} params.chunkX Chunk coordinate on the X axis.
 * @param {number} params.chunkZ Chunk coordinate on the Z axis.
 * @param {'core'|'retention'|'scout'} [params.detailLevel='core'] Requested detail level.
 * @param {Object} [params.worldOptions=worldOptions] Source world configuration.
 * @param {Object} [params.blockMaterials] Block material registry used for occlusion.
 * @param {Object} [params.engine] Optional precomputed engine payload for worker use.
 * @returns {{
 *   chunkX: number,
 *   chunkZ: number,
 *   detailLevel: 'core'|'retention'|'scout',
 *   worldOptions: Object,
 *   blockMaterials: Object,
 *   engine?: Object,
 * }} Plain worker payload schema.
 */
export function createChunkWorkerStartPayload({
  chunkX = 0,
  chunkZ = 0,
  detailLevel = DETAIL_LEVEL_CORE,
  worldOptions: optionsOverride = worldOptions,
  blockMaterials: blockMaterialsOverride = null,
  engine = null,
} = {}) {
  const payload = {
    chunkX: Number.isFinite(chunkX) ? chunkX : 0,
    chunkZ: Number.isFinite(chunkZ) ? chunkZ : 0,
    detailLevel: normalizeDetailMode(detailLevel),
    worldOptions: sanitizeWorldOptionsForWorker(optionsOverride),
    blockMaterials: sanitizeBlockMaterialsForWorker(blockMaterialsOverride),
  };
  if (engine) {
    payload.engine = sanitizeSerializableForWorker(engine);
  }
  return payload;
}

export function createChunkBuildTask({
  chunkX,
  chunkZ,
  blockMaterials,
  requireWorkerPayload = false,
  detailLevel = 'core',
  includeBlockPlacementsInPayload = requireWorkerPayload,
  scoutPreviewBuilder = null,
}) {
  const THREE = ensureThree();
  const engine = ensureTerrainEngine();
  let needsWorkerPayload = Boolean(requireWorkerPayload);
  const shouldSerializePlacementPayloads = () =>
    includeBlockPlacementsInPayload || needsWorkerPayload;
  const detailMode = normalizeDetailMode(detailLevel);
  const isLowDetail = detailMode !== DETAIL_LEVEL_CORE;
  const isScoutDetail = detailMode === DETAIL_LEVEL_SCOUT;
  const shouldRetainPrototypeEntries = detailMode === DETAIL_LEVEL_CORE;
  const instancedData = new Map();
  const decorationInstancedData = new Map();
  const decorationData = new Map();
  const decorationGroups = new Map();
  const decorationOwnerIndex = new Map();
  const decorationTypeIndex = new Map();
  const solidBlockKeys = new Set();
  const softBlockKeys = new Set();
  const waterColumnMetadata = new Map();
  const fluidColumnsByType = new Map();
  const fluidSurfaces = [];
  const typeCapacities = new Map();
  const fluidBlockKeys = new Set();
  const blockPlacements = [];
  const placementIndexByCoordinate = new Map();
  const typeIds = new Map();
  let nextTypeId = 1;
  let occupancyTypes = null;
  let occupancyPlacements = null;
  let minBoundX = Number.POSITIVE_INFINITY;
  let minBoundY = Number.POSITIVE_INFINITY;
  let minBoundZ = Number.POSITIVE_INFINITY;
  let maxBoundX = Number.NEGATIVE_INFINITY;
  let maxBoundY = Number.NEGATIVE_INFINITY;
  let maxBoundZ = Number.NEGATIVE_INFINITY;
  let hasBoundData = false;
  const matrix = new THREE.Matrix4();
  const defaultQuaternion = new THREE.Quaternion();
  const reusablePosition = new THREE.Vector3();
  const blockLookup = new Map();
  const typeData = new Map();
  const biomePresence = new Map();
  const prototypeInstances = new Map();
  let prototypeInstanceCounter = 0;
  let cachedBiomeSummary = null;

  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ, worldOptions);
  const configuredChunkSize = Number.isFinite(worldOptions?.chunkSize)
    ? worldOptions.chunkSize
    : 16;
  const chunkSize = Math.max(1, Math.floor(configuredChunkSize));
  const { waterLevel } = worldOptions;
  const chunkMinX = minX;
  const chunkMinZ = minZ;
  const chunkMaxX = chunkMinX + chunkSize - 1;
  const chunkMaxZ = chunkMinZ + chunkSize - 1;

  let sampledMinX = Number.POSITIVE_INFINITY;
  let sampledMaxX = Number.NEGATIVE_INFINITY;
  let sampledMinZ = Number.POSITIVE_INFINITY;
  let sampledMaxZ = Number.NEGATIVE_INFINITY;
  let hasSampleBounds = false;
  let terrainSamplesReleased = false;
  let chunkProfileRecorded = false;

  const totalColumns = Math.max(1, chunkSize * chunkSize);
  const scoutHeightMap = isScoutDetail ? new Int16Array(totalColumns) : null;
  const scoutBiomeIds = isScoutDetail
    ? Array(totalColumns).fill(null)
    : null;
  let scoutMinHeight = Number.POSITIVE_INFINITY;
  let scoutMaxHeight = Number.NEGATIVE_INFINITY;

  const terrainSampler = (x, z) => engine.sampleColumn(x, z);

  const trackSampleCoordinate = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return;
    }
    if (!hasSampleBounds) {
      hasSampleBounds = true;
    }
    if (x < sampledMinX) {
      sampledMinX = x;
    }
    if (x > sampledMaxX) {
      sampledMaxX = x;
    }
    if (z < sampledMinZ) {
      sampledMinZ = z;
    }
    if (z > sampledMaxZ) {
      sampledMaxZ = z;
    }
  };

  const computeSamplePadding = () => {
    if (!hasSampleBounds) {
      return 0;
    }
    const extraMinX = Math.max(0, chunkMinX - sampledMinX);
    const extraMaxX = Math.max(0, sampledMaxX - chunkMaxX);
    const extraMinZ = Math.max(0, chunkMinZ - sampledMinZ);
    const extraMaxZ = Math.max(0, sampledMaxZ - chunkMaxZ);
    const padding = Math.max(extraMinX, extraMaxX, extraMinZ, extraMaxZ);
    return Math.max(0, Math.ceil(padding));
  };

  const initialCacheStats = (() => {
    const stats = getTerrainSampleCacheStats();
    return { hits: stats.hits, misses: stats.misses };
  })();

  const recordFinalSamplingProfile = () => {
    if (chunkProfileRecorded) {
      return;
    }
    const finalCacheStats = getTerrainSampleCacheStats();
    recordChunkSamplingProfile({
      chunkX,
      chunkZ,
      hitsBefore: initialCacheStats.hits,
      missesBefore: initialCacheStats.misses,
      hitsAfter: finalCacheStats.hits,
      missesAfter: finalCacheStats.misses,
    });
    chunkProfileRecorded = true;
  };

  const ensureTerrainSamplesReleased = () => {
    if (terrainSamplesReleased) {
      return;
    }
    recordFinalSamplingProfile();
    const padding = computeSamplePadding();
    releaseTerrainSamplesForChunk(chunkX, chunkZ, {
      chunkSize,
      padding,
    });
    terrainSamplesReleased = true;
  };

  const sampleColumnCached = (x, z) => {
    trackSampleCoordinate(x, z);
    const sample = sampleColumnWithCache(x, z, terrainSampler);
    if (!sample || !Number.isFinite(sample.height)) {
      if (sample !== null) {
        console.error('[terrain] invalid height sample detected', {
          chunkX,
          chunkZ,
          columnX: x,
          columnZ: z,
          height: sample?.height ?? null,
        });
        primeTerrainSample(x, z, null);
      }
      return null;
    }
    return sample;
  };

  const getColumnHeight = (x, z) => {
    const sample = sampleColumnCached(x, z);
    if (!sample || !Number.isFinite(sample.height)) {
      return Number.NaN;
    }
    const clampRange =
      worldOptions.terrain?.clamp ?? { min: 2, max: worldOptions.maxHeight };
    const minHeight = clampRange.min ?? 2;
    const maxHeight = clampRange.max ?? worldOptions.maxHeight;
    return Math.floor(clamp(sample.height, minHeight, maxHeight));
  };

  const computeSlope = (x, z, baseHeight) => {
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ];
    let maxDifference = 0;
    for (const [dx, dz] of offsets) {
      const neighborHeight = getColumnHeight(x + dx, z + dz);
      const difference = Math.abs(baseHeight - neighborHeight);
      if (difference > maxDifference) {
        maxDifference = difference;
      }
    }
    return clamp(maxDifference / 6, 0, 1);
  };

  const computeWaterMetrics = (x, z, baseHeight, searchRadius = 6) => {
    const result = {
      distanceToWater: baseHeight < waterLevel ? 0 : Infinity,
      distanceToLand: baseHeight >= waterLevel ? 0 : Infinity,
      waterDepth: Math.max(0, waterLevel - baseHeight),
    };

    if (searchRadius <= 0) {
      return result;
    }

    let nearestWater = result.distanceToWater;
    let nearestLand = result.distanceToLand;
    const needsWater = baseHeight >= waterLevel;
    const needsLand = baseHeight < waterLevel;

    for (let radius = 1; radius <= searchRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dzRange = radius - Math.abs(dx);
        for (let dz = -dzRange; dz <= dzRange; dz++) {
          const neighborHeight = getColumnHeight(x + dx, z + dz);
          if (neighborHeight < waterLevel) {
            if (radius < nearestWater) {
              nearestWater = radius;
            }
          } else {
            if (radius < nearestLand) {
              nearestLand = radius;
            }
          }
        }
      }

      const waterSatisfied = !needsWater || nearestWater !== Infinity;
      const landSatisfied = !needsLand || nearestLand !== Infinity;

      if (waterSatisfied && landSatisfied) {
        break;
      }
    }

    result.distanceToWater = nearestWater;
    result.distanceToLand = nearestLand;
    return result;
  };

  const resolveScaleVector = (scaleOption) => {
    if (!scaleOption && scaleOption !== 0) {
      return new THREE.Vector3(1, 1, 1);
    }
    if (scaleOption.isVector3) {
      return scaleOption.clone();
    }
    if (typeof scaleOption === 'number') {
      return new THREE.Vector3(scaleOption, scaleOption, scaleOption);
    }
    if (Array.isArray(scaleOption)) {
      const [sx = 1, sy = 1, sz = 1] = scaleOption;
      return new THREE.Vector3(sx, sy, sz);
    }
    if (typeof scaleOption === 'object') {
      const sx =
        typeof scaleOption.x === 'number'
          ? scaleOption.x
          : typeof scaleOption.width === 'number'
          ? scaleOption.width
          : 1;
      const sy =
        typeof scaleOption.y === 'number'
          ? scaleOption.y
          : typeof scaleOption.height === 'number'
          ? scaleOption.height
          : 1;
      const sz =
        typeof scaleOption.z === 'number'
          ? scaleOption.z
          : typeof scaleOption.depth === 'number'
          ? scaleOption.depth
          : 1;
      return new THREE.Vector3(sx, sy, sz);
    }
    return new THREE.Vector3(1, 1, 1);
  };

  const resolveOffsetVector = (offsetOption) => {
    if (!offsetOption && offsetOption !== 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    if (offsetOption.isVector3) {
      return offsetOption.clone();
    }
    if (typeof offsetOption === 'number') {
      return new THREE.Vector3(offsetOption, offsetOption, offsetOption);
    }
    if (Array.isArray(offsetOption)) {
      const [ox = 0, oy = 0, oz = 0] = offsetOption;
      return new THREE.Vector3(ox, oy, oz);
    }
    if (typeof offsetOption === 'object') {
      const ox =
        typeof offsetOption.x === 'number'
          ? offsetOption.x
          : typeof offsetOption.offsetX === 'number'
          ? offsetOption.offsetX
          : 0;
      const oy =
        typeof offsetOption.y === 'number'
          ? offsetOption.y
          : typeof offsetOption.offsetY === 'number'
          ? offsetOption.offsetY
          : 0;
      const oz =
        typeof offsetOption.z === 'number'
          ? offsetOption.z
          : typeof offsetOption.offsetZ === 'number'
          ? offsetOption.offsetZ
          : 0;
      return new THREE.Vector3(ox, oy, oz);
    }
    return new THREE.Vector3(0, 0, 0);
  };

  const parseTintOverride = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    try {
      return new THREE.Color(value);
    } catch (error) {
      console.warn('Invalid tint override provided for block placement:', value, error);
      return null;
    }
  };

  const updateBoundsFromVisual = (visualPosition, visualScaleVector) => {
    const halfScaleX = Math.max(0.01, Math.abs(visualScaleVector.x) * 0.5);
    const halfScaleY = Math.max(0.01, Math.abs(visualScaleVector.y) * 0.5);
    const halfScaleZ = Math.max(0.01, Math.abs(visualScaleVector.z) * 0.5);
    minBoundX = Math.min(minBoundX, visualPosition.x - halfScaleX);
    maxBoundX = Math.max(maxBoundX, visualPosition.x + halfScaleX);
    minBoundY = Math.min(minBoundY, visualPosition.y - halfScaleY);
    maxBoundY = Math.max(maxBoundY, visualPosition.y + halfScaleY);
    minBoundZ = Math.min(minBoundZ, visualPosition.z - halfScaleZ);
    maxBoundZ = Math.max(maxBoundZ, visualPosition.z + halfScaleZ);
    hasBoundData = true;
  };

  const createSerializedPlacementPayload = (placement) => {
    if (!placement || placement.removed) {
      return null;
    }
    const position = placement.position;
    const type = placement.type;
    if (!position || !type) {
      return null;
    }
    const biome = placement.biome ?? null;
    const options = placement.instancingOptions ?? {};
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const scaleVector = resolveScaleVector(options.scale);
    const visualScaleVector = resolveScaleVector(
      options.visualScale ?? options.scale,
    );
    const visualOffsetVector = resolveOffsetVector(options.visualOffset);
    const visualPosition = reusablePosition
      .set(x, y, z)
      .add(visualOffsetVector);

    matrix.compose(visualPosition, defaultQuaternion, visualScaleVector);
    updateBoundsFromVisual(visualPosition, visualScaleVector);

    const matrixArray = new Float32Array(16);
    matrix.toArray(matrixArray, 0);
    const scaleArray = new Float32Array([
      scaleVector.x,
      scaleVector.y,
      scaleVector.z,
    ]);
    const visualScaleArray = new Float32Array([
      visualScaleVector.x,
      visualScaleVector.y,
      visualScaleVector.z,
    ]);
    const visualOffsetArray = new Float32Array([
      visualOffsetVector.x,
      visualOffsetVector.y,
      visualOffsetVector.z,
    ]);

    const paletteColor = engine.getBlockColor(biome, type);
    const paletteColorArray =
      paletteColor && typeof paletteColor.r === 'number'
        ? new Float32Array([paletteColor.r, paletteColor.g, paletteColor.b])
        : null;
    const tintStrength = clamp(biome?.shader?.tintStrength ?? 1, 0, 1);
    const tintHexOverride =
      typeof options.tint === 'string' ? options.tint : null;
    const tintOverride = parseTintOverride(options.tint);
    const ignoreBiomeTint = options.ignoreBiomeTint === true;
    const blockMaterial = blockMaterials?.[type];
    const paletteBlend = new THREE.Color(1, 1, 1);
    if (!ignoreBiomeTint) {
      if (paletteColor) {
        paletteBlend.lerp(paletteColor, tintStrength);
      }

      if (biome?.shader?.tintColor) {
        const biomeTintBlend = new THREE.Color(1, 1, 1);
        biomeTintBlend.lerp(biome.shader.tintColor, tintStrength * 0.65);
        paletteBlend.multiply(biomeTintBlend);
      }

      if (biome?.climate) {
        const dryness = clamp(1 - biome.climate.moisture, 0, 1);
        const climateBlend = new THREE.Color(1, 1, 1);
        climateBlend.lerp(
          new THREE.Color(1.02, 0.98, 0.92),
          dryness * 0.35,
        );
        paletteBlend.multiply(climateBlend);
      }

      const altitudeRange = Math.max(
        1,
        worldOptions.maxHeight - waterLevel + 6,
      );
      const altitude = clamp((y - waterLevel + 2) / altitudeRange, -0.25, 1);
      const altitudeBlend = new THREE.Color(1, 1, 1);
      if (altitude > 0) {
        altitudeBlend.lerp(
          new THREE.Color(0.95, 0.98, 1.04),
          altitude * 0.3,
        );
      } else if (altitude < 0) {
        altitudeBlend.lerp(
          new THREE.Color(1.04, 1.01, 0.94),
          Math.abs(altitude) * 0.25,
        );
      }
      paletteBlend.multiply(altitudeBlend);

      if (tintOverride) {
        paletteBlend.multiply(tintOverride);
      }
    } else if (tintHexOverride) {
      const multiplier = resolveBiomeTintMultiplier({
        desiredHex: tintHexOverride,
        type,
        palette: biome?.palette,
        paletteColors: biome?.paletteColors,
        blockMaterial,
      });
      if (multiplier) {
        paletteBlend.copy(multiplier);
      } else if (tintOverride) {
        paletteBlend.copy(tintOverride);
      } else {
        paletteBlend.setRGB(1, 1, 1);
      }
    } else {
      paletteBlend.setRGB(1, 1, 1);
    }

    const tintColorArray = new Float32Array([
      paletteBlend.r,
      paletteBlend.g,
      paletteBlend.b,
    ]);
    const tintOverrideArray = tintOverride
      ? new Float32Array([tintOverride.r, tintOverride.g, tintOverride.b])
      : null;

    const collisionMode =
      placement.collisionMode ?? options.collisionMode ?? null;
    const isSolid =
      typeof placement.isSolid === 'boolean'
        ? placement.isSolid
        : collisionMode === 'solid';
    const isSoft =
      typeof placement.isSoft === 'boolean'
        ? placement.isSoft
        : collisionMode === 'soft';
    const destructible =
      typeof placement.destructible === 'boolean'
        ? placement.destructible
        : typeof options.destructible === 'boolean'
        ? options.destructible
        : null;

    const normalizedVisibility =
      placement.isVisible === true
        ? true
        : placement.isVisible === false
        ? false
        : null;

    const payloadSource = {
      key: placement.key ?? placement.coordinateKey ?? null,
      coordinateKey: placement.coordinateKey ?? null,
      type,
      biomeId: biome?.id ?? null,
      matrix: matrixArray,
      position: new Float32Array([x, y, z]),
      scale: scaleArray,
      visualScale: visualScaleArray,
      visualOffset: visualOffsetArray,
      paletteColor: paletteColorArray,
      tintColor: tintColorArray,
      tintOverride: tintOverrideArray,
      destructible,
      collisionMode,
      isSolid,
      isSoft,
      isDecoration: placement.isDecoration === true,
      sourceObjectId: placement.sourceObjectId ?? options.sourceObjectId ?? null,
      voxelIndex: placement.voxelIndex ?? options.voxelIndex ?? null,
      prototypeKey: placement.prototypeKey ?? null,
      prototypeLocalKey: placement.prototypeLocalKey ?? null,
      metadata: placement.metadata ?? options.metadata ?? null,
      isVisible: normalizedVisibility,
    };

    const payload = serializeInstancedEntry(payloadSource);
    if (typeof destructible === 'boolean') {
      placement.destructible = destructible;
    }
    placement.payload = payload;
    return payload;
  };

  const refreshInstancedEntryPayload = (entry) => {
    if (!entry) {
      return null;
    }
    if (!shouldSerializePlacementPayloads()) {
      entry.payload = null;
      return entry;
    }
    if (
      entry.matrix &&
      entry.position &&
      entry.scale &&
      entry.visualScale &&
      entry.visualOffset
    ) {
      entry.payload = serializeInstancedEntry(entry);
      return entry;
    }
    entry.payload = createSerializedPlacementPayload(entry);
    return entry;
  };

  const createInstancedEntry = (type, x, y, z, biome, options = {}) => {
    const scaleVector = resolveScaleVector(options.scale);
    const visualScaleVector = resolveScaleVector(
      options.visualScale ?? options.scale,
    );
    const visualOffsetVector = resolveOffsetVector(options.visualOffset);
    const visualPosition = reusablePosition
      .set(x, y, z)
      .add(visualOffsetVector);
    matrix.compose(visualPosition, defaultQuaternion, visualScaleVector);

    updateBoundsFromVisual(visualPosition, visualScaleVector);

    const coordinateKey = makeBlockKey(x, y, z);
    const key = options.key ?? coordinateKey;

    const paletteColor = engine.getBlockColor(biome, type);
    const tintStrength = clamp(biome?.shader?.tintStrength ?? 1, 0, 1);
    const tintHexOverride =
      typeof options.tint === 'string' ? options.tint : null;
    const tintOverride = parseTintOverride(options.tint);
    const ignoreBiomeTint = options.ignoreBiomeTint === true;
    const blockMaterial = blockMaterials?.[type];

    const paletteBlend = new THREE.Color(1, 1, 1);
    if (!ignoreBiomeTint) {
      if (paletteColor) {
        paletteBlend.lerp(paletteColor, tintStrength);
      }

      if (biome?.shader?.tintColor) {
        const biomeTintBlend = new THREE.Color(1, 1, 1);
        biomeTintBlend.lerp(biome.shader.tintColor, tintStrength * 0.65);
        paletteBlend.multiply(biomeTintBlend);
      }

      if (biome?.climate) {
        const dryness = clamp(1 - biome.climate.moisture, 0, 1);
        const climateBlend = new THREE.Color(1, 1, 1);
        climateBlend.lerp(new THREE.Color(1.02, 0.98, 0.92), dryness * 0.35);
        paletteBlend.multiply(climateBlend);
      }

      const altitudeRange = Math.max(1, worldOptions.maxHeight - waterLevel + 6);
      const altitude = clamp((y - waterLevel + 2) / altitudeRange, -0.25, 1);
      const altitudeBlend = new THREE.Color(1, 1, 1);
      if (altitude > 0) {
        altitudeBlend.lerp(new THREE.Color(0.95, 0.98, 1.04), altitude * 0.3);
      } else if (altitude < 0) {
        altitudeBlend.lerp(new THREE.Color(1.04, 1.01, 0.94), Math.abs(altitude) * 0.25);
      }
      paletteBlend.multiply(altitudeBlend);

      if (tintOverride) {
        paletteBlend.multiply(tintOverride);
      }
    } else if (tintHexOverride) {
      const multiplier = resolveBiomeTintMultiplier({
        desiredHex: tintHexOverride,
        type,
        palette: biome?.palette,
        paletteColors: biome?.paletteColors,
        blockMaterial,
      });
      if (multiplier) {
        paletteBlend.copy(multiplier);
      } else if (tintOverride) {
        paletteBlend.copy(tintOverride);
      } else {
        paletteBlend.setRGB(1, 1, 1);
      }
    } else {
      paletteBlend.setRGB(1, 1, 1);
    }

    const entry = {
      key,
      coordinateKey,
      matrix: matrix.clone(),
      position: new THREE.Vector3(x, y, z),
      type,
      biomeId: biome?.id ?? null,
      paletteColor,
      tintColor: paletteBlend,
      scale: scaleVector.clone(),
      visualScale: visualScaleVector.clone(),
      visualOffset: visualOffsetVector.clone(),
      destructible:
        typeof options.destructible === 'boolean' ? options.destructible : null,
      sourceObjectId: options.sourceObjectId ?? null,
      voxelIndex: options.voxelIndex ?? null,
      metadata: options.metadata ?? null,
      tintOverride,
    };
    return refreshInstancedEntryPayload(entry);
  };

  const addBlock = (type, x, y, z, biome, options = {}) => {
    if (!type) {
      return null;
    }

    const normalizedOptions = { ...options };
    delete normalizedOptions.replaceExisting;

    const coordinateKey = makeBlockKey(x, y, z);
    const key = normalizedOptions.key ?? coordinateKey;
    normalizedOptions.key = key;

    const replaceExisting = options.replaceExisting === true;

    const isWater = type === 'water';
    const isFluid = isFluidType(type);
    let collisionMode = options.collisionMode;
    let isSolid = undefined;
    let isSoft = undefined;

    if (type === 'cryoshard_glass') {
      const isDevBuild = !import.meta.env || import.meta.env.DEV;
      if (isDevBuild && collisionMode === 'solid') {
        const message =
          '[world generation] cryoshard_glass blocks should never request solid collision; forcing soft mode.';
        console.assert(collisionMode !== 'solid', message, {
          position: { x, y, z },
          options,
        });
        if (typeof console?.warn === 'function') {
          console.warn(message, {
            position: { x, y, z },
            options,
          });
        }
      }
      collisionMode = 'soft';
      isSolid = false;
      isSoft = true;
    }

    if (!collisionMode) {
      if (isFluid) {
        collisionMode = 'liquid';
      } else if (typeof options.isSolid === 'boolean') {
        collisionMode = options.isSolid ? 'solid' : 'none';
      } else if (solidTypes.has(type)) {
        collisionMode = 'solid';
      } else {
        collisionMode = 'none';
      }
    }
    if (typeof isSolid !== 'boolean') {
      isSolid = collisionMode === 'solid';
    }
    if (typeof isSoft !== 'boolean') {
      isSoft = collisionMode === 'soft';
    }

    const destructible =
      typeof options.destructible === 'boolean'
        ? options.destructible
        : !isFluid && type !== 'cloud';

    if (isFluid) {
      fluidBlockKeys.add(coordinateKey);
      fluidKeysArray = null;
      registerHeightBounds(Math.round(y));
      if (!fluidColumnsByType.has(type)) {
        fluidColumnsByType.set(type, new Map());
      }
      const columns = fluidColumnsByType.get(type);
      const columnKey = `${x}|${z}`;
      const blockTop = y + 0.5;
      const blockBottom = y - 0.5;
      let column = columns.get(columnKey);
      if (!column) {
        column = {
          key: columnKey,
          x,
          z,
          minY: blockBottom,
          maxY: blockTop,
          color: new THREE.Color(
            biome?.palette?.water ?? biome?.palette?.cloud ?? '#3a79c5',
          ),
          biome,
        };
        columns.set(columnKey, column);
      } else {
        column.minY = Math.min(column.minY, blockBottom);
        column.maxY = Math.max(column.maxY, blockTop);
        if (biome?.palette?.water) {
          column.color = new THREE.Color(biome.palette.water);
        }
      }
      if (isWater) {
        const bottomY = column.minY;
        const surfaceY = column.maxY;
        const previous = waterColumnMetadata.get(columnKey);
        if (previous) {
          const nextBottom = Number.isFinite(previous.bottomY)
            ? Math.min(previous.bottomY, bottomY)
            : bottomY;
          const nextSurface = Number.isFinite(previous.surfaceY)
            ? Math.max(previous.surfaceY, surfaceY)
            : surfaceY;
          waterColumnMetadata.set(columnKey, {
            bottomY: nextBottom,
            surfaceY: nextSurface,
          });
        } else {
          waterColumnMetadata.set(columnKey, {
            bottomY,
            surfaceY,
          });
        }
      }
      return {
        type,
        key,
        coordinateKey,
        collisionMode,
        isWater,
        isFluid,
        destructible,
        position: { x, y, z },
      };
    }

    fluidBlockKeys.delete(coordinateKey);
    fluidKeysArray = null;

    const existingIndex = placementIndexByCoordinate.get(coordinateKey);
    const existingEntry =
      typeof existingIndex === 'number' && existingIndex >= 0
        ? blockPlacements[existingIndex]
        : null;
    const existingIsSolid =
      existingEntry?.isSolid === true || existingEntry?.collisionMode === 'solid';
    const shouldReplaceExisting =
      !!existingEntry &&
      !existingEntry.isDecoration &&
      (replaceExisting || collisionMode === 'solid');

    if (
      shouldReplaceExisting &&
      (replaceExisting || existingIsSolid || isSolid)
    ) {
      if (existingEntry) {
        existingEntry.removed = true;
        existingEntry.isVisible = false;
        existingEntry.mesh = null;
        existingEntry.tintAttribute = null;
        if (existingEntry.key) {
          blockLookup.delete(existingEntry.key);
        }
        if (existingEntry.coordinateKey) {
          blockLookup.delete(existingEntry.coordinateKey);
          solidBlockKeys.delete(existingEntry.coordinateKey);
          softBlockKeys.delete(existingEntry.coordinateKey);
        }
      }
      if (typeof existingIndex === 'number') {
        blockPlacements[existingIndex] = null;
        placementIndexByCoordinate.delete(coordinateKey);
      }
    } else if (existingEntry) {
      return existingEntry;
    }

    const placement = {
      type,
      biome,
      position: { x, y, z },
      coordinateKey,
      key,
      collisionMode,
      isSolid,
      isSoft,
      isWater: false,
      isFluid: false,
      destructible,
      instancingOptions: normalizedOptions,
      gridPosition: null,
      gridIndex: -1,
      index: -1,
      mesh: null,
      tintAttribute: null,
      isVisible: false,
      isOccluding: undefined,
      removed: false,
    };

    blockPlacements.push(placement);
    placementIndexByCoordinate.set(coordinateKey, blockPlacements.length - 1);

    if (isSolid) {
      solidBlockKeys.add(coordinateKey);
    }
    if (isSoft) {
      softBlockKeys.add(coordinateKey);
    }

    registerHeightBounds(Math.round(y));

    return placement;
  };

  const registerFluidPresence = ({ type, x, z, presence, biome }) => {
    if (!type || !presence || !presence.hasFluid) {
      return;
    }
    if (!fluidColumnsByType.has(type)) {
      fluidColumnsByType.set(type, new Map());
    }
    const columns = fluidColumnsByType.get(type);
    const columnKey = `${x}|${z}`;
    const THREE = ensureThree();
    const surfaceY = Number.isFinite(presence.surfaceY)
      ? presence.surfaceY
      : getColumnHeight(x, z) + 0.5;
    const bottomY = Number.isFinite(presence.bottomY)
      ? presence.bottomY
      : surfaceY;
    const minY = Math.min(surfaceY, bottomY);
    const maxY = Math.max(surfaceY, bottomY);

    let column = columns.get(columnKey);
    if (!column) {
      const palette = biome?.palette ?? {};
      const paletteHex =
        palette[type] ??
        palette.lumen_bloom ??
        palette.water ??
        palette.cloud ??
        '#3a79c5';
      column = {
        key: columnKey,
        x,
        z,
        minY,
        maxY,
        color: new THREE.Color(paletteHex),
        biome,
        lifecycleCues: new Set(),
        auroraIntensitySum: 0,
        auroraIntensitySamples: 0,
        orientationVector: { x: 0, z: 0 },
        orientationSamples: 0,
        glowBiasSum: 0,
        glowBiasSamples: 0,
        pulseRateSum: 0,
        pulseRateSamples: 0,
        ridgeStrengthSum: 0,
        ridgeStrengthSamples: 0,
        flowDirectionHint: null,
        flowDirectionHintSamples: 0,
        flowStrengthHintSum: 0,
        flowStrengthHintSamples: 0,
        foamHint: 0,
        depth: Math.max(0.05, surfaceY - bottomY),
      };
      columns.set(columnKey, column);
    } else {
      column.minY = Math.min(column.minY, minY);
      column.maxY = Math.max(column.maxY, maxY);
      const palette = biome?.palette;
      if (palette) {
        const paletteHex =
          palette[type] ?? palette.lumen_bloom ?? palette.water ?? null;
        if (paletteHex) {
          column.color = new THREE.Color(paletteHex);
        }
      }
      const spanDepth = Math.max(0.05, surfaceY - bottomY);
      column.depth = Math.max(column.depth ?? spanDepth, spanDepth);
    }

    const metadata = presence.metadata ?? {};
    if (Array.isArray(metadata.lifecycleCues)) {
      metadata.lifecycleCues.forEach((cue) => {
        column.lifecycleCues.add(String(cue));
      });
    }
    if (Number.isFinite(metadata.auroraIntensity)) {
      column.auroraIntensitySum += metadata.auroraIntensity;
      column.auroraIntensitySamples += 1;
    }
    if (typeof metadata.colorHex === 'string') {
      try {
        column.color = new THREE.Color(metadata.colorHex);
      } catch (error) {
        // ignore invalid color strings
      }
    }
    if (Number.isFinite(metadata.glowBias)) {
      column.glowBiasSum += metadata.glowBias;
      column.glowBiasSamples += 1;
    }
    if (Number.isFinite(metadata.pulseRate)) {
      column.pulseRateSum += metadata.pulseRate;
      column.pulseRateSamples += 1;
    }
    if (Number.isFinite(metadata.ridgeStrength)) {
      column.ridgeStrengthSum += metadata.ridgeStrength;
      column.ridgeStrengthSamples += 1;
    }
    if (Number.isFinite(metadata.ribbonOrientation)) {
      const angle = metadata.ribbonOrientation;
      column.orientationVector.x += Math.cos(angle);
      column.orientationVector.z += Math.sin(angle);
      column.orientationSamples += 1;
    }
    if (Number.isFinite(metadata.depth)) {
      column.depth = Math.max(column.depth ?? metadata.depth, metadata.depth);
    }
    if (typeof metadata.foamAmount === 'number' && Number.isFinite(metadata.foamAmount)) {
      const clampedFoam = Math.min(1, Math.max(0, metadata.foamAmount));
      column.foamHint = Math.max(column.foamHint ?? 0, clampedFoam);
    }
    if (
      metadata.flowDirection &&
      Number.isFinite(metadata.flowDirection.x) &&
      Number.isFinite(metadata.flowDirection.z)
    ) {
      const direction = metadata.flowDirection;
      const hint = column.flowDirectionHint || { x: 0, z: 0 };
      hint.x += direction.x;
      hint.z += direction.z;
      column.flowDirectionHint = hint;
      column.flowDirectionHintSamples = (column.flowDirectionHintSamples ?? 0) + 1;
    }
    if (Number.isFinite(metadata.flowStrength)) {
      const normalizedStrength = Math.min(1, Math.max(0, metadata.flowStrength));
      column.flowStrengthHintSum =
        (column.flowStrengthHintSum ?? 0) + normalizedStrength;
      column.flowStrengthHintSamples =
        (column.flowStrengthHintSamples ?? 0) + 1;
    }
  };

  const addDecorationInstance = (type, x, y, z, biome, options = {}) => {
    const normalizedOptions = { ...options };
    if (typeof normalizedOptions.destructible !== 'boolean') {
      normalizedOptions.destructible = true;
    }

    const entry = createInstancedEntry(type, x, y, z, biome, normalizedOptions);
    if (!decorationInstancedData.has(type)) {
      decorationInstancedData.set(type, []);
    }
    decorationInstancedData.get(type).push(entry);
    entry.isDecoration = true;
    refreshInstancedEntryPayload(entry);
    return entry;
  };

  const addDecorationMeshFromTemplate = (template, { anchor, biome }) => {
    if (!template || !Array.isArray(template.decorations) || template.decorations.length === 0) {
      return false;
    }

    const cacheKey = template.cacheKey ?? template.placements?.id ?? 'object';

    template.decorations.forEach((decoration, index) => {
      if (!decoration) {
        return;
      }
      const worldX = anchor.x + (decoration.position?.x ?? 0);
      const worldY = anchor.y + (decoration.position?.y ?? 0);
      const worldZ = anchor.z + (decoration.position?.z ?? 0);
      const options = cloneDecorationOptions(decoration.options ?? {});
      const fallbackKey = `${cacheKey}|decor|${index}`;
      const baseKey = decoration.baseKey ?? options.key ?? fallbackKey;
      options.key = `${baseKey}|${worldX}|${worldY}|${worldZ}`;

      addDecorationInstance(decoration.type, worldX, worldY, worldZ, biome, options);
    });

    return true;
  };

  const toVector3 = (value, defaultValue = 0) => {
    if (!value && value !== 0) {
      return new THREE.Vector3(defaultValue, defaultValue, defaultValue);
    }
    if (value.isVector3) {
      return value.clone();
    }
    if (Array.isArray(value)) {
      const [x = defaultValue, y = defaultValue, z = defaultValue] = value;
      return new THREE.Vector3(x, y, z);
    }
    if (typeof value === 'number') {
      return new THREE.Vector3(value, value, value);
    }
    if (typeof value === 'object') {
      const vx =
        typeof value.x === 'number'
          ? value.x
          : typeof value.width === 'number'
          ? value.width
          : defaultValue;
      const vy =
        typeof value.y === 'number'
          ? value.y
          : typeof value.height === 'number'
          ? value.height
          : defaultValue;
      const vz =
        typeof value.z === 'number'
          ? value.z
          : typeof value.depth === 'number'
          ? value.depth
          : defaultValue;
      return new THREE.Vector3(vx, vy, vz);
    }
    return new THREE.Vector3(defaultValue, defaultValue, defaultValue);
  };

  const resolveInstanceScale = (value) => toVector3(value, 1);

  const resolveInstanceRotation = (value) => {
    if (value?.isQuaternion) {
      return value.clone();
    }
    const quaternion = new THREE.Quaternion();
    if (!value && value !== 0) {
      return quaternion;
    }
    if (value?.isEuler) {
      return quaternion.setFromEuler(value);
    }
    if (Array.isArray(value)) {
      const [rx = 0, ry = 0, rz = 0] = value;
      return quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    }
    if (typeof value === 'number') {
      return quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), value);
    }
    if (typeof value === 'object') {
      const { x = 0, y = 0, z = 0, w } = value;
      if (typeof w === 'number') {
        return new THREE.Quaternion(x, y, z, w);
      }
      return quaternion.setFromEuler(new THREE.Euler(x, y, z));
    }
    return quaternion;
  };

  const addPrototypeInstance = (prototype, options = {}) => {
    if (!prototype) {
      return null;
    }

    const anchor = options.anchor ?? { x: 0, y: 0, z: 0 };
    const basePosition = new THREE.Vector3(
      anchor.x ?? 0,
      anchor.y ?? 0,
      anchor.z ?? 0,
    );
    const instanceScale = resolveInstanceScale(options.scale);
    const rotation = resolveInstanceRotation(options.rotation);
    const biome = options.biome ?? null;
    const instanceKey =
      options.instanceKey ??
      `${prototype.id ?? 'prototype'}|${chunkX}|${chunkZ}|${prototypeInstanceCounter++}`;

    const record = {
      key: instanceKey,
      prototypeId: prototype.id ?? null,
      blockEntries: [],
      decorationKeys: [],
    };
    prototypeInstances.set(instanceKey, record);

    const blocks = prototype.blocks ?? [];
    blocks.forEach((block, index) => {
      const relativePosition = toVector3(block.position, 0)
        .multiply(instanceScale)
        .applyQuaternion(rotation);
      const worldPosition = relativePosition.add(basePosition.clone());
      const blockCoordinateKey = makeBlockKey(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z,
      );

      const blockScale = toVector3(block.scale, 1).multiply(instanceScale);
      const visualScale = toVector3(block.visualScale, 1).multiply(instanceScale);
      const visualOffset = toVector3(block.visualOffset, 0)
        .multiply(instanceScale)
        .applyQuaternion(rotation);

      const entry = addBlock(block.type, worldPosition.x, worldPosition.y, worldPosition.z, biome, {
        scale: blockScale,
        visualScale,
        visualOffset,
        collisionMode: block.collisionMode,
        isSolid: block.collisionMode === 'solid',
        destructible: block.destructible,
        tint: block.tint,
        ignoreBiomeTint: block.ignoreBiomeTint === true,
        sourceObjectId: block.sourceObjectId ?? prototype.id ?? null,
        voxelIndex: block.voxelIndex,
        metadata: block.metadata,
        key: `${instanceKey}|${block.key ?? `voxel-${index}`}|${worldPosition.x}|${worldPosition.y}|${worldPosition.z}`,
      });

      if (entry) {
        entry.prototypeKey = instanceKey;
        entry.prototypeLocalKey = block.key ?? `voxel-${index}`;
        refreshInstancedEntryPayload(entry);
        if (shouldRetainPrototypeEntries) {
          record.blockEntries.push({
            type: block.type,
            entry,
            entryKey: entry.key ?? null,
            coordinateKey: entry.coordinateKey ?? blockCoordinateKey,
          });
        } else {
          record.blockEntries.push({
            type: block.type ?? entry.type ?? null,
            entryKey: entry.key ?? entry.coordinateKey ?? blockCoordinateKey,
            coordinateKey: entry.coordinateKey ?? blockCoordinateKey,
          });
        }
        return;
      }

      if (!shouldRetainPrototypeEntries) {
        record.blockEntries.push({
          type: block.type ?? null,
          entryKey: blockCoordinateKey,
          coordinateKey: blockCoordinateKey,
        });
      }
    });

    const decorations = prototype.decorations ?? [];
    decorations.forEach((decoration, index) => {
      const relativePosition = toVector3(decoration.position, 0)
        .multiply(instanceScale)
        .applyQuaternion(rotation);
      const worldPosition = relativePosition.add(basePosition.clone());

      const baseOptions = decoration.options ?? {};
      const optionsClone = {
        ...baseOptions,
        scale: baseOptions.scale
          ? toVector3(baseOptions.scale, 1).multiply(instanceScale)
          : baseOptions.scale,
        visualScale: baseOptions.visualScale
          ? toVector3(baseOptions.visualScale, 1).multiply(instanceScale)
          : baseOptions.visualScale,
        visualOffset: baseOptions.visualOffset
          ? toVector3(baseOptions.visualOffset, 0)
              .multiply(instanceScale)
              .applyQuaternion(rotation)
          : baseOptions.visualOffset,
      };

      const fallbackKey = `${instanceKey}|decor|${index}`;
      const keyBase = optionsClone.key ?? fallbackKey;
      optionsClone.key = `${keyBase}|${worldPosition.x}|${worldPosition.y}|${worldPosition.z}`;

      const entry = addDecorationInstance(
        decoration.type,
        worldPosition.x,
        worldPosition.y,
        worldPosition.z,
        biome,
        optionsClone,
      );

      if (entry) {
        entry.prototypeKey = instanceKey;
        refreshInstancedEntryPayload(entry);
        if (shouldRetainPrototypeEntries) {
          record.decorationKeys.push(entry.key);
        } else {
          record.decorationKeys.push(entry.key ?? optionsClone.key ?? fallbackKey);
        }
      } else if (!shouldRetainPrototypeEntries) {
        record.decorationKeys.push(optionsClone.key ?? fallbackKey);
      }
    });

    return instanceKey;
  };

  const sanitizePrototypeInstancesForLowDetail = () => {
    if (shouldRetainPrototypeEntries) {
      return;
    }
    prototypeInstances.forEach((record, key) => {
      const sanitized = sanitizePrototypeInstanceRecordForLowDetail(record);
      if (!sanitized) {
        prototypeInstances.delete(key);
        return;
      }
      prototypeInstances.set(key, sanitized);
    });
  };

  const buildInstancedMesh = (entries, type, { capacity } = {}) => {
    const effectiveCapacity = Math.max(
      Array.isArray(entries) ? entries.length : 0,
      Number.isInteger(capacity) && capacity > 0 ? capacity : 0,
    );
    const { mesh, tintAttribute } = buildInstancedBlockMesh({
      THREE,
      blockMaterials,
      type,
      entries,
      capacity: effectiveCapacity,
    });
    return { mesh, tintAttribute };
  };

  instancedData.forEach((entries, type) => {
    if (!typeCapacities.has(type)) {
      typeCapacities.set(type, entries.length);
    }
  });

  const addMeshesFromMap = (targetGroup) => {
    typeCapacities.forEach((capacity, type) => {
      if (isFluidType(type)) {
        return;
      }
      const entries = instancedData.get(type) ?? [];
      const effectiveCapacity = Math.max(capacity ?? 0, entries.length);
      if (effectiveCapacity <= 0 && entries.length === 0) {
        return;
      }
      const { mesh, tintAttribute } = buildInstancedMesh(entries, type, {
        capacity: Math.max(1, effectiveCapacity),
      });
      mesh.count = entries.length;
      mesh.instanceMatrix.needsUpdate = entries.length > 0;
      if (tintAttribute) {
        tintAttribute.needsUpdate = entries.length > 0;
      }
      typeData.set(type, {
        entries,
        mesh,
        tintAttribute,
        capacity: Math.max(1, effectiveCapacity),
      });
      targetGroup.add(mesh);
    });
  };

  const addDecorationMesh = (targetGroup, type, entries) => {
    if (!entries || entries.length === 0) {
      return;
    }
    const { mesh, tintAttribute } = buildInstancedMesh(entries, type);
    mesh.userData.decoration = true;
    decorationData.set(type, { entries, mesh, tintAttribute });

    const { groups: metadataGroups } = createDecorationMeshBatches(entries);

    metadataGroups.forEach((groupInfo) => {
      const instanceIndices = groupInfo.entryIndices.slice();
      const metadata = {
        key: groupInfo.key,
        owner: groupInfo.owner ?? null,
        destructible:
          typeof groupInfo.destructible === 'boolean' ? groupInfo.destructible : true,
        type,
        mesh,
        tintAttribute,
        instanceIndices,
      };
      decorationGroups.set(metadata.key, metadata);
      const owner = metadata.owner;
      if (owner !== null && owner !== undefined) {
        let ownerGroups = decorationOwnerIndex.get(owner);
        if (!ownerGroups) {
          ownerGroups = new Map();
          decorationOwnerIndex.set(owner, ownerGroups);
        }
        ownerGroups.set(metadata.key, metadata);
      }

      let typeGroup = decorationTypeIndex.get(type);
      if (!typeGroup) {
        typeGroup = new Set();
        decorationTypeIndex.set(type, typeGroup);
      }
      typeGroup.add(metadata);

      metadata.instanceIndices.forEach((instanceIndex) => {
        const entry = entries[instanceIndex];
        if (!entry) {
          return;
        }
        entry.decorationGroup = metadata;
        entry.decorationGroupKey = metadata.key;
        entry.mesh = mesh;
        entry.tintAttribute = tintAttribute;
        entry.isDecoration = true;
        entry.destructible = typeof entry.destructible === 'boolean'
          ? entry.destructible
          : metadata.destructible;
        refreshInstancedEntryPayload(entry);
        blockLookup.set(entry.key, entry);
        if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
          blockLookup.set(entry.coordinateKey, entry);
        }
      });
    });

    targetGroup.add(mesh);
  };

  const processColumnAtIndex = (columnIndex) => {
    const lx = Math.floor(columnIndex / chunkSize);
    const lz = columnIndex % chunkSize;
    const worldX = minX + lx;
    const worldZ = minZ + lz;
    const columnSample = sampleColumnCached(worldX, worldZ);
    if (!columnSample || !Number.isFinite(columnSample.height)) {
      return;
    }
    const height = getColumnHeight(worldX, worldZ);
    if (!Number.isFinite(height)) {
      console.error('[terrain] aborted column due to invalid height', {
        chunkX,
        chunkZ,
        columnX: worldX,
        columnZ: worldZ,
        height: columnSample.height,
      });
      return;
    }
    const biome = columnSample.biome;
    const slope = computeSlope(worldX, worldZ, height);
    const oceanSample = columnSample.ocean ?? null;
    const oceanProvince = Number.isFinite(columnSample.oceanProvince)
      ? columnSample.oceanProvince
      : Number.isFinite(oceanSample?.province)
      ? oceanSample.province
      : 0.5;
    const shorelineAffinity = clamp(
      Number.isFinite(columnSample.shorelineAffinity)
        ? columnSample.shorelineAffinity
        : Number.isFinite(oceanSample?.shoreline)
        ? oceanSample.shoreline
        : 0,
      0,
      1,
    );
    const oceanDepthHint = clamp(
      Number.isFinite(columnSample.oceanDepth)
        ? columnSample.oceanDepth
        : Number.isFinite(oceanSample?.depth)
        ? oceanSample.depth
        : Math.max(0, (0.5 - oceanProvince) * 2),
      0,
      1,
    );
    const shoreSlopeBias = Number.isFinite(worldOptions?.terrain?.shoreSlopeBias)
      ? worldOptions.terrain.shoreSlopeBias
      : 0;
    columnSample.oceanDepth = oceanDepthHint;
    columnSample.shorelineAffinity = shorelineAffinity;
    const searchRadiusBase = 4 + shorelineAffinity * 2 + oceanDepthHint * 3;
    const slopeBiasContribution =
      shoreSlopeBias >= 0
        ? shoreSlopeBias * (0.5 + oceanDepthHint * 0.5)
        : shoreSlopeBias * (0.35 + shorelineAffinity * 0.4);
    const searchRadius = Math.max(
      3,
      Math.round(searchRadiusBase + slopeBiasContribution),
    );
    const isUnderwater = height < waterLevel;
    const waterMetrics = computeWaterMetrics(worldX, worldZ, height, searchRadius);
    const distanceToWater = Number.isFinite(waterMetrics.distanceToWater)
      ? waterMetrics.distanceToWater
      : searchRadius + 1;
    const distanceToLand = Number.isFinite(waterMetrics.distanceToLand)
      ? waterMetrics.distanceToLand
      : searchRadius + 1;
    const columnWaterDepth = waterMetrics.waterDepth;
    const slopeTerm =
      shoreSlopeBias >= 0
        ? shoreSlopeBias * (0.7 + oceanDepthHint * 0.6)
        : shoreSlopeBias * (0.5 + shorelineAffinity * 0.4);
    const shoreThreshold = clamp(
      1.75 + shorelineAffinity * 1.5 + oceanDepthHint * 1.4 + slopeTerm,
      0.75,
      searchRadius,
    );
    let isShore = (!isUnderwater && distanceToWater <= shoreThreshold) ||
      (isUnderwater && distanceToLand <= shoreThreshold);
    if (!isShore && shorelineAffinity > 0.35 && Number.isFinite(waterMetrics.distanceToWater)) {
      const normalizedDistance = distanceToWater / Math.max(1, searchRadius);
      const shorelineTolerance =
        shorelineAffinity * 0.85 + oceanDepthHint * 0.3 + Math.max(0, shoreSlopeBias) * 0.15;
      if (normalizedDistance <= shorelineTolerance) {
        isShore = true;
      }
    }

    if (biome) {
      const stats = biomePresence.get(biome.id) ?? { biome, samples: 0 };
      stats.samples += 1;
      biomePresence.set(biome.id, stats);
    }

    if (isScoutDetail && scoutHeightMap && scoutBiomeIds) {
      const normalizedHeight = Number.isFinite(height) ? Math.floor(height) : 0;
      const columnIndex = lx * chunkSize + lz;
      scoutHeightMap[columnIndex] = normalizedHeight;
      scoutBiomeIds[columnIndex] = biome?.id ?? null;
      scoutMinHeight = Math.min(scoutMinHeight, normalizedHeight);
      scoutMaxHeight = Math.max(scoutMaxHeight, normalizedHeight);
      return;
    }

    const surfaceBlock = isUnderwater
      ? biome?.terrain?.shoreBlock ?? 'sand'
      : isShore
      ? biome?.terrain?.shoreBlock ?? 'sand'
      : biome?.terrain?.surfaceBlock ?? 'grass';
    const subSurfaceBlock = isUnderwater
      ? biome?.terrain?.shoreBlock ?? 'sand'
      : biome?.terrain?.subSurfaceBlock ?? 'dirt';
    const deepBlock = biome?.terrain?.deepBlock ?? 'stone';
    const subSurfaceDepth = Math.max(1, biome?.terrain?.subSurfaceDepth ?? 4);

    for (let y = 0; y <= height; y++) {
      if (y === height) {
        addBlock(surfaceBlock, worldX, y, worldZ, biome);
      } else if (y >= height - subSurfaceDepth) {
        addBlock(subSurfaceBlock, worldX, y, worldZ, biome);
      } else {
        addBlock(deepBlock, worldX, y, worldZ, biome);
      }
    }

    if (height < waterLevel) {
      for (let y = height + 1; y <= waterLevel; y++) {
        addBlock('water', worldX, y, worldZ, biome);
      }
    }

    const lumenPresence = resolveFluidPresence({
      type: 'lumen_bloom',
      x: worldX,
      z: worldZ,
      sampleColumnHeight: getColumnHeight,
      worldConfig: worldOptions,
      sampleBiomeAt: sampleColumnCached,
    });
    const lumenCues = Array.isArray(lumenPresence?.metadata?.lifecycleCues)
      ? lumenPresence.metadata.lifecycleCues
      : null;
    const hasAuroraRibbonCue = Boolean(
      lumenCues && lumenCues.includes('aurora_ribbon'),
    );
    const columnWasFlooded = height < waterLevel;
    const shouldSkipLumenSurface =
      columnWasFlooded || isUnderwater || isShore;
    if (hasAuroraRibbonCue && !shouldSkipLumenSurface) {
      registerFluidPresence({
        type: 'lumen_bloom',
        x: worldX,
        z: worldZ,
        presence: lumenPresence,
        biome,
      });
    }

    populateColumnWithVoxelObjects({
      addBlock,
      addDecorationInstance,
      addPrototypeInstance,
      addDecorationMesh: addDecorationMeshFromTemplate,
      biome,
      columnSample,
      groundHeight: height,
      slope,
      worldX,
      worldZ,
      isUnderwater,
      isShore,
      waterLevel,
      distanceToWater,
      distanceToLand,
      waterDepth: columnWaterDepth,
      randomSource: (offset) => randomAt(worldX, worldZ, offset),
    });
  };

  let occupancyMinY = Number.POSITIVE_INFINITY;
  let occupancyMaxY = Number.NEGATIVE_INFINITY;
  let occupancyWidth = chunkSize;
  let occupancyDepth = chunkSize;
  let occupancyHeight = 0;
  let occupancyArea = 0;
  let fluidOccupancy = null;

  const toIndex = (lx, ly, lz) => ly * occupancyArea + lz * occupancyWidth + lx;

  const fromIndex = (index) => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      occupancyArea <= 0 ||
      occupancyWidth <= 0 ||
      occupancyDepth <= 0
    ) {
      return null;
    }
    const localY = Math.floor(index / occupancyArea);
    const areaRemainder = index - localY * occupancyArea;
    const localZ = Math.floor(areaRemainder / occupancyWidth);
    const localX = areaRemainder - localZ * occupancyWidth;
    if (
      localX < 0 ||
      localX >= occupancyWidth ||
      localZ < 0 ||
      localZ >= occupancyDepth ||
      localY < 0 ||
      localY >= occupancyHeight
    ) {
      return null;
    }
    return { x: localX, y: localY, z: localZ };
  };

  const parseBlockKey = (key) => {
    if (!key || typeof key !== 'string') {
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
  };

  const registerHeightBounds = (value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    occupancyMinY = Math.min(occupancyMinY, value);
    occupancyMaxY = Math.max(occupancyMaxY, value);
  };

  const assignLocalGridPosition = (placement) => {
    const position = placement?.position;
    if (!position) {
      placement.gridPosition = null;
      if (placement) {
        placement.gridIndex = -1;
      }
      return null;
    }
    const lx = Math.round(position.x - minX);
    const lz = Math.round(position.z - minZ);
    const ly = Math.round(position.y) - occupancyMinY;
    if (
      lx < 0 ||
      lx >= occupancyWidth ||
      lz < 0 ||
      lz >= occupancyDepth ||
      ly < 0 ||
      ly >= occupancyHeight
    ) {
      placement.gridPosition = null;
      placement.gridIndex = -1;
      return null;
    }
    const local = { x: lx, y: ly, z: lz };
    placement.gridPosition = local;
    return local;
  };

  const getTypeId = (type) => {
    if (!type) {
      return 0;
    }
    if (!typeIds.has(type)) {
      typeIds.set(type, nextTypeId++);
    }
    return typeIds.get(type);
  };

  const neighborOffsets3D = [
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 1, dz: 0 },
    { dx: 0, dy: -1, dz: 0 },
    { dx: 0, dy: 0, dz: 1 },
    { dx: 0, dy: 0, dz: -1 },
  ];

  const materializePlacement = (placement) => {
    if (!placement || placement.removed) {
      return null;
    }
    if (placement.materialized) {
      return placement;
    }
    const options = placement.instancingOptions ?? {};
    const entryData = createInstancedEntry(
      placement.type,
      placement.position.x,
      placement.position.y,
      placement.position.z,
      placement.biome,
      options,
    );
    Object.assign(placement, entryData);
    placement.materialized = true;
    placement.isSolid = placement.isSolid ?? placement.collisionMode === 'solid';
    placement.isSoft = placement.isSoft ?? placement.collisionMode === 'soft';
    placement.isWater = false;
    placement.isFluid = false;
    placement.destructible =
      typeof placement.destructible === 'boolean'
        ? placement.destructible
        : entryData.destructible;
    refreshInstancedEntryPayload(placement);
    return placement;
  };

  const isFluidColumnExposed = (column) => {
    if (!column) {
      return false;
    }

    const localX = Math.round(column.x - minX);
    const localZ = Math.round(column.z - minZ);
    if (
      localX < 0 ||
      localX >= occupancyWidth ||
      localZ < 0 ||
      localZ >= occupancyDepth
    ) {
      return true;
    }

    const resolvedMin = Number.isFinite(column.minY)
      ? column.minY
      : Number.isFinite(column.bottomY)
      ? column.bottomY
      : null;
    const resolvedMax = Number.isFinite(column.maxY)
      ? column.maxY
      : Number.isFinite(column.surfaceY)
      ? column.surfaceY
      : null;

    if (!Number.isFinite(resolvedMin) || !Number.isFinite(resolvedMax)) {
      return true;
    }

    const minBoundary = Math.min(resolvedMin, resolvedMax);
    const maxBoundary = Math.max(resolvedMin, resolvedMax);
    const minBlockY = Math.floor(minBoundary + 0.5);
    const maxBlockY = Math.ceil(maxBoundary - 0.5);
    const startBlockY = Math.min(minBlockY, maxBlockY);
    const endBlockY = Math.max(minBlockY, maxBlockY);

    const startLocalY = startBlockY - occupancyMinY;
    const endLocalY = endBlockY - occupancyMinY;

    for (let localY = startLocalY; localY <= endLocalY; localY += 1) {
      if (localY < 0 || localY >= occupancyHeight) {
        return true;
      }

      for (let i = 0; i < neighborOffsets3D.length; i += 1) {
        const offset = neighborOffsets3D[i];
        const neighborX = localX + offset.dx;
        const neighborY = localY + offset.dy;
        const neighborZ = localZ + offset.dz;

        if (
          neighborX < 0 ||
          neighborX >= occupancyWidth ||
          neighborZ < 0 ||
          neighborZ >= occupancyDepth ||
          neighborY < 0 ||
          neighborY >= occupancyHeight
        ) {
          return true;
        }

        if (
          neighborX === localX &&
          neighborZ === localZ &&
          neighborY >= startLocalY &&
          neighborY <= endLocalY
        ) {
          continue;
        }

        const neighborIndex = toIndex(neighborX, neighborY, neighborZ);
        const neighborPlacementIndex = occupancyPlacements[neighborIndex];
        if (neighborPlacementIndex < 0) {
          if (fluidOccupancy[neighborIndex] === 1) {
            return true;
          }
          return true;
        }
        const neighborEntry = blockPlacements[neighborPlacementIndex];
        if (!neighborEntry) {
          return true;
        }
        const neighborOccluding =
          typeof neighborEntry.isOccluding === 'boolean'
            ? neighborEntry.isOccluding
            : isBlockOccluding(neighborEntry, blockMaterials);
        if (!neighborOccluding) {
          return true;
        }
      }
    }

    return false;
  };

  let fluidKeysArray = null;
  const ensureFluidKeysArray = () => {
    if (!fluidKeysArray) {
      fluidKeysArray = Array.from(fluidBlockKeys);
    }
    return fluidKeysArray;
  };

  const createEnginePayload = () => ({
    blockPlacements,
    fluidBlockKeys,
    fluidColumnsByType,
    waterColumnMetadata,
    fluidSurfaces,
    decorationInstancedData,
    decorationGroups,
    decorationOwnerIndex,
    decorationTypeIndex,
    decorationData,
    typeCapacities,
    typeData,
    biomePresence,
    prototypeInstances,
  });

  const cloneBiomeSummary = (biomes) =>
    biomes.map((entry) => ({
      ...entry,
      shader: {
        ...entry.shader,
      },
    }));

  const buildBiomeSummary = () => {
    if (cachedBiomeSummary) {
      return cloneBiomeSummary(cachedBiomeSummary);
    }
    const biomeEntries = Array.from(biomePresence.values());
    const totalSamples = biomeEntries.reduce((sum, entry) => {
      const samples = Number.isFinite(entry?.samples) ? entry.samples : 0;
      return sum + samples;
    }, 0);
    const colorScratch = new THREE.Color(0, 0, 0);
    const toHex = (value) => {
      if (!value) {
        return '#000000';
      }
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof THREE.Color) {
        return `#${value.getHexString()}`;
      }
      if (Array.isArray(value)) {
        const [r = 0, g = 0, b = 0] = value;
        colorScratch.setRGB(
          Number.isFinite(r) ? r : 0,
          Number.isFinite(g) ? g : 0,
          Number.isFinite(b) ? b : 0,
        );
        return `#${colorScratch.getHexString()}`;
      }
      if (
        typeof value === 'object' &&
        Number.isFinite(value.r) &&
        Number.isFinite(value.g) &&
        Number.isFinite(value.b)
      ) {
        colorScratch.setRGB(value.r, value.g, value.b);
        return `#${colorScratch.getHexString()}`;
      }
      return '#000000';
    };
    cachedBiomeSummary = biomeEntries.map((entry) => {
      const biome = entry?.biome ?? null;
      const samples = Number.isFinite(entry?.samples) ? entry.samples : 0;
      const shader = biome?.shader ?? {};
      return {
        id: biome?.id ?? null,
        label: biome?.label ?? null,
        weight: totalSamples > 0 ? samples / totalSamples : 0,
        shader: {
          fogColor: toHex(shader.fogColor),
          tintColor: toHex(shader.tintColor),
          tintStrength: Number.isFinite(shader.tintStrength)
            ? shader.tintStrength
            : 1,
        },
      };
    });
    return cloneBiomeSummary(cachedBiomeSummary);
  };

  const buildScoutPayload = () => {
    if (!isScoutDetail) {
      return null;
    }
    const resolvedMinHeight = Number.isFinite(scoutMinHeight)
      ? scoutMinHeight
      : Number.isFinite(worldOptions?.baseHeight)
      ? worldOptions.baseHeight
      : 0;
    const resolvedMaxHeight = Number.isFinite(scoutMaxHeight)
      ? scoutMaxHeight
      : Number.isFinite(worldOptions?.maxHeight)
      ? worldOptions.maxHeight
      : resolvedMinHeight;
    const heights = scoutHeightMap ? scoutHeightMap.slice() : new Int16Array(0);
    const biomeIds = scoutBiomeIds
      ? scoutBiomeIds.map((value) =>
          value === null || value === undefined ? null : String(value),
        )
      : [];
    return {
      chunkX,
      chunkZ,
      detailLevel: DETAIL_LEVEL_SCOUT,
      heightSummary: {
        width: chunkSize,
        depth: chunkSize,
        minHeight: resolvedMinHeight,
        maxHeight: resolvedMaxHeight,
        heights,
        biomeIds,
      },
      biomes: buildBiomeSummary(),
    };
  };

  const stepState = {
    stage: 'columns',
    processedColumns: 0,
  };

  let cachedChunkPayload = null;
  let busy = false;
  let payloadPrepared = false;

  const releaseCachedPayload = (options = {}) => {
    cachedChunkPayload = null;
    payloadPrepared = false;
    const normalizedOptions =
      options && typeof options === 'object' ? options : {};
    if (normalizedOptions.cancel) {
      ensureTerrainSamplesReleased();
      return;
    }
    if (stepState.stage === 'readyForFinalize') {
      ensureTerrainSamplesReleased();
    }
  };

  const exportPayloadSnapshot = () => {
    if (isScoutDetail) {
      if (needsWorkerPayload && cachedChunkPayload) {
        return cachedChunkPayload;
      }
      return buildScoutPayload();
    }
    if (needsWorkerPayload && cachedChunkPayload) {
      return cachedChunkPayload;
    }
    prepareEngineForPayload();
    return buildChunkPayload({
      chunkX,
      chunkZ,
      engine: createEnginePayload(),
      worldOptions,
      includeBlockPlacements: includeBlockPlacementsInPayload,
      includeOccupancy: !isLowDetail,
    });
  };

  const refreshAllPlacementPayloads = () => {
    const processed = new Set();
    const updateEntry = (entry) => {
      if (!entry || processed.has(entry)) {
        return;
      }
      processed.add(entry);
      refreshInstancedEntryPayload(entry);
    };

    blockPlacements.forEach((placement) => {
      if (placement) {
        updateEntry(placement);
      }
    });
    instancedData.forEach((entries) => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry) => {
        if (entry) {
          updateEntry(entry);
        }
      });
    });
    decorationInstancedData.forEach((entries) => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry) => {
        if (entry) {
          updateEntry(entry);
        }
      });
    });
    prototypeInstances.forEach((record) => {
      if (!record || !Array.isArray(record.blockEntries)) {
        return;
      }
      record.blockEntries.forEach((blockEntry) => {
        if (blockEntry?.entry) {
          updateEntry(blockEntry.entry);
        }
      });
    });
  };

  const setRequiresWorkerPayload = (value) => {
    const next = Boolean(value);
    if (needsWorkerPayload === next) {
      return;
    }
    const serializationBefore = shouldSerializePlacementPayloads();
    needsWorkerPayload = next;
    if (!needsWorkerPayload) {
      releaseCachedPayload();
    }
    const serializationAfter = shouldSerializePlacementPayloads();
    if (serializationBefore !== serializationAfter) {
      refreshAllPlacementPayloads();
    }
  };

  const ensureOccupancyArrays = () => {
    if (!Number.isFinite(occupancyMinY)) {
      const fallback = Math.floor(worldOptions.waterLevel ?? 0);
      occupancyMinY = Number.isFinite(occupancyMinY) ? occupancyMinY : fallback;
    }
    if (!Number.isFinite(occupancyMaxY)) {
      occupancyMaxY = Number.isFinite(occupancyMinY) ? occupancyMinY : 0;
    }

    const occupancySpan = occupancyMaxY - occupancyMinY + 1;
    if (occupancySpan > MAX_OCCUPANCY_COORDINATE_SNAPSHOT) {
      const reference = Number.isFinite(worldOptions?.waterLevel)
        ? Math.round(worldOptions.waterLevel)
        : Math.round(occupancyMinY + occupancySpan / 2);
      const halfWindow = Math.floor(MAX_OCCUPANCY_COORDINATE_SNAPSHOT / 2);
      let desiredMin = reference - halfWindow;
      let desiredMax = desiredMin + MAX_OCCUPANCY_COORDINATE_SNAPSHOT - 1;
      if (desiredMin < occupancyMinY) {
        desiredMin = occupancyMinY;
        desiredMax = desiredMin + MAX_OCCUPANCY_COORDINATE_SNAPSHOT - 1;
      }
      if (desiredMax > occupancyMaxY) {
        desiredMax = occupancyMaxY;
        desiredMin = desiredMax - MAX_OCCUPANCY_COORDINATE_SNAPSHOT + 1;
      }
      occupancyMinY = desiredMin;
      occupancyMaxY = desiredMax;
    }

    occupancyWidth = chunkSize;
    occupancyDepth = chunkSize;
    occupancyHeight = Math.max(1, occupancyMaxY - occupancyMinY + 1);
    occupancyArea = occupancyWidth * occupancyDepth;

    occupancyTypes = new Uint16Array(occupancyArea * occupancyHeight);
    occupancyPlacements = new Int32Array(occupancyArea * occupancyHeight);
    occupancyPlacements.fill(-1);
    fluidOccupancy = new Uint8Array(occupancyArea * occupancyHeight);
  };

  const registerInstancedPlacement = (placement) => {
    const entry = materializePlacement(placement);
    if (!entry) {
      return null;
    }

    let entries = instancedData.get(entry.type);
    if (!entries) {
      entries = [];
      instancedData.set(entry.type, entries);
    }

    placement.index = entries.length;
    entries.push(entry);

    blockLookup.set(entry.key, entry);
    if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
      blockLookup.set(entry.coordinateKey, entry);
    }

    return entry;
  };

  const toPlainNumericArray = (value, length = null) => {
    if (value == null) {
      return null;
    }
    if (Array.isArray(value)) {
      if (typeof length === 'number' && length > 0) {
        if (value.length === length) {
          return value;
        }
        const normalized = new Array(length);
        for (let index = 0; index < length; index += 1) {
          const entry = value[index];
          normalized[index] = Number.isFinite(entry) ? entry : 0;
        }
        return normalized;
      }
      return value;
    }
    if (ArrayBuffer.isView(value)) {
      const normalized = Array.from(value);
      if (typeof length === 'number' && length > 0) {
        if (normalized.length > length) {
          return normalized.slice(0, length);
        }
        while (normalized.length < length) {
          normalized.push(0);
        }
      }
      return normalized;
    }
    if (typeof value === 'object') {
      const vectorKeys = ['x', 'y', 'z'];
      if (
        length === 3 &&
        vectorKeys.every((key) => Number.isFinite(value?.[key]))
      ) {
        return vectorKeys.map((key) => value[key]);
      }
    }
    return null;
  };

  const createLeanPlacementRecord = (placement, index) => {
    if (!placement || placement.removed) {
      return null;
    }
    const existingPayload =
      placement.payload && typeof placement.payload === 'object'
        ? placement.payload
        : null;
    const payloadSource =
      existingPayload ?? createSerializedPlacementPayload(placement);
    if (!payloadSource) {
      return null;
    }

    const type = payloadSource.type ?? placement.type ?? null;
    if (!type) {
      return null;
    }

    const key =
      payloadSource.key ?? placement.key ?? placement.coordinateKey ?? null;
    const coordinateKey =
      payloadSource.coordinateKey ?? placement.coordinateKey ?? key;
    const biomeId = payloadSource.biomeId ?? placement.biome?.id ?? null;
    const collisionMode =
      payloadSource.collisionMode ?? placement.collisionMode ?? null;
    const isSolid =
      typeof placement.isSolid === 'boolean'
        ? placement.isSolid
        : typeof payloadSource.isSolid === 'boolean'
        ? payloadSource.isSolid
        : collisionMode === 'solid';
    const isSoft =
      typeof placement.isSoft === 'boolean'
        ? placement.isSoft
        : typeof payloadSource.isSoft === 'boolean'
        ? payloadSource.isSoft
        : collisionMode === 'soft';
    const destructible =
      typeof placement.destructible === 'boolean'
        ? placement.destructible
        : typeof payloadSource.destructible === 'boolean'
        ? payloadSource.destructible
        : null;

    const isAlreadyPlain =
      existingPayload &&
      Array.isArray(existingPayload.matrix) &&
      Array.isArray(existingPayload.position) &&
      Array.isArray(existingPayload.scale);

    const visibilityValue =
      placement.isVisible === true
        ? true
        : placement.isVisible === false
        ? false
        : existingPayload?.isVisible === true
        ? true
        : existingPayload?.isVisible === false
        ? false
        : null;

    const leanPayload = isAlreadyPlain
      ? { ...existingPayload, isVisible: visibilityValue }
      : {
          key,
          coordinateKey,
          type,
          biomeId,
          matrix: toPlainNumericArray(payloadSource.matrix, 16),
          position: toPlainNumericArray(payloadSource.position, 3),
          scale: toPlainNumericArray(payloadSource.scale, 3),
          visualScale: toPlainNumericArray(payloadSource.visualScale, 3),
          visualOffset: toPlainNumericArray(payloadSource.visualOffset, 3),
          paletteColor: toPlainNumericArray(payloadSource.paletteColor, 3),
          tintColor: toPlainNumericArray(payloadSource.tintColor, 3),
          tintOverride: toPlainNumericArray(payloadSource.tintOverride, 3),
          destructible,
          collisionMode,
          isSolid,
          isSoft,
          isDecoration: payloadSource.isDecoration === true,
          sourceObjectId: payloadSource.sourceObjectId ?? null,
          voxelIndex: payloadSource.voxelIndex ?? null,
          prototypeKey: payloadSource.prototypeKey ?? null,
          prototypeLocalKey: payloadSource.prototypeLocalKey ?? null,
          metadata: payloadSource.metadata ?? null,
          isVisible: visibilityValue,
        };

    placement.payload = leanPayload;
    placement.materialized = false;
    placement.mesh = null;
    placement.tintAttribute = null;
    placement.index = index ?? -1;
    placement.isVisible =
      visibilityValue === null ? placement.isVisible === true : visibilityValue;

    return {
      key,
      coordinateKey,
      type,
      biomeId,
      collisionMode,
      isSolid,
      isSoft,
      destructible,
      payload: leanPayload,
      matrix: leanPayload.matrix,
      position: leanPayload.position,
      scale: leanPayload.scale,
      visualScale: leanPayload.visualScale,
      visualOffset: leanPayload.visualOffset,
      paletteColor: leanPayload.paletteColor,
      tintColor: leanPayload.tintColor,
      tintOverride: leanPayload.tintOverride,
      metadata: leanPayload.metadata,
      sourceObjectId: leanPayload.sourceObjectId,
      voxelIndex: leanPayload.voxelIndex,
      prototypeKey: leanPayload.prototypeKey,
      prototypeLocalKey: leanPayload.prototypeLocalKey,
      index: -1,
      mesh: null,
      tintAttribute: null,
      gridIndex: -1,
      gridPosition: null,
      isDecoration: leanPayload.isDecoration,
      materialized: false,
      placementIndex: index ?? -1,
      isVisible:
        visibilityValue === null
          ? placement.isVisible === true
            ? true
            : placement.isVisible === false
            ? false
            : undefined
          : visibilityValue,
    };
  };

  const populateOccupancyFromPlacements = () => {
    const typeCounts = new Map();
    const entriesByType = new Map();

    blockPlacements.forEach((placement, placementIndex) => {
      if (!placement || placement.removed) {
        return;
      }

      const record = createLeanPlacementRecord(placement, placementIndex);
      if (!record) {
        return;
      }

      typeCounts.set(record.type, (typeCounts.get(record.type) ?? 0) + 1);

      const local = assignLocalGridPosition(placement);
      if (local) {
        const occupancyIndex = toIndex(local.x, local.y, local.z);
        occupancyPlacements[occupancyIndex] = placementIndex;
        occupancyTypes[occupancyIndex] = getTypeId(record.type);
        placement.gridIndex = occupancyIndex;
        record.gridIndex = occupancyIndex;
        record.gridPosition = { x: local.x, y: local.y, z: local.z };
      }
      record.index = -1;
      record.mesh = null;
      record.tintAttribute = null;
      const normalizedVisibility = record.isVisible === true;
      record.isVisible = normalizedVisibility;
      if (record.payload && typeof record.payload === 'object') {
        record.payload.isVisible = normalizedVisibility;
      }
      placement.isVisible = normalizedVisibility;
      if (placement.payload && typeof placement.payload === 'object') {
        placement.payload.isVisible = normalizedVisibility;
      }

      let entries = entriesByType.get(record.type);
      if (!entries) {
        entries = [];
        entriesByType.set(record.type, entries);
      }
      placement.index = entries.length;
      record.index = entries.length;
      entries.push(record);

      if (record.key) {
        blockLookup.set(record.key, record);
      }
      if (record.coordinateKey && record.coordinateKey !== record.key) {
        blockLookup.set(record.coordinateKey, record);
      }
    });

    typeCounts.forEach((count, type) => {
      const previous = typeCapacities.get(type) ?? 0;
      typeCapacities.set(type, Math.max(previous, count));
    });

    typeData.clear();
    entriesByType.forEach((entries, type) => {
      const capacity = typeCapacities.get(type) ?? entries.length;
      typeData.set(type, {
        entries,
        mesh: null,
        tintAttribute: null,
        capacity: Math.max(1, capacity),
      });
    });
  };

  const populateFluidOccupancy = () => {
    const keys = ensureFluidKeysArray();
    if (!keys || keys.length === 0) {
      return;
    }
    keys.forEach((key) => {
      const coords = parseBlockKey(key);
      if (!coords) {
        return;
      }
      const localX = Math.round(coords.x - minX);
      const localZ = Math.round(coords.z - minZ);
      const localY = Math.round(coords.y) - occupancyMinY;
      if (
        localX < 0 ||
        localX >= occupancyWidth ||
        localZ < 0 ||
        localZ >= occupancyDepth ||
        localY < 0 ||
        localY >= occupancyHeight
      ) {
        return;
      }
      const index = toIndex(localX, localY, localZ);
      fluidOccupancy[index] = 1;
    });
  };

  const applyOccupancyVisibility = () => {
    if (
      !occupancyPlacements ||
      occupancyPlacements.length === 0 ||
      !(typeData instanceof Map)
    ) {
      return;
    }

    const processedPlacements = new Set();

    const setEntryVisibility = (entry, placement, exposed) => {
      const normalized = exposed === true;
      if (entry) {
        entry.isVisible = normalized;
        if (entry.payload && typeof entry.payload === 'object') {
          entry.payload.isVisible = normalized;
        }
      }
      if (placement) {
        placement.isVisible = normalized;
        if (placement.payload && typeof placement.payload === 'object') {
          placement.payload.isVisible = normalized;
        }
        processedPlacements.add(placement);
      }
    };

    const resolveGridPosition = (entry, placement) => {
      if (entry?.gridPosition) {
        return entry.gridPosition;
      }
      if (placement?.gridPosition) {
        return placement.gridPosition;
      }
      const candidateIndex = Number.isInteger(entry?.gridIndex)
        ? entry.gridIndex
        : Number.isInteger(placement?.gridIndex)
        ? placement.gridIndex
        : -1;
      if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
        return null;
      }
      const decoded = fromIndex(candidateIndex);
      if (!decoded) {
        return null;
      }
      if (entry) {
        entry.gridIndex = candidateIndex;
        entry.gridPosition = entry.gridPosition ?? {
          x: decoded.x,
          y: decoded.y,
          z: decoded.z,
        };
      }
      if (placement) {
        placement.gridIndex = candidateIndex;
        placement.gridPosition = placement.gridPosition ?? {
          x: decoded.x,
          y: decoded.y,
          z: decoded.z,
        };
      }
      return decoded;
    };

    typeData.forEach((record) => {
      if (!record || !Array.isArray(record.entries)) {
        return;
      }

      record.entries.forEach((entry) => {
        if (!entry) {
          return;
        }
        const placementIndex = Number.isInteger(entry.placementIndex)
          ? entry.placementIndex
          : -1;
        const placement =
          placementIndex >= 0 ? blockPlacements[placementIndex] ?? null : null;

        const local = resolveGridPosition(entry, placement);
        if (!local) {
          setEntryVisibility(entry, placement, true);
          return;
        }

        let exposed = false;
        for (let i = 0; i < neighborOffsets3D.length; i += 1) {
          const offset = neighborOffsets3D[i];
          const neighborX = local.x + offset.dx;
          const neighborY = local.y + offset.dy;
          const neighborZ = local.z + offset.dz;

          if (
            neighborX < 0 ||
            neighborX >= occupancyWidth ||
            neighborZ < 0 ||
            neighborZ >= occupancyDepth ||
            neighborY < 0 ||
            neighborY >= occupancyHeight
          ) {
            exposed = true;
            break;
          }

          const neighborIndex = toIndex(neighborX, neighborY, neighborZ);
          if (fluidOccupancy && fluidOccupancy[neighborIndex] === 1) {
            exposed = true;
            break;
          }

          const neighborPlacementIndex = occupancyPlacements[neighborIndex];
          if (neighborPlacementIndex < 0) {
            exposed = true;
            break;
          }
        }

        setEntryVisibility(entry, placement, exposed);
      });
    });

    blockPlacements.forEach((placement) => {
      if (!placement || placement.removed || processedPlacements.has(placement)) {
        return;
      }
      setEntryVisibility(null, placement, true);
    });
  };

  const prepareEngineForPayload = () => {
    if (payloadPrepared || isScoutDetail) {
      return;
    }
    payloadPrepared = true;

    instancedData.clear();
    blockLookup.clear();

    occupancyTypes = null;
    occupancyPlacements = null;
    fluidOccupancy = null;
    occupancyWidth = chunkSize;
    occupancyDepth = chunkSize;
    occupancyHeight = 0;
    occupancyArea = 0;
    fluidSurfaces.length = 0;

    if (isLowDetail) {
      return;
    }

    ensureOccupancyArrays();
    populateOccupancyFromPlacements();
    populateFluidOccupancy();
    applyOccupancyVisibility();
    buildFluidSurfaces();
  };

  const step = (maxColumns = Number.POSITIVE_INFINITY) => {
    try {
      if (stepState.stage === 'readyForFinalize') {
        return { done: true, processed: 0 };
      }
      const limit =
        Number.isFinite(maxColumns) && maxColumns >= 0
          ? Math.floor(maxColumns)
          : Number.POSITIVE_INFINITY;
      if (limit <= 0) {
        return { done: false, processed: 0 };
      }

      const remainingColumns = Math.max(0, totalColumns - stepState.processedColumns);
      const stepProcessed = Math.min(limit, remainingColumns);
      if (stepProcessed > 0) {
        const startIndex = stepState.processedColumns;
        for (let offset = 0; offset < stepProcessed; offset += 1) {
          processColumnAtIndex(startIndex + offset);
        }
        stepState.processedColumns += stepProcessed;
      }

      if (stepState.processedColumns < totalColumns) {
        return { done: false, processed: stepProcessed };
      }

      if (needsWorkerPayload) {
        if (cachedChunkPayload) {
          stepState.stage = 'readyForFinalize';
          return { done: true, processed: stepProcessed };
        }

        if (busy) {
          return { done: false, processed: 0 };
        }

        busy = true;
        try {
          if (isScoutDetail) {
            cachedChunkPayload = buildScoutPayload();
          } else {
            prepareEngineForPayload();
            cachedChunkPayload = buildChunkPayload({
              chunkX,
              chunkZ,
              engine: createEnginePayload(),
              worldOptions,
              includeBlockPlacements: includeBlockPlacementsInPayload,
              includeOccupancy: !isLowDetail,
            });
          }
          stepState.stage = 'readyForFinalize';
          return { done: true, processed: stepProcessed };
        } finally {
          busy = false;
        }
      }

      stepState.stage = 'readyForFinalize';
      return { done: true, processed: stepProcessed };
    } catch (error) {
      ensureTerrainSamplesReleased();
      throw error;
    }
  };

  const buildFluidSurfaces = () => {
    fluidSurfaces.length = 0;
    const neighborOffsets = [
      { key: 'px', dx: 1, dz: 0 },
      { key: 'nx', dx: -1, dz: 0 },
      { key: 'pz', dx: 0, dz: 1 },
      { key: 'nz', dx: 0, dz: -1 },
    ];

    fluidColumnsByType.forEach((columns, type) => {
      if (!columns || columns.size === 0) {
        return;
      }

      if (type === 'water') {
        logFluidDebug('processing water columns', columns.size);
      }

      const THREE = ensureThree();
      const auroraBaseColor =
        type === 'lumen_bloom' ? new THREE.Color('#74f7ff') : null;
      const auroraHighlightColor =
        type === 'lumen_bloom' ? new THREE.Color('#ffb1ff') : null;
      const auroraBlendColor =
        type === 'lumen_bloom' ? new THREE.Color('#74f7ff') : null;

      columns.forEach((column) => {
        column.surfaceY = column.maxY;
        column.bottomY = column.minY;
        if (!column.color) {
          column.color = new THREE.Color('#3a79c5');
        }
        const baseDepth = Math.max(0.05, column.surfaceY - column.bottomY);
        column.depth = Math.max(column.depth ?? baseDepth, baseDepth);
        column.isExposed = isFluidColumnExposed(column);
        if (!column.isExposed) {
          return;
        }
        if (type === 'lumen_bloom') {
          const averageAuroraIntensity =
            column.auroraIntensitySamples > 0
              ? column.auroraIntensitySum / column.auroraIntensitySamples
              : 0;
          column.localAuroraIntensity = averageAuroraIntensity;
          const averageGlowBias =
            column.glowBiasSamples > 0
              ? column.glowBiasSum / column.glowBiasSamples
              : Math.min(1, averageAuroraIntensity / 3);
          column.localAuroraGlow = averageGlowBias;
          column.localPulseRate =
            column.pulseRateSamples > 0
              ? column.pulseRateSum / column.pulseRateSamples
              : null;
          column.ridgeStrength =
            column.ridgeStrengthSamples > 0
              ? column.ridgeStrengthSum / column.ridgeStrengthSamples
              : column.ridgeStrength ?? 0;
          if (column.orientationSamples > 0) {
            const ribbonOrientation = Math.atan2(
              column.orientationVector.z,
              column.orientationVector.x,
            );
            column.ribbonOrientation = ribbonOrientation;
            column.ribbonVector = {
              x: Math.cos(ribbonOrientation),
              y: Math.sin(ribbonOrientation),
            };
          } else {
            column.ribbonOrientation = null;
            column.ribbonVector = { x: 0, y: 1 };
          }

          const orientationMix = column.ribbonOrientation
            ? (Math.sin(column.ribbonOrientation) + 1) * 0.5
            : 0.5;
          const auroraBlend = auroraBlendColor
            ? auroraBlendColor.copy(auroraBaseColor).lerp(
                auroraHighlightColor,
                orientationMix,
              )
            : null;
          const colorBlend = Math.min(
            0.75,
            (column.localAuroraGlow ?? 0) * 0.65 + (column.ridgeStrength ?? 0) * 0.5,
          );
          if (auroraBlend) {
            column.color.lerp(auroraBlend, colorBlend);
          }
          column.color.offsetHSL(0, Math.min(0.2, colorBlend * 0.35), colorBlend * 0.25);

          const depthBoost =
            Math.max(0, column.ridgeStrength ?? 0) * 0.35 +
            (column.localAuroraGlow ?? 0) * 0.25;
          column.depth = Math.max(baseDepth, baseDepth + depthBoost);
        }
      });

      if (type === 'water') {
        columns.forEach((column) => {
          if (!column.isExposed) {
            return;
          }
          const metadata = waterColumnMetadata.get(column.key);
          const bottomY = Number.isFinite(column.bottomY)
            ? column.bottomY
            : metadata?.bottomY;
          const surfaceY = Number.isFinite(column.surfaceY)
            ? column.surfaceY
            : metadata?.surfaceY;
          if (!Number.isFinite(bottomY) && !Number.isFinite(surfaceY)) {
            return;
          }
          const normalizedBottom = Number.isFinite(bottomY)
            ? bottomY
            : surfaceY;
          const normalizedSurface = Number.isFinite(surfaceY)
            ? surfaceY
            : bottomY;
          const bottom = Math.min(normalizedBottom, normalizedSurface);
          const surface = Math.max(normalizedBottom, normalizedSurface);
          waterColumnMetadata.set(column.key, {
            bottomY: bottom,
            surfaceY: surface,
          });
        });
      }

      columns.forEach((column) => {
        if (!column.isExposed) {
          return;
        }
        const neighbors = {};
        let foamExposure = 0;
        const centerSurface = column.surfaceY;

        neighborOffsets.forEach((offset) => {
          const nx = column.x + offset.dx;
          const nz = column.z + offset.dz;
          const neighborKey = `${nx}|${nz}`;
          const neighborColumn = columns.get(neighborKey);
          let neighborInfo;
          if (neighborColumn) {
            neighborInfo = {
              hasFluid: true,
              surfaceY: neighborColumn.surfaceY,
              bottomY: neighborColumn.bottomY,
              foamHint: Math.max(0, centerSurface - neighborColumn.surfaceY),
            };
          } else {
            const presence = resolveFluidPresence({
              type,
              x: nx,
              z: nz,
              sampleColumnHeight: getColumnHeight,
              worldConfig: worldOptions,
              sampleBiomeAt: sampleColumnCached,
            });
            neighborInfo = {
              hasFluid: Boolean(presence?.hasFluid),
              surfaceY: presence?.surfaceY ?? centerSurface,
              bottomY: presence?.bottomY ?? column.bottomY,
              foamHint: Math.max(0, centerSurface - (presence?.surfaceY ?? centerSurface)),
            };
          }
          neighbors[offset.key] = neighborInfo;
          foamExposure = Math.max(foamExposure, neighborInfo.foamHint ?? 0);
        });

        const dropPx = Math.max(0, centerSurface - (neighbors.px?.surfaceY ?? centerSurface));
        const dropNx = Math.max(0, centerSurface - (neighbors.nx?.surfaceY ?? centerSurface));
        const dropPz = Math.max(0, centerSurface - (neighbors.pz?.surfaceY ?? centerSurface));
        const dropNz = Math.max(0, centerSurface - (neighbors.nz?.surfaceY ?? centerSurface));

        const flowVector = new THREE.Vector2(dropPx - dropNx, dropPz - dropNz);
        let flowStrength = Math.min(1, flowVector.length() * 0.6);
        if (type === 'lumen_bloom' && column.ribbonVector) {
          const targetX = column.ribbonVector.x ?? 0;
          const targetZ = column.ribbonVector.y ?? 1;
          flowVector.set(targetX, targetZ);
          flowStrength = Math.max(
            flowStrength,
            Math.min(
              1,
              (column.localAuroraGlow ?? 0) * 0.8 + (column.ridgeStrength ?? 0) * 0.6,
            ),
          );
        }
        const directionHintSamples = column.flowDirectionHintSamples ?? 0;
        if (column.flowDirectionHint && directionHintSamples > 0) {
          const avgHintX = column.flowDirectionHint.x / directionHintSamples;
          const avgHintZ = column.flowDirectionHint.z / directionHintSamples;
          const hintMagnitude = Math.hypot(avgHintX, avgHintZ);
          if (hintMagnitude > 0.001) {
            const normalizedMagnitude = Math.min(1, hintMagnitude);
            flowVector.set(avgHintX / hintMagnitude, avgHintZ / hintMagnitude);
            flowStrength = Math.max(flowStrength, normalizedMagnitude);
          }
        }
        const strengthHintSamples = column.flowStrengthHintSamples ?? 0;
        if (strengthHintSamples > 0) {
          const averagedStrength = Math.min(
            1,
            Math.max(0, column.flowStrengthHintSum / strengthHintSamples),
          );
          flowStrength = Math.max(flowStrength, averagedStrength);
        }
        if (flowStrength > 0.001) {
          flowVector.normalize();
        } else {
          flowVector.set(0, 0);
        }

        column.neighbors = neighbors;
        column.flowDirection = flowVector;
        column.flowStrength = flowStrength;
        column.foamAmount = Math.min(
          1,
          type === 'lumen_bloom'
            ? foamExposure * 0.1 + flowStrength * 0.25
            : foamExposure * 0.18 + flowStrength * 0.4,
        );
        if (Number.isFinite(column.foamHint)) {
          column.foamAmount = Math.max(
            column.foamAmount ?? 0,
            Math.min(1, column.foamHint),
          );
        }
        const dropMax = Math.max(dropPx, dropNx, dropPz, dropNz);
        const neighborFluidCount = neighborOffsets.reduce((acc, offset) => {
          return acc + (neighbors[offset.key]?.hasFluid ? 1 : 0);
        }, 0);
        const shoreline = Math.min(
          1,
          dropMax * 0.75 + (1 - neighborFluidCount / neighborOffsets.length) * 0.45 +
            (column.foamAmount ?? 0) * 0.5,
        );
        column.shoreline = shoreline;
      });

      const columnValues = Array.from(columns.values()).filter(
        (column) => column?.isExposed,
      );
      if (columnValues.length === 0) {
        if (type === 'water') {
          logFluidDebug('water columns fully enclosed, skipping surface');
        }
        return;
      }
      const aggregatedCues = new Set();
      let auroraIntensityTotal = 0;
      let auroraIntensitySamples = 0;
      let orientationVectorX = 0;
      let orientationVectorZ = 0;
      let orientationSamples = 0;

      columnValues.forEach((column) => {
        if (column.lifecycleCues instanceof Set) {
          column.lifecycleCues.forEach((cue) => aggregatedCues.add(cue));
        }
        if (
          Number.isFinite(column.auroraIntensitySum) &&
          Number.isFinite(column.auroraIntensitySamples) &&
          column.auroraIntensitySamples > 0
        ) {
          auroraIntensityTotal += column.auroraIntensitySum;
          auroraIntensitySamples += column.auroraIntensitySamples;
        }
        if (column.orientationSamples > 0 && column.orientationVector) {
          orientationVectorX += column.orientationVector.x;
          orientationVectorZ += column.orientationVector.z;
          orientationSamples += column.orientationSamples;
        }
      });

      const hasAuroraRibbonCue = aggregatedCues.has('aurora_ribbon');
      if (type === 'lumen_bloom' && !hasAuroraRibbonCue) {
        return;
      }

      const geometry =
        type === 'lumen_bloom'
          ? buildLumenRibbonGeometry({
              THREE,
              columns: columnValues,
            })
          : buildFluidGeometry({
              THREE,
              columns: columnValues,
            });
      geometry.userData = geometry.userData || {};
      if (aggregatedCues.size > 0) {
        geometry.userData.lifecycleCues = Array.from(aggregatedCues);
      }
      if (auroraIntensitySamples > 0) {
        geometry.userData.auroraIntensity =
          auroraIntensityTotal / auroraIntensitySamples;
      }
      if (orientationSamples > 0) {
        geometry.userData.ribbonOrientation = Math.atan2(
          orientationVectorZ,
          orientationVectorX,
        );
      }
      if (!geometry.getAttribute('position') || geometry.getAttribute('position').count === 0) {
        if (type === 'water') {
          logFluidDebug('water geometry has no vertices');
        }
        return;
      }
      const surface = createFluidSurface({ type, geometry });
      if (type === 'water') {
        logFluidDebug('created water surface', surface?.uuid);
      }
      surface.userData.type = `fluid:${type}`;
      fluidSurfaces.push(surface);
    });
  };

  const finalize = () => {
    if (
      stepState.stage !== 'readyForFinalize' &&
      stepState.stage !== 'finalized'
    ) {
      throw new Error('Chunk build not complete');
    }
    if (stepState.stage === 'finalized') {
      throw new Error('Chunk already finalized');
    }
    if (needsWorkerPayload && !cachedChunkPayload) {
      throw new Error('Chunk payload not available for finalize.');
    }

    try {
      if (isScoutDetail) {
        const scoutPayload = buildScoutPayload() ?? {
          heightSummary: {
            width: chunkSize,
            depth: chunkSize,
            minHeight: Number.isFinite(worldOptions?.baseHeight)
            ? worldOptions.baseHeight
            : 0,
          maxHeight: Number.isFinite(worldOptions?.maxHeight)
            ? worldOptions.maxHeight
            : 0,
          heights: new Int16Array(0),
          biomeIds: [],
        },
        biomes: buildBiomeSummary(),
      };
      const heightSummary = scoutPayload.heightSummary ?? {
        width: chunkSize,
        depth: chunkSize,
        minHeight: Number.isFinite(worldOptions?.baseHeight)
          ? worldOptions.baseHeight
          : 0,
        maxHeight: Number.isFinite(worldOptions?.maxHeight)
          ? worldOptions.maxHeight
          : 0,
        heights: new Int16Array(0),
        biomeIds: [],
      };
      const chunkBiomes = Array.isArray(scoutPayload.biomes)
        ? scoutPayload.biomes
        : buildBiomeSummary();
      const group = new THREE.Group();
      group.name = `chunk_${chunkX}_${chunkZ}_scout`;
      group.userData = group.userData || {};
      group.userData.biomes = chunkBiomes;
      group.userData.detailLevel = DETAIL_LEVEL_SCOUT;
      group.userData.scoutSummary = heightSummary;

      let previewMesh = null;
      if (typeof scoutPreviewBuilder === 'function') {
        try {
          previewMesh = scoutPreviewBuilder({
            group,
            chunkX,
            chunkZ,
            chunkSize,
            summary: heightSummary,
          });
        } catch (error) {
          console.warn(
            '[worldgen] Failed to build scout preview mesh during finalize',
            error,
          );
        }
      }
      group.visible = Boolean(previewMesh);

      stepState.stage = 'finalized';
      recordFinalSamplingProfile();

      const halfSize = chunkSize / 2;
      const resolvedMinY = Number.isFinite(heightSummary?.minHeight)
        ? heightSummary.minHeight - 1
        : -32;
      const fallbackMaxHeight = Number.isFinite(worldOptions?.maxHeight)
        ? worldOptions.maxHeight
        : resolvedMinY + chunkSize;
      const resolvedMaxY = Number.isFinite(heightSummary?.maxHeight)
        ? heightSummary.maxHeight + 1
        : fallbackMaxHeight;

      sanitizePrototypeInstancesForLowDetail();

      const result = {
        chunkX,
        chunkZ,
        group,
        solidBlockKeys: new Set(),
        softBlockKeys: new Set(),
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
          detailLevel: detailMode,
          scoutSummary: heightSummary,
          bounds: {
            minX: chunkX * chunkSize - halfSize - 0.5,
            maxX: chunkX * chunkSize + halfSize + 0.5,
          minY: resolvedMinY,
          maxY: resolvedMaxY,
          minZ: chunkZ * chunkSize - halfSize - 0.5,
          maxZ: chunkZ * chunkSize + halfSize + 0.5,
        },
      };

      releaseCachedPayload();
      return result;
      }

      let group = null;
      let chunkBiomes = [];

    if (needsWorkerPayload) {
      const chunkPayload = cachedChunkPayload;
      const meshResult = finalizeChunkMeshes(
        chunkPayload,
        blockMaterials,
        THREE,
      );

      typeData.forEach((record) => {
        if (record?.mesh?.parent) {
          record.mesh.parent.remove(record.mesh);
        }
      });
      typeData.clear();
      typeCapacities.clear();
      meshResult.typeData.forEach((record, type) => {
        typeData.set(type, record);
        typeCapacities.set(
          type,
          Number.isFinite(record?.capacity)
            ? record.capacity
            : record.entries?.length ?? 0,
        );
      });

      blockLookup.clear();
      meshResult.blockLookup.forEach((entry, key) => {
        blockLookup.set(key, entry);
      });

      const derivedCollisionKeys = deriveCollisionKeySetsFromMesh({
        typeData,
        blockLookup,
        blockMaterials,
      });
      const occludedKeys = new Set(
        derivedCollisionKeys.occludedCoordinates ?? [],
      );
      if (
        derivedCollisionKeys.occludedEntries?.size ||
        occludedKeys.size > 0
      ) {
        const occludedEntries =
          derivedCollisionKeys.occludedEntries ?? new Set();
        blockLookup.forEach((entry, key) => {
          if (!entry || (!occludedKeys.has(key) && !occludedEntries.has(entry))) {
            if (entry) {
              entry.isVisible = true;
              if (entry.payload && typeof entry.payload === 'object') {
                entry.payload.isVisible = true;
              }
            }
            return;
          }
          entry.isVisible = false;
          if (entry.payload && typeof entry.payload === 'object') {
            entry.payload.isVisible = false;
          }
        });
      } else {
        blockLookup.forEach((entry) => {
          if (entry) {
            entry.isVisible = true;
            if (entry.payload && typeof entry.payload === 'object') {
              entry.payload.isVisible = true;
            }
          }
        });
      }
      pruneOccludedInstancedEntries({
        typeData,
        occludedEntries: derivedCollisionKeys.occludedEntries,
      });
      solidBlockKeys.clear();
      derivedCollisionKeys.solidBlockKeys.forEach((key) =>
        solidBlockKeys.add(key),
      );
      softBlockKeys.clear();
      derivedCollisionKeys.softBlockKeys.forEach((key) =>
        softBlockKeys.add(key),
      );

      fluidBlockKeys.clear();
      meshResult.fluidBlockKeys.forEach((key) => fluidBlockKeys.add(key));

      waterColumnMetadata.clear();
      meshResult.waterColumns.forEach((value, key) => {
        waterColumnMetadata.set(key, value);
      });

      fluidColumnsByType.clear();
      meshResult.fluidColumnsByType.forEach((columns, type) => {
        fluidColumnsByType.set(type, columns);
      });

      fluidSurfaces.length = 0;
      meshResult.fluidSurfaces.forEach((surface) => {
        fluidSurfaces.push(surface);
      });

      decorationData.forEach((record) => {
        if (record?.mesh?.parent) {
          record.mesh.parent.remove(record.mesh);
        }
      });
      decorationData.clear();
      decorationGroups.clear();
      decorationOwnerIndex.clear();
      decorationTypeIndex.clear();
      decorationInstancedData.clear();
      meshResult.decorationData.forEach((record, type) => {
        decorationData.set(type, record);
        decorationInstancedData.set(type, record.entries);
      });
      meshResult.decorationGroups.forEach((metadata, key) => {
        decorationGroups.set(key, metadata);
      });
      meshResult.decorationOwnerIndex.forEach((groups, owner) => {
        decorationOwnerIndex.set(owner, groups);
      });
      meshResult.decorationTypeIndex.forEach((groups, type) => {
        decorationTypeIndex.set(type, groups);
      });

      prototypeInstances.clear();
      meshResult.prototypeInstances.forEach((record, key) => {
        prototypeInstances.set(key, record);
      });

      group = meshResult.chunkGroup;
      chunkBiomes = meshResult.biomes;
    } else {
      if (!isLowDetail) {
        ensureOccupancyArrays();
        populateOccupancyFromPlacements();
        populateFluidOccupancy();
      } else {
        occupancyTypes = null;
        occupancyPlacements = null;
        fluidOccupancy = null;
        fluidSurfaces.length = 0;
      }
      applyOccupancyVisibility();
      if (!isLowDetail) {
        buildFluidSurfaces();
      }

      group = new THREE.Group();
      group.name = `chunk_${chunkX}_${chunkZ}`;

      blockLookup.clear();
      typeData.clear();

      if (isLowDetail) {
        const entriesByType = new Map();
        blockPlacements.forEach((placement) => {
          if (!placement || placement.removed) {
            return;
          }
          const { type, biome, position, instancingOptions } = placement;
          if (!type || !position) {
            return;
          }
          const entry = createInstancedEntry(
            type,
            position.x,
            position.y,
            position.z,
            biome,
            instancingOptions ?? {},
          );
          if (!entry) {
            return;
          }
          let entries = entriesByType.get(type);
          if (!entries) {
            entries = [];
            entriesByType.set(type, entries);
          }
          entries.push(entry);
        });

        entriesByType.forEach((entries, type) => {
          const capacity = Math.max(
            1,
            entries.length,
            typeCapacities.get(type) ?? 0,
          );
          const { mesh, tintAttribute } = buildInstancedMesh(entries, type, {
            capacity,
          });
          mesh.count = entries.length;
          mesh.instanceMatrix.needsUpdate = entries.length > 0;
          if (tintAttribute) {
            tintAttribute.needsUpdate = entries.length > 0;
          }
          typeCapacities.set(type, capacity);
          typeData.set(type, {
            mesh,
            tintAttribute,
            capacity,
          });
          group.add(mesh);
        });

        blockPlacements.length = 0;
        placementIndexByCoordinate.clear();
      } else {
        const entriesByType = new Map();
        blockPlacements.forEach((placement) => {
          if (!placement || placement.removed) {
            return;
          }
          const entry = materializePlacement(placement);
          if (!entry) {
            return;
          }
          entry.isSolid = placement.isSolid === true;
          entry.isSoft = placement.isSoft === true;
          entry.collisionMode = placement.collisionMode ?? entry.collisionMode;
          entry.metadata = placement.metadata ?? entry.metadata ?? null;
          entry.gridIndex = placement.gridIndex ?? entry.gridIndex ?? -1;
          entry.gridPosition = placement.gridPosition ?? entry.gridPosition ?? null;
          const placementVisibility =
            placement.isVisible === true
              ? true
              : placement.isVisible === false
              ? false
              : undefined;
          entry.isVisible = placementVisibility;
          if (typeof placementVisibility === 'boolean' && entry.payload) {
            if (typeof entry.payload === 'object') {
              entry.payload.isVisible = placementVisibility;
            }
          }
          entry.removed = false;
          if (entry.key) {
            blockLookup.set(entry.key, entry);
          }
          if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
            blockLookup.set(entry.coordinateKey, entry);
          }
          let entries = entriesByType.get(entry.type);
          if (!entries) {
            entries = [];
            entriesByType.set(entry.type, entries);
          }
          entry.index = entries.length;
          entries.push(entry);
        });

        entriesByType.forEach((entries, type) => {
          const capacity = Math.max(
            1,
            entries.length,
            typeCapacities.get(type) ?? 0,
          );
          const visibleEntries = [];
          entries.forEach((entry) => {
            if (!entry) {
              return;
            }
            const normalizedVisibility = entry.isVisible === false ? false : true;
            entry.isVisible = normalizedVisibility;
            if (entry.payload && typeof entry.payload === 'object') {
              entry.payload.isVisible = normalizedVisibility;
            }
            if (!normalizedVisibility) {
              entry.index = -1;
              entry.mesh = null;
              entry.tintAttribute = null;
              return;
            }
            visibleEntries.push(entry);
          });
          const { mesh, tintAttribute } = buildInstancedMesh(
            visibleEntries,
            type,
            {
              capacity,
            },
          );
          mesh.count = visibleEntries.length;
          mesh.instanceMatrix.needsUpdate = visibleEntries.length > 0;
          if (tintAttribute) {
            tintAttribute.needsUpdate = visibleEntries.length > 0;
          }
          typeCapacities.set(type, capacity);
          typeData.set(type, {
            entries: visibleEntries,
            allEntries: entries,
            mesh,
            tintAttribute,
            capacity,
          });
          group.add(mesh);
        });
      }

      decorationData.forEach((record) => {
        if (record?.mesh?.parent) {
          record.mesh.parent.remove(record.mesh);
        }
      });
      decorationData.clear();
      decorationGroups.clear();
      decorationOwnerIndex.clear();
      decorationTypeIndex.clear();
      if (!isLowDetail) {
        decorationInstancedData.forEach((entries, type) => {
          addDecorationMesh(group, type, entries);
        });
      }

      if (!isLowDetail) {
        fluidSurfaces.forEach((surface) => {
          if (!surface) {
            return;
          }
          if (!surface.parent) {
            group.add(surface);
          }
        });
      }

      if (!isLowDetail) {
        const derivedCollisionKeys = deriveCollisionKeySetsFromMesh({
          typeData,
          blockLookup,
          blockMaterials,
        });
        const occludedKeys = new Set(
          derivedCollisionKeys.occludedCoordinates ?? [],
        );
        if (
          derivedCollisionKeys.occludedEntries?.size ||
          occludedKeys.size > 0
        ) {
          const occludedEntries =
            derivedCollisionKeys.occludedEntries ?? new Set();
          blockLookup.forEach((entry, key) => {
            if (
              !entry ||
              (!occludedKeys.has(key) && !occludedEntries.has(entry))
            ) {
              if (entry) {
                entry.isVisible = true;
                if (entry.payload && typeof entry.payload === 'object') {
                  entry.payload.isVisible = true;
                }
              }
              return;
            }
            entry.isVisible = false;
            if (entry.payload && typeof entry.payload === 'object') {
              entry.payload.isVisible = false;
            }
          });
        } else {
          blockLookup.forEach((entry) => {
            if (entry) {
              entry.isVisible = true;
              if (entry.payload && typeof entry.payload === 'object') {
                entry.payload.isVisible = true;
              }
            }
          });
        }
        pruneOccludedInstancedEntries({
          typeData,
          occludedEntries: derivedCollisionKeys.occludedEntries,
        });
        solidBlockKeys.clear();
        derivedCollisionKeys.solidBlockKeys.forEach((key) =>
          solidBlockKeys.add(key),
        );
        softBlockKeys.clear();
        derivedCollisionKeys.softBlockKeys.forEach((key) =>
          softBlockKeys.add(key),
        );
      }

      chunkBiomes = buildBiomeSummary();
    }

    group.name = `chunk_${chunkX}_${chunkZ}`;
    group.userData = group.userData || {};
    group.userData.biomes = chunkBiomes;

    stepState.stage = 'finalized';
    recordFinalSamplingProfile();

    sanitizePrototypeInstancesForLowDetail();

    const result = {
      chunkX,
      chunkZ,
      group,
      solidBlockKeys,
      softBlockKeys,
      typeCapacities,
      waterColumns: waterColumnMetadata,
      fluidColumnsByType,
      fluidSurfaces,
      blockLookup: isLowDetail ? null : blockLookup,
      fluidBlockKeys,
      typeData,
      decorationData,
      decorationGroups,
      decorationOwnerIndex,
      decorationTypeIndex,
      biomes: chunkBiomes,
      prototypeInstances,
      detailLevel: detailMode,
      bounds: (() => {
        if (!hasBoundData) {
          const halfSize = chunkSize / 2;
          return {
            minX: chunkX * chunkSize - halfSize - 0.5,
            maxX: chunkX * chunkSize + halfSize + 0.5,
            minZ: chunkZ * chunkSize - halfSize - 0.5,
            maxZ: chunkZ * chunkSize + halfSize + 0.5,
            minY: -32,
            maxY: worldOptions.maxHeight + 32,
          };
        }
        return {
          minX: minBoundX,
          maxX: maxBoundX,
          minY: minBoundY,
          maxY: maxBoundY,
          minZ: minBoundZ,
          maxZ: maxBoundZ,
        };
      })(),
    };

    releaseCachedPayload();
    return result;
    } finally {
      ensureTerrainSamplesReleased();
    }
  };

  return {
    step,
    finalize,
    setRequiresWorkerPayload,
    releaseCachedPayload,
    exportPayloadSnapshot,
  };
}

export function generateChunk(blockMaterials, chunkX, chunkZ) {
  const task = createChunkBuildTask({ chunkX, chunkZ, blockMaterials });
  let done = false;
  while (!done) {
    const result = task.step(Number.POSITIVE_INFINITY);
    if (!result) {
      break;
    }
    done = result.done === true;
  }
  return task.finalize();
}

export function generateWorld(blockMaterials) {
  const chunk = generateChunk(blockMaterials, 0, 0);
  return {
    meshes: [...chunk.group.children],
    solidBlocks: new Set(
      (chunk.solidBlockKeys?.toJSON?.({
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
      }) ?? chunk.solidBlockKeys ?? []),
    ),
    waterColumns: new Map(chunk.waterColumns ?? []),
    biomes: chunk.biomes,
  };
}
