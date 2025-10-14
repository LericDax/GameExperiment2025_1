import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyWorldOptions,
  getWorldOptions,
  getWorldScale,
  resetWorldOptions,
  computeTerrainVerticalEnvelope,
  defaultWorldOptions,
  LEGACY_PRIMARY_SLOPE_BUDGET,
  LEGACY_DETAIL_SLOPE_BUDGET,
  LEGACY_RIDGE_SLOPE_BUDGET,
} from '../world-settings.js'
import {
  clearTerrainSampleCache,
  invalidateTerrainSamplesForChunk,
  primeTerrainSample,
  sampleColumnWithCache,
} from '../terrain-sample-cache.js'
import { computeWorldScale } from '../world-scale.js'

test('computeWorldScale normalizes odd chunk bounds', () => {
  const scale = computeWorldScale({ size: 33 })
  assert.equal(scale.size, 33)
  assert.equal(scale.halfExtent, 16)
  assert.equal(scale.verticalSpanChunks, 3)
  assert.equal(scale.verticalExtent, scale.size * scale.verticalSpanChunks)
  assert.equal(scale.verticalClampMin, -scale.verticalExtent)
  assert.equal(scale.verticalClampMax, scale.verticalExtent)

  const originBounds = scale.chunkWorldBounds(0, 0)
  assert.equal(originBounds.minX, -16)
  assert.equal(originBounds.maxX, 16)

  const eastBounds = scale.chunkWorldBounds(1, 0)
  assert.equal(originBounds.maxX + 1, eastBounds.minX)

  const westBounds = scale.chunkWorldBounds(-1, 0)
  assert.equal(westBounds.maxX + 1, originBounds.minX)

  assert.equal(scale.worldToChunk(16), 0)
  assert.equal(scale.worldToChunk(17), 1)
  assert.equal(scale.worldToChunk(-16), 0)
  assert.equal(scale.worldToChunk(-17), -1)
})

test('terrain cache invalidation respects odd chunk bounds', () => {
  clearTerrainSampleCache()

  const chunkSize = 33
  const scale = computeWorldScale({ size: chunkSize })

  const insideSample = { height: 10 }
  const outsideSample = { height: 20 }

  primeTerrainSample(0, 0, insideSample)
  primeTerrainSample(scale.chunkWorldBounds(0, 0).maxX + 1, 0, outsideSample)

  invalidateTerrainSamplesForChunk({
    chunkX: 0,
    chunkZ: 0,
    chunkSize,
  })

  let samplerCalls = 0
  const sampler = (x, z) => {
    samplerCalls += 1
    return { height: 99, x, z }
  }

  samplerCalls = 0
  const refreshed = sampleColumnWithCache(0, 0, sampler)
  assert.equal(samplerCalls, 1)
  assert.equal(refreshed.height, 99)

  samplerCalls = 0
  const cached = sampleColumnWithCache(scale.chunkWorldBounds(0, 0).maxX + 1, 0, sampler)
  assert.equal(samplerCalls, 0)
  assert.strictEqual(cached, outsideSample)

  clearTerrainSampleCache()
})

test('world scale integrates with world settings when chunk size changes', () => {
  resetWorldOptions()
  applyWorldOptions({ chunk: { size: 33 } })

  const options = getWorldOptions()
  const scale = getWorldScale()

  assert.equal(options.chunk.size, 33)
  assert.equal(options.chunkSize, 33)
  assert.strictEqual(options.scale, scale)

  const originBounds = scale.chunkWorldBounds(0, 0)
  const eastBounds = scale.chunkWorldBounds(1, 0)
  assert.equal(originBounds.maxX + 0.5, eastBounds.minX - 0.5)

  resetWorldOptions()
})

test('vertical span scaling updates clamps and slope budgets', () => {
  resetWorldOptions()
  const customSpan = 4
  const chunkSize = 48

  applyWorldOptions({
    chunk: { size: chunkSize },
    terrain: { verticalSpanChunks: customSpan },
  })

  const options = getWorldOptions()
  const scale = getWorldScale()

  try {
    assert.equal(options.terrain.verticalSpanChunks, customSpan)
    assert.equal(options.verticalSpanChunks, customSpan)
    assert.equal(scale.verticalSpanChunks, customSpan)
    assert.equal(scale.verticalExtent, scale.size * customSpan)
    assert.equal(scale.verticalClampMin, -scale.verticalExtent)
    assert.equal(scale.verticalClampMax, scale.verticalExtent)

    const envelope = computeTerrainVerticalEnvelope({
      chunkSize: options.chunk.size,
      verticalSpanChunks: options.terrain.verticalSpanChunks,
    })
    assert.equal(envelope.maxHeight, scale.verticalExtent)
    assert.equal(envelope.clampMin, scale.verticalClampMin)
    assert.equal(envelope.clampMax, scale.verticalClampMax)

    const primarySlope =
      options.terrain.primaryFrequency * options.terrain.primaryAmplitude
    const detailSlope =
      options.terrain.detailFrequency * options.terrain.detailAmplitude
    const ridgeSlope =
      options.terrain.ridgeFrequency * options.terrain.ridgeStrength
    const expectedPrimary = LEGACY_PRIMARY_SLOPE_BUDGET
    const expectedDetail = LEGACY_DETAIL_SLOPE_BUDGET
    const expectedRidge = LEGACY_RIDGE_SLOPE_BUDGET
    const tolerance = 1e-3

    assert.ok(
      Math.abs(primarySlope - expectedPrimary) <= tolerance,
      `expected primary slope budget ≈ ${expectedPrimary}, received ${primarySlope}`,
    )
    assert.ok(
      Math.abs(detailSlope - expectedDetail) <= tolerance,
      `expected detail slope budget ≈ ${expectedDetail}, received ${detailSlope}`,
    )
    assert.ok(
      Math.abs(ridgeSlope - expectedRidge) <= tolerance,
      `expected ridge slope budget ≈ ${expectedRidge}, received ${ridgeSlope}`,
    )

    assert.equal(options.terrain.clamp.min, scale.verticalClampMin)
    assert.equal(options.terrain.clamp.max, scale.verticalClampMax)
  } finally {
    resetWorldOptions()
  }
})
