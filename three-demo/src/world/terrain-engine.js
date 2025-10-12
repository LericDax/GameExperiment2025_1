/**
 * Terrain FM Synthesis (TFMS) terrain engine utilities.
 *
 * The module assembles the six-operator attenuation graph described in the
 * TFMS guide, wiring macro FBM, ridge, banding, tectonic Worley, domain warp,
 * and diffusion mask operators into a modulation matrix before biome blending.
 * See docs/tfms-system.md#default-operator-catalogue and
 * docs/tfms-system.md#modulation-matrix-semantics for a schematic of how the
 * presets map onto runtime evaluation.
 */
import { createBiomeEngine } from './biome-engine.js';
import { listCanonicalKameaNames } from './kamea.js';
import {
  defaultWorldOptions,
  LEGACY_TFMS_PRIMARY_AMPLITUDE,
} from './world-settings.js';
import { createTfmsNetwork } from './tfms/operators.js';

const MIN_OPERATOR_COUNT = 1;
// Keep in sync with docs/tfms-system.md#operator-slot-selection-1-6-carriers.
const MAX_OPERATOR_COUNT = 6;
const CANONICAL_KAMEA_TEMPERAMENTS = new Set(listCanonicalKameaNames());

/**
 * Build the base TFMS terrain graph and optional biome override networks.
 *
 * This function merges world overrides with the six-operator default preset,
 * resolves modulation links, and instantiates the networks documented in
 * docs/tfms-system.md#tfms-concept-overview. The resulting base network is the
 * one illustrated in docs/tfms-system.md#default-operator-catalogue; per-biome
 * overrides clone that structure, patching operators or modulation entries
 * before blending according to docs/tfms-system.md#biome-override-workflow.
 *
 * @param {object} options
 * @param {typeof import('three')} options.THREE
 * @param {number} [options.seed]
 * @param {object} [options.worldConfig]
 */
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

  const baselinePrimaryAmplitude = Number.isFinite(
    defaultWorldOptions?.terrain?.primaryAmplitude,
  )
    ? defaultWorldOptions.terrain.primaryAmplitude
    : 1;
  const activePrimaryAmplitude = Number.isFinite(config.primaryAmplitude)
    ? config.primaryAmplitude
    : baselinePrimaryAmplitude;
  const rawTerrainAmplitudeScale =
    baselinePrimaryAmplitude > 0
      ? activePrimaryAmplitude / baselinePrimaryAmplitude
      : 1;
  const terrainAmplitudeScale =
    Number.isFinite(rawTerrainAmplitudeScale) && rawTerrainAmplitudeScale > 0
      ? rawTerrainAmplitudeScale
      : 1;

  let tfmsConfig = normalizeTfmsConfiguration({
    seed,
    terrainConfig,
    defaults: config,
  });

  const tfmsState = instantiateTfmsNetwork({
    baseSeed: seed,
    tfmsConfig,
    defaults: config,
  });
  const tfmsNetwork = tfmsState.network;
  tfmsConfig = tfmsState.config;

  const biomeEngine = createBiomeEngine({
    THREE,
    seed: seed * 1.37 + 19,
    biomeOptions: worldConfig.biomes,
  });

  const biomeTfmsNetworks = new Map();
  const biomeById = new Map(
    Array.isArray(biomeEngine?.biomes)
      ? biomeEngine.biomes.map((biome) => [biome.id, biome])
      : [],
  );
  const biomeBlendStrength = clamp01(tfmsConfig.biomeBlendStrength ?? 0);
  const baseTfmsEntry = { network: tfmsNetwork, config: tfmsConfig };

  function getBiomeNetworkKey(biomeId, schemaId) {
    const biomeKey = typeof biomeId === 'string' ? biomeId : 'unknown';
    const schemaKey = schemaId ? schemaId : 'default';
    return `${biomeKey}::${schemaKey}`;
  }

  // Schema selection mirrors the flow documented in
  // docs/tfms-system.md#assigning-schema-compendia-to-biomes so designers can
  // follow the merge stages when authoring compendium entries.
  function normalizeSchemaSelection(schemaInfo) {
    if (!schemaInfo) {
      return null;
    }
    const schema = schemaInfo.schema ?? null;
    const id =
      typeof schemaInfo.id === 'string'
        ? schemaInfo.id
        : typeof schemaInfo.schemaId === 'string'
          ? schemaInfo.schemaId
          : typeof schema?.id === 'string'
            ? schema.id
            : null;
    if (!id) {
      return null;
    }
    const blendSource =
      schemaInfo.blend ?? schemaInfo.schemaBlend ?? schema?.blend ?? undefined;
    return {
      id,
      overrides: schemaInfo.overrides ?? schema?.overrides ?? null,
      blend: Number.isFinite(blendSource) ? clamp01(blendSource) : undefined,
    };
  }

  function ensureBiomeNetwork(biome, schemaInfo = null) {
    if (!biome?.id) {
      return null;
    }
    const selection = normalizeSchemaSelection(schemaInfo);
    const key = getBiomeNetworkKey(biome.id, selection?.id ?? null);
    if (biomeTfmsNetworks.has(key)) {
      return biomeTfmsNetworks.get(key);
    }
    const profile = biome.tfmsProfile ?? {};
    const combinedOverrides = mergeTfmsOverrides(
      selection?.overrides ?? null,
      profile.overrides ?? null,
    );
    if (!combinedOverrides) {
      biomeTfmsNetworks.set(key, null);
      return null;
    }
    const overrideConfig = createBiomeTfmsConfiguration(
      tfmsConfig,
      combinedOverrides,
      { terrainAmplitudeScale },
    );
    if (!overrideConfig) {
      biomeTfmsNetworks.set(key, null);
      return null;
    }
    const seedKey = `${biome.id}:${selection?.id ?? 'default'}`;
    const overrideSeed = seed * 1.91 + 73 + hashBiomeSeed(seedKey);
    const overrideNetwork = createTfmsNetwork({
      seed: overrideSeed,
      operators: overrideConfig.operators,
      modulationMatrix: overrideConfig.modulationMatrix,
      transferFunctions: overrideConfig.transferFunctions,
      tectonic: overrideConfig.tectonic,
      temperament: overrideConfig.temperament,
      kameaOptions: overrideConfig.kamea,
    });
    const entry = {
      network: overrideNetwork,
      blend: clamp01(selection?.blend ?? profile.blend ?? 1),
      config: overrideConfig,
    };
    biomeTfmsNetworks.set(key, entry);
    return entry;
  }

  if (Array.isArray(biomeEngine?.biomes) && biomeBlendStrength > 0) {
    biomeEngine.biomes.forEach((biome) => {
      if (biome?.tfmsProfile?.overrides) {
        ensureBiomeNetwork(biome, null);
      }
      if (Array.isArray(biome?.tfmsProfile?.schemaPool)) {
        biome.tfmsProfile.schemaPool.forEach((entry) => {
          const normalized = normalizeSchemaSelection(entry);
          if (normalized) {
            ensureBiomeNetwork(biome, normalized);
          }
        });
      }
    });
  }

  function evaluateTfmsEnvelope(x, z, biomeSample = null) {
    const baseResult = tfmsNetwork.evaluate({
      x,
      z,
      context: { terrain: config },
    });
    let envelope = transformTfmsEnvelope(baseResult.envelope, tfmsConfig);

    if (biomeBlendStrength > 0 && biomeSample?.biome) {
      const profileEntry = ensureBiomeNetwork(
        biomeSample.biome,
        biomeSample.tfmsSchema,
      );
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
          const overrideEnvelope = transformTfmsEnvelope(
            overrideResult.envelope,
            profileEntry.config,
            tfmsConfig,
          );
          envelope = clampTfmsEnvelope(
            mixValues(envelope, overrideEnvelope, blendWeight),
            tfmsConfig,
          );
        }
      }
    }

    return envelope;
  }

  function computeElevation(x, z, biomeSample = null) {
    const envelope = evaluateTfmsEnvelope(x, z, biomeSample);
    return config.baseHeight + envelope;
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeElevation(x, z, biomeSample);
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
    getBaseTfmsNetwork() {
      return baseTfmsEntry;
    },
    getBiomeTfmsNetwork(biomeId, schemaId = null) {
      const biome = biomeById.get(biomeId);
      if (!biome) {
        return null;
      }
      let selection = null;
      if (schemaId) {
        if (Array.isArray(biome.tfmsProfile?.schemaPool)) {
          const match = biome.tfmsProfile.schemaPool.find(
            (entry) => entry?.schema?.id === schemaId || entry?.id === schemaId,
          );
          if (match) {
            selection = normalizeSchemaSelection(match);
          } else {
            selection = normalizeSchemaSelection({ id: schemaId });
          }
        } else {
          selection = normalizeSchemaSelection({ id: schemaId });
        }
      }
      return ensureBiomeNetwork(biome, selection);
    },
    getTerrainConfig() {
      return config;
    },
    biomeEngine,
    dispose() {
      biomeEngine.dispose?.();
    },
  };
}

