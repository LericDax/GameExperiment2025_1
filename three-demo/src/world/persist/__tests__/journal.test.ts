import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyJournalToGrid,
  decodeJournalOps,
  encodeJournalOps,
  JournalOpId,
  type JournalOp,
  ChunkJournalGrid,
} from '../journal.ts';
import { createSyntheticWorldFixture } from './synthetic-world.fixture.ts';

const index3d = (x: number, y: number, z: number, sizeX: number, sizeY: number): number =>
  x + sizeX * (y + sizeY * z);

test('journal operations encode and decode symmetrically', () => {
  const ops: JournalOp[] = [
    {
      id: JournalOpId.SET_BLOCKS_RLE,
      startIndex: 2,
      spans: [
        { value: 5, length: 3 },
        { value: 9, length: 1 },
      ],
    },
    {
      id: JournalOpId.BRUSH_SPHERE,
      center: { x: 1, y: 2, z: 3 },
      radius: 2.5,
      block: 7,
    },
    {
      id: JournalOpId.VOXEL_RECT,
      origin: { x: -1, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 1 },
      block: 4,
    },
    { id: JournalOpId.SET_META, key: 'foo', value: { bar: 1 } },
    {
      id: JournalOpId.PLACE_ENTITY,
      entity: {
        id: 'entity-1',
        type: 'crate',
        position: { x: 1, y: 2, z: 3 },
        state: { hp: 10 },
      },
    },
    { id: JournalOpId.REMOVE_ENTITY, entityId: 'entity-1' },
  ];

  const encoded = encodeJournalOps(ops);
  const decoded = decodeJournalOps(encoded);

  assert.deepStrictEqual(decoded, ops);
});

test('applyJournalToGrid mutates voxel, metadata, and entity state immutably', () => {
  const sizeX = 4;
  const sizeY = 4;
  const sizeZ = 4;
  const blocks = new Uint16Array(sizeX * sizeY * sizeZ);
  const originalMetadata: Record<string, unknown> = {};
  const originalEntities = new Map();

  const grid: ChunkJournalGrid = {
    sizeX,
    sizeY,
    sizeZ,
    blocks,
    metadata: originalMetadata,
    entities: originalEntities,
  };

  const ops: JournalOp[] = [
    { id: JournalOpId.SET_BLOCKS_RLE, startIndex: 0, spans: [{ value: 1, length: 8 }] },
    { id: JournalOpId.SET_META, key: 'foo', value: 123 },
    { id: JournalOpId.SET_META, key: 'bar', value: { enabled: true } },
    {
      id: JournalOpId.PLACE_ENTITY,
      entity: {
        id: 'entity-1',
        type: 'crate',
        position: { x: 1, y: 1, z: 1 },
        state: { hp: 5 },
      },
    },
    {
      id: JournalOpId.VOXEL_RECT,
      origin: { x: 1, y: 0, z: 0 },
      size: { x: 2, y: 1, z: 1 },
      block: 2,
    },
    {
      id: JournalOpId.BRUSH_SPHERE,
      center: { x: 2, y: 0, z: 0 },
      radius: 0.6,
      block: 3,
    },
    { id: JournalOpId.REMOVE_ENTITY, entityId: 'entity-1' },
    { id: JournalOpId.SET_META, key: 'foo', value: null },
    {
      id: JournalOpId.PLACE_ENTITY,
      entity: {
        id: 'entity-2',
        type: 'lamp',
        position: { x: 0, y: 0, z: 0 },
        state: null,
      },
    },
  ];

  const result = applyJournalToGrid(grid, ops);

  // Ensure the original structures were not mutated.
  assert.strictEqual(originalMetadata.hasOwnProperty('bar'), false);
  assert.strictEqual(originalEntities.size, 0);
  assert.notStrictEqual(result.blocks, blocks);

  // Validate voxel updates.
  const i0 = index3d(0, 0, 0, sizeX, sizeY);
  const i1 = index3d(1, 0, 0, sizeX, sizeY);
  const i2 = index3d(2, 0, 0, sizeX, sizeY);
  const i5 = index3d(1, 1, 0, sizeX, sizeY);

  assert.strictEqual(result.blocks[i0], 1);
  assert.strictEqual(result.blocks[i1], 2);
  assert.strictEqual(result.blocks[i2], 3);
  assert.strictEqual(result.blocks[i5], 1);

  // Metadata changes should respect deletions.
  assert.deepStrictEqual(result.metadata, { bar: { enabled: true } });

  // Entities should contain only the last placement.
  assert.strictEqual(result.entities.size, 1);
  const entity = result.entities.get('entity-2');
  assert.ok(entity);
  assert.deepStrictEqual(entity, {
    id: 'entity-2',
    type: 'lamp',
    position: { x: 0, y: 0, z: 0 },
    state: null,
  });
});

test('synthetic world journal batches replay deterministically', () => {
  const fixture = createSyntheticWorldFixture();
  for (const chunk of fixture.chunks) {
    chunk.journalPayloads.forEach((payload, index) => {
      const decoded = decodeJournalOps(payload);
      assert.deepStrictEqual(decoded, chunk.journalOps[index]);
    });

    const flattened = chunk.journalOps.flat();
    const replayed = applyJournalToGrid(chunk.baseState, flattened);

    assert.deepStrictEqual(Array.from(replayed.blocks), Array.from(chunk.expectedState.blocks));
    assert.deepStrictEqual(replayed.metadata, chunk.expectedState.metadata);
    assert.deepStrictEqual(
      Array.from(replayed.entities.entries()),
      Array.from(chunk.expectedState.entities.entries()),
    );
  }
});
