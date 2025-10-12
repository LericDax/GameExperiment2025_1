import {
  createWorldOptionDescriptorIndex,
  worldOptionDescriptors,
  worldOptionPathToKey,
} from './world-option-descriptors.js'
import { clearTerrainSampleCache } from './terrain-sample-cache.js'

export { worldOptionDescriptors } from './world-option-descriptors.js'

/**
 * Scalar or vector ranges that can be resolved against world descriptors or
 * direct numeric overrides. See docs/tfms-system.md#tfms-concept-overview for
 * how these values inform the attenuation graph.
 *
 * @typedef {Object} TfmsRange
 * @property {number} [value]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [baseKey]
 * @property {number} [base]
 * @property {number} [multiplier]
 * @property {('x'|'z')} [axis]
 * @property {string} [channel]
 */

/**
 * Vector wrapper used for phase/warp components.
 *
 * @typedef {Object} TfmsVectorRange
 * @property {TfmsRange} [x]
 * @property {TfmsRange} [z]
 */

/**
 * Modulation payload describing how one operator can influence another. Refer
 * to docs/tfms-system.md#modulation-matrix-semantics for routing behaviour.
 *
 * @typedef {Object} TfmsModulationLink
 * @property {string} id
 * @property {number} [source]
 * @property {number} [target]
 * @property {string} [sourceId]
 * @property {string} [targetId]
 * @property {string} [routing]
 * @property {string} [channel]
 * @property {string} [axis]
 * @property {TfmsRange} [gain]
 * @property {TfmsRange} [bias]
 */

/**
 * Operator schema for the six-operator TFMS preset. Cross-reference
 * docs/tfms-system.md#default-operator-catalogue when editing weights,
 * transfers, or envelope bindings.
 *
 * @typedef {Object} TfmsOperatorPreset
 * @property {string} id
 * @property {string} waveformId
 * @property {string} type
 * @property {TfmsRange} [seedTemplate]
 * @property {number} weight
 * @property {number} bias
 * @property {string|{id:string}} transfer
 * @property {Object<string,*>} [transferSettings]
 * @property {{weight?:number}} [tectonic]
 * @property {Object<string,*>} [settings]
 * @property {{
 *   amplitude?: TfmsRange,
 *   frequency?: TfmsRange,
 *   phase?: TfmsVectorRange,
 *   warp?: TfmsVectorRange
 * }} [envelope]
 * @property {{
 *   amplitude?: TfmsRange,
 *   frequency?: TfmsRange,
 *   phase?: TfmsVectorRange,
 *   warp?: TfmsVectorRange
 * }} [modulation]
 */

const descriptorIndex = createWorldOptionDescriptorIndex(worldOptionDescriptors)

const TERRAIN_VERTICAL_SPAN_MULTIPLIER = 3
const DEFAULT_CHUNK_SIZE = getDescriptorDefault(['chunk', 'size'])
const DEFAULT_TERRAIN_BASE_HEIGHT = getDescriptorDefault([
  'terrain',
  'baseHeight',
])
const DEFAULT_TERRAIN_PRIMARY_FREQUENCY = getDescriptorDefault([
  'terrain',
  'primaryFrequency',
])
const DEFAULT_TERRAIN_DETAIL_FREQUENCY = getDescriptorDefault([
  'terrain',
  'detailFrequency',
])
const DEFAULT_TERRAIN_RIDGE_FREQUENCY = getDescriptorDefault([
  'terrain',
  'ridgeFrequency',
])
const DEFAULT_TERRAIN_PRIMARY_AMPLITUDE = getDescriptorDefault([
  'terrain',
  'primaryAmplitude',
])
const DEFAULT_TERRAIN_DETAIL_AMPLITUDE = getDescriptorDefault([
  'terrain',
  'detailAmplitude',
])
const DEFAULT_TERRAIN_RIDGE_STRENGTH = getDescriptorDefault([
  'terrain',
  'ridgeStrength',
])

const DEFAULT_TERRAIN_VERTICAL_EXTENT =
  DEFAULT_CHUNK_SIZE * TERRAIN_VERTICAL_SPAN_MULTIPLIER
const PRIMARY_AMPLITUDE_RATIO =
  DEFAULT_TERRAIN_VERTICAL_EXTENT > 0
    ? DEFAULT_TERRAIN_PRIMARY_AMPLITUDE / DEFAULT_TERRAIN_VERTICAL_EXTENT
    : 0
const DETAIL_AMPLITUDE_RATIO =
  DEFAULT_TERRAIN_VERTICAL_EXTENT > 0
    ? DEFAULT_TERRAIN_DETAIL_AMPLITUDE / DEFAULT_TERRAIN_VERTICAL_EXTENT
    : 0
const RIDGE_STRENGTH_RATIO =
  DEFAULT_TERRAIN_VERTICAL_EXTENT > 0
    ? DEFAULT_TERRAIN_RIDGE_STRENGTH / DEFAULT_TERRAIN_VERTICAL_EXTENT
    : 0

function normalizeChunkSizeForEnvelope(chunkSize) {
  if (Number.isFinite(chunkSize)) {
    return Math.max(1, Math.floor(chunkSize))
  }
  return Math.max(1, Math.floor(DEFAULT_CHUNK_SIZE))
}

export function computeTerrainVerticalEnvelope(chunkSize = DEFAULT_CHUNK_SIZE) {
  const normalizedSize = normalizeChunkSizeForEnvelope(chunkSize)
  const verticalExtent = normalizedSize * TERRAIN_VERTICAL_SPAN_MULTIPLIER
  return {
    chunkSize: normalizedSize,
    maxHeight: verticalExtent,
    clampMin: -verticalExtent,
    clampMax: verticalExtent,
  }
}

