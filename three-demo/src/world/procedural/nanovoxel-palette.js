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
