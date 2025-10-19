import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import {
  appendEntityDeltas,
  compactChunkEntities,
  loadChunkEntities,
  openEntitiesRegion,
  removeChunkEntities,
  type EntityDelta,
  type PersistedEntityRecord,
} from '../entities-store.ts';

declare global {
  interface FileSystemWritableFileStream {
    write(
      data: FileSystemWriteChunkType | Uint8Array<ArrayBufferLike>,
    ): Promise<void>;
  }
}

const COMPATIBILITY_OPTIONS = {
  regionSize: 4,
  worldUuid: '00000000-0000-0000-0000-000000000000',
  schemaVersion: 1,
} as const;

const TEMP_DIRECTORIES: string[] = [];

test.after(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createRegionRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'entities-store-'));
  TEMP_DIRECTORIES.push(dir);
  return dir;
}

function createTransform(values: number[]): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  values.forEach((value, index) => {
    if (index < 16) {
      matrix[index] = value;
    }
  });
  return matrix;
}

function recordsFromDeltas(deltas: EntityDelta[]): Map<string, PersistedEntityRecord> {
  const records = new Map<string, PersistedEntityRecord>();
  for (const delta of deltas) {
    if (delta.kind === 'place') {
      records.set(delta.record.id, delta.record);
    } else {
      records.delete(delta.id);
    }
  }
  return records;
}

test('entities region lifecycle persists snapshots and logs', async (t) => {
  const root = await createRegionRoot();
  const region = await openEntitiesRegion(root, 0, 0, COMPATIBILITY_OPTIONS);
  const chunkIndex = 0;
  const regionPath = path.join(root, 'entities.r.0.0.gea');

  await t.test('fresh region has no snapshot or log entries', () => {
    const loaded = loadChunkEntities(region, chunkIndex);
    assert.deepStrictEqual(loaded.snapshot, []);
    assert.deepStrictEqual(loaded.deltas, []);
    assert.deepStrictEqual(loaded.logStats, { entries: 0, bytes: 0 });
  });

  const placeA: EntityDelta = {
    kind: 'place',
    record: {
      id: 'entity-a',
      typeId: 'crate',
      transform: createTransform([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        3, 4, 5, 1,
      ]),
      meta: { hp: 10 },
    },
  };
  const placeB: EntityDelta = {
    kind: 'place',
    record: {
      id: 'entity-b',
      typeId: 'lamp',
      transform: createTransform([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        -2, 6, 1, 1,
      ]),
      meta: { powered: true },
    },
  };

  let statsAfterPlacements: Awaited<ReturnType<typeof appendEntityDeltas>>;
  await t.test('appending placements records deltas with transforms and metadata', async () => {
    statsAfterPlacements = await appendEntityDeltas(region, chunkIndex, [placeA, placeB]);
    assert.strictEqual(statsAfterPlacements.entries, 2);
    assert.ok(statsAfterPlacements.bytes > 0);

    const loaded = loadChunkEntities(region, chunkIndex);
    assert.deepStrictEqual(loaded.snapshot, []);
    assert.strictEqual(loaded.deltas.length, 2);
    const [first, second] = loaded.deltas;
    assert.ok(first?.kind === 'place');
    assert.ok(second?.kind === 'place');
    assert.strictEqual(first.record.id, placeA.record.id);
    assert.strictEqual(second.record.id, placeB.record.id);
    assert.deepStrictEqual(Array.from(first.record.transform), Array.from(placeA.record.transform));
    assert.deepStrictEqual(Array.from(second.record.transform), Array.from(placeB.record.transform));
    assert.deepStrictEqual(first.record.meta, placeA.record.meta);
    assert.deepStrictEqual(second.record.meta, placeB.record.meta);
  });

  let survivingRecord: PersistedEntityRecord | undefined;
  let statsAfterRemoval: Awaited<ReturnType<typeof appendEntityDeltas>>;
  await t.test('removing an entity leaves only surviving records', async () => {
    statsAfterRemoval = await appendEntityDeltas(region, chunkIndex, [
      { kind: 'remove', id: 'entity-a' },
    ]);
    assert.strictEqual(statsAfterRemoval.entries, 3);
    assert.ok(statsAfterRemoval.bytes > statsAfterPlacements.bytes);

    const loaded = loadChunkEntities(region, chunkIndex);
    const records = recordsFromDeltas(loaded.deltas);
    assert.deepStrictEqual(Array.from(records.keys()), ['entity-b']);
    survivingRecord = records.get('entity-b');
    assert.ok(survivingRecord);
  });

  let sizeAfterCompaction = 0;
  await t.test('compaction rewrites snapshot and resets log stats', async () => {
    assert.ok(survivingRecord);
    await compactChunkEntities(region, chunkIndex, [survivingRecord]);

    const loaded = loadChunkEntities(region, chunkIndex);
    assert.strictEqual(loaded.snapshot.length, 1);
    const [snapshotRecord] = loaded.snapshot;
    assert.strictEqual(snapshotRecord.id, survivingRecord.id);
    assert.strictEqual(snapshotRecord.typeId, survivingRecord.typeId);
    assert.deepStrictEqual(Array.from(snapshotRecord.transform), Array.from(survivingRecord.transform));
    assert.deepStrictEqual(snapshotRecord.meta, survivingRecord.meta);
    assert.deepStrictEqual(loaded.deltas, []);
    assert.deepStrictEqual(loaded.logStats, { entries: 0, bytes: 0 });

    const stats = await fs.stat(regionPath);
    sizeAfterCompaction = stats.size;
    assert.ok(sizeAfterCompaction > 0);
  });

  await t.test('removing the chunk clears persisted data and allows recreation', async () => {
    await removeChunkEntities(region, chunkIndex);
    const loaded = loadChunkEntities(region, chunkIndex);
    assert.deepStrictEqual(loaded.snapshot, []);
    assert.deepStrictEqual(loaded.deltas, []);
    assert.deepStrictEqual(loaded.logStats, { entries: 0, bytes: 0 });

    const sizeAfterRemoval = (await fs.stat(regionPath)).size;
    assert.ok(sizeAfterRemoval < sizeAfterCompaction);

    const newRecord: PersistedEntityRecord = {
      id: 'entity-c',
      typeId: 'crystal',
      transform: createTransform([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        8, -3, 2, 1,
      ]),
      meta: { glow: 'blue' },
    };
    await appendEntityDeltas(region, chunkIndex, [{ kind: 'place', record: newRecord }]);
    const sizeAfterRecreation = (await fs.stat(regionPath)).size;
    assert.ok(sizeAfterRecreation > sizeAfterRemoval);

    const afterRecreation = loadChunkEntities(region, chunkIndex);
    assert.strictEqual(afterRecreation.deltas.length, 1);
    const [delta] = afterRecreation.deltas;
    assert.ok(delta?.kind === 'place');
    assert.strictEqual(delta.record.id, newRecord.id);
    assert.deepStrictEqual(Array.from(delta.record.transform), Array.from(newRecord.transform));
    assert.deepStrictEqual(delta.record.meta, newRecord.meta);
  });
});
