const RAW_TFMS_SCHEMATA = [
  {
    id: 'temperate-canopy',
    label: 'Temperate Canopy Weave',
    tags: ['forest', 'temperate', 'canopy'],
    biomes: {
      ids: ['temperate_forest'],
      tags: ['temperate', 'leafy'],
    },
    climate: {
      temperature: { min: 0.45, max: 0.72, ideal: 0.6 },
      moisture: { min: 0.58, max: 0.92, ideal: 0.76 },
    },
    adjacency: {
      preferTags: ['temperate', 'balanced'],
      avoidTags: ['arid', 'desert'],
    },
    blend: 0.85,
    overrides: {
      operatorWeights: [1.08, 0.68, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.12,
          modulation: { amplitude: 0.22 },
        },
        {
          id: 'diffusion-mask',
          weight: 0.62,
          transfer: { id: 'tanh' },
          modulation: { amplitude: 0.3 },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: 0.48 },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.62,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.42,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.82,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.8,
        },
      ],
    },
  },
  {
    id: 'temperate-terraces',
    label: 'Temperate Terraced Shelves',
    tags: ['forest', 'temperate', 'terraced'],
    biomes: {
      ids: ['temperate_forest', 'aurora_shard_expanse'],
      tags: ['temperate', 'upland'],
    },
    climate: {
      temperature: { min: 0.38, max: 0.64, ideal: 0.5 },
      moisture: { min: 0.42, max: 0.75, ideal: 0.55 },
    },
    adjacency: {
      preferTags: ['mountain', 'upland'],
      avoidTags: ['fungal'],
    },
    blend: 0.75,
    overrides: {
      operatorWeights: [0.92, 0.85, 0.65],
      operators: [
        {
          id: 'primary-fbm',
          bias: -0.18,
          envelope: { amplitude: 0.92 },
        },
        {
          id: 'ridge-noise',
          weight: 0.88,
          modulation: { amplitude: 0.2 },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: 0.18 },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.28,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.22,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.52,
        },
      ],
    },
  },
  {
    id: 'temperate-bog',
    label: 'Temperate Bog Basins',
    tags: ['forest', 'wetland', 'temperate'],
    biomes: {
      ids: ['noctilucent_fungus_glade'],
      tags: ['fungal', 'temperate'],
    },
    climate: {
      temperature: { min: 0.35, max: 0.6, ideal: 0.48 },
      moisture: { min: 0.65, max: 0.95, ideal: 0.82 },
    },
    adjacency: {
      preferTags: ['fungal', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.75, 0.6, 0.4],
      operators: [
        {
          id: 'diffusion-mask',
          weight: 0.7,
          transfer: { id: 'smoothstep' },
          modulation: { amplitude: 0.45 },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.35,
          modulation: { frequency: -0.15 },
          envelope: { warp: { x: 16, z: -12 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: 0.5 },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.35,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.65,
        },
        {
          id: 'domain-warp->ridge-noise:domain-z',
          gain: 0.52,
        },
      ],
    },
  },
];

function freezeVector(vector) {
  if (!vector || typeof vector !== 'object') {
    return undefined;
  }
  const clone = {};
  if (Number.isFinite(vector.x)) {
    clone.x = vector.x;
  }
  if (Number.isFinite(vector.z)) {
    clone.z = vector.z;
  }
  return Object.freeze(clone);
}

function freezeOperatorOverride(override) {
  const clone = { id: override.id };
  if (typeof override.type === 'string') {
    clone.type = override.type;
  }
  if (Number.isFinite(override.weight)) {
    clone.weight = override.weight;
  }
  if (Number.isFinite(override.bias)) {
    clone.bias = override.bias;
  }
  if (Number.isFinite(override.amplitude)) {
    clone.amplitude = override.amplitude;
  }
  if (Number.isFinite(override.frequency)) {
    clone.frequency = override.frequency;
  }
  if (override.modulation && typeof override.modulation === 'object') {
    clone.modulation = Object.freeze({ ...override.modulation });
  }
  if (override.envelope && typeof override.envelope === 'object') {
    const envelope = {};
    if (Number.isFinite(override.envelope.amplitude)) {
      envelope.amplitude = override.envelope.amplitude;
    }
    if (Number.isFinite(override.envelope.frequency)) {
      envelope.frequency = override.envelope.frequency;
    }
    const warp = freezeVector(override.envelope.warp);
    if (warp) {
      envelope.warp = warp;
    }
    clone.envelope = Object.freeze(envelope);
  }
  if (override.domainWarp) {
    const domainWarp = freezeVector(override.domainWarp);
    if (domainWarp) {
      clone.domainWarp = domainWarp;
    }
  }
  if (override.transfer && typeof override.transfer === 'object') {
    clone.transfer = Object.freeze({ ...override.transfer });
  }
  return Object.freeze(clone);
}

