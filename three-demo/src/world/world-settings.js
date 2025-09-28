const defaultTerrainClamp = Object.freeze({
  min: 2,
  max: 20,
})

const defaultBiomeTuning = Object.freeze({
  scale: 0.003,
  detailMultiplier: 2.15,
  moistureDetailMultiplier: 1.18,
  varianceMultiplier: 0.45,
  variationStrength: 0.18,
})

export const biomeOptionMetadata = Object.freeze({
  scale: Object.freeze({
    default: defaultBiomeTuning.scale,
    min: 0.0005,
    max: 0.02,
    description:
      'Base frequency for the temperature/moisture noise fields. Lower values produce larger biome continents.',
  }),
  detailMultiplier: Object.freeze({
    default: defaultBiomeTuning.detailMultiplier,
    min: 0.1,
    max: 10,
    description:
      'Multiplier applied to the base scale for secondary climate detail noise.',
  }),
  moistureDetailMultiplier: Object.freeze({
    default: defaultBiomeTuning.moistureDetailMultiplier,
    min: 0.1,
    max: 4,
    description:
      'Multiplier that adjusts the moisture detail scale relative to the temperature field.',
  }),
  varianceMultiplier: Object.freeze({
    default: defaultBiomeTuning.varianceMultiplier,
    min: 0,
    max: 2,
    description:
      'Controls how strongly biome variance noise distorts the climate map.',
  }),
  variationStrength: Object.freeze({
    default: defaultBiomeTuning.variationStrength,
    min: 0,
    max: 1,
    description:
      'Strength of the random jitter applied when selecting the closest biome.',
  }),
})

export const defaultWorldOptions = Object.freeze({
  seed: 1337,
  chunkSize: 48,
  baseHeight: 6,
  maxHeight: 20,
  waterLevel: 9,
  chunk: Object.freeze({
    size: 48,
  }),
  water: Object.freeze({
    level: 9,
  }),
  terrain: Object.freeze({
    baseHeight: 6,
    maxHeight: 20,
    clamp: defaultTerrainClamp,
  }),
  biomes: defaultBiomeTuning,
})

function createMutableWorldOptions() {
  return {
    seed: defaultWorldOptions.seed,
    chunkSize: defaultWorldOptions.chunkSize,
    baseHeight: defaultWorldOptions.baseHeight,
    maxHeight: defaultWorldOptions.maxHeight,
    waterLevel: defaultWorldOptions.waterLevel,
    chunk: { size: defaultWorldOptions.chunk.size },
    water: { level: defaultWorldOptions.water.level },
    terrain: {
      baseHeight: defaultWorldOptions.terrain.baseHeight,
      maxHeight: defaultWorldOptions.terrain.maxHeight,
      clamp: { ...defaultWorldOptions.terrain.clamp },
    },
    biomes: { ...defaultWorldOptions.biomes },
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function normalizeNumber(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return value
}

export const worldOptions = createMutableWorldOptions()

export function getWorldOptions() {
  return worldOptions
}

export function applyWorldOptions(overrides = {}) {
  if (!isObject(overrides)) {
    return worldOptions
  }

  if ('seed' in overrides) {
    worldOptions.seed = normalizeNumber(overrides.seed, worldOptions.seed)
  }

  const chunkOverrides = isObject(overrides.chunk) ? overrides.chunk : null
  const resolvedChunkSize = normalizeNumber(
    chunkOverrides?.size ?? overrides.chunkSize,
    null,
  )
  if (resolvedChunkSize !== null) {
    const size = Math.max(1, Math.floor(resolvedChunkSize))
    worldOptions.chunkSize = size
    worldOptions.chunk.size = size
  }

  const terrainOverrides = isObject(overrides.terrain) ? overrides.terrain : null

  const resolvedBaseHeight = normalizeNumber(
    terrainOverrides?.baseHeight ?? overrides.baseHeight,
    null,
  )
  if (resolvedBaseHeight !== null) {
    worldOptions.baseHeight = resolvedBaseHeight
    worldOptions.terrain.baseHeight = resolvedBaseHeight
  }

  const resolvedMaxHeight = normalizeNumber(
    terrainOverrides?.maxHeight ?? overrides.maxHeight,
    null,
  )
  if (resolvedMaxHeight !== null) {
    worldOptions.maxHeight = resolvedMaxHeight
    worldOptions.terrain.maxHeight = resolvedMaxHeight
    worldOptions.terrain.clamp.max = resolvedMaxHeight
  }

  const clampOverrides = isObject(terrainOverrides?.clamp)
    ? terrainOverrides.clamp
    : null
  const resolvedClampMin = normalizeNumber(clampOverrides?.min, null)
  if (resolvedClampMin !== null) {
    worldOptions.terrain.clamp.min = resolvedClampMin
  }
  const resolvedClampMax = normalizeNumber(clampOverrides?.max, null)
  if (resolvedClampMax !== null) {
    worldOptions.terrain.clamp.max = resolvedClampMax
    worldOptions.maxHeight = Math.max(worldOptions.maxHeight, resolvedClampMax)
  }

  const waterOverrides = isObject(overrides.water) ? overrides.water : null
  const resolvedWaterLevel = normalizeNumber(
    waterOverrides?.level ?? overrides.waterLevel,
    null,
  )
  if (resolvedWaterLevel !== null) {
    worldOptions.waterLevel = resolvedWaterLevel
    worldOptions.water.level = resolvedWaterLevel
  }

  if ('biomes' in overrides && isObject(overrides.biomes)) {
    Object.entries(overrides.biomes).forEach(([key, value]) => {
      if (
        Object.prototype.hasOwnProperty.call(worldOptions.biomes, key) &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        worldOptions.biomes[key] = value
      }
    })
  }

  return worldOptions
}

export function resetWorldOptions() {
  const fresh = createMutableWorldOptions()

  worldOptions.seed = fresh.seed
  worldOptions.chunkSize = fresh.chunkSize
  worldOptions.baseHeight = fresh.baseHeight
  worldOptions.maxHeight = fresh.maxHeight
  worldOptions.waterLevel = fresh.waterLevel

  Object.assign(worldOptions.chunk, fresh.chunk)
  Object.assign(worldOptions.water, fresh.water)
  Object.assign(worldOptions.terrain, fresh.terrain)
  worldOptions.terrain.clamp.min = fresh.terrain.clamp.min
  worldOptions.terrain.clamp.max = fresh.terrain.clamp.max

  Object.keys(worldOptions.biomes).forEach((key) => {
    delete worldOptions.biomes[key]
  })
  Object.assign(worldOptions.biomes, fresh.biomes)

  return worldOptions
}
