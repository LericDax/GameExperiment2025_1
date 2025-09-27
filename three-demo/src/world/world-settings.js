const defaultTerrainClamp = Object.freeze({
  min: 2,
  max: 20,
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
  biome: Object.freeze({
    climateScale: 0.003,
    detailScaleMultiplier: 2.15,
    varianceScaleMultiplier: 0.45,
  }),
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
    biome: { ...defaultWorldOptions.biome },
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

  if ('biome' in overrides && isObject(overrides.biome)) {
    Object.entries(overrides.biome).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        worldOptions.biome[key] = value
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

  Object.keys(worldOptions.biome).forEach((key) => {
    delete worldOptions.biome[key]
  })
  Object.assign(worldOptions.biome, fresh.biome)

  return worldOptions
}
