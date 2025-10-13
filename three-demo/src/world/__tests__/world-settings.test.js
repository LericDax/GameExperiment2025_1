import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyWorldOptions,
  getWorldOptionDescriptor,
  getWorldOptions,
  resetWorldOptions,
} from '../world-settings.js'

function readDomainWarpBudget() {
  const options = getWorldOptions()
  const domainWarp = options.terrain?.tfms?.operators?.find(
    (operator) => operator.id === 'domain-warp',
  )
  assert(domainWarp, 'expected domain-warp operator in TFMS preset')
  const amplitudeRange = domainWarp.envelope?.amplitude
  assert(amplitudeRange, 'expected domain-warp amplitude range')
  const multiplier = Number.isFinite(amplitudeRange.multiplier)
    ? amplitudeRange.multiplier
    : 0
  const max = Number.isFinite(amplitudeRange.max) ? amplitudeRange.max : 0
  const primaryAmplitude = Number.isFinite(options.terrain?.primaryAmplitude)
    ? options.terrain.primaryAmplitude
    : 0
  const effectiveWarp = Math.min(primaryAmplitude * multiplier, max)
  return { effectiveWarp, max }
}

test('applyWorldOptions clamps terrain height overrides to descriptor bounds', () => {
  resetWorldOptions()
  const baseHeightDescriptor = getWorldOptionDescriptor('terrain.baseHeight')
  assert(baseHeightDescriptor)

  applyWorldOptions({
    terrain: {
      baseHeight: baseHeightDescriptor.min - 10,
      maxHeight: baseHeightDescriptor.min - 5,
    },
  })

  const options = getWorldOptions()
  assert.equal(options.terrain.baseHeight, baseHeightDescriptor.min)
  assert.equal(options.baseHeight, baseHeightDescriptor.min)
  assert(options.terrain.maxHeight >= options.terrain.baseHeight)
})

test('applyWorldOptions clamps excessive overrides using descriptor maxima', () => {
  resetWorldOptions()
  const detailDescriptor = getWorldOptionDescriptor('terrain.detailAmplitude')
  const chunkDescriptor = getWorldOptionDescriptor('chunk.size')
  const waterDescriptor = getWorldOptionDescriptor('water.level')
  assert(detailDescriptor && chunkDescriptor && waterDescriptor)

  applyWorldOptions({
    terrain: {
      detailAmplitude: detailDescriptor.max + 100,
    },
    chunkSize: chunkDescriptor.max * 4,
    water: { level: waterDescriptor.max + 50 },
  })

  const options = getWorldOptions()
  assert.equal(options.terrain.detailAmplitude, detailDescriptor.max)
  assert.equal(options.chunk.size, chunkDescriptor.max)
  assert.equal(options.chunkSize, chunkDescriptor.max)
  assert.equal(options.water.level, waterDescriptor.max)
  assert.equal(options.waterLevel, waterDescriptor.max)
})

test('applyWorldOptions clamps biome overrides to descriptor ranges', () => {
  resetWorldOptions()
  const biomeScaleDescriptor = getWorldOptionDescriptor('biomes.scale')
  assert(biomeScaleDescriptor)

  applyWorldOptions({
    biomes: {
      scale: biomeScaleDescriptor.max * 10,
      varianceMultiplier: -100,
    },
  })

  const options = getWorldOptions()
  assert.equal(options.biomes.scale, biomeScaleDescriptor.max)
  const varianceDescriptor = getWorldOptionDescriptor('biomes.varianceMultiplier')
  assert(varianceDescriptor)
  assert.equal(options.biomes.varianceMultiplier, varianceDescriptor.min)
})

test('default TFMS derived strengths remain below saturation', () => {
  resetWorldOptions()
  const options = getWorldOptions()
  const derived = options.terrain.tfms.kamea.derivedStrengths
  assert(derived, 'expected derived TFMS strengths to be defined')
  assert.ok(
    derived.modulation < 0.95,
    `expected modulation derived strength below saturation, received ${derived.modulation}`,
  )
  assert.ok(
    derived.warp < 0.95,
    `expected warp derived strength below saturation, received ${derived.warp}`,
  )
  assert.ok(
    derived.phase < 0.95,
    `expected phase derived strength below saturation, received ${derived.phase}`,
  )
  assert.ok(
    derived.spectral < 0.95,
    `expected spectral derived strength below saturation, received ${derived.spectral}`,
  )
})

test('increasing TFMS warp strength slider is required for all-warp output', () => {
  resetWorldOptions()
  const options = getWorldOptions()
  const defaultWarp = options.terrain.tfms.kamea.warpStrength.value
  const derivedWarp = options.terrain.tfms.kamea.derivedStrengths.warp
  assert(defaultWarp < 1, 'default warp slider should retain headroom')
  assert(derivedWarp < 1, 'derived warp strength should not saturate by default')

  applyWorldOptions({
    terrain: {
      tfms: {
        kamea: {
          warpStrength: { value: 1 },
        },
      },
    },
  })

  const updated = getWorldOptions()
  assert.equal(updated.terrain.tfms.kamea.warpStrength.value, 1)
  assert(
    updated.terrain.tfms.kamea.warpStrength.value >
      updated.terrain.tfms.kamea.derivedStrengths.warp,
    'increasing the slider should exceed the derived warp baseline',
  )

  resetWorldOptions()
})

test('default domain-warp budget stays within the calibrated window', () => {
  resetWorldOptions()
  const budget = readDomainWarpBudget()
  assert.ok(
    budget.effectiveWarp >= 2,
    `expected default warp budget above two voxels, received ${budget.effectiveWarp}`,
  )
  assert.ok(
    budget.effectiveWarp <= 3,
    `expected default warp budget to remain within a three-voxel window, received ${budget.effectiveWarp}`,
  )
  assert.ok(
    budget.max <= 3,
    `expected domain-warp envelope max within calibrated range, received ${budget.max}`,
  )
})

test('domain-warp budget remains bounded when chunk size increases', () => {
  resetWorldOptions()
  applyWorldOptions({ chunk: { size: 96 } })
  const budget = readDomainWarpBudget()
  assert.ok(
    budget.effectiveWarp <= 3,
    `expected warp budget to stay within a three-voxel window, received ${budget.effectiveWarp}`,
  )
  assert.ok(
    budget.max <= 3,
    `expected envelope max within budget, received ${budget.max}`,
  )
})

test('domain-warp budget resists large primary amplitude overrides', () => {
  resetWorldOptions()
  const descriptor = getWorldOptionDescriptor('terrain.primaryAmplitude')
  assert(descriptor, 'expected primary amplitude descriptor')
  applyWorldOptions({ terrain: { primaryAmplitude: descriptor.max } })
  const budget = readDomainWarpBudget()
  assert.ok(
    budget.effectiveWarp <= 3,
    `expected warp budget to stay within calibrated bounds, received ${budget.effectiveWarp}`,
  )
  assert.ok(
    budget.max <= 3,
    `expected envelope cap within calibrated bounds, received ${budget.max}`,
  )
})
