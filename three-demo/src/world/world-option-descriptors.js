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

import {
  FALLBACK_SKYBOX_ID,
  listSkyboxes,
} from '../rendering/skyboxes/skybox-manager.js'

const numberType = 'number'
const stringType = 'string'
const enumType = 'enum'
const groupType = 'group'

function buildEnvironmentSkyboxOptions() {
  const seen = new Set()
  const ids = []
  const pushId = (value) => {
    if (typeof value !== 'string') {
      return
    }
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    ids.push(trimmed)
  }

  pushId(FALLBACK_SKYBOX_ID)
  pushId('skybox-1#invertY')
  pushId('skybox-1')
  listSkyboxes().forEach(pushId)

  return Object.freeze(
    ids.map((id) =>
      Object.freeze({
        value: id,
        label: id,
      }),
    ),
  )
}

const environmentSkyboxOptions = buildEnvironmentSkyboxOptions()

const tfmsWaveformOptions = Object.freeze([
  Object.freeze({
    value: 'primary-fbm',
    label: 'Primary FBM',
    description: 'Fractal Brownian motion carrier used for macro height variation.',
  }),
  Object.freeze({
    value: 'ridge-noise',
    label: 'Ridge Noise',
    description: 'Ridged FBM emphasizing sharp mountain crests and valleys.',
  }),
  Object.freeze({
    value: 'anisotropic-banding',
    label: 'Anisotropic Banding',
    description: 'Directional sine banding that introduces layered striations.',
  }),
  Object.freeze({
    value: 'tectonic-worley',
    label: 'Tectonic Worley',
    description: 'Cellular Worley noise that injects tectonic plate style features.',
  }),
  Object.freeze({
    value: 'domain-warp',
    label: 'Domain Warp',
    description: 'Vector warp field that distorts the sampling domain of other operators.',
  }),
  Object.freeze({
    value: 'diffusion-mask',
    label: 'Diffusion Mask',
    description: 'Anisotropic diffusion mask used for soft erosion-style blending.',
  }),
])

const tfmsTransferOptions = Object.freeze([
  Object.freeze({ value: 'identity', label: 'Identity' }),
  Object.freeze({ value: 'abs', label: 'Absolute' }),
  Object.freeze({ value: 'square', label: 'Square' }),
  Object.freeze({ value: 'cube', label: 'Cube' }),
  Object.freeze({ value: 'tanh', label: 'Tanh' }),
  Object.freeze({ value: 'smoothstep', label: 'Smoothstep' }),
  Object.freeze({ value: 'sigmoid', label: 'Sigmoid' }),
  Object.freeze({ value: 'clamp01', label: 'Clamp 0-1' }),
  Object.freeze({ value: 'clamp11', label: 'Clamp -1-1' }),
])

