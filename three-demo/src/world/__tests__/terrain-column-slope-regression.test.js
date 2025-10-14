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
  computeTerrainVerticalEnvelope,
  defaultWorldOptions,
} = await import('../world-settings.js');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[index];
}

test('terrain slopes stay below common decoration thresholds after envelope scaling', () => {
  const engine = createTerrainEngine({ THREE });
  try {
    const legacyChunkSize =
      defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 48;
    const scaledChunkSize = legacyChunkSize * 2;
    const legacyEnvelope = computeTerrainVerticalEnvelope(legacyChunkSize);
    const scaledEnvelope = computeTerrainVerticalEnvelope(scaledChunkSize);
    const normalizationScale =
      legacyEnvelope.maxHeight > 0
        ? scaledEnvelope.maxHeight / legacyEnvelope.maxHeight
        : 1;
    const slopeNormalizationSpan = Math.max(6, 6 * normalizationScale);
    const clampMin = scaledEnvelope.clampMin;
    const clampMax = scaledEnvelope.clampMax;
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

    const slopes = [];
    const radius = Math.max(16, Math.floor(scaledChunkSize / 3));
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        const column = engine.sampleColumn(x, z);
        const baseHeight = Math.floor(
          clamp(column.height * normalizationScale, clampMin, clampMax),
        );
        let maxDifference = 0;
        for (const [dx, dz] of offsets) {
          const neighbor = engine.sampleColumn(x + dx, z + dz);
          const neighborHeight = Math.floor(
            clamp(neighbor.height * normalizationScale, clampMin, clampMax),
          );
          const difference = Math.abs(baseHeight - neighborHeight);
          if (difference > maxDifference) {
            maxDifference = difference;
          }
        }
        slopes.push(
          clamp(maxDifference / slopeNormalizationSpan, 0, 1),
        );
      }
    }

    assert.ok(slopes.length > 0, 'expected slope samples to be collected');

    const slope90 = computePercentile(slopes, 0.9);
    const slope95 = computePercentile(slopes, 0.95);

    assert.ok(
      slope90 <= 0.6,
      `expected 90th percentile slope ≤ 0.6 after scaling, received ${slope90}`,
    );
    assert.ok(
      slope95 <= 0.7,
      `expected 95th percentile slope ≤ 0.7 after scaling, received ${slope95}`,
    );
  } finally {
    engine.dispose();
  }
});