function computeTerrainWaveDefaults({
  chunkSize = DEFAULT_CHUNK_SIZE,
  baseHeight = DEFAULT_TERRAIN_BASE_HEIGHT,
} = {}) {
  const normalizedSize = normalizeChunkSizeForEnvelope(chunkSize)
  const verticalExtent = normalizedSize * TERRAIN_VERTICAL_SPAN_MULTIPLIER
  const safeBaseHeight = Number.isFinite(baseHeight) ? baseHeight : 0
  const amplitudeBudget = Math.max(0, verticalExtent - safeBaseHeight)

  const primaryAmplitudeCandidate = Math.max(
    0,
    Math.min(
      Math.round(verticalExtent * PRIMARY_AMPLITUDE_RATIO),
      amplitudeBudget,
    ),
  )
  const primaryAmplitude = normalizeWithDescriptor(
    primaryAmplitudeCandidate,
    DEFAULT_TERRAIN_PRIMARY_AMPLITUDE,
    ['terrain', 'primaryAmplitude'],
  )

  const remainingAfterPrimary = Math.max(0, amplitudeBudget - primaryAmplitude)
  const detailAmplitudeCandidate = Math.max(
    0,
    Math.min(
      Math.round(verticalExtent * DETAIL_AMPLITUDE_RATIO),
      remainingAfterPrimary,
    ),
  )
  const detailAmplitude = normalizeWithDescriptor(
    detailAmplitudeCandidate,
    DEFAULT_TERRAIN_DETAIL_AMPLITUDE,
    ['terrain', 'detailAmplitude'],
  )

  const remainingAfterDetail = Math.max(
    0,
    remainingAfterPrimary - detailAmplitude,
  )
  const ridgeStrengthCandidate = Math.max(
    0,
    Math.min(
      Math.round(verticalExtent * RIDGE_STRENGTH_RATIO),
      remainingAfterDetail,
    ),
  )
  const ridgeStrength = normalizeWithDescriptor(
    ridgeStrengthCandidate,
    DEFAULT_TERRAIN_RIDGE_STRENGTH,
    ['terrain', 'ridgeStrength'],
  )

  const frequencyScale =
    normalizedSize > 0 ? DEFAULT_CHUNK_SIZE / normalizedSize : 1

  const primaryFrequency = normalizeWithDescriptor(
    DEFAULT_TERRAIN_PRIMARY_FREQUENCY * frequencyScale,
    DEFAULT_TERRAIN_PRIMARY_FREQUENCY,
    ['terrain', 'primaryFrequency'],
  )
  const detailFrequency = normalizeWithDescriptor(
    DEFAULT_TERRAIN_DETAIL_FREQUENCY * frequencyScale,
    DEFAULT_TERRAIN_DETAIL_FREQUENCY,
    ['terrain', 'detailFrequency'],
  )
  const ridgeFrequency = normalizeWithDescriptor(
    DEFAULT_TERRAIN_RIDGE_FREQUENCY * frequencyScale,
    DEFAULT_TERRAIN_RIDGE_FREQUENCY,
    ['terrain', 'ridgeFrequency'],
  )

  return {
    primaryAmplitude,
    detailAmplitude,
    ridgeStrength,
    primaryFrequency,
    detailFrequency,
    ridgeFrequency,
  }
}

function syncTerrainVerticalEnvelope(
  options,
  envelope,
  {
    forceClamp = false,
    forceMaxHeight = false,
    forceTfmsClamp = false,
  } = {},
) {
  if (!options || !options.terrain || !envelope) {
    return
  }

  const { clampMin, clampMax, maxHeight } = envelope

  if (forceMaxHeight || !Number.isFinite(options.terrain.maxHeight)) {
    options.terrain.maxHeight = maxHeight
  } else if (forceMaxHeight || options.terrain.maxHeight < maxHeight) {
    options.terrain.maxHeight = maxHeight
  }

  if (forceMaxHeight || !Number.isFinite(options.maxHeight)) {
    options.maxHeight = options.terrain.maxHeight
  } else if (options.maxHeight < options.terrain.maxHeight) {
    options.maxHeight = options.terrain.maxHeight
  }

  const clamp = options.terrain.clamp ?? (options.terrain.clamp = {})
  if (forceClamp || !Number.isFinite(clamp.min)) {
    clamp.min = clampMin
  } else if (forceClamp || clamp.min > clampMin) {
    clamp.min = clampMin
  }
  if (forceClamp || !Number.isFinite(clamp.max)) {
    clamp.max = clampMax
  } else if (forceClamp || clamp.max < clampMax) {
    clamp.max = clampMax
  }
  if (Number.isFinite(clamp.min) && Number.isFinite(clamp.max) && clamp.max < clamp.min) {
    clamp.max = clamp.min
  }

  const tfms = options.terrain.tfms
  if (!tfms || typeof tfms !== 'object') {
    return
  }

  const tfmsClamp = tfms.clamp ?? (tfms.clamp = {})
  if (forceTfmsClamp || !Number.isFinite(tfmsClamp.min)) {
    tfmsClamp.min = clampMin
  } else if (forceTfmsClamp || tfmsClamp.min > clampMin) {
    tfmsClamp.min = clampMin
  }
  if (forceTfmsClamp || !Number.isFinite(tfmsClamp.max)) {
    tfmsClamp.max = clampMax
  } else if (forceTfmsClamp || tfmsClamp.max < clampMax) {
    tfmsClamp.max = clampMax
  }
  if (
    Number.isFinite(tfmsClamp.min) &&
    Number.isFinite(tfmsClamp.max) &&
    tfmsClamp.max < tfmsClamp.min
  ) {
    tfmsClamp.max = tfmsClamp.min
  }
}

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

