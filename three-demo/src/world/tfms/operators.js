import { ValueNoise2D } from '../noise.js';

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

function pseudoRandom(seed, x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 0.1337) * 43758.5453;
  return n - Math.floor(n);
}

function createFbmOperator({
  seed,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
  ridge = false,
}) {
  const baseNoise = new ValueNoise2D(seed);

  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      let total = 0;
      let amplitudeAccumulator = 0;
      let currentAmplitude = 1;
      let currentFrequency = 1;

      const nx = (x + domainWarp.x) * frequency + phase.x;
      const nz = (z + domainWarp.z) * frequency + phase.z;

      for (let octave = 0; octave < octaves; octave += 1) {
        const sample = baseNoise.noise(nx * currentFrequency, nz * currentFrequency);
        const centered = (sample - 0.5) * 2;
        const adjusted = ridge ? 1 - Math.abs(centered) : centered;
        total += adjusted * currentAmplitude;
        amplitudeAccumulator += currentAmplitude;
        currentAmplitude *= gain;
        currentFrequency *= lacunarity;
      }

      const normalized = amplitudeAccumulator > 0 ? total / amplitudeAccumulator : 0;
      const value = normalized * amplitude;
      return {
        value,
        raw: normalized,
        domain: { x: normalized, z: normalized },
      };
    },
  };
}

function createRidgedOperator(config) {
  return createFbmOperator({ ...config, ridge: true });
}

function createAnisotropicSineOperator({
  orientation = Math.PI / 4,
  harmonics = 2,
  phaseOffset = 0,
  bias = 0,
}) {
  const cosAngle = Math.cos(orientation);
  const sinAngle = Math.sin(orientation);

  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      const dx = (x + domainWarp.x) * frequency;
      const dz = (z + domainWarp.z) * frequency;
      const u = dx * cosAngle + dz * sinAngle + phase.x + phaseOffset;
      const v = -dx * sinAngle + dz * cosAngle + phase.z + phaseOffset;
      let value = 0;
      let weight = 0;
      for (let i = 1; i <= harmonics; i += 1) {
        const harmonicWeight = 1 / i;
        value += Math.sin(u * i) * Math.cos(v * i) * harmonicWeight;
        weight += harmonicWeight;
      }
      const normalized = weight > 0 ? value / weight : 0;
      const finalValue = (normalized + bias) * amplitude;
      return {
        value: finalValue,
        raw: normalized,
        domain: { x: normalized, z: normalized },
      };
    },
  };
}

function createWorleyOperator({
  seed,
  jitter = 0.75,
  falloff = 1,
  distanceMetric = 'euclidean',
}) {
  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      const nx = (x + domainWarp.x) * frequency + phase.x;
      const nz = (z + domainWarp.z) * frequency + phase.z;
      const cellX = Math.floor(nx);
      const cellZ = Math.floor(nz);
      let minDistance = Infinity;

      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = cellX + dx;
          const cz = cellZ + dz;
          const rx = pseudoRandom(seed, cx, cz) * jitter;
          const rz = pseudoRandom(seed * 1.97, cx, cz) * jitter;
          const pointX = cx + rx;
          const pointZ = cz + rz;
          const distance =
            distanceMetric === 'manhattan'
              ? Math.abs(nx - pointX) + Math.abs(nz - pointZ)
              : Math.hypot(nx - pointX, nz - pointZ);
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
      }

      const normalized = Math.exp(-minDistance * falloff);
      const value = normalized * amplitude;
      return {
        value,
        raw: normalized,
        domain: { x: normalized, z: normalized },
      };
    },
  };
}

function createDomainWarpOperator({ seed, power = 1, gain = 0.75 }) {
  const noiseX = new ValueNoise2D(seed * 1.11 + 17);
  const noiseZ = new ValueNoise2D(seed * 1.37 + 43);

  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      const nx = (x + domainWarp.x) * frequency + phase.x;
      const nz = (z + domainWarp.z) * frequency + phase.z;
      const sx = (noiseX.noise(nx, nz) - 0.5) * 2;
      const sz = (noiseZ.noise(nx, nz) - 0.5) * 2;
      const magnitude = Math.pow(Math.abs(sx) + Math.abs(sz), power) * amplitude;
      const warped = {
        x: sx * gain * amplitude,
        z: sz * gain * amplitude,
      };
      const normalized = magnitude;
      return {
        value: magnitude,
        raw: normalized,
        domain: warped,
      };
    },
  };
}