function instantiateTfmsNetwork({ baseSeed, tfmsConfig, defaults }) {
  const networkSeed = baseSeed * 1.91 + 73;
  const primaryOptions = buildTfmsNetworkOptions(tfmsConfig, networkSeed);

  try {
    return {
      network: createTfmsNetwork(primaryOptions),
      config: tfmsConfig,
    };
  } catch (error) {
    console.warn(
      '[terrain] Failed to create TFMS network with overrides. Falling back to default preset.',
      error,
    );
  }

  const fallbackConfig = createDefaultTfmsConfiguration({
    seed: baseSeed,
    terrainConfig: null,
    defaults,
  });
  const fallbackTemperament = resolveTemperamentSelection({
    customConfig: null,
    fallbackConfig,
  }).temperament;
  if (fallbackTemperament) {
    fallbackConfig.temperament = fallbackTemperament;
    fallbackConfig.kamea = {
      ...(fallbackConfig.kamea ?? {}),
      temperament: fallbackTemperament,
    };
  }

  const fallbackOptions = buildTfmsNetworkOptions(fallbackConfig, networkSeed);

  try {
    return {
      network: createTfmsNetwork(fallbackOptions),
      config: fallbackConfig,
    };
  } catch (fallbackError) {
    console.error(
      '[terrain] Failed to construct fallback TFMS network. Using stub network instead.',
      fallbackError,
    );
    return {
      network: createStubTfmsNetwork(),
      config: fallbackConfig,
    };
  }
}

