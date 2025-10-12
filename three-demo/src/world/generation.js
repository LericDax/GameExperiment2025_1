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
import { resolveBiomeTintMultiplier } from './color-utils.js';
import {
  worldOptions,
  applyWorldOptions,
  computeTerrainVerticalEnvelope,
} from './world-settings.js';
import { configureSectorObjectPlanner } from './sector-object-planner.js';
import { isBlockOccluding } from './block-occlusion.js';
import {
  sampleColumnWithCache,
  getTerrainSampleCacheStats,
  recordChunkSamplingProfile,
  primeTerrainSample,
  clearTerrainSampleCache,
} from './terrain-sample-cache.js';
export { worldOptions, getWorldOptions } from './world-settings.js';
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

function resolveTerrainClampBounds() {
  const envelope = computeTerrainVerticalEnvelope(worldOptions.chunk?.size);
  const clampRange = worldOptions.terrain?.clamp ?? null;
  const minHeight = Number.isFinite(clampRange?.min)
    ? clampRange.min
    : envelope.clampMin;
  const aliasMax = Number.isFinite(worldOptions.maxHeight)
    ? worldOptions.maxHeight
    : envelope.maxHeight;
  const clampMaxCandidate = Number.isFinite(clampRange?.max)
    ? clampRange.max
    : Math.max(aliasMax, envelope.clampMax);
  return {
    min: minHeight,
    max: Math.max(minHeight, clampMaxCandidate),
  };
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
  const bounds = resolveTerrainClampBounds();
  return Math.floor(clamp(sample.height, bounds.min, bounds.max));
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

function chunkWorldBounds(chunkX, chunkZ) {
  const { chunkSize } = worldOptions;
  const halfSize = chunkSize / 2;
  return {
    minX: chunkX * chunkSize - halfSize,
    minZ: chunkZ * chunkSize - halfSize,
  };
}

export function createChunkBuildTask({ chunkX, chunkZ, blockMaterials }) {
  const THREE = ensureThree();
  const engine = ensureTerrainEngine();
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

  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ);
  const { chunkSize, waterLevel } = worldOptions;

  const terrainSampler = (x, z) => engine.sampleColumn(x, z);

  const initialCacheStats = (() => {
    const stats = getTerrainSampleCacheStats();
    return { hits: stats.hits, misses: stats.misses };
  })();

  const sampleColumnCached = (x, z) => {
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
    const bounds = resolveTerrainClampBounds();
    return Math.floor(clamp(sample.height, bounds.min, bounds.max));
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

    return {
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
        record.blockEntries.push({ type: block.type, entry });
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
        record.decorationKeys.push(entry.key);
      }
    });

    return instanceKey;
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
        blockLookup.set(entry.key, entry);
        if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
          blockLookup.set(entry.coordinateKey, entry);
        }
      });
    });

    targetGroup.add(mesh);
  };

  const terrainClampBounds = resolveTerrainClampBounds();
  const totalColumns = chunkSize * chunkSize;

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
    const columnTop = Math.floor(height);
    const biome = columnSample.biome;
    const slope = computeSlope(worldX, worldZ, columnTop);
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
    const isUnderwater = columnTop < waterLevel;
    const waterMetrics = computeWaterMetrics(
      worldX,
      worldZ,
      columnTop,
      searchRadius,
    );
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
    const terrainFloor = Number.isFinite(terrainClampBounds?.min)
      ? Math.ceil(terrainClampBounds.min)
      : columnTop;
    const surfaceBase =
      columnTop >= 0 ? 0 : columnTop - (subSurfaceDepth - 1);
    const columnBottom = Math.max(
      terrainFloor,
      Math.min(surfaceBase, columnTop),
    );

    for (let y = columnBottom; y <= columnTop; y += 1) {
      if (y === columnTop) {
        addBlock(surfaceBlock, worldX, y, worldZ, biome);
      } else if (columnTop - y < subSurfaceDepth) {
        addBlock(subSurfaceBlock, worldX, y, worldZ, biome);
      } else {
        addBlock(deepBlock, worldX, y, worldZ, biome);
      }
    }

    if (columnTop < waterLevel) {
      for (let y = columnTop + 1; y <= waterLevel; y += 1) {
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
    const columnWasFlooded = columnTop < waterLevel;
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
      groundHeight: columnTop,
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

  const stepState = {
    stage: 'columns',
    columnIndex: 0,
    assignIndex: 0,
    fluidOccupancyIndex: 0,
    exposureIndex: 0,
    exposureInitialized: false,
  };

  const step = (maxColumns = Number.POSITIVE_INFINITY) => {
    const limit =
      Number.isFinite(maxColumns) && maxColumns >= 0
        ? maxColumns
        : Number.POSITIVE_INFINITY;
    let processed = 0;

    while (processed < limit && stepState.stage !== 'readyForFinalize') {
      if (stepState.stage === 'columns') {
        const remainingColumns = totalColumns - stepState.columnIndex;
        if (remainingColumns <= 0) {
          stepState.stage = 'prepareOccupancy';
          continue;
        }
        const batch = Math.min(limit - processed, remainingColumns);
        for (let i = 0; i < batch; i += 1) {
          processColumnAtIndex(stepState.columnIndex);
          stepState.columnIndex += 1;
        }
        processed += batch;
        if (stepState.columnIndex >= totalColumns) {
          stepState.stage = 'prepareOccupancy';
        }
        continue;
      }

      if (stepState.stage === 'prepareOccupancy') {
        if (occupancyMinY === Number.POSITIVE_INFINITY) {
          occupancyMinY = Math.floor(waterLevel ?? 0);
          occupancyMaxY = occupancyMinY;
        }
        occupancyWidth = chunkSize;
        occupancyDepth = chunkSize;
        occupancyHeight = Math.max(1, occupancyMaxY - occupancyMinY + 1);
        occupancyArea = occupancyWidth * occupancyDepth;
        const volume = occupancyArea * occupancyHeight;
        occupancyTypes = new Uint16Array(volume);
        occupancyPlacements = new Int32Array(volume);
        occupancyPlacements.fill(-1);
        fluidOccupancy = new Uint8Array(volume);
        stepState.stage = 'assignLocalPositions';
        continue;
      }

      if (stepState.stage === 'assignLocalPositions') {
        const remaining = blockPlacements.length - stepState.assignIndex;
        if (remaining <= 0) {
          stepState.stage = 'markFluidOccupancy';
          continue;
        }
        const batch = Math.min(limit - processed, remaining);
        for (let i = 0; i < batch; i += 1) {
          const placementIndex = stepState.assignIndex++;
          const placement = blockPlacements[placementIndex];
          if (!placement || placement.removed) {
            continue;
          }
          const local = assignLocalGridPosition(placement);
          if (!local) {
            continue;
          }
          const index = toIndex(local.x, local.y, local.z);
          occupancyTypes[index] = getTypeId(placement.type);
          occupancyPlacements[index] = placementIndex;
          placement.gridIndex = index;
        }
        processed += batch;
        continue;
      }

      if (stepState.stage === 'markFluidOccupancy') {
        const keys = ensureFluidKeysArray();
        const remaining = keys.length - stepState.fluidOccupancyIndex;
        if (remaining <= 0) {
          stepState.stage = 'exposure';
          continue;
        }
        const batch = Math.min(limit - processed, remaining);
        for (let i = 0; i < batch; i += 1) {
          const key = keys[stepState.fluidOccupancyIndex++];
          const coords = parseBlockKey(key);
          if (!coords) {
            continue;
          }
          const lx = Math.round(coords.x - minX);
          const lz = Math.round(coords.z - minZ);
          const ly = Math.round(coords.y) - occupancyMinY;
          if (
            lx < 0 ||
            lx >= occupancyWidth ||
            lz < 0 ||
            lz >= occupancyDepth ||
            ly < 0 ||
            ly >= occupancyHeight
          ) {
            continue;
          }
          const index = toIndex(lx, ly, lz);
          fluidOccupancy[index] = 1;
        }
        processed += batch;
        continue;
      }

      if (stepState.stage === 'exposure') {
        const remaining = blockPlacements.length - stepState.exposureIndex;
        if (!stepState.exposureInitialized) {
          const meshingMode = getMeshingDebugMode();
          stepState.legacyMeshing = meshingMode === 'legacy';
          stepState.exposureInitialized = true;
        }
        if (remaining <= 0) {
          stepState.stage = 'readyForFinalize';
          continue;
        }
        const batch = Math.min(limit - processed, remaining);
        for (let i = 0; i < batch; i += 1) {
          const placementIndex = stepState.exposureIndex++;
          const placement = blockPlacements[placementIndex];
          if (!placement || placement.removed) {
            continue;
          }

          const occluding =
            typeof placement.isOccluding === 'boolean'
              ? placement.isOccluding
              : isBlockOccluding(placement, blockMaterials);
          placement.isOccluding = occluding;
          if (!occluding && placement.coordinateKey) {
            solidBlockKeys.delete(placement.coordinateKey);
          }

          const local = placement.gridPosition;
          let exposed = stepState.legacyMeshing;
          if (!local) {
            exposed = true;
          } else if (!exposed) {
            for (let j = 0; j < neighborOffsets3D.length; j += 1) {
              const offset = neighborOffsets3D[j];
              const nx = local.x + offset.dx;
              const ny = local.y + offset.dy;
              const nz = local.z + offset.dz;
              if (
                nx < 0 ||
                nx >= occupancyWidth ||
                nz < 0 ||
                nz >= occupancyDepth ||
                ny < 0 ||
                ny >= occupancyHeight
              ) {
                exposed = true;
                break;
              }
              const neighborIndex = toIndex(nx, ny, nz);
              const neighborPlacementIndex = occupancyPlacements[neighborIndex];
              if (neighborPlacementIndex < 0) {
                if (fluidOccupancy[neighborIndex] === 1) {
                  exposed = true;
                  break;
                }
                exposed = true;
                break;
              }
              const neighborPlacement = blockPlacements[neighborPlacementIndex];
              if (!neighborPlacement || neighborPlacement === placement) {
                continue;
              }
              const neighborOccluding =
                typeof neighborPlacement.isOccluding === 'boolean'
                  ? neighborPlacement.isOccluding
                  : isBlockOccluding(neighborPlacement, blockMaterials);
              if (!neighborOccluding) {
                exposed = true;
                break;
              }
            }
          }

          if (exposed) {
            const entry = materializePlacement(placement);
            if (!entry) {
              continue;
            }
            if (!instancedData.has(entry.type)) {
              instancedData.set(entry.type, []);
            }
            const typeEntries = instancedData.get(entry.type);
            typeEntries.push(entry);
            const nextCount = typeEntries.length;
            typeCapacities.set(
              entry.type,
              Math.max(typeCapacities.get(entry.type) ?? 0, nextCount),
            );
            blockLookup.set(entry.key, entry);
            if (entry.coordinateKey && entry.coordinateKey !== entry.key) {
              blockLookup.set(entry.coordinateKey, entry);
            }
          } else {
            placement.index = -1;
            placement.mesh = null;
            placement.tintAttribute = null;
          }
          placement.isVisible = exposed;
        }
        processed += batch;
        continue;
      }

      stepState.stage = 'readyForFinalize';
    }

    return { done: stepState.stage === 'readyForFinalize', processed };
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
    buildFluidSurfaces();
    const group = new THREE.Group();
    addMeshesFromMap(group);
    decorationInstancedData.forEach((entries, type) => {
      addDecorationMesh(group, type, entries);
    });
    logFluidDebug('fluid surfaces count before group add', fluidSurfaces.length);
    fluidSurfaces.forEach((surface) => {
      if (surface.userData?.type === 'fluid:water') {
        logFluidDebug('adding water surface to group', surface.uuid);
      }
      group.add(surface);
    });
    group.name = `chunk_${chunkX}_${chunkZ}`;
    const totalSamples = chunkSize * chunkSize;
    const biomes = Array.from(biomePresence.values()).map(({ biome, samples }) => ({
      id: biome.id,
      label: biome.label,
      weight: samples / totalSamples,
      shader: {
        fogColor: `#${biome.shader.fogColor.getHexString()}`,
        tintColor: `#${biome.shader.tintColor.getHexString()}`,
        tintStrength: biome.shader.tintStrength,
      },
    }));
    group.userData.biomes = biomes;
    stepState.stage = 'finalized';
    const finalCacheStats = getTerrainSampleCacheStats();
    recordChunkSamplingProfile({
      chunkX,
      chunkZ,
      hitsBefore: initialCacheStats.hits,
      missesBefore: initialCacheStats.misses,
      hitsAfter: finalCacheStats.hits,
      missesAfter: finalCacheStats.misses,
    });
    return {
      chunkX,
      chunkZ,
      group,
      solidBlockKeys,
      softBlockKeys,
      typeCapacities,
      waterColumns: waterColumnMetadata,
      fluidColumnsByType,
      fluidSurfaces,
      blockLookup,
      fluidBlockKeys,
      typeData,
      decorationData,
      decorationGroups,
      decorationOwnerIndex,
      decorationTypeIndex,
      biomes,
      prototypeInstances,
      bounds: (() => {
        if (!hasBoundData) {
          const halfSize = chunkSize / 2;
          const safetyMargin = 2;
          const fallbackMinYBase = (() => {
            const clampMin = worldOptions?.terrain?.clamp?.min;
            if (Number.isFinite(clampMin)) {
              return clampMin;
            }
            let configuredChunkSize = worldOptions?.chunk?.size;
            if (!Number.isFinite(configuredChunkSize)) {
              configuredChunkSize = worldOptions?.chunkSize;
            }
            if (!Number.isFinite(configuredChunkSize)) {
              configuredChunkSize = 32;
            }
            return -Math.abs(configuredChunkSize) * 3;
          })();
          return {
            minX: chunkX * chunkSize - halfSize - 0.5,
            maxX: chunkX * chunkSize + halfSize + 0.5,
            minZ: chunkZ * chunkSize - halfSize - 0.5,
            maxZ: chunkZ * chunkSize + halfSize + 0.5,
            minY: fallbackMinYBase - safetyMargin,
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
  };

  return { step, finalize };
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
    solidBlocks: new Set(chunk.solidBlockKeys),
    waterColumns: new Map(chunk.waterColumns ?? []),
    biomes: chunk.biomes,
  };
}