const environmentSkyboxDescriptor = getDescriptorForPath([
  'environment',
  'skyboxId',
])
const environmentSkyboxOptionValues = new Set(
  Array.isArray(environmentSkyboxDescriptor?.options)
    ? environmentSkyboxDescriptor.options
        .map((option) =>
          typeof option === 'string'
            ? option
            : option && typeof option.value === 'string'
            ? option.value
            : null,
        )
        .filter((value) => typeof value === 'string' && value.length > 0)
    : [],
)

const defaultEnvironmentOptions = Object.freeze({
  skyboxId: getDescriptorDefault(['environment', 'skyboxId']),
})

const defaultTerrainWaveDefaults = computeTerrainWaveDefaults({
  chunkSize: DEFAULT_CHUNK_SIZE,
  baseHeight: DEFAULT_TERRAIN_BASE_HEIGHT,
})

const defaultTerrainEnvelope = computeTerrainVerticalEnvelope(DEFAULT_CHUNK_SIZE)

const defaultTerrainClamp = Object.freeze({
  min: defaultTerrainEnvelope.clampMin,
  max: defaultTerrainEnvelope.clampMax,
})

const defaultTerrainCore = Object.freeze({
  baseHeight: DEFAULT_TERRAIN_BASE_HEIGHT,
  maxHeight: defaultTerrainEnvelope.maxHeight,
  clamp: defaultTerrainClamp,
  primaryFrequency: defaultTerrainWaveDefaults.primaryFrequency,
  primaryAmplitude: defaultTerrainWaveDefaults.primaryAmplitude,
  primaryOffset: getDescriptorDefault(['terrain', 'primaryOffset']),
  detailFrequency: defaultTerrainWaveDefaults.detailFrequency,
  detailAmplitude: defaultTerrainWaveDefaults.detailAmplitude,
  detailOffset: getDescriptorDefault(['terrain', 'detailOffset']),
  ridgeFrequency: defaultTerrainWaveDefaults.ridgeFrequency,
  ridgeStrength: defaultTerrainWaveDefaults.ridgeStrength,
  ridgeOffset: getDescriptorDefault(['terrain', 'ridgeOffset']),
  climateHeightInfluence: getDescriptorDefault([
    'terrain',
    'climateHeightInfluence',
  ]),
  shoreSlopeBias: getDescriptorDefault(['terrain', 'shoreSlopeBias']),
})

const defaultTerrainTfmsClamp = Object.freeze({
  min: getDescriptorDefault(['terrain', 'tfms', 'clamp', 'min']),
  max: getDescriptorDefault(['terrain', 'tfms', 'clamp', 'max']),
})

const defaultTerrainTfmsBaseAttenuation = getDescriptorDefault([
  'terrain',
  'tfms',
  'baseAttenuation',
])

const defaultTerrainTfmsBiomeBlendStrength = getDescriptorDefault([
  'terrain',
  'tfms',
  'biomeBlendStrength',
])

const defaultTerrainTfmsTemperament = getDescriptorDefault([
  'terrain',
  'tfms',
  'temperament',
])

const defaultTerrainTfmsKameaModulation = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'modulationStrength',
  'value',
])

const defaultTerrainTfmsKameaWarp = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'warpStrength',
  'value',
])

const defaultTerrainTfmsKameaPhase = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'phaseStrength',
  'value',
])

const MIN_TFMS_OPERATOR_COUNT = 1
const MAX_TFMS_OPERATOR_COUNT = 6

const defaultTerrainTfmsKameaSpectral = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'spectralStrength',
  'value',
])

const defaultTerrainTfmsKameaProfile = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'spectralProfile',
])

const defaultTerrainTfmsKameaErosion = getDescriptorDefault([
  'terrain',
  'tfms',
  'kamea',
  'erosionPreset',
])

/**
 * Default TFMS preset mirroring the six-operator attenuation stack outlined in
 * docs/tfms-system.md#default-operator-catalogue. Update the guide alongside
 * any structural changes so tooling and design docs stay aligned.
 */
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
  oceanProvinceScale: getDescriptorDefault(['biomes', 'oceanProvinceScale']),
  oceanWeightBias: getDescriptorDefault(['biomes', 'oceanWeightBias']),
})

const biomeDescriptorKeys = [
  'scale',
  'detailMultiplier',
  'moistureDetailMultiplier',
  'varianceMultiplier',
  'variationStrength',
  'uniformity',
  'weightExponent',
  'oceanProvinceScale',
  'oceanWeightBias',
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
  environment: defaultEnvironmentOptions,
  terrain: defaultTerrainOptions,
  biomes: defaultBiomeTuning,
})

function createMutableWorldOptions() {
  const seedInfo = resolveSeed(
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_VALUE,
    DEFAULT_SEED_HASH,
  )
  const options = {
    seed: seedInfo.value,
    seedHash: seedInfo.hash,
    chunkSize: defaultWorldOptions.chunkSize,
    baseHeight: defaultWorldOptions.baseHeight,
    maxHeight: defaultWorldOptions.maxHeight,
    waterLevel: defaultWorldOptions.waterLevel,
    chunk: { size: defaultWorldOptions.chunk.size },
    water: { level: defaultWorldOptions.water.level },
    environment: { skyboxId: defaultEnvironmentOptions.skyboxId },
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
      shoreSlopeBias: defaultTerrainOptions.shoreSlopeBias,
      tfms: cloneTfmsPreset(defaultTerrainTfmsPreset),
    },
    biomes: { ...defaultWorldOptions.biomes },
  }
  const envelope = computeTerrainVerticalEnvelope(options.chunk.size)
  syncTerrainVerticalEnvelope(options, envelope, {
    forceClamp: true,
    forceMaxHeight: true,
    forceTfmsClamp: true,
  })
  return options
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