function buildTfmsNetworkOptions(config, seed) {
  if (!config) {
    return {
      seed,
      operators: [],
      modulationMatrix: [],
      transferFunctions: {},
      tectonic: {},
      temperament: null,
      kameaOptions: {},
    };
  }

  const { temperament: kameaTemperament, ...kameaOptions } = config.kamea ?? {};

  return {
    seed,
    operators: config.operators ?? [],
    modulationMatrix: config.modulationMatrix ?? [],
    transferFunctions: config.transferFunctions ?? {},
    tectonic: config.tectonic ?? {},
    temperament: kameaTemperament ?? config.temperament ?? null,
    kameaOptions,
  };
}

function createStubTfmsNetwork() {
  return {
    evaluate() {
      return {
        envelope: 0,
        rawEnvelope: 0,
        tectonic: 0,
        operators: [],
      };
    },
    getOperators() {
      return [];
    },
    getKameaPatch() {
      return null;
    },
  };
}

function resolveTemperamentSelection({ customConfig, fallbackConfig }) {
  const defaultTemperament = getDefaultTerrainTemperament();
  const fallbackTemperament =
    typeof fallbackConfig?.temperament === 'string'
      ? fallbackConfig.temperament
      : typeof fallbackConfig?.kamea?.temperament === 'string'
        ? fallbackConfig.kamea.temperament
        : null;

  const customCandidates = [];
  if (customConfig) {
    if (typeof customConfig.temperament === 'string') {
      customCandidates.push(customConfig.temperament.trim());
    }
    if (typeof customConfig.kameaTemperament === 'string') {
      customCandidates.push(customConfig.kameaTemperament.trim());
    }
    if (typeof customConfig?.kamea?.temperament === 'string') {
      customCandidates.push(customConfig.kamea.temperament.trim());
    }
  }
  const normalizedCandidates = customCandidates.filter((value) => value.length > 0);
  for (const candidate of normalizedCandidates) {
    if (CANONICAL_KAMEA_TEMPERAMENTS.has(candidate)) {
      return { temperament: candidate };
    }
  }

  const invalidCandidate = normalizedCandidates[0] ?? null;

  const fallbackTargets = [];
  if (typeof defaultTemperament === 'string') {
    fallbackTargets.push({
      value: defaultTemperament,
      label: `default temperament "${defaultTemperament}"`,
    });
  }
  if (typeof fallbackTemperament === 'string') {
    fallbackTargets.push({ value: fallbackTemperament, label: `"${fallbackTemperament}"` });
  }

  for (const target of fallbackTargets) {
    if (CANONICAL_KAMEA_TEMPERAMENTS.has(target.value)) {
      if (invalidCandidate) {
        console.warn(
          `Unknown TFMS Kamea temperament "${invalidCandidate}". Falling back to ${target.label}.`,
        );
      }
      return { temperament: target.value };
    }
  }

  const canonicalIterator = CANONICAL_KAMEA_TEMPERAMENTS.values().next();
  if (!canonicalIterator.done) {
    if (invalidCandidate) {
      const label =
        typeof defaultTemperament === 'string'
          ? `default temperament "${defaultTemperament}"`
          : `"${canonicalIterator.value}"`;
      console.warn(
        `Unknown TFMS Kamea temperament "${invalidCandidate}". Falling back to ${label}.`,
      );
    }
    return { temperament: canonicalIterator.value };
  }

  if (invalidCandidate) {
    const label =
      typeof defaultTemperament === 'string'
        ? `default temperament "${defaultTemperament}"`
        : fallbackTemperament
          ? `"${fallbackTemperament}"`
          : 'a safe default temperament';
    console.warn(
      `Unknown TFMS Kamea temperament "${invalidCandidate}". Falling back to ${label}.`,
    );
  }

  return {
    temperament: fallbackTemperament ?? defaultTemperament ?? null,
  };
}

