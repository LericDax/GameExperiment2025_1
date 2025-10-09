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

const defaultTerrainCore = Object.freeze({
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

const defaultTerrainTfmsPreset = createDefaultTerrainTfmsPreset(defaultTerrainCore)

const defaultTerrainOptions = Object.freeze({
  ...defaultTerrainCore,
  tfms: defaultTerrainTfmsPreset,
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
  uniformity: getDescriptorDefault(['biomes', 'uniformity']),
  weightExponent: getDescriptorDefault(['biomes', 'weightExponent']),
})

const biomeDescriptorKeys = [
  'scale',
  'detailMultiplier',
  'moistureDetailMultiplier',
  'varianceMultiplier',
  'variationStrength',
  'uniformity',
  'weightExponent',
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
      tfms: cloneTfmsPreset(defaultTerrainTfmsPreset),
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

function clampToRange(value, min, max) {
  let result = value
  if (Number.isFinite(min)) {
    result = Math.max(min, result)
  }
  if (Number.isFinite(max)) {
    result = Math.min(max, result)
  }
  return result
}

function cloneTfmsRange(range) {
  if (!range || typeof range !== 'object') {
    return undefined
  }
  const clone = {
    min: Number.isFinite(range.min) ? range.min : undefined,
    max: Number.isFinite(range.max) ? range.max : undefined,
  }
  if (Number.isFinite(range.value)) {
    clone.value = range.value
  }
  if (typeof range.baseKey === 'string') {
    clone.baseKey = range.baseKey
  }
  if (Number.isFinite(range.base)) {
    clone.base = range.base
  }
  if (Number.isFinite(range.multiplier)) {
    clone.multiplier = range.multiplier
  }
  if (range.hasOwnProperty('axis')) {
    clone.axis = range.axis
  }
  if (range.hasOwnProperty('channel') && typeof range.channel === 'string') {
    clone.channel = range.channel
  }
  return clone
}

function cloneTfmsVectorRange(vector) {
  if (!vector || typeof vector !== 'object') {
    return undefined
  }
  return {
    x: cloneTfmsRange(vector.x),
    z: cloneTfmsRange(vector.z),
  }
}

function cloneTfmsEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { }
  }
  return {
    amplitude: cloneTfmsRange(envelope.amplitude),
    frequency: cloneTfmsRange(envelope.frequency),
    phase: cloneTfmsVectorRange(envelope.phase),
    warp: cloneTfmsVectorRange(envelope.warp ?? envelope.domainWarp),
  }
}

function cloneTfmsModulation(modulation) {
  if (!modulation || typeof modulation !== 'object') {
    return {
      amplitude: cloneTfmsRange({ value: 0, min: -1, max: 1 }),
      frequency: cloneTfmsRange({ value: 0, min: -1, max: 1 }),
      phase: cloneTfmsVectorRange({
        x: { value: 0, min: -Math.PI, max: Math.PI },
        z: { value: 0, min: -Math.PI, max: Math.PI },
      }),
      warp: cloneTfmsVectorRange({
        x: { value: 0, min: -2, max: 2 },
        z: { value: 0, min: -2, max: 2 },
      }),
    }
  }
  return {
    amplitude: cloneTfmsRange(modulation.amplitude ?? { value: 0, min: -1, max: 1 }),
    frequency: cloneTfmsRange(modulation.frequency ?? { value: 0, min: -1, max: 1 }),
    phase: cloneTfmsVectorRange(
      modulation.phase ?? {
        x: { value: 0, min: -Math.PI, max: Math.PI },
        z: { value: 0, min: -Math.PI, max: Math.PI },
      },
    ),
    warp: cloneTfmsVectorRange(
      modulation.warp ?? {
        x: { value: 0, min: -2, max: 2 },
        z: { value: 0, min: -2, max: 2 },
      },
    ),
  }
}

function cloneSeedTemplate(seedTemplate) {
  if (!seedTemplate || typeof seedTemplate !== 'object') {
    return undefined
  }
  const clone = {}
  if (Number.isFinite(seedTemplate.value)) {
    clone.value = seedTemplate.value
  }
  if (Number.isFinite(seedTemplate.multiplier)) {
    clone.multiplier = seedTemplate.multiplier
  }
  if (Number.isFinite(seedTemplate.offset)) {
    clone.offset = seedTemplate.offset
  }
  return clone
}

function cloneTfmsWaveform(waveform) {
  if (!waveform || typeof waveform !== 'object') {
    return {
      id: 'waveform-0',
      type: 'fbm',
      settings: {},
    }
  }
  return {
    id: waveform.id ?? 'waveform-0',
    type: waveform.type ?? 'fbm',
    seedTemplate: cloneSeedTemplate(waveform.seedTemplate ?? waveform.seed),
    settings: waveform.settings ? { ...waveform.settings } : {},
  }
}

function cloneTfmsOperator(operator, index) {
  const clonedEnvelope = cloneTfmsEnvelope(operator?.envelope)
  const clonedModulation = cloneTfmsModulation(operator?.modulation)
  const clonedSeed = cloneSeedTemplate(operator?.seedTemplate ?? operator?.seed)
  const clonedSettings = operator?.settings ? { ...operator.settings } : {}
  const clonedTectonic = operator?.tectonic ? { ...operator.tectonic } : undefined
  const clonedTransfer =
    typeof operator?.transfer === 'object' && operator.transfer !== null
      ? { ...operator.transfer }
      : operator?.transfer
  return {
    id: operator?.id ?? `operator-${index}`,
    waveformId: operator?.waveformId ?? operator?.id ?? `waveform-${index}`,
    type: operator?.type ?? 'fbm',
    seedTemplate: clonedSeed,
    weight: Number.isFinite(operator?.weight) ? operator.weight : 1,
    bias: Number.isFinite(operator?.bias) ? operator.bias : 0,
    transfer: clonedTransfer ?? 'identity',
    transferSettings: operator?.transferSettings ? { ...operator.transferSettings } : undefined,
    tectonic: clonedTectonic,
    settings: clonedSettings,
    envelope: clonedEnvelope,
    modulation: clonedModulation,
  }
}

function cloneTfmsMatrixEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return {
      id: `matrix-entry-${index}`,
      source: index,
      target: index,
      routing: 'amplitude',
      channel: 'value',
      gain: cloneTfmsRange({ value: 0 }),
      bias: cloneTfmsRange({ value: 0 }),
    }
  }
  return {
    id: entry.id ?? `matrix-entry-${index}`,
    source: Number.isFinite(entry.source) ? entry.source : undefined,
    target: Number.isFinite(entry.target) ? entry.target : undefined,
    sourceId: entry.sourceId ?? entry.sourceKey,
    targetId: entry.targetId ?? entry.targetKey,
    routing: typeof entry.routing === 'string' ? entry.routing : 'amplitude',
    channel: typeof entry.channel === 'string' ? entry.channel : 'value',
    axis: typeof entry.axis === 'string' ? entry.axis : undefined,
    gain: cloneTfmsRange(
      typeof entry.gain === 'number' ? { value: entry.gain } : entry.gain,
    ),
    bias: cloneTfmsRange(
      typeof entry.bias === 'number' ? { value: entry.bias } : entry.bias,
    ),
  }
}

