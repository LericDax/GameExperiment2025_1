import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunkPayload, chunkWorldBounds } from '../chunk-build-core.js';

const coordinateKey = (x, y, z) => `${Math.round(x)}|${Math.round(y)}|${Math.round(z)}`;

const assertFloatArrayClose = (actual, expected, epsilon = 1e-5) => {
  const values = Array.from(actual);
  assert.strictEqual(values.length, expected.length);
  values.forEach((value, index) => {
    const difference = Math.abs(value - expected[index]);
    assert.ok(
      difference <= epsilon,
      `entry ${index} expected ${expected[index]} but received ${value} (Δ=${difference})`,
    );
  });
};

const buildMetadataKeys = () => [
  'biome',
  'lifecycleCues',
  'auroraIntensitySum',
  'auroraIntensitySamples',
  'glowBiasSum',
  'glowBiasSamples',
  'pulseRateSum',
  'pulseRateSamples',
  'ridgeStrengthSum',
  'ridgeStrengthSamples',
  'orientationVector',
  'orientationSamples',
  'flowDirectionHint',
  'flowDirectionHintSamples',
  'flowStrengthHintSum',
  'flowStrengthHintSamples',
  'foamHint',
  'localAuroraIntensity',
  'localAuroraGlow',
  'localPulseRate',
  'ridgeStrength',
  'ribbonOrientation',
  'ribbonVector',
  'ribbonSegments',
  'ribbonSpan',
  'ribbonHeight',
];