function createDiffusionOperator({ seed, smoothing = 0.5 }) {
  const baseNoise = new ValueNoise2D(seed * 1.61 + 97);

  return {
    evaluate({ x, z, amplitude, frequency, phase, domainWarp }) {
      const nx = (x + domainWarp.x) * frequency + phase.x;
      const nz = (z + domainWarp.z) * frequency + phase.z;

      const center = baseNoise.noise(nx, nz);
      const offsets = [
        baseNoise.noise(nx + 1, nz),
        baseNoise.noise(nx - 1, nz),
        baseNoise.noise(nx, nz + 1),
        baseNoise.noise(nx, nz - 1),
      ];

      const averageOffsets =
        offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
      const diffused = lerp(center, averageOffsets, clamp(smoothing, 0, 1));
      const normalized = (diffused - 0.5) * 2;
      const value = normalized * amplitude;

      return {
        value,
        raw: normalized,
        domain: { x: normalized, z: normalized },
      };
    },
  };
}

const OPERATOR_FACTORIES = Object.freeze({
  fbm: createFbmOperator,
  ridged: createRidgedOperator,
  anisotropicSine: createAnisotropicSineOperator,
  worley: createWorleyOperator,
  domainWarp: createDomainWarpOperator,
  diffusion: createDiffusionOperator,
});

function resolveTransfer(transfer, overrides) {
  if (typeof transfer === 'function') {
    return transfer;
  }
  if (transfer && overrides[transfer]) {
    return overrides[transfer];
  }
  if (transfer && DEFAULT_TRANSFER_FUNCTIONS[transfer]) {
    return DEFAULT_TRANSFER_FUNCTIONS[transfer];
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
} = {}) {
  const operatorInstances = operators.map((operatorConfig, index) => {
    const factory = OPERATOR_FACTORIES[operatorConfig.type];
    if (!factory) {
      throw new Error(`Unknown TFMS operator type: ${operatorConfig.type}`);
    }

    const instance = factory({
      ...operatorConfig,
      seed: operatorConfig.seed ?? seed * 1.17 + index * 137.53,
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
        ...operatorConfig,
        phase: {
          x: operatorConfig?.phase?.x ?? 0,
          z: operatorConfig?.phase?.z ?? 0,
        },
        domainWarp: {
          x: operatorConfig?.domainWarp?.x ?? 0,
          z: operatorConfig?.domainWarp?.z ?? 0,
        },
        tectonic: {
          weight: operatorConfig?.tectonic?.weight ?? 0,
          ...operatorConfig?.tectonic,
        },
      },
      transfer: resolveTransfer(
        operatorConfig.transfer,
        transferFunctions,
      ),
    };
  });

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
    const amplitude = (baseConfig.amplitude ?? 1) * (1 + modulation.amplitude);
    const frequency = Math.max(
      1e-6,
      (baseConfig.frequency ?? 1) * (1 + modulation.frequency),
    );
    const phase = {
      x: (baseConfig.phase?.x ?? 0) + modulation.phase.x,
      z: (baseConfig.phase?.z ?? 0) + modulation.phase.z,
    };
    const domainWarp = {
      x: (baseConfig.domainWarp?.x ?? 0) + modulation.domainWarp.x,
      z: (baseConfig.domainWarp?.z ?? 0) + modulation.domainWarp.z,
    };

    const evaluation = operator.evaluate({
      x,
      z,
      amplitude,
      frequency,
      phase,
      domainWarp,
      time,
      context,
    });

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
  };
}

export const TFMS_TRANSFER_FUNCTIONS = DEFAULT_TRANSFER_FUNCTIONS;
export const TFMS_TECTONIC_BLENDERS = DEFAULT_TECTONIC_BLENDERS;

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
