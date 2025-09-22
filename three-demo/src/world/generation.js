import { createTerrainEngine } from './terrain-engine.js';

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

function addTree(addBlock, x, z, groundHeight, biome) {
  const treeRange = biome?.terrain?.treeHeight ?? { min: 3, max: 6 };
  const minHeight = Math.max(1, treeRange.min ?? 3);
  const maxHeight = Math.max(minHeight, treeRange.max ?? minHeight);
  const randomValue = randomAt(x, z, 2);
  const treeHeight = minHeight + Math.floor(randomValue * (maxHeight - minHeight + 1));
  for (let y = 1; y <= treeHeight; y++) {
    addBlock('log', x, groundHeight + y, z, biome);
  }

  const canopyRadius = Math.max(1, Math.round(treeHeight / 2));
  const canopyCenter = groundHeight + treeHeight;
  for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
    for (let dy = -canopyRadius; dy <= canopyRadius; dy++) {
      for (let dz = -canopyRadius; dz <= canopyRadius; dz++) {
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= canopyRadius + (dy === canopyRadius ? 0 : -0.3)) {
          addBlock('leaf', x + dx, canopyCenter + dy, z + dz, biome);
        }
      }
    }
  }
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
  const waterColumnKeys = new Set();
  const matrix = new THREE.Matrix4();
  const blockLookup = new Map();
  const typeData = new Map();
  const biomePresence = new Map();

  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ);
  const { chunkSize, waterLevel } = worldConfig;

  const addBlock = (type, x, y, z, biome) => {
    matrix.setPosition(x, y, z);
    if (!instancedData.has(type)) {
      instancedData.set(type, []);
    }
    const key = blockKey(x, y, z);
    const color = engine.getBlockColor(biome, type);
    const entry = {
      key,
      matrix: matrix.clone(),
      position: new THREE.Vector3(x, y, z),
      type,
      biomeId: biome?.id ?? null,
      color,
      isSolid: solidTypes.has(type),
      isWater: type === 'water',
      destructible: type !== 'water' && type !== 'cloud',
    };
    instancedData.get(type).push(entry);
    blockLookup.set(key, entry);
    if (solidTypes.has(type)) {
      solidBlockKeys.add(blockKey(x, y, z));
    }
    if (type === 'water') {
      waterColumnKeys.add(`${x}|${z}`);
    }
  };

  for (let lx = 0; lx < chunkSize; lx++) {
    const worldX = minX + lx;
    for (let lz = 0; lz < chunkSize; lz++) {
      const worldZ = minZ + lz;
      const columnSample = engine.sampleColumn(worldX, worldZ);
      const biome = columnSample.biome;
      const height = Math.floor(clamp(columnSample.height, 2, worldConfig.maxHeight));
      const isShore = height <= waterLevel + 1;
      const isUnderwater = height < waterLevel;

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
      } else {
        const treeDensity = biome?.terrain?.treeDensity ?? 0;
        if (treeDensity > 0 && randomAt(worldX, worldZ, 1) > 1 - treeDensity) {
          addTree(addBlock, worldX, worldZ, height, biome);
        }

        const shrubChance = biome?.terrain?.shrubChance ?? 0;
        if (shrubChance > 0 && randomAt(worldX, worldZ, 5) > 1 - shrubChance) {
          const shrubHeight = height + 1;
          addBlock('leaf', worldX, shrubHeight, worldZ, biome);
          if (randomAt(worldX + 10, worldZ + 10, 6) > 0.6) {
            addBlock('leaf', worldX, shrubHeight + 1, worldZ, biome);
          }
        }
      }
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
    mesh.userData.defaultColor = engine.getDefaultBlockColor();

    const needsNewInstanceColor =
      !mesh.instanceColor || mesh.instanceColor.count < entries.length;
    if (needsNewInstanceColor) {
      const colorArray = new Float32Array(entries.length * 3);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    }
    mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);

    entries.forEach((entry, index) => {
      mesh.setMatrixAt(index, entry.matrix);
      entry.index = index;
      const color = entry.color ?? engine.getDefaultBlockColor();
      if (typeof mesh.setColorAt === 'function') {
        mesh.setColorAt(index, color);
      } else if (mesh.instanceColor) {
        mesh.instanceColor.setXYZ(index, color.r, color.g, color.b);

      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = ['cloud', 'water'].includes(type) ? false : true;
    mesh.receiveShadow = type !== 'cloud';
    mesh.frustumCulled = false;
    mesh.userData.type = type;
    mesh.userData.biomePalette = true;
    typeData.set(type, { entries, mesh });
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
