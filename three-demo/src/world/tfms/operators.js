import {
  combineDomainWarp,
  createNoiseSampler,
  projectSampleCoordinates,
} from '../noise.js';
import { make_kamea_patch } from '../kamea-patch.js';

const DEFAULT_TRANSFER_FUNCTIONS = Object.freeze({
  identity: (value) => value,
  abs: (value) => Math.abs(value),
  square: (value) => value * value,
  cube: (value) => value * value * value,
  tanh: (value) => Math.tanh(value),
  smoothstep: (value, sample) =>
    smoothStep(value, sample?.transfer?.smoothness ?? 0.5),
  sigmoid: (value) => 1 / (1 + Math.exp(-value)) * 2 - 1,
  clamp01: (value) => clamp(value, 0, 1),
  clamp11: (value) => clamp(value, -1, 1),
});

const DEFAULT_TECTONIC_BLENDERS = Object.freeze({
  identity: (height, tectonic) => height + tectonic,
  additive: (height, tectonic, { config } = {}) =>
    height + tectonic * (config?.strength ?? 1) + (config?.bias ?? 0),
  mix: (height, tectonic, { config } = {}) => {
    const strength = clamp(config?.strength ?? 0.5, 0, 1);
    return height * (1 - strength) + tectonic * strength + (config?.bias ?? 0);
  },
  max: (height, tectonic, { config } = {}) =>
    Math.max(height, tectonic * (config?.strength ?? 1) + (config?.bias ?? 0)),
  min: (height, tectonic, { config } = {}) =>
    Math.min(height, tectonic * (config?.strength ?? 1) + (config?.bias ?? 0)),
});

function smoothStep(value, edge = 0.5) {
  const t = clamp(0.5 + value * edge, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createScalarWaveformOperator(type) {
  return ({ seed, ...config }) => {
    const sampler = createNoiseSampler(type, { seed, ...config });
    return {
      evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
        const coords = projectSampleCoordinates(x, z, {
          frequency,
          phase,
          domainWarp,
        });
        const sample = sampler(coords.x, coords.z);
        const normalized = clamp(sample, -1, 1);
        const value = normalized * amplitude;
        return {
          value,
          raw: normalized,
          domain: { x: normalized, z: normalized },
        };
      },
    };
  };
}

function createDomainWarpOperator(typeOrConfig, maybeConfig) {
  const type = typeof typeOrConfig === 'string' ? typeOrConfig : 'warp';
  const config =
    typeof typeOrConfig === 'string' ? { ...maybeConfig } : { ...typeOrConfig };
  const samplerFactory = createNoiseSampler(type, config);
  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      const coords = projectSampleCoordinates(x, z, {
        frequency,
        phase,
        domainWarp,
      });
      const warpSample = samplerFactory(coords.x, coords.z);
      const warpedDomain = {
        x: warpSample.x * amplitude,
        z: warpSample.z * amplitude,
      };
      const magnitude = Math.min(1, Math.hypot(warpSample.x, warpSample.z));
      return {
        value: Math.hypot(warpedDomain.x, warpedDomain.z),
        raw: magnitude,
        domain: combineDomainWarp({ x: 0, z: 0 }, warpedDomain),
      };
    },
  };
}

