import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeJournalOps } from '../journal.ts';
import { decodeSnapshotPayload, mergeSnapshotWithJournals } from '../snapshot.ts';
import { createSyntheticWorldFixture } from './synthetic-world.fixture.ts';

test('synthetic spiral world survives persistence cycles', async (t) => {
  const fixture = createSyntheticWorldFixture();
  for (const chunk of fixture.chunks) {
    const title = `chunk (${chunk.key.cx},${chunk.key.cy},${chunk.key.cz})`;
    await t.test(title, () => {
      chunk.journalPayloads.forEach((payload, index) => {
        const decoded = decodeJournalOps(payload);
        assert.deepStrictEqual(decoded, chunk.journalOps[index]);
      });

      const merged = mergeSnapshotWithJournals(chunk.baseSnapshot, chunk.journalPayloads);
      const expectedOps = chunk.journalOps.reduce((total, ops) => total + ops.length, 0);
      const expectedBytes = chunk.journalPayloads.reduce((total, payload) => total + payload.byteLength, 0);

      assert.strictEqual(merged.journalOps, expectedOps);
      assert.strictEqual(merged.journalBytes, expectedBytes);
      assert.deepStrictEqual(Array.from(merged.state.blocks), Array.from(chunk.expectedState.blocks));
      assert.deepStrictEqual(merged.state.metadata, chunk.expectedState.metadata);
      assert.deepStrictEqual(
        Array.from(merged.state.entities.entries()),
        Array.from(chunk.expectedState.entities.entries()),
      );

      const decoded = decodeSnapshotPayload(merged.payload);
      assert.deepStrictEqual(Array.from(decoded.blocks), Array.from(chunk.expectedState.blocks));
      assert.deepStrictEqual(decoded.metadata, chunk.expectedState.metadata);
      assert.deepStrictEqual(
        Array.from(decoded.entities.entries()),
        Array.from(chunk.expectedState.entities.entries()),
      );

      const reloaded = mergeSnapshotWithJournals(merged.payload, []);
      assert.deepStrictEqual(Array.from(reloaded.state.blocks), Array.from(chunk.expectedState.blocks));
      assert.deepStrictEqual(reloaded.state.metadata, chunk.expectedState.metadata);
      assert.deepStrictEqual(
        Array.from(reloaded.state.entities.entries()),
        Array.from(chunk.expectedState.entities.entries()),
      );
    });
  }
});
