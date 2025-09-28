const defaultTerrainClamp = Object.freeze({
  min: 2,
  max: 20,
})

const defaultTerrainOptions = Object.freeze({
  baseHeight: 6,
  maxHeight: 20,
  clamp: defaultTerrainClamp,
  primaryFrequency: 0.06,
  primaryAmplitude: 8,
  primaryOffset: 0,
  detailFrequency: 0.12,
  detailAmplitude: 3,
  detailOffset: 100,
  ridgeFrequency: 0.02,
  ridgeStrength: 2.4,
  ridgeOffset: 220,
  climateHeightInfluence: 1.2,
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
  baseHeight: defaultTerrainOptions.baseHeight,
  maxHeight: defaultTerrainOptions.maxHeight,
  waterLevel: 9,
  chunk: Object.freeze({
    size: 48,
  }),
  water: Object.freeze({
    level: 9,
  }),
  terrain: defaultTerrainOptions,
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
      baseHeight: defaultTerrainOptions.baseHeight,
      maxHeight: defaultTerrainOptions.maxHeight,
      clamp: { ...defaultTerrainOptions.clamp },
      primaryFrequency: defaultTerrainOptions.primaryFrequency,
      primaryAmplitude: defaultTerrainOptions.primaryAmplitude,
      primaryOffset: defaultTerrainOptions.primaryOffset,
      detailFrequency: defaultTerrainOptions.detailFrequency,
      detailAmplitude: defaultTerrainOptions.detailAmplitude,
      detailOffset: defaultTerrainOptions.detailOffset,
      ridgeFrequency: defaultTerrainOptions.ridgeFrequency,
      ridgeStrength: defaultTerrainOptions.ridgeStrength,
      ridgeOffset: defaultTerrainOptions.ridgeOffset,
      climateHeightInfluence: defaultTerrainOptions.climateHeightInfluence,
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

const TERRAIN_OPTION_BOUNDS = Object.freeze({
  baseHeight: Object.freeze({ min: 0, max: 512 }),
  maxHeight: Object.freeze({ min: 1, max: 1024 }),
  clampMin: Object.freeze({ min: 0, max: 1024 }),
  clampMax: Object.freeze({ min: 1, max: 1024 }),
  primaryFrequency: Object.freeze({ min: 0.0001, max: 1 }),
  primaryAmplitude: Object.freeze({ min: 0, max: 256 }),
  primaryOffset: Object.freeze({ min: -10000, max: 10000 }),
  detailFrequency: Object.freeze({ min: 0.0001, max: 2 }),
  detailAmplitude: Object.freeze({ min: 0, max: 128 }),
  detailOffset: Object.freeze({ min: -10000, max: 10000 }),
  ridgeFrequency: Object.freeze({ min: 0.0001, max: 1 }),
  ridgeStrength: Object.freeze({ min: 0, max: 64 }),
  ridgeOffset: Object.freeze({ min: -10000, max: 10000 }),
  climateHeightInfluence: Object.freeze({ min: -10, max: 10 }),
})

function normalizeWithBounds(value, fallback, boundsKey) {
  const bounds = TERRAIN_OPTION_BOUNDS[boundsKey] ?? {}
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  let normalized = value
  if (Number.isFinite(bounds.min)) {
    normalized = Math.max(bounds.min, normalized)
  }
  if (Number.isFinite(bounds.max)) {
    normalized = Math.min(bounds.max, normalized)
  }
  return normalized
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
    const baseHeight = normalizeWithBounds(
      resolvedBaseHeight,
      worldOptions.terrain.baseHeight,
      'baseHeight',
    )
    worldOptions.baseHeight = baseHeight
    worldOptions.terrain.baseHeight = baseHeight
  }

  const resolvedMaxHeight = normalizeNumber(
    terrainOverrides?.maxHeight ?? overrides.maxHeight,
    null,
  )
  if (resolvedMaxHeight !== null) {
    const maxHeight = normalizeWithBounds(
      resolvedMaxHeight,
      worldOptions.terrain.maxHeight,
      'maxHeight',
    )
    worldOptions.maxHeight = maxHeight
    worldOptions.terrain.maxHeight = maxHeight
    worldOptions.terrain.clamp.max = Math.max(
      worldOptions.terrain.clamp.max,
      maxHeight,
    )
  }

  const clampOverrides = isObject(terrainOverrides?.clamp)
    ? terrainOverrides.clamp
    : null
  const resolvedClampMin = normalizeNumber(clampOverrides?.min, null)
  if (resolvedClampMin !== null) {
    worldOptions.terrain.clamp.min = normalizeWithBounds(
      resolvedClampMin,
      worldOptions.terrain.clamp.min,
      'clampMin',
    )
  }
  const resolvedClampMax = normalizeNumber(clampOverrides?.max, null)
  if (resolvedClampMax !== null) {
    const clampMax = normalizeWithBounds(
      resolvedClampMax,
      worldOptions.terrain.clamp.max,
      'clampMax',
    )
    worldOptions.terrain.clamp.max = clampMax
    worldOptions.maxHeight = Math.max(worldOptions.maxHeight, clampMax)
  }

  const terrainOptionKeys = [
    'primaryFrequency',
    'primaryAmplitude',
    'primaryOffset',
    'detailFrequency',
    'detailAmplitude',
    'detailOffset',
    'ridgeFrequency',
    'ridgeStrength',
    'ridgeOffset',
    'climateHeightInfluence',
  ]

  terrainOptionKeys.forEach((key) => {
    if (key in (terrainOverrides ?? {})) {
      worldOptions.terrain[key] = normalizeWithBounds(
        terrainOverrides[key],
        worldOptions.terrain[key],
        key,
      )
    }
  })

  worldOptions.baseHeight = normalizeWithBounds(
    worldOptions.baseHeight,
    defaultTerrainOptions.baseHeight,
    'baseHeight',
  )
  worldOptions.terrain.baseHeight = worldOptions.baseHeight

  const minimumMaxHeight = Math.max(
    worldOptions.baseHeight,
    worldOptions.terrain.baseHeight,
  )
  worldOptions.terrain.maxHeight = Math.max(
    normalizeWithBounds(
      worldOptions.terrain.maxHeight,
      defaultTerrainOptions.maxHeight,
      'maxHeight',
    ),
    minimumMaxHeight,
  )
  worldOptions.maxHeight = Math.max(
    normalizeWithBounds(
      worldOptions.maxHeight,
      defaultTerrainOptions.maxHeight,
      'maxHeight',
    ),
    worldOptions.terrain.maxHeight,
  )

  const ridgeContribution = Math.max(0, worldOptions.terrain.ridgeStrength)
  const estimatedTerrainMax =
    worldOptions.terrain.baseHeight +
    worldOptions.terrain.primaryAmplitude +
    worldOptions.terrain.detailAmplitude +
    ridgeContribution

  if (worldOptions.terrain.maxHeight < estimatedTerrainMax) {
    worldOptions.terrain.maxHeight = estimatedTerrainMax
  }
  if (worldOptions.maxHeight < estimatedTerrainMax) {
    worldOptions.maxHeight = estimatedTerrainMax
  }

  worldOptions.terrain.clamp.min = normalizeWithBounds(
    worldOptions.terrain.clamp.min,
    defaultTerrainOptions.clamp.min,
    'clampMin',
  )
  worldOptions.terrain.clamp.max = Math.max(
    normalizeWithBounds(
      worldOptions.terrain.clamp.max,
      defaultTerrainOptions.clamp.max,
      'clampMax',
    ),
    worldOptions.terrain.clamp.min,
    worldOptions.maxHeight,
  )
  worldOptions.maxHeight = Math.max(
    worldOptions.maxHeight,
    worldOptions.terrain.clamp.max,
  )

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
