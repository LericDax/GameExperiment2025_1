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
          envelope: { amplitude: { multiplier: 1.04 } },
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
  {
    id: 'temperate-meadow-drift',
    label: 'Temperate Meadow Drift',
    tags: ['temperate', 'meadow', 'rolling'],
    biomes: {
      ids: ['temperate_forest'],
      tags: ['temperate', 'grassland'],
    },
    climate: {
      temperature: { min: 0.42, max: 0.62, ideal: 0.54 },
      moisture: { min: 0.38, max: 0.68, ideal: 0.52 },
    },
    adjacency: {
      preferTags: ['temperate', 'grassland'],
      avoidTags: ['arid', 'frozen'],
    },
    blend: 0.72,
    overrides: {
      operatorWeights: [0.88, 0.42],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.18,
          envelope: { amplitude: { multiplier: 0.92 } },
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.58,
          modulation: { amplitude: { multiplier: 0.12 } },
        },
      ],
    },
  },
  {
    id: 'temperate-riverbraid-terraces',
    label: 'Temperate Riverbraid Terraces',
    tags: ['temperate', 'river', 'terraced'],
    biomes: {
      ids: ['temperate_forest'],
      tags: ['temperate', 'riparian'],
    },
    climate: {
      temperature: { min: 0.44, max: 0.66, ideal: 0.55 },
      moisture: { min: 0.55, max: 0.9, ideal: 0.7 },
    },
    adjacency: {
      preferTags: ['temperate', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [1.08, 0.78, 0.52, 0.6, 0.48, 0.68],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.24,
          envelope: { amplitude: { multiplier: 1.12 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.84,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: 0.18 },
          envelope: { warp: { x: 24, z: -16 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.46,
          transfer: { id: 'smoothstep', smoothness: 0.38 },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.64,
          transfer: { id: 'smoothstep', smoothness: 0.42 },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.42,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.38,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'temperate-lichen-steppe',
    label: 'Temperate Lichen Steppe',
    tags: ['temperate', 'lichen', 'steppe'],
    biomes: {
      ids: ['temperate_forest'],
      tags: ['temperate', 'highland'],
    },
    climate: {
      temperature: { min: 0.36, max: 0.58, ideal: 0.46 },
      moisture: { min: 0.32, max: 0.58, ideal: 0.4 },
    },
    adjacency: {
      preferTags: ['highland', 'temperate'],
      avoidTags: ['arid', 'humid'],
    },
    blend: 0.76,
    overrides: {
      operatorWeights: [0.96, 0.62, 0.5, 0.42, 0.44, 0.58],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.2,
          envelope: { amplitude: { multiplier: 0.98 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.74,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.46,
          modulation: { frequency: -0.16 },
          envelope: { warp: { x: 20, z: 14 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.4,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.38 },
          },
          envelope: { amplitude: { multiplier: 0.44 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.6,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.28,
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
          id: 'domain-warp->ridge-noise:domain-x',
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
    id: 'temperate-shadow-ravines',
    label: 'Temperate Shadow Ravines',
    tags: ['temperate', 'ravine', 'shadow'],
    biomes: {
      ids: ['temperate_forest'],
      tags: ['temperate', 'canyon'],
    },
    climate: {
      temperature: { min: 0.4, max: 0.62, ideal: 0.5 },
      moisture: { min: 0.42, max: 0.78, ideal: 0.6 },
    },
    adjacency: {
      preferTags: ['canyon', 'river'],
      avoidTags: ['arid'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [1.12, 0.76, 0.48, 0.54, 0.52, 0.66],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 1.16 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.88,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: -0.24 },
          envelope: { warp: { x: 32, z: -26 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.48,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.48 } },
          envelope: { amplitude: { multiplier: 0.56 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.68,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.38 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.42,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.68,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.62,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.48,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.36,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'temperate-boulder-cascade',
    label: 'Temperate Boulder Cascade',
    tags: ['temperate', 'boulder', 'upland'],
    biomes: {
      tags: ['temperate', 'upland', 'rocky'],
    },
    climate: {
      temperature: { min: 0.38, max: 0.6, ideal: 0.48 },
      moisture: { min: 0.28, max: 0.56, ideal: 0.4 },
    },
    adjacency: {
      preferTags: ['upland', 'rocky'],
      avoidTags: ['wetland'],
    },
    blend: 0.78,
    overrides: {
      operatorWeights: [0.98, 0.74, 0.58, 0.52, 0.4, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.86,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.52,
          modulation: { frequency: 0.16 },
          envelope: { warp: { x: 18, z: 22 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.48,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.44,
          transfer: { id: 'smoothstep', smoothness: 0.4 },
          modulation: { amplitude: { multiplier: 0.24 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.26,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.46,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.42,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.38,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.28,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'temperate-frostleaf-pass',
    label: 'Temperate Frostleaf Pass',
    tags: ['temperate', 'frostleaf', 'pass'],
    biomes: {
      ids: ['temperate_forest', 'ice_spire_tundra'],
      tags: ['temperate', 'cold-edge'],
    },
    climate: {
      temperature: { min: 0.32, max: 0.5, ideal: 0.42 },
      moisture: { min: 0.4, max: 0.7, ideal: 0.55 },
    },
    adjacency: {
      preferTags: ['temperate', 'glacial'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [1.06, 0.82, 0.48, 0.58, 0.46, 0.66],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.28,
          envelope: { amplitude: { multiplier: 1.18 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.94,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.44,
          modulation: { frequency: -0.14 },
          envelope: { warp: { x: 26, z: 16 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.52,
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.42 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.68,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.48,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.4,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.32,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.44,
        },
      ],
    },
  },
  {
    id: 'tropical-canopy-braid',
    label: 'Tropical Canopy Braid',
    tags: ['tropical', 'canopy', 'liana'],
    biomes: {
      tags: ['tropical', 'jungle', 'humid'],
    },
    climate: {
      temperature: { min: 0.68, max: 0.92, ideal: 0.82 },
      moisture: { min: 0.7, max: 1, ideal: 0.88 },
    },
    adjacency: {
      preferTags: ['tropical', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [1.12, 0.76, 0.58, 0.42, 0.6, 0.78],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.32,
          envelope: { amplitude: { multiplier: 1.2 } },
          modulation: { amplitude: { multiplier: 0.38 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.76,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.58,
          modulation: { frequency: -0.18 },
          envelope: { warp: { x: 22, z: 30 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.42,
          transfer: { id: 'smoothstep', smoothness: 0.4 },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.6 } },
          envelope: { amplitude: { multiplier: 0.54 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.78,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.44 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.7,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.66,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.5,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.46,
        },
      ],
    },
  },
  {
    id: 'tropical-karst-pillars',
    label: 'Tropical Karst Pillars',
    tags: ['tropical', 'karst', 'pillar'],
    biomes: {
      tags: ['tropical', 'upland', 'humid'],
    },
    climate: {
      temperature: { min: 0.66, max: 0.9, ideal: 0.8 },
      moisture: { min: 0.6, max: 0.92, ideal: 0.78 },
    },
    adjacency: {
      preferTags: ['upland', 'tropical'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [1.14, 0.9, 0.56, 0.58, 0.48, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.36,
          envelope: { amplitude: { multiplier: 1.26 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 1.02,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.52,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 30, z: -20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.58,
          transfer: { id: 'smoothstep', smoothness: 0.36 },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.48 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.58,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.38,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'tropical-floodplain-fans',
    label: 'Tropical Floodplain Fans',
    tags: ['tropical', 'floodplain', 'delta'],
    biomes: {
      tags: ['tropical', 'wetland', 'delta'],
    },
    climate: {
      temperature: { min: 0.62, max: 0.86, ideal: 0.74 },
      moisture: { min: 0.72, max: 1, ideal: 0.9 },
    },
    adjacency: {
      preferTags: ['wetland', 'delta'],
      avoidTags: ['upland'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.92, 0.54, 0.4, 0.36, 0.5, 0.82],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          envelope: { amplitude: { multiplier: 1.02 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.6,
          modulation: { amplitude: { multiplier: 0.16 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.34,
          modulation: { frequency: -0.08 },
          envelope: { warp: { x: 18, z: 20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.32,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.54 } },
          envelope: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.82,
          transfer: { id: 'smoothstep', smoothness: 0.46 },
          modulation: { amplitude: { multiplier: 0.42 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.46,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.4,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.64,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.6,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'tropical-mangrove-waves',
    label: 'Tropical Mangrove Waves',
    tags: ['tropical', 'mangrove', 'tidal'],
    biomes: {
      tags: ['tropical', 'coastal', 'wetland'],
    },
    climate: {
      temperature: { min: 0.64, max: 0.88, ideal: 0.78 },
      moisture: { min: 0.76, max: 1, ideal: 0.92 },
    },
    adjacency: {
      preferTags: ['coastal', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [0.88, 0.52, 0.44, 0.38, 0.6, 0.72],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.28,
          envelope: { amplitude: { multiplier: 1.1 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.68,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.44,
          modulation: { frequency: -0.22 },
          envelope: { warp: { x: 20, z: 28 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.4,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.64 } },
          envelope: { amplitude: { multiplier: 0.58 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.72,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.46 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
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
          gain: 0.5,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.34,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'tropical-ember-archipelago',
    label: 'Tropical Ember Archipelago',
    tags: ['tropical', 'archipelago', 'volcanic'],
    biomes: {
      tags: ['tropical', 'coastal', 'volcanic'],
    },
    climate: {
      temperature: { min: 0.7, max: 0.95, ideal: 0.84 },
      moisture: { min: 0.5, max: 0.88, ideal: 0.66 },
    },
    adjacency: {
      preferTags: ['coastal', 'volcanic'],
      avoidTags: ['frozen'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.02, 0.76, 0.5, 0.54, 0.62, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.34,
          envelope: { amplitude: { multiplier: 1.18 } },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.92,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: 0.24 },
          envelope: { warp: { x: 34, z: -24 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.54,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.66 } },
          envelope: { amplitude: { multiplier: 0.6 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.32,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.68,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.64,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.52,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.38,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.4,
        },
      ],
    },
  },
  {
    id: 'desert-harmattan-surge',
    label: 'Desert Harmattan Surge',
    tags: ['desert', 'harmattan', 'dune'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'wind-carved'],
    },
    climate: {
      temperature: { min: 0.78, max: 1, ideal: 0.9 },
      moisture: { min: 0, max: 0.3, ideal: 0.12 },
    },
    adjacency: {
      preferTags: ['wind-carved'],
      avoidTags: ['wetland'],
    },
    blend: 0.7,
    overrides: {
      operatorWeights: [0.9, 0.5],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.34,
          envelope: { amplitude: { multiplier: 1.12 } },
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.72,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
      ],
    },
  },
  {
    id: 'desert-glass-pan',
    label: 'Desert Glass Pan',
    tags: ['desert', 'salt', 'pan'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'salt-flat'],
    },
    climate: {
      temperature: { min: 0.74, max: 0.96, ideal: 0.86 },
      moisture: { min: 0.02, max: 0.26, ideal: 0.12 },
    },
    adjacency: {
      preferTags: ['salt-flat', 'wind-carved'],
      avoidTags: ['wetland'],
    },
    blend: 0.74,
    overrides: {
      operatorWeights: [0.86, 0.58, 0.42, 0.48, 0.38, 0.44],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.28,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.74,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.46,
          modulation: { frequency: 0.3 },
          envelope: { warp: { x: 36, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.4,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.42 } },
          envelope: { amplitude: { multiplier: 0.38 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.44,
          transfer: { id: 'smoothstep', smoothness: 0.4 },
          modulation: { amplitude: { multiplier: 0.24 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.24,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.5,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.46,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.36,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.28,
        },
      ],
    },
  },
  {
    id: 'desert-salt-spines',
    label: 'Desert Salt Spines',
    tags: ['desert', 'salt', 'spine'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'structured'],
    },
    climate: {
      temperature: { min: 0.76, max: 0.98, ideal: 0.88 },
      moisture: { min: 0.04, max: 0.24, ideal: 0.14 },
    },
    adjacency: {
      preferTags: ['structured', 'wind-carved'],
      avoidTags: ['aquatic'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [1.04, 0.92, 0.6, 0.52, 0.46, 0.4],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.4,
          envelope: { amplitude: { multiplier: 1.2 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 1.08,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.58,
          modulation: { frequency: 0.26 },
          envelope: { warp: { x: 32, z: -22 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.5,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.48 } },
          envelope: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.36,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.22 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.22,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.26,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.56,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.52,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.4,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'desert-crescent-ridges',
    label: 'Desert Crescent Ridges',
    tags: ['desert', 'crescent', 'dune'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'wind-carved'],
    },
    climate: {
      temperature: { min: 0.72, max: 0.95, ideal: 0.84 },
      moisture: { min: 0.04, max: 0.3, ideal: 0.16 },
    },
    adjacency: {
      preferTags: ['wind-carved', 'structured'],
      avoidTags: ['wetland'],
    },
    blend: 0.78,
    overrides: {
      operatorWeights: [0.98, 0.7, 0.52, 0.44, 0.5, 0.46],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.26,
          envelope: { amplitude: { multiplier: 1.04 } },
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.86,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: -0.12 },
          envelope: { warp: { x: 28, z: -20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.42,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.48,
          transfer: { id: 'smoothstep', smoothness: 0.38 },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.3,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'desert-mirage-flats',
    label: 'Desert Mirage Flats',
    tags: ['desert', 'mirage', 'flat'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'lowland'],
    },
    climate: {
      temperature: { min: 0.7, max: 0.94, ideal: 0.82 },
      moisture: { min: 0.02, max: 0.28, ideal: 0.14 },
    },
    adjacency: {
      preferTags: ['lowland', 'mirage'],
      avoidTags: ['wetland'],
    },
    blend: 0.76,
    overrides: {
      operatorWeights: [0.8, 0.46, 0.34, 0.32, 0.36, 0.6],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.18,
          envelope: { amplitude: { multiplier: 0.96 } },
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.54,
          modulation: { amplitude: { multiplier: 0.12 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.3,
          modulation: { frequency: 0.1 },
          envelope: { warp: { x: 24, z: 18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.3,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.36 } },
          envelope: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.78,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.4 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.48,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.44,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.4,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.3,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.26,
        },
      ],
    },
  },
  {
    id: 'desert-wadi-lattice',
    label: 'Desert Wadi Lattice',
    tags: ['desert', 'wadi', 'lattice'],
    biomes: {
      ids: ['sunset_dunes'],
      tags: ['arid', 'canyon'],
    },
    climate: {
      temperature: { min: 0.74, max: 0.97, ideal: 0.86 },
      moisture: { min: 0.06, max: 0.32, ideal: 0.18 },
    },
    adjacency: {
      preferTags: ['canyon', 'wind-carved'],
      avoidTags: ['wetland'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [0.94, 0.68, 0.5, 0.46, 0.56, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 1.1 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.82,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: -0.2 },
          envelope: { warp: { x: 30, z: -24 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.46,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.56 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'tanh' },
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
          gain: 0.3,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'savanna-rolling-shelves',
    label: 'Savanna Rolling Shelves',
    tags: ['savanna', 'rolling', 'grassland'],
    biomes: {
      tags: ['savanna', 'grassland'],
    },
    climate: {
      temperature: { min: 0.58, max: 0.78, ideal: 0.66 },
      moisture: { min: 0.32, max: 0.54, ideal: 0.42 },
    },
    adjacency: {
      preferTags: ['grassland', 'savanna'],
      avoidTags: ['wetland', 'frozen'],
    },
    blend: 0.74,
    overrides: {
      operatorWeights: [0.86, 0.46],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          envelope: { amplitude: { multiplier: 1 } },
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.62,
          modulation: { amplitude: { multiplier: 0.14 } },
        },
      ],
    },
  },
  {
    id: 'savanna-basalt-knolls',
    label: 'Savanna Basalt Knolls',
    tags: ['savanna', 'basalt', 'knoll'],
    biomes: {
      tags: ['savanna', 'upland'],
    },
    climate: {
      temperature: { min: 0.6, max: 0.82, ideal: 0.7 },
      moisture: { min: 0.28, max: 0.5, ideal: 0.36 },
    },
    adjacency: {
      preferTags: ['upland', 'savanna'],
      avoidTags: ['wetland'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [0.94, 0.72, 0.46, 0.4, 0.42, 0.5],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.28,
          envelope: { amplitude: { multiplier: 1.06 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.82,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.42,
          modulation: { frequency: 0.18 },
          envelope: { warp: { x: 26, z: -12 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.38,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.44 } },
          envelope: { amplitude: { multiplier: 0.4 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'smoothstep', smoothness: 0.36 },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.32,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.5,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.46,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.38,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.28,
        },
      ],
    },
  },
  {
    id: 'steppe-loess-plates',
    label: 'Steppe Loess Plates',
    tags: ['steppe', 'loess', 'plate'],
    biomes: {
      tags: ['steppe', 'dry-grass'],
    },
    climate: {
      temperature: { min: 0.42, max: 0.64, ideal: 0.5 },
      moisture: { min: 0.2, max: 0.4, ideal: 0.28 },
    },
    adjacency: {
      preferTags: ['steppe', 'open'],
      avoidTags: ['wetland', 'forest'],
    },
    blend: 0.68,
    overrides: {
      operatorWeights: [0.82],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.16,
          envelope: { amplitude: { multiplier: 0.88 } },
          modulation: { amplitude: { multiplier: 0.18 } },
        },
      ],
    },
  },
  {
    id: 'prairie-braided-swales',
    label: 'Prairie Braided Swales',
    tags: ['prairie', 'braided', 'swale'],
    biomes: {
      tags: ['prairie', 'riparian'],
    },
    climate: {
      temperature: { min: 0.5, max: 0.7, ideal: 0.6 },
      moisture: { min: 0.38, max: 0.66, ideal: 0.52 },
    },
    adjacency: {
      preferTags: ['riparian', 'grassland'],
      avoidTags: ['arid'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [0.92, 0.6, 0.42, 0.34, 0.46, 0.72],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.2,
          envelope: { amplitude: { multiplier: 1.02 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.68,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.4,
          modulation: { frequency: -0.1 },
          envelope: { warp: { x: 22, z: 24 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.32,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.46 } },
          envelope: { amplitude: { multiplier: 0.44 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.76,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.38 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.44,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.26,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.52,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.48,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'tundra-sastrugi-flow',
    label: 'Tundra Sastrugi Flow',
    tags: ['tundra', 'sastrugi', 'windswept'],
    biomes: {
      ids: ['ice_spire_tundra', 'frostbound_steppe'],
      tags: ['frozen', 'windswept'],
    },
    climate: {
      temperature: { min: 0, max: 0.32, ideal: 0.18 },
      moisture: { min: 0.2, max: 0.6, ideal: 0.4 },
    },
    adjacency: {
      preferTags: ['windswept', 'glacial'],
      avoidTags: ['temperate'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.08, 0.74, 0.5, 0.54, 0.46, 0.58],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 1.16 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.9,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.52,
          modulation: { frequency: -0.2 },
          envelope: { warp: { x: 28, z: 16 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.5,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.46 } },
          envelope: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.64,
          transfer: { id: 'smoothstep', smoothness: 0.34 },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.4,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.56,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.52,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.4,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.36,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'polar-borealis-banks',
    label: 'Polar Borealis Banks',
    tags: ['polar', 'borealis', 'bank'],
    biomes: {
      ids: ['aurora_shard_expanse'],
      tags: ['auroral', 'frozen'],
    },
    climate: {
      temperature: { min: 0.08, max: 0.32, ideal: 0.2 },
      moisture: { min: 0.4, max: 0.8, ideal: 0.62 },
    },
    adjacency: {
      preferTags: ['aurora_channel', 'glacial'],
      avoidTags: ['arid'],
    },
    blend: 0.7,
    overrides: {
      operatorWeights: [0.82, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.24,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.6,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
      ],
    },
  },
  {
    id: 'glacial-icefall-cirques',
    label: 'Glacial Icefall Cirques',
    tags: ['glacial', 'icefall', 'cirque'],
    biomes: {
      ids: ['ice_spire_tundra'],
      tags: ['glacial', 'steep'],
    },
    climate: {
      temperature: { min: 0, max: 0.28, ideal: 0.16 },
      moisture: { min: 0.3, max: 0.62, ideal: 0.48 },
    },
    adjacency: {
      preferTags: ['glacial', 'auroral'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [1.12, 0.86, 0.52, 0.6, 0.44, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.38,
          envelope: { amplitude: { multiplier: 1.24 } },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'ridge-noise',
          weight: 1.02,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: -0.18 },
          envelope: { warp: { x: 32, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.56,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.48 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.5,
          transfer: { id: 'tanh' },
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
          gain: 0.32,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.34,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.42,
        },
      ],
    },
  },
  {
    id: 'tundra-crystal-deltas',
    label: 'Tundra Crystal Deltas',
    tags: ['tundra', 'crystal', 'delta'],
    biomes: {
      ids: ['auroral_glass_reef'],
      tags: ['frozen', 'aquatic'],
    },
    climate: {
      temperature: { min: 0.1, max: 0.38, ideal: 0.22 },
      moisture: { min: 0.5, max: 1, ideal: 0.78 },
    },
    adjacency: {
      preferTags: ['aquatic', 'auroral'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [0.96, 0.58, 0.46, 0.4, 0.54, 0.76],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          envelope: { amplitude: { multiplier: 1.04 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.68,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.42,
          modulation: { frequency: 0.14 },
          envelope: { warp: { x: 18, z: 26 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.4,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.58 } },
          envelope: { amplitude: { multiplier: 0.54 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.84,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.44 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.4,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.66,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.62,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.48,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.4,
        },
      ],
    },
  },
  {
    id: 'polar-fissure-shelves',
    label: 'Polar Fissure Shelves',
    tags: ['polar', 'fissure', 'shelf'],
    biomes: {
      ids: ['aurora_shard_expanse'],
      tags: ['auroral', 'upland'],
    },
    climate: {
      temperature: { min: 0.06, max: 0.34, ideal: 0.22 },
      moisture: { min: 0.2, max: 0.58, ideal: 0.36 },
    },
    adjacency: {
      preferTags: ['auroral', 'upland'],
      avoidTags: ['arid'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [1, 0.72, 0.46, 0.5, 0.48, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 1.12 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.86,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.44,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 24, z: -16 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.48,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.52 } },
          envelope: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.56,
          transfer: { id: 'smoothstep', smoothness: 0.32 },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'wetland-cypress-mire',
    label: 'Wetland Cypress Mire',
    tags: ['wetland', 'cypress', 'mire'],
    biomes: {
      tags: ['wetland', 'temperate'],
    },
    climate: {
      temperature: { min: 0.4, max: 0.68, ideal: 0.54 },
      moisture: { min: 0.7, max: 1, ideal: 0.88 },
    },
    adjacency: {
      preferTags: ['wetland', 'temperate'],
      avoidTags: ['arid'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.92, 0.52, 0.38, 0.34, 0.46, 0.82],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.18,
          envelope: { amplitude: { multiplier: 1.04 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.58,
          modulation: { amplitude: { multiplier: 0.16 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.32,
          modulation: { frequency: -0.12 },
          envelope: { warp: { x: 16, z: 22 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.3,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.46 } },
          envelope: { amplitude: { multiplier: 0.42 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.88,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.48 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.52,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.6,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.56,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'wetland-meander-fans',
    label: 'Wetland Meander Fans',
    tags: ['wetland', 'meander', 'fan'],
    biomes: {
      tags: ['wetland', 'river'],
    },
    climate: {
      temperature: { min: 0.38, max: 0.66, ideal: 0.5 },
      moisture: { min: 0.68, max: 1, ideal: 0.86 },
    },
    adjacency: {
      preferTags: ['river', 'wetland'],
      avoidTags: ['upland'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [0.86, 0.48, 0.36, 0.32, 0.5, 0.78],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.16,
          envelope: { amplitude: { multiplier: 1 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.54,
          modulation: { amplitude: { multiplier: 0.14 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.34,
          modulation: { frequency: 0.08 },
          envelope: { warp: { x: 18, z: 18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.3,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.82,
          transfer: { id: 'smoothstep', smoothness: 0.44 },
          modulation: { amplitude: { multiplier: 0.4 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.48,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.28,
        },
      ],
    },
  },
  {
    id: 'wetland-peat-flumes',
    label: 'Wetland Peat Flumes',
    tags: ['wetland', 'peat', 'flat'],
    biomes: {
      tags: ['wetland', 'bog'],
    },
    climate: {
      temperature: { min: 0.34, max: 0.6, ideal: 0.48 },
      moisture: { min: 0.72, max: 1, ideal: 0.9 },
    },
    adjacency: {
      preferTags: ['bog', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [0.78],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.14,
          envelope: { amplitude: { multiplier: 0.84 } },
          modulation: { amplitude: { multiplier: 0.16 } },
        },
      ],
    },
  },
  {
    id: 'delta-bloom-shelves',
    label: 'Delta Bloom Shelves',
    tags: ['wetland', 'delta', 'bloom'],
    biomes: {
      tags: ['delta', 'wetland'],
    },
    climate: {
      temperature: { min: 0.46, max: 0.7, ideal: 0.56 },
      moisture: { min: 0.72, max: 1, ideal: 0.88 },
    },
    adjacency: {
      preferTags: ['delta', 'wetland'],
      avoidTags: ['upland'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.94, 0.56, 0.4, 0.36, 0.48, 0.8],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.22,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.64,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.38,
          modulation: { frequency: -0.16 },
          envelope: { warp: { x: 20, z: 24 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.34,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.84,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.46 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'coastal-archipelago-chain',
    label: 'Coastal Archipelago Chain',
    tags: ['coastal', 'archipelago', 'island'],
    biomes: {
      ids: ['auroral_glass_reef'],
      tags: ['coastal', 'aquatic'],
    },
    climate: {
      temperature: { min: 0.48, max: 0.78, ideal: 0.62 },
      moisture: { min: 0.68, max: 1, ideal: 0.9 },
    },
    adjacency: {
      preferTags: ['coastal', 'aquatic'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [0.98, 0.62, 0.48, 0.42, 0.58, 0.66],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.26,
          envelope: { amplitude: { multiplier: 1.1 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.7,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.44,
          modulation: { frequency: -0.2 },
          envelope: { warp: { x: 26, z: 20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.4,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.58 } },
          envelope: { amplitude: { multiplier: 0.54 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.68,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.42 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.44,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.26,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.64,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.6,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'coastal-fjord-scars',
    label: 'Coastal Fjord Scars',
    tags: ['coastal', 'fjord', 'scar'],
    biomes: {
      ids: ['ice_spire_tundra', 'aurora_shard_expanse'],
      tags: ['coastal', 'frozen'],
    },
    climate: {
      temperature: { min: 0.2, max: 0.54, ideal: 0.36 },
      moisture: { min: 0.48, max: 0.88, ideal: 0.68 },
    },
    adjacency: {
      preferTags: ['coastal', 'glacial'],
      avoidTags: ['arid'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.04, 0.82, 0.5, 0.56, 0.46, 0.5],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.34,
          envelope: { amplitude: { multiplier: 1.18 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.96,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: -0.16 },
          envelope: { warp: { x: 32, z: -14 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.5,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.48 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.52,
          transfer: { id: 'smoothstep', smoothness: 0.38 },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.34,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.3,
        },
      ],
    },
  },
  {
    id: 'glacial-calving-grounds',
    label: 'Glacial Calving Grounds',
    tags: ['glacial', 'calving', 'shelf'],
    biomes: {
      ids: ['ice_spire_tundra', 'aurora_shard_expanse'],
      tags: ['glacial', 'coastal'],
    },
    climate: {
      temperature: { min: 0.08, max: 0.46, ideal: 0.28 },
      moisture: { min: 0.36, max: 0.78, ideal: 0.58 },
    },
    adjacency: {
      preferTags: ['glacial', 'coastal'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [1.08, 0.78, 0.46, 0.72, 0.56, 0.6],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.32,
          envelope: { amplitude: { multiplier: 1.22 }, warp: { x: -14, z: 18 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.94,
          modulation: { amplitude: { multiplier: 0.24 } },
          envelope: { warp: { x: 26, z: -20 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.42,
          modulation: { frequency: -0.24 },
          envelope: { warp: { x: 28, z: -24 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.72,
          modulation: { amplitude: { multiplier: 0.38 } },
          envelope: { amplitude: { multiplier: 0.6 } },
          tectonic: { weight: 0.68, bias: -0.14 },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.54 },
            warp: { x: 0.26, z: -0.18 },
          },
          envelope: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.64,
          transfer: { id: 'smoothstep', smoothness: 0.42 },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.52,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'reef-luminal-towers',
    label: 'Reef Luminal Towers',
    tags: ['reef', 'luminal', 'tower'],
    biomes: {
      ids: ['auroral_glass_reef'],
      tags: ['reef', 'luminous'],
    },
    climate: {
      temperature: { min: 0.44, max: 0.74, ideal: 0.6 },
      moisture: { min: 0.7, max: 1, ideal: 0.92 },
    },
    adjacency: {
      preferTags: ['reef', 'luminous'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [0.9, 0.56, 0.42, 0.36, 0.6, 0.74],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.2,
          envelope: { amplitude: { multiplier: 1.06 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.62,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.4,
          modulation: { frequency: 0.24 },
          envelope: { warp: { x: 20, z: 30 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.34,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.6 } },
          envelope: { amplitude: { multiplier: 0.58 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.78,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.44 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.46,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.68,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.64,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.48,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'reef-plateau-bastions',
    label: 'Reef Plateau Bastions',
    tags: ['reef', 'shelf', 'plateau'],
    biomes: {
      ids: ['auroral_glass_reef', 'prismarine_vent_plateau'],
      tags: ['reef', 'shelf'],
    },
    climate: {
      temperature: { min: 0.4, max: 0.72, ideal: 0.58 },
      moisture: { min: 0.66, max: 1, ideal: 0.9 },
    },
    adjacency: {
      preferTags: ['reef', 'upland'],
      avoidTags: ['arid'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [0.96, 0.58, 0.36, 0.38, 0.62, 0.7],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.2,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.62,
          modulation: { amplitude: { multiplier: 0.2 } },
          envelope: { warp: { x: 14, z: 22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.34,
          modulation: { frequency: 0.18 },
          envelope: { warp: { x: 18, z: 32 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.38,
          modulation: { amplitude: { multiplier: 0.26 } },
          envelope: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.6 },
            warp: { x: 0.22, z: -0.16 },
          },
          envelope: { amplitude: { multiplier: 0.58 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.74,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.4 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.44,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.68,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.64,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.48,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'kelp-spiral-mounds',
    label: 'Kelp Spiral Mounds',
    tags: ['kelp', 'reef', 'mound'],
    biomes: {
      ids: ['prismarine_vent_plateau', 'luminous_tidebloom_marsh'],
      tags: ['kelp', 'tidal'],
    },
    climate: {
      temperature: { min: 0.46, max: 0.78, ideal: 0.62 },
      moisture: { min: 0.72, max: 1, ideal: 0.94 },
    },
    adjacency: {
      preferTags: ['kelp', 'reef'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [0.92, 0.5, 0.42, 0.34, 0.68, 0.72],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.16,
          envelope: { amplitude: { multiplier: 1.04 } },
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.56,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.38,
          modulation: { frequency: 0.22 },
          envelope: { warp: { x: 16, z: -26 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.32,
          modulation: { amplitude: { multiplier: 0.24 } },
          envelope: { amplitude: { multiplier: 0.44 } },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.66 },
            warp: { x: 0.32, z: -0.28 },
          },
          envelope: { amplitude: { multiplier: 0.64 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.76,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.42 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.4,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.3,
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
          gain: 0.5,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'monsoon-shoal-runnels',
    label: 'Monsoon Shoal Runnels',
    tags: ['shoal', 'monsoon', 'tidal'],
    biomes: {
      ids: ['luminous_tidebloom_marsh', 'prismarine_vent_plateau'],
      tags: ['tidal', 'shoal'],
    },
    climate: {
      temperature: { min: 0.5, max: 0.82, ideal: 0.68 },
      moisture: { min: 0.78, max: 1, ideal: 0.96 },
    },
    adjacency: {
      preferTags: ['tidal', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.9, 0.46, 0.4, 0.32, 0.6, 0.78],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.14,
          envelope: { amplitude: { multiplier: 0.98 } },
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.52,
          modulation: { amplitude: { multiplier: 0.16 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.36,
          modulation: { frequency: 0.12 },
          envelope: { warp: { x: 12, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.3,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.58 },
            warp: { x: 0.26, z: -0.22 },
          },
          envelope: { amplitude: { multiplier: 0.56 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.82,
          transfer: { id: 'smoothstep', smoothness: 0.48 },
          modulation: { amplitude: { multiplier: 0.46 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.46,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.66,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.62,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'ocean-shelf-canyons',
    label: 'Ocean Shelf Canyons',
    tags: ['ocean', 'shelf', 'canyon'],
    biomes: {
      tags: ['ocean', 'deep'],
    },
    climate: {
      temperature: { min: 0.36, max: 0.64, ideal: 0.5 },
      moisture: { min: 0.6, max: 1, ideal: 0.82 },
    },
    adjacency: {
      preferTags: ['ocean', 'trench'],
      avoidTags: ['arid'],
    },
    blend: 0.76,
    overrides: {
      operatorWeights: [0.96, 0.68, 0.52, 0.46, 0.64, 0.76],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.26,
          envelope: { amplitude: { multiplier: 1.12 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.64,
          envelope: { amplitude: { multiplier: 0.88 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.52,
          envelope: { amplitude: { multiplier: 0.5 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.46,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 24, z: -18 } },
        },
        {
          id: 'domain-warp',
          modulation: {
            amplitude: { multiplier: 0.68 },
            warp: { x: 0.36, z: -0.28 },
          },
          envelope: { amplitude: { multiplier: 0.62 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.78,
          transfer: { id: 'smoothstep', smoothness: 0.42 },
          modulation: { amplitude: { multiplier: 0.44 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.48,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.42,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.34,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.4,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.32,
        },
        {
          id: 'tectonic-worley->domain-warp:amplitude',
          gain: 0.36,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.78,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.72,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.56,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'abyssal-vent-fields',
    label: 'Abyssal Vent Fields',
    tags: ['ocean', 'abyssal', 'vent'],
    biomes: {
      tags: ['ocean', 'abyssal'],
    },
    climate: {
      temperature: { min: 0.3, max: 0.58, ideal: 0.46 },
      moisture: { min: 0.68, max: 1, ideal: 0.92 },
    },
    adjacency: {
      preferTags: ['abyssal', 'volcanic'],
      avoidTags: ['arid'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [0.88, 0.5, 0.38, 0.36, 0.58, 0.72],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.18,
          envelope: { amplitude: { multiplier: 1 } },
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.6,
          modulation: { amplitude: { multiplier: 0.2 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.36,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 18, z: -28 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.32,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.62 } },
          envelope: { amplitude: { multiplier: 0.6 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.7,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.4 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.42,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.26,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.7,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.66,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.5,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'volcanic-caldera-rings',
    label: 'Volcanic Caldera Rings',
    tags: ['volcanic', 'caldera', 'ring'],
    biomes: {
      ids: ['fading_vaporwave_dimension'],
      tags: ['volcanic', 'warm'],
    },
    climate: {
      temperature: { min: 0.6, max: 0.92, ideal: 0.8 },
      moisture: { min: 0.24, max: 0.6, ideal: 0.38 },
    },
    adjacency: {
      preferTags: ['volcanic', 'upland'],
      avoidTags: ['wetland'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [1.1, 0.86, 0.58, 0.6, 0.52, 0.5],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.36,
          envelope: { amplitude: { multiplier: 1.22 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.98,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.54,
          modulation: { frequency: 0.24 },
          envelope: { warp: { x: 30, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.58,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.54 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.46,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.32,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.6,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.56,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'volcanic-spatter-cones',
    label: 'Volcanic Spatter Cones',
    tags: ['volcanic', 'spatter', 'cone'],
    biomes: {
      ids: ['fading_vaporwave_dimension'],
      tags: ['volcanic', 'upland'],
    },
    climate: {
      temperature: { min: 0.58, max: 0.9, ideal: 0.78 },
      moisture: { min: 0.2, max: 0.52, ideal: 0.34 },
    },
    adjacency: {
      preferTags: ['volcanic', 'structured'],
      avoidTags: ['wetland'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.06, 0.78, 0.52, 0.58, 0.48, 0.46],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.4,
          envelope: { amplitude: { multiplier: 1.24 } },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.9,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: -0.22 },
          envelope: { warp: { x: 28, z: 18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.56,
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.48,
          transfer: { id: 'smoothstep', smoothness: 0.34 },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.42,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'volcanic-basalt-flows',
    label: 'Volcanic Basalt Flows',
    tags: ['volcanic', 'basalt', 'flow'],
    biomes: {
      tags: ['volcanic', 'lowland'],
    },
    climate: {
      temperature: { min: 0.55, max: 0.88, ideal: 0.76 },
      moisture: { min: 0.18, max: 0.48, ideal: 0.3 },
    },
    adjacency: {
      preferTags: ['volcanic', 'lava'],
      avoidTags: ['aquatic'],
    },
    blend: 0.78,
    overrides: {
      operatorWeights: [0.92, 0.54],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.32,
          envelope: { amplitude: { multiplier: 1.14 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.74,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
      ],
    },
  },
  {
    id: 'volcanic-tube-collapse',
    label: 'Volcanic Tube Collapse',
    tags: ['volcanic', 'tube', 'collapse'],
    biomes: {
      tags: ['volcanic', 'subterranean'],
    },
    climate: {
      temperature: { min: 0.52, max: 0.86, ideal: 0.74 },
      moisture: { min: 0.2, max: 0.52, ideal: 0.34 },
    },
    adjacency: {
      preferTags: ['volcanic', 'cavern'],
      avoidTags: ['wetland'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [0.96, 0.68, 0.44, 0.5, 0.58, 0.64],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.34,
          envelope: { amplitude: { multiplier: 1.16 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.8,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.44,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 24, z: -20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.5,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.58 } },
          envelope: { amplitude: { multiplier: 0.54 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.62,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.64,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.6,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'fungal-stalk-bridges',
    label: 'Fungal Stalk Bridges',
    tags: ['fungal', 'stalk', 'bridge'],
    biomes: {
      ids: ['noctilucent_fungus_glade'],
      tags: ['fungal', 'wetland'],
    },
    climate: {
      temperature: { min: 0.36, max: 0.62, ideal: 0.48 },
      moisture: { min: 0.7, max: 0.98, ideal: 0.86 },
    },
    adjacency: {
      preferTags: ['fungal', 'wetland'],
      avoidTags: ['arid'],
    },
    blend: 0.88,
    overrides: {
      operatorWeights: [0.84, 0.48, 0.4, 0.36, 0.5, 0.74],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.18,
          envelope: { amplitude: { multiplier: 1 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.58,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.4,
          modulation: { frequency: -0.18 },
          envelope: { warp: { x: 18, z: 26 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.34,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.46 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.78,
          transfer: { id: 'sigmoid' },
          modulation: { amplitude: { multiplier: 0.42 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.46,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.3,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.6,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.56,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'tectonic-worley->diffusion-mask:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'fungal-spore-cauldron',
    label: 'Fungal Spore Cauldron',
    tags: ['fungal', 'spore', 'cauldron'],
    biomes: {
      ids: ['noctilucent_fungus_glade'],
      tags: ['fungal', 'humid'],
    },
    climate: {
      temperature: { min: 0.34, max: 0.6, ideal: 0.46 },
      moisture: { min: 0.74, max: 1, ideal: 0.9 },
    },
    adjacency: {
      preferTags: ['fungal', 'humid'],
      avoidTags: ['arid'],
    },
    blend: 0.9,
    overrides: {
      operatorWeights: [0.88, 0.46, 0.36, 0.32, 0.54, 0.8],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.16,
          envelope: { amplitude: { multiplier: 0.98 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.56,
          modulation: { amplitude: { multiplier: 0.18 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.36,
          modulation: { frequency: -0.2 },
          envelope: { warp: { x: 20, z: 30 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.32,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.56 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.84,
          transfer: { id: 'smoothstep', smoothness: 0.42 },
          modulation: { amplitude: { multiplier: 0.46 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.5,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.32,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'cavern-ember-terraces',
    label: 'Cavern Ember Terraces',
    tags: ['cavern', 'ember', 'terrace'],
    biomes: {
      tags: ['subterranean', 'volcanic'],
    },
    climate: {
      temperature: { min: 0.48, max: 0.82, ideal: 0.7 },
      moisture: { min: 0.24, max: 0.58, ideal: 0.36 },
    },
    adjacency: {
      preferTags: ['subterranean', 'volcanic'],
      avoidTags: ['arid'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [0.98, 0.64, 0.44, 0.46, 0.54, 0.6],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.3,
          envelope: { amplitude: { multiplier: 1.12 } },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.76,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.42,
          modulation: { frequency: 0.18 },
          envelope: { warp: { x: 22, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.42,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.56 } },
          envelope: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.66,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->anisotropic-banding:amplitude',
          gain: 0.28,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'highland-corrugated-massif',
    label: 'Highland Corrugated Massif',
    tags: ['highland', 'corrugated', 'massif'],
    biomes: {
      tags: ['mountain', 'upland'],
    },
    climate: {
      temperature: { min: 0.34, max: 0.62, ideal: 0.48 },
      moisture: { min: 0.3, max: 0.6, ideal: 0.42 },
    },
    adjacency: {
      preferTags: ['upland', 'rocky'],
      avoidTags: ['wetland'],
    },
    blend: 0.82,
    overrides: {
      operatorWeights: [1.02, 0.78, 0.54, 0.48, 0.46, 0.52],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.32,
          envelope: { amplitude: { multiplier: 1.14 } },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.88,
          modulation: { amplitude: { multiplier: 0.24 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: -0.2 },
          envelope: { warp: { x: 28, z: -18 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.46,
          modulation: { amplitude: { multiplier: 0.3 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.5 } },
          envelope: { amplitude: { multiplier: 0.48 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.56,
          transfer: { id: 'smoothstep', smoothness: 0.36 },
          modulation: { amplitude: { multiplier: 0.32 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.34,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.58,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.54,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.44,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.32,
        },
      ],
    },
  },
  {
    id: 'highland-stepwall-terraces',
    label: 'Highland Stepwall Terraces',
    tags: ['highland', 'stepwall', 'terrace'],
    biomes: {
      tags: ['mountain', 'structured'],
    },
    climate: {
      temperature: { min: 0.36, max: 0.64, ideal: 0.5 },
      moisture: { min: 0.28, max: 0.54, ideal: 0.38 },
    },
    adjacency: {
      preferTags: ['structured', 'upland'],
      avoidTags: ['wetland'],
    },
    blend: 0.8,
    overrides: {
      operatorWeights: [0.96, 0.7, 0.5, 0.44, 0.52, 0.58],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.28,
          envelope: { amplitude: { multiplier: 1.08 } },
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.8,
          modulation: { amplitude: { multiplier: 0.22 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.48,
          modulation: { frequency: 0.22 },
          envelope: { warp: { x: 26, z: -16 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.44,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.52 } },
          envelope: { amplitude: { multiplier: 0.5 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.6,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.38,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.6,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.56,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
        },
      ],
    },
  },
  {
    id: 'mountain-needle-crown',
    label: 'Mountain Needle Crown',
    tags: ['mountain', 'needle', 'crown'],
    biomes: {
      tags: ['mountain', 'glacial'],
    },
    climate: {
      temperature: { min: 0.18, max: 0.5, ideal: 0.34 },
      moisture: { min: 0.3, max: 0.64, ideal: 0.44 },
    },
    adjacency: {
      preferTags: ['glacial', 'upland'],
      avoidTags: ['arid'],
    },
    blend: 0.86,
    overrides: {
      operatorWeights: [1.14, 0.92, 0.56, 0.64, 0.5, 0.48],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.36,
          envelope: { amplitude: { multiplier: 1.22 } },
          modulation: { amplitude: { multiplier: 0.36 } },
        },
        {
          id: 'ridge-noise',
          weight: 1,
          modulation: { amplitude: { multiplier: 0.28 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.54,
          modulation: { frequency: -0.24 },
          envelope: { warp: { x: 32, z: -20 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.6,
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.54 } },
          envelope: { amplitude: { multiplier: 0.52 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.5,
          transfer: { id: 'tanh' },
          modulation: { amplitude: { multiplier: 0.3 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.34,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.3,
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
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.46,
        },
        {
          id: 'tectonic-worley->anisotropic-banding:frequency',
          gain: 0.36,
        },
      ],
    },
  },
  {
    id: 'mountain-ember-ramparts',
    label: 'Mountain Ember Ramparts',
    tags: ['mountain', 'ember', 'rampart'],
    biomes: {
      tags: ['mountain', 'volcanic'],
    },
    climate: {
      temperature: { min: 0.42, max: 0.74, ideal: 0.58 },
      moisture: { min: 0.3, max: 0.6, ideal: 0.4 },
    },
    adjacency: {
      preferTags: ['volcanic', 'upland'],
      avoidTags: ['wetland'],
    },
    blend: 0.84,
    overrides: {
      operatorWeights: [1.06, 0.8, 0.52, 0.58, 0.54, 0.6],
      operators: [
        {
          id: 'primary-fbm',
          bias: 0.34,
          envelope: { amplitude: { multiplier: 1.18 } },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
        {
          id: 'ridge-noise',
          weight: 0.92,
          modulation: { amplitude: { multiplier: 0.26 } },
        },
        {
          id: 'anisotropic-banding',
          weight: 0.5,
          modulation: { frequency: 0.2 },
          envelope: { warp: { x: 30, z: -22 } },
        },
        {
          id: 'tectonic-worley',
          weight: 0.56,
          modulation: { amplitude: { multiplier: 0.32 } },
        },
        {
          id: 'domain-warp',
          modulation: { amplitude: { multiplier: 0.56 } },
          envelope: { amplitude: { multiplier: 0.54 } },
        },
        {
          id: 'diffusion-mask',
          weight: 0.64,
          transfer: { id: 'smoothstep', smoothness: 0.34 },
          modulation: { amplitude: { multiplier: 0.34 } },
        },
      ],
      modulationMatrix: [
        {
          id: 'diffusion-mask->primary-fbm:amplitude',
          gain: 0.36,
        },
        {
          id: 'diffusion-mask->ridge-noise:amplitude',
          gain: 0.32,
        },
        {
          id: 'domain-warp->primary-fbm:domain-x',
          gain: 0.64,
        },
        {
          id: 'domain-warp->primary-fbm:domain-z',
          gain: 0.6,
        },
        {
          id: 'domain-warp->ridge-noise:domain-x',
          gain: 0.48,
        },
        {
          id: 'ridge-noise->domain-warp:amplitude',
          gain: 0.34,
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
