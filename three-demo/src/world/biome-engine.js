import { ValueNoise2D } from './noise.js';
import { getTfmsSchemaById } from './tfms/schemata.js';
import {
  defaultWorldOptions,
  biomeOptionMetadata,
  getWorldOptions,
  LEGACY_TFMS_PRIMARY_AMPLITUDE,
  LEGACY_TFMS_DETAIL_AMPLITUDE,
} from './world-settings.js';

function loadBiomeModules() {
  let modules;
  let globError = null;
  try {
    modules = import.meta.glob('./biomes/*.json', {
      import: 'default',
      eager: true,
    });
  } catch (error) {
    globError = error;
  }

  if (modules && typeof modules === 'object') {
    return modules;
  }

  if (globalThis.__BIOME_MODULE_MAP__) {
    return globalThis.__BIOME_MODULE_MAP__;
  }

  if (globError) {
    throw globError;
  }

  throw new Error('Biome module map is not available in this environment.');
}

const biomeModuleMap = loadBiomeModules();

/*
 * Biome onboarding checklist:
 * 1. Add the biome JSON definition under ./biomes/ with a unique `id`.
 * 2. Verify the import.meta.glob call above discovers the new file and that
 *    downstream registry wiring includes the biome.
 * 3. Supply voxel object payloads under ../voxel-objects/ so placement logic
 *    can spawn the new content.
 * 4. Register any biome-specific fluids, tints, or palette hooks inside the
 *    ../fluids/ modules.
 * 5. Extend the world generation tests under ../__tests__/ to cover climate
 *    sampling and placement expectations for the new biome.
 */
const rawBiomeDefinitions = Object.values(biomeModuleMap)
  .filter((definition) => definition && typeof definition === 'object')
  .map((definition) => ({ ...definition }))
  .sort((a, b) => {
    const idA = String(a?.id ?? '').toLowerCase();
    const idB = String(b?.id ?? '').toLowerCase();
    if (idA && idB) {
      return idA.localeCompare(idB);
    }
    if (idA) {
      return -1;
    }
    if (idB) {
      return 1;
    }
    return 0;
  });

const NEUTRAL_BASE_PALETTE = {
  grass: '#4a9c47',
  dirt: '#6b4a2f',
  stone: '#8c8c8c',
  sand: '#d7c27a',
  water: '#1f4d8f',
  leaf: '#3f7c35',
  log: '#725032',
  cloud: '#f7f8fb',
};

// Operator capacity mirrors docs/tfms-system.md#operator-slot-selection-1-6-carriers.
const MAX_TERRAIN_OPERATORS = 6;

const SCHEMA_PATCH_SIZE = 96;

const terrainOperatorCache = {
  signature: null,
  map: new Map(),
  count: 0,
  ids: [],
};

function clampOperatorCount(value) {
  if (!Number.isFinite(value)) {
    return MAX_TERRAIN_OPERATORS;
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized)) {
    return MAX_TERRAIN_OPERATORS;
  }
  if (normalized <= 0) {
    return 0;
  }
  return Math.min(MAX_TERRAIN_OPERATORS, normalized);
}

