import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from 'three'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const biomesDir = join(__dirname, '..', 'biomes')
const biomeModuleMap = Object.fromEntries(
  readdirSync(biomesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const contents = readFileSync(join(biomesDir, file), 'utf8')
      return [`./biomes/${file}`, JSON.parse(contents)]
    }),
)

globalThis.__BIOME_MODULE_MAP__ = biomeModuleMap

const { createTerrainEngine } = await import('../terrain-engine.js')
const {
  defaultWorldOptions,
  LEGACY_PRIMARY_SLOPE_BUDGET,
  LEGACY_DETAIL_SLOPE_BUDGET,
  LEGACY_RIDGE_SLOPE_BUDGET,
} = await import('../world-settings.js')

function computeSlopePercentile(slopes, percentile) {
  if (!Array.isArray(slopes) || slopes.length === 0) {
    return 0
  }
  const sorted = [...slopes].sort((a, b) => a - b)
  const targetIndex = Math.floor(sorted.length * percentile)
  const clampedIndex = Math.min(sorted.length - 1, targetIndex)
  return sorted[clampedIndex]
}

test('default terrain adjacent slopes stay within the calibrated budget', () => {
  const engine = createTerrainEngine({ THREE })
  try {
    const chunkSize =
      defaultWorldOptions.chunk?.size ?? defaultWorldOptions.chunkSize ?? 48
    const spacing = Math.max(1, chunkSize * 0.75)
    const sampleRadius = 6
    const gridSize = sampleRadius * 2 + 1
    const heights = []

    for (let zi = -sampleRadius; zi <= sampleRadius; zi += 1) {
      const row = []
      for (let xi = -sampleRadius; xi <= sampleRadius; xi += 1) {
        const sample = engine.sampleColumn(xi * spacing, zi * spacing)
        row.push(sample.height)
      }
      heights.push(row)
    }

    const slopes = []
    for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
        const current = heights[rowIndex][columnIndex]
        if (columnIndex + 1 < gridSize) {
          slopes.push(Math.abs(current - heights[rowIndex][columnIndex + 1]) / spacing)
        }
        if (rowIndex + 1 < gridSize) {
          slopes.push(Math.abs(current - heights[rowIndex + 1][columnIndex]) / spacing)
        }
      }
    }

    assert.ok(slopes.length > 0, 'expected slope samples to be collected')

    const slope95 = computeSlopePercentile(slopes, 0.95)
    // The scaled legacy frequencies (≈0.0057/0.0185/0.0048) yield a 95th percentile
    // neighbour slope around 0.215 with the sampling radius below. Guard slightly
    // above that plateau so future amplitude/frequency regressions trip the alarm.
    const slopeLimit = 0.26
    assert.ok(
      slope95 <= slopeLimit,
      `expected 95th percentile adjacent slope ≤ ${slopeLimit}, received ${slope95}`,
    )

    const terrain = defaultWorldOptions.terrain
    const tolerance = 1e-9

    const expectedPrimaryFrequency =
      terrain.primaryAmplitude > 0
        ? LEGACY_PRIMARY_SLOPE_BUDGET / terrain.primaryAmplitude
        : 0
    if (expectedPrimaryFrequency > 0) {
      assert.ok(
        Math.abs(terrain.primaryFrequency - expectedPrimaryFrequency) <=
          Math.max(expectedPrimaryFrequency, 1) * tolerance,
        `expected primary frequency ≈ ${expectedPrimaryFrequency}, received ${terrain.primaryFrequency}`,
      )
    }

    const expectedDetailFrequency =
      terrain.detailAmplitude > 0
        ? LEGACY_DETAIL_SLOPE_BUDGET / terrain.detailAmplitude
        : 0
    if (expectedDetailFrequency > 0) {
      assert.ok(
        Math.abs(terrain.detailFrequency - expectedDetailFrequency) <=
          Math.max(expectedDetailFrequency, 1) * tolerance,
        `expected detail frequency ≈ ${expectedDetailFrequency}, received ${terrain.detailFrequency}`,
      )
    }

    const expectedRidgeFrequency =
      terrain.ridgeStrength > 0
        ? LEGACY_RIDGE_SLOPE_BUDGET / terrain.ridgeStrength
        : 0
    if (expectedRidgeFrequency > 0) {
      assert.ok(
        Math.abs(terrain.ridgeFrequency - expectedRidgeFrequency) <=
          Math.max(expectedRidgeFrequency, 1) * tolerance,
        `expected ridge frequency ≈ ${expectedRidgeFrequency}, received ${terrain.ridgeFrequency}`,
      )
    }
  } finally {
    engine.dispose()
  }
})