test('buildChunkPayload normalizes occupancy, fluid, and decoration payloads', () => {
  const chunkX = 0;
  const chunkZ = 0;
  const worldOptions = { chunkSize: 16, waterLevel: 3 };
  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ, worldOptions);

  const primaryPosition = { x: minX + 2, y: 4.4, z: minZ + 1 };
  const secondaryPosition = { x: minX + 8, y: 7.6, z: minZ + 6.8 };

  const primaryPayload = {
    material: 'stone',
    tint: new Float32Array([0.1, 0.2, 0.3]),
  };
  const secondaryPayload = {
    material: 'glass',
    metadata: { variant: 'clear' },
  };

  const primaryPlacement = {
    type: 'vox:stone',
    position: primaryPosition,
    collisionMode: 'solid',
    gridPosition: { x: 1, y: 2, z: 3 },
    gridIndex: 5,
    payload: primaryPayload,
  };

  const secondaryPlacement = {
    type: 'vox:glass',
    position: secondaryPosition,
    collisionMode: 'soft',
    gridPosition: { x: 0, y: Number.NaN, z: 1 },
    gridIndex: '7',
    isVisible: true,
    payload: secondaryPayload,
  };

  const removedPlacement = {
    type: 'vox:stone',
    position: { x: minX + 4, y: 10, z: minZ + 4 },
    collisionMode: 'solid',
    removed: true,
  };

  const primaryCoordinate = coordinateKey(
    primaryPosition.x,
    primaryPosition.y,
    primaryPosition.z,
  );
  const secondaryCoordinate = coordinateKey(
    secondaryPosition.x,
    secondaryPosition.y,
    secondaryPosition.z,
  );

  const waterMetadata = new Map([
    ['water:0', { bottomY: 1.25, surfaceY: 3.75 }],
    ['water:1', { bottomY: undefined, surfaceY: null }],
  ]);

  const waterColumns = [
    {
      key: 'water-column-1',
      x: primaryPosition.x,
      z: primaryPosition.z,
      minY: 4.1,
      maxY: 6.2,
      depth: 2.5,
      color: { r: 0.1, g: 0.2, b: 0.3 },
      flowDirection: { x: -1, y: 0.5 },
      flowStrength: 0.8,
      foamAmount: 0.2,
      shoreline: 0.1,
      isExposed: true,
      biome: 'crystal',
      lifecycleCues: new Set(['glow', 'crest']),
      auroraIntensitySum: 5,
      auroraIntensitySamples: 2,
      glowBiasSum: 1,
      glowBiasSamples: 3,
      pulseRateSum: 7,
      pulseRateSamples: 4,
      ridgeStrengthSum: 0.3,
      ridgeStrengthSamples: 2,
      orientationVector: { x: 0, y: 1, z: 0 },
      orientationSamples: 9,
      flowDirectionHint: { x: 1, y: 0 },
      flowDirectionHintSamples: 2,
      flowStrengthHintSum: 0.5,
      flowStrengthHintSamples: 3,
      foamHint: 0.9,
      localAuroraIntensity: 0.8,
      localAuroraGlow: 0.6,
      localPulseRate: 0.4,
      ridgeStrength: 0.7,
      ribbonOrientation: 0.2,
      ribbonVector: { x: 0, y: 0.5, z: 1 },
      ribbonSegments: [1, 2, 3],
      ribbonSpan: 5,
      ribbonHeight: 2,
    },
    {
      x: primaryPosition.x + 1,
      z: primaryPosition.z + 2,
      minY: 5,
    },
  ];

  const acidColumns = new Map([
    [
      'acid-primary',
      {
        key: 'acid-column-0',
        x: minX + 4,
        z: minZ + 4,
        minY: 3,
        maxY: 4,
        flowStrength: 0.4,
      },
    ],
  ]);

  const decorationEntry = {
    key: 'fern-a',
    payload: {
      transform: new Float32Array([1, 0, 0, 0]),
      tags: ['flora'],
    },
  };

  const engine = {
    blockPlacements: [
      primaryPlacement,
      secondaryPlacement,
      null,
      removedPlacement,
    ],
    fluidBlockKeys: [
      { key: primaryCoordinate },
      { key: '-100|0|-100' },
      '30|4|30',
    ],
    waterColumnMetadata: waterMetadata,
    fluidColumnsByType: new Map([
      ['water', waterColumns],
      ['acid', acidColumns],
    ]),
    fluidSurfaces: [
      {
        userData: {
          type: 'fluid:water',
          lifecycleCues: ['crest'],
          auroraIntensity: 0.33,
          ribbonOrientation: 1.2,
        },
      },
      {
        userData: {
          type: 'fluid:acid',
          lifecycleCues: ['bubble'],
        },
      },
      null,
    ],
    decorationInstancedData: new Map([
      ['flora', [decorationEntry]],
    ]),
    decorationData: new Map([
      ['flora', { capacity: 10 }],
    ]),
    decorationGroups: new Map([
      [
        'group-a',
        {
          key: 'group-a',
          type: 'flora',
          owner: 'settlement',
          destructible: false,
          instanceIndices: [0, 2],
        },
      ],
    ]),
    decorationOwnerIndex: new Map([
      ['settlement', new Set(['group-a'])],
    ]),
    decorationTypeIndex: new Map([
      ['flora', new Set([{ key: 'group-a' }, { key: 'group-b' }])],
    ]),
  };

  const payload = buildChunkPayload({
    chunkX,
    chunkZ,
    engine,
    worldOptions,
    includeBlockPlacements: true,
  });

  const { occupancy } = payload;
  assert.strictEqual(occupancy.minY, 4);
  assert.strictEqual(occupancy.maxY, 8);
  assert.strictEqual(occupancy.width, 16);
  assert.strictEqual(occupancy.depth, 16);
  assert.strictEqual(occupancy.height, 5);

  const occupancyArea = occupancy.width * occupancy.depth;
  const volume = occupancyArea * occupancy.height;
  assert.strictEqual(occupancy.types.length, volume);
  assert.strictEqual(occupancy.placements.length, volume);
  assert.strictEqual(occupancy.fluid.length, volume);

  const typeStone = payload.typeIndex.byType['vox:stone'];
  const typeGlass = payload.typeIndex.byType['vox:glass'];
  assert.deepStrictEqual(payload.typeIndex.entries, [
    { type: 'vox:stone', id: typeStone },
    { type: 'vox:glass', id: typeGlass },
  ]);

  const toOccupancyIndex = (position) => {
    const localX = Math.round(position.x - minX);
    const localZ = Math.round(position.z - minZ);
    const localY = Math.round(position.y) - occupancy.minY;
    return localY * occupancyArea + localZ * occupancy.width + localX;
  };

  const primaryIndex = toOccupancyIndex(primaryPosition);
  const secondaryIndex = toOccupancyIndex(secondaryPosition);

  assert.strictEqual(occupancy.types[primaryIndex], typeStone);
  assert.strictEqual(occupancy.placements[primaryIndex], 0);
  assert.strictEqual(occupancy.fluid[primaryIndex], 1);

  assert.strictEqual(occupancy.types[secondaryIndex], typeGlass);
  assert.strictEqual(occupancy.placements[secondaryIndex], 1);
  assert.strictEqual(occupancy.fluid[secondaryIndex], 0);

  let fluidCount = 0;
  occupancy.fluid.forEach((value) => {
    fluidCount += value;
  });
  assert.strictEqual(fluidCount, 1);

  assert.deepStrictEqual(occupancy.solidCoordinates, [primaryCoordinate]);
  assert.deepStrictEqual(occupancy.softCoordinates, [secondaryCoordinate]);
  assert.deepStrictEqual(occupancy.coordinateIndex, {
    [primaryCoordinate]: 0,
    [secondaryCoordinate]: 1,
  });

  assert.deepStrictEqual(payload.blockPlacements, [
    {
      index: 0,
      key: null,
      coordinateKey: primaryCoordinate,
      type: 'vox:stone',
      collisionMode: 'solid',
      isSolid: true,
      isSoft: false,
      isVisible: false,
      gridIndex: 5,
      gridPosition: { x: 1, y: 2, z: 3 },
      payload: primaryPayload,
    },
    {
      index: 1,
      key: null,
      coordinateKey: secondaryCoordinate,
      type: 'vox:glass',
      collisionMode: 'soft',
      isSolid: false,
      isSoft: true,
      isVisible: true,
      gridIndex: -1,
      gridPosition: null,
      payload: secondaryPayload,
    },
  ]);

  assert.deepStrictEqual(payload.fluids.blockKeys, [
    primaryCoordinate,
    '-100|0|-100',
    '30|4|30',
  ]);

  assert.deepStrictEqual(Array.from(payload.fluids.waterColumns.keys), [
    'water:0',
    'water:1',
  ]);
  assertFloatArrayClose(payload.fluids.waterColumns.bottomY, [1.25, 0]);
  assertFloatArrayClose(payload.fluids.waterColumns.surfaceY, [3.75, 0]);

  const [waterRecord, acidRecord] = payload.fluids.columnsByType;
  assert.strictEqual(waterRecord.type, 'water');
  assert.deepStrictEqual(Array.from(waterRecord.keys), [
    'water-column-1',
    '-5|-5',
  ]);
  assertFloatArrayClose(waterRecord.positions.x, [primaryPosition.x, primaryPosition.x + 1]);
  assertFloatArrayClose(waterRecord.positions.z, [primaryPosition.z, primaryPosition.z + 2]);
  assertFloatArrayClose(waterRecord.minY, [4.1, 5]);
  assertFloatArrayClose(waterRecord.maxY, [6.2, 5]);
  assertFloatArrayClose(waterRecord.depth, [2.5, 0]);
  assertFloatArrayClose(waterRecord.colors, [0.1, 0.2, 0.3, 0, 0, 0]);
  assertFloatArrayClose(waterRecord.flowDirection, [-1, 0.5, 0, 0]);
  assertFloatArrayClose(waterRecord.flowStrength, [0.8, 0]);
  assertFloatArrayClose(waterRecord.foamAmount, [0.2, 0]);
  assertFloatArrayClose(waterRecord.shoreline, [0.1, 0]);
  assert.deepStrictEqual(
    Array.from(waterRecord.exposed),
    [1, 0],
  );

  const metadataKeys = buildMetadataKeys();
  const expectedWaterMetadata = {
    biome: 'crystal',
    lifecycleCues: ['glow', 'crest'],
    auroraIntensitySum: 5,
    auroraIntensitySamples: 2,
    glowBiasSum: 1,
    glowBiasSamples: 3,
    pulseRateSum: 7,
    pulseRateSamples: 4,
    ridgeStrengthSum: 0.3,
    ridgeStrengthSamples: 2,
    orientationVector: { x: 0, y: 1, z: 0 },
    orientationSamples: 9,
    flowDirectionHint: { x: 1, y: 0 },
    flowDirectionHintSamples: 2,
    flowStrengthHintSum: 0.5,
    flowStrengthHintSamples: 3,
    foamHint: 0.9,
    localAuroraIntensity: 0.8,
    localAuroraGlow: 0.6,
    localPulseRate: 0.4,
    ridgeStrength: 0.7,
    ribbonOrientation: 0.2,
    ribbonVector: { x: 0, y: 0.5, z: 1 },
    ribbonSegments: [1, 2, 3],
    ribbonSpan: 5,
    ribbonHeight: 2,
  };
  metadataKeys.forEach((key) => {
    if (!(key in expectedWaterMetadata)) {
      expectedWaterMetadata[key] = null;
    }
  });
  assert.deepStrictEqual(waterRecord.metadata[0], expectedWaterMetadata);

  const expectedNullMetadata = Object.fromEntries(
    metadataKeys.map((key) => [key, null]),
  );
  assert.deepStrictEqual(waterRecord.metadata[1], expectedNullMetadata);

  assert.strictEqual(acidRecord.type, 'acid');
  assert.deepStrictEqual(Array.from(acidRecord.keys), ['acid-column-0']);
  assertFloatArrayClose(acidRecord.positions.x, [minX + 4]);
  assertFloatArrayClose(acidRecord.positions.z, [minZ + 4]);
  assertFloatArrayClose(acidRecord.minY, [3]);
  assertFloatArrayClose(acidRecord.maxY, [4]);
  assertFloatArrayClose(acidRecord.depth, [1]);
  assertFloatArrayClose(acidRecord.flowStrength, [0.4]);
  assert.deepStrictEqual(
    Array.from(acidRecord.exposed),
    [0],
  );
  assert.deepStrictEqual(acidRecord.metadata[0], expectedNullMetadata);

  assert.deepStrictEqual(payload.fluids.surfaces, [
    {
      type: 'water',
      columnKeys: ['water-column-1'],
      lifecycleCues: ['crest'],
      auroraIntensity: 0.33,
      ribbonOrientation: 1.2,
    },
    {
      type: 'acid',
      columnKeys: [],
      lifecycleCues: ['bubble'],
      auroraIntensity: null,
      ribbonOrientation: null,
    },
  ]);

  assert.deepStrictEqual(payload.decorations.batches, [
    {
      type: 'flora',
      capacity: 10,
      entryKeys: ['fern-a'],
      entries: [
        {
          transform: [1, 0, 0, 0],
          tags: ['flora'],
        },
      ],
    },
  ]);

  assert.deepStrictEqual(payload.decorations.groups, [
    {
      key: 'group-a',
      type: 'flora',
      owner: 'settlement',
      destructible: false,
      entryIndices: new Uint32Array([0, 2]),
    },
  ]);

  assert.deepStrictEqual(payload.decorations.ownerIndex, {
    settlement: ['group-a'],
  });

  assert.deepStrictEqual(payload.decorations.typeIndex, {
    flora: ['group-a', 'group-b'],
  });
});

