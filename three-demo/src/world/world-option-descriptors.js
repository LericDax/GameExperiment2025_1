// Each descriptor describes a configurable world-generation option.
//
// Leaf descriptors provide:
// - `id`: unique stable identifier for UI/forms.
// - `label` & `description`: strings for presentation.
// - `type`: primitive type or the string 'group' for nested nodes.
// - `default`: default value used by world-settings.
// - `min`/`max`/`step`: numeric constraints for sliders/inputs.
// - `path`: Array path pointing into the live world options object.
//
// Group descriptors only include `children` and serve for logical grouping.

const numberType = 'number'
const groupType = 'group'

const seedDescriptor = Object.freeze({
  id: 'seed',
  label: 'World Seed',
  description:
    'Seed value used to deterministically generate terrain, biomes, and structures.',
  type: 'seed',
  default: 1337,
  path: Object.freeze(['seed']),
})

const chunkGroup = Object.freeze({
  id: 'chunk',
  label: 'Chunk',
  description: 'Chunk layout controls for the voxel world.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'chunk.size',
      label: 'Chunk Size',
      description: 'Voxel width/height/depth of each generated chunk.',
      type: numberType,
      min: 1,
      max: 512,
      step: 1,
      default: 48,
      path: Object.freeze(['chunk', 'size']),
    }),
  ]),
})

const legacyChunkSizeDescriptor = Object.freeze({
  id: 'chunkSize',
  label: 'Chunk Size (alias)',
  description: 'Legacy top-level alias that mirrors the chunk size setting.',
  type: numberType,
  min: 1,
  max: 512,
  step: 1,
  default: 48,
  path: Object.freeze(['chunkSize']),
})

const waterGroup = Object.freeze({
  id: 'water',
  label: 'Water',
  description: 'Water simulation configuration.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'water.level',
      label: 'Water Level',
      description: 'Absolute voxel height for the ocean surface.',
      type: numberType,
      min: -128,
      max: 256,
      step: 1,
      default: 9,
      path: Object.freeze(['water', 'level']),
    }),
  ]),
})

const legacyWaterLevelDescriptor = Object.freeze({
  id: 'waterLevel',
  label: 'Water Level (alias)',
  description: 'Legacy top-level alias that mirrors the water level setting.',
  type: numberType,
  min: -128,
  max: 256,
  step: 1,
  default: 9,
  path: Object.freeze(['waterLevel']),
})

const terrainGroup = Object.freeze({
  id: 'terrain',
  label: 'Terrain',
  description: 'Primary terrain shape controls.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'terrain.baseHeight',
      label: 'Base Height',
      description: 'Average terrain elevation before noise-based variation.',
      type: numberType,
      min: 0,
      max: 512,
      step: 1,
      default: 6,
      path: Object.freeze(['terrain', 'baseHeight']),
    }),
    Object.freeze({
      id: 'terrain.maxHeight',
      label: 'Maximum Height',
      description:
        'Hard cap on how tall terrain columns may grow before clamping to a ceiling.',
      type: numberType,
      min: 1,
      max: 1024,
      step: 1,
      default: 20,
      path: Object.freeze(['terrain', 'maxHeight']),
    }),
    Object.freeze({
      id: 'terrain.clamp.min',
      label: 'Clamp Minimum',
      description:
        'Lower clamp bound applied after noise sampling to prevent deep pits.',
      type: numberType,
      min: 0,
      max: 1024,
      step: 1,
      default: 2,
      path: Object.freeze(['terrain', 'clamp', 'min']),
    }),
    Object.freeze({
      id: 'terrain.clamp.max',
      label: 'Clamp Maximum',
      description:
        'Upper clamp bound applied after noise sampling to prevent towering spikes.',
      type: numberType,
      min: 1,
      max: 1024,
      step: 1,
      default: 20,
      path: Object.freeze(['terrain', 'clamp', 'max']),
    }),
    Object.freeze({
      id: 'terrain.primaryFrequency',
      label: 'Primary Frequency',
      description:
        'Base frequency for macro terrain variation. Lower values create large landforms.',
      type: numberType,
      min: 0.0001,
      max: 1,
      step: 0.0001,
      default: 0.06,
      path: Object.freeze(['terrain', 'primaryFrequency']),
    }),
    Object.freeze({
      id: 'terrain.primaryAmplitude',
      label: 'Primary Amplitude',
      description:
        'Strength of the macro terrain wave. Higher values exaggerate hills and valleys.',
      type: numberType,
      min: 0,
      max: 256,
      step: 0.1,
      default: 8,
      path: Object.freeze(['terrain', 'primaryAmplitude']),
    }),
    Object.freeze({
      id: 'terrain.primaryOffset',
      label: 'Primary Offset',
      description: 'Phase offset applied to the macro terrain noise field.',
      type: numberType,
      min: -10000,
      max: 10000,
      step: 1,
      default: 0,
      path: Object.freeze(['terrain', 'primaryOffset']),
    }),
    Object.freeze({
      id: 'terrain.detailFrequency',
      label: 'Detail Frequency',
      description: 'Frequency of secondary detail used to break up flat areas.',
      type: numberType,
      min: 0.0001,
      max: 2,
      step: 0.0001,
      default: 0.12,
      path: Object.freeze(['terrain', 'detailFrequency']),
    }),
    Object.freeze({
      id: 'terrain.detailAmplitude',
      label: 'Detail Amplitude',
      description: 'Strength of the secondary detail contribution.',
      type: numberType,
      min: 0,
      max: 128,
      step: 0.1,
      default: 3,
      path: Object.freeze(['terrain', 'detailAmplitude']),
    }),
    Object.freeze({
      id: 'terrain.detailOffset',
      label: 'Detail Offset',
      description: 'Phase offset for the detail terrain noise.',
      type: numberType,
      min: -10000,
      max: 10000,
      step: 1,
      default: 100,
      path: Object.freeze(['terrain', 'detailOffset']),
    }),
    Object.freeze({
      id: 'terrain.ridgeFrequency',
      label: 'Ridge Frequency',
      description: 'Frequency controlling how often sharp ridgelines occur.',
      type: numberType,
      min: 0.0001,
      max: 1,
      step: 0.0001,
      default: 0.02,
      path: Object.freeze(['terrain', 'ridgeFrequency']),
    }),
    Object.freeze({
      id: 'terrain.ridgeStrength',
      label: 'Ridge Strength',
      description: 'Strength multiplier for ridge contributions on top of base terrain.',
      type: numberType,
      min: 0,
      max: 64,
      step: 0.1,
      default: 2.4,
      path: Object.freeze(['terrain', 'ridgeStrength']),
    }),
    Object.freeze({
      id: 'terrain.ridgeOffset',
      label: 'Ridge Offset',
      description: 'Phase offset for the ridge noise sampler.',
      type: numberType,
      min: -10000,
      max: 10000,
      step: 1,
      default: 220,
      path: Object.freeze(['terrain', 'ridgeOffset']),
    }),
    Object.freeze({
      id: 'terrain.climateHeightInfluence',
      label: 'Climate Height Influence',
      description:
        'How strongly biome climate data affects the perceived terrain elevation.',
      type: numberType,
      min: -10,
      max: 10,
      step: 0.05,
      default: 1.2,
      path: Object.freeze(['terrain', 'climateHeightInfluence']),
    }),
  ]),
})

