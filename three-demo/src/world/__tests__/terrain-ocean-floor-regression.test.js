import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const biomesDir = join(__dirname, '..', 'biomes');

const biomeModuleMap = Object.fromEntries(
  readdirSync(biomesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const contents = readFileSync(join(biomesDir, file), 'utf8');
      return [`./biomes/${file}`, JSON.parse(contents)];
    }),
);

globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap;
globalThis.__VOXEL_OBJECT_MODULE_MAP__ = {};

const generationModule = await import('../generation.js');
const {
  computeTerrainVerticalEnvelope,
  worldOptions,
  defaultWorldOptions,
} = await import('../world-settings.js');

generationModule.initializeWorldGeneration({ THREE });

function buildEnvelopeOptions(options) {
  const chunkSize =
    options?.chunk?.size ??
    options?.chunkSize ??
    defaultWorldOptions.chunk?.size ??
    defaultWorldOptions.chunkSize;
  const verticalSpanChunks =
    options?.terrain?.verticalSpanChunks ??
    options?.verticalSpanChunks ??
    defaultWorldOptions.terrain?.verticalSpanChunks ??
    defaultWorldOptions.verticalSpanChunks ??
    3;
  return { chunkSize, verticalSpanChunks };
}

function createBlockMaterials() {
  const createdMaterials = new Set();
  const registry = new Proxy(
    {},
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }
        if (typeof property !== 'string') {
          return target[property];
        }
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        target[property] = material;
        createdMaterials.add(material);
        return material;
      },
    },
  );
  return { registry, createdMaterials };
}

function evaluateChunkForDeepColumn(chunkX, chunkZ) {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const chunk = generationModule.generateChunk(blockMaterials, chunkX, chunkZ);
  const columnBounds = new Map();

  chunk.solidBlockKeys.forEach((key) => {
    const parts = key.split('|');
    if (parts.length !== 3) {
      return;
    }
    const [xStr, yStr, zStr] = parts;
    const x = Number.parseInt(xStr, 10);
    const y = Number.parseInt(yStr, 10);
    const z = Number.parseInt(zStr, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    const keyId = `${x}|${z}`;
    const bounds = columnBounds.get(keyId) ?? { min: y, max: y };
    bounds.min = Math.min(bounds.min, y);
    bounds.max = Math.max(bounds.max, y);
    columnBounds.set(keyId, bounds);
  });

  const negativeColumns = Array.from(columnBounds.entries()).filter(([, bounds]) => bounds.max < 0);
  if (negativeColumns.length === 0) {
    createdMaterials.forEach((material) => material.dispose?.());
    return null;
  }

  negativeColumns.sort((a, b) => a[1].max - b[1].max);
  const [columnKey, bounds] = negativeColumns[0];
  const [xStr, zStr] = columnKey.split('|');
  const columnX = Number.parseInt(xStr, 10);
  const columnZ = Number.parseInt(zStr, 10);

  return {
    chunk,
    chunkX,
    chunkZ,
    columnX,
    columnZ,
    bounds,
    dispose() {
      createdMaterials.forEach((material) => material.dispose?.());
    },
  };
}

function locateDeepOceanColumn() {
  const preferredChunks = [
    { chunkX: -6, chunkZ: -6 },
    { chunkX: -6, chunkZ: -5 },
    { chunkX: -5, chunkZ: -6 },
    { chunkX: -6, chunkZ: -4 },
    { chunkX: -4, chunkZ: -6 },
  ];

  for (const candidate of preferredChunks) {
    const result = evaluateChunkForDeepColumn(candidate.chunkX, candidate.chunkZ);
    if (result) {
      return result;
    }
  }

  const searchRadius = 6;
  const candidates = [];
  for (let chunkX = -searchRadius; chunkX <= searchRadius; chunkX += 1) {
    for (let chunkZ = -searchRadius; chunkZ <= searchRadius; chunkZ += 1) {
      const distance = Math.max(Math.abs(chunkX), Math.abs(chunkZ));
      candidates.push({ chunkX, chunkZ, distance });
    }
  }

  candidates.sort((a, b) => {
    if (b.distance !== a.distance) {
      return b.distance - a.distance;
    }
    const absXDiff = Math.abs(b.chunkX) - Math.abs(a.chunkX);
    if (absXDiff !== 0) {
      return absXDiff;
    }
    const absZDiff = Math.abs(b.chunkZ) - Math.abs(a.chunkZ);
    if (absZDiff !== 0) {
      return absZDiff;
    }
    if (b.chunkX !== a.chunkX) {
      return b.chunkX - a.chunkX;
    }
    return b.chunkZ - a.chunkZ;
  });

  for (const candidate of candidates) {
    const result = evaluateChunkForDeepColumn(candidate.chunkX, candidate.chunkZ);
    if (result) {
      return result;
    }
  }

  return null;
}

test('deep ocean columns extend to the terrain clamp floor', () => {
  const chunkSize =
    worldOptions.chunk?.size ??
    worldOptions.chunkSize ??
    defaultWorldOptions.chunk?.size ??
    defaultWorldOptions.chunkSize ??
    48;

  const envelope = computeTerrainVerticalEnvelope(buildEnvelopeOptions(worldOptions));
  const clampRange = worldOptions.terrain?.clamp ?? null;
  const terrainFloor = Math.ceil(
    Number.isFinite(clampRange?.min) ? clampRange.min : envelope.clampMin,
  );

  const result = locateDeepOceanColumn();
  assert.ok(
    result,
    'expected to locate a negative-height ocean column within the search radius',
  );

  try {
    const { chunk, columnX, columnZ, bounds } = result;
    assert.ok(bounds.max < 0, 'expected located column to be fully underwater');

    assert.equal(
      bounds.min,
      terrainFloor,
      `expected ocean column to reach terrain floor ${terrainFloor}`,
    );

    const floorKey = generationModule.makeBlockKey(
      columnX,
      terrainFloor,
      columnZ,
    );
    const surfaceKey = generationModule.makeBlockKey(columnX, bounds.max, columnZ);

    assert.ok(
      chunk.solidBlockKeys.has(floorKey),
      'expected terrain floor block to be present in the generated column',
    );
    assert.ok(
      chunk.solidBlockKeys.has(surfaceKey),
      'expected the highest solid block in the column to be tracked',
    );
  } finally {
    result.dispose();
  }
});
