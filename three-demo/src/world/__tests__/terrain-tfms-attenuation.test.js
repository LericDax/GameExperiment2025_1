import assert from 'node:assert/strict';
import test from 'node:test';
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

const { createTerrainEngine } = await import('../terrain-engine.js');
const { defaultWorldOptions } = await import('../world-settings.js');

function getEnvelopeFromSample(sample, terrainConfig) {
  const climateAdjustment =
    (sample.climate.moisture - 0.5) * terrainConfig.climateHeightInfluence;
  const biomeOffset = sample.biome?.terrain?.heightOffset ?? 0;
  return sample.height - terrainConfig.baseHeight - climateAdjustment - biomeOffset;
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const clampedPercentile = Math.min(1, Math.max(0, percentile));
  const index = Math.floor(clampedPercentile * (sorted.length - 1));
  return sorted[index];
}

test('terrain engine scales TFMS envelopes by the configured base attenuation', () => {
  const seed = 4242;
  const position = { x: 96, z: -128 };
  const referenceClamp = { min: -100, max: 100 };
  const attenuation = 0.5;

  const referenceEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
        tfms: {
          biomeBlendStrength: 0,
          baseAttenuation: 1,
          clamp: referenceClamp,
        },
      },
    },
  });

  const referenceConfig = referenceEngine.getTerrainConfig();
  const referenceSample = referenceEngine.sampleColumn(position.x, position.z);
  const referenceEnvelope = getEnvelopeFromSample(
    referenceSample,
    referenceConfig,
  );

  const attenuatedEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
        tfms: {
          biomeBlendStrength: 0,
          baseAttenuation: attenuation,
          clamp: referenceClamp,
        },
      },
    },
  });

  const attenuatedConfig = attenuatedEngine.getTerrainConfig();
  const attenuatedSample = attenuatedEngine.sampleColumn(position.x, position.z);
  const attenuatedEnvelope = getEnvelopeFromSample(
    attenuatedSample,
    attenuatedConfig,
  );

  const expectedEnvelope = referenceEnvelope * attenuation;

  assert.ok(
    Math.abs(attenuatedEnvelope - expectedEnvelope) < 1e-6,
    `expected envelope ${expectedEnvelope}, received ${attenuatedEnvelope}`,
  );

  referenceEngine.dispose();
  attenuatedEngine.dispose();
});

test('terrain engine clamps scaled TFMS envelopes to configured bounds', () => {
  const seed = 4242;
  const position = { x: 96, z: -128 };
  const referenceClamp = { min: -100, max: 100 };
  const clampBounds = { min: -0.1, max: 0.1 };
  const attenuation = 10;

  const referenceEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
        tfms: {
          biomeBlendStrength: 0,
          baseAttenuation: 1,
          clamp: referenceClamp,
        },
      },
    },
  });

  const referenceConfig = referenceEngine.getTerrainConfig();
  const referenceSample = referenceEngine.sampleColumn(position.x, position.z);
  const referenceEnvelope = getEnvelopeFromSample(
    referenceSample,
    referenceConfig,
  );

  referenceEngine.dispose();

  const clampedEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
        tfms: {
          biomeBlendStrength: 0,
          baseAttenuation: attenuation,
          clamp: clampBounds,
        },
      },
    },
  });

  const clampedConfig = clampedEngine.getTerrainConfig();
  const clampedSample = clampedEngine.sampleColumn(position.x, position.z);
  const clampedEnvelope = getEnvelopeFromSample(clampedSample, clampedConfig);

  const scaledEnvelope = referenceEnvelope * attenuation;
  const expectedEnvelope = Math.max(
    clampBounds.min,
    Math.min(clampBounds.max, scaledEnvelope),
  );

  assert.ok(
    Math.abs(clampedEnvelope - expectedEnvelope) < 1e-6,
    `expected clamped envelope ${expectedEnvelope}, received ${clampedEnvelope}`,
  );
  assert.ok(
    scaledEnvelope <= clampBounds.min || scaledEnvelope >= clampBounds.max,
    'scaled envelope should exceed clamp bounds to validate regression',
  );

  clampedEngine.dispose();
});

