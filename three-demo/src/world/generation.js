import { createTerrainEngine } from './terrain-engine.js';
import { populateColumnWithVoxelObjects } from './voxel-object-placement.js';

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
  waterLevel: 8,
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

export function randomAt(x, z, offset = 0) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + offset * 43758.5453 + worldConfig.chunkSize);
  return value - Math.floor(value);
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
  const solidBlockKeys = new Set();
  const softBlockKeys = new Set();
  const waterColumnKeys = new Set();
  const matrix = new THREE.Matrix4();
  const defaultQuaternion = new THREE.Quaternion();
  const reusablePosition = new THREE.Vector3();
  const blockLookup = new Map();
  const typeData = new Map();
  const biomePresence = new Map();

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

  const addBlock = (type, x, y, z, biome, options = {}) => {
    const scaleVector = resolveScaleVector(options.scale);
    matrix.compose(reusablePosition.set(x, y, z), defaultQuaternion, scaleVector);
    if (!instancedData.has(type)) {
      instancedData.set(type, []);
    }

    const coordinateKey = blockKey(x, y, z);
    const key = options.key ?? coordinateKey;

    const paletteColor = engine.getBlockColor(biome, type);
    const tintStrength = clamp(biome?.shader?.tintStrength ?? 1, 0, 1);

    const paletteBlend = new THREE.Color(1, 1, 1);
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

    const tintOverride = parseTintOverride(options.tint);
    if (tintOverride) {
      paletteBlend.multiply(tintOverride);
    }

    const tintColor = paletteBlend;

    const isWater = type === 'water';
    let collisionMode = options.collisionMode;
    if (!collisionMode) {
      if (isWater) {
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
        : type !== 'water' && type !== 'cloud';
    const entry = {
      key,
      coordinateKey,
      matrix: matrix.clone(),
      position: new THREE.Vector3(x, y, z),
      type,
      biomeId: biome?.id ?? null,
      paletteColor,
      tintColor,
      scale: scaleVector.clone(),
      sourceObjectId: options.sourceObjectId ?? null,
      voxelIndex: options.voxelIndex ?? null,
      metadata: options.metadata ?? null,
      tintOverride,
      isSolid,
      isWater,
      destructible,

      collisionMode,
    };
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
    if (isWater) {
      waterColumnKeys.add(`${x}|${z}`);
    }
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
  instancedData.forEach((entries, type) => {
    if (entries.length === 0) {
      return;
    }
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
    typeData.set(type, { entries, mesh, tintAttribute });
    group.add(mesh);
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
    waterColumnKeys,
    blockLookup,
    typeData,
    biomes,
  };
}

export function generateWorld(blockMaterials) {
  const chunk = generateChunk(blockMaterials, 0, 0);
  return {
    meshes: [...chunk.group.children],
    solidBlocks: new Set(chunk.solidBlockKeys),
    waterColumns: new Set(chunk.waterColumnKeys),
    biomes: chunk.biomes,
  };
}
