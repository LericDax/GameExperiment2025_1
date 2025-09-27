import { createTerrainEngine } from './terrain-engine.js';
import { populateColumnWithVoxelObjects } from './voxel-object-placement.js';
import {
  createFluidSurface,
  isFluidType,
  resolveFluidPresence,
} from './fluids/fluid-registry.js';
import { buildFluidGeometry } from './fluids/fluid-geometry.js';
import {
  initializeFluidDebug,
  logFluidDebug,
} from './fluids/fluid-debug.js';
import {
  cloneDecorationOptions,
  createDecorationMeshBatches,
} from './voxel-object-decoration-mesh.js';

initializeFluidDebug({ defaultEnabled: false, persistDefault: true, forceDefault: true });

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

let THREERef = null;
let blockGeometry = null;
let terrainEngine = null;

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

export function initializeWorldGeneration({ THREE }) {
  if (!THREE) {
    throw new Error('initializeWorldGeneration requires a THREE instance');
  }
  THREERef = THREE;
  blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  terrainEngine = createTerrainEngine({ THREE, seed: 1337, worldConfig });
}

export const worldConfig = {
  chunkSize: 48,
  maxHeight: 20,
  baseHeight: 6,
  waterLevel: 9,
};

export function terrainHeight(x, z) {
  const engine = ensureTerrainEngine();
  const sample = engine.sampleColumn(x, z);
  return Math.floor(clamp(sample.height, 2, worldConfig.maxHeight));
}

export function sampleBiomeAt(x, z) {
  const engine = ensureTerrainEngine();
  return engine.getBiomeAt(x, z);
}

function hashCoordinate(x, z, offset = 0) {
  let h = Math.imul(x | 0, 374761393);
  h = Math.imul(h + Math.imul(z | 0, 668265263), 1274126177);
  h ^= h >>> 15;
  h = Math.imul(h + Math.imul(offset | 0, 1597334677), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return h >>> 0;
}

export function randomAt(x, z, offset = 0) {
  const hashed = hashCoordinate(Math.floor(x), Math.floor(z), Math.floor(offset));
  return hashed / 4294967296;
}

const solidTypes = new Set(['grass', 'dirt', 'stone', 'sand', 'leaf', 'log']);

function blockKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

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
  const { chunkSize } = worldConfig;
  const halfSize = chunkSize / 2;
  return {
    minX: chunkX * chunkSize - halfSize,
    minZ: chunkZ * chunkSize - halfSize,
  };
}

