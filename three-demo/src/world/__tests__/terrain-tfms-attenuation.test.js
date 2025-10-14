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
const {
  defaultWorldOptions,
  LEGACY_PRIMARY_SLOPE_BUDGET,
  LEGACY_DETAIL_SLOPE_BUDGET,
  LEGACY_TFMS_PRIMARY_AMPLITUDE,
  LEGACY_TFMS_DETAIL_AMPLITUDE,
} = await import('../world-settings.js');

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

function measureSlopeStatistics(engine, { gridRadius, sampleSpacing }) {
  const clampedSpacing = Math.max(1, sampleSpacing);
  const gridSize = gridRadius * 2 + 1;
  const heights = [];

  for (let zi = -gridRadius; zi <= gridRadius; zi += 1) {
    const row = [];
    for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
      const { height } = engine.sampleColumn(xi * clampedSpacing, zi * clampedSpacing);
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
        slopes.push(Math.abs(east - current) / clampedSpacing);
      }
      if (rowIndex + 1 < gridSize) {
        const south = heights[rowIndex + 1][columnIndex];
        slopes.push(Math.abs(south - current) / clampedSpacing);
      }
    }
  }

  return {
    slopes,
    median: computePercentile(slopes, 0.5),
    percentile95: computePercentile(slopes, 0.95),
    percentile98: computePercentile(slopes, 0.98),
    percentile995: computePercentile(slopes, 0.995),
  };
}

function sampleHeightGrid(engine, { gridRadius, sampleSpacing }) {
  const clampedSpacing = Math.max(1, sampleSpacing);
  const gridSize = gridRadius * 2 + 1;
  const grid = [];

  for (let zi = -gridRadius; zi <= gridRadius; zi += 1) {
    const row = [];
    for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
      const { height } = engine.sampleColumn(xi * clampedSpacing, zi * clampedSpacing);
      row.push(height);
    }
    grid.push(row);
  }

  return { grid, gridSize, spacing: clampedSpacing };
}

function computeWarpDeltaMetrics(warpedGrid, referenceGrid, spacing) {
  const { grid: warpedHeights, gridSize } = warpedGrid;
  const { grid: referenceHeights } = referenceGrid;
  const displacements = [];
  const slopeDeltas = [];
  const warpedNeighbourSlopes = [];

  for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
      const warped = warpedHeights[rowIndex][columnIndex];
      const baseline = referenceHeights[rowIndex][columnIndex];
      displacements.push(Math.abs(warped - baseline));

      if (columnIndex + 1 < gridSize) {
        const warpedEast = warpedHeights[rowIndex][columnIndex + 1];
        const baselineEast = referenceHeights[rowIndex][columnIndex + 1];
        const warpedSlope = Math.abs(warpedEast - warped) / spacing;
        const baselineSlope = Math.abs(baselineEast - baseline) / spacing;
        warpedNeighbourSlopes.push(warpedSlope);
        slopeDeltas.push(Math.abs(warpedSlope - baselineSlope));
      }

      if (rowIndex + 1 < gridSize) {
        const warpedSouth = warpedHeights[rowIndex + 1][columnIndex];
        const baselineSouth = referenceHeights[rowIndex + 1][columnIndex];
        const warpedSlope = Math.abs(warpedSouth - warped) / spacing;
        const baselineSlope = Math.abs(baselineSouth - baseline) / spacing;
        warpedNeighbourSlopes.push(warpedSlope);
        slopeDeltas.push(Math.abs(warpedSlope - baselineSlope));
      }
    }
  }

  return {
    displacements,
    slopeDeltas,
    displacement95: computePercentile(displacements, 0.95),
    displacementMax: displacements.length > 0 ? Math.max(...displacements) : 0,
    slopeDelta95: computePercentile(slopeDeltas, 0.95),
    slopeDeltaMax: slopeDeltas.length > 0 ? Math.max(...slopeDeltas) : 0,
    warpedSlope95: computePercentile(warpedNeighbourSlopes, 0.95),
    warpedSlopeMax:
      warpedNeighbourSlopes.length > 0
        ? Math.max(...warpedNeighbourSlopes)
        : 0,
  };
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