function getTerrainOperatorLookup() {
  const worldOptions = getWorldOptions();
  const tfmsOptions = worldOptions?.terrain?.tfms ?? defaultWorldOptions.terrain.tfms;
  const operators = Array.isArray(tfmsOptions?.operators) ? tfmsOptions.operators : [];
  const available = operators.length;
  const requested = Number.isFinite(tfmsOptions?.operatorCount)
    ? tfmsOptions.operatorCount
    : available;
  const activeCount = Math.min(available, clampOperatorCount(requested));
  const signature = JSON.stringify(
    operators.slice(0, activeCount).map((operator) => [
      typeof operator?.id === 'string' ? operator.id : null,
      typeof operator?.waveformId === 'string' ? operator.waveformId : null,
    ]),
  );
  if (signature !== terrainOperatorCache.signature) {
    const map = new Map();
    const ids = [];
    operators.slice(0, activeCount).forEach((operator, index) => {
      const id = typeof operator?.id === 'string' ? operator.id : null;
      const waveformId = typeof operator?.waveformId === 'string' ? operator.waveformId : null;
      ids.push(id);
      if (id) {
        map.set(id, index);
      }
      if (waveformId) {
        map.set(waveformId, index);
      }
    });
    terrainOperatorCache.signature = signature;
    terrainOperatorCache.map = map;
    terrainOperatorCache.count = activeCount;
    terrainOperatorCache.ids = ids;
  }
  return terrainOperatorCache;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mixValues(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumeric(value) {
  return Number.isFinite(value) ? value : undefined;
}

function normalizeRangeScalarOverride(value) {
  if (Number.isFinite(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  const result = {};
  if (Number.isFinite(value.value)) {
    result.value = value.value;
  }
  if (Number.isFinite(value.delta)) {
    result.delta = value.delta;
  }
  if (Number.isFinite(value.multiplier)) {
    result.multiplier = value.multiplier;
  }
  if (Number.isFinite(value.min)) {
    result.min = value.min;
  }
  if (Number.isFinite(value.max)) {
    result.max = value.max;
  }
  if (typeof value.baseKey === 'string') {
    result.baseKey = value.baseKey;
  }
  if (Number.isFinite(value.base)) {
    result.base = value.base;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function scaleRangeOverrideValue(value, scale = 1) {
  if (value === undefined || value === null) {
    return value;
  }
  if (!Number.isFinite(scale) || scale === 1) {
    return value;
  }
  if (typeof value === 'number') {
    return value * scale;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const scaled = { ...value };
  if (Number.isFinite(scaled.value)) {
    scaled.value *= scale;
  }
  if (Number.isFinite(scaled.delta)) {
    scaled.delta *= scale;
  }
  if (Number.isFinite(scaled.min)) {
    scaled.min *= scale;
  }
  if (Number.isFinite(scaled.max)) {
    scaled.max *= scale;
  }
  if (Number.isFinite(scaled.base)) {
    scaled.base *= scale;
  }
  // Preserve multipliers as dimensionless factors.
  return scaled;
}

function normalizeVectorOverride(value) {
  if (Number.isFinite(value)) {
    return { x: value, z: value };
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  const x = Number.isFinite(value.x) ? value.x : undefined;
  const z = Number.isFinite(value.z) ? value.z : undefined;
  if (x === undefined && z === undefined) {
    return undefined;
  }
  const result = {};
  if (x !== undefined) {
    result.x = x;
  }
  if (z !== undefined) {
    result.z = z;
  }
  return result;
}

function normalizeFmOperatorWeights(definition, operatorLookup = getTerrainOperatorLookup()) {
  const lookup = operatorLookup ?? getTerrainOperatorLookup();
  const operatorCount = lookup?.count ?? 0;
  if (!operatorCount) {
    return null;
  }
  const weights = new Array(operatorCount).fill(undefined);

  const assign = (index, value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    if (index < 0 || index >= operatorCount) {
      return;
    }
    weights[index] = value;
  };

  if (Array.isArray(definition)) {
    definition.forEach((value, index) => {
      assign(index, Number(value));
    });
  } else if (isPlainObject(definition)) {
    Object.entries(definition).forEach(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      if (lookup?.map?.has(key)) {
        assign(lookup.map.get(key), numeric);
        return;
      }
      const parsedIndex = Number.parseInt(key, 10);
      if (Number.isInteger(parsedIndex)) {
        assign(parsedIndex, numeric);
      }
    });
  } else {
    return null;
  }

  return weights.some((value) => value !== undefined) ? weights : null;
}

function normalizeOperatorModulationOverride(value, amplitudeScale = 1) {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const result = {};
  const amplitude = normalizeRangeScalarOverride(value.amplitude);
  const scaledAmplitude = scaleRangeOverrideValue(amplitude, amplitudeScale);
  if (scaledAmplitude !== undefined) {
    result.amplitude = scaledAmplitude;
  }
  const frequency = normalizeNumeric(value.frequency);
  if (frequency !== undefined) {
    result.frequency = frequency;
  }
  const phase = normalizeVectorOverride(value.phase);
  if (phase) {
    result.phase = phase;
  }
  const warp = normalizeVectorOverride(value.warp);
  if (warp) {
    result.warp = warp;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeOperatorEnvelopeOverride(value, amplitudeScale = 1) {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const result = {};
  const amplitude = normalizeRangeScalarOverride(value.amplitude);
  const scaledAmplitude = scaleRangeOverrideValue(amplitude, amplitudeScale);
  if (scaledAmplitude !== undefined) {
    result.amplitude = scaledAmplitude;
  }
  const frequency = normalizeNumeric(value.frequency);
  if (frequency !== undefined) {
    result.frequency = frequency;
  }
  const phase = normalizeVectorOverride(value.phase);
  if (phase) {
    result.phase = phase;
  }
  const warp = normalizeVectorOverride(value.warp ?? value.domainWarp);
  if (warp) {
    result.warp = warp;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeWaveformOverrides(definition) {
  if (Array.isArray(definition)) {
    return definition
      .map((entry) => normalizeWaveformOverrides({ [entry?.id ?? '']: entry })[0])
      .filter(Boolean);
  }
  if (!isPlainObject(definition)) {
    return [];
  }
  return Object.entries(definition)
    .map(([id, value]) => {
      if (!isPlainObject(value)) {
        return null;
      }
      const waveformId = typeof value.id === 'string' ? value.id : id;
      if (!waveformId) {
        return null;
      }
      const override = { id: waveformId };
      if (typeof value.type === 'string') {
        override.type = value.type;
      }
      if (value.seedTemplate || value.seed) {
        const templateSource = value.seedTemplate ?? value.seed;
        const seedTemplate = {};
        if (Number.isFinite(templateSource?.value)) {
          seedTemplate.value = templateSource.value;
        }
        if (Number.isFinite(templateSource?.multiplier)) {
          seedTemplate.multiplier = templateSource.multiplier;
        }
        if (Number.isFinite(templateSource?.offset)) {
          seedTemplate.offset = templateSource.offset;
        }
        if (Object.keys(seedTemplate).length > 0) {
          override.seedTemplate = seedTemplate;
        }
      }
      if (isPlainObject(value.settings)) {
        override.settings = { ...value.settings };
      }
      return Object.keys(override).length > 1 ? override : null;
    })
    .filter(Boolean);
}

function getOperatorAmplitudeNormalization(operatorLookup) {
  const worldOptions = getWorldOptions();
  const terrain = worldOptions?.terrain ?? defaultWorldOptions.terrain ?? {};
  const defaults = defaultWorldOptions.terrain ?? {};
  const fallbackPrimary = Number.isFinite(defaults?.primaryAmplitude)
    ? Math.max(defaults.primaryAmplitude, 1)
    : 1;
  const fallbackDetail = Number.isFinite(defaults?.detailAmplitude)
    ? Math.max(defaults.detailAmplitude, 1)
    : 1;
  const activePrimary = Number.isFinite(terrain?.primaryAmplitude)
    ? Math.max(terrain.primaryAmplitude, 1)
    : fallbackPrimary;
  const activeDetail = Number.isFinite(terrain?.detailAmplitude)
    ? Math.max(terrain.detailAmplitude, 1)
    : fallbackDetail;

  const primaryScale =
    activePrimary > 0
      ? LEGACY_TFMS_PRIMARY_AMPLITUDE / activePrimary
      : 1;
  const detailScale =
    activeDetail > 0 ? LEGACY_TFMS_DETAIL_AMPLITUDE / activeDetail : 1;

  const preset = terrain?.tfms ?? defaults.tfms ?? {};
  const operators = Array.isArray(preset?.operators) ? preset.operators : [];
  const operatorScaleMap = new Map();
  if (Array.isArray(operatorLookup?.ids)) {
    operatorLookup.ids.forEach((operatorId, index) => {
      if (typeof operatorId !== 'string') {
        return;
      }
      const operator = operators[index];
      const baseKey = operator?.envelope?.amplitude?.baseKey;
      let scale = 1;
      if (baseKey === 'primaryAmplitude') {
        scale = primaryScale;
      } else if (baseKey === 'detailAmplitude' || baseKey === 'ridgeStrength') {
        scale = detailScale;
      }
      if (!Number.isFinite(scale) || scale <= 0) {
        scale = 1;
      }
      operatorScaleMap.set(operatorId, scale);
    });
  }

  return {
    primaryScale: Number.isFinite(primaryScale) && primaryScale > 0 ? primaryScale : 1,
    detailScale: Number.isFinite(detailScale) && detailScale > 0 ? detailScale : 1,
    operatorScaleMap,
  };
}

function getOperatorAmplitudeScale(operatorId, normalization) {
  if (!operatorId || !normalization) {
    return 1;
  }
  const { operatorScaleMap } = normalization;
  if (operatorScaleMap && typeof operatorScaleMap.get === 'function') {
    const scale = operatorScaleMap.get(operatorId);
    if (Number.isFinite(scale) && scale > 0) {
      return scale;
    }
  }
  return 1;
}

function normalizeOperatorOverrides(definition, operatorLookup, amplitudeNormalization = null) {
  let source = [];
  if (Array.isArray(definition)) {
    source = definition.filter(isPlainObject);
  } else if (isPlainObject(definition)) {
    source = Object.entries(definition)
      .map(([id, value]) =>
        isPlainObject(value)
          ? {
              id: typeof value.id === 'string' ? value.id : id,
              ...value,
            }
          : null,
      )
      .filter(Boolean);
  }

  const idMap = operatorLookup?.map ?? null;

  return source
    .map((candidate) => {
      const operatorId =
        typeof candidate.id === 'string'
          ? candidate.id
          : typeof candidate.operatorId === 'string'
            ? candidate.operatorId
            : null;
      if (!operatorId) {
        return null;
      }
      if (idMap && !idMap.has(operatorId)) {
        return null;
      }
      const override = { id: operatorId };
      if (typeof candidate.type === 'string') {
        override.type = candidate.type;
      }
      if (typeof candidate.waveformId === 'string') {
        override.waveformId = candidate.waveformId;
      }
      if (Number.isFinite(candidate.weight)) {
        override.weight = candidate.weight;
      }
      if (Number.isFinite(candidate.bias)) {
        override.bias = candidate.bias;
      }
      if (Number.isFinite(candidate.amplitude)) {
        override.amplitude = candidate.amplitude;
      }
      if (Number.isFinite(candidate.frequency)) {
        override.frequency = candidate.frequency;
      }
      const phase = normalizeVectorOverride(candidate.phase);
      if (phase) {
        override.phase = phase;
      }
      const domainWarp = normalizeVectorOverride(
        candidate.domainWarp ?? candidate.warp,
      );
      if (domainWarp) {
        override.domainWarp = domainWarp;
      }
      if (candidate.transfer) {
        if (typeof candidate.transfer === 'string') {
          override.transfer = candidate.transfer;
        } else if (isPlainObject(candidate.transfer)) {
          const transferOverride = {};
          if (typeof candidate.transfer.id === 'string') {
            transferOverride.id = candidate.transfer.id;
          }
          if (typeof candidate.transfer.type === 'string') {
            transferOverride.type = candidate.transfer.type;
          }
          if (Object.keys(transferOverride).length > 0) {
            override.transfer = transferOverride;
          }
        }
      }
      if (isPlainObject(candidate.transferSettings)) {
        override.transferSettings = { ...candidate.transferSettings };
      }
      if (isPlainObject(candidate.settings)) {
        override.settings = { ...candidate.settings };
      }
      if (isPlainObject(candidate.tectonic)) {
        const tectonic = {};
        if (Number.isFinite(candidate.tectonic.weight)) {
          tectonic.weight = candidate.tectonic.weight;
        }
        if (Number.isFinite(candidate.tectonic.bias)) {
          tectonic.bias = candidate.tectonic.bias;
        }
        if (Object.keys(tectonic).length > 0) {
          override.tectonic = tectonic;
        }
      }
      const amplitudeScale = getOperatorAmplitudeScale(
        operatorId,
        amplitudeNormalization,
      );
      const envelope = normalizeOperatorEnvelopeOverride(
        candidate.envelope,
        amplitudeScale,
      );
      if (envelope) {
        override.envelope = envelope;
      }
      const modulation = normalizeOperatorModulationOverride(
        candidate.modulation,
        amplitudeScale,
      );
      if (modulation) {
        override.modulation = modulation;
      }
      if (candidate.seedTemplate || candidate.seed) {
        const templateSource = candidate.seedTemplate ?? candidate.seed;
        const seedTemplate = {};
        if (Number.isFinite(templateSource?.value)) {
          seedTemplate.value = templateSource.value;
        }
        if (Number.isFinite(templateSource?.multiplier)) {
          seedTemplate.multiplier = templateSource.multiplier;
        }
        if (Number.isFinite(templateSource?.offset)) {
          seedTemplate.offset = templateSource.offset;
        }
        if (Object.keys(seedTemplate).length > 0) {
          override.seedTemplate = seedTemplate;
        }
      }
      return Object.keys(override).length > 1 ? override : null;
    })
    .filter(Boolean);
}

function normalizeMatrixOverrides(definition) {
  if (!definition) {
    return [];
  }
  let entries = [];
  if (Array.isArray(definition)) {
    entries = definition.filter(isPlainObject);
  } else if (isPlainObject(definition)) {
    entries = Object.entries(definition).flatMap(([targetId, value]) => {
      if (Array.isArray(value)) {
        return value
          .map((entry) =>
            isPlainObject(entry)
              ? { targetId, ...entry }
              : null,
          )
          .filter(Boolean);
      }
      if (!isPlainObject(value)) {
        return [];
      }
      return Object.entries(value)
        .map(([sourceId, entry]) =>
          isPlainObject(entry)
            ? { sourceId, targetId, ...entry }
            : null,
        )
        .filter(Boolean);
    });
  }

  return entries
    .map((entry) => {
      const sourceId =
        typeof entry.sourceId === 'string'
          ? entry.sourceId
          : typeof entry.source === 'string'
            ? entry.source
            : null;
      const targetId =
        typeof entry.targetId === 'string'
          ? entry.targetId
          : typeof entry.target === 'string'
            ? entry.target
            : null;
      if (!sourceId && !targetId && typeof entry.id !== 'string') {
        return null;
      }
      const override = {};
      if (typeof entry.id === 'string') {
        override.id = entry.id;
      }
      if (sourceId) {
        override.sourceId = sourceId;
      }
      if (targetId) {
        override.targetId = targetId;
      }
      const gain = normalizeNumeric(entry.gain ?? entry.depth);
      if (gain !== undefined) {
        override.gain = gain;
      }
      const bias = normalizeNumeric(entry.bias);
      if (bias !== undefined) {
        override.bias = bias;
      }
      const routing = entry.routing ?? entry.mode;
      if (typeof routing === 'string') {
        override.routing = routing;
      }
      const channel = entry.channel ?? entry.modulationChannel;
      if (typeof channel === 'string') {
        override.channel = channel;
      }
      const axis = entry.axis ?? entry.component;
      if (typeof axis === 'string') {
        override.axis = axis;
      }
      return Object.keys(override).length > 0 ? override : null;
    })
    .filter(Boolean);
}

function hashString(value) {
  if (typeof value !== 'string') {
    return 0;
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pseudoRandomFromSeed(seed) {
  const sine = Math.sin(seed) * 43758.5453123;
  return sine - Math.floor(sine);
}

function createSchemaPoolEntry(schema, weight = 1, blendOverride = undefined) {
  return {
    schema,
    weight: Math.max(0, Number.isFinite(weight) ? weight : 1),
    blend: Number.isFinite(blendOverride) ? clamp01(blendOverride) : undefined,
  };
}

// See docs/tfms-system.md#assigning-schema-compendia-to-biomes for how schema
// pools are declared and scored.
function normalizeTfmsSchemaPool(definition) {
  if (!definition) {
    return null;
  }
  const source = Array.isArray(definition) ? definition : [definition];
  const entries = source
    .map((candidate) => {
      if (!candidate) {
        return null;
      }
      if (typeof candidate === 'string') {
        const schema = getTfmsSchemaById(candidate);
        return schema ? createSchemaPoolEntry(schema) : null;
      }
      if (typeof candidate !== 'object') {
        return null;
      }
      const schemaId =
        typeof candidate.id === 'string'
          ? candidate.id
          : typeof candidate.schemaId === 'string'
            ? candidate.schemaId
            : typeof candidate.schema === 'string'
              ? candidate.schema
              : typeof candidate.schema?.id === 'string'
                ? candidate.schema.id
                : null;
      const schema = schemaId ? getTfmsSchemaById(schemaId) : null;
      if (!schema) {
        return null;
      }
      const weightValue = Number(candidate.weight);
      const blendValue = Number(candidate.blend ?? candidate.schemaBlend);
      return createSchemaPoolEntry(schema, weightValue, blendValue);
    })
    .filter(Boolean);
  return entries.length > 0 ? entries : null;
}

function computeSchemaClimateAffinity(value, descriptor) {
  if (!Number.isFinite(value) || !descriptor || typeof descriptor !== 'object') {
    return 1;
  }
  const min = Number.isFinite(descriptor.min) ? descriptor.min : 0;
  const max = Number.isFinite(descriptor.max) ? descriptor.max : 1;
  const ideal =
    Number.isFinite(descriptor.ideal) ? descriptor.ideal : (min + max) / 2;
  if (max <= min) {
    return 1;
  }
  if (value < min) {
    const span = Math.max(1e-5, ideal - min);
    return Math.max(0.05, 1 - (min - value) / (span || 1));
  }
  if (value > max) {
    const span = Math.max(1e-5, max - ideal);
    return Math.max(0.05, 1 - (value - max) / (span || 1));
  }
  const radius = Math.max(1e-5, (max - min) / 2);
  const distance = Math.abs(value - ideal);
  return 0.5 + 0.5 * Math.max(0, 1 - distance / radius);
}

function computeSchemaWeight(entry, climate, biome) {
  if (!entry?.schema) {
    return 0;
  }
  const baseWeight = Math.max(0, Number.isFinite(entry.weight) ? entry.weight : 1);
  if (baseWeight === 0) {
    return 0;
  }
  let weight = baseWeight;
  const biomeTags = new Set(Array.isArray(biome?.tags) ? biome.tags : []);
  const schema = entry.schema;
  const schemaBiomes = schema.biomes ?? {};
  const preferredIds = Array.isArray(schemaBiomes.ids) ? schemaBiomes.ids : [];
  if (preferredIds.length > 0) {
    weight *= preferredIds.includes(biome?.id) ? 1.35 : 0.85;
  }
  const preferredTags = Array.isArray(schemaBiomes.tags) ? schemaBiomes.tags : [];
  if (preferredTags.length > 0) {
    const matches = preferredTags.some((tag) => biomeTags.has(tag));
    weight *= matches ? 1.25 : 0.9;
  }
  const adjacency = schema.adjacency ?? {};
  const adjacencyPrefer = Array.isArray(adjacency.preferTags)
    ? adjacency.preferTags
    : [];
  if (adjacencyPrefer.length > 0) {
    if (adjacencyPrefer.some((tag) => biomeTags.has(tag))) {
      weight *= 1.15;
    }
  }
  const adjacencyAvoid = Array.isArray(adjacency.avoidTags)
    ? adjacency.avoidTags
    : [];
  if (adjacencyAvoid.length > 0) {
    if (adjacencyAvoid.some((tag) => biomeTags.has(tag))) {
      weight *= 0.6;
    }
  }
  const temperatureWeight = computeSchemaClimateAffinity(
    climate?.temperature,
    schema.climate?.temperature,
  );
  const moistureWeight = computeSchemaClimateAffinity(
    climate?.moisture,
    schema.climate?.moisture,
  );
  weight *= temperatureWeight * moistureWeight;
  return weight;
}

function selectSchemaCandidate(pool, climate, biome, randomValue) {
  if (!Array.isArray(pool) || pool.length === 0) {
    return null;
  }
  const weighted = pool
    .map((entry) => ({
      entry,
      weight: computeSchemaWeight(entry, climate, biome),
    }))
    .filter((candidate) => candidate.weight > 0);
  if (weighted.length === 0) {
    return pool.reduce((best, current) => {
      if (!best) {
        return current;
      }
      return (current.weight ?? 0) > (best.weight ?? 0) ? current : best;
    }, null);
  }
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) {
    return weighted[0].entry;
  }
  const target = Math.max(0, Math.min(1, randomValue ?? 0)) * total;
  let accumulator = 0;
  for (let index = 0; index < weighted.length; index += 1) {
    accumulator += weighted[index].weight;
    if (accumulator >= target) {
      return weighted[index].entry;
    }
  }
  return weighted[weighted.length - 1].entry;
}

/**
 * Normalise biome TFMS overrides and blend weights.
 *
 * Profiles inherit the six-operator attenuation stack from
 * docs/tfms-system.md#default-operator-catalogue and only replace the fields
 * provided in biome JSON. The helper clamps the optional `blend` scalar to
 * `[0,1]`, merges waveform/operator/matrix overrides, and leaves unspecified
 * weights untouched so designers can align JSON payloads with the
 * docs/tfms-system.md#biome-override-workflow guidance.
 *
 * @param {object} definition
 */
function normalizeBiomeFmProfile(definition) {
  if (!isPlainObject(definition)) {
    return null;
  }

  const blendSource =
    Number(definition.blendStrength ?? definition.blend ?? definition.mix ?? 1);
  const blend = clamp01(Number.isFinite(blendSource) ? blendSource : 1);

  const overrides = {};
  const operatorLookup = getTerrainOperatorLookup();
  const amplitudeNormalization = getOperatorAmplitudeNormalization(operatorLookup);

  const waveformOverrides = normalizeWaveformOverrides(definition.waveforms);
  if (waveformOverrides.length > 0) {
    overrides.waveforms = waveformOverrides;
  }

  const operatorOverrides = normalizeOperatorOverrides(
    definition.operators,
    operatorLookup,
    amplitudeNormalization,
  );
  if (operatorOverrides.length > 0) {
    overrides.operators = operatorOverrides;
  }

  const operatorWeights = normalizeFmOperatorWeights(
    definition.operatorWeights,
    operatorLookup,
  );
  if (operatorWeights) {
    overrides.operatorWeights = operatorWeights;
  }

  const matrixOverrides = normalizeMatrixOverrides(
    definition.modulationMatrix ?? definition.matrix,
  );
  if (matrixOverrides.length > 0) {
    overrides.modulationMatrix = matrixOverrides;
  }

  if (isPlainObject(definition.transferFunctions)) {
    const transferFunctions = Object.fromEntries(
      Object.entries(definition.transferFunctions).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string',
      ),
    );
    if (Object.keys(transferFunctions).length > 0) {
      overrides.transferFunctions = transferFunctions;
    }
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  const schemaDefinition =
    definition.schemaPool ??
    definition.schema ??
    definition.schemata ??
    definition.schemas ??
    null;
  const schemaPool = normalizeTfmsSchemaPool(schemaDefinition);

  if (!hasOverrides && !schemaPool) {
    return null;
  }

  return {
    blend,
    ...(hasOverrides ? { overrides } : {}),
    ...(schemaPool ? { schemaPool } : {}),
  };
}

function normalizeMultiplier(value, fallback = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function resolveBiomeOption(option, value) {
  const defaults = defaultWorldOptions.biomes;
  const fallback = defaults[option];
  const metadata = biomeOptionMetadata[option] ?? {};
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const min = Number.isFinite(metadata.min) ? metadata.min : Number.NEGATIVE_INFINITY;
  const max = Number.isFinite(metadata.max) ? metadata.max : Number.POSITIVE_INFINITY;
  const clamped = Math.min(Math.max(value, min), max);
  if (option === 'scale' && clamped === 0) {
    return fallback;
  }
  return clamped;
}

function normalizeCategoryMultipliers(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(definition)
      .filter((entry) => typeof entry[0] === 'string')
      .map(([key, value]) => [key, normalizeMultiplier(value, 1)]),
  );
}

function cloneShaderMetadata(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return { ...value };
  }
}

const DEFAULT_WEATHER_DURATION = { min: 180, max: 420 };
const MIN_WEATHER_DURATION = 30;

function normaliseWeatherDuration(duration, fallback = DEFAULT_WEATHER_DURATION) {
  const fallbackMin = Number.isFinite(fallback?.min)
    ? fallback.min
    : DEFAULT_WEATHER_DURATION.min;
  const fallbackMax = Number.isFinite(fallback?.max)
    ? fallback.max
    : DEFAULT_WEATHER_DURATION.max;
  const rawMin = Number.isFinite(duration?.min) ? duration.min : fallbackMin;
  const rawMax = Number.isFinite(duration?.max) ? duration.max : fallbackMax;
  const min = Math.max(MIN_WEATHER_DURATION, rawMin);
  const max = Math.max(min, rawMax);
  return { min, max };
}

function normaliseBiomeWeather(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const candidatesSource = Array.isArray(definition.candidates)
    ? definition.candidates
    : Array.isArray(definition)
    ? definition
    : [];
  const defaultDuration = normaliseWeatherDuration(definition.defaultDuration);

  const candidates = candidatesSource
    .filter((candidate) => candidate && typeof candidate.id === 'string')
    .map((candidate) => {
      const weightValue = Number(candidate.weight);
      const weight = Number.isFinite(weightValue) ? Math.max(0, weightValue) : 1;
      const duration = normaliseWeatherDuration(candidate.duration, defaultDuration);
      return {
        id: String(candidate.id),
        weight,
        duration,
      };
    })
    .filter((candidate) => candidate.weight > 0);

  if (candidates.length === 0) {
    return null;
  }

  return {
    candidates,
    defaultDuration,
  };
}

export function createBiomeEngine({
  THREE,
  seed = defaultWorldOptions.seedHash,
  biomeOptions = null,
} = {}) {
  if (!THREE) {
    throw new Error('createBiomeEngine requires a THREE instance');
  }

  const temperatureNoise = new ValueNoise2D(seed * 1.37 + 97);
  const temperatureDetailNoise = new ValueNoise2D(seed * 1.91 + 227);
  const moistureNoise = new ValueNoise2D(seed * 1.51 + 157);
  const moistureDetailNoise = new ValueNoise2D(seed * 2.03 + 311);
  const varianceNoise = new ValueNoise2D(seed * 1.73 + 443);
  const oceanProvinceNoise = new ValueNoise2D(seed * 2.17 + 593);
  const oceanProvinceDetailNoise = new ValueNoise2D(seed * 2.43 + 811);

  const schemaSelectionSeed = seed * 1.97 + 131;
  const schemaCache = new Map();

  const climateScale = resolveBiomeOption('scale', biomeOptions?.scale);
  const detailMultiplier = resolveBiomeOption(
    'detailMultiplier',
    biomeOptions?.detailMultiplier,
  );
  const moistureDetailMultiplier = resolveBiomeOption(
    'moistureDetailMultiplier',
    biomeOptions?.moistureDetailMultiplier,
  );
  const varianceMultiplier = resolveBiomeOption(
    'varianceMultiplier',
    biomeOptions?.varianceMultiplier,
  );
  const variationStrength = resolveBiomeOption(
    'variationStrength',
    biomeOptions?.variationStrength,
  );
  const uniformity = clamp01(
    resolveBiomeOption('uniformity', biomeOptions?.uniformity),
  );
  const weightExponent = Math.max(
    0,
    resolveBiomeOption('weightExponent', biomeOptions?.weightExponent),
  );
  const oceanProvinceScale = Math.max(
    0.0001,
    resolveBiomeOption('oceanProvinceScale', biomeOptions?.oceanProvinceScale),
  );
  const oceanWeightBias = resolveBiomeOption(
    'oceanWeightBias',
    biomeOptions?.oceanWeightBias,
  );

  const detailScale = climateScale * detailMultiplier;
  const varianceScale = climateScale * varianceMultiplier;
  const uniformityWeight = uniformity * uniformity;
  const weightDenominator = 1 + uniformityWeight;
  const climateInfluence = weightDenominator > 0 ? 1 / weightDenominator : 1;
  const uniformityInfluence = weightDenominator > 0 ? uniformityWeight / weightDenominator : 0;

  const defaultColor = new THREE.Color(0xffffff);
  const basePaletteColors = Object.fromEntries(
    Object.entries(NEUTRAL_BASE_PALETTE).map(([type, hex]) => [
      type,
      new THREE.Color(hex),
    ]),
  );

  function sampleOceanProvince(x, z) {
    if (!Number.isFinite(oceanProvinceScale) || oceanProvinceScale <= 0) {
      return 0.5;
    }
    const scale = oceanProvinceScale;
    const base = oceanProvinceNoise.noise(x * scale, z * scale);
    const detail = oceanProvinceDetailNoise.noise(
      x * scale * 1.97 + 37.1,
      z * scale * 2.13 + 61.7,
    );
    return clamp01(base * 0.78 + detail * 0.22);
  }

  function getSchemaCacheKey(biomeId, x, z) {
    if (!biomeId) {
      return null;
    }
    const cellX = Math.floor(x / SCHEMA_PATCH_SIZE);
    const cellZ = Math.floor(z / SCHEMA_PATCH_SIZE);
    return `${biomeId}:${cellX}:${cellZ}`;
  }

  function resolveSchemaForSample(biome, climate, x, z) {
    if (!biome?.tfmsProfile?.schemaPool?.length) {
      return null;
    }
    const cacheKey = getSchemaCacheKey(biome.id, x, z);
    if (cacheKey && schemaCache.has(cacheKey)) {
      return schemaCache.get(cacheKey);
    }
    const cellX = Math.floor(x / SCHEMA_PATCH_SIZE);
    const cellZ = Math.floor(z / SCHEMA_PATCH_SIZE);
    const randomSeed =
      schemaSelectionSeed +
      cellX * 374761.21 +
      cellZ * 668265.13 +
      hashString(biome.id) * 0.137;
    const randomValue = pseudoRandomFromSeed(randomSeed);
    const selection = selectSchemaCandidate(
      biome.tfmsProfile.schemaPool,
      climate,
      biome,
      randomValue,
    );
    let resolved = null;
    if (selection?.schema) {
      resolved = {
        id: selection.schema.id,
        label: selection.schema.label,
        tags: selection.schema.tags,
        climate: selection.schema.climate,
        adjacency: selection.schema.adjacency,
        overrides: selection.schema.overrides,
        blend:
          selection.blend ??
          selection.schema.blend ??
          undefined,
      };
    }
    if (cacheKey) {
      schemaCache.set(cacheKey, resolved);
    }
    return resolved;
  }

  if (rawBiomeDefinitions.length === 0) {
    throw new Error('No biome JSON definitions were discovered.');
  }

  const biomes = rawBiomeDefinitions.map((definition, index) => {
    const rawTags = Array.isArray(definition.tags)
      ? definition.tags.filter((tag) => typeof tag === 'string')
      : [];
    const normalizedTagSet = new Set(
      rawTags
        .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
        .filter((tag) => tag.length > 0),
    );
    const isOceanic =
      normalizedTagSet.has('ocean') ||
      normalizedTagSet.has('oceanic') ||
      normalizedTagSet.has('aquatic');
    const isShoreline =
      normalizedTagSet.has('shore') ||
      normalizedTagSet.has('tidal') ||
      normalizedTagSet.has('coastal');
    const palette = { ...NEUTRAL_BASE_PALETTE, ...(definition.palette ?? {}) };
    const paletteColors = Object.fromEntries(
      Object.entries(palette).map(([type, hex]) => {
        const targetColor = new THREE.Color(hex);
        const baseColor = basePaletteColors[type] ?? defaultColor;
        const tint = new THREE.Color(
          baseColor.r === 0 ? 1 : targetColor.r / baseColor.r,
          baseColor.g === 0 ? 1 : targetColor.g / baseColor.g,
          baseColor.b === 0 ? 1 : targetColor.b / baseColor.b,
        );
        return [type, tint];
      }),
    );

    const terrainDefinition = definition.terrain ?? {};
    const treeHeight = terrainDefinition.treeHeight ?? {};

    const objectDensityMultiplier = normalizeMultiplier(
      terrainDefinition.objectDensityMultiplier,
      1,
    );
    const objectDensityMultipliers = normalizeCategoryMultipliers(
      terrainDefinition.objectDensityMultipliers,
    );

    const shaderDefinition = definition.shader ?? {};

    return {
      id: definition.id ?? `biome_${index}`,
      label: definition.label ?? definition.id ?? `Biome ${index + 1}`,
      tags: rawTags,
      tagSet: normalizedTagSet,
      isOceanic,
      isShoreline,
      climate: {
        temperature: clamp01(definition.climate?.temperature ?? 0.5),
        moisture: clamp01(definition.climate?.moisture ?? 0.5),
        weight: Math.max(0.001, definition.climate?.weight ?? 1),
      },
      palette,
      paletteColors,
      terrain: {
        surfaceBlock: terrainDefinition.surfaceBlock ?? 'grass',
        shoreBlock: terrainDefinition.shoreBlock ?? 'sand',
        subSurfaceBlock: terrainDefinition.subSurfaceBlock ?? 'dirt',
        subSurfaceDepth: Math.max(1, Math.floor(terrainDefinition.subSurfaceDepth ?? 4)),
        deepBlock: terrainDefinition.deepBlock ?? 'stone',
        treeDensity: clamp01(terrainDefinition.treeDensity ?? 0.08),
        shrubChance: clamp01(terrainDefinition.shrubChance ?? 0.02),
        flowerChance: clamp01(terrainDefinition.flowerChance ?? 0.01),
        rockChance: clamp01(terrainDefinition.rockChance ?? 0),
        fungiChance: clamp01(terrainDefinition.fungiChance ?? 0),
        waterPlantChance: clamp01(terrainDefinition.waterPlantChance ?? 0),
        structureChance: clamp01(terrainDefinition.structureChance ?? 0),
        objectDensityMultiplier,
        objectDensityMultipliers,
        treeHeight: {
          min: Math.max(1, Math.floor(treeHeight.min ?? 3)),
          max: Math.max(Math.floor(treeHeight.max ?? 6), Math.floor(treeHeight.min ?? 3)),
        },
        heightOffset: terrainDefinition.heightOffset ?? 0,
      },
      shader: {
        fogColor: new THREE.Color(shaderDefinition.fogColor ?? '#a9d6ff'),
        tintColor: new THREE.Color(shaderDefinition.tintColor ?? '#ffffff'),
        tintStrength: clamp01(shaderDefinition.tintStrength ?? 0),
        effects: cloneShaderMetadata(shaderDefinition.effects),
        hazards: cloneShaderMetadata(shaderDefinition.hazards),
        references: cloneShaderMetadata(shaderDefinition.references),
      },
      weather: normaliseBiomeWeather(definition.weather),
      tfmsProfile: normalizeBiomeFmProfile(definition.tfmsProfile),
    };
  });

  function sampleNoisePair(noiseA, noiseB, x, z, baseScale, detailScale) {
    const base = noiseA.noise(x * baseScale, z * baseScale);
    const detail = noiseB.noise(x * detailScale, z * detailScale);
    return clamp01(mixValues(base, detail, 0.35));
  }

  function sampleClimate(x, z) {
    const temperature = sampleNoisePair(
      temperatureNoise,
      temperatureDetailNoise,
      x,
      z,
      climateScale,
      detailScale,
    );
    const moisture = sampleNoisePair(
      moistureNoise,
      moistureDetailNoise,
      x,
      z,
      climateScale,
      detailScale * moistureDetailMultiplier,
    );

    return { temperature, moisture };
  }

  function selectBiome(climate, x, z) {
    const oceanProvince = sampleOceanProvince(x, z);
    const oceanDelta = 0.5 - oceanProvince;
    const oceanDepth = clamp01(oceanDelta * 2);
    const continentality = clamp01(-oceanDelta * 2);
    const shorelineAffinity = clamp01(1 - Math.abs(oceanDelta) * 4);
    const biasFactor = oceanWeightBias * 0.6;
    let selected = biomes[0];
    let bestScore = Number.POSITIVE_INFINITY;

    biomes.forEach((biome, index) => {
      const dx = climate.temperature - biome.climate.temperature;
      const dy = climate.moisture - biome.climate.moisture;
      const weightScale = Math.max(
        0.001,
        Math.pow(biome.climate.weight, weightExponent),
      );
      const baseDistance = Math.sqrt(dx * dx + dy * dy) / weightScale;
      const variationNoiseSample = varianceNoise.noise(
        x * varianceScale + index * 17.13,
        z * varianceScale + index * 31.17,
      );
      const variationCenter = variationNoiseSample - 0.5;
      const variationFactor = Math.max(
        0,
        1 + variationCenter * variationStrength * climateInfluence,
      );
      const weightedDistance = baseDistance * variationFactor;
      const climateScore = weightedDistance * climateInfluence;
      const uniformJitter =
        uniformityInfluence > 0
          ? (() => {
              const jitterHigh = varianceNoise.noise(
                x * varianceScale * 0.62 + index * 23.71,
                z * varianceScale * 0.59 + index * 37.11,
              );
              const jitterLow = varianceNoise.noise(
                x * varianceScale * 0.18 + index * 5.17,
                z * varianceScale * 0.21 + index * 7.91,
              );
              const jitterSample = mixValues(jitterHigh, jitterLow, 0.4);
              const jitterEnvelope = climateScore * climateScore;
              return (0.5 - jitterSample) * jitterEnvelope * uniformityInfluence * 2;
            })()
          : 0;
      let adjustedDistance = climateScore + uniformJitter;
      if (biasFactor !== 0) {
        if (biome.isOceanic) {
          const oceanPull = oceanDepth * 0.85 + shorelineAffinity * 0.2;
          adjustedDistance -= biasFactor * oceanPull;
        } else if (biome.isShoreline) {
          const shorePull =
            shorelineAffinity * 0.9 +
            (oceanDepth > 0 ? oceanDepth * 0.35 : continentality * 0.25);
          adjustedDistance -= biasFactor * shorePull * 0.65;
        } else {
          const landPenalty = oceanDepth * 0.6 + shorelineAffinity * 0.2;
          if (landPenalty !== 0) {
            adjustedDistance += biasFactor * landPenalty;
          }
        }
      }
      if (adjustedDistance < bestScore) {
        bestScore = adjustedDistance;
        selected = biome;
      }
    });

    return {
      biome: selected,
      score: bestScore,
      oceanProvince,
      oceanDelta,
      oceanDepth,
      continentality,
      shorelineAffinity,
    };
  }

  function getBiomeAt(x, z) {
    const climate = sampleClimate(x, z);
    const selection = selectBiome(climate, x, z);
    const schema = resolveSchemaForSample(selection.biome, climate, x, z);
    const oceanProvince = selection.oceanProvince ?? 0.5;
    const oceanDelta = selection.oceanDelta ?? 0;
    const oceanDepth = selection.oceanDepth ?? clamp01(oceanDelta * 2);
    const continentality = selection.continentality ?? clamp01(-oceanDelta * 2);
    const shorelineAffinity = selection.shorelineAffinity ?? clamp01(1 - Math.abs(oceanDelta) * 4);
    return {
      biome: selection.biome,
      climate,
      score: selection.score,
      tfmsSchema: schema,
      ocean: {
        province: oceanProvince,
        delta: oceanDelta,
        depth: oceanDepth,
        continentality,
        shoreline: shorelineAffinity,
      },
      oceanProvince,
      oceanDelta,
      oceanDepth,
      continentality,
      shorelineAffinity,
    };
  }

  function getBlockColor(biome, type) {
    if (!biome?.paletteColors) {
      return defaultColor;
    }
    return biome.paletteColors[type] ?? defaultColor;
  }

  return {
    biomes,
    sampleClimate,
    sampleOceanProvince,
    getBiomeAt,
    getBlockColor,
    getDefaultBlockColor() {
      return defaultColor;
    },
    dispose() {
      biomes.length = 0;
      schemaCache.clear();
    },
  };
}