export function generateChunk(blockMaterials, chunkX, chunkZ) {
  const THREE = ensureThree();
  const engine = ensureTerrainEngine();
  if (!blockGeometry) {
    blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  }
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
  const { chunkSize, waterLevel } = worldConfig;

  const columnSampleCache = new Map();

  const cacheKey = (x, z) => `${x}|${z}`;

  const sampleColumnCached = (x, z) => {
    const key = cacheKey(x, z);
    if (columnSampleCache.has(key)) {
      return columnSampleCache.get(key);
    }
    const sample = engine.sampleColumn(x, z);
    columnSampleCache.set(key, sample);
    return sample;
  };

  const getColumnHeight = (x, z) => {
    const sample = sampleColumnCached(x, z);
    return Math.floor(clamp(sample.height, 2, worldConfig.maxHeight));
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

  const computeWaterDistance = (x, z, baseHeight, searchRadius = 4) => {
    if (baseHeight < waterLevel) {
      return 0;
    }
    for (let radius = 1; radius <= searchRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dzRange = radius - Math.abs(dx);
        for (let dz = -dzRange; dz <= dzRange; dz++) {
          const neighborHeight = getColumnHeight(x + dx, z + dz);
          if (neighborHeight < waterLevel) {
            return radius;
          }
        }
      }
    }
    return searchRadius + 1;
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

    const coordinateKey = blockKey(x, y, z);
    const key = options.key ?? coordinateKey;

    const paletteColor = engine.getBlockColor(biome, type);
    const tintStrength = clamp(biome?.shader?.tintStrength ?? 1, 0, 1);
    const tintOverride = parseTintOverride(options.tint);
    const ignoreBiomeTint = options.ignoreBiomeTint === true;

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

      const altitudeRange = Math.max(1, worldConfig.maxHeight - waterLevel + 6);
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
    } else if (tintOverride) {
      paletteBlend.copy(tintOverride);
    } else if (paletteColor) {
      paletteBlend.copy(paletteColor);
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
    const entry = createInstancedEntry(type, x, y, z, biome, options);

    if (!instancedData.has(type)) {
      instancedData.set(type, []);
    }

    const coordinateKey = entry.coordinateKey;
    const key = entry.key;

    const isWater = type === 'water';
    const isFluid = isFluidType(type);
    let collisionMode = options.collisionMode;
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
    const isSolid = collisionMode === 'solid';
    const isSoft = collisionMode === 'soft';

    const destructible =
      typeof options.destructible === 'boolean'
        ? options.destructible
        : !isFluid && type !== 'cloud';

    if (isFluid) {
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
      return;
    }

    entry.isSolid = isSolid;
    entry.isWater = isWater;
    entry.destructible = destructible;
    entry.collisionMode = collisionMode;

    instancedData.get(type).push(entry);
    blockLookup.set(key, entry);
    if (key !== coordinateKey) {
      blockLookup.set(coordinateKey, entry);
    }
    if (isSolid) {
      solidBlockKeys.add(coordinateKey);
    }
    if (isSoft) {
      softBlockKeys.add(coordinateKey);
    }
    return entry;
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

  const buildInstancedMesh = (entries, type) => {
    const geometry = blockGeometry.clone();
    const mesh = new THREE.InstancedMesh(
      geometry,
      blockMaterials[type],
      entries.length,
    );
    mesh.userData.defaultTint = new THREE.Color(1, 1, 1);

    const tintArray = new Float32Array(entries.length * 3);
    const tintAttribute = new THREE.InstancedBufferAttribute(tintArray, 3);
    tintAttribute.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('biomeTint', tintAttribute);

    entries.forEach((entry, index) => {
      mesh.setMatrixAt(index, entry.matrix);
      entry.index = index;
      const tint = entry.tintColor ?? mesh.userData.defaultTint;
      const offset = index * 3;
      tintAttribute.array[offset] = tint.r;
      tintAttribute.array[offset + 1] = tint.g;
      tintAttribute.array[offset + 2] = tint.b;
    });

    mesh.count = entries.length;
    mesh.instanceMatrix.needsUpdate = true;
    tintAttribute.needsUpdate = true;
    mesh.castShadow = ['cloud', 'water'].includes(type) ? false : true;
    mesh.receiveShadow = type !== 'cloud';
    mesh.frustumCulled = false;
    mesh.userData.type = type;
    mesh.userData.biomePalette = true;
    mesh.userData.biomeTintAttribute = tintAttribute;

    return { mesh, tintAttribute };
  };

  const addMeshesFromMap = (targetGroup, map) => {
    map.forEach((entries, type) => {
      if (isFluidType(type)) {
        return;
      }
      if (!entries || entries.length === 0) {
        return;
      }
      const { mesh, tintAttribute } = buildInstancedMesh(entries, type);
      typeData.set(type, { entries, mesh, tintAttribute });
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

  for (let lx = 0; lx < chunkSize; lx++) {
    const worldX = minX + lx;
    for (let lz = 0; lz < chunkSize; lz++) {
      const worldZ = minZ + lz;
      const columnSample = sampleColumnCached(worldX, worldZ);
      const biome = columnSample.biome;
      const height = getColumnHeight(worldX, worldZ);
      const slope = computeSlope(worldX, worldZ, height);
      const distanceToWater = computeWaterDistance(worldX, worldZ, height);
      const isUnderwater = height < waterLevel;
      const isShore = !isUnderwater && distanceToWater <= 1;

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
        randomSource: (offset) => randomAt(worldX, worldZ, offset),
      });
    }
  }

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

    columns.forEach((column) => {
      column.surfaceY = column.maxY;
      column.bottomY = column.minY;
      if (!column.color) {
        column.color = new THREE.Color('#3a79c5');
      }
      column.depth = Math.max(0.05, column.surfaceY - column.bottomY);
    });

    if (type === 'water') {
      columns.forEach((column) => {
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
            worldConfig,
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
      const flowStrength = Math.min(1, flowVector.length() * 0.6);
      if (flowStrength > 0.001) {
        flowVector.normalize();
      } else {
        flowVector.set(0, 0);
      }

      column.neighbors = neighbors;
      column.flowDirection = flowVector;
      column.flowStrength = flowStrength;
      column.foamAmount = Math.min(1, foamExposure * 0.18 + flowStrength * 0.4);
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

    const geometry = buildFluidGeometry({
      THREE,
      columns: Array.from(columns.values()),
    });
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

  const cloudAttempts = 2 + Math.floor(randomAt(chunkX, chunkZ, 12) * 3);
  for (let i = 0; i < cloudAttempts; i++) {
    const offsetX = Math.floor(randomAt(chunkX, chunkZ, 20 + i) * chunkSize);
    const offsetZ = Math.floor(randomAt(chunkZ, chunkX, 30 + i) * chunkSize);
    const worldX = minX + offsetX;
    const worldZ = minZ + offsetZ;
    const worldY = waterLevel + 15 + Math.floor(randomAt(worldX, worldZ, 40 + i) * 8);
    addCloud(addBlock, Math.round(worldX), Math.round(worldY), Math.round(worldZ));
  }

  const group = new THREE.Group();
  addMeshesFromMap(group, instancedData);
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

  return {
    chunkX,
    chunkZ,
    group,
    solidBlockKeys,
    softBlockKeys,
    waterColumns: waterColumnMetadata,
    fluidColumnsByType,
    fluidSurfaces,
    blockLookup,
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
        return {
          minX: chunkX * chunkSize - halfSize - 0.5,
          maxX: chunkX * chunkSize + halfSize + 0.5,
          minZ: chunkZ * chunkSize - halfSize - 0.5,
          maxZ: chunkZ * chunkSize + halfSize + 0.5,
          minY: -32,
          maxY: worldConfig.maxHeight + 32,
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
