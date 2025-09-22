import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

class ValueNoise2D {
  constructor(seed = 1) {
    this.seed = seed;
  }

  hash(x, y) {
    const s = Math.sin(x * 374761393 + y * 668265263 + this.seed * 951.1357);
    return s - Math.floor(s);
  }

  smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const sx = this.smoothstep(x - x0);
    const sy = this.smoothstep(y - y0);

    const n0 = this.hash(x0, y0);
    const n1 = this.hash(x1, y0);
    const ix0 = THREE.MathUtils.lerp(n0, n1, sx);

    const n2 = this.hash(x0, y1);
    const n3 = this.hash(x1, y1);
    const ix1 = THREE.MathUtils.lerp(n2, n3, sx);

    return THREE.MathUtils.lerp(ix0, ix1, sy);
  }
}

const noiseGenerator = new ValueNoise2D(1337);

export const worldConfig = {
  chunkSize: 48,
  maxHeight: 20,
  baseHeight: 6,
  waterLevel: 8,
};

export function terrainHeight(x, z) {
  const frequency1 = 0.06;
  const frequency2 = 0.12;
  const amplitude1 = 8;
  const amplitude2 = 3;

  const n1 = noiseGenerator.noise(x * frequency1, z * frequency1);
  const n2 = noiseGenerator.noise(x * frequency2 + 100, z * frequency2 + 100);
  const combined = n1 * amplitude1 + n2 * amplitude2;
  const height = worldConfig.baseHeight + combined;
  return Math.floor(THREE.MathUtils.clamp(height, 2, worldConfig.maxHeight));
}

export function randomAt(x, z, offset = 0) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + offset * 43758.5453 + worldConfig.chunkSize);
  return value - Math.floor(value);
}

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const solidTypes = new Set(['grass', 'dirt', 'stone', 'sand', 'leaf', 'log']);

function blockKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function addTree(addBlock, x, z, groundHeight) {
  const treeHeight = 3 + Math.floor(randomAt(x, z, 2) * 3);
  for (let y = 1; y <= treeHeight; y++) {
    addBlock('log', x, groundHeight + y, z);
  }

  const canopyRadius = 2;
  const canopyCenter = groundHeight + treeHeight;
  for (let dx = -canopyRadius; dx <= canopyRadius; dx++) {
    for (let dy = -canopyRadius; dy <= canopyRadius; dy++) {
      for (let dz = -canopyRadius; dz <= canopyRadius; dz++) {
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= canopyRadius + (dy === canopyRadius ? 0 : -0.3)) {
          addBlock('leaf', x + dx, canopyCenter + dy, z + dz);
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
  blocks.forEach(([dx, dy, dz]) => addBlock('cloud', x + dx, y + dy, z + dz));
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
  const instancedData = {
    grass: [],
    dirt: [],
    stone: [],
    sand: [],
    water: [],
    leaf: [],
    log: [],
    cloud: [],
  };
  const solidBlockKeys = new Set();
  const waterColumnKeys = new Set();
  const matrix = new THREE.Matrix4();

  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ);
  const { chunkSize, waterLevel } = worldConfig;

  const addBlock = (type, x, y, z) => {
    matrix.setPosition(x, y, z);
    instancedData[type].push(matrix.clone());
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
      const height = terrainHeight(worldX, worldZ);
      const surfaceType = height <= waterLevel + 1 ? 'sand' : 'grass';

      for (let y = 0; y <= height; y++) {
        if (y === height) {
          addBlock(surfaceType, worldX, y, worldZ);
        } else if (y < height - 4) {
          addBlock('stone', worldX, y, worldZ);
        } else {
          addBlock('dirt', worldX, y, worldZ);
        }
      }

      if (height < waterLevel) {
        for (let y = height + 1; y <= waterLevel; y++) {
          addBlock('water', worldX, y, worldZ);
        }
      } else if (surfaceType === 'grass' && randomAt(worldX, worldZ, 1) > 0.92) {
        addTree(addBlock, worldX, worldZ, height);
      }

      if (randomAt(worldX, worldZ, 5) > 0.98 && height > waterLevel + 4) {
        const shrubHeight = height + 1;
        addBlock('leaf', worldX, shrubHeight, worldZ);
        if (randomAt(worldX + 10, worldZ + 10, 6) > 0.6) {
          addBlock('leaf', worldX, shrubHeight + 1, worldZ);
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
  Object.entries(instancedData).forEach(([type, matrices]) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      blockGeometry,
      blockMaterials[type],
      matrices.length
    );
    matrices.forEach((m, index) => mesh.setMatrixAt(index, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = ['cloud', 'water'].includes(type) ? false : true;
    mesh.receiveShadow = type !== 'cloud';
    mesh.frustumCulled = false;
    group.add(mesh);
  });

  group.name = `chunk_${chunkX}_${chunkZ}`;

  return {
    chunkX,
    chunkZ,
    group,
    solidBlockKeys,
    waterColumnKeys,
  };
}

export function generateWorld(blockMaterials) {
  const chunk = generateChunk(blockMaterials, 0, 0);
  return {
    meshes: [...chunk.group.children],
    solidBlocks: new Set(chunk.solidBlockKeys),
    waterColumns: new Set(chunk.waterColumnKeys),
  };
}
