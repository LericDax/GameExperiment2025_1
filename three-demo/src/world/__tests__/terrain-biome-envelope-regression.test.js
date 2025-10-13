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
const { computeTerrainVerticalEnvelope, defaultWorldOptions } = await import(
  '../world-settings.js'
);

function getEnvelopeFromSample(sample, terrainConfig) {
  const climateAdjustment =
    (sample.climate.moisture - 0.5) * terrainConfig.climateHeightInfluence;
  const biomeOffset = sample.biome?.terrain?.heightOffset ?? 0;
  return sample.height - terrainConfig.baseHeight - climateAdjustment - biomeOffset;
}

test('default biome blends stay within the three-chunk TFMS envelope', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const terrainConfig = engine.getTerrainConfig();
    const envelope = computeTerrainVerticalEnvelope(defaultWorldOptions.chunk.size);
    const clampMin = envelope.clampMin;
    const clampMax = envelope.clampMax;

    const sampleRadius = 6;
    const spacing = defaultWorldOptions.chunk.size * 0.75;
    const gridSize = sampleRadius * 2 + 1;
    const heightGrid = [];
    const envelopes = [];
    const biomeIds = new Set();

    for (let zi = -sampleRadius; zi <= sampleRadius; zi += 1) {
      const row = [];
      for (let xi = -sampleRadius; xi <= sampleRadius; xi += 1) {
        const sample = engine.sampleColumn(xi * spacing, zi * spacing);
        biomeIds.add(sample.biome?.id ?? 'unknown');
        envelopes.push(getEnvelopeFromSample(sample, terrainConfig));
        row.push(sample.height);
      }
      heightGrid.push(row);
    }

    const minEnvelope = Math.min(...envelopes);
    const maxEnvelope = Math.max(...envelopes);
    const tolerance = 1e-3;
    assert.ok(
      minEnvelope >= clampMin - tolerance && maxEnvelope <= clampMax + tolerance,
      `expected TFMS envelope within ${clampMin}–${clampMax}, received ${minEnvelope}–${maxEnvelope}`,
    );

    let maxDeltaX = 0;
    let maxDeltaZ = 0;
    const neighborSlopes = [];
    for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
        const current = heightGrid[rowIndex][columnIndex];
        if (columnIndex + 1 < gridSize) {
          const delta = Math.abs(current - heightGrid[rowIndex][columnIndex + 1]);
          if (delta > maxDeltaX) {
            maxDeltaX = delta;
          }
          neighborSlopes.push(delta / spacing);
        }
        if (rowIndex + 1 < gridSize) {
          const delta = Math.abs(current - heightGrid[rowIndex + 1][columnIndex]);
          if (delta > maxDeltaZ) {
            maxDeltaZ = delta;
          }
          neighborSlopes.push(delta / spacing);
        }
      }
    }

    const variationThreshold = 0.1;
    assert.ok(
      maxDeltaX > variationThreshold && maxDeltaZ > variationThreshold,
      `expected terrain variation along both axes (Δx=${maxDeltaX}, Δz=${maxDeltaZ})`,
    );

    neighborSlopes.sort((a, b) => a - b);
    const slopePercentileIndex = Math.floor(neighborSlopes.length * 0.95);
    const slope95 = neighborSlopes[Math.min(neighborSlopes.length - 1, slopePercentileIndex)];
    const slopeThreshold = 0.35;
    assert.ok(
      slope95 <= slopeThreshold,
      `expected 95th percentile neighbour slope ≤ ${slopeThreshold}, received ${slope95}`,
    );

    assert.ok(
      biomeIds.size >= 3,
      `expected at least three blended biomes, received ${biomeIds.size}`,
    );
  } finally {
    engine.dispose();
  }
});
