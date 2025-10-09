import { createBiomeEngine } from './biome-engine.js';
import { defaultWorldOptions } from './world-settings.js';
import { createTfmsNetwork } from './tfms/operators.js';

export function createTerrainEngine({
  THREE,
  seed = defaultWorldOptions.seedHash,
  worldConfig = {},
} = {}) {
  if (!THREE) {
    throw new Error('createTerrainEngine requires a THREE instance');
  }

  const defaults = defaultWorldOptions.terrain;
  const terrainConfig = worldConfig.terrain ?? {};

  const baseHeight = Number.isFinite(worldConfig.baseHeight)
    ? worldConfig.baseHeight
    : Number.isFinite(terrainConfig.baseHeight)
      ? terrainConfig.baseHeight
      : defaults.baseHeight;

  const maxHeight = Number.isFinite(worldConfig.maxHeight)
    ? worldConfig.maxHeight
    : Number.isFinite(terrainConfig.maxHeight)
      ? terrainConfig.maxHeight
      : defaults.maxHeight;

  const config = {
    baseHeight,
    maxHeight,
    primaryFrequency:
      Number.isFinite(terrainConfig.primaryFrequency)
        ? terrainConfig.primaryFrequency
        : defaults.primaryFrequency,
    primaryAmplitude:
      Number.isFinite(terrainConfig.primaryAmplitude)
        ? terrainConfig.primaryAmplitude
        : defaults.primaryAmplitude,
    primaryOffset:
      Number.isFinite(terrainConfig.primaryOffset)
        ? terrainConfig.primaryOffset
        : defaults.primaryOffset,
    detailFrequency:
      Number.isFinite(terrainConfig.detailFrequency)
        ? terrainConfig.detailFrequency
        : defaults.detailFrequency,
    detailAmplitude:
      Number.isFinite(terrainConfig.detailAmplitude)
        ? terrainConfig.detailAmplitude
        : defaults.detailAmplitude,
    detailOffset:
      Number.isFinite(terrainConfig.detailOffset)
        ? terrainConfig.detailOffset
        : defaults.detailOffset,
    ridgeFrequency:
      Number.isFinite(terrainConfig.ridgeFrequency)
        ? terrainConfig.ridgeFrequency
        : defaults.ridgeFrequency,
    ridgeStrength:
      Number.isFinite(terrainConfig.ridgeStrength)
        ? terrainConfig.ridgeStrength
        : defaults.ridgeStrength,
    ridgeOffset:
      Number.isFinite(terrainConfig.ridgeOffset)
        ? terrainConfig.ridgeOffset
        : defaults.ridgeOffset,
    climateHeightInfluence:
      Number.isFinite(terrainConfig.climateHeightInfluence)
        ? terrainConfig.climateHeightInfluence
        : defaults.climateHeightInfluence,
  };

  const tfmsConfig = normalizeTfmsConfiguration({
    seed,
    terrainConfig,
    defaults: config,
  });

  const { temperament: tfmsTemperament, ...kameaOptions } = tfmsConfig.kamea ?? {};
  const tfmsNetwork = createTfmsNetwork({
    seed: seed * 1.91 + 73,
    operators: tfmsConfig.operators,
    modulationMatrix: tfmsConfig.modulationMatrix,
    transferFunctions: tfmsConfig.transferFunctions,
    tectonic: tfmsConfig.tectonic,
    temperament: tfmsTemperament,
    kameaOptions,
  });

  const biomeEngine = createBiomeEngine({
    THREE,
    seed: seed * 1.37 + 19,
    biomeOptions: worldConfig.biomes,
  });

  function computeElevation(x, z) {
    const { envelope } = tfmsNetwork.evaluate({
      x,
      z,
      context: { terrain: config },
    });
    return config.baseHeight + envelope;
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z);
    const climateAdjustment =
      (biomeSample.climate.moisture - 0.5) * config.climateHeightInfluence;
    height += climateAdjustment;
    const biomeOffset = biomeSample.biome.terrain.heightOffset ?? 0;
    height += biomeOffset;

    if (terrainConfig?.clamp) {
      const minClamp = terrainConfig.clamp.min;
      const maxClamp = terrainConfig.clamp.max;
      if (Number.isFinite(minClamp)) {
        height = Math.max(minClamp, height);
      }
      if (Number.isFinite(maxClamp)) {
        height = Math.min(maxClamp, height);
      }
    }
    if (Number.isFinite(config.maxHeight)) {
      height = Math.min(config.maxHeight, height);
    }
    return {
      ...biomeSample,
      height,
    };
  }

  return {
    sampleColumn,
    getBiomeAt: (x, z) => biomeEngine.getBiomeAt(x, z),
    getBlockColor: (biome, type) => biomeEngine.getBlockColor(biome, type),
    getDefaultBlockColor: () => biomeEngine.getDefaultBlockColor(),
    biomeEngine,
    dispose() {
      biomeEngine.dispose?.();
    },
  };
}

function normalizeTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const fallback = createDefaultTfmsConfiguration({ seed, terrainConfig, defaults });
  const custom = terrainConfig.tfms ?? {};
  const transferFunctions =
    custom.transferFunctions && typeof custom.transferFunctions === 'object'
      ? { ...fallback.transferFunctions, ...custom.transferFunctions }
      : fallback.transferFunctions;
  const tectonic =
    custom.tectonic && typeof custom.tectonic === 'object'
      ? { ...fallback.tectonic, ...custom.tectonic }
      : fallback.tectonic;
  const kameaOptions = { ...fallback.kamea };
  if (typeof custom.temperament === 'string') {
    kameaOptions.temperament = custom.temperament;
  }
  if (typeof custom.kameaTemperament === 'string') {
    kameaOptions.temperament = custom.kameaTemperament;
  }
  if (custom.kamea && typeof custom.kamea === 'object' && custom.kamea.ranges) {
    kameaOptions.ranges = {
      ...(kameaOptions.ranges ?? {}),
      ...custom.kamea.ranges,
    };
  }
  return {
    waveforms: fallback.waveforms,
    operators: fallback.operators,
    modulationMatrix: fallback.modulationMatrix,
    tectonic,
    transferFunctions,
    kamea: kameaOptions,
  };
}

function createDefaultTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const templateSource =
    terrainConfig && typeof terrainConfig.tfms === 'object'
      ? terrainConfig.tfms
      : defaultWorldOptions.terrain.tfms;

  const waveforms = Array.isArray(templateSource?.waveforms)
    ? templateSource.waveforms.map((waveform, index) => ({
        id: waveform?.id ?? `waveform-${index}`,
        type: waveform?.type ?? 'fbm',
        seedTemplate: cloneTfmsSeedTemplate(
          waveform?.seedTemplate ?? waveform?.seed,
        ),
        settings:
          waveform?.settings && typeof waveform.settings === 'object'
            ? { ...waveform.settings }
            : undefined,
      }))
    : [];

  const operatorTemplates = Array.isArray(templateSource?.operators)
    ? templateSource.operators
    : [];

  const operators = operatorTemplates.map((operatorTemplate, index) => {
    const envelope = operatorTemplate?.envelope ?? {};
    const amplitude = resolveEnvelopeScalar(
      envelope.amplitude ?? operatorTemplate?.amplitude,
      defaults,
      defaults.primaryAmplitude,
    );
    const frequency = resolveEnvelopeScalar(
      envelope.frequency ?? operatorTemplate?.frequency,
      defaults,
      defaults.primaryFrequency,
    );
    const phaseVector = resolveEnvelopeVector(
      envelope.phase,
      defaults,
      defaults.primaryOffset,
      defaults.primaryOffset,
    );
    const warpVector = resolveEnvelopeVector(
      envelope.warp ?? envelope.domainWarp,
      defaults,
      0,
      0,
    );

    const seedInfo = resolveSeedConfiguration(
      operatorTemplate?.seedTemplate ?? operatorTemplate?.seed,
      seed,
      index,
    );

    const transferId =
      typeof operatorTemplate?.transfer === 'string'
        ? operatorTemplate.transfer
        : operatorTemplate?.transfer?.id ?? 'identity';

    const baseConfig = {
      id: operatorTemplate?.id ?? `operator-${index}`,
      type: operatorTemplate?.type ?? operatorTemplate?.waveformId ?? 'fbm',
      waveformId:
        operatorTemplate?.waveformId ??
        operatorTemplate?.id ??
        waveforms[index]?.id ??
        `waveform-${index}`,
      seed: seedInfo.value,
      weight: isFiniteNumber(operatorTemplate?.weight)
        ? operatorTemplate.weight
        : 1,
      bias: isFiniteNumber(operatorTemplate?.bias)
        ? operatorTemplate.bias
        : 0,
      amplitude: amplitude.value,
      frequency: frequency.value,
      phase: { x: phaseVector.x.value, z: phaseVector.z.value },
      domainWarp: { x: warpVector.x.value, z: warpVector.z.value },
      transfer: transferId,
    };

    if (
      operatorTemplate?.transfer &&
      typeof operatorTemplate.transfer === 'object' &&
      operatorTemplate.transfer.settings
    ) {
      baseConfig.transferSettings = { ...operatorTemplate.transfer.settings };
    } else if (operatorTemplate?.transferSettings) {
      baseConfig.transferSettings = { ...operatorTemplate.transferSettings };
    }

    if (
      operatorTemplate?.tectonic &&
      typeof operatorTemplate.tectonic === 'object'
    ) {
      baseConfig.tectonic = { ...operatorTemplate.tectonic };
    }

    if (
      operatorTemplate?.settings &&
      typeof operatorTemplate.settings === 'object'
    ) {
      Object.assign(baseConfig, operatorTemplate.settings);
    }

    if (seedInfo.template) {
      baseConfig.seedTemplate = seedInfo.template;
    }

    const modulationTemplate = operatorTemplate?.modulation ?? {};
    baseConfig.modulation = {
      amplitude: cloneRange(modulationTemplate.amplitude),
      frequency: cloneRange(modulationTemplate.frequency),
      phase: {
        x: cloneRange(modulationTemplate.phase?.x),
        z: cloneRange(modulationTemplate.phase?.z),
      },
      warp: {
        x: cloneRange(modulationTemplate.warp?.x),
        z: cloneRange(modulationTemplate.warp?.z),
      },
    };

    baseConfig.envelope = {
      amplitude: amplitude.range,
      frequency: frequency.range,
      phase: {
        x: phaseVector.x.range,
        z: phaseVector.z.range,
      },
      warp: {
        x: warpVector.x.range,
        z: warpVector.z.range,
      },
    };

    return baseConfig;
  });

  const operatorIndexById = new Map();
  operatorTemplates.forEach((operatorTemplate, index) => {
    if (typeof operatorTemplate?.id === 'string') {
      operatorIndexById.set(operatorTemplate.id, index);
    }
    if (typeof operatorTemplate?.waveformId === 'string') {
      operatorIndexById.set(operatorTemplate.waveformId, index);
    }
  });

  const modulationMatrix = (Array.isArray(templateSource?.modulationMatrix)
    ? templateSource.modulationMatrix
    : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const sourceIndex = isFiniteNumber(entry.source)
        ? entry.source
        : operatorIndexById.get(entry.sourceId ?? entry.sourceKey ?? '');
      const targetIndex = isFiniteNumber(entry.target)
        ? entry.target
        : operatorIndexById.get(entry.targetId ?? entry.targetKey ?? '');
      if (!isFiniteNumber(sourceIndex) || !isFiniteNumber(targetIndex)) {
        return null;
      }
      const gain = resolveRangeInput(entry.gain, 0);
      const bias =
        entry.bias !== undefined && entry.bias !== null
          ? resolveRangeInput(entry.bias, 0)
          : null;
      const result = {
        id: entry.id ?? `matrix-entry-${index}`,
        source: sourceIndex,
        target: targetIndex,
        sourceId:
          entry.sourceId ??
          operatorTemplates[sourceIndex]?.id ??
          operators[sourceIndex]?.id ??
          null,
        targetId:
          entry.targetId ??
          operatorTemplates[targetIndex]?.id ??
          operators[targetIndex]?.id ??
          null,
        routing: entry.routing ?? 'amplitude',
        channel: entry.channel ?? 'value',
        gain: gain.value,
      };
      if (entry.axis) {
        result.axis = entry.axis;
      }
      if (bias) {
        result.bias = bias.value;
        if (bias.range) {
          result.biasRange = bias.range;
        }
      }
      if (gain.range) {
        result.gainRange = gain.range;
      }
      return result;
    })
    .filter(Boolean);

  const tectonicTemplate =
    templateSource?.tectonic && typeof templateSource.tectonic === 'object'
      ? templateSource.tectonic
      : {};
  const tectonic = {
    blend: tectonicTemplate.blend ?? 'additive',
    strength: isFiniteNumber(tectonicTemplate.strength)
      ? tectonicTemplate.strength
      : 0.35,
    bias: isFiniteNumber(tectonicTemplate.bias) ? tectonicTemplate.bias : 0,
  };
  if (
    tectonicTemplate.blenders &&
    typeof tectonicTemplate.blenders === 'object'
  ) {
    tectonic.blenders = { ...tectonicTemplate.blenders };
  }

  const transferFunctions =
    templateSource?.transferFunctions &&
    typeof templateSource.transferFunctions === 'object'
      ? { ...templateSource.transferFunctions }
      : {};

  const kameaTemplate =
    templateSource?.kamea && typeof templateSource.kamea === 'object'
      ? templateSource.kamea
      : {};

  const modulationStrengthDefault = clampWithinRange(
    defaults.primaryAmplitude / 16,
    0.3,
    1,
  );
  const modulationStrength = resolveRangeInput(
    kameaTemplate.modulationStrength,
    modulationStrengthDefault,
  );
  const warpStrengthDefault = clampWithinRange(
    modulationStrength.value * 0.75,
    0,
    1,
  );
  const warpStrength = resolveRangeInput(
    kameaTemplate.warpStrength,
    warpStrengthDefault,
  );
  const phaseStrengthDefault = clampWithinRange(
    modulationStrength.value * 0.45,
    0,
    1,
  );
  const phaseStrength = resolveRangeInput(
    kameaTemplate.phaseStrength,
    phaseStrengthDefault,
  );
  const spectralStrengthDefault = clampWithinRange(
    defaults.detailAmplitude / 6,
    0.2,
    1,
  );
  const spectralStrength = resolveRangeInput(
    kameaTemplate.spectralStrength,
    spectralStrengthDefault,
  );

  const kamea = {
    temperament:
      typeof kameaTemplate.temperament === 'string'
        ? kameaTemplate.temperament
        : 'Saturn 3x3',
    modulationStrength: modulationStrength.value,
    warpStrength: warpStrength.value,
    phaseStrength: phaseStrength.value,
    spectralProfile:
      typeof kameaTemplate.spectralProfile === 'string'
        ? kameaTemplate.spectralProfile
        : 'band',
    spectralStrength: spectralStrength.value,
    erosionPreset:
      typeof kameaTemplate.erosionPreset === 'string'
        ? kameaTemplate.erosionPreset
        : 'standard',
  };
  if (modulationStrength.range) {
    kamea.modulationStrengthRange = modulationStrength.range;
  }
  if (warpStrength.range) {
    kamea.warpStrengthRange = warpStrength.range;
  }
  if (phaseStrength.range) {
    kamea.phaseStrengthRange = phaseStrength.range;
  }
  if (spectralStrength.range) {
    kamea.spectralStrengthRange = spectralStrength.range;
  }
  if (kameaTemplate.ranges && typeof kameaTemplate.ranges === 'object') {
    kamea.ranges = Object.fromEntries(
      Object.entries(kameaTemplate.ranges).map(([key, value]) => [
        key,
        cloneRange(value),
      ]),
    );
  }

  return {
    waveforms,
    operators,
    modulationMatrix,
    tectonic,
    transferFunctions,
    kamea,
  };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneRange(range) {
  if (!range || typeof range !== 'object') {
    return undefined;
  }
  const result = {};
  if (isFiniteNumber(range.value)) {
    result.value = range.value;
  }
  if (isFiniteNumber(range.min)) {
    result.min = range.min;
  }
  if (isFiniteNumber(range.max)) {
    result.max = range.max;
  }
  if (typeof range.baseKey === 'string') {
    result.baseKey = range.baseKey;
  }
  if (isFiniteNumber(range.base)) {
    result.base = range.base;
  }
  if (isFiniteNumber(range.multiplier)) {
    result.multiplier = range.multiplier;
  }
  return result;
}