function normalizeEnvironmentSkyboxId(
  value,
  fallback = defaultEnvironmentOptions.skyboxId,
) {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  if (
    environmentSkyboxOptionValues.size > 0 &&
    !environmentSkyboxOptionValues.has(trimmed)
  ) {
    return fallback
  }
  return trimmed
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

// Mirrors the slot trimming recommendations documented in
// docs/tfms-system.md#operator-slot-selection-1-6-carriers.
function normalizeTfmsOperatorCount(available, requested) {
  const normalizedAvailable = Math.max(
    0,
    Math.min(
      MAX_TFMS_OPERATOR_COUNT,
      Number.isFinite(available) ? Math.floor(available) : 0,
    ),
  )
  if (normalizedAvailable === 0) {
    return 0
  }
  const fallback = Number.isFinite(requested)
    ? Math.floor(requested)
    : normalizedAvailable
  if (!Number.isFinite(fallback)) {
    return normalizedAvailable
  }
  const clamped = Math.min(
    Math.max(fallback, MIN_TFMS_OPERATOR_COUNT),
    normalizedAvailable,
  )
  return clamped
}

function clampTfmsOperatorCount(value) {
  return normalizeTfmsOperatorCount(MAX_TFMS_OPERATOR_COUNT, value)
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

function cloneTfmsClamp(clamp) {
  const fallback = defaultTerrainTfmsClamp
  const min = Number.isFinite(clamp?.min) ? clamp.min : fallback?.min
  const max = Number.isFinite(clamp?.max) ? clamp.max : fallback?.max
  const result = {}
  if (Number.isFinite(min)) {
    result.min = min
  }
  if (Number.isFinite(max)) {
    result.max = max
  }
  return result
}

function cloneTfmsKamea(kamea) {
  if (!kamea || typeof kamea !== 'object') {
    return {
      temperament: defaultTerrainTfmsTemperament,
      modulationStrength: cloneTfmsRange({
        value: defaultTerrainTfmsKameaModulation,
        min: 0,
        max: 1,
      }),
      warpStrength: cloneTfmsRange({
        value: defaultTerrainTfmsKameaWarp,
        min: 0,
        max: 1,
      }),
      phaseStrength: cloneTfmsRange({
        value: defaultTerrainTfmsKameaPhase,
        min: 0,
        max: 1,
      }),
      spectralStrength: cloneTfmsRange({
        value: defaultTerrainTfmsKameaSpectral,
        min: 0,
        max: 1,
      }),
      spectralProfile: defaultTerrainTfmsKameaProfile,
      erosionPreset: defaultTerrainTfmsKameaErosion,
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
    temperament:
      typeof kamea.temperament === 'string'
        ? kamea.temperament
        : defaultTerrainTfmsTemperament,
    modulationStrength: cloneTfmsRange(
      kamea.modulationStrength ?? {
        value: defaultTerrainTfmsKameaModulation,
        min: 0,
        max: 1,
      },
    ),
    warpStrength: cloneTfmsRange(
      kamea.warpStrength ?? {
        value: defaultTerrainTfmsKameaWarp,
        min: 0,
        max: 1,
      },
    ),
    phaseStrength: cloneTfmsRange(
      kamea.phaseStrength ?? {
        value: defaultTerrainTfmsKameaPhase,
        min: 0,
        max: 1,
      },
    ),
    spectralStrength: cloneTfmsRange(
      kamea.spectralStrength ?? {
        value: defaultTerrainTfmsKameaSpectral,
        min: 0,
        max: 1,
      },
    ),
    spectralProfile:
      typeof kamea.spectralProfile === 'string'
        ? kamea.spectralProfile
        : defaultTerrainTfmsKameaProfile,
    erosionPreset:
      typeof kamea.erosionPreset === 'string'
        ? kamea.erosionPreset
        : defaultTerrainTfmsKameaErosion,
    ranges,
  }
}

function cloneTfmsPreset(preset = {}) {
  const clonedKamea = cloneTfmsKamea(preset.kamea)
  const waveforms = Array.isArray(preset.waveforms)
    ? preset.waveforms.map((waveform, index) => cloneTfmsWaveform(waveform, index))
    : []
  const operators = Array.isArray(preset.operators)
    ? preset.operators.map((operator, index) => cloneTfmsOperator(operator, index))
    : []
  const operatorCount = normalizeTfmsOperatorCount(
    operators.length,
    Number.isFinite(preset.operatorCount)
      ? preset.operatorCount
      : operators.length || MAX_TFMS_OPERATOR_COUNT,
  )
  if (operators.length > operatorCount) {
    operators.length = operatorCount
  }
  const modulationMatrix = Array.isArray(preset.modulationMatrix)
    ? preset.modulationMatrix.map((entry, index) => cloneTfmsMatrixEntry(entry, index))
    : []
  return {
    waveforms,
    operators,
    modulationMatrix,
    transferFunctions:
      preset.transferFunctions && typeof preset.transferFunctions === 'object'
        ? { ...preset.transferFunctions }
        : {},
    tectonic:
      preset.tectonic && typeof preset.tectonic === 'object'
        ? { ...preset.tectonic }
        : {},
    kamea: clonedKamea,
    temperament:
      typeof preset.temperament === 'string'
        ? preset.temperament
        : clonedKamea.temperament ?? defaultTerrainTfmsTemperament,
    baseAttenuation: Number.isFinite(preset.baseAttenuation)
      ? preset.baseAttenuation
      : defaultTerrainTfmsBaseAttenuation,
    clamp: cloneTfmsClamp(preset.clamp),
    biomeBlendStrength: Number.isFinite(preset.biomeBlendStrength)
      ? preset.biomeBlendStrength
      : defaultTerrainTfmsBiomeBlendStrength,
    defaults:
      preset.defaults && typeof preset.defaults === 'object'
        ? { ...preset.defaults }
        : undefined,
    operatorCount,
  }
}

/**
 * Create the serialisable TFMS preset used by the terrain engine.
 *
 * @param {typeof defaultTerrainCore} terrainDefaults
 * @returns {{
 *   clamp: TfmsRange,
 *   baseAttenuation: number,
 *   biomeBlendStrength: number,
 *   temperament: string,
 *   kamea: *,
 *   operators: TfmsOperatorPreset[],
 *   modulationMatrix: TfmsModulationLink[],
 *   transferFunctions: Object<string,string>,
 *   tectonic: *
 * }}
 */
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

  const clampValue = (value, min, max) => {
    let next = value
    if (Number.isFinite(min)) {
      next = Math.max(min, next)
    }
    if (Number.isFinite(max)) {
      next = Math.min(max, next)
    }
    return next
  }

  const safeMaxHeight = Math.max(
    Number.isFinite(terrainDefaults?.maxHeight)
      ? terrainDefaults.maxHeight
      : defaultTerrainEnvelope.maxHeight,
    1,
  )
  const baseAmplitudeRatio = baseAmplitude / safeMaxHeight
  const detailAmplitudeRatio = detailAmplitude / safeMaxHeight

  const baselineMaxHeight = Math.max(
    Number.isFinite(defaultTerrainCore?.maxHeight)
      ? defaultTerrainCore.maxHeight
      : defaultTerrainEnvelope.maxHeight,
    1,
  )
  const baselinePrimaryRatio =
    defaultTerrainCore.primaryAmplitude / baselineMaxHeight
  const baselineDetailRatio =
    defaultTerrainCore.detailAmplitude / baselineMaxHeight

  const amplitudeRatioNormalizedRaw =
    baselinePrimaryRatio > 0 ? baseAmplitudeRatio / baselinePrimaryRatio : 1
  const detailRatioNormalizedRaw =
    baselineDetailRatio > 0 ? detailAmplitudeRatio / baselineDetailRatio : 1

  const baseAttenuation = Number.isFinite(defaultTerrainTfmsBaseAttenuation)
    ? defaultTerrainTfmsBaseAttenuation
    : 1
  const clampMin = Number.isFinite(defaultTerrainTfmsClamp?.min)
    ? defaultTerrainTfmsClamp.min
    : Number.isFinite(terrainDefaults?.clamp?.min)
    ? terrainDefaults.clamp.min
    : defaultTerrainEnvelope.clampMin
  const clampMax = Number.isFinite(defaultTerrainTfmsClamp?.max)
    ? defaultTerrainTfmsClamp.max
    : Number.isFinite(terrainDefaults?.clamp?.max)
    ? terrainDefaults.clamp.max
    : defaultTerrainEnvelope.clampMax
  const biomeBlendStrength = Number.isFinite(defaultTerrainTfmsBiomeBlendStrength)
    ? defaultTerrainTfmsBiomeBlendStrength
    : 0.45

  const baselineDerivedModulation = clampValue(
    defaultTerrainCore.primaryAmplitude / 16,
    0.3,
    1,
  )
  const baselineDerivedWarp = clampValue(baselineDerivedModulation * 0.75, 0, 1)
  const baselineDerivedPhase = clampValue(
    baselineDerivedModulation * 0.45,
    0,
    1,
  )
  const baselineDerivedSpectral = clampValue(
    defaultTerrainCore.detailAmplitude / 6,
    0.2,
    1,
  )

  let derivedModulation = clampValue(baseAmplitude / 16, 0.3, 1)
  let derivedWarp = clampValue(derivedModulation * 0.75, 0, 1)
  let derivedPhase = clampValue(derivedModulation * 0.45, 0, 1)
  let derivedSpectral = clampValue(detailAmplitude / 6, 0.2, 1)

  const chunkSizeCandidate = Number.isFinite(terrainDefaults?.chunkSize)
    ? terrainDefaults.chunkSize
    : Number.isFinite(terrainDefaults?.chunk?.size)
    ? terrainDefaults.chunk.size
    : DEFAULT_CHUNK_SIZE
  const normalizedChunkSize = normalizeChunkSizeForEnvelope(chunkSizeCandidate)
  let domainWarpAmplitudeMultiplier = 0.32
  let domainWarpAmplitudeMax = 256
  let domainWarpFrequencyMultiplier = 0.65
  let domainWarpPrimaryGainValue = 0.7
  let domainWarpRidgeGainValue = 0.5
  let domainWarpGainLimit = 4

  if (amplitudeRatioNormalizedRaw > 1) {
    const amplitudeScale = Math.min(amplitudeRatioNormalizedRaw, 4)

    const modulationRatioTarget = baselineDerivedModulation * amplitudeScale
    derivedModulation = clampValue(
      Math.min(derivedModulation, modulationRatioTarget) * 0.99,
      0.3,
      0.99,
    )
    derivedWarp = clampValue(
      Math.min(derivedWarp, baselineDerivedWarp * amplitudeScale) * 0.98,
      0,
      0.8,
    )
    derivedPhase = clampValue(
      Math.min(derivedPhase, baselineDerivedPhase * amplitudeScale) * 0.98,
      0,
      0.75,
    )

    const warpLimit = Math.max(4, normalizedChunkSize * 0.28 * amplitudeScale)
    domainWarpAmplitudeMultiplier = clampValue(
      domainWarpAmplitudeMultiplier * amplitudeScale,
      0,
      warpLimit / Math.max(baseAmplitude, 1),
    )
    domainWarpAmplitudeMax = Math.min(256, warpLimit)
    domainWarpFrequencyMultiplier = clampValue(
      domainWarpFrequencyMultiplier * amplitudeScale,
      0.2,
      1,
    )

    const warpCarrierAmplitude =
      baseAmplitude * Math.max(domainWarpAmplitudeMultiplier, 0)
    domainWarpGainLimit = Math.min(
      4,
      warpCarrierAmplitude > 0
        ? warpLimit / Math.max(warpCarrierAmplitude, 1)
        : 4,
    )
    domainWarpPrimaryGainValue = clampValue(
      domainWarpPrimaryGainValue * amplitudeScale,
      0,
      domainWarpGainLimit,
    )
    domainWarpRidgeGainValue = clampValue(
      domainWarpRidgeGainValue * amplitudeScale,
      0,
      domainWarpGainLimit,
    )
  }

  if (detailRatioNormalizedRaw > 1) {
    const detailScale = Math.min(detailRatioNormalizedRaw, 4)
    derivedSpectral = clampValue(
      Math.min(derivedSpectral, baselineDerivedSpectral * detailScale) * 0.98,
      0.2,
      0.98,
    )
  }

  const modulationStrength = Number.isFinite(defaultTerrainTfmsKameaModulation)
    ? defaultTerrainTfmsKameaModulation
    : derivedModulation
  const warpStrength = Number.isFinite(defaultTerrainTfmsKameaWarp)
    ? defaultTerrainTfmsKameaWarp
    : derivedWarp
  const phaseStrength = Number.isFinite(defaultTerrainTfmsKameaPhase)
    ? defaultTerrainTfmsKameaPhase
    : derivedPhase
  const spectralStrength = Number.isFinite(defaultTerrainTfmsKameaSpectral)
    ? defaultTerrainTfmsKameaSpectral
    : derivedSpectral
  const temperament =
    typeof defaultTerrainTfmsTemperament === 'string'
      ? defaultTerrainTfmsTemperament
      : 'Saturn 3x3'
  const spectralProfile =
    typeof defaultTerrainTfmsKameaProfile === 'string'
      ? defaultTerrainTfmsKameaProfile
      : 'band'
  const erosionPreset =
    typeof defaultTerrainTfmsKameaErosion === 'string'
      ? defaultTerrainTfmsKameaErosion
      : 'standard'

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

  const domainWarpAmplitudeRange = Object.freeze({
    baseKey: 'primaryAmplitude',
    multiplier: domainWarpAmplitudeMultiplier,
    min: 0,
    max: domainWarpAmplitudeMax,
  })
  const domainWarpFrequencyRange = Object.freeze({
    baseKey: 'primaryFrequency',
    multiplier: domainWarpFrequencyMultiplier,
    min: 0.0001,
    max: 1,
  })
  const domainWarpPrimaryGainRange = Object.freeze({
    value: domainWarpPrimaryGainValue,
    min: -domainWarpGainLimit,
    max: domainWarpGainLimit,
  })
  const domainWarpRidgeGainRange = Object.freeze({
    value: domainWarpRidgeGainValue,
    min: -domainWarpGainLimit,
    max: domainWarpGainLimit,
  })

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
        amplitude: domainWarpAmplitudeRange,
        frequency: domainWarpFrequencyRange,
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
      gain: domainWarpPrimaryGainRange,
    }),
    Object.freeze({
      id: 'domain-warp->primary-fbm:domain-z',
      sourceId: 'domain-warp',
      targetId: 'primary-fbm',
      routing: 'domainWarp',
      channel: 'domainZ',
      axis: 'z',
      gain: domainWarpPrimaryGainRange,
    }),
    Object.freeze({
      id: 'domain-warp->ridge-noise:domain-x',
      sourceId: 'domain-warp',
      targetId: 'ridge-noise',
      routing: 'domainWarp',
      channel: 'domainX',
      axis: 'x',
      gain: domainWarpRidgeGainRange,
    }),
    Object.freeze({
      id: 'domain-warp->ridge-noise:domain-z',
      sourceId: 'domain-warp',
      targetId: 'ridge-noise',
      routing: 'domainWarp',
      channel: 'domainZ',
      axis: 'z',
      gain: domainWarpRidgeGainRange,
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
    temperament,
    modulationStrength: Object.freeze({ value: modulationStrength, min: 0, max: 1 }),
    warpStrength: Object.freeze({ value: warpStrength, min: 0, max: 1 }),
    phaseStrength: Object.freeze({ value: phaseStrength, min: 0, max: 1 }),
    spectralProfile,
    spectralStrength: Object.freeze({ value: spectralStrength, min: 0, max: 1 }),
    erosionPreset,
    ranges: kameaRanges,
  })

  return Object.freeze({
    waveforms: Object.freeze(waveforms),
    operators: Object.freeze(operators),
    modulationMatrix: Object.freeze(modulationMatrix),
    transferFunctions: Object.freeze({}),
    tectonic,
    kamea,
    temperament,
    baseAttenuation,
    clamp: Object.freeze({ min: clampMin, max: clampMax }),
    biomeBlendStrength,
    operatorCount: operators.length,
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
  if (!mapped.hasOwnProperty('operatorCount')) {
    const candidate = overrides.operatorCount ?? overrides.tfmsOperatorCount
    if (Number.isFinite(candidate)) {
      mapped.operatorCount = candidate
    }
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

  if (normalizedOverrides.hasOwnProperty('baseAttenuation')) {
    if (isFiniteNumber(normalizedOverrides.baseAttenuation)) {
      target.baseAttenuation = normalizedOverrides.baseAttenuation
    }
  }

  if (normalizedOverrides.clamp && isObject(normalizedOverrides.clamp)) {
    target.clamp = target.clamp ?? cloneTfmsClamp(target.clamp)
    if (
      normalizedOverrides.clamp.hasOwnProperty('min') &&
      isFiniteNumber(normalizedOverrides.clamp.min)
    ) {
      target.clamp.min = normalizedOverrides.clamp.min
    }
    if (
      normalizedOverrides.clamp.hasOwnProperty('max') &&
      isFiniteNumber(normalizedOverrides.clamp.max)
    ) {
      target.clamp.max = normalizedOverrides.clamp.max
    }
  }

  if (normalizedOverrides.hasOwnProperty('biomeBlendStrength')) {
    if (isFiniteNumber(normalizedOverrides.biomeBlendStrength)) {
      target.biomeBlendStrength = normalizedOverrides.biomeBlendStrength
    }
  }

  if (typeof normalizedOverrides.temperament === 'string') {
    target.kamea.temperament = normalizedOverrides.temperament
    target.temperament = normalizedOverrides.temperament
  }
  if (typeof normalizedOverrides.kameaTemperament === 'string') {
    target.kamea.temperament = normalizedOverrides.kameaTemperament
    target.temperament = normalizedOverrides.kameaTemperament
  }
  if (normalizedOverrides.kamea && isObject(normalizedOverrides.kamea)) {
    mergeTfmsKamea(target.kamea, normalizedOverrides.kamea)
  }
  if (target.kamea && typeof target.kamea.temperament === 'string') {
    target.temperament = target.kamea.temperament
  }

  const availableOperatorSlots = Array.isArray(target.operators)
    ? target.operators.length
    : 0
  if (normalizedOverrides.hasOwnProperty('operatorCount')) {
    const requested = normalizedOverrides.operatorCount
    target.operatorCount = normalizeTfmsOperatorCount(
      availableOperatorSlots,
      Number.isFinite(requested) ? requested : target.operatorCount,
    )
  } else {
    target.operatorCount = normalizeTfmsOperatorCount(
      availableOperatorSlots,
      target.operatorCount,
    )
  }
  if (
    Array.isArray(target.operators) &&
    target.operatorCount > 0 &&
    target.operators.length > target.operatorCount
  ) {
    target.operators.length = target.operatorCount
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

  if (!worldOptions.environment) {
    worldOptions.environment = { skyboxId: defaultEnvironmentOptions.skyboxId }
  } else if (typeof worldOptions.environment.skyboxId !== 'string') {
    worldOptions.environment.skyboxId = defaultEnvironmentOptions.skyboxId
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

  const previousChunkSize = Number.isFinite(worldOptions.chunk?.size)
    ? worldOptions.chunk.size
    : DEFAULT_CHUNK_SIZE
  let chunkSizeChanged = false
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
    chunkSizeChanged = normalizedChunkSize !== previousChunkSize
    worldOptions.chunk.size = normalizedChunkSize
    worldOptions.chunkSize = normalizeWithDescriptor(
      normalizedChunkSize,
      worldOptions.chunkSize,
      ['chunkSize'],
    )
  }

  const environmentOverrides = isObject(overrides.environment)
    ? overrides.environment
    : null
  const applySkyboxOverride = (candidate) => {
    const fallbackSkyboxId = defaultEnvironmentOptions.skyboxId
    if (candidate === null || candidate === undefined) {
      worldOptions.environment.skyboxId = fallbackSkyboxId
      return
    }
    worldOptions.environment.skyboxId = normalizeEnvironmentSkyboxId(
      candidate,
      fallbackSkyboxId,
    )
  }
  if (
    environmentOverrides &&
    Object.prototype.hasOwnProperty.call(environmentOverrides, 'skyboxId')
  ) {
    applySkyboxOverride(environmentOverrides.skyboxId)
  } else if (Object.prototype.hasOwnProperty.call(overrides, 'skyboxId')) {
    applySkyboxOverride(overrides.skyboxId)
  }

  const terrainOverrides = isObject(overrides.terrain) ? overrides.terrain : null

  let maxHeightOverrideProvided = false
  let clampMinOverrideProvided = false
  let clampMaxOverrideProvided = false

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
    maxHeightOverrideProvided = true
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
    clampMinOverrideProvided = true
    worldOptions.terrain.clamp.min = normalizeWithDescriptor(
      resolvedClampMin,
      worldOptions.terrain.clamp.min,
      ['terrain', 'clamp', 'min'],
    )
  }
  const resolvedClampMax = normalizeNumber(clampOverrides?.max, null)
  if (resolvedClampMax !== null) {
    clampMaxOverrideProvided = true
    const clampMax = normalizeWithDescriptor(
      resolvedClampMax,
      worldOptions.terrain.clamp.max,
      ['terrain', 'clamp', 'max'],
    )
    worldOptions.terrain.clamp.max = clampMax
    worldOptions.maxHeight = Math.max(worldOptions.maxHeight, clampMax)
  }

  const clampOverrideProvided = clampMinOverrideProvided || clampMaxOverrideProvided

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
    'shoreSlopeBias',
  ]

  const hasTerrainOverride = (key) =>
    terrainOverrides && Object.prototype.hasOwnProperty.call(terrainOverrides, key)

  const primaryFrequencyOverrideProvided = hasTerrainOverride('primaryFrequency')
  const detailFrequencyOverrideProvided = hasTerrainOverride('detailFrequency')
  const ridgeFrequencyOverrideProvided = hasTerrainOverride('ridgeFrequency')
  const primaryAmplitudeOverrideProvided = hasTerrainOverride('primaryAmplitude')
  const detailAmplitudeOverrideProvided = hasTerrainOverride('detailAmplitude')
  const ridgeStrengthOverrideProvided = hasTerrainOverride('ridgeStrength')

  terrainOptionKeys.forEach((key) => {
    if (key in (terrainOverrides ?? {})) {
      worldOptions.terrain[key] = normalizeWithDescriptor(
        terrainOverrides[key],
        worldOptions.terrain[key],
        ['terrain', key],
      )
    }
  })

  if (chunkSizeChanged) {
    const waveDefaults = computeTerrainWaveDefaults({
      chunkSize: worldOptions.chunk.size,
      baseHeight: worldOptions.terrain.baseHeight,
    })

    if (!primaryFrequencyOverrideProvided) {
      worldOptions.terrain.primaryFrequency = waveDefaults.primaryFrequency
    }
    if (!detailFrequencyOverrideProvided) {
      worldOptions.terrain.detailFrequency = waveDefaults.detailFrequency
    }
    if (!ridgeFrequencyOverrideProvided) {
      worldOptions.terrain.ridgeFrequency = waveDefaults.ridgeFrequency
    }
    if (!primaryAmplitudeOverrideProvided) {
      worldOptions.terrain.primaryAmplitude = waveDefaults.primaryAmplitude
    }
    if (!detailAmplitudeOverrideProvided) {
      worldOptions.terrain.detailAmplitude = waveDefaults.detailAmplitude
    }
    if (!ridgeStrengthOverrideProvided) {
      worldOptions.terrain.ridgeStrength = waveDefaults.ridgeStrength
    }
  }

  let tfmsClampOverrideProvided = false
  const topLevelTfmsOverrides = isObject(overrides.tfms)
    ? overrides.tfms
    : null
  const nestedTfmsOverrides = isObject(terrainOverrides?.tfms)
    ? terrainOverrides.tfms
    : null

  if (topLevelTfmsOverrides) {
    if (isObject(topLevelTfmsOverrides.clamp)) {
      tfmsClampOverrideProvided = true
    }
    applyTfmsOverrides(worldOptions.terrain.tfms, topLevelTfmsOverrides)
  }
  if (nestedTfmsOverrides) {
    if (isObject(nestedTfmsOverrides.clamp)) {
      tfmsClampOverrideProvided = true
    }
    applyTfmsOverrides(worldOptions.terrain.tfms, nestedTfmsOverrides)
  }

  const legacyTfmsOverrideSources = [overrides, terrainOverrides]
  legacyTfmsOverrideSources.forEach((candidate) => {
    if (!isObject(candidate)) {
      return
    }
    if (isObject(candidate.clamp)) {
      tfmsClampOverrideProvided = true
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

  const derivedEnvelope = computeTerrainVerticalEnvelope(worldOptions.chunk.size)
  syncTerrainVerticalEnvelope(worldOptions, derivedEnvelope, {
    forceClamp: chunkSizeChanged && !clampOverrideProvided,
    forceMaxHeight: chunkSizeChanged && !maxHeightOverrideProvided,
    forceTfmsClamp: chunkSizeChanged && !tfmsClampOverrideProvided,
  })

  worldOptions.baseHeight = normalizeWithDescriptor(
    worldOptions.baseHeight,
    DEFAULT_TERRAIN_BASE_HEIGHT,
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
      derivedEnvelope.maxHeight,
      ['terrain', 'maxHeight'],
    ),
    minimumMaxHeight,
  )
  worldOptions.maxHeight = Math.max(
    normalizeWithDescriptor(
      worldOptions.maxHeight,
      derivedEnvelope.maxHeight,
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
    derivedEnvelope.clampMin,
    ['terrain', 'clamp', 'min'],
  )
  worldOptions.terrain.clamp.max = Math.max(
    normalizeWithDescriptor(
      worldOptions.terrain.clamp.max,
      derivedEnvelope.clampMax,
      ['terrain', 'clamp', 'max'],
    ),
    worldOptions.terrain.clamp.min,
    worldOptions.maxHeight,
  )
  worldOptions.maxHeight = Math.max(
    worldOptions.maxHeight,
    worldOptions.terrain.clamp.max,
    derivedEnvelope.maxHeight,
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

  clearTerrainSampleCache()

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
  if (!worldOptions.environment) {
    worldOptions.environment = {}
  }
  Object.assign(worldOptions.environment, fresh.environment)
  Object.assign(worldOptions.terrain, fresh.terrain)
  worldOptions.terrain.clamp.min = fresh.terrain.clamp.min
  worldOptions.terrain.clamp.max = fresh.terrain.clamp.max

  Object.keys(worldOptions.biomes).forEach((key) => {
    delete worldOptions.biomes[key]
  })
  Object.assign(worldOptions.biomes, fresh.biomes)

  clearTerrainSampleCache()

  return worldOptions
}
