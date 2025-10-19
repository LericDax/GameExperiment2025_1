import {
  applyJournalToGrid,
  encodeJournalOps,
  type ChunkJournalState,
  type JournalOp,
  JournalOpId,
} from '../journal.ts';
import {
  ChunkSnapshotState,
  createEmptySnapshotState,
  encodeSnapshotPayload,
} from '../snapshot.ts';

export interface SyntheticChunkFixture {
  key: { cx: number; cy: number; cz: number };
  baseState: ChunkSnapshotState;
  baseSnapshot: Uint8Array;
  journalOps: readonly JournalOp[][];
  journalPayloads: readonly Uint8Array[];
  expectedState: ChunkJournalState;
}

export interface SyntheticWorldFixture {
  chunkSize: number;
  chunks: SyntheticChunkFixture[];
}

interface SpiralOptions {
  radius?: number;
  layers?: number;
  chunkSize?: number;
}

const DEFAULT_SPIRAL_OPTIONS: Required<SpiralOptions> = {
  radius: 2,
  layers: 2,
  chunkSize: 12,
};

export function createSyntheticWorldFixture(options: SpiralOptions = {}): SyntheticWorldFixture {
  const { radius, layers, chunkSize } = { ...DEFAULT_SPIRAL_OPTIONS, ...options };
  const positions = generateSpiralPositions(radius, layers);

  const chunks = positions.map((key, index) => createChunkFixture(key, index, chunkSize));

  return { chunkSize, chunks };
}

function createChunkFixture(
  key: { cx: number; cy: number; cz: number },
  index: number,
  chunkSize: number,
): SyntheticChunkFixture {
  const baseState = createEmptySnapshotState(chunkSize, chunkSize, chunkSize);
  seedBlocks(baseState, index);
  seedMetadata(baseState, key, index);
  seedEntities(baseState, key, index);

  const journalOps = buildJournalOps(baseState, key, index);
  const journalBatches = [
    journalOps.slice(0, 2),
    journalOps.slice(2, 4),
    journalOps.slice(4),
  ];
  const journalPayloads = journalBatches.map((ops) => encodeJournalOps(ops));
  const expectedState = applyJournalToGrid(baseState, journalOps);
  const baseSnapshot = encodeSnapshotPayload(baseState);

  return {
    key,
    baseState,
    baseSnapshot,
    journalOps: journalBatches,
    journalPayloads,
    expectedState,
  } satisfies SyntheticChunkFixture;
}

function seedBlocks(state: ChunkSnapshotState, offset: number): void {
  const { sizeX, sizeY, sizeZ } = state;
  const volume = sizeX * sizeY * sizeZ;
  for (let i = 0; i < volume; i += 1) {
    state.blocks[i] = ((i + offset * 17) % 32) & 0xffff;
  }
}

function seedMetadata(
  state: ChunkSnapshotState,
  key: { cx: number; cy: number; cz: number },
  index: number,
): void {
  state.metadata = {
    biome: index % 2 === 0 ? 'plains' : 'forest',
    seed: index,
    origin: `${key.cx},${key.cy},${key.cz}`,
  };
}

function seedEntities(
  state: ChunkSnapshotState,
  key: { cx: number; cy: number; cz: number },
  index: number,
): void {
  const baseId = `seed-${index}`;
  state.entities = new Map([
    [
      baseId,
      {
        id: baseId,
        type: index % 2 === 0 ? 'crate' : 'crystal',
        position: {
          x: key.cx * 2,
          y: key.cy * 2,
          z: key.cz * 2,
        },
        state: { hp: 5 + index },
      },
    ],
  ]);
}

function buildJournalOps(
  baseState: ChunkSnapshotState,
  key: { cx: number; cy: number; cz: number },
  index: number,
): JournalOp[] {
  const { sizeX, sizeY, sizeZ } = baseState;
  const volume = sizeX * sizeY * sizeZ;
  const totalRle = 6;
  const startIndex = (index * 23) % (volume - totalRle);
  const replaceValueA = (index * 7) % 31;
  const replaceValueB = (index * 11 + 3) % 31;
  const rectOrigin = {
    x: (index * 3) % sizeX,
    y: (index * 5) % sizeY,
    z: (index * 7) % sizeZ,
  };
  const rectSize = {
    x: Math.min(2 + (index % 3), sizeX - rectOrigin.x),
    y: Math.min(1 + (index % 2), sizeY - rectOrigin.y),
    z: Math.min(1 + ((index + 1) % 2), sizeZ - rectOrigin.z),
  };
  const sphereCenter = {
    x: Math.min(sizeX - 1, Math.max(0, Math.round(sizeX / 2 + key.cx % 3))),
    y: Math.min(sizeY - 1, Math.max(0, Math.round(sizeY / 2 + key.cy % 3))),
    z: Math.min(sizeZ - 1, Math.max(0, Math.round(sizeZ / 2 + key.cz % 3))),
  };
  const sphereRadius = 1.5 + (index % 3) * 0.5;
  const placedEntityId = `spawn-${index}`;

  return [
    {
      id: JournalOpId.SET_BLOCKS_RLE,
      startIndex,
      spans: [
        { value: replaceValueA, length: 2 },
        { value: replaceValueB, length: 4 },
      ],
    },
    {
      id: JournalOpId.VOXEL_RECT,
      origin: rectOrigin,
      size: rectSize,
      block: (replaceValueA + replaceValueB) % 64,
    },
    {
      id: JournalOpId.BRUSH_SPHERE,
      center: sphereCenter,
      radius: sphereRadius,
      block: (startIndex + index) % 64,
    },
    {
      id: JournalOpId.SET_META,
      key: 'seed',
      value: `spiral-${index}`,
    },
    {
      id: JournalOpId.PLACE_ENTITY,
      entity: {
        id: placedEntityId,
        type: 'sentinel',
        position: {
          x: key.cx * 2 + 0.5,
          y: key.cy * 2 + 0.25,
          z: key.cz * 2 + 0.75,
        },
        state: { patrol: index % 4 },
      },
    },
    { id: JournalOpId.REMOVE_ENTITY, entityId: `seed-${index}` },
  ] satisfies JournalOp[];
}

function generateSpiralPositions(radius: number, layers: number): Array<{ cx: number; cy: number; cz: number }> {
  const positions: Array<{ cx: number; cy: number; cz: number }> = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const cz = layer;
    positions.push({ cx: 0, cy: 0, cz });
    let x = 0;
    let y = 0;
    let step = 1;
    while (step <= radius) {
      for (let i = 0; i < step; i += 1) {
        x += 1;
        positions.push({ cx: x, cy: y, cz });
      }
      for (let i = 0; i < step; i += 1) {
        y += 1;
        positions.push({ cx: x, cy: y, cz });
      }
      step += 1;
      for (let i = 0; i < step; i += 1) {
        x -= 1;
        positions.push({ cx: x, cy: y, cz });
      }
      for (let i = 0; i < step; i += 1) {
        y -= 1;
        positions.push({ cx: x, cy: y, cz });
      }
      step += 1;
    }
  }
  return positions;
}