function cloneTfmsSeedTemplate(seedTemplate) {
  if (!seedTemplate || typeof seedTemplate !== 'object') {
    return undefined;
  }
  const result = {};
  if (isFiniteNumber(seedTemplate.value)) {
    result.value = seedTemplate.value;
  }
  if (isFiniteNumber(seedTemplate.multiplier)) {
    result.multiplier = seedTemplate.multiplier;
  }
  if (isFiniteNumber(seedTemplate.offset)) {
    result.offset = seedTemplate.offset;
  }
  return result;
}

function clampWithinRange(value, min, max) {
  let next = value;
  if (isFiniteNumber(min)) {
    next = Math.max(min, next);
  }
  if (isFiniteNumber(max)) {
    next = Math.min(max, next);
  }
  return next;
}

function resolveEnvelopeScalar(range, defaults, fallback) {
  if (isFiniteNumber(range)) {
    return { value: range, range: { value: range } };
  }
  const cloned = cloneRange(range);
  if (!cloned) {
    const fallbackValue = isFiniteNumber(fallback) ? fallback : 0;
    return { value: fallbackValue, range: undefined };
  }
  let value = fallback;
  if (isFiniteNumber(cloned.value)) {
    value = cloned.value;
  } else if (typeof cloned.baseKey === 'string' && defaults) {
    const source = defaults[cloned.baseKey];
    if (isFiniteNumber(source)) {
      const multiplier = isFiniteNumber(cloned.multiplier)
        ? cloned.multiplier
        : 1;
      value = source * multiplier;
    }
  } else if (isFiniteNumber(cloned.base)) {
    const multiplier = isFiniteNumber(cloned.multiplier)
      ? cloned.multiplier
      : 1;
    value = cloned.base * multiplier;
  }
  if (!isFiniteNumber(value)) {
    value = 0;
  }
  const clamped = clampWithinRange(value, cloned.min, cloned.max);
  cloned.value = clamped;
  return { value: clamped, range: cloned };
}