function cloneTfmsKamea(kamea) {
  if (!kamea || typeof kamea !== 'object') {
    return {
      temperament: 'Saturn 3x3',
      ranges: {
        modulationStrength: { min: 0, max: 1 },
        warpStrength: { min: 0, max: 1 },
        phaseStrength: { min: 0, max: 1 },
        spectralStrength: { min: 0, max: 1 },
      },
    }
  }
  const ranges = {}
  if (kamea.ranges && typeof kamea.ranges === 'object') {
    Object.entries(kamea.ranges).forEach(([key, value]) => {
      ranges[key] = cloneTfmsRange(value)
    })
  }
  return {
    temperament: typeof kamea.temperament === 'string' ? kamea.temperament : 'Saturn 3x3',
    modulationStrength: cloneTfmsRange(kamea.modulationStrength),
    warpStrength: cloneTfmsRange(kamea.warpStrength),
    phaseStrength: cloneTfmsRange(kamea.phaseStrength),
    spectralStrength: cloneTfmsRange(kamea.spectralStrength),
    spectralProfile:
      typeof kamea.spectralProfile === 'string' ? kamea.spectralProfile : 'band',
    erosionPreset:
      typeof kamea.erosionPreset === 'string' ? kamea.erosionPreset : 'standard',
    ranges,
  }
}

function cloneTfmsPreset(preset = {}) {
  return {
    waveforms: Array.isArray(preset.waveforms)
      ? preset.waveforms.map((waveform, index) => cloneTfmsWaveform(waveform, index))
      : [],
    operators: Array.isArray(preset.operators)
      ? preset.operators.map((operator, index) => cloneTfmsOperator(operator, index))
      : [],
    modulationMatrix: Array.isArray(preset.modulationMatrix)
      ? preset.modulationMatrix.map((entry, index) => cloneTfmsMatrixEntry(entry, index))
      : [],
    transferFunctions:
      preset.transferFunctions && typeof preset.transferFunctions === 'object'
        ? { ...preset.transferFunctions }
        : {},
    tectonic:
      preset.tectonic && typeof preset.tectonic === 'object'
        ? { ...preset.tectonic }
        : {},
    kamea: cloneTfmsKamea(preset.kamea),
    defaults:
      preset.defaults && typeof preset.defaults === 'object'
        ? { ...preset.defaults }
        : undefined,
  }
}