function createTfmsOperatorGroup({
  index,
  id,
  label,
  description,
  defaults,
  tectonic,
  warpStep = 0.5,
  domainWarpRange,
}) {
  const basePath = Object.freeze(['terrain', 'tfms', 'operators', index])
  const modulationBase = Object.freeze([...basePath, 'modulation'])
  const envelopeBase = Object.freeze([...basePath, 'envelope'])

  const makeEnvelopePath = (key, axis) =>
    axis
      ? Object.freeze([...envelopeBase, key, axis])
      : Object.freeze([...envelopeBase, key])
  const makeModulationPath = (key, axis) =>
    axis
      ? Object.freeze([...modulationBase, key, axis])
      : Object.freeze([...modulationBase, key])

  return Object.freeze({
    id: `terrain.tfms.operators.${id}`,
    label,
    description,
    type: groupType,
    children: Object.freeze([
      Object.freeze({
        id: `terrain.tfms.operators.${id}.waveformId`,
        label: 'Waveform Bank',
        description:
          'Select which sampled waveform bank drives this operator before modulation.',
        type: enumType,
        default: defaults.waveformId,
        options: tfmsWaveformOptions,
        path: Object.freeze([...basePath, 'waveformId']),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.weight`,
        label: 'Weight',
        description:
          'Linear mix amount applied after the transfer function. Higher values make this operator more dominant in the final envelope.',
        type: numberType,
        min: -8,
        max: 8,
        step: 0.01,
        default: defaults.weight,
        path: Object.freeze([...basePath, 'weight']),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.bias`,
        label: 'Bias',
        description:
          'Constant offset applied after weighting. Useful for nudging operators above or below neutral terrain.',
        type: numberType,
        min: -8,
        max: 8,
        step: 0.01,
        default: defaults.bias,
        path: Object.freeze([...basePath, 'bias']),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.transfer`,
        label: 'Transfer Function',
        description:
          'Shape the raw waveform output before mixing. Non-linear transfers accentuate ridges, terraces, or plateaus.',
        type: enumType,
        default: defaults.transfer,
        options: tfmsTransferOptions,
        path: Object.freeze([...basePath, 'transfer', 'id']),
      }),
      tectonic
        ? Object.freeze({
            id: `terrain.tfms.operators.${id}.tectonic`,
            label: 'Tectonic Weight',
            description:
              'Contribution of this operator to the tectonic accumulator prior to the blend stage.',
            type: numberType,
            min: 0,
            max: 1,
            step: 0.01,
            default: tectonic.weight,
            path: Object.freeze([...basePath, 'tectonic', 'weight']),
          })
        : null,
      Object.freeze({
        id: `terrain.tfms.operators.${id}.envelope.amplitude`,
        label: 'Amplitude Multiplier',
        description:
          'Scales the operator amplitude relative to the referenced terrain option (Base Height/Detail/Ridge strength).',
        type: numberType,
        min: 0,
        max: defaults.amplitude.max,
        step: 0.01,
        default: defaults.amplitude.multiplier,
        path: Object.freeze([
          ...makeEnvelopePath('amplitude'),
          'multiplier',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.envelope.frequency`,
        label: 'Frequency Multiplier',
        description:
          'Scales the sampling frequency relative to its linked terrain control.',
        type: numberType,
        min: defaults.frequency.min,
        max: defaults.frequency.max,
        step: 0.0001,
        default: defaults.frequency.multiplier,
        path: Object.freeze([
          ...makeEnvelopePath('frequency'),
          'multiplier',
        ]),
      }),
      domainWarpRange
        ? Object.freeze({
            id: `terrain.tfms.operators.${id}.envelope.warp.x`,
            label: 'Domain Warp X',
            description:
              'Amount of lateral domain warping injected along the X axis before sampling the waveform.',
            type: numberType,
            min: domainWarpRange.min,
            max: domainWarpRange.max,
            step: warpStep,
            default: domainWarpRange.value,
            path: Object.freeze([
              ...makeEnvelopePath('warp', 'x'),
              'value',
            ]),
          })
        : null,
      domainWarpRange
        ? Object.freeze({
            id: `terrain.tfms.operators.${id}.envelope.warp.z`,
            label: 'Domain Warp Z',
            description:
              'Amount of lateral domain warping injected along the Z axis before sampling the waveform.',
            type: numberType,
            min: domainWarpRange.min,
            max: domainWarpRange.max,
            step: warpStep,
            default: domainWarpRange.value,
            path: Object.freeze([
              ...makeEnvelopePath('warp', 'z'),
              'value',
            ]),
          })
        : null,
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.amplitude`,
        label: 'Modulation Amplitude Bias',
        description:
          'Base FM modulation applied to amplitude before matrix routing contributes additional offsets.',
        type: numberType,
        min: -1,
        max: 1,
        step: 0.01,
        default: defaults.modulation.amplitude,
        path: Object.freeze([
          ...makeModulationPath('amplitude'),
          'value',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.frequency`,
        label: 'Modulation Frequency Bias',
        description:
          'Base FM modulation applied to frequency before matrix routing contributes additional offsets.',
        type: numberType,
        min: -1,
        max: 1,
        step: 0.01,
        default: defaults.modulation.frequency,
        path: Object.freeze([
          ...makeModulationPath('frequency'),
          'value',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.phase.x`,
        label: 'Modulation Phase X',
        description:
          'Phase modulation bias applied along the X axis (in radians) prior to modulation matrix routing.',
        type: numberType,
        min: -Math.PI,
        max: Math.PI,
        step: 0.01,
        default: 0,
        path: Object.freeze([
          ...makeModulationPath('phase', 'x'),
          'value',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.phase.z`,
        label: 'Modulation Phase Z',
        description:
          'Phase modulation bias applied along the Z axis (in radians) prior to modulation matrix routing.',
        type: numberType,
        min: -Math.PI,
        max: Math.PI,
        step: 0.01,
        default: 0,
        path: Object.freeze([
          ...makeModulationPath('phase', 'z'),
          'value',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.warp.x`,
        label: 'Modulation Warp X',
        description:
          'Domain warp modulation bias applied along the X axis prior to matrix routing.',
        type: numberType,
        min: domainWarpRange ? domainWarpRange.min : -128,
        max: domainWarpRange ? domainWarpRange.max : 128,
        step: warpStep,
        default: 0,
        path: Object.freeze([
          ...makeModulationPath('warp', 'x'),
          'value',
        ]),
      }),
      Object.freeze({
        id: `terrain.tfms.operators.${id}.modulation.warp.z`,
        label: 'Modulation Warp Z',
        description:
          'Domain warp modulation bias applied along the Z axis prior to matrix routing.',
        type: numberType,
        min: domainWarpRange ? domainWarpRange.min : -128,
        max: domainWarpRange ? domainWarpRange.max : 128,
        step: warpStep,
        default: 0,
        path: Object.freeze([
          ...makeModulationPath('warp', 'z'),
          'value',
        ]),
      }),
    ].filter(Boolean)),
  })
}

const tfmsOperatorGroups = Object.freeze([
  createTfmsOperatorGroup({
    index: 0,
    id: 'primary-fbm',
    label: 'Primary FBM Carrier',
    description:
      'Macro-scale FBM carrier responsible for continent-sized plateaus and valleys.',
    defaults: {
      waveformId: 'primary-fbm',
      weight: 1,
      bias: 0,
      transfer: 'identity',
      amplitude: { multiplier: 1, min: 0, max: 256 },
      frequency: { multiplier: 1, min: 0.0001, max: 1 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: { weight: 0.18 },
    domainWarpRange: { value: 0, min: -128, max: 128 },
  }),
  createTfmsOperatorGroup({
    index: 1,
    id: 'ridge-noise',
    label: 'Ridge Noise Enhancer',
    description:
      'Ridged FBM emphasizing mountainous silhouettes and razor-sharp crests.',
    defaults: {
      waveformId: 'ridge-noise',
      weight: 0.75,
      bias: 0,
      transfer: 'abs',
      amplitude: { multiplier: 1, min: 0, max: 64 },
      frequency: { multiplier: 1, min: 0.0001, max: 1 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: null,
    domainWarpRange: { value: 0, min: -128, max: 128 },
  }),
  createTfmsOperatorGroup({
    index: 2,
    id: 'anisotropic-banding',
    label: 'Anisotropic Banding',
    description:
      'Directional banding introducing stratified layers and dunes to terrain surfaces.',
    defaults: {
      waveformId: 'anisotropic-banding',
      weight: 0.5,
      bias: 0,
      transfer: 'tanh',
      amplitude: { multiplier: 0.75, min: 0, max: 128 },
      frequency: { multiplier: 1.5, min: 0.0001, max: 2 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: null,
    domainWarpRange: { value: 0, min: -64, max: 64 },
    warpStep: 0.25,
  }),
  createTfmsOperatorGroup({
    index: 3,
    id: 'tectonic-worley',
    label: 'Tectonic Worley Cells',
    description:
      'Worley cells simulating tectonic plate interactions and fault lines.',
    defaults: {
      waveformId: 'tectonic-worley',
      weight: 0.35,
      bias: 0,
      transfer: 'smoothstep',
      amplitude: { multiplier: 0.45, min: 0, max: 128 },
      frequency: { multiplier: 0.45, min: 0.0001, max: 1 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: { weight: 0.4 },
    domainWarpRange: { value: 0, min: -128, max: 128 },
  }),
  createTfmsOperatorGroup({
    index: 4,
    id: 'domain-warp',
    label: 'Domain Warp Field',
    description:
      'Vector field that bends sample coordinates for downstream operators.',
    defaults: {
      waveformId: 'domain-warp',
      weight: 0,
      bias: 0,
      transfer: 'identity',
      amplitude: { multiplier: 0.32, min: 0, max: 256 },
      frequency: { multiplier: 0.65, min: 0.0001, max: 1 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: null,
    domainWarpRange: { value: 0, min: -128, max: 128 },
  }),
  createTfmsOperatorGroup({
    index: 5,
    id: 'diffusion-mask',
    label: 'Diffusion Mask',
    description:
      'Diffusion mask that softens peaks and blends neighbouring operator responses.',
    defaults: {
      waveformId: 'diffusion-mask',
      weight: 0.55,
      bias: 0,
      transfer: 'tanh',
      amplitude: { multiplier: 0.35, min: 0, max: 128 },
      frequency: { multiplier: 1.2, min: 0.0001, max: 2 },
      modulation: { amplitude: 0, frequency: 0 },
    },
    tectonic: null,
    domainWarpRange: { value: 0, min: -128, max: 128 },
  }),
])

const tfmsModulationMatrixGroup = Object.freeze({
  id: 'terrain.tfms.modulationMatrix',
  label: 'Modulation Matrix',
  description:
    'Fine-tune cross-operator frequency and amplitude modulation. Gains are applied before routing into each operator.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.diffusion-primary',
      label: 'Diffusion → Primary (Amplitude)',
      description:
        'How strongly the diffusion mask modulates the primary FBM amplitude.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.4,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        0,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.diffusion-ridge',
      label: 'Diffusion → Ridge (Amplitude)',
      description:
        'Modulation gain from the diffusion mask into the ridge operator amplitude.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.3,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        1,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.diffusion-banding',
      label: 'Diffusion → Banding (Amplitude)',
      description:
        'Modulation gain from the diffusion mask into the anisotropic banding amplitude.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.25,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        2,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.domain-primary-x',
      label: 'Domain Warp → Primary (X)',
      description:
        'Domain warp strength routed into the primary FBM X-axis domain.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.7,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        3,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.domain-primary-z',
      label: 'Domain Warp → Primary (Z)',
      description:
        'Domain warp strength routed into the primary FBM Z-axis domain.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.7,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        4,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.domain-ridge-x',
      label: 'Domain Warp → Ridge (X)',
      description:
        'Domain warp gain routed into the ridge operator X-axis domain.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.5,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        5,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.domain-ridge-z',
      label: 'Domain Warp → Ridge (Z)',
      description:
        'Domain warp gain routed into the ridge operator Z-axis domain.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.5,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        6,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.tectonic-ridge',
      label: 'Tectonic → Ridge (Amplitude)',
      description:
        'Raw tectonic Worley value routed into the ridge operator amplitude.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.35,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        7,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.tectonic-banding',
      label: 'Tectonic → Banding (Frequency)',
      description:
        'Frequency modulation routed from the tectonic Worley carrier into the banding operator.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.2,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        8,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.ridge-domain',
      label: 'Ridge → Domain Warp (Amplitude)',
      description:
        'How strongly ridge output amplifies the domain warp envelope.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.35,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        9,
        'gain',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.modulationMatrix.tectonic-diffusion',
      label: 'Tectonic → Diffusion (Amplitude)',
      description:
        'Raw tectonic Worley contribution routed into the diffusion mask amplitude.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0.45,
      path: Object.freeze([
        'terrain',
        'tfms',
        'modulationMatrix',
        10,
        'gain',
        'value',
      ]),
    }),
  ]),
})

const tfmsKameaGroup = Object.freeze({
  id: 'terrain.tfms.kamea',
  label: 'Kamea Temperament',
  description:
    'Planetary temperament settings projected into the TFMS modulation network.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'terrain.tfms.temperament',
      label: 'Planetary Temperament',
      description:
        'Selects which canonical Kamea matrix seeds the TFMS modulation network.',
      type: stringType,
      default: 'Saturn 3x3',
      path: Object.freeze(['terrain', 'tfms', 'temperament']),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.modulationStrength',
      label: 'FM Modulation Strength',
      description:
        'Scales the FM matrix derived from the selected temperament.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'modulationStrength',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.warpStrength',
      label: 'Warp Strength',
      description:
        'Scales the primary and 90° companion warp vectors injected before noise sampling.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.375,
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'warpStrength',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.phaseStrength',
      label: 'Phase Strength',
      description:
        'Scales temperament-driven phase offsets in radians.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.225,
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'phaseStrength',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.spectralProfile',
      label: 'Spectral Profile',
      description:
        'Chooses the FFT mask applied to the Kamea kernel (`low`, `band`, or `custom`).',
      type: stringType,
      default: 'band',
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'spectralProfile',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.spectralStrength',
      label: 'Spectral Strength',
      description:
        'Scales the FFT-derived filter contribution when shaping operator output.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'spectralStrength',
        'value',
      ]),
    }),
    Object.freeze({
      id: 'terrain.tfms.kamea.erosionPreset',
      label: 'Erosion Preset',
      description:
        'Selects conductance presets for anisotropic diffusion (`gentle`, `standard`, `aggressive`).',
      type: stringType,
      default: 'standard',
      path: Object.freeze([
        'terrain',
        'tfms',
        'kamea',
        'erosionPreset',
      ]),
    }),
  ]),
})

const terrainTfmsGlobalGroup = Object.freeze({
  id: 'terrain.tfms.global',
  label: 'TFMS Global Settings',
  description:
    'High-level TFMS controls that influence every operator before the modulation network evaluates waveforms.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'terrain.tfms.operatorCount',
      label: 'Active Operator Count',
      description:
        'Number of TFMS operators evaluated when generating terrain attenuation. Legacy presets use all six slots.',
      type: numberType,
      min: 1,
      max: 6,
      step: 1,
      default: 6,
      path: Object.freeze(['terrain', 'tfms', 'operatorCount']),
    }),
    Object.freeze({
      id: 'terrain.tfms.baseAttenuation',
      label: 'Base Attenuation',
      description:
        'Scales the combined TFMS envelope before it is added to the terrain base height.',
      type: numberType,
      min: 0,
      max: 2,
      step: 0.01,
      default: 0.82,
      path: Object.freeze(['terrain', 'tfms', 'baseAttenuation']),
    }),
    Object.freeze({
      id: 'terrain.tfms.clamp.min',
      label: 'Envelope Clamp Minimum',
      description:
        'Lower clamp applied to the final TFMS envelope before biome adjustments.',
      type: numberType,
      min: -128,
      max: 0,
      step: 0.5,
      default: -24,
      path: Object.freeze(['terrain', 'tfms', 'clamp', 'min']),
    }),
    Object.freeze({
      id: 'terrain.tfms.clamp.max',
      label: 'Envelope Clamp Maximum',
      description:
        'Upper clamp applied to the final TFMS envelope before biome adjustments.',
      type: numberType,
      min: 0,
      max: 128,
      step: 0.5,
      default: 24,
      path: Object.freeze(['terrain', 'tfms', 'clamp', 'max']),
    }),
    Object.freeze({
      id: 'terrain.tfms.biomeBlendStrength',
      label: 'Biome Blend Strength',
      description:
        'Controls how strongly biome height offsets influence the TFMS envelope when blending across biome boundaries.',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      path: Object.freeze(['terrain', 'tfms', 'biomeBlendStrength']),
    }),
  ]),
})

const terrainTfmsGroup = Object.freeze({
  id: 'terrain.tfms',
  label: 'Terrain FM Synthesis',
  description:
    'Configure the Terrain FM Synthesis (TFMS) operators that sculpt heightfields before biome blending. See docs/tfms-system.md for the annotated operator graph.',
  type: groupType,
  children: Object.freeze([
    terrainTfmsGlobalGroup,
    tfmsKameaGroup,
    ...tfmsOperatorGroups,
    tfmsModulationMatrixGroup,
  ]),
})

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

const environmentGroup = Object.freeze({
  id: 'environment',
  label: 'Environment',
  description:
    'Lighting and skybox configuration applied to the scene background.',
  type: groupType,
  children: Object.freeze([
    Object.freeze({
      id: 'environment.skyboxId',
      label: 'Skybox',
      description:
        'Select which bundled skybox or procedural backdrop surrounds the world.',
      type: enumType,
      default: 'skybox-1#invertY',
      options: environmentSkyboxOptions,
      path: Object.freeze(['environment', 'skyboxId']),
    }),
  ]),
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
      default: 10,
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
    Object.freeze({
      id: 'terrain.shoreSlopeBias',
      label: 'Shore Slope Bias',
      description:
        'Adjusts how aggressively shoreline columns ease into ocean water levels. Positive values create wider beaches while negative values preserve steeper cliffs.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0,
      path: Object.freeze(['terrain', 'shoreSlopeBias']),
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
  default: 10,
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
      default: 0.012,
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
    Object.freeze({
      id: 'biomes.uniformity',
      label: 'Uniformity',
      description:
        'Blend factor between climate-driven selection (0) and a uniform distribution across all registered biomes (1).',
      type: numberType,
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      path: Object.freeze(['biomes', 'uniformity']),
    }),
    Object.freeze({
      id: 'biomes.weightExponent',
      label: 'Weight Exponent',
      description:
        'Exponent applied to biome climate weights before distance comparison. Lower values soften the influence of per-biome weights.',
      type: numberType,
      min: 0,
      max: 4,
      step: 0.01,
      default: 1,
      path: Object.freeze(['biomes', 'weightExponent']),
    }),
    Object.freeze({
      id: 'biomes.oceanProvinceScale',
      label: 'Ocean Province Scale',
      description:
        'Base frequency for the ocean province mask that biases shoreline placement. Lower values create broader oceans with fewer land interruptions.',
      type: numberType,
      min: 0.0001,
      max: 0.02,
      step: 0.0001,
      default: 0.0035,
      path: Object.freeze(['biomes', 'oceanProvinceScale']),
    }),
    Object.freeze({
      id: 'biomes.oceanWeightBias',
      label: 'Ocean Weight Bias',
      description:
        'Bias applied when selecting biomes tagged as ocean or shore. Positive values expand ocean coverage while negative values pull the climate map toward continents.',
      type: numberType,
      min: -4,
      max: 4,
      step: 0.01,
      default: 0,
      path: Object.freeze(['biomes', 'oceanWeightBias']),
    }),
  ]),
})

export const worldOptionDescriptors = Object.freeze([
  seedDescriptor,
  chunkGroup,
  environmentGroup,
  legacyChunkSizeDescriptor,
  waterGroup,
  legacyWaterLevelDescriptor,
  terrainGroup,
  terrainTfmsGroup,
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
