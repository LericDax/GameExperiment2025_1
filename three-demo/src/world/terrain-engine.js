import { createBiomeEngine } from './biome-engine.js';
import { defaultWorldOptions } from './world-settings.js';
import { createTfmsNetwork } from './tfms/operators.js';

export function createTerrainEngine({
  THREE,
  seed = defaultWorldOptions.seedHash,
  worldConfig = {},
  tfmsFactory = createTfmsNetwork,
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
  const tfmsNetwork = tfmsFactory({
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

  const biomeTfmsNetworks = new Map();
  const biomeBlendStrength = clamp01(tfmsConfig.biomeBlendStrength ?? 0);
  if (biomeBlendStrength > 0 && Array.isArray(biomeEngine?.biomes)) {
    biomeEngine.biomes.forEach((biome, index) => {
      const profile = biome?.tfmsProfile;
      if (!profile?.overrides) {
        return;
      }
      const overrideConfig = createBiomeTfmsConfiguration(
        tfmsConfig,
        profile.overrides,
      );
      if (!overrideConfig) {
        return;
      }
      const overrideSeed =
        seed * 1.91 + 73 + hashBiomeSeed(biome?.id ?? `biome-${index}`);
      const overrideNetwork = tfmsFactory({
        seed: overrideSeed,
        operators: overrideConfig.operators,
        modulationMatrix: overrideConfig.modulationMatrix,
        transferFunctions: overrideConfig.transferFunctions,
        tectonic: overrideConfig.tectonic,
        temperament: overrideConfig.temperament,
        kameaOptions: overrideConfig.kamea,
      });
      biomeTfmsNetworks.set(biome.id, {
        network: overrideNetwork,
        blend: clamp01(profile.blend),
      });
    });
  }

  function evaluateTfmsEnvelope(x, z, biome = null) {
    const baseResult = tfmsNetwork.evaluate({
      x,
      z,
      context: { terrain: config },
    });
    let envelope = baseResult.envelope;

    if (biome && biomeBlendStrength > 0) {
      const profileEntry = biomeTfmsNetworks.get(biome.id);
      if (profileEntry?.network) {
        const blendWeight = clamp01(
          (profileEntry.blend ?? 0) * biomeBlendStrength,
        );
        if (blendWeight > 0) {
          const overrideResult = profileEntry.network.evaluate({
            x,
            z,
            context: { terrain: config },
          });
          envelope = mixValues(
            baseResult.envelope,
            overrideResult.envelope,
            blendWeight,
          );
        }
      }
    }

    return envelope;
  }

  function computeElevation(x, z, biome = null) {
    const envelope = evaluateTfmsEnvelope(x, z, biome);
    return config.baseHeight + envelope;
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z, biomeSample.biome);
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
  const baseAttenuation = Number.isFinite(custom.baseAttenuation)
    ? custom.baseAttenuation
    : fallback.baseAttenuation;
  const clamp = {
    min: Number.isFinite(custom?.clamp?.min)
      ? custom.clamp.min
      : fallback.clamp?.min,
    max: Number.isFinite(custom?.clamp?.max)
      ? custom.clamp.max
      : fallback.clamp?.max,
  };
  const biomeBlendStrength = Number.isFinite(custom.biomeBlendStrength)
    ? custom.biomeBlendStrength
    : fallback.biomeBlendStrength;
  let temperamentValue =
    typeof fallback.temperament === 'string'
      ? fallback.temperament
      : fallback.kamea?.temperament;
  if (typeof custom.temperament === 'string') {
    temperamentValue = custom.temperament;
  }
  if (typeof custom.kameaTemperament === 'string') {
    temperamentValue = custom.kameaTemperament;
  }
  const kameaOptions = { ...fallback.kamea, temperament: temperamentValue };
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
    baseAttenuation,
    clamp,
    biomeBlendStrength,
    temperament: temperamentValue,
  };
}

function createDefaultTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const templateSource =
    terrainConfig && typeof terrainConfig.tfms === 'object'
      ? terrainConfig.tfms
      : defaultWorldOptions.terrain.tfms;

  const presetDefaults = defaultWorldOptions.terrain.tfms ?? {};
  const baseAttenuation = Number.isFinite(templateSource?.baseAttenuation)
    ? templateSource.baseAttenuation
    : Number.isFinite(presetDefaults.baseAttenuation)
      ? presetDefaults.baseAttenuation
      : 1;
  const clamp = {
    min: Number.isFinite(templateSource?.clamp?.min)
      ? templateSource.clamp.min
      : Number.isFinite(presetDefaults?.clamp?.min)
        ? presetDefaults.clamp.min
        : -24,
    max: Number.isFinite(templateSource?.clamp?.max)
      ? templateSource.clamp.max
      : Number.isFinite(presetDefaults?.clamp?.max)
        ? presetDefaults.clamp.max
        : 24,
  };
  const biomeBlendStrength = Number.isFinite(templateSource?.biomeBlendStrength)
    ? templateSource.biomeBlendStrength
    : Number.isFinite(presetDefaults.biomeBlendStrength)
      ? presetDefaults.biomeBlendStrength
      : 0.45;
  const temperament =
    typeof templateSource?.temperament === 'string'
      ? templateSource.temperament
      : typeof templateSource?.kamea?.temperament === 'string'
        ? templateSource.kamea.temperament
        : typeof presetDefaults.temperament === 'string'
          ? presetDefaults.temperament
          : 'Saturn 3x3';

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

  const kameaSpectralProfileDefault =
    typeof presetDefaults?.kamea?.spectralProfile === 'string'
      ? presetDefaults.kamea.spectralProfile
      : 'band';
  const kameaErosionPresetDefault =
    typeof presetDefaults?.kamea?.erosionPreset === 'string'
      ? presetDefaults.kamea.erosionPreset
      : 'standard';

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
        : temperament,
    modulationStrength: modulationStrength.value,
    warpStrength: warpStrength.value,
    phaseStrength: phaseStrength.value,
    spectralProfile:
      typeof kameaTemplate.spectralProfile === 'string'
        ? kameaTemplate.spectralProfile
        : kameaSpectralProfileDefault,
    spectralStrength: spectralStrength.value,
    erosionPreset:
      typeof kameaTemplate.erosionPreset === 'string'
        ? kameaTemplate.erosionPreset
        : kameaErosionPresetDefault,
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
    baseAttenuation,
    clamp,
    biomeBlendStrength,
    temperament,
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

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function mixValues(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

function hashBiomeSeed(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 9973;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createBiomeTfmsConfiguration(baseConfig, overrides) {
  if (!isPlainObject(overrides)) {
    return null;
  }
  const clone = cloneTfmsConfig(baseConfig);
  let mutated = false;

  if (Array.isArray(overrides.waveforms) && overrides.waveforms.length > 0) {
    if (applyWaveformOverrides(clone.waveforms, overrides.waveforms)) {
      mutated = true;
    }
  }

  if (Array.isArray(overrides.operators) && overrides.operators.length > 0) {
    if (applyOperatorOverrides(clone.operators, overrides.operators)) {
      mutated = true;
    }
  }

  if (
    Array.isArray(overrides.modulationMatrix) &&
    overrides.modulationMatrix.length > 0
  ) {
    if (
      applyMatrixOverrides(
        clone.modulationMatrix,
        overrides.modulationMatrix,
      )
    ) {
      mutated = true;
    }
  }

  if (isPlainObject(overrides.transferFunctions)) {
    const entries = Object.entries(overrides.transferFunctions).filter(
      ([key, value]) => typeof key === 'string' && typeof value === 'string',
    );
    if (entries.length > 0) {
      clone.transferFunctions = {
        ...clone.transferFunctions,
        ...Object.fromEntries(entries),
      };
      mutated = true;
    }
  }

  return mutated ? clone : null;
}

function cloneTfmsConfig(config) {
  return {
    waveforms: Array.isArray(config?.waveforms)
      ? config.waveforms.map((waveform) => ({
          id: waveform?.id ?? null,
          type: waveform?.type ?? 'fbm',
          seedTemplate: cloneBiomeSeedTemplate(waveform?.seedTemplate),
          settings: waveform?.settings ? { ...waveform.settings } : {},
        }))
      : [],
    operators: Array.isArray(config?.operators)
      ? config.operators.map((operator) => cloneBiomeTfmsOperator(operator))
      : [],
    modulationMatrix: Array.isArray(config?.modulationMatrix)
      ? config.modulationMatrix.map((entry) => cloneBiomeMatrixEntry(entry))
      : [],
    transferFunctions:
      config?.transferFunctions && typeof config.transferFunctions === 'object'
        ? { ...config.transferFunctions }
        : {},
    tectonic:
      config?.tectonic && typeof config.tectonic === 'object'
        ? { ...config.tectonic }
        : {},
    temperament: config?.temperament ?? null,
    kamea: cloneKameaOptions(config?.kamea),
  };
}

function cloneBiomeTfmsOperator(operator) {
  const base = {
    id: operator?.id ?? null,
    type: operator?.type ?? 'fbm',
    waveformId: operator?.waveformId ?? operator?.id ?? null,
    seed: operator?.seed,
    seedTemplate: cloneBiomeSeedTemplate(operator?.seedTemplate),
    weight: operator?.weight,
    bias: operator?.bias,
    amplitude: operator?.amplitude,
    frequency: operator?.frequency,
    phase: cloneVector(operator?.phase),
    domainWarp: cloneVector(operator?.domainWarp),
    transfer: operator?.transfer,
    transferSettings: operator?.transferSettings
      ? { ...operator.transferSettings }
      : undefined,
    tectonic: operator?.tectonic ? { ...operator.tectonic } : undefined,
    settings: operator?.settings ? { ...operator.settings } : undefined,
    modulation: cloneBiomeModulation(operator?.modulation),
    envelope: cloneBiomeEnvelope(operator?.envelope),
  };
  return base;
}

function cloneBiomeMatrixEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      id: null,
      source: undefined,
      target: undefined,
      sourceId: null,
      targetId: null,
      routing: 'amplitude',
      channel: 'value',
      axis: undefined,
      gain: 0,
      bias: 0,
    };
  }
  const clone = {
    id: entry.id ?? null,
    source: entry.source,
    target: entry.target,
    sourceId: entry.sourceId ?? null,
    targetId: entry.targetId ?? null,
    routing: entry.routing ?? 'amplitude',
    channel: entry.channel ?? 'value',
    axis: entry.axis,
    gain: entry.gain,
    bias: entry.bias,
  };
  if (entry.gainRange && typeof entry.gainRange === 'object') {
    clone.gainRange = { ...entry.gainRange };
  }
  if (entry.biasRange && typeof entry.biasRange === 'object') {
    clone.biasRange = { ...entry.biasRange };
  }
  return clone;
}

function cloneVector(vector) {
  if (!vector || typeof vector !== 'object') {
    return { x: 0, z: 0 };
  }
  return {
    x: Number.isFinite(vector.x) ? vector.x : 0,
    z: Number.isFinite(vector.z) ? vector.z : 0,
  };
}

function cloneBiomeModulation(modulation) {
  if (!modulation || typeof modulation !== 'object') {
    return {
      amplitude: { value: 0 },
      frequency: { value: 0 },
      phase: { x: { value: 0 }, z: { value: 0 } },
      warp: { x: { value: 0 }, z: { value: 0 } },
    };
  }
  return {
    amplitude: cloneBiomeRange(modulation.amplitude),
    frequency: cloneBiomeRange(modulation.frequency),
    phase: {
      x: cloneBiomeRange(modulation?.phase?.x),
      z: cloneBiomeRange(modulation?.phase?.z),
    },
    warp: {
      x: cloneBiomeRange(modulation?.warp?.x),
      z: cloneBiomeRange(modulation?.warp?.z),
    },
  };
}

function cloneBiomeEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return {
      amplitude: { value: 0 },
      frequency: { value: 0 },
      phase: { x: { value: 0 }, z: { value: 0 } },
      warp: { x: { value: 0 }, z: { value: 0 } },
    };
  }
  return {
    amplitude: cloneBiomeRange(envelope.amplitude),
    frequency: cloneBiomeRange(envelope.frequency),
    phase: {
      x: cloneBiomeRange(envelope?.phase?.x),
      z: cloneBiomeRange(envelope?.phase?.z),
    },
    warp: {
      x: cloneBiomeRange((envelope?.warp ?? envelope?.domainWarp)?.x),
      z: cloneBiomeRange((envelope?.warp ?? envelope?.domainWarp)?.z),
    },
  };
}