function getDefaultTerrainTemperament() {
  const tfmsDefaults = defaultWorldOptions?.terrain?.tfms ?? {};
  if (typeof tfmsDefaults.temperament === 'string') {
    return tfmsDefaults.temperament;
  }
  if (typeof tfmsDefaults?.kamea?.temperament === 'string') {
    return tfmsDefaults.kamea.temperament;
  }
  return null;
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
  const temperamentSelection = resolveTemperamentSelection({
    customConfig: custom,
    fallbackConfig: fallback,
  });
  const temperamentValue = temperamentSelection.temperament ?? null;
  const kameaOptions = { ...(fallback.kamea ?? {}) };
  if (temperamentValue != null) {
    kameaOptions.temperament = temperamentValue;
  } else {
    delete kameaOptions.temperament;
  }
  if (custom.kamea && typeof custom.kamea === 'object' && custom.kamea.ranges) {
    kameaOptions.ranges = {
      ...(kameaOptions.ranges ?? {}),
      ...custom.kamea.ranges,
    };
  }
  const availableOperators = Array.isArray(fallback.operators)
    ? fallback.operators.length
    : 0;
  const operatorCount = normalizeOperatorCount(
    availableOperators,
    Number.isFinite(custom.operatorCount)
      ? custom.operatorCount
      : fallback.operatorCount,
  );
  const operators = fallback.operators.slice(0, operatorCount);
  const modulationMatrix = fallback.modulationMatrix.filter(
    (entry) =>
      isFiniteNumber(entry?.source) &&
      entry.source < operators.length &&
      isFiniteNumber(entry?.target) &&
      entry.target < operators.length,
  );

  return {
    waveforms: fallback.waveforms,
    operators,
    modulationMatrix,
    tectonic,
    transferFunctions,
    kamea: kameaOptions,
    baseAttenuation,
    clamp,
    biomeBlendStrength,
    temperament: temperamentValue,
    operatorCount,
  };
}