function resolveEnvelopeVector(range, defaults, fallbackX, fallbackZ) {
  const vector = range ?? {};
  const x = resolveEnvelopeScalar(vector.x, defaults, fallbackX);
  const z = resolveEnvelopeScalar(vector.z, defaults, fallbackZ);
  return { x, z };
}

function resolveRangeInput(range, fallback) {
  if (isFiniteNumber(range)) {
    return { value: range, range: { value: range } };
  }
  const cloned = cloneRange(range);
  if (!cloned) {
    const fallbackValue = isFiniteNumber(fallback) ? fallback : 0;
    return { value: fallbackValue, range: undefined };
  }
  const baseValue = isFiniteNumber(cloned.value) ? cloned.value : fallback;
  const clamped = clampWithinRange(
    isFiniteNumber(baseValue) ? baseValue : 0,
    cloned.min,
    cloned.max,
  );
  cloned.value = clamped;
  return { value: clamped, range: cloned };
}

function resolveSeedConfiguration(seedTemplate, seed, index) {
  const cloned = cloneTfmsSeedTemplate(seedTemplate);
  if (cloned && isFiniteNumber(cloned.value)) {
    return { value: cloned.value, template: cloned };
  }
  const multiplier = cloned && isFiniteNumber(cloned.multiplier)
    ? cloned.multiplier
    : isFiniteNumber(seedTemplate?.multiplier)
      ? seedTemplate.multiplier
      : 1.17;
  const offset = cloned && isFiniteNumber(cloned.offset)
    ? cloned.offset
    : isFiniteNumber(seedTemplate?.offset)
      ? seedTemplate.offset
      : index * 137.53;
  const value = seed * multiplier + offset;
  const template = cloned ?? {};
  template.multiplier = multiplier;
  template.offset = offset;
  template.value = value;
  return { value, template };
}