function cloneBiomeRange(range) {
  if (!range || typeof range !== 'object') {
    return { value: 0 };
  }
  const clone = {};
  if (Number.isFinite(range.value)) {
    clone.value = range.value;
  }
  if (Number.isFinite(range.min)) {
    clone.min = range.min;
  }
  if (Number.isFinite(range.max)) {
    clone.max = range.max;
  }
  if (typeof range.baseKey === 'string') {
    clone.baseKey = range.baseKey;
  }
  if (Number.isFinite(range.base)) {
    clone.base = range.base;
  }
  if (Number.isFinite(range.multiplier)) {
    clone.multiplier = range.multiplier;
  }
  if (typeof range.axis === 'string') {
    clone.axis = range.axis;
  }
  if (typeof range.channel === 'string') {
    clone.channel = range.channel;
  }
  return clone;
}

function cloneBiomeSeedTemplate(seedTemplate) {
  if (!seedTemplate || typeof seedTemplate !== 'object') {
    return undefined;
  }
  const clone = {};
  if (Number.isFinite(seedTemplate.value)) {
    clone.value = seedTemplate.value;
  }
  if (Number.isFinite(seedTemplate.multiplier)) {
    clone.multiplier = seedTemplate.multiplier;
  }
  if (Number.isFinite(seedTemplate.offset)) {
    clone.offset = seedTemplate.offset;
  }
  return clone;
}

