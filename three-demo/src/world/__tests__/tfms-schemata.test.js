import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

const forestCanopyBiome = {
  id: 'test_canopy',
  label: 'Test Canopy',
  tags: ['temperate', 'forest'],
  climate: { temperature: 0.6, moisture: 0.78, weight: 1 },
  terrain: {
    surfaceBlock: 'grass',
    shoreBlock: 'sand',
    subSurfaceBlock: 'dirt',
    subSurfaceDepth: 3,
    deepBlock: 'stone',
    treeDensity: 0.12,
    shrubChance: 0.08,
    flowerChance: 0.06,
    rockChance: 0.02,
    fungiChance: 0.01,
    waterPlantChance: 0,
    structureChance: 0,
    treeHeight: { min: 3, max: 6 },
    heightOffset: 0,
  },
  palette: {
    grass: '#5aa34f',
    dirt: '#7a5436',
    stone: '#8f949e',
    sand: '#d9c88d',
    leaf: '#66b756',
    log: '#7f5839',
    water: '#3a79c5',
    cloud: '#f7f8fb',
  },
  shader: { fogColor: '#a9d6ff', tintColor: '#ffffff', tintStrength: 0 },
  tfmsProfile: {
    blend: 0.8,
    schema: [
      { id: 'temperate-canopy', weight: 3 },
      { id: 'temperate-terraces', weight: 1 },
    ],
  },
};

const forestTerraceBiome = {
  id: 'test_terrace',
  label: 'Test Terrace',
  tags: ['temperate', 'forest'],
  climate: { temperature: 0.46, moisture: 0.62, weight: 1 },
  terrain: {
    surfaceBlock: 'grass',
    shoreBlock: 'sand',
    subSurfaceBlock: 'dirt',
    subSurfaceDepth: 3,
    deepBlock: 'stone',
    treeDensity: 0.06,
    shrubChance: 0.05,
    flowerChance: 0.02,
    rockChance: 0.03,
    fungiChance: 0.02,
    waterPlantChance: 0,
    structureChance: 0,
    treeHeight: { min: 2, max: 5 },
    heightOffset: 1,
  },
  palette: {
    grass: '#569c4d',
    dirt: '#745037',
    stone: '#8893a1',
    sand: '#d2c089',
    leaf: '#5ca24c',
    log: '#735033',
    water: '#366fba',
    cloud: '#f7f8fb',
  },
  shader: { fogColor: '#a9d6ff', tintColor: '#ffffff', tintStrength: 0 },
  tfmsProfile: {
    blend: 0.9,
    schema: [
      { id: 'temperate-terraces', weight: 4 },
      { id: 'temperate-bog', weight: 1 },
    ],
  },
};

globalThis.__BIOME_MODULE_MAP__ = {
  './biomes/test_canopy.json': forestCanopyBiome,
  './biomes/test_terrace.json': forestTerraceBiome,
};

const { createTerrainEngine } = await import('../terrain-engine.js');

function findCoordinateForBiome(engine, biomeId) {
  for (let x = -512; x <= 512; x += 32) {
    for (let z = -512; z <= 512; z += 32) {
      const sample = engine.getBiomeAt(x, z);
      if (sample.biome.id === biomeId) {
        return { x, z, sample };
      }
    }
  }
  throw new Error(`Could not find coordinate for biome ${biomeId}`);
}

test('schema selection is deterministic and cached across neighbouring samples', () => {
  const engine = createTerrainEngine({
    THREE,
    seed: 5179,
    worldConfig: {
      terrain: {
        tfms: {
          biomeBlendStrength: 1,
        },
      },
    },
  });

  const canopyCoord = findCoordinateForBiome(engine, 'test_canopy');
  const canopySample = engine.sampleColumn(canopyCoord.x, canopyCoord.z);
  assert.equal(canopySample.biome.id, 'test_canopy');
  assert.ok(canopySample.tfmsSchema);
  assert.ok(
    ['temperate-canopy', 'temperate-terraces'].includes(
      canopySample.tfmsSchema.id,
    ),
    'schema should be drawn from canopy pool',
  );

  const neighbourSample = engine.sampleColumn(
    canopyCoord.x + 24,
    canopyCoord.z + 24,
  );
  assert.equal(neighbourSample.tfmsSchema?.id, canopySample.tfmsSchema.id);

  const terraceCoord = findCoordinateForBiome(engine, 'test_terrace');
  const terraceSample = engine.sampleColumn(terraceCoord.x, terraceCoord.z);
  assert.equal(terraceSample.biome.id, 'test_terrace');
  assert.ok(terraceSample.tfmsSchema);
  assert.ok(
    ['temperate-terraces', 'temperate-bog'].includes(
      terraceSample.tfmsSchema.id,
    ),
    'schema should be drawn from terrace pool',
  );

  engine.dispose();
});

test('schema networks adjust modulation routing and attenuation envelopes', () => {
  const engine = createTerrainEngine({
    THREE,
    seed: 9127,
    worldConfig: {
      terrain: {
        tfms: {
          biomeBlendStrength: 1,
        },
      },
    },
  });

  const canopyCoord = findCoordinateForBiome(engine, 'test_canopy');
  const canopySample = engine.sampleColumn(canopyCoord.x, canopyCoord.z);
  const baseEntry = engine.getBaseTfmsNetwork();
  const schemaEntry = engine.getBiomeTfmsNetwork(
    'test_canopy',
    canopySample.tfmsSchema?.id,
  );

  assert.ok(schemaEntry?.network, 'expected schema network to be available');
  assert.ok(baseEntry?.network, 'expected base network to be available');

  const baseMatrixEntry = baseEntry.config.modulationMatrix.find(
    (entry) => entry.id === 'diffusion-mask->primary-fbm:amplitude',
  );
  const schemaMatrixEntry = schemaEntry.config.modulationMatrix.find(
    (entry) => entry.id === 'diffusion-mask->primary-fbm:amplitude',
  );
  assert.ok(baseMatrixEntry, 'base matrix entry missing');
  assert.ok(schemaMatrixEntry, 'schema matrix entry missing');
  assert.notEqual(
    schemaMatrixEntry.gain,
    baseMatrixEntry.gain,
    'schema should modify modulation gain',
  );

  const context = { terrain: engine.getTerrainConfig() };
  const baseResult = baseEntry.network.evaluate({
    x: canopyCoord.x,
    z: canopyCoord.z,
    context,
  });
  const overrideResult = schemaEntry.network.evaluate({
    x: canopyCoord.x,
    z: canopyCoord.z,
    context,
  });
  assert.notEqual(
    overrideResult.envelope,
    baseResult.envelope,
    'schema override should alter attenuation envelope',
  );

  engine.dispose();
});