test('default domain warp displaces coordinates by only a few voxels', () => {
  const seed = 8137;
  const gridRadius = 6;
  const sampleSpacing = 4;

  const warpedEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
      },
    },
  });

  const unwarpedEngine = createTerrainEngine({
    THREE,
    seed,
    worldConfig: {
      baseHeight: 0,
      terrain: {
        baseHeight: 0,
        climateHeightInfluence: 0,
        tfms: {
          operators: [
            {
              id: 'domain-warp',
              envelope: {
                amplitude: { value: 0 },
                warp: {
                  x: { value: 0 },
                  z: { value: 0 },
                },
              },
              modulation: {
                warp: {
                  x: { value: 0 },
                  z: { value: 0 },
                },
              },
            },
          ],
          modulationMatrix: [
            { id: 'domain-warp->primary-fbm:domain-x', gain: 0 },
            { id: 'domain-warp->primary-fbm:domain-z', gain: 0 },
            { id: 'domain-warp->ridge-noise:domain-x', gain: 0 },
            { id: 'domain-warp->ridge-noise:domain-z', gain: 0 },
          ],
        },
      },
    },
  });

  const warpedGrid = sampleHeightGrid(warpedEngine, { gridRadius, sampleSpacing });
  const unwarpedGrid = sampleHeightGrid(unwarpedEngine, {
    gridRadius,
    sampleSpacing,
  });

  const metrics = computeWarpDeltaMetrics(
    warpedGrid,
    unwarpedGrid,
    warpedGrid.spacing,
  );
  const fineWarpedGrid = sampleHeightGrid(warpedEngine, {
    gridRadius,
    sampleSpacing: 1,
  });
  const fineUnwarpedGrid = sampleHeightGrid(unwarpedEngine, {
    gridRadius,
    sampleSpacing: 1,
  });
  const fineMetrics = computeWarpDeltaMetrics(fineWarpedGrid, fineUnwarpedGrid, 1);

  const terrain = defaultWorldOptions.terrain;
  const primaryRatio =
    Math.max(terrain.primaryAmplitude, 1) / LEGACY_TFMS_PRIMARY_AMPLITUDE;
  const detailRatio =
    Math.max(terrain.detailAmplitude, 1) / LEGACY_TFMS_DETAIL_AMPLITUDE;
  const slopeBudget = Math.min(
    LEGACY_PRIMARY_SLOPE_BUDGET * primaryRatio,
    LEGACY_DETAIL_SLOPE_BUDGET * detailRatio,
  );
  const slopeDelta95Budget = slopeBudget;
  const slopeDeltaMaxBudget = slopeBudget * 1.1;
  const warpSlope95Budget = slopeBudget * 1.02;
  const warpSlopeMaxBudget = slopeBudget * 1.12;
  const displacement95Budget = 2.75;
  const displacementMaxBudget = 4.5;

  assert.ok(
    metrics.displacement95 <= displacement95Budget,
    `expected 95th percentile displacement <= ${displacement95Budget}, received ${metrics.displacement95}`,
  );
  assert.ok(
    metrics.displacementMax <= displacementMaxBudget,
    `expected max displacement <= ${displacementMaxBudget}, received ${metrics.displacementMax}`,
  );
  assert.ok(
    metrics.slopeDelta95 <= slopeDelta95Budget,
    `expected 95th percentile slope delta <= ${slopeDelta95Budget}, received ${metrics.slopeDelta95}`,
  );
  assert.ok(
    metrics.slopeDeltaMax <= slopeDeltaMaxBudget,
    `expected max slope delta <= ${slopeDeltaMaxBudget}, received ${metrics.slopeDeltaMax}`,
  );
  assert.ok(
    metrics.warpedSlope95 <= warpSlope95Budget,
    `expected 95th percentile warped slope <= ${warpSlope95Budget}, received ${metrics.warpedSlope95}`,
  );
  assert.ok(
    metrics.warpedSlopeMax <= warpSlopeMaxBudget,
    `expected max warped slope <= ${warpSlopeMaxBudget}, received ${metrics.warpedSlopeMax}`,
  );
  assert.ok(
    fineMetrics.slopeDelta95 <= slopeDelta95Budget,
    `expected neighbouring slope delta (spacing 1) 95th percentile <= ${slopeDelta95Budget}, received ${fineMetrics.slopeDelta95}`,
  );
  assert.ok(
    fineMetrics.slopeDeltaMax <= slopeDeltaMaxBudget,
    `expected neighbouring slope delta (spacing 1) max <= ${slopeDeltaMaxBudget}, received ${fineMetrics.slopeDeltaMax}`,
  );
  assert.ok(
    fineMetrics.warpedSlope95 <= warpSlope95Budget,
    `expected neighbouring warped slope (spacing 1) 95th percentile <= ${warpSlope95Budget}, received ${fineMetrics.warpedSlope95}`,
  );
  assert.ok(
    fineMetrics.warpedSlopeMax <= warpSlopeMaxBudget,
    `expected neighbouring warped slope (spacing 1) max <= ${warpSlopeMaxBudget}, received ${fineMetrics.warpedSlopeMax}`,
  );

  warpedEngine.dispose();
  unwarpedEngine.dispose();
});