function cloneKameaOptions(kamea) {
  if (!kamea || typeof kamea !== 'object') {
    return undefined;
  }
  const clone = {
    temperament: kamea.temperament,
    modulationStrength: cloneRange(kamea.modulationStrength),
    warpStrength: cloneRange(kamea.warpStrength),
    phaseStrength: cloneRange(kamea.phaseStrength),
    spectralStrength: cloneRange(kamea.spectralStrength),
    spectralProfile: kamea.spectralProfile,
    erosionPreset: kamea.erosionPreset,
  };
  if (kamea.ranges && typeof kamea.ranges === 'object') {
    clone.ranges = Object.fromEntries(
      Object.entries(kamea.ranges).map(([key, value]) => [
        key,
        cloneRange(value),
      ]),
    );
  }
  return clone;
}

function applyWaveformOverrides(target, overrides) {
  if (!Array.isArray(target)) {
    return false;
  }
  const waveformById = new Map();
  target.forEach((waveform, index) => {
    const id = waveform?.id ?? `waveform-${index}`;
    waveformById.set(id, waveform);
  });
  let mutated = false;
  overrides.forEach((override) => {
    if (!isPlainObject(override)) {
      return;
    }
    const id = typeof override.id === 'string' ? override.id : null;
    if (!id) {
      return;
    }
    const targetWaveform = waveformById.get(id);
    if (!targetWaveform) {
      return;
    }
    if (typeof override.type === 'string') {
      targetWaveform.type = override.type;
      mutated = true;
    }
    if (isPlainObject(override.settings)) {
      targetWaveform.settings = {
        ...targetWaveform.settings,
        ...override.settings,
      };
      mutated = true;
    }
    if (isPlainObject(override.seedTemplate)) {
      const nextSeed = targetWaveform.seedTemplate
        ? { ...targetWaveform.seedTemplate }
        : {};
      if (Number.isFinite(override.seedTemplate.value)) {
        nextSeed.value = override.seedTemplate.value;
      }
      if (Number.isFinite(override.seedTemplate.multiplier)) {
        nextSeed.multiplier = override.seedTemplate.multiplier;
      }
      if (Number.isFinite(override.seedTemplate.offset)) {
        nextSeed.offset = override.seedTemplate.offset;
      }
      targetWaveform.seedTemplate = nextSeed;
      mutated = true;
    }
  });
  return mutated;
}

