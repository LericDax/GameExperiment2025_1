import {
  createWorldOptionDescriptorIndex,
  worldOptionDescriptors,
  worldOptionPathToKey,
} from './world-option-descriptors.js'

export { worldOptionDescriptors } from './world-option-descriptors.js'

const descriptorIndex = createWorldOptionDescriptorIndex(worldOptionDescriptors)

export function getWorldOptionDescriptor(pathKey) {
  return descriptorIndex.get(pathKey) ?? null
}

function getDescriptorForPath(path) {
  if (Array.isArray(path)) {
    return descriptorIndex.get(worldOptionPathToKey(path)) ?? null
  }
  if (typeof path === 'string') {
    return descriptorIndex.get(path) ?? null
  }
  return null
}

function getDescriptorDefault(path) {
  const descriptor = getDescriptorForPath(path)
  if (!descriptor) {
    throw new Error(`Missing world option descriptor for path: ${path.join('.')}`)
  }
  return descriptor.default
}

function computeSeedHash(value) {
  const str = String(value ?? '')
  let hash = 2166136261
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function resolveSeed(value, fallbackValue, fallbackHash) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value)
    return { value: normalized, hash: computeSeedHash(normalized) }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return { value: trimmed, hash: computeSeedHash(trimmed) }
    }
  }
  return { value: fallbackValue, hash: fallbackHash }
}

const DEFAULT_SEED_VALUE = getDescriptorDefault(['seed'])
const DEFAULT_SEED_HASH = computeSeedHash(DEFAULT_SEED_VALUE)

const defaultTerrainClamp = Object.freeze({
  min: getDescriptorDefault(['terrain', 'clamp', 'min']),
  max: getDescriptorDefault(['terrain', 'clamp', 'max']),
})

const defaultTerrainOptions = Object.freeze({
  baseHeight: getDescriptorDefault(['terrain', 'baseHeight']),
  maxHeight: getDescriptorDefault(['terrain', 'maxHeight']),
  clamp: defaultTerrainClamp,
  primaryFrequency: getDescriptorDefault(['terrain', 'primaryFrequency']),
  primaryAmplitude: getDescriptorDefault(['terrain', 'primaryAmplitude']),
  primaryOffset: getDescriptorDefault(['terrain', 'primaryOffset']),
  detailFrequency: getDescriptorDefault(['terrain', 'detailFrequency']),
  detailAmplitude: getDescriptorDefault(['terrain', 'detailAmplitude']),
  detailOffset: getDescriptorDefault(['terrain', 'detailOffset']),
  ridgeFrequency: getDescriptorDefault(['terrain', 'ridgeFrequency']),
  ridgeStrength: getDescriptorDefault(['terrain', 'ridgeStrength']),
  ridgeOffset: getDescriptorDefault(['terrain', 'ridgeOffset']),
  climateHeightInfluence: getDescriptorDefault([
    'terrain',
    'climateHeightInfluence',
  ]),
})

const defaultBiomeTuning = Object.freeze({
  scale: getDescriptorDefault(['biomes', 'scale']),
  detailMultiplier: getDescriptorDefault(['biomes', 'detailMultiplier']),
  moistureDetailMultiplier: getDescriptorDefault([
    'biomes',
    'moistureDetailMultiplier',
  ]),
  varianceMultiplier: getDescriptorDefault(['biomes', 'varianceMultiplier']),
  variationStrength: getDescriptorDefault(['biomes', 'variationStrength']),
})

const biomeDescriptorKeys = [
  'scale',
  'detailMultiplier',
  'moistureDetailMultiplier',
  'varianceMultiplier',
  'variationStrength',
]

export const biomeOptionMetadata = Object.freeze(
  Object.fromEntries(
    biomeDescriptorKeys.map((key) => {
      const descriptor = getDescriptorForPath(['biomes', key])
      return [
        key,
        Object.freeze({
          default: defaultBiomeTuning[key],
          min: descriptor?.min,
          max: descriptor?.max,
          description: descriptor?.description,
        }),
      ]
    }),
  ),
)

export const defaultWorldOptions = Object.freeze({
  seed: DEFAULT_SEED_VALUE,
  seedHash: DEFAULT_SEED_HASH,
  chunkSize: getDescriptorDefault(['chunkSize']),
  baseHeight: getDescriptorDefault(['baseHeight']),
  maxHeight: getDescriptorDefault(['maxHeight']),
  waterLevel: getDescriptorDefault(['waterLevel']),
  chunk: Object.freeze({
    size: getDescriptorDefault(['chunk', 'size']),
  }),
  water: Object.freeze({
    level: getDescriptorDefault(['water', 'level']),
  }),
  terrain: defaultTerrainOptions,
  biomes: defaultBiomeTuning,
})

