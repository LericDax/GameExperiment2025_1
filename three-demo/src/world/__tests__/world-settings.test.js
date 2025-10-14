import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyWorldOptions,
  getWorldOptionDescriptor,
  getWorldOptions,
  resetWorldOptions,
} from '../world-settings.js'

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