function applyOperatorOverrides(target, overrides) {
  if (!Array.isArray(target)) {
    return false;
  }
  const operatorById = new Map();
  target.forEach((operator) => {
    if (operator && typeof operator.id === 'string') {
      operatorById.set(operator.id, operator);
    }
  });
  let mutated = false;
  overrides.forEach((override) => {
    if (!isPlainObject(override)) {
      return;
    }
    const id = typeof override.id === 'string' ? override.id : null;
    if (!id) {
      return;
    }
    const operator = operatorById.get(id);
    if (!operator) {
      return;
    }
    if (typeof override.type === 'string') {
      operator.type = override.type;
      mutated = true;
    }
    if (typeof override.waveformId === 'string') {
      operator.waveformId = override.waveformId;
      mutated = true;
    }
    if (Number.isFinite(override.weight)) {
      operator.weight = override.weight;
      mutated = true;
    }
    if (Number.isFinite(override.bias)) {
      operator.bias = override.bias;
      mutated = true;
    }
    if (Number.isFinite(override.amplitude)) {
      operator.amplitude = override.amplitude;
      mutated = true;
    }
    if (Number.isFinite(override.frequency)) {
      operator.frequency = override.frequency;
      mutated = true;
    }
    if (override.phase && applyVectorOverrideProperty(operator, 'phase', override.phase)) {
      mutated = true;
    }
    if (
      override.domainWarp &&
      applyVectorOverrideProperty(operator, 'domainWarp', override.domainWarp)
    ) {
      mutated = true;
    }
    if (override.transfer) {
      if (typeof override.transfer === 'string') {
        operator.transfer = override.transfer;
        mutated = true;
      } else if (isPlainObject(override.transfer)) {
        operator.transfer = {
          ...operator.transfer,
          ...override.transfer,
        };
        mutated = true;
      }
    }
    if (isPlainObject(override.transferSettings)) {
      operator.transferSettings = {
        ...operator.transferSettings,
        ...override.transferSettings,
      };
      mutated = true;
    }
    if (isPlainObject(override.settings)) {
      operator.settings = {
        ...operator.settings,
        ...override.settings,
      };
      mutated = true;
    }
    if (isPlainObject(override.tectonic)) {
      operator.tectonic = operator.tectonic ? { ...operator.tectonic } : {};
      if (Number.isFinite(override.tectonic.weight)) {
        operator.tectonic.weight = override.tectonic.weight;
        mutated = true;
      }
      if (Number.isFinite(override.tectonic.bias)) {
        operator.tectonic.bias = override.tectonic.bias;
        mutated = true;
      }
    }
    if (isPlainObject(override.seedTemplate)) {
      const nextSeed = operator.seedTemplate ? { ...operator.seedTemplate } : {};
      if (Number.isFinite(override.seedTemplate.value)) {
        nextSeed.value = override.seedTemplate.value;
      }
      if (Number.isFinite(override.seedTemplate.multiplier)) {
        nextSeed.multiplier = override.seedTemplate.multiplier;
      }
      if (Number.isFinite(override.seedTemplate.offset)) {
        nextSeed.offset = override.seedTemplate.offset;
      }
      operator.seedTemplate = nextSeed;
      mutated = true;
    }
    if (
      override.envelope &&
      applyEnvelopeOverride(operator.envelope, override.envelope)
    ) {
      mutated = true;
    }
    if (
      override.modulation &&
      applyModulationOverride(operator.modulation, override.modulation)
    ) {
      mutated = true;
    }
  });
  return mutated;
}

