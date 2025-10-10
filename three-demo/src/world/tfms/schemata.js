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
      operatorWeights: [1.12, 0.68, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          modulation: { amplitude: 0.28 },
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
      operatorWeights: [0.98, 0.85, 0.65],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.12,
          envelope: { amplitude: 1.04 },
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
      operatorWeights: [0.86, 0.72, 0.5, 0.44],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.14,
          envelope: { amplitude: { multiplier: 0.68 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.72,
          transfer: { id: 'smoothstep' },
          modulation: { amplitude: 0.45 },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.38,
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
  {
    id: 'desert-dune-sea',
    label: 'Sunset Dune Sea',
    tags: ['desert', 'arid', 'dune'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'sandy'],
    },
    climate: {
      temperature: { min: 0.75, max: 1, ideal: 0.9 },
      moisture: { min: 0, max: 0.32, ideal: 0.16 },
    },
    adjacency: {
      preferTags: ['wind-carved'],
      avoidTags: ['wetland', 'fungal'],
    },
    blend: 0.68,
    overrides: {
      operatorWeights: [0.96, 0.58, 0.82, 0.44, 0.32, 0.46],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 0.88 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.94,
          modulation: { frequency: 0.24, warp: { x: 18, z: -14 } },
          envelope: { warp: { x: 36, z: -24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.32 } },
          envelope: { amplitude: { multiplier: 0.58 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'smoothstep', smoothness: 0.48 },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.22,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.48,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.54,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.5,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.28,
        },
      ],
    },
  },
  {
    id: 'desert-oasis-mesas',
    label: 'Butte Oasis Strata',
    tags: ['desert', 'arid', 'mesa'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid'],
    },
    climate: {
      temperature: { min: 0.68, max: 0.95, ideal: 0.78 },
      moisture: { min: 0.1, max: 0.42, ideal: 0.24 },
    },
    adjacency: {
      preferTags: ['wind-carved', 'structured'],
      avoidTags: ['aquatic'],
    },
    blend: 0.74,
    overrides: {
      operatorWeights: [1.14, 0.74, 0.4, 0.58, 0.36, 0.38],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.44,
          envelope: { amplitude: { multiplier: 1.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.98,
          modulation: { amplitude: { multiplier: 0.18 } },
          envelope: { warp: { x: 12, z: 16 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.62,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.46,
          transfer: { id: 'tanh' },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.18,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.62,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.58,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.28,
        },
      ],
    },
  },
  {
    id: 'fungal-noctilucent-basins',
    label: 'Noctilucent Basin Weave',
    tags: ['fungal', 'wetland', 'luminescent'],
    biomes: {
      ids: ['noctilucent_fungus_glade'],
      tags: ['fungal', 'humid'],
    },
    climate: {
      temperature: { min: 0.35, max: 0.62, ideal: 0.48 },
      moisture: { min: 0.68, max: 0.98, ideal: 0.84 },
    },
    adjacency: {
      preferTags: ['fungal', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [0.78, 0.46, 0.38, 0.42, 0.48, 0.74],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.1,
          modulation: { amplitude: { multiplier: 0.38 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.86,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.38,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.42,
          modulation: { frequency: -0.12 },
          envelope: { warp: { x: 14, z: -10 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.58,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.44,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.36,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.52,
        },
        {
          id: 'domain-warp->ridge-noise:domain-z',
          gain: 0.48,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.56,
        },
      ],
    },
  },
  {
    id: 'polar-reef-atolls',
    label: 'Polar Reef Atolls',
    tags: ['reef', 'aquatic', 'auroral'],
    biomes: {
      ids: ['auroral_glass_reef'],
      tags: ['aquatic', 'luminous'],
    },
    climate: {
      temperature: { min: 0.2, max: 0.5, ideal: 0.36 },
      moisture: { min: 0.7, max: 1, ideal: 0.88 },
    },
    adjacency: {
      preferTags: ['aquatic', 'luminous'],
      avoidTags: ['arid'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [0.72, 0.42, 0.34, 0.38, 0.72, 0.78],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.12,
          envelope: { amplitude: { multiplier: 0.7 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.6 } },
          envelope: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.74,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.42 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.58,
          modulation: { amplitude: { multiplier: 0.16 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.32,
          modulation: { frequency: 0.08 },
          envelope: { warp: { x: 12, z: 18 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.46,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.38,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.72,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.68,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-z',
          gain: 0.5,
        },
      ],
    },
  },
  {
    id: 'glacial-aurora-spires',
    label: 'Glacial Aurora Spires',
    tags: ['frozen', 'auroral', 'spires'],
    biomes: {
      ids: ['aurora_shard_expanse', 'ice_spire_tundra'],
      tags: ['frozen', 'windswept'],
    },
    climate: {
      temperature: { min: 0, max: 0.35, ideal: 0.18 },
      moisture: { min: 0.18, max: 0.55, ideal: 0.34 },
    },
    adjacency: {
      preferTags: ['aurora_channel', 'glacial'],
      avoidTags: ['aquatic'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [1.18, 0.84, 0.5, 0.68, 0.4, 0.44],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.38,
          envelope: { amplitude: { multiplier: 1.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 1.12,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.72,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.42,
          transfer: { id: 'tanh' },
        },
      ],
      modulationMatrix: [
        {
          id: 'tectonic-worley->ridge-noise:amplitude',
          gain: 0.48,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.42,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.5,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.48,
        },
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'tundra-drumlin-fields',
    label: 'Frostbound Drumlin Fields',
    tags: ['tundra', 'cold', 'drumlin'],
    biomes: {
      ids: ['frostbound_steppe'],
      tags: ['cold', 'windswept'],
    },
    climate: {
      temperature: { min: 0.05, max: 0.32, ideal: 0.2 },
      moisture: { min: 0.35, max: 0.7, ideal: 0.5 },
    },
    adjacency: {
      preferTags: ['glacial'],
      avoidTags: ['aquatic'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [1.02, 0.7, 0.44, 0.52, 0.36, 0.46],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.26,
          envelope: { amplitude: { multiplier: 1.06 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.82,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.46,
          modulation: { frequency: -0.08 },
          envelope: { warp: { x: 18, z: 12 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'smoothstep', smoothness: 0.36 },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.44,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.46,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'arcane-stepwells',
    label: 'Arcane Stepwell Terraces',
    tags: ['arcane', 'structured', 'terraced'],
    biomes: {
      ids: ['pseudo_borgesian_librarium'],
      tags: ['structured', 'dry'],
    },
    climate: {
      temperature: { min: 0.3, max: 0.6, ideal: 0.45 },
      moisture: { min: 0.18, max: 0.5, ideal: 0.32 },
    },
    adjacency: {
      preferTags: ['structured', 'upland'],
      avoidTags: ['aquatic'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.04, 0.94, 0.44, 0.66, 0.34, 0.4],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.4,
          envelope: { amplitude: { multiplier: 1.14 } },
        },
        {
          id: 'ridge-noise',
          weight: 1.06,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: 0.18 },
          envelope: { warp: { x: 22, z: -22 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.58,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.52,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.42,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'neon-resonant-terraces',
    label: 'Neon Resonant Terraces',
    tags: ['dreamlike', 'neon', 'terraced'],
    biomes: {
      ids: ['fading_vaporwave_dimension'],
      tags: ['dreamlike', 'warm'],
    },
    climate: {
      temperature: { min: 0.55, max: 0.78, ideal: 0.68 },
      moisture: { min: 0.35, max: 0.6, ideal: 0.48 },
    },
    adjacency: {
      preferTags: ['warm', 'structured'],
      avoidTags: ['arid'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [0.94, 0.6, 0.56, 0.4, 0.46, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.32,
          envelope: { amplitude: { multiplier: 1.04 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.84,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.66,
          modulation: { frequency: 0.22 },
          envelope: { warp: { x: 28, z: 18 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.42 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.28,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.48,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.44,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.26,
        },
      ],
    },
  },
];

function freezeScalarRangeOverride(range) {
  if (Number.isFinite(range)) {
    return range;
  }
  if (!range || typeof range !== 'object') {
    return undefined;
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
  if (Object.prototype.hasOwnProperty.call(range, 'axis')) {
    clone.axis = range.axis;
  }
  if (typeof range.channel === 'string') {
    clone.channel = range.channel;
  }
  return Object.keys(clone).length > 0 ? Object.freeze(clone) : undefined;
}

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
    const amplitude = freezeScalarRangeOverride(override.envelope.amplitude);
    if (amplitude !== undefined) {
      envelope.amplitude = amplitude;
    }
    const frequency = freezeScalarRangeOverride(override.envelope.frequency);
    if (frequency !== undefined) {
      envelope.frequency = frequency;
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