function createDefaultTfmsConfiguration({ seed, terrainConfig, defaults }) {
  const presetDefaults = defaultWorldOptions.terrain.tfms ?? {};
  const templateSource =
    terrainConfig && typeof terrainConfig.tfms === 'object'
      ? { ...presetDefaults, ...terrainConfig.tfms }
      : presetDefaults;
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

  const operatorTemplatesSource = Array.isArray(templateSource?.operators)
    ? templateSource.operators
    : [];
  const requestedOperatorCount = Number.isFinite(templateSource?.operatorCount)
    ? templateSource.operatorCount
    : operatorTemplatesSource.length || MAX_OPERATOR_COUNT;
  const configuredOperatorCount = normalizeOperatorCount(
    operatorTemplatesSource.length,
    requestedOperatorCount,
  );
  const operatorTemplates = operatorTemplatesSource.slice(
    0,
    configuredOperatorCount,
  );

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

  retuneBasinAndShelfOperators({ operators, defaults });

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

  rebalanceBasinMatrix(modulationMatrix);

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

  const operatorCount = operatorTemplates.length;

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
    operatorCount,
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

function retuneBasinAndShelfOperators({ operators, defaults }) {
  if (!Array.isArray(operators)) {
    return;
  }
  const primaryAmplitude = isFiniteNumber(defaults?.primaryAmplitude)
    ? defaults.primaryAmplitude
    : 1;
  const detailAmplitude = isFiniteNumber(defaults?.detailAmplitude)
    ? defaults.detailAmplitude
    : primaryAmplitude * 0.6;
  const primaryFrequency = isFiniteNumber(defaults?.primaryFrequency)
    ? defaults.primaryFrequency
    : 0.0008;
  const detailFrequency = isFiniteNumber(defaults?.detailFrequency)
    ? defaults.detailFrequency
    : primaryFrequency * 2;
  const warpRatio =
    primaryFrequency > 0
      ? clampWithinRange(detailFrequency / primaryFrequency, 0.5, 3)
      : 1;

  operators.forEach((operator) => {
    if (!operator || typeof operator !== 'object') {
      return;
    }
    if (operator.id === 'tectonic-worley') {
      retuneTectonicOperator(operator, { detailAmplitude, warpRatio });
    } else if (operator.id === 'domain-warp') {
      retuneDomainWarpOperator(operator, {
        primaryAmplitude,
        warpRatio,
      });
    }
  });
}

function retuneTectonicOperator(operator, { detailAmplitude, warpRatio }) {
  const amplitude = operator?.envelope?.amplitude;
  if (amplitude) {
    const multiplier = isFiniteNumber(amplitude.multiplier)
      ? amplitude.multiplier
      : 0.45;
    amplitude.multiplier = clampWithinRange(multiplier * 1.2, 0.3, 0.9);
    raiseRangeMaximum(amplitude, detailAmplitude * 0.75);
    if (!isFiniteNumber(amplitude.min) || amplitude.min < 0) {
      amplitude.min = 0;
    }
  }
  const frequency = operator?.envelope?.frequency;
  if (frequency) {
    const multiplier = isFiniteNumber(frequency.multiplier)
      ? frequency.multiplier
      : 0.45;
    frequency.multiplier = clampWithinRange(multiplier * 0.85, 0.2, 0.6);
  }
  if (operator?.modulation?.amplitude) {
    widenSymmetricRange(operator.modulation.amplitude, 1.35);
  }
  if (operator?.modulation?.warp) {
    calibrateWarpRange(operator.modulation.warp.x, warpRatio * 0.42, 0.18);
    calibrateWarpRange(operator.modulation.warp.z, warpRatio * 0.42, -0.18);
  }
  if (!operator.tectonic || typeof operator.tectonic !== 'object') {
    operator.tectonic = {};
  }
  if (!isFiniteNumber(operator.tectonic.weight) || operator.tectonic.weight < 0.52) {
    operator.tectonic.weight = 0.52;
  }
  operator.tectonic.bias = clampWithinRange(
    (operator.tectonic.bias ?? 0) - 0.12,
    -1,
    1,
  );
}

function retuneDomainWarpOperator(operator, { primaryAmplitude, warpRatio }) {
  const normalizationGain =
    primaryAmplitude > 0
      ? clampWithinRange(
          LEGACY_TFMS_PRIMARY_AMPLITUDE / primaryAmplitude,
          0.01,
          16,
        )
      : 1;
  const amplitude = operator?.envelope?.amplitude;
  if (amplitude) {
    const multiplier = isFiniteNumber(amplitude.multiplier)
      ? amplitude.multiplier
      : 0.32 * normalizationGain;
    const scaledMin = 0.28 * normalizationGain;
    const scaledMax = 0.72 * normalizationGain;
    amplitude.multiplier = clampWithinRange(
      multiplier * 1.25,
      scaledMin,
      scaledMax,
    );
    raiseRangeMaximum(amplitude, primaryAmplitude * 0.8);
    if (!isFiniteNumber(amplitude.min) || amplitude.min < 0) {
      amplitude.min = 0;
    }
  }
  const frequency = operator?.envelope?.frequency;
  if (frequency) {
    const multiplier = isFiniteNumber(frequency.multiplier)
      ? frequency.multiplier
      : 0.65 * normalizationGain;
    const scaledMin = 0.5 * normalizationGain;
    const scaledMax = 0.85 * normalizationGain;
    frequency.multiplier = clampWithinRange(
      multiplier * 0.95,
      scaledMin,
      scaledMax,
    );
  }
  if (operator?.modulation?.warp) {
    const warpStrength = clampWithinRange(warpRatio * 0.28, 0.18, 0.7);
    calibrateWarpRange(
      operator.modulation.warp.x,
      warpStrength,
      warpStrength * 0.55,
    );
    calibrateWarpRange(
      operator.modulation.warp.z,
      warpStrength * 0.9,
      -warpStrength * 0.45,
    );
  }
  if (operator?.modulation?.amplitude) {
    widenSymmetricRange(operator.modulation.amplitude, 1.1);
  }
  if (operator?.modulation?.frequency) {
    widenSymmetricRange(operator.modulation.frequency, 0.9);
  }
}

function widenSymmetricRange(range, span) {
  if (!range || !isFiniteNumber(span)) {
    return;
  }
  const magnitude = Math.abs(span);
  if (magnitude === 0) {
    return;
  }
  if (!isFiniteNumber(range.min) || range.min > -magnitude) {
    range.min = -magnitude;
  }
  if (!isFiniteNumber(range.max) || range.max < magnitude) {
    range.max = magnitude;
  }
}

function raiseRangeMaximum(range, candidateMax) {
  if (!range || !isFiniteNumber(candidateMax)) {
    return;
  }
  if (!isFiniteNumber(range.max) || range.max < candidateMax) {
    range.max = candidateMax;
  }
}

function calibrateWarpRange(range, magnitude, centerBias = 0) {
  if (!range || !isFiniteNumber(magnitude)) {
    return;
  }
  const span = Math.abs(magnitude);
  if (span === 0) {
    return;
  }
  if (!isFiniteNumber(range.min) || range.min > -span) {
    range.min = -span;
  }
  if (!isFiniteNumber(range.max) || range.max < span) {
    range.max = span;
  }
  if (isFiniteNumber(centerBias)) {
    const value = clampWithinRange(centerBias, range.min, range.max);
    range.value = value;
  }
}

function rebalanceBasinMatrix(modulationMatrix) {
  if (!Array.isArray(modulationMatrix)) {
    return;
  }
  modulationMatrix.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    if (entry.sourceId === 'domain-warp' && entry.targetId === 'primary-fbm') {
      entry.gain = clampWithinRange(entry.gain * 1.08, -4, 4);
      if (entry.axis === 'z') {
        entry.bias = clampWithinRange((entry.bias ?? 0) - 0.05, -2, 2);
      }
    } else if (
      entry.sourceId === 'domain-warp' &&
      entry.targetId === 'ridge-noise'
    ) {
      entry.gain = clampWithinRange(entry.gain * 1.12, -4, 4);
    } else if (
      entry.sourceId === 'tectonic-worley' &&
      entry.targetId === 'diffusion-mask'
    ) {
      entry.gain = clampWithinRange(entry.gain * 1.15, -4, 4);
    } else if (
      entry.sourceId === 'tectonic-worley' &&
      entry.targetId === 'anisotropic-banding'
    ) {
      entry.gain = clampWithinRange(entry.gain * 1.08, -4, 4);
    }
  });
}