function applyMatrixOverrides(targetMatrix, overrides) {
  if (!Array.isArray(targetMatrix)) {
    return false;
  }
  let mutated = false;
  overrides.forEach((override) => {
    if (!isPlainObject(override)) {
      return;
    }
    const entry = findMatrixEntry(targetMatrix, override);
    if (!entry) {
      return;
    }
    if (typeof override.routing === 'string') {
      entry.routing = override.routing;
      mutated = true;
    }
    if (typeof override.channel === 'string') {
      entry.channel = override.channel;
      mutated = true;
    }
    if (typeof override.axis === 'string') {
      entry.axis = override.axis;
      mutated = true;
    }
    if (Number.isFinite(override.gain)) {
      entry.gain = override.gain;
      if (entry.gainRange) {
        entry.gainRange = { ...entry.gainRange, value: override.gain };
      }
      mutated = true;
    }
    if (Number.isFinite(override.bias)) {
      entry.bias = override.bias;
      if (entry.biasRange) {
        entry.biasRange = { ...entry.biasRange, value: override.bias };
      }
      mutated = true;
    }
  });
  return mutated;
}

function applyVectorOverrideProperty(target, property, override) {
  if (!isPlainObject(override)) {
    return false;
  }
  const x = Number.isFinite(override.x) ? override.x : undefined;
  const z = Number.isFinite(override.z) ? override.z : undefined;
  if (x === undefined && z === undefined) {
    return false;
  }
  const next = target[property] && typeof target[property] === 'object'
    ? { ...target[property] }
    : { x: 0, z: 0 };
  if (x !== undefined) {
    next.x = x;
  }
  if (z !== undefined) {
    next.z = z;
  }
  target[property] = next;
  return true;
}