const OPERATOR_FACTORIES = Object.freeze({
  fbm: createScalarWaveformOperator('fbm'),
  FBM: createScalarWaveformOperator('fbm'),
  turbulence: createScalarWaveformOperator('turbulence'),
  Turbulence: createScalarWaveformOperator('turbulence'),
  ridge: createScalarWaveformOperator('ridge'),
  ridged: createScalarWaveformOperator('ridge'),
  RidgedFBM: createScalarWaveformOperator('ridge'),
  billow: createScalarWaveformOperator('billow'),
  Billow: createScalarWaveformOperator('billow'),
  bandsFbm: createScalarWaveformOperator('bandsFbm'),
  BandsFBM: createScalarWaveformOperator('bandsFbm'),
  pinkNoise: createScalarWaveformOperator('pinkNoise'),
  PinkNoise: createScalarWaveformOperator('pinkNoise'),
  FractalPinkNoise: createScalarWaveformOperator('pinkNoise'),
  brownNoise: createScalarWaveformOperator('brownNoise'),
  BrownNoise: createScalarWaveformOperator('brownNoise'),
  FractalBrownNoise: createScalarWaveformOperator('brownNoise'),
  redNoise: createScalarWaveformOperator('redNoise'),
  RedNoise: createScalarWaveformOperator('redNoise'),
  greenNoise: createScalarWaveformOperator('greenNoise'),
  GreenNoise: createScalarWaveformOperator('greenNoise'),
  blackNoise: createScalarWaveformOperator('blackNoise'),
  BlackNoise: createScalarWaveformOperator('blackNoise'),
  greyNoise: createScalarWaveformOperator('greyNoise'),
  GreyNoise: createScalarWaveformOperator('greyNoise'),
  violetNoise: createScalarWaveformOperator('violetNoise'),
  VioletNoise: createScalarWaveformOperator('violetNoise'),
  velvetNoise: createScalarWaveformOperator('velvetNoise'),
  VelvetNoise: createScalarWaveformOperator('velvetNoise'),
  blueNoise: createScalarWaveformOperator('blueNoise'),
  BlueNoise: createScalarWaveformOperator('blueNoise'),
  FractalBlueNoise: createScalarWaveformOperator('blueNoise'),
  whiteNoise: createScalarWaveformOperator('whiteNoise'),
  WhiteNoise: createScalarWaveformOperator('whiteNoise'),
  gaborNoise: createScalarWaveformOperator('gaborNoise'),
  GaborNoise: createScalarWaveformOperator('gaborNoise'),
  waveletNoise: createScalarWaveformOperator('waveletNoise'),
  WaveletNoise: createScalarWaveformOperator('waveletNoise'),
  spectralNoise: createScalarWaveformOperator('spectralNoise'),
  SpectralNoise: createScalarWaveformOperator('spectralNoise'),
  poissonBlueMask: createScalarWaveformOperator('poissonBlueMask'),
  PoissonBlueMask: createScalarWaveformOperator('poissonBlueMask'),
  worley: createScalarWaveformOperator('worley'),
  Worley: createScalarWaveformOperator('worley'),
  valueNoise: createScalarWaveformOperator('valueNoise'),
  ValueNoise: createScalarWaveformOperator('valueNoise'),
  gradientNoise: createScalarWaveformOperator('gradientNoise'),
  GradientNoise: createScalarWaveformOperator('gradientNoise'),
  simplexNoise: createScalarWaveformOperator('simplexNoise'),
  SimplexNoise: createScalarWaveformOperator('simplexNoise'),
  sine: createScalarWaveformOperator('sine'),
  anisotropicSine: createScalarWaveformOperator('sine'),
  AnisotropicSine: createScalarWaveformOperator('sine'),
  cosine: createScalarWaveformOperator('cosine'),
  anisotropicCosine: createScalarWaveformOperator('cosine'),
  AnisotropicCosine: createScalarWaveformOperator('cosine'),
  square: createScalarWaveformOperator('square'),
  anisotropicSquare: createScalarWaveformOperator('square'),
  AnisotropicSquare: createScalarWaveformOperator('square'),
  sawtooth: createScalarWaveformOperator('sawtooth'),
  anisotropicSawtooth: createScalarWaveformOperator('sawtooth'),
  AnisotropicSawtooth: createScalarWaveformOperator('sawtooth'),
  triangle: createScalarWaveformOperator('triangle'),
  anisotropicTriangle: createScalarWaveformOperator('triangle'),
  AnisotropicTriangle: createScalarWaveformOperator('triangle'),
  pulse: createScalarWaveformOperator('pulse'),
  anisotropicPulse: createScalarWaveformOperator('pulse'),
  AnisotropicPulse: createScalarWaveformOperator('pulse'),
  wavetable: createScalarWaveformOperator('wavetable'),
  Wavetable: createScalarWaveformOperator('wavetable'),
  fmComposite: createScalarWaveformOperator('fmComposite'),
  FMComposite: createScalarWaveformOperator('fmComposite'),
  amComposite: createScalarWaveformOperator('amComposite'),
  AMComposite: createScalarWaveformOperator('amComposite'),
  ringMod: createScalarWaveformOperator('ringMod'),
  RingMod: createScalarWaveformOperator('ringMod'),
  phaseDistortedSine: createScalarWaveformOperator('phaseDistortedSine'),
  PhaseDistortedSine: createScalarWaveformOperator('phaseDistortedSine'),
  pulseWidthModulation: createScalarWaveformOperator('pulseWidthModulation'),
  PulseWidthModulation: createScalarWaveformOperator('pulseWidthModulation'),
  additiveHarmonicStack: createScalarWaveformOperator('additiveHarmonicStack'),
  AdditiveHarmonicStack: createScalarWaveformOperator('additiveHarmonicStack'),
  subtractiveFilterBank: createScalarWaveformOperator('subtractiveFilterBank'),
  SubtractiveFilterBank: createScalarWaveformOperator('subtractiveFilterBank'),
  granularNoise: createScalarWaveformOperator('granularNoise'),
  GranularNoise: createScalarWaveformOperator('granularNoise'),
  sampleAndHold: createScalarWaveformOperator('sampleAndHold'),
  SampleAndHold: createScalarWaveformOperator('sampleAndHold'),
  noiseChorus: createScalarWaveformOperator('noiseChorus'),
  NoiseChorus: createScalarWaveformOperator('noiseChorus'),
  resonantFilterField: createScalarWaveformOperator('resonantFilterField'),
  ResonantFilterField: createScalarWaveformOperator('resonantFilterField'),
  reverberantDecayField: createScalarWaveformOperator('reverberantDecayField'),
  ReverberantDecayField: createScalarWaveformOperator('reverberantDecayField'),
  hyperbolicTangentField: createScalarWaveformOperator('hyperbolicTangentField'),
  HyperbolicTangentField: createScalarWaveformOperator('hyperbolicTangentField'),
  sigmoidStepField: createScalarWaveformOperator('sigmoidStepField'),
  SigmoidStepField: createScalarWaveformOperator('sigmoidStepField'),
  exponentialField: createScalarWaveformOperator('exponentialField'),
  ExponentialField: createScalarWaveformOperator('exponentialField'),
  sdfPrimitives: createScalarWaveformOperator('sdfPrimitives'),
  SDFPrimitives: createScalarWaveformOperator('sdfPrimitives'),
  multifractalBlend: createScalarWaveformOperator('multifractalBlend'),
  MultifractalBlend: createScalarWaveformOperator('multifractalBlend'),
  warpedFbm: createScalarWaveformOperator('warpedFbm'),
  WarpedFBM: createScalarWaveformOperator('warpedFbm'),
  diffusion: createScalarWaveformOperator('diffusion'),
  isotropicDiffusion: createScalarWaveformOperator('diffusion'),
  Diffusion: createScalarWaveformOperator('diffusion'),
  IsotropicDiffusion: createScalarWaveformOperator('diffusion'),
  anisotropicDiffusion: createScalarWaveformOperator('anisotropicDiffusion'),
  AnisotropicDiffusion: createScalarWaveformOperator('anisotropicDiffusion'),
  hydraulicErosion: createScalarWaveformOperator('hydraulicErosion'),
  HydraulicErosion: createScalarWaveformOperator('hydraulicErosion'),
  warp: (config) => createDomainWarpOperator(config),
  domainWarp: (config) => createDomainWarpOperator(config),
  DomainWarp: (config) => createDomainWarpOperator(config),
  curlNoise: (config) => createDomainWarpOperator('curlNoise', config),
  CurlNoise: (config) => createDomainWarpOperator('curlNoise', config),
  cellEdgeDistance: createScalarWaveformOperator('cellEdgeDistance'),
  CellEdgeDistance: createScalarWaveformOperator('cellEdgeDistance'),
  terraceQuantized: createScalarWaveformOperator('terraceQuantized'),
  TerraceQuantized: createScalarWaveformOperator('terraceQuantized'),
  voronoiBlend: createScalarWaveformOperator('voronoiBlend'),
  VoronoiBlend: createScalarWaveformOperator('voronoiBlend'),
  noiseMixWaveset: createScalarWaveformOperator('noiseMixWaveset'),
  NoiseMixWaveset: createScalarWaveformOperator('noiseMixWaveset'),
});