test('default terrain neighbour slopes respect the legacy budget', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const stats = measureSlopeStatistics(engine, {
      gridRadius: 24,
      sampleSpacing: 4,
    });

    const terrain = defaultWorldOptions.terrain;
    const primaryRatio =
      Math.max(terrain.primaryAmplitude, 1) / LEGACY_TFMS_PRIMARY_AMPLITUDE;
    const detailRatio =
      Math.max(terrain.detailAmplitude, 1) / LEGACY_TFMS_DETAIL_AMPLITUDE;
    const primarySlopeBudget = LEGACY_PRIMARY_SLOPE_BUDGET * primaryRatio;
    const detailSlopeBudget = LEGACY_DETAIL_SLOPE_BUDGET * detailRatio;
    const slopeBudget = Math.min(primarySlopeBudget, detailSlopeBudget);
    const allowance = slopeBudget * 1.08;

    assert.ok(
      stats.percentile95 <= allowance,
      `expected 95th percentile slope <= ${allowance}, received ${stats.percentile95}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default terrain neighbour slopes stay within the legacy slope ceiling', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const chunkSize =
      defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 48;
    const chunkSpacing = Math.max(1, Math.round(chunkSize * 0.75));
    const stats = measureSlopeStatistics(engine, {
      gridRadius: 24,
      sampleSpacing: chunkSpacing,
    });

    const legacySlopeCeiling = Math.min(
      LEGACY_PRIMARY_SLOPE_BUDGET,
      LEGACY_DETAIL_SLOPE_BUDGET,
    );

    assert.ok(
      stats.percentile95 <= legacySlopeCeiling,
      `expected 95th percentile slope at spacing ${chunkSpacing} <= ${legacySlopeCeiling}, received ${stats.percentile95}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default terrain slope distribution stays within calibrated targets', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const { median, percentile95 } = measureSlopeStatistics(engine, {
      gridRadius: 24,
      sampleSpacing: 1,
    });

    const combinedSlopeBudget =
      LEGACY_PRIMARY_SLOPE_BUDGET + LEGACY_DETAIL_SLOPE_BUDGET;
    const medianThreshold = combinedSlopeBudget * 0.16;
    const slope95Threshold = combinedSlopeBudget * 1.5;

    assert.ok(
      median <= medianThreshold,
      `expected median slope <= ${medianThreshold}, received ${median}`,
    );
    assert.ok(
      percentile95 <= slope95Threshold,
      `expected 95th percentile slope <= ${slope95Threshold}, received ${percentile95}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default terrain neighbour slopes rarely exceed the calibrated threshold', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const { percentile98, percentile995 } = measureSlopeStatistics(engine, {
      gridRadius: 24,
      sampleSpacing: 1,
    });

    const terrain = defaultWorldOptions.terrain;
    const primaryRatio =
      Math.max(terrain.primaryAmplitude, 1) / LEGACY_TFMS_PRIMARY_AMPLITUDE;
    const detailRatio =
      Math.max(terrain.detailAmplitude, 1) / LEGACY_TFMS_DETAIL_AMPLITUDE;
    const primarySlopeBudget = LEGACY_PRIMARY_SLOPE_BUDGET * primaryRatio;
    const detailSlopeBudget = LEGACY_DETAIL_SLOPE_BUDGET * detailRatio;
    const frequentSlopeThreshold = Math.min(
      primarySlopeBudget * 0.55,
      detailSlopeBudget * 2.7,
    );
    const rareSlopeThreshold = Math.max(
      primarySlopeBudget * 0.8,
      detailSlopeBudget * 3.5,
    );

    assert.ok(
      percentile98 < frequentSlopeThreshold,
      `expected 98th percentile slope < ${frequentSlopeThreshold}, received ${percentile98}`,
    );
    assert.ok(
      percentile995 < rareSlopeThreshold,
      `expected 99.5th percentile slope < ${rareSlopeThreshold}, received ${percentile995}`,
    );
  } finally {
    engine.dispose();
  }
});

test('default terrain median slope remains within the gentle slope target', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const { median } = measureSlopeStatistics(engine, {
      gridRadius: 16,
      sampleSpacing: 6,
    });
    const medianThreshold = 0.3;

    assert.ok(
      median < medianThreshold,
      `expected median slope < ${medianThreshold}, received ${median}`,
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
    const sampleSpacing = 4;
    const { slopes, percentile98 } = measureSlopeStatistics(engine, {
      gridRadius: 18,
      sampleSpacing,
    });
    const displacements = slopes.map((slope) => slope * sampleSpacing);
    const chunkSize =
      defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 64;
    const displacementBudget = Math.min(maxHeight * 0.35, chunkSize * 0.85);
    const percentileDisplacement = percentile98 * sampleSpacing;
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