function freezeMatrixOverride(override) {
  const clone = {};
  if (typeof override.id === 'string') {
    clone.id = override.id;
  }
  if (typeof override.sourceId === 'string') {
    clone.sourceId = override.sourceId;
  }
  if (typeof override.targetId === 'string') {
    clone.targetId = override.targetId;
  }
  if (typeof override.routing === 'string') {
    clone.routing = override.routing;
  }
  if (typeof override.channel === 'string') {
    clone.channel = override.channel;
  }
  if (typeof override.axis === 'string') {
    clone.axis = override.axis;
  }
  if (Number.isFinite(override.gain)) {
    clone.gain = override.gain;
  }
  if (Number.isFinite(override.bias)) {
    clone.bias = override.bias;
  }
  return Object.freeze(clone);
}

function freezeOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return Object.freeze({});
  }
  const result = {};
  if (Array.isArray(overrides.waveforms) && overrides.waveforms.length > 0) {
    result.waveforms = Object.freeze(
      overrides.waveforms.map((override) => Object.freeze({ ...override })),
    );
  }
  if (Array.isArray(overrides.operators) && overrides.operators.length > 0) {
    result.operators = Object.freeze(
      overrides.operators.map((override) => freezeOperatorOverride(override)),
    );
  }
  if (
    Array.isArray(overrides.modulationMatrix) &&
    overrides.modulationMatrix.length > 0
  ) {
    result.modulationMatrix = Object.freeze(
      overrides.modulationMatrix.map((override) =>
        freezeMatrixOverride(override),
      ),
    );
  }
  if (
    Array.isArray(overrides.operatorWeights) &&
    overrides.operatorWeights.length > 0
  ) {
    result.operatorWeights = Object.freeze([...overrides.operatorWeights]);
  }
  if (
    overrides.transferFunctions &&
    typeof overrides.transferFunctions === 'object'
  ) {
    result.transferFunctions = Object.freeze({
      ...overrides.transferFunctions,
    });
  }
  return Object.freeze(result);
}

function freezeSchema(schema) {
  return Object.freeze({
    id: schema.id,
    label: schema.label,
    tags: Object.freeze([...(schema.tags ?? [])]),
    biomes: schema.biomes
      ? Object.freeze({
          ids: Object.freeze([...(schema.biomes.ids ?? [])]),
          tags: Object.freeze([...(schema.biomes.tags ?? [])]),
        })
      : Object.freeze({ ids: Object.freeze([]), tags: Object.freeze([]) }),
    climate: schema.climate
      ? Object.freeze({
          temperature: Object.freeze({ ...(schema.climate.temperature ?? {}) }),
          moisture: Object.freeze({ ...(schema.climate.moisture ?? {}) }),
        })
      : Object.freeze({
          temperature: Object.freeze({}),
          moisture: Object.freeze({}),
        }),
    adjacency: schema.adjacency
      ? Object.freeze({
          preferTags: Object.freeze([...(schema.adjacency.preferTags ?? [])]),
          avoidTags: Object.freeze([...(schema.adjacency.avoidTags ?? [])]),
          preferBiomes: Object.freeze([...(schema.adjacency.preferBiomes ?? [])]),
          avoidBiomes: Object.freeze([...(schema.adjacency.avoidBiomes ?? [])]),
        })
      : Object.freeze({
          preferTags: Object.freeze([]),
          avoidTags: Object.freeze([]),
          preferBiomes: Object.freeze([]),
          avoidBiomes: Object.freeze([]),
        }),
    blend: Number.isFinite(schema.blend) ? schema.blend : undefined,
    overrides: freezeOverrides(schema.overrides),
  });
}

export const TFMS_SCHEMATA = Object.freeze(
  RAW_TFMS_SCHEMATA.map((schema) => freezeSchema(schema)),
);

const SCHEMA_INDEX = new Map();
TFMS_SCHEMATA.forEach((schema) => {
  SCHEMA_INDEX.set(schema.id, schema);
});

export function getTfmsSchemaById(schemaId) {
  if (typeof schemaId !== 'string') {
    return null;
  }
  return SCHEMA_INDEX.get(schemaId) ?? null;
}

export function listTfmsSchemata() {
  return TFMS_SCHEMATA;
}