const legacyBaseHeightDescriptor = Object.freeze({
  id: 'baseHeight',
  label: 'Base Height (alias)',
  description:
    'Legacy top-level alias mirroring the terrain base height for compatibility.',
  type: numberType,
  min: 0,
  max: 512,
  step: 1,
  default: 6,
  path: Object.freeze(['baseHeight']),
})

const legacyMaxHeightDescriptor = Object.freeze({
  id: 'maxHeight',
  label: 'Max Height (alias)',
  description:
    'Legacy top-level alias mirroring the terrain max height for compatibility.',
  type: numberType,
  min: 1,
  max: 1024,
  step: 1,
  default: 20,
  path: Object.freeze(['maxHeight']),
})

const biomesGroup = Object.freeze({
  id: 'biomes',
  label: 'Biomes',
  description: 'Controls for procedural biome sampling and distribution.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'biomes.scale',
      label: 'Biome Scale',
      description:
        'Base frequency for the temperature/moisture noise fields. Lower values produce larger biome continents.',
      type: numberType,
      min: 0.0005,
      max: 0.02,
      step: 0.0001,
      default: 0.003,
      path: Object.freeze(['biomes', 'scale']),
    }),
    Object.freeze({
      id: 'biomes.detailMultiplier',
      label: 'Detail Multiplier',
      description:
        'Multiplier applied to the base scale for secondary climate detail noise.',
      type: numberType,
      min: 0.1,
      max: 10,
      step: 0.01,
      default: 2.15,
      path: Object.freeze(['biomes', 'detailMultiplier']),
    }),
    Object.freeze({
      id: 'biomes.moistureDetailMultiplier',
      label: 'Moisture Detail Multiplier',
      description:
        'Multiplier that adjusts the moisture detail scale relative to the temperature field.',
      type: numberType,
      min: 0.1,
      max: 4,
      step: 0.01,
      default: 1.18,
      path: Object.freeze(['biomes', 'moistureDetailMultiplier']),
    }),
    Object.freeze({
      id: 'biomes.varianceMultiplier',
      label: 'Variance Multiplier',
      description: 'Controls how strongly biome variance noise distorts the climate map.',
      type: numberType,
      min: 0,
      max: 2,
      step: 0.01,
      default: 0.45,
      path: Object.freeze(['biomes', 'varianceMultiplier']),
    }),
    Object.freeze({
      id: 'biomes.variationStrength',
      label: 'Variation Strength',
      description: 'Strength of the random jitter applied when selecting the closest biome.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.18,
      path: Object.freeze(['biomes', 'variationStrength']),
    }),
  ]),
})

export const worldOptionDescriptors = Object.freeze([
  seedDescriptor,
  chunkGroup,
  legacyChunkSizeDescriptor,
  waterGroup,
  legacyWaterLevelDescriptor,
  terrainGroup,
  legacyBaseHeightDescriptor,
  legacyMaxHeightDescriptor,
  biomesGroup,
])

export function worldOptionPathToKey(path) {
  return Array.isArray(path) ? path.join('.') : ''
}

export function createWorldOptionDescriptorIndex(
  descriptors = worldOptionDescriptors,
) {
  const index = new Map()

  const stack = [...descriptors]
  while (stack.length > 0) {
    const descriptor = stack.pop()
    if (!descriptor) {
      continue
    }
    if (Array.isArray(descriptor.children)) {
      descriptor.children.forEach((child) => stack.push(child))
    }
    if (Array.isArray(descriptor.path)) {
      index.set(worldOptionPathToKey(descriptor.path), descriptor)
    }
  }

  return index
}

export function flattenWorldOptionDescriptors(
  descriptors = worldOptionDescriptors,
) {
  const flattened = []
  const stack = [...descriptors]
  while (stack.length > 0) {
    const descriptor = stack.pop()
    if (!descriptor) {
      continue
    }
    if (Array.isArray(descriptor.children)) {
      descriptor.children.forEach((child) => stack.push(child))
    }
    if (Array.isArray(descriptor.path)) {
      flattened.push(descriptor)
    }
  }
  return flattened
}