function createDefaultTerrainTfmsPreset(terrainDefaults) {
  const baseAmplitude = terrainDefaults.primaryAmplitude
  const baseFrequency = terrainDefaults.primaryFrequency
  const baseOffset = terrainDefaults.primaryOffset
  const detailAmplitude = terrainDefaults.detailAmplitude
  const detailFrequency = terrainDefaults.detailFrequency
  const detailOffset = terrainDefaults.detailOffset
  const ridgeStrength = terrainDefaults.ridgeStrength
  const ridgeFrequency = terrainDefaults.ridgeFrequency
  const ridgeOffset = terrainDefaults.ridgeOffset

  const waveforms = [
    Object.freeze({
      id: 'primary-fbm',
      type: 'fbm',
      seedTemplate: Object.freeze({ multiplier: 1.11, offset: 113 }),
      settings: Object.freeze({ octaves: 6, lacunarity: 2, gain: 0.48 }),
    }),
    Object.freeze({
      id: 'ridge-noise',
      type: 'ridged',
      seedTemplate: Object.freeze({ multiplier: 1.59, offset: 223 }),
      settings: Object.freeze({ octaves: 3, lacunarity: 2.05, gain: 0.5 }),
    }),
    Object.freeze({
      id: 'anisotropic-banding',
      type: 'anisotropicSine',
      seedTemplate: Object.freeze({ multiplier: 1.73, offset: 257 }),
      settings: Object.freeze({ orientation: Math.PI / 5, harmonics: 3 }),
    }),
    Object.freeze({
      id: 'tectonic-worley',
      type: 'worley',
      seedTemplate: Object.freeze({ multiplier: 1.91, offset: 307 }),
      settings: Object.freeze({
        jitter: 0.85,
        falloff: 1.35,
        distanceMetric: 'euclidean',
      }),
    }),
    Object.freeze({
      id: 'domain-warp',
      type: 'domainWarp',
      seedTemplate: Object.freeze({ multiplier: 2.13, offset: 353 }),
      settings: Object.freeze({ power: 1.1, gain: 0.9 }),
    }),
    Object.freeze({
      id: 'diffusion-mask',
      type: 'diffusion',
      seedTemplate: Object.freeze({ multiplier: 2.31, offset: 409 }),
      settings: Object.freeze({ smoothing: 0.68 }),
    }),
  ]

  const zeroWarpRange = Object.freeze({ value: 0, min: -128, max: 128 })
  const defaultModulation = Object.freeze({ value: 0, min: -1, max: 1 })
  const defaultPhaseRange = Object.freeze({ value: 0, min: -Math.PI, max: Math.PI })

  const operators = [
    Object.freeze({
      id: 'primary-fbm',
      waveformId: 'primary-fbm',
      type: 'fbm',
      seedTemplate: waveforms[0].seedTemplate,
      weight: 1,
      bias: 0,
      transfer: Object.freeze({ id: 'identity' }),
      tectonic: Object.freeze({ weight: 0.18 }),
      settings: waveforms[0].settings,
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'primaryAmplitude',
          multiplier: 1,
          min: 0,
          max: 256,
        }),
        frequency: Object.freeze({
          baseKey: 'primaryFrequency',
          multiplier: 1,
          min: 0.0001,
          max: 1,
        }),
        phase: Object.freeze({
          x: Object.freeze({
            baseKey: 'primaryOffset',
            multiplier: 1,
            min: -10000,
            max: 10000,
          }),
          z: Object.freeze({
            baseKey: 'primaryOffset',
            multiplier: 1,
            min: -10000,
            max: 10000,
          }),
        }),
        warp: Object.freeze({
          x: zeroWarpRange,
          z: zeroWarpRange,
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
    Object.freeze({
      id: 'ridge-noise',
      waveformId: 'ridge-noise',
      type: 'ridged',
      seedTemplate: waveforms[1].seedTemplate,
      weight: 0.75,
      bias: 0,
      transfer: Object.freeze({ id: 'abs' }),
      tectonic: undefined,
      settings: waveforms[1].settings,
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'ridgeStrength',
          multiplier: 1,
          min: 0,
          max: 64,
        }),
        frequency: Object.freeze({
          baseKey: 'ridgeFrequency',
          multiplier: 1,
          min: 0.0001,
          max: 1,
        }),
        phase: Object.freeze({
          x: Object.freeze({
            baseKey: 'ridgeOffset',
            min: -10000,
            max: 10000,
          }),
          z: Object.freeze({
            baseKey: 'ridgeOffset',
            min: -10000,
            max: 10000,
          }),
        }),
        warp: Object.freeze({
          x: zeroWarpRange,
          z: zeroWarpRange,
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
    Object.freeze({
      id: 'anisotropic-banding',
      waveformId: 'anisotropic-banding',
      type: 'anisotropicSine',
      seedTemplate: waveforms[2].seedTemplate,
      weight: 0.5,
      bias: 0,
      transfer: Object.freeze({ id: 'tanh' }),
      tectonic: undefined,
      settings: Object.freeze({
        ...waveforms[2].settings,
        bias: 0,
      }),
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'detailAmplitude',
          multiplier: 0.75,
          min: 0,
          max: 128,
        }),
        frequency: Object.freeze({
          baseKey: 'detailFrequency',
          multiplier: 1.5,
          min: 0.0001,
          max: 2,
        }),
        phase: Object.freeze({
          x: Object.freeze({
            baseKey: 'detailOffset',
            min: -10000,
            max: 10000,
          }),
          z: Object.freeze({
            baseKey: 'detailOffset',
            min: -10000,
            max: 10000,
          }),
        }),
        warp: Object.freeze({
          x: Object.freeze({ value: 0, min: -64, max: 64 }),
          z: Object.freeze({ value: 0, min: -64, max: 64 }),
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
    Object.freeze({
      id: 'tectonic-worley',
      waveformId: 'tectonic-worley',
      type: 'worley',
      seedTemplate: waveforms[3].seedTemplate,
      weight: 0.35,
      bias: 0,
      transfer: Object.freeze({ id: 'smoothstep', settings: { smoothness: 0.4 } }),
      tectonic: Object.freeze({ weight: 0.4 }),
      settings: waveforms[3].settings,
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'detailAmplitude',
          multiplier: 0.45,
          min: 0,
          max: 128,
        }),
        frequency: Object.freeze({
          baseKey: 'primaryFrequency',
          multiplier: 0.45,
          min: 0.0001,
          max: 1,
        }),
        phase: Object.freeze({
          x: Object.freeze({ base: 0, min: -10000, max: 10000, value: 0 }),
          z: Object.freeze({ base: 0, min: -10000, max: 10000, value: 0 }),
        }),
        warp: Object.freeze({
          x: zeroWarpRange,
          z: zeroWarpRange,
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
    Object.freeze({
      id: 'domain-warp',
      waveformId: 'domain-warp',
      type: 'domainWarp',
      seedTemplate: waveforms[4].seedTemplate,
      weight: 0,
      bias: 0,
      transfer: Object.freeze({ id: 'identity' }),
      tectonic: undefined,
      settings: waveforms[4].settings,
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'primaryAmplitude',
          multiplier: 0.32,
          min: 0,
          max: 256,
        }),
        frequency: Object.freeze({
          baseKey: 'primaryFrequency',
          multiplier: 0.65,
          min: 0.0001,
          max: 1,
        }),
        phase: Object.freeze({
          x: Object.freeze({
            baseKey: 'primaryOffset',
            min: -10000,
            max: 10000,
          }),
          z: Object.freeze({
            baseKey: 'primaryOffset',
            min: -10000,
            max: 10000,
          }),
        }),
        warp: Object.freeze({
          x: zeroWarpRange,
          z: zeroWarpRange,
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
    Object.freeze({
      id: 'diffusion-mask',
      waveformId: 'diffusion-mask',
      type: 'diffusion',
      seedTemplate: waveforms[5].seedTemplate,
      weight: 0.55,
      bias: 0,
      transfer: Object.freeze({ id: 'tanh' }),
      tectonic: undefined,
      settings: waveforms[5].settings,
      envelope: Object.freeze({
        amplitude: Object.freeze({
          baseKey: 'detailAmplitude',
          multiplier: 0.35,
          min: 0,
          max: 128,
        }),
        frequency: Object.freeze({
          baseKey: 'detailFrequency',
          multiplier: 1.2,
          min: 0.0001,
          max: 2,
        }),
        phase: Object.freeze({
          x: Object.freeze({
            baseKey: 'detailOffset',
            min: -10000,
            max: 10000,
          }),
          z: Object.freeze({
            baseKey: 'detailOffset',
            min: -10000,
            max: 10000,
          }),
        }),
        warp: Object.freeze({
          x: zeroWarpRange,
          z: zeroWarpRange,
        }),
      }),
      modulation: Object.freeze({
        amplitude: defaultModulation,
        frequency: defaultModulation,
        phase: Object.freeze({ x: defaultPhaseRange, z: defaultPhaseRange }),
        warp: Object.freeze({ x: zeroWarpRange, z: zeroWarpRange }),
      }),
    }),
  ]

  const modulationMatrix = [
    Object.freeze({
      id: 'diffusion-mask->primary-fbm:amplitude',
      sourceId: 'diffusion-mask',
      targetId: 'primary-fbm',
      routing: 'amplitude',
      channel: 'transferred',
      gain: Object.freeze({ value: 0.4, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'diffusion-mask->ridge-noise:amplitude',
      sourceId: 'diffusion-mask',
      targetId: 'ridge-noise',
      routing: 'amplitude',
      channel: 'transferred',
      gain: Object.freeze({ value: 0.3, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'diffusion-mask->anisotropic-banding:amplitude',
      sourceId: 'diffusion-mask',
      targetId: 'anisotropic-banding',
      routing: 'amplitude',
      channel: 'transferred',
      gain: Object.freeze({ value: 0.25, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'domain-warp->primary-fbm:domain-x',
      sourceId: 'domain-warp',
      targetId: 'primary-fbm',
      routing: 'domainWarp',
      channel: 'domainX',
      axis: 'x',
      gain: Object.freeze({ value: 0.7, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'domain-warp->primary-fbm:domain-z',
      sourceId: 'domain-warp',
      targetId: 'primary-fbm',
      routing: 'domainWarp',
      channel: 'domainZ',
      axis: 'z',
      gain: Object.freeze({ value: 0.7, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'domain-warp->ridge-noise:domain-x',
      sourceId: 'domain-warp',
      targetId: 'ridge-noise',
      routing: 'domainWarp',
      channel: 'domainX',
      axis: 'x',
      gain: Object.freeze({ value: 0.5, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'domain-warp->ridge-noise:domain-z',
      sourceId: 'domain-warp',
      targetId: 'ridge-noise',
      routing: 'domainWarp',
      channel: 'domainZ',
      axis: 'z',
      gain: Object.freeze({ value: 0.5, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'tectonic-worley->ridge-noise:amplitude',
      sourceId: 'tectonic-worley',
      targetId: 'ridge-noise',
      routing: 'amplitude',
      channel: 'raw',
      gain: Object.freeze({ value: 0.35, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'tectonic-worley->anisotropic-banding:frequency',
      sourceId: 'tectonic-worley',
      targetId: 'anisotropic-banding',
      routing: 'frequency',
      channel: 'raw',
      gain: Object.freeze({ value: 0.2, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'ridge-noise->domain-warp:amplitude',
      sourceId: 'ridge-noise',
      targetId: 'domain-warp',
      routing: 'amplitude',
      channel: 'transferred',
      gain: Object.freeze({ value: 0.35, min: -4, max: 4 }),
    }),
    Object.freeze({
      id: 'tectonic-worley->diffusion-mask:amplitude',
      sourceId: 'tectonic-worley',
      targetId: 'diffusion-mask',
      routing: 'amplitude',
      channel: 'raw',
      gain: Object.freeze({ value: 0.45, min: -4, max: 4 }),
    }),
  ]

  const tectonic = Object.freeze({ blend: 'additive', strength: 0.35, bias: 0 })

  const kameaRanges = Object.freeze({
    modulationStrength: Object.freeze({ min: 0, max: 1 }),
    warpStrength: Object.freeze({ min: 0, max: 1 }),
    phaseStrength: Object.freeze({ min: 0, max: 1 }),
    spectralStrength: Object.freeze({ min: 0, max: 1 }),
  })

  const kamea = Object.freeze({
    temperament: 'Saturn 3x3',
    modulationStrength: Object.freeze({ min: 0, max: 1 }),
    warpStrength: Object.freeze({ min: 0, max: 1 }),
    phaseStrength: Object.freeze({ min: 0, max: 1 }),
    spectralProfile: 'band',
    spectralStrength: Object.freeze({ min: 0, max: 1 }),
    erosionPreset: 'standard',
    ranges: kameaRanges,
  })

  return Object.freeze({
    waveforms: Object.freeze(waveforms),
    operators: Object.freeze(operators),
    modulationMatrix: Object.freeze(modulationMatrix),
    transferFunctions: Object.freeze({}),
    tectonic,
    kamea,
    defaults: Object.freeze({
      baseAmplitude,
      baseFrequency,
      baseOffset,
      detailAmplitude,
      detailFrequency,
      detailOffset,
      ridgeStrength,
      ridgeFrequency,
      ridgeOffset,
    }),
  })
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function setRangeValue(range, value) {
  if (!range) {
    return
  }
  if (value === null) {
    delete range.value
    return
  }
  if (!isFiniteNumber(value)) {
    return
  }
  let next = value
  if (isFiniteNumber(range.min)) {
    next = Math.max(range.min, next)
  }
  if (isFiniteNumber(range.max)) {
    next = Math.min(range.max, next)
  }
  range.value = next
}

function applyScalarRange(range, override) {
  if (!range) {
    return
  }
  if (override === null) {
    delete range.value
    return
  }
  if (isFiniteNumber(override)) {
    setRangeValue(range, override)
    return
  }
  if (!isObject(override)) {
    return
  }
  if (override.hasOwnProperty('value')) {
    if (override.value === null) {
      delete range.value
    } else if (isFiniteNumber(override.value)) {
      setRangeValue(range, override.value)
    }
  }
  if (override.hasOwnProperty('min') && isFiniteNumber(override.min)) {
    range.min = override.min
  }
  if (override.hasOwnProperty('max') && isFiniteNumber(override.max)) {
    range.max = override.max
  }
  if (override.hasOwnProperty('baseKey') && typeof override.baseKey === 'string') {
    range.baseKey = override.baseKey
  }
  if (override.hasOwnProperty('base') && isFiniteNumber(override.base)) {
    range.base = override.base
  }
  if (override.hasOwnProperty('multiplier') && isFiniteNumber(override.multiplier)) {
    range.multiplier = override.multiplier
  }
}

function applyVectorRange(range, override) {
  if (!range || !override) {
    return
  }
  if (isFiniteNumber(override)) {
    applyScalarRange(range.x, override)
    applyScalarRange(range.z, override)
    return
  }
  if (isObject(override)) {
    if (override.hasOwnProperty('x')) {
      applyScalarRange(range.x, override.x)
    }
    if (override.hasOwnProperty('z')) {
      applyScalarRange(range.z, override.z)
    }
  }
}

function applyTfmsEnvelopeOverrides(targetEnvelope, override) {
  if (!targetEnvelope || !override) {
    return
  }
  if (override.hasOwnProperty('amplitude')) {
    applyScalarRange(targetEnvelope.amplitude, override.amplitude)
  }
  if (override.hasOwnProperty('frequency')) {
    applyScalarRange(targetEnvelope.frequency, override.frequency)
  }
  if (override.hasOwnProperty('phase')) {
    applyVectorRange(targetEnvelope.phase, override.phase)
  }
  if (override.hasOwnProperty('warp')) {
    applyVectorRange(targetEnvelope.warp, override.warp)
  }
  if (override.hasOwnProperty('domainWarp')) {
    applyVectorRange(targetEnvelope.warp, override.domainWarp)
  }
}

function applyTfmsModulationOverrides(targetModulation, override) {
  if (!targetModulation || !override) {
    return
  }
  if (override.hasOwnProperty('amplitude')) {
    applyScalarRange(targetModulation.amplitude, override.amplitude)
  }
  if (override.hasOwnProperty('frequency')) {
    applyScalarRange(targetModulation.frequency, override.frequency)
  }
  if (override.hasOwnProperty('phase')) {
    applyVectorRange(targetModulation.phase, override.phase)
  }
  if (override.hasOwnProperty('warp')) {
    applyVectorRange(targetModulation.warp, override.warp)
  }
}

function findTfmsOperator(operators, override, fallbackIndex) {
  if (!Array.isArray(operators)) {
    return null
  }
  const overrideId = typeof override?.id === 'string' ? override.id : null
  if (overrideId) {
    const found = operators.find((entry) => entry.id === overrideId)
    if (found) {
      return found
    }
  }
  const overrideWaveformId =
    typeof override?.waveformId === 'string' ? override.waveformId : null
  if (overrideWaveformId) {
    const found = operators.find((entry) => entry.waveformId === overrideWaveformId)
    if (found) {
      return found
    }
  }
  if (isFiniteNumber(override?.index)) {
    return operators[override.index] ?? null
  }
  if (isFiniteNumber(fallbackIndex)) {
    return operators[fallbackIndex] ?? null
  }
  return null
}

function mergeTfmsWaveforms(targetWaveforms, overrides) {
  if (!Array.isArray(targetWaveforms) || !Array.isArray(overrides)) {
    return
  }
  overrides.forEach((override, index) => {
    if (!isObject(override)) {
      return
    }
    const overrideId = typeof override.id === 'string' ? override.id : null
    let target = null
    if (overrideId) {
      target = targetWaveforms.find((item) => item.id === overrideId) ?? null
    }
    if (!target && isFiniteNumber(override.index)) {
      target = targetWaveforms[override.index] ?? null
    }
    if (!target) {
      target = targetWaveforms[index] ?? null
    }
    if (!target) {
      if (overrideId) {
        targetWaveforms.push(cloneTfmsWaveform(override))
      }
      return
    }
    if (typeof override.type === 'string') {
      target.type = override.type
    }
    if (override.seedTemplate && isObject(override.seedTemplate)) {
      target.seedTemplate = {
        ...target.seedTemplate,
        ...override.seedTemplate,
      }
    } else if (override.seed && isObject(override.seed)) {
      target.seedTemplate = {
        ...target.seedTemplate,
        ...override.seed,
      }
    }
    if (isObject(override.settings)) {
      target.settings = {
        ...target.settings,
        ...override.settings,
      }
    }
  })
}

function mergeTfmsOperators(targetOperators, overrides) {
  if (!Array.isArray(targetOperators) || !Array.isArray(overrides)) {
    return
  }
  overrides.forEach((override, index) => {
    if (!isObject(override)) {
      return
    }
    const target = findTfmsOperator(targetOperators, override, index)
    if (!target) {
      if (typeof override.id === 'string') {
        targetOperators.push(cloneTfmsOperator(override, targetOperators.length))
      }
      return
    }
    if (typeof override.type === 'string') {
      target.type = override.type
    }
    if (typeof override.waveformId === 'string') {
      target.waveformId = override.waveformId
    }
    if (isFiniteNumber(override.weight)) {
      target.weight = override.weight
    }
    if (isFiniteNumber(override.bias)) {
      target.bias = override.bias
    }
    if (override.transfer) {
      if (typeof override.transfer === 'string') {
        target.transfer = override.transfer
      } else if (isObject(override.transfer)) {
        target.transfer = {
          ...target.transfer,
          ...override.transfer,
        }
      }
    }
    if (override.transferSettings && isObject(override.transferSettings)) {
      target.transferSettings = {
        ...target.transferSettings,
        ...override.transferSettings,
      }
    }
    if (override.seedTemplate && isObject(override.seedTemplate)) {
      target.seedTemplate = {
        ...target.seedTemplate,
        ...override.seedTemplate,
      }
    } else if (override.seed && isObject(override.seed)) {
      target.seedTemplate = {
        ...target.seedTemplate,
        ...override.seed,
      }
    }
    if (override.settings && isObject(override.settings)) {
      target.settings = {
        ...target.settings,
        ...override.settings,
      }
    }
    if (override.tectonic && isObject(override.tectonic)) {
      target.tectonic = {
        ...target.tectonic,
        ...override.tectonic,
      }
    }

    if (override.hasOwnProperty('amplitude')) {
      applyScalarRange(target.envelope?.amplitude, override.amplitude)
    }
    if (override.hasOwnProperty('frequency')) {
      applyScalarRange(target.envelope?.frequency, override.frequency)
    }
    if (override.hasOwnProperty('phase')) {
      if (isObject(override.phase)) {
        applyVectorRange(target.envelope?.phase, override.phase)
      } else {
        applyScalarRange(target.envelope?.phase?.x, override.phase)
        applyScalarRange(target.envelope?.phase?.z, override.phase)
      }
    }
    if (override.hasOwnProperty('domainWarp')) {
      applyVectorRange(target.envelope?.warp, override.domainWarp)
    }
    if (override.hasOwnProperty('warp')) {
      applyVectorRange(target.envelope?.warp, override.warp)
    }
    if (override.envelope && isObject(override.envelope)) {
      applyTfmsEnvelopeOverrides(target.envelope, override.envelope)
    }
    if (override.modulation && isObject(override.modulation)) {
      applyTfmsModulationOverrides(target.modulation, override.modulation)
    }
  })
}

function findMatrixEntry(targetMatrix, override, fallbackIndex) {
  if (!Array.isArray(targetMatrix)) {
    return null
  }
  if (typeof override?.id === 'string') {
    const found = targetMatrix.find((entry) => entry.id === override.id)
    if (found) {
      return found
    }
  }
  const sourceId = typeof override?.sourceId === 'string' ? override.sourceId : null
  const targetId = typeof override?.targetId === 'string' ? override.targetId : null
  if (sourceId || targetId) {
    const found = targetMatrix.find((entry) => {
      const matchesSource = sourceId ? entry.sourceId === sourceId : true
      const matchesTarget = targetId ? entry.targetId === targetId : true
      const routing = override.routing ?? override.mode
      const matchesRouting = routing ? entry.routing === routing : true
      const channel = override.channel ?? override.modulationChannel
      const matchesChannel = channel ? entry.channel === channel : true
      const axis = override.axis ?? override.component
      const matchesAxis = axis ? entry.axis === axis : true
      return matchesSource && matchesTarget && matchesRouting && matchesChannel && matchesAxis
    })
    if (found) {
      return found
    }
  }
  if (isFiniteNumber(override?.index)) {
    return targetMatrix[override.index] ?? null
  }
  if (isFiniteNumber(fallbackIndex)) {
    return targetMatrix[fallbackIndex] ?? null
  }
  return null
}

function mergeTfmsMatrix(targetMatrix, overrides) {
  if (!Array.isArray(targetMatrix) || !Array.isArray(overrides)) {
    return
  }
  overrides.forEach((override, index) => {
    if (!isObject(override)) {
      return
    }
    const target = findMatrixEntry(targetMatrix, override, index)
    if (!target) {
      if (typeof override.id === 'string') {
        targetMatrix.push(cloneTfmsMatrixEntry(override, targetMatrix.length))
      }
      return
    }
    if (override.hasOwnProperty('routing') && typeof override.routing === 'string') {
      target.routing = override.routing
    }
    if (override.hasOwnProperty('channel') && typeof override.channel === 'string') {
      target.channel = override.channel
    }
    if (override.hasOwnProperty('axis') && typeof override.axis === 'string') {
      target.axis = override.axis
    }
    if (override.hasOwnProperty('sourceId') && typeof override.sourceId === 'string') {
      target.sourceId = override.sourceId
    }
    if (override.hasOwnProperty('targetId') && typeof override.targetId === 'string') {
      target.targetId = override.targetId
    }
    if (override.hasOwnProperty('source') && isFiniteNumber(override.source)) {
      target.source = override.source
    }
    if (override.hasOwnProperty('target') && isFiniteNumber(override.target)) {
      target.target = override.target
    }
    if (override.hasOwnProperty('gain')) {
      applyScalarRange(target.gain, override.gain)
    }
    if (override.hasOwnProperty('depth')) {
      applyScalarRange(target.gain, override.depth)
    }
    if (override.hasOwnProperty('bias')) {
      if (!target.bias) {
        target.bias = { value: 0 }
      }
      applyScalarRange(target.bias, override.bias)
    }
  })
}

function mergeTfmsKamea(targetKamea, overrides) {
  if (!targetKamea || !isObject(overrides)) {
    return
  }
  if (overrides.hasOwnProperty('temperament') && typeof overrides.temperament === 'string') {
    targetKamea.temperament = overrides.temperament
  }
  if (overrides.hasOwnProperty('spectralProfile') && typeof overrides.spectralProfile === 'string') {
    targetKamea.spectralProfile = overrides.spectralProfile
  }
  if (overrides.hasOwnProperty('erosionPreset') && typeof overrides.erosionPreset === 'string') {
    targetKamea.erosionPreset = overrides.erosionPreset
  }
  if (overrides.hasOwnProperty('modulationStrength')) {
    if (!targetKamea.modulationStrength) {
      targetKamea.modulationStrength = { min: 0, max: 1 }
    }
    applyScalarRange(targetKamea.modulationStrength, overrides.modulationStrength)
  }
  if (overrides.hasOwnProperty('warpStrength')) {
    if (!targetKamea.warpStrength) {
      targetKamea.warpStrength = { min: 0, max: 1 }
    }
    applyScalarRange(targetKamea.warpStrength, overrides.warpStrength)
  }
  if (overrides.hasOwnProperty('phaseStrength')) {
    if (!targetKamea.phaseStrength) {
      targetKamea.phaseStrength = { min: 0, max: 1 }
    }
    applyScalarRange(targetKamea.phaseStrength, overrides.phaseStrength)
  }
  if (overrides.hasOwnProperty('spectralStrength')) {
    if (!targetKamea.spectralStrength) {
      targetKamea.spectralStrength = { min: 0, max: 1 }
    }
    applyScalarRange(targetKamea.spectralStrength, overrides.spectralStrength)
  }
  if (overrides.ranges && isObject(overrides.ranges)) {
    targetKamea.ranges = targetKamea.ranges ?? {}
    Object.entries(overrides.ranges).forEach(([key, value]) => {
      targetKamea.ranges[key] = cloneTfmsRange(value)
    })
  }
}

function mapLegacyTfmsOverrides(overrides) {
  if (!isObject(overrides)) {
    return overrides
  }
  const mapped = { ...overrides }
  if (!mapped.operators && Array.isArray(overrides.fmOperators)) {
    mapped.operators = overrides.fmOperators
  }
  if (!mapped.modulationMatrix) {
    if (Array.isArray(overrides.fmMatrix)) {
      mapped.modulationMatrix = overrides.fmMatrix
    } else if (Array.isArray(overrides.fmModulationMatrix)) {
      mapped.modulationMatrix = overrides.fmModulationMatrix
    }
  }
  if (!mapped.transferFunctions && isObject(overrides.fmTransferFunctions)) {
    mapped.transferFunctions = overrides.fmTransferFunctions
  }
  if (!mapped.kamea && isObject(overrides.fmKamea)) {
    mapped.kamea = overrides.fmKamea
  }
  return mapped
}

function applyTfmsOverrides(target, overrides) {
  if (!isObject(target) || !isObject(overrides)) {
    return
  }
  const normalizedOverrides = mapLegacyTfmsOverrides(overrides)

  if (Array.isArray(normalizedOverrides.waveforms)) {
    mergeTfmsWaveforms(target.waveforms, normalizedOverrides.waveforms)
  }

  if (Array.isArray(normalizedOverrides.operators)) {
    mergeTfmsOperators(target.operators, normalizedOverrides.operators)
  }

  if (Array.isArray(normalizedOverrides.modulationMatrix)) {
    mergeTfmsMatrix(target.modulationMatrix, normalizedOverrides.modulationMatrix)
  }

  if (isObject(normalizedOverrides.transferFunctions)) {
    target.transferFunctions = {
      ...target.transferFunctions,
      ...normalizedOverrides.transferFunctions,
    }
  }

  if (normalizedOverrides.tectonic && isObject(normalizedOverrides.tectonic)) {
    target.tectonic = {
      ...target.tectonic,
      ...normalizedOverrides.tectonic,
    }
  }

  if (typeof normalizedOverrides.temperament === 'string') {
    target.kamea.temperament = normalizedOverrides.temperament
  }
  if (typeof normalizedOverrides.kameaTemperament === 'string') {
    target.kamea.temperament = normalizedOverrides.kameaTemperament
  }
  if (normalizedOverrides.kamea && isObject(normalizedOverrides.kamea)) {
    mergeTfmsKamea(target.kamea, normalizedOverrides.kamea)
  }
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

  const topLevelTfmsOverrides = isObject(overrides.tfms)
    ? overrides.tfms
    : null
  const nestedTfmsOverrides = isObject(terrainOverrides?.tfms)
    ? terrainOverrides.tfms
    : null

  if (topLevelTfmsOverrides) {
    applyTfmsOverrides(worldOptions.terrain.tfms, topLevelTfmsOverrides)
  }
  if (nestedTfmsOverrides) {
    applyTfmsOverrides(worldOptions.terrain.tfms, nestedTfmsOverrides)
  }

  const legacyTfmsOverrideSources = [overrides, terrainOverrides]
  legacyTfmsOverrideSources.forEach((candidate) => {
    if (!isObject(candidate)) {
      return
    }
    if (
      Array.isArray(candidate.fmOperators) ||
      Array.isArray(candidate.fmMatrix) ||
      Array.isArray(candidate.fmModulationMatrix) ||
      isObject(candidate.fmTransferFunctions) ||
      isObject(candidate.fmKamea)
    ) {
      applyTfmsOverrides(worldOptions.terrain.tfms, candidate)
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