function resolveTransfer(transfer, overrides) {
  if (typeof transfer === 'function') {
    return transfer;
  }

  const visited = new Set();
  let current = transfer;

  while (current != null) {
    if (typeof current === 'function') {
      return current;
    }

    if (typeof current === 'object') {
      const identifier =
        (typeof current.id === 'string' && current.id) ||
        (typeof current.type === 'string' && current.type);
      if (identifier) {
        if (visited.has(identifier)) {
          return DEFAULT_TRANSFER_FUNCTIONS.identity;
        }
        current = identifier;
        continue;
      }
      break;
    }

    if (typeof current !== 'string') {
      break;
    }

    if (visited.has(current)) {
      return DEFAULT_TRANSFER_FUNCTIONS.identity;
    }
    visited.add(current);

    const overrideValue =
      overrides && Object.prototype.hasOwnProperty.call(overrides, current)
        ? overrides[current]
        : undefined;

    if (typeof overrideValue === 'function') {
      return overrideValue;
    }

    if (
      overrideValue &&
      typeof overrideValue === 'object' &&
      ((typeof overrideValue.id === 'string' && overrideValue.id) ||
        (typeof overrideValue.type === 'string' && overrideValue.type))
    ) {
      const identifier = overrideValue.id ?? overrideValue.type;
      if (visited.has(identifier)) {
        return DEFAULT_TRANSFER_FUNCTIONS.identity;
      }
      current = identifier;
      continue;
    }

    if (typeof overrideValue === 'string') {
      current = overrideValue;
      continue;
    }

    if (DEFAULT_TRANSFER_FUNCTIONS[current]) {
      return DEFAULT_TRANSFER_FUNCTIONS[current];
    }

    break;
  }

  return DEFAULT_TRANSFER_FUNCTIONS.identity;
}