test('default terrain adjacent-column slope percentile stays within the expected envelope', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const gridRadius = 24;
    const sampleSpacing = 1;
    const gridSize = gridRadius * 2 + 1;
    const heights = [];

    for (let zi = -gridRadius; zi <= gridRadius; zi += 1) {
      const row = [];
      for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
        const { height } = engine.sampleColumn(xi * sampleSpacing, zi * sampleSpacing);
        row.push(height);
      }
      heights.push(row);
    }

    const slopes = [];
    for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
        const current = heights[rowIndex][columnIndex];
        if (columnIndex + 1 < gridSize) {
          const east = heights[rowIndex][columnIndex + 1];
          slopes.push(Math.abs(east - current) / sampleSpacing);
        }
        if (rowIndex + 1 < gridSize) {
          const south = heights[rowIndex + 1][columnIndex];
          slopes.push(Math.abs(south - current) / sampleSpacing);
        }
      }
    }

    const slope95 = computePercentile(slopes, 0.95);
    const slopeThreshold = 1.25;

    assert.ok(
      slope95 < slopeThreshold,
      `expected 95th percentile slope < ${slopeThreshold}, received ${slope95}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default terrain median slope remains within the gentle slope target', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const gridRadius = 16;
    const sampleSpacing = 6;
    const gridSize = gridRadius * 2 + 1;
    const heights = [];

    for (let zi = -gridRadius; zi <= gridRadius; zi += 1) {
      const row = [];
      for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
        const { height } = engine.sampleColumn(xi * sampleSpacing, zi * sampleSpacing);
        row.push(height);
      }
      heights.push(row);
    }

    const slopes = [];
    for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
        const current = heights[rowIndex][columnIndex];
        if (columnIndex + 1 < gridSize) {
          const east = heights[rowIndex][columnIndex + 1];
          slopes.push(Math.abs(east - current) / sampleSpacing);
        }
        if (rowIndex + 1 < gridSize) {
          const south = heights[rowIndex + 1][columnIndex];
          slopes.push(Math.abs(south - current) / sampleSpacing);
        }
      }
    }

    const medianSlope = computePercentile(slopes, 0.5);
    const medianThreshold = 0.55;

    assert.ok(
      medianSlope < medianThreshold,
      `expected median slope < ${medianThreshold}, received ${medianSlope}`,
    );
  } finally {
    engine.dispose();
  }
});

test('high-amplitude terrain keeps neighbour slopes within the budget', () => {
  const defaultTerrain = defaultWorldOptions.terrain;
  const maxHeight = defaultTerrain.maxHeight;
  const primaryAmplitude = Math.max(defaultTerrain.primaryAmplitude, maxHeight * 0.8);
  const detailAmplitude = Math.max(defaultTerrain.detailAmplitude, maxHeight * 0.35);

  const engine = createTerrainEngine({
    THREE,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        maxHeight,
        clamp: { min: -maxHeight, max: maxHeight },
        primaryAmplitude,
        detailAmplitude,
        climateHeightInfluence: 0,
        tfms: {
          baseAttenuation: 1,
          biomeBlendStrength: 0,
          clamp: { min: -maxHeight, max: maxHeight },
        },
      },
    },
  });

  try {
    const gridRadius = 18;
    const sampleSpacing = 4;
    const gridSize = gridRadius * 2 + 1;
    const heights = [];

    for (let zi = -gridRadius; zi <= gridRadius; zi += 1) {
      const row = [];
      for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
        const { height } = engine.sampleColumn(xi * sampleSpacing, zi * sampleSpacing);
        row.push(height);
      }
      heights.push(row);
    }

    const slopes = [];
    for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
        const current = heights[rowIndex][columnIndex];
        if (columnIndex + 1 < gridSize) {
          const east = heights[rowIndex][columnIndex + 1];
          slopes.push(Math.abs(east - current) / sampleSpacing);
        }
        if (rowIndex + 1 < gridSize) {
          const south = heights[rowIndex + 1][columnIndex];
          slopes.push(Math.abs(south - current) / sampleSpacing);
        }
      }
    }

    const displacements = slopes.map((slope) => slope * sampleSpacing);
    const chunkSize =
      defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 64;
    const displacementBudget = Math.min(maxHeight * 0.35, chunkSize * 0.85);
    const percentileDisplacement = computePercentile(displacements, 0.98);
    assert.ok(
      percentileDisplacement < displacementBudget,
      `expected 98th percentile displacement < ${displacementBudget}, received ${percentileDisplacement}`,
    );

    const maxDisplacement = displacements.reduce(
      (highest, value) => Math.max(highest, value),
      0,
    );
    const hardCap = Math.min(maxHeight * 0.5, chunkSize * 1);
    assert.ok(
      maxDisplacement < hardCap,
      `expected maximum displacement < ${hardCap}, received ${maxDisplacement}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default domain warp displacement stays within the calibrated budget', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const baseNetworkEntry = engine.getBaseTfmsNetwork();
    assert.ok(baseNetworkEntry?.network, 'expected base TFMS network');
    const { network } = baseNetworkEntry;
    const terrainConfig = engine.getTerrainConfig();

    const gridRadius = 64;
    const sampleSpacing = 4;
    let maxWarpMagnitude = 0;
    let maxWarpAxis = 0;

    for (let zi = -gridRadius; zi <= gridRadius; zi += sampleSpacing) {
      for (let xi = -gridRadius; xi <= gridRadius; xi += sampleSpacing) {
        const result = network.evaluate({
          x: xi,
          z: zi,
          context: { terrain: terrainConfig },
        });
        const primaryOperator = result.operators.find(
          (entry) => entry.config.id === 'primary-fbm',
        );
        if (!primaryOperator) {
          continue;
        }
        const warp = primaryOperator.domainWarp ?? { x: 0, z: 0 };
        const axisMagnitude = Math.max(
          Math.abs(warp.x ?? 0),
          Math.abs(warp.z ?? 0),
        );
        const vectorMagnitude = Math.hypot(warp.x ?? 0, warp.z ?? 0);
        if (axisMagnitude > maxWarpAxis) {
          maxWarpAxis = axisMagnitude;
        }
        if (vectorMagnitude > maxWarpMagnitude) {
          maxWarpMagnitude = vectorMagnitude;
        }
      }
    }

    assert.ok(Number.isFinite(maxWarpAxis), 'domain warp sampling failed');
    const displacementBudget = 3;
    assert.ok(
      maxWarpAxis <= displacementBudget,
      `expected domain warp to stay within ${displacementBudget} voxels, received max axis displacement ${maxWarpAxis.toFixed(
        2,
      )} (vector magnitude ${maxWarpMagnitude.toFixed(2)})`,
    );
    assert.ok(
      maxWarpMagnitude <= displacementBudget,
      `expected domain warp vector magnitude <= ${displacementBudget}, received ${maxWarpMagnitude.toFixed(2)}`,
    );
  } finally {
    engine.dispose();
  }
});