function clampOperatorCount(value) {
  if (!Number.isFinite(value)) {
    return MAX_OPERATOR_COUNT;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized)) {
    return MAX_OPERATOR_COUNT;
  }
  if (normalized <= 0) {
    return MIN_OPERATOR_COUNT;
  }
  return Math.max(MIN_OPERATOR_COUNT, Math.min(MAX_OPERATOR_COUNT, normalized));
}

function normalizeOperatorCount(available, requested) {
  if (!Number.isFinite(available) || available <= 0) {
    return 0;
  }
  const fallback = Number.isFinite(requested) ? requested : available;
  const normalized = clampOperatorCount(fallback);
  return Math.min(normalized, available);
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

function transformTfmsEnvelope(value, primaryConfig, fallbackConfig = null) {
  const attenuation = getTfmsBaseAttenuation(primaryConfig, fallbackConfig);
  const scaledValue = Number.isFinite(value) ? value * attenuation : 0;
  return clampTfmsEnvelope(scaledValue, primaryConfig, fallbackConfig);
}

function getTfmsBaseAttenuation(primaryConfig, fallbackConfig = null) {
  if (Number.isFinite(primaryConfig?.baseAttenuation)) {
    return primaryConfig.baseAttenuation;
  }
  if (Number.isFinite(fallbackConfig?.baseAttenuation)) {
    return fallbackConfig.baseAttenuation;
  }
  return 1;
}

function clampTfmsEnvelope(value, primaryConfig, fallbackConfig = null) {
  let result = Number.isFinite(value) ? value : 0;
  const source =
    primaryConfig?.clamp && typeof primaryConfig.clamp === 'object'
      ? primaryConfig.clamp
      : fallbackConfig?.clamp && typeof fallbackConfig.clamp === 'object'
        ? fallbackConfig.clamp
        : null;
  if (source) {
    if (Number.isFinite(source.min)) {
      result = Math.max(source.min, result);
    }
    if (Number.isFinite(source.max)) {
      result = Math.min(source.max, result);
    }
  }
  return result;
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

function createBiomeTfmsConfiguration(baseConfig, overrides, normalization = {}) {
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

  if (
    Array.isArray(overrides.operatorWeights) &&
    overrides.operatorWeights.length > 0
  ) {
    if (applyOperatorWeights(clone.operators, overrides.operatorWeights)) {
      mutated = true;
    }
  }

  if (Array.isArray(overrides.operators) && overrides.operators.length > 0) {
    if (
      applyOperatorOverrides(clone.operators, overrides.operators, normalization)
    ) {
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
    baseAttenuation: Number.isFinite(config?.baseAttenuation)
      ? config.baseAttenuation
      : 1,
    clamp: cloneTfmsClamp(config?.clamp),
    operatorCount: normalizeOperatorCount(
      Array.isArray(config?.operators) ? config.operators.length : 0,
      Number.isFinite(config?.operatorCount)
        ? config.operatorCount
        : Array.isArray(config?.operators)
          ? config.operators.length
          : 0,
    ),
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

function cloneTfmsClamp(clamp) {
  if (!clamp || typeof clamp !== 'object') {
    return {};
  }
  const clone = {};
  if (Number.isFinite(clamp.min)) {
    clone.min = clamp.min;
  }
  if (Number.isFinite(clamp.max)) {
    clone.max = clamp.max;
  }
  return clone;
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

function applyOperatorWeights(target, weights) {
  if (!Array.isArray(target) || !Array.isArray(weights)) {
    return false;
  }
  let mutated = false;
  weights.forEach((weight, index) => {
    if (!Number.isFinite(weight)) {
      return;
    }
    if (index < 0 || index >= target.length) {
      return;
    }
    const operator = target[index];
    if (!operator) {
      return;
    }
    if (operator.weight !== weight) {
      operator.weight = weight;
      mutated = true;
    }
  });
  return mutated;
}

function applyOperatorOverrides(target, overrides, normalization = {}) {
  if (!Array.isArray(target) || !Array.isArray(overrides)) {
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
        const existingTransferSource =
          typeof operator.transfer === 'string'
            ? { id: operator.transfer }
            : isPlainObject(operator.transfer)
              ? operator.transfer
              : {};
        const {
          settings: existingTransferSettings,
          ...existingTransfer
        } = isPlainObject(existingTransferSource)
          ? existingTransferSource
          : {};
        const {
          settings: overrideTransferSettings,
          ...transferPatch
        } = override.transfer;
        const nextTransfer = {
          ...existingTransfer,
          ...transferPatch,
        };
        if (
          typeof nextTransfer.id !== 'string' &&
          typeof existingTransfer.id === 'string'
        ) {
          nextTransfer.id = existingTransfer.id;
        }
        if (
          typeof nextTransfer.type !== 'string' &&
          typeof existingTransfer.type === 'string'
        ) {
          nextTransfer.type = existingTransfer.type;
        }
        operator.transfer = nextTransfer;
        const mergedTransferSettings = {};
        if (isPlainObject(existingTransferSettings)) {
          Object.assign(mergedTransferSettings, existingTransferSettings);
        }
        if (isPlainObject(overrideTransferSettings)) {
          Object.assign(mergedTransferSettings, overrideTransferSettings);
        }
        if (Object.keys(mergedTransferSettings).length > 0) {
          operator.transferSettings = {
            ...operator.transferSettings,
            ...mergedTransferSettings,
          };
        }
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
      applyEnvelopeOverride(operator.envelope, override.envelope, normalization)
    ) {
      mutated = true;
    }
    if (
      override.modulation &&
      applyModulationOverride(
        operator.modulation,
        override.modulation,
        normalization,
      )
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

function mergeOperatorWeightArrays(weightSources) {
  if (!Array.isArray(weightSources) || weightSources.length === 0) {
    return null;
  }
  let length = 0;
  weightSources.forEach((weights) => {
    if (Array.isArray(weights) && weights.length > length) {
      length = weights.length;
    }
  });
  if (length === 0) {
    return null;
  }
  const result = new Array(length).fill(undefined);
  weightSources.forEach((weights) => {
    if (!Array.isArray(weights)) {
      return;
    }
    weights.forEach((value, index) => {
      if (Number.isFinite(value)) {
        result[index] = value;
      }
    });
  });
  return result;
}

function mergeTfmsOverrides(schemaOverrides, biomeOverrides) {
  const sources = [];
  if (schemaOverrides && typeof schemaOverrides === 'object') {
    sources.push(schemaOverrides);
  }
  if (biomeOverrides && typeof biomeOverrides === 'object') {
    sources.push(biomeOverrides);
  }
  if (sources.length === 0) {
    return null;
  }
  const result = {};
  let hasData = false;

  const mergeArrayProperty = (key) => {
    const combined = [];
    sources.forEach((source) => {
      if (Array.isArray(source[key])) {
        source[key].forEach((entry) => {
          combined.push({ ...entry });
        });
      }
    });
    if (combined.length > 0) {
      result[key] = combined;
      hasData = true;
    }
  };

  mergeArrayProperty('waveforms');
  mergeArrayProperty('operators');
  mergeArrayProperty('modulationMatrix');

  const mergedWeights = mergeOperatorWeightArrays(
    sources
      .map((source) =>
        Array.isArray(source.operatorWeights) ? source.operatorWeights : null,
      )
      .filter(Boolean),
  );
  if (mergedWeights) {
    result.operatorWeights = mergedWeights;
    hasData = true;
  }

  const transferFunctions = sources.reduce((acc, source) => {
    if (source.transferFunctions && typeof source.transferFunctions === 'object') {
      return { ...acc, ...source.transferFunctions };
    }
    return acc;
  }, {});
  if (Object.keys(transferFunctions).length > 0) {
    result.transferFunctions = transferFunctions;
    hasData = true;
  }

  return hasData ? result : null;
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

function getTerrainAmplitudeScale(normalization) {
  if (!normalization || typeof normalization !== 'object') {
    return 1;
  }
  const direct = normalization.terrainAmplitudeScale;
  if (Number.isFinite(direct)) {
    return direct > 0 ? direct : 0;
  }
  const fallback = normalization.amplitudeScale;
  if (Number.isFinite(fallback)) {
    return fallback > 0 ? fallback : 0;
  }
  return 1;
}

function clampRangeValue(value, range) {
  if (!Number.isFinite(value)) {
    return value;
  }
  let result = value;
  if (Number.isFinite(range?.min)) {
    result = Math.max(range.min, result);
  }
  if (Number.isFinite(range?.max)) {
    result = Math.min(range.max, result);
  }
  return result;
}

function applyScalarRangeOverride(range, override, scale = 1) {
  if (!range || typeof range !== 'object') {
    return false;
  }
  if (override === undefined || override === null) {
    return false;
  }

  if (Number.isFinite(override)) {
    const nextValue = clampRangeValue(override * scale, range);
    if (!Number.isFinite(range.value) || range.value !== nextValue) {
      range.value = nextValue;
      return true;
    }
    return false;
  }

  if (!isPlainObject(override)) {
    return false;
  }

  let mutated = false;

  if (Number.isFinite(override.min) && range.min !== override.min) {
    range.min = override.min;
    mutated = true;
  }
  if (Number.isFinite(override.max) && range.max !== override.max) {
    range.max = override.max;
    mutated = true;
  }
  if (typeof override.baseKey === 'string' && range.baseKey !== override.baseKey) {
    range.baseKey = override.baseKey;
    mutated = true;
  }
  if (Number.isFinite(override.base) && range.base !== override.base) {
    range.base = override.base;
    mutated = true;
  }

  const currentValue = Number.isFinite(range.value)
    ? range.value
    : Number.isFinite(range.base)
      ? range.base
      : 0;

  let nextValue = currentValue;
  let mutatedValue = false;

  if (Number.isFinite(override.multiplier)) {
    const multiplier = override.multiplier;
    nextValue *= multiplier;
    if (multiplier !== 1) {
      mutatedValue = true;
    }
  }

  if (Number.isFinite(override.delta)) {
    const deltaScaled = override.delta * scale;
    nextValue += deltaScaled;
    if (deltaScaled !== 0) {
      mutatedValue = true;
    }
  }

  if (Number.isFinite(override.value)) {
    nextValue = override.value * scale;
    mutatedValue = true;
  }

  if (mutatedValue) {
    const clamped = clampRangeValue(nextValue, range);
    if (!Number.isFinite(range.value) || range.value !== clamped) {
      range.value = clamped;
      mutated = true;
    }
  }

  return mutated;
}

function applyEnvelopeOverride(targetEnvelope, override, normalization = {}) {
  if (!isPlainObject(override)) {
    return false;
  }
  if (!targetEnvelope || typeof targetEnvelope !== 'object') {
    return false;
  }
  const amplitudeScale = getTerrainAmplitudeScale(normalization);
  let mutated = false;
  if (override.amplitude !== undefined) {
    const range = targetEnvelope.amplitude ?? (targetEnvelope.amplitude = { value: 0 });
    if (applyScalarRangeOverride(range, override.amplitude, amplitudeScale)) {
      mutated = true;
    }
  }
  if (override.frequency !== undefined) {
    const range = targetEnvelope.frequency ?? (targetEnvelope.frequency = { value: 0 });
    if (applyScalarRangeOverride(range, override.frequency, 1)) {
      mutated = true;
    }
  }
  if (override.phase && isPlainObject(override.phase)) {
    const phase = targetEnvelope.phase ?? { x: { value: 0 }, z: { value: 0 } };
    targetEnvelope.phase = phase;
    if (applyScalarRangeOverride(phase.x, override.phase.x, 1)) {
      mutated = true;
    }
    if (applyScalarRangeOverride(phase.z, override.phase.z, 1)) {
      mutated = true;
    }
  }
  if (override.warp && isPlainObject(override.warp)) {
    const warp = targetEnvelope.warp ?? { x: { value: 0 }, z: { value: 0 } };
    targetEnvelope.warp = warp;
    if (applyScalarRangeOverride(warp.x, override.warp.x, amplitudeScale)) {
      mutated = true;
    }
    if (applyScalarRangeOverride(warp.z, override.warp.z, amplitudeScale)) {
      mutated = true;
    }
  }
  return mutated;
}

function applyModulationOverride(targetModulation, override, normalization = {}) {
  if (!isPlainObject(override)) {
    return false;
  }
  if (!targetModulation || typeof targetModulation !== 'object') {
    return false;
  }
  const amplitudeScale = getTerrainAmplitudeScale(normalization);
  let mutated = false;
  if (override.amplitude !== undefined) {
    const range = targetModulation.amplitude ?? {
      value: 0,
    };
    targetModulation.amplitude = range;
    if (applyScalarRangeOverride(range, override.amplitude, amplitudeScale)) {
      mutated = true;
    }
  }
  if (override.frequency !== undefined) {
    const range = targetModulation.frequency ?? { value: 0 };
    targetModulation.frequency = range;
    if (applyScalarRangeOverride(range, override.frequency, 1)) {
      mutated = true;
    }
  }
  if (override.phase && isPlainObject(override.phase)) {
    const phase = targetModulation.phase ?? { x: { value: 0 }, z: { value: 0 } };
    targetModulation.phase = phase;
    if (applyScalarRangeOverride(phase.x, override.phase.x, 1)) {
      mutated = true;
    }
    if (applyScalarRangeOverride(phase.z, override.phase.z, 1)) {
      mutated = true;
    }
  }
  if (override.warp && isPlainObject(override.warp)) {
    const warp = targetModulation.warp ?? { x: { value: 0 }, z: { value: 0 } };
    targetModulation.warp = warp;
    if (applyScalarRangeOverride(warp.x, override.warp.x, amplitudeScale)) {
      mutated = true;
    }
    if (applyScalarRangeOverride(warp.z, override.warp.z, amplitudeScale)) {
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