function resolveTectonicBlend(blend, overrides) {
  if (typeof blend === 'function') {
    return blend;
  }
  if (blend && overrides[blend]) {
    return overrides[blend];
  }
  if (blend && DEFAULT_TECTONIC_BLENDERS[blend]) {
    return DEFAULT_TECTONIC_BLENDERS[blend];
  }
  return DEFAULT_TECTONIC_BLENDERS.identity;
}

function applyAxis(target, axis, value) {
  switch (axis) {
    case 'x':
      target.x += value;
      break;
    case 'z':
      target.z += value;
      break;
    default:
      target.x += value;
      target.z += value;
      break;
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function createTfmsNetwork({
  seed = 0,
  operators = [],
  modulationMatrix = [],
  transferFunctions = {},
  tectonic = {},
  temperament = null,
  kameaPatch = null,
  kameaOptions = {},
} = {}) {
  const operatorCount = operators.length;
  const normalizedKameaOptions =
    kameaOptions && typeof kameaOptions === 'object' ? { ...kameaOptions } : {};
  const resolvedKameaPatch =
    operatorCount > 0
      ? kameaPatch ??
        (temperament
          ? make_kamea_patch(temperament, {
              ...normalizedKameaOptions,
              operatorCount,
              seed: normalizedKameaOptions.seed ?? seed,
            })
          : null)
      : null;
  const gating = resolvedKameaPatch?.gating ?? null;
  const gatingWeights = gating?.weights ?? {};
  const gatingBiases = gating?.biases ?? {};

  const operatorInstances = operators.map((operatorConfig, index) => {
    const factory = OPERATOR_FACTORIES[operatorConfig.type];
    if (!factory) {
      throw new Error(`Unknown TFMS operator type: ${operatorConfig.type}`);
    }

    const waveformGroup = resolveWaveformBankType(operatorConfig.type);
    const gatingWeight =
      waveformGroup && gatingWeights[waveformGroup] != null
        ? gatingWeights[waveformGroup]
        : 1;
    const gatingBias =
      waveformGroup && gatingBiases[waveformGroup] != null
        ? gatingBiases[waveformGroup]
        : 0;
    const config = {
      ...operatorConfig,
      weight: (operatorConfig.weight ?? 1) * gatingWeight,
      bias: (operatorConfig.bias ?? 0) + gatingBias,
    };

    const instance = factory({
      ...config,
      seed: config.seed ?? seed * 1.17 + index * 137.53,
    });

    return {
      evaluate: instance.evaluate,
      config: {
        amplitude: 1,
        frequency: 1,
        phase: { x: 0, z: 0 },
        domainWarp: { x: 0, z: 0 },
        weight: 1,
        bias: 0,
        transfer: 'identity',
        tectonic: { weight: 0 },
        ...config,
        phase: {
          x: config?.phase?.x ?? 0,
          z: config?.phase?.z ?? 0,
        },
        domainWarp: {
          x: config?.domainWarp?.x ?? 0,
          z: config?.domainWarp?.z ?? 0,
        },
        tectonic: {
          weight: config?.tectonic?.weight ?? 0,
          ...config?.tectonic,
        },
      },
      transfer: resolveTransfer(config.transfer, transferFunctions),
    };
  });

  const kameaPatchRef = resolvedKameaPatch;
  const fmMatrix = kameaPatchRef?.fmMatrix ?? null;
  const fmStrength = kameaPatchRef?.fmStrength ?? 1;
  const warpPatch = kameaPatchRef?.warp ?? null;
  const phasePatch = kameaPatchRef?.phase ?? null;
  const spectralFilters = Array.isArray(kameaPatchRef?.spectral?.filters)
    ? kameaPatchRef.spectral.filters
    : [];
  const spectralConductance = Array.isArray(
    kameaPatchRef?.spectral?.conductance,
  )
    ? kameaPatchRef.spectral.conductance
    : [];
  const baseCarrierVector = operatorInstances.map(
    (operator) => operator.config.amplitude ?? 1,
  );

  const modulationByTarget = operatorInstances.map(() => []);
  modulationMatrix.forEach((entry, entryIndex) => {
    if (
      !entry ||
      typeof entry.source !== 'number' ||
      typeof entry.target !== 'number'
    ) {
      return;
    }
    if (
      entry.target < 0 ||
      entry.target >= operatorInstances.length ||
      entry.source < 0 ||
      entry.source >= operatorInstances.length
    ) {
      return;
    }
    modulationByTarget[entry.target].push({ ...entry, entryIndex });
  });

  modulationByTarget.forEach((list) =>
    list.sort((a, b) => a.entryIndex - b.entryIndex),
  );

  const tectonicBlendConfig = {
    blend: tectonic.blend ?? 'identity',
    strength: tectonic.strength ?? 1,
    bias: tectonic.bias ?? 0,
  };
  const tectonicBlend = resolveTectonicBlend(
    tectonicBlendConfig.blend,
    tectonic?.blenders ?? {},
  );

  const lastState = operatorInstances.map(() => ({
    value: 0,
    transferred: 0,
    raw: 0,
    domain: { x: 0, z: 0 },
    amplitude: 1,
    frequency: 1,
  }));

  function computeFmContribution(index, currentState) {
    if (!fmMatrix || !fmMatrix[index]) {
      return 0;
    }
    const row = fmMatrix[index];
    if (!row.length) {
      return 0;
    }
    let dot = 0;
    for (let sourceIndex = 0; sourceIndex < row.length; sourceIndex += 1) {
      const coefficient = row[sourceIndex];
      if (!coefficient) {
        continue;
      }
      let carrierValue = 0;
      if (sourceIndex < baseCarrierVector.length) {
        const state =
          sourceIndex < index
            ? currentState[sourceIndex] ?? lastState[sourceIndex]
            : lastState[sourceIndex];
        if (state && typeof state.raw === 'number') {
          carrierValue = state.raw;
        } else {
          carrierValue = baseCarrierVector[sourceIndex];
        }
      }
      dot += coefficient * Math.tanh(carrierValue);
    }
    return dot * fmStrength;
  }

  function evaluateOperator(index, x, z, time, context, currentState) {
    const operator = operatorInstances[index];
    const modulationEntries = modulationByTarget[index];
    const modulation = {
      amplitude: 0,
      frequency: 0,
      phase: { x: 0, z: 0 },
      domainWarp: { x: 0, z: 0 },
    };

    for (const entry of modulationEntries) {
      const sourceState =
        entry.source < index
          ? currentState[entry.source] ?? lastState[entry.source]
          : lastState[entry.source];
      const channel = entry.channel ?? 'value';
      const sourceValue = resolveSourceValue(sourceState, channel);
      const gain = entry.gain ?? 1;
      const bias = entry.bias ?? 0;
      const axis = entry.axis ?? 'both';
      const modValue = sourceValue * gain + bias;

      switch (entry.routing) {
        case 'amplitude':
          modulation.amplitude += modValue;
          break;
        case 'frequency':
          modulation.frequency += modValue;
          break;
        case 'phase':
          applyAxis(modulation.phase, axis, modValue);
          break;
        case 'domain-warp':
        case 'domainWarp':
          applyAxis(modulation.domainWarp, axis, modValue);
          break;
        default:
          break;
      }
    }

    const baseConfig = operator.config;
    const fmContribution = computeFmContribution(index, currentState);
    let amplitude =
      (baseConfig.amplitude ?? 1) * (1 + modulation.amplitude) + fmContribution;
    let frequency =
      (baseConfig.frequency ?? 1) * (1 + modulation.frequency) +
      fmContribution * 0.05;
    if (!Number.isFinite(frequency)) {
      frequency = 0;
    }
    frequency = Math.max(1e-6, frequency);
    const phase = {
      x: (baseConfig.phase?.x ?? 0) + modulation.phase.x,
      z: (baseConfig.phase?.z ?? 0) + modulation.phase.z,
    };
    const domainWarp = {
      x: (baseConfig.domainWarp?.x ?? 0) + modulation.domainWarp.x,
      z: (baseConfig.domainWarp?.z ?? 0) + modulation.domainWarp.z,
    };

    if (warpPatch) {
      const primary = warpPatch.primary?.[index];
      if (primary) {
        domainWarp.x += primary.x;
        domainWarp.z += primary.z;
      }
      const companion = warpPatch.companion?.[index];
      if (companion) {
        domainWarp.x += companion.x;
        domainWarp.z += companion.z;
      }
    }

    if (phasePatch) {
      const px = phasePatch.x?.[index];
      const pz = phasePatch.z?.[index];
      if (Number.isFinite(px)) {
        phase.x += px;
      }
      if (Number.isFinite(pz)) {
        phase.z += pz;
      }
    }

    const conductanceValue = spectralConductance[index];
    if (
      Number.isFinite(conductanceValue) &&
      isDiffusionOperatorType(baseConfig.type)
    ) {
      amplitude *= 1 + conductanceValue;
    }

    let evaluation = operator.evaluate({
      x,
      z,
      amplitude,
      frequency,
      phase,
      domainWarp,
      time,
      context,
    });

    if (spectralFilters[index]) {
      const filter = spectralFilters[index];
      const filteredValue = filter(evaluation.value, {
        operatorIndex: index,
        sample: evaluation,
        patch: kameaPatchRef,
        stage: 'value',
      });
      const filteredRaw =
        typeof evaluation.raw === 'number'
          ? filter(evaluation.raw, {
              operatorIndex: index,
              sample: evaluation,
              patch: kameaPatchRef,
              stage: 'raw',
            })
          : filteredValue;
      evaluation = {
        ...evaluation,
        value: filteredValue,
        raw: filteredRaw,
      };
    }

    const sample = {
      ...evaluation,
      amplitude,
      frequency,
      phase,
      domainWarp,
      modulation,
      transfer: baseConfig.transferSettings ?? {},
      index,
      config: baseConfig,
    };

    const transferred = operator.transfer(sample.value, sample, context);
    const weightedValue =
      transferred * (baseConfig.weight ?? 1) + (baseConfig.bias ?? 0);

    const state = {
      value: weightedValue,
      transferred,
      raw: sample.raw ?? sample.value,
      domain: sample.domain ?? { x: 0, z: 0 },
      amplitude: sample.amplitude,
      frequency: sample.frequency,
    };
    currentState[index] = state;

    return {
      sample,
      transferred,
      weightedValue,
    };
  }

  return {
    evaluate({ x, z, time = 0, context } = {}) {
      let envelope = 0;
      let tectonicAccumulator = 0;
      const operatorOutputs = [];

      const currentState = [];

      for (let index = 0; index < operatorInstances.length; index += 1) {
        const { sample, transferred, weightedValue } = evaluateOperator(
          index,
          x,
          z,
          time,
          context,
          currentState,
        );
        envelope += weightedValue;
        tectonicAccumulator +=
          (sample.config.tectonic?.weight ?? 0) * (sample.raw ?? sample.value);
        operatorOutputs.push({
          index,
          value: weightedValue,
          transferred,
          raw: sample.raw,
          amplitude: sample.amplitude,
          frequency: sample.frequency,
          phase: sample.phase,
          domainWarp: sample.domainWarp,
          modulation: sample.modulation,
          config: sample.config,
        });
      }

      for (let index = 0; index < operatorInstances.length; index += 1) {
        if (currentState[index]) {
          lastState[index] = currentState[index];
        }
      }

      const blendedEnvelope = tectonicBlend(envelope, tectonicAccumulator, {
        context,
        config: tectonicBlendConfig,
      });

      return {
        envelope: blendedEnvelope,
        rawEnvelope: envelope,
        tectonic: tectonicAccumulator,
        operators: operatorOutputs,
      };
    },
    getOperators() {
      return operatorInstances.map((operator) => operator.config);
    },
    getKameaPatch() {
      return kameaPatchRef;
    },
  };
}

export const TFMS_TRANSFER_FUNCTIONS = DEFAULT_TRANSFER_FUNCTIONS;
export const TFMS_TECTONIC_BLENDERS = DEFAULT_TECTONIC_BLENDERS;

function resolveWaveformBankType(type) {
  if (!type) {
    return null;
  }
  const normalized = String(type).toLowerCase();
  if (normalized.includes('diffusion') || normalized.includes('erosion')) {
    return 'diffusion';
  }
  if (normalized.includes('worley')) {
    return 'worley';
  }
  if (normalized.includes('ridge')) {
    return 'ridged';
  }
  if (normalized.includes('warp') || normalized.includes('curl')) {
    return 'warp';
  }
  return 'fbm';
}

function isDiffusionOperatorType(type) {
  return resolveWaveformBankType(type) === 'diffusion';
}

function resolveSourceValue(state, channel) {
  if (!state) {
    return 0;
  }

  switch (channel) {
    case 'raw':
      return state.raw ?? 0;
    case 'transferred':
      return state.transferred ?? state.value ?? 0;
    case 'domainX':
      return state.domain?.x ?? 0;
    case 'domainZ':
      return state.domain?.z ?? 0;
    case 'amplitude':
      return state.amplitude ?? 0;
    case 'frequency':
      return state.frequency ?? 0;
    case 'value':
    default:
      return state.value ?? 0;
  }
}
