import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeJournalOps, JournalOpId } from '../journal.ts';
import {
  ChunkSnapshotState,
  DEFAULT_COMPACTION_THRESHOLDS,
  decodeSnapshotPayload,
  encodeSnapshotPayload,
  mergeSnapshotWithJournals,
  shouldCompactJournal,
} from '../snapshot.ts';

const index3d = (x: number, y: number, z: number, sizeX: number, sizeY: number): number =>
  x + sizeX * (y + sizeY * z);

test('snapshot payload encodes and decodes consistently', () => {
  const sizeX = 4;
  const sizeY = 2;
  const sizeZ = 2;
  const volume = sizeX * sizeY * sizeZ;
  const blocks = new Uint16Array(Array.from({ length: volume }, (_, i) => (i % 5) + 1));

  const state: ChunkSnapshotState = {
    sizeX,
    sizeY,
    sizeZ,
    blocks,
    metadata: { foo: 'bar' },
    entities: new Map([
      [
        'one',
        {
          id: 'one',
          type: 'crate',
          position: { x: 1, y: 1, z: 1 },
          state: { hp: 3 },
        },
      ],
    ]),
  };

  const encoded = encodeSnapshotPayload(state);
  const decoded = decodeSnapshotPayload(encoded);

  assert.notStrictEqual(decoded.blocks, state.blocks);
  assert.deepStrictEqual(Array.from(decoded.blocks), Array.from(state.blocks));
  assert.deepStrictEqual(decoded.metadata, state.metadata);
  assert.deepStrictEqual(Array.from(decoded.entities.entries()), Array.from(state.entities.entries()));
});

test('mergeSnapshotWithJournals applies journal operations to base state', () => {
  const sizeX = 4;
  const sizeY = 2;
  const sizeZ = 2;
  const volume = sizeX * sizeY * sizeZ;
  const baseBlocks = new Uint16Array(Array.from({ length: volume }, (_, i) => i));

  const baseState: ChunkSnapshotState = {
    sizeX,
    sizeY,
    sizeZ,
    blocks: baseBlocks,
    metadata: { foo: 'bar' },
    entities: new Map([
      [
        'one',
        {
          id: 'one',
          type: 'crate',
          position: { x: 1, y: 0, z: 0 },
          state: { hp: 5 },
        },
      ],
    ]),
  };

  const basePayload = encodeSnapshotPayload(baseState);

  const journalOps = [
    { id: JournalOpId.SET_BLOCKS_RLE, startIndex: 0, spans: [{ value: 7, length: 2 }] },
    {
      id: JournalOpId.VOXEL_RECT,
      origin: { x: 1, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 },
      block: 8,
    },
    { id: JournalOpId.SET_META, key: 'foo', value: 'baz' },
    {
      id: JournalOpId.PLACE_ENTITY,
      entity: {
        id: 'two',
        type: 'lamp',
        position: { x: 1, y: 1, z: 1 },
        state: { glow: true },
      },
    },
    { id: JournalOpId.REMOVE_ENTITY, entityId: 'one' },
  ] as const;

  const journalPayload = encodeJournalOps(journalOps);
  const result = mergeSnapshotWithJournals(basePayload, [journalPayload]);

  assert.strictEqual(result.journalOps, journalOps.length);
  assert.strictEqual(result.journalBytes, journalPayload.byteLength);

  const mergedState = result.state;
  assert.strictEqual(mergedState.metadata.foo, 'baz');
  assert.strictEqual(mergedState.entities.size, 1);
  const entity = mergedState.entities.get('two');
  assert.ok(entity);
  assert.deepStrictEqual(entity, {
    id: 'two',
    type: 'lamp',
    position: { x: 1, y: 1, z: 1 },
    state: { glow: true },
  });

  const i0 = index3d(0, 0, 0, sizeX, sizeY);
  const i1 = index3d(1, 0, 0, sizeX, sizeY);
  assert.strictEqual(mergedState.blocks[i0], 7);
  assert.strictEqual(mergedState.blocks[i1], 8);

  const decoded = decodeSnapshotPayload(result.payload);
  assert.deepStrictEqual(Array.from(decoded.blocks), Array.from(mergedState.blocks));
  assert.deepStrictEqual(decoded.metadata, mergedState.metadata);
  assert.deepStrictEqual(Array.from(decoded.entities.entries()), Array.from(mergedState.entities.entries()));
});

test('shouldCompactJournal respects thresholds', () => {
  const { maxOps = 0, maxBytes = 0 } = DEFAULT_COMPACTION_THRESHOLDS;

  assert.strictEqual(shouldCompactJournal({ entries: 0, bytes: 0 }), false);
  assert.strictEqual(shouldCompactJournal({ entries: maxOps, bytes: 0 }), true);
  assert.strictEqual(shouldCompactJournal({ entries: 1, bytes: maxBytes }, DEFAULT_COMPACTION_THRESHOLDS), true);

  const customThresholds = { maxOps: 5000, maxBytes: 64 };
  assert.strictEqual(shouldCompactJournal({ entries: 100, bytes: 32 }, customThresholds), false);
  assert.strictEqual(shouldCompactJournal({ entries: 6000, bytes: 32 }, customThresholds), true);
  assert.strictEqual(shouldCompactJournal({ entries: 10, bytes: 128 }, customThresholds), true);
});