test('buildChunkPayload omits block placements unless requested', () => {
  const chunkX = 0;
  const chunkZ = 0;
  const worldOptions = { chunkSize: 16, waterLevel: 0 };
  const { minX, minZ } = chunkWorldBounds(chunkX, chunkZ, worldOptions);

  const engine = {
    blockPlacements: [
      {
        type: 'vox:test',
        position: { x: minX + 1, y: 2, z: minZ + 1 },
        collisionMode: 'solid',
        payload: { foo: 'bar' },
      },
    ],
    fluidBlockKeys: [],
    waterColumnMetadata: new Map(),
    fluidColumnsByType: new Map(),
    fluidSurfaces: [],
    decorationInstancedData: new Map(),
    decorationGroups: new Map(),
    decorationOwnerIndex: new Map(),
    decorationTypeIndex: new Map(),
    decorationData: new Map(),
    typeCapacities: new Map(),
    typeData: new Map(),
    biomePresence: new Map(),
    prototypeInstances: new Map(),
  };

  const payload = buildChunkPayload({
    chunkX,
    chunkZ,
    engine,
    worldOptions,
  });

  assert.strictEqual(payload.blockPlacements, null);
  assert.ok(Array.isArray(payload.occupancy?.solidCoordinates));
  assert.strictEqual(typeof payload.occupancy?.coordinateIndex, 'object');
});
