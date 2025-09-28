const NANOVOXEL_DEFINITIONS = [
  {
    id: 'feather-frond',
    baseType: 'leaf',
    baseScale: { x: 0.22, y: 0.05, z: 0.28 },
    defaultTint: '#aef2ff',
    accentTint: '#f0ffff',
    accentStrength: 0.32,
    inheritTintStrength: 0.4,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1.1 },
        accentStrength: 0.18,
      },
      {
        offset: { right: 0.2, up: 0.12, forward: 0.26 },
        scale: { right: 0.82, up: 1, forward: 0.85 },
        accentStrength: 0.35,
      },
      {
        offset: { right: -0.18, up: 0.18, forward: 0.34 },
        scale: { right: 0.7, up: 0.92, forward: 0.78 },
        accentStrength: 0.42,
      },
    ],
  },
  {
    id: 'cactus-needle-bundle',
    baseType: 'log',
    baseScale: { x: 0.05, y: 0.26, z: 0.05 },
    defaultTint: '#ffe2c0',
    accentTint: '#ffd2a8',
    accentStrength: 0.28,
    inheritTintStrength: 0.25,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
      },
      {
        offset: { right: 0.02, up: 0.22, forward: 0.02 },
        scale: { right: 0.65, up: 0.55, forward: 0.65 },
        type: 'leaf',
        accentStrength: 0.4,
      },
    ],
  },
  {
    id: 'coral-frill',
    baseType: 'leaf',
    baseScale: { x: 0.18, y: 0.06, z: 0.18 },
    defaultTint: '#ffb1f0',
    accentTint: '#ffe8ff',
    accentStrength: 0.36,
    inheritTintStrength: 0.3,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1.25, up: 0.85, forward: 1.2 },
        accentStrength: 0.25,
      },
      {
        offset: { right: 0.24, up: 0.12, forward: 0.22 },
        scale: { right: 0.78, up: 0.65, forward: 0.8 },
        accentStrength: 0.4,
      },
      {
        offset: { right: -0.24, up: 0.14, forward: 0.2 },
        scale: { right: 0.78, up: 0.62, forward: 0.8 },
        accentStrength: 0.38,
      },
    ],
  },
  {
    id: 'petal-cluster',
    baseType: 'leaf',
    baseScale: { x: 0.26, y: 0.05, z: 0.2 },
    defaultTint: '#ffd0f6',
    accentTint: '#ffe6ff',
    accentStrength: 0.35,
    inheritTintStrength: 0.28,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.25,
      },
      {
        offset: { right: 0.18, up: 0.06, forward: 0.22 },
        scale: { right: 0.75, up: 1, forward: 0.82 },
        accentStrength: 0.4,
      },
      {
        offset: { right: -0.18, up: 0.06, forward: 0.22 },
        scale: { right: 0.75, up: 1, forward: 0.82 },
        accentStrength: 0.4,
      },
    ],
  },
  {
    id: 'halo-spark',
    baseType: 'leaf',
    baseScale: { x: 0.12, y: 0.12, z: 0.12 },
    defaultTint: '#98f8ff',
    accentTint: '#ffffff',
    accentStrength: 0.55,
    inheritTintStrength: 0.2,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.6,
      },
    ],
  },
  {
    id: 'frost_spicule',
    baseType: 'cryoshard_glass',
    baseScale: { x: 0.08, y: 0.24, z: 0.08 },
    defaultTint: '#b5f2ff',
    accentTint: '#e8ffff',
    accentStrength: 0.4,
    inheritTintStrength: 0.3,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.25,
      },
      {
        offset: { right: 0.04, up: 0.2, forward: -0.02 },
        scale: { right: 0.6, up: 0.85, forward: 0.6 },
        accentStrength: 0.5,
      },
    ],
  },
  {
    id: 'prism_stamen',
    baseType: 'spectra_petal',
    baseScale: { x: 0.16, y: 0.08, z: 0.16 },
    defaultTint: '#ffc8ff',
    accentTint: '#fffbe3',
    accentStrength: 0.42,
    inheritTintStrength: 0.35,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.32,
      },
      {
        offset: { right: 0.14, up: 0.04, forward: 0.12 },
        scale: { right: 0.7, up: 0.9, forward: 0.72 },
        accentStrength: 0.45,
      },
      {
        offset: { right: -0.16, up: 0.05, forward: 0.1 },
        scale: { right: 0.68, up: 0.92, forward: 0.7 },
        accentStrength: 0.45,
      },
    ],
  },
  {
    id: 'lunar_shard',
    baseType: 'selenite_regolith',
    baseScale: { x: 0.14, y: 0.12, z: 0.18 },
    defaultTint: '#f1f7ff',
    accentTint: '#d6e7ff',
    accentStrength: 0.28,
    inheritTintStrength: 0.4,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
      },
      {
        offset: { right: -0.08, up: 0.1, forward: 0.16 },
        scale: { right: 0.72, up: 0.78, forward: 0.85 },
        accentStrength: 0.32,
      },
    ],
  },
  {
    id: 'dust_plume',
    baseType: 'resonant_sand',
    baseScale: { x: 0.22, y: 0.14, z: 0.22 },
    defaultTint: '#ffe8b6',
    accentTint: '#fff3cd',
    accentStrength: 0.3,
    inheritTintStrength: 0.25,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1.1, up: 1, forward: 1.1 },
        accentStrength: 0.22,
      },
      {
        offset: { right: 0.18, up: 0.08, forward: 0.16 },
        scale: { right: 0.8, up: 0.85, forward: 0.78 },
        accentStrength: 0.35,
      },
      {
        offset: { right: -0.18, up: 0.12, forward: 0.18 },
        scale: { right: 0.76, up: 0.88, forward: 0.74 },
        accentStrength: 0.35,
      },
    ],
  },
  {
    id: 'gothic_briar',
    baseType: 'nocturne_bark',
    baseScale: { x: 0.14, y: 0.24, z: 0.14 },
    defaultTint: '#3c1f44',
    accentTint: '#7c4aa8',
    accentStrength: 0.38,
    inheritTintStrength: 0.3,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
      },
      {
        offset: { right: 0.12, up: 0.2, forward: 0.1 },
        scale: { right: 0.65, up: 0.7, forward: 0.62 },
        accentStrength: 0.45,
      },
    ],
  },
  {
    id: 'monolith_sigil',
    baseType: 'monolith_alloy',
    baseScale: { x: 0.18, y: 0.18, z: 0.02 },
    defaultTint: '#384056',
    accentTint: '#6b7bb0',
    accentStrength: 0.5,
    inheritTintStrength: 0.2,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1.2, up: 1.2, forward: 1 },
        accentStrength: 0.45,
      },
      {
        offset: { right: -0.04, up: 0.04, forward: 0.02 },
        scale: { right: 0.7, up: 0.7, forward: 1 },
        accentStrength: 0.55,
      },
    ],
  },
  {
    id: 'viral_spore',
    baseType: 'macrovirus_chitin',
    baseScale: { x: 0.12, y: 0.12, z: 0.12 },
    defaultTint: '#f1a37a',
    accentTint: '#ffe2c8',
    accentStrength: 0.48,
    inheritTintStrength: 0.32,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.38,
      },
      {
        offset: { right: 0.08, up: 0.06, forward: 0.1 },
        scale: { right: 0.75, up: 0.85, forward: 0.78 },
        accentStrength: 0.52,
      },
    ],
  },
  {
    id: 'ossuary_filament',
    baseType: 'ossified_soil',
    baseScale: { x: 0.18, y: 0.06, z: 0.18 },
    defaultTint: '#f2d9c6',
    accentTint: '#fff3e6',
    accentStrength: 0.34,
    inheritTintStrength: 0.28,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1.1, up: 0.95, forward: 1.1 },
        accentStrength: 0.3,
      },
      {
        offset: { right: 0.2, up: 0.06, forward: 0.18 },
        scale: { right: 0.78, up: 0.9, forward: 0.76 },
        accentStrength: 0.4,
      },
      {
        offset: { right: -0.18, up: 0.08, forward: 0.16 },
        scale: { right: 0.76, up: 0.88, forward: 0.74 },
        accentStrength: 0.4,
      },
    ],
  },
  {
    id: 'neon_drop',
    baseType: 'neon_bark',
    baseScale: { x: 0.1, y: 0.18, z: 0.1 },
    defaultTint: '#38d6ff',
    accentTint: '#ff6df5',
    accentStrength: 0.55,
    inheritTintStrength: 0.35,
    elements: [
      {
        offset: { right: 0, up: 0, forward: 0 },
        scale: { right: 1, up: 1, forward: 1 },
        accentStrength: 0.45,
      },
      {
        offset: { right: -0.06, up: 0.16, forward: -0.02 },
        scale: { right: 0.6, up: 0.7, forward: 0.6 },
        accentStrength: 0.6,
      },
    ],
  },
];

const NANOVOXEL_MAP = new Map(NANOVOXEL_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getNanovoxelDefinition(id) {
  if (typeof id !== 'string') {
    return null;
  }
  return NANOVOXEL_MAP.get(id) ?? null;
}

export function listNanovoxelDefinitions() {
  return Array.from(NANOVOXEL_MAP.keys());
}

export default getNanovoxelDefinition;