function applyEnvelopeOverride(targetEnvelope, override) {
  if (!isPlainObject(override)) {
    return false;
  }
  if (!targetEnvelope || typeof targetEnvelope !== 'object') {
    return false;
  }
  let mutated = false;
  if (Number.isFinite(override.amplitude)) {
    targetEnvelope.amplitude = {
      ...(targetEnvelope.amplitude ?? {}),
      value: override.amplitude,
    };
    mutated = true;
  }
  if (Number.isFinite(override.frequency)) {
    targetEnvelope.frequency = {
      ...(targetEnvelope.frequency ?? {}),
      value: override.frequency,
    };
    mutated = true;
  }
  if (override.phase && isPlainObject(override.phase)) {
    targetEnvelope.phase = targetEnvelope.phase
      ? { ...targetEnvelope.phase }
      : { x: {}, z: {} };
    if (Number.isFinite(override.phase.x)) {
      targetEnvelope.phase.x = {
        ...(targetEnvelope.phase.x ?? {}),
        value: override.phase.x,
      };
      mutated = true;
    }
    if (Number.isFinite(override.phase.z)) {
      targetEnvelope.phase.z = {
        ...(targetEnvelope.phase.z ?? {}),
        value: override.phase.z,
      };
      mutated = true;
    }
  }
  if (override.warp && isPlainObject(override.warp)) {
    targetEnvelope.warp = targetEnvelope.warp
      ? { ...targetEnvelope.warp }
      : { x: {}, z: {} };
    if (Number.isFinite(override.warp.x)) {
      targetEnvelope.warp.x = {
        ...(targetEnvelope.warp.x ?? {}),
        value: override.warp.x,
      };
      mutated = true;
    }
    if (Number.isFinite(override.warp.z)) {
      targetEnvelope.warp.z = {
        ...(targetEnvelope.warp.z ?? {}),
        value: override.warp.z,
      };
      mutated = true;
    }
  }
  return mutated;
}

function applyModulationOverride(targetModulation, override) {
  if (!isPlainObject(override)) {
    return false;
  }
  if (!targetModulation || typeof targetModulation !== 'object') {
    return false;
  }
  let mutated = false;
  if (Number.isFinite(override.amplitude)) {
    targetModulation.amplitude = {
      ...(targetModulation.amplitude ?? {}),
      value: override.amplitude,
    };
    mutated = true;
  }
  if (Number.isFinite(override.frequency)) {
    targetModulation.frequency = {
      ...(targetModulation.frequency ?? {}),
      value: override.frequency,
    };
    mutated = true;
  }
  if (override.phase && isPlainObject(override.phase)) {
    targetModulation.phase = targetModulation.phase
      ? { ...targetModulation.phase }
      : { x: {}, z: {} };
    if (Number.isFinite(override.phase.x)) {
      targetModulation.phase.x = {
        ...(targetModulation.phase.x ?? {}),
        value: override.phase.x,
      };
      mutated = true;
    }
    if (Number.isFinite(override.phase.z)) {
      targetModulation.phase.z = {
        ...(targetModulation.phase.z ?? {}),
        value: override.phase.z,
      };
      mutated = true;
    }
  }
  if (override.warp && isPlainObject(override.warp)) {
    targetModulation.warp = targetModulation.warp
      ? { ...targetModulation.warp }
      : { x: {}, z: {} };
    if (Number.isFinite(override.warp.x)) {
      targetModulation.warp.x = {
        ...(targetModulation.warp.x ?? {}),
        value: override.warp.x,
      };
      mutated = true;
    }
    if (Number.isFinite(override.warp.z)) {
      targetModulation.warp.z = {
        ...(targetModulation.warp.z ?? {}),
        value: override.warp.z,
      };
      mutated = true;
    }
  }
  return mutated;
}

function findMatrixEntry(matrix, override) {
  if (!Array.isArray(matrix)) {
    return null;
  }
  if (typeof override.id === 'string') {
    const direct = matrix.find((entry) => entry.id === override.id);
    if (direct) {
      return direct;
    }
  }
  const sourceId = typeof override.sourceId === 'string' ? override.sourceId : null;
  const targetId = typeof override.targetId === 'string' ? override.targetId : null;
  const routing = typeof override.routing === 'string' ? override.routing : null;
  const channel = typeof override.channel === 'string' ? override.channel : null;
  const axis = typeof override.axis === 'string' ? override.axis : null;
  return matrix.find((entry) => {
    const matchesSource = sourceId ? entry.sourceId === sourceId : true;
    const matchesTarget = targetId ? entry.targetId === targetId : true;
    const matchesRouting = routing ? entry.routing === routing : true;
    const matchesChannel = channel ? entry.channel === channel : true;
    const matchesAxis = axis ? entry.axis === axis : true;
    return matchesSource && matchesTarget && matchesRouting && matchesChannel && matchesAxis;
  }) ?? null;
}