function createMutableWorldOptions() {
  const seedInfo = resolveSeed(
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_HASH,
  )
  return {
    seed: seedInfo.value,
    seedHash: seedInfo.hash,
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

function normalizeWithDescriptor(value, fallback, path) {
  const descriptor = getDescriptorForPath(path)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  let normalized = value
  if (descriptor && Number.isFinite(descriptor.min)) {
    normalized = Math.max(descriptor.min, normalized)
  }
  if (descriptor && Number.isFinite(descriptor.max)) {
    normalized = Math.min(descriptor.max, normalized)
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
    const seedInfo = resolveSeed(
      overrides.seed,
      worldOptions.seed,
      worldOptions.seedHash,
    )
    worldOptions.seed = seedInfo.value
    worldOptions.seedHash = seedInfo.hash
  }

  const chunkOverrides = isObject(overrides.chunk) ? overrides.chunk : null
  const resolvedChunkSize = normalizeNumber(
    chunkOverrides?.size ?? overrides.chunkSize,
    null,
  )
  if (resolvedChunkSize !== null) {
    const floored = Math.floor(resolvedChunkSize)
    const positive = Math.max(1, floored)
    const normalizedChunkSize = normalizeWithDescriptor(
      positive,
      worldOptions.chunk.size,
      ['chunk', 'size'],
    )
    worldOptions.chunk.size = normalizedChunkSize
    worldOptions.chunkSize = normalizeWithDescriptor(
      normalizedChunkSize,
      worldOptions.chunkSize,
      ['chunkSize'],
    )
  }

  const terrainOverrides = isObject(overrides.terrain) ? overrides.terrain : null

  const resolvedBaseHeight = normalizeNumber(
    terrainOverrides?.baseHeight ?? overrides.baseHeight,
    null,
  )
  if (resolvedBaseHeight !== null) {
    const baseHeight = normalizeWithDescriptor(
      resolvedBaseHeight,
      worldOptions.terrain.baseHeight,
      ['terrain', 'baseHeight'],
    )
    worldOptions.baseHeight = baseHeight
    worldOptions.terrain.baseHeight = baseHeight
  }

  const resolvedMaxHeight = normalizeNumber(
    terrainOverrides?.maxHeight ?? overrides.maxHeight,
    null,
  )
  if (resolvedMaxHeight !== null) {
    const maxHeight = normalizeWithDescriptor(
      resolvedMaxHeight,
      worldOptions.terrain.maxHeight,
      ['terrain', 'maxHeight'],
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
    worldOptions.terrain.clamp.min = normalizeWithDescriptor(
      resolvedClampMin,
      worldOptions.terrain.clamp.min,
      ['terrain', 'clamp', 'min'],
    )
  }
  const resolvedClampMax = normalizeNumber(clampOverrides?.max, null)
  if (resolvedClampMax !== null) {
    const clampMax = normalizeWithDescriptor(
      resolvedClampMax,
      worldOptions.terrain.clamp.max,
      ['terrain', 'clamp', 'max'],
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
      worldOptions.terrain[key] = normalizeWithDescriptor(
        terrainOverrides[key],
        worldOptions.terrain[key],
        ['terrain', key],
      )
    }
  })

  worldOptions.baseHeight = normalizeWithDescriptor(
    worldOptions.baseHeight,
    defaultTerrainOptions.baseHeight,
    ['baseHeight'],
  )
  worldOptions.terrain.baseHeight = worldOptions.baseHeight

  const minimumMaxHeight = Math.max(
    worldOptions.baseHeight,
    worldOptions.terrain.baseHeight,
  )
  worldOptions.terrain.maxHeight = Math.max(
    normalizeWithDescriptor(
      worldOptions.terrain.maxHeight,
      defaultTerrainOptions.maxHeight,
      ['terrain', 'maxHeight'],
    ),
    minimumMaxHeight,
  )
  worldOptions.maxHeight = Math.max(
    normalizeWithDescriptor(
      worldOptions.maxHeight,
      defaultTerrainOptions.maxHeight,
      ['maxHeight'],
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

  worldOptions.terrain.clamp.min = normalizeWithDescriptor(
    worldOptions.terrain.clamp.min,
    defaultTerrainOptions.clamp.min,
    ['terrain', 'clamp', 'min'],
  )
  worldOptions.terrain.clamp.max = Math.max(
    normalizeWithDescriptor(
      worldOptions.terrain.clamp.max,
      defaultTerrainOptions.clamp.max,
      ['terrain', 'clamp', 'max'],
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
    const normalizedWaterLevel = normalizeWithDescriptor(
      resolvedWaterLevel,
      worldOptions.water.level,
      ['water', 'level'],
    )
    worldOptions.water.level = normalizedWaterLevel
    worldOptions.waterLevel = normalizeWithDescriptor(
      normalizedWaterLevel,
      worldOptions.waterLevel,
      ['waterLevel'],
    )
  }

  if ('biomes' in overrides && isObject(overrides.biomes)) {
    Object.entries(overrides.biomes).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(worldOptions.biomes, key)) {
        return
      }
      const normalizedInput = normalizeNumber(value, null)
      if (normalizedInput === null) {
        return
      }
      worldOptions.biomes[key] = normalizeWithDescriptor(
        normalizedInput,
        worldOptions.biomes[key],
        ['biomes', key],
      )
    })
  }

  return worldOptions
}

export function resetWorldOptions() {
  const fresh = createMutableWorldOptions()

  worldOptions.seed = fresh.seed
  worldOptions.seedHash = fresh.seedHash
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
