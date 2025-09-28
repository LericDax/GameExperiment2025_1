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
