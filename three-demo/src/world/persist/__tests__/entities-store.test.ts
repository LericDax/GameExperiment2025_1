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

test('entities region lifecycle persists snapshots and logs', async () => {
  const root = await createRegionRoot();
  const region = await openEntitiesRegion(root, 0, 0, COMPATIBILITY_OPTIONS);
  const chunkIndex = 0;
  const regionPath = path.join(root, 'entities.r.0.0.gea');

  const fresh = loadChunkEntities(region, chunkIndex);
  assert.deepStrictEqual(fresh.snapshot, []);
  assert.deepStrictEqual(fresh.deltas, []);
  assert.deepStrictEqual(fresh.logStats, { entries: 0, bytes: 0 });

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

  const statsAfterPlacements = await appendEntityDeltas(region, chunkIndex, [
    placeA,
    placeB,
  ]);
  assert.strictEqual(statsAfterPlacements.entries, 2);
  assert.ok(statsAfterPlacements.bytes > 0);

  const afterPlacements = loadChunkEntities(region, chunkIndex);
  assert.strictEqual(afterPlacements.snapshot.length, 0);
  assert.strictEqual(afterPlacements.deltas.length, 2);
  assert.deepStrictEqual(afterPlacements.deltas.map((delta) => delta.kind), [
    'place',
    'place',
  ]);
  const loadedA = afterPlacements.deltas[0];
  const loadedB = afterPlacements.deltas[1];
  if (loadedA.kind !== 'place' || loadedB.kind !== 'place') {
    throw new Error('expected placement deltas');
  }
  assert.deepStrictEqual(Array.from(loadedA.record.transform), Array.from(placeA.record.transform));
  assert.deepStrictEqual(loadedA.record.meta, placeA.record.meta);
  assert.deepStrictEqual(Array.from(loadedB.record.transform), Array.from(placeB.record.transform));
  assert.deepStrictEqual(loadedB.record.meta, placeB.record.meta);

  const statsAfterRemoval = await appendEntityDeltas(region, chunkIndex, [
    { kind: 'remove', id: 'entity-a' },
  ]);
  assert.strictEqual(statsAfterRemoval.entries, 3);
  assert.ok(statsAfterRemoval.bytes > statsAfterPlacements.bytes);

  const afterRemoval = loadChunkEntities(region, chunkIndex);
  assert.strictEqual(afterRemoval.deltas.length, 3);
  const lastDelta = afterRemoval.deltas.at(-1);
  assert.ok(lastDelta);
  assert.deepStrictEqual(lastDelta, { kind: 'remove', id: 'entity-a' });
  const survivingRecords = recordsFromDeltas(afterRemoval.deltas);
  assert.deepStrictEqual(Array.from(survivingRecords.keys()), ['entity-b']);
  const survivingRecord = survivingRecords.get('entity-b');
  assert.ok(survivingRecord);

  await compactChunkEntities(region, chunkIndex, [survivingRecord]);
  const afterCompaction = loadChunkEntities(region, chunkIndex);
  assert.strictEqual(afterCompaction.snapshot.length, 1);
  assert.deepStrictEqual(afterCompaction.snapshot[0].id, 'entity-b');
  assert.deepStrictEqual(
    Array.from(afterCompaction.snapshot[0].transform),
    Array.from(survivingRecord.transform),
  );
  assert.deepStrictEqual(afterCompaction.snapshot[0].meta, survivingRecord.meta);
  assert.deepStrictEqual(afterCompaction.deltas, []);
  assert.deepStrictEqual(afterCompaction.logStats, { entries: 0, bytes: 0 });

  const sizeAfterCompaction = (await fs.stat(regionPath)).size;
  assert.ok(sizeAfterCompaction > 0);

  await removeChunkEntities(region, chunkIndex);
  const afterChunkRemoval = loadChunkEntities(region, chunkIndex);
  assert.deepStrictEqual(afterChunkRemoval.snapshot, []);
  assert.deepStrictEqual(afterChunkRemoval.deltas, []);
  assert.deepStrictEqual(afterChunkRemoval.logStats, { entries: 0, bytes: 0 });
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
  const replaced = afterRecreation.deltas[0];
  if (replaced.kind !== 'place') {
    throw new Error('expected placement delta after recreation');
  }
  assert.strictEqual(replaced.record.id, newRecord.id);
  assert.strictEqual(replaced.record.typeId, newRecord.typeId);
  assert.deepStrictEqual(Array.from(replaced.record.transform), Array.from(newRecord.transform));
  assert.deepStrictEqual(replaced.record.meta, newRecord.meta);
});
