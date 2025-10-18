import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChunkIoQueueProcessor,
  type ChunkIoJobResultMessage,
  type ChunkIoJobResultSuccess,
} from '../opfs-queue-runner.ts';
import { createChunkIoQueue, type ChunkKey } from '../io-queue.ts';

function chunkKeyId(key: ChunkKey): string {
  return `${key.cx}_${key.cy}_${key.cz}`;
}

function isSuccessMessage(message: ChunkIoJobResultMessage): message is ChunkIoJobResultSuccess {
  return message.ok;
}

test('Chunk IO queue processor drains shared queue jobs', async (t) => {
  if (typeof SharedArrayBuffer !== 'function') {
    t.skip('SharedArrayBuffer unavailable in this runtime');
    return;
  }

  const queue = createChunkIoQueue({ capacity: 8 });
  if (!queue.shared || !queue.buffer) {
    t.skip('Shared queue unavailable in this runtime');
    return;
  }

  const messages: ChunkIoJobResultMessage[] = [];
  const commits: Array<{ type: 'snapshot' | 'journal'; key: string; payload: Uint8Array; tick?: number }> = [];
  const snapshotStore = new Map<string, Uint8Array>();
  const journalStore = new Map<string, Uint8Array[]>();

  const processor = new ChunkIoQueueProcessor({
    postMessage: (message) => {
      messages.push(message);
    },
    loadSnapshot: async (key) => {
      const stored = snapshotStore.get(chunkKeyId(key));
      return stored ? stored.slice() : null;
    },
    loadJournal: async (key) => {
      const stored = journalStore.get(chunkKeyId(key)) ?? [];
      return stored.map((entry) => entry.slice());
    },
    commit: async (ops) => {
      for (const op of ops) {
        if (op.type === 'snapshot') {
          const payload = new Uint8Array(op.payload);
          snapshotStore.set(chunkKeyId(op.key), payload.slice());
          commits.push({ type: 'snapshot', key: chunkKeyId(op.key), payload: payload.slice() });
          continue;
        }
        const payload = new Uint8Array(op.payload);
        const key = chunkKeyId(op.key);
        const existing = journalStore.get(key) ?? [];
        existing.push(payload.slice());
        journalStore.set(key, existing);
        commits.push({ type: 'journal', key, payload: payload.slice(), tick: op.tick });
      }
    },
  });

  const config = {
    shared: queue.shared,
    capacity: queue.capacity,
    buffer: queue.buffer,
  } as const;
  processor.configure(config);

  const chunkKey = { cx: 1, cy: 2, cz: 3 } satisfies ChunkKey;

  const snapshotBytes = Uint8Array.from([1, 2, 3, 4]);
  processor.registerPayload(1, snapshotBytes.buffer.slice(0));
  assert.equal(queue.enqueue({ type: 'saveSnapshot', key: chunkKey, payloadRef: 1 }), true);
  await processor.flush();

  assert.equal(commits.length, 1);
  assert.deepEqual(Array.from(commits[0].payload), Array.from(snapshotBytes));
  assert.equal(commits[0].type, 'snapshot');
  assert.equal(commits[0].key, chunkKeyId(chunkKey));

  const saveSnapshotMessage = messages.find(
    (message): message is ChunkIoJobResultSuccess =>
      isSuccessMessage(message) && message.result.kind === 'saveSnapshot',
  );
  assert.ok(saveSnapshotMessage, 'expected saveSnapshot result message');

  messages.length = 0;
  commits.length = 0;

  const storedSnapshot = Uint8Array.from([5, 6, 7]);
  snapshotStore.set(chunkKeyId(chunkKey), storedSnapshot);
  assert.equal(queue.enqueue({ type: 'loadSnapshot', key: chunkKey }), true);
  await processor.flush();

  const loadSnapshotMessage = messages.find(
    (message): message is ChunkIoJobResultSuccess =>
      isSuccessMessage(message) && message.result.kind === 'loadSnapshot',
  );
  assert.ok(loadSnapshotMessage, 'expected loadSnapshot result message');
  if (loadSnapshotMessage.result.kind !== 'loadSnapshot') {
    assert.fail('expected loadSnapshot result payload');
  }
  const snapshotResult = loadSnapshotMessage.result;
  assert.notEqual(snapshotResult.payload, null);
  const loadedSnapshot = new Uint8Array(snapshotResult.payload!);
  assert.deepEqual(Array.from(loadedSnapshot), Array.from(storedSnapshot));

  messages.length = 0;
  commits.length = 0;

  const journalBytes = Uint8Array.from([9, 8, 7, 6]);
  processor.registerPayload(2, journalBytes.buffer.slice(0));
  assert.equal(
    queue.enqueue({ type: 'saveJournal', key: chunkKey, payloadRef: 2, tick: 42 }),
    true,
  );
  await processor.flush();

  assert.equal(commits.length, 1);
  assert.equal(commits[0].type, 'journal');
  assert.equal(commits[0].tick, 42);
  assert.deepEqual(Array.from(commits[0].payload), Array.from(journalBytes));

  assert.equal(queue.enqueue({ type: 'loadJournal', key: chunkKey }), true);
  await processor.flush();

  const loadJournalMessage = messages.find(
    (message): message is ChunkIoJobResultSuccess =>
      isSuccessMessage(message) && message.result.kind === 'loadJournal',
  );
  assert.ok(loadJournalMessage, 'expected loadJournal result message');
  if (loadJournalMessage.result.kind !== 'loadJournal') {
    assert.fail('expected loadJournal result payloads');
  }
  const journalResult = loadJournalMessage.result;
  assert.equal(journalResult.payload.length, 1);
  const loadedJournal = new Uint8Array(journalResult.payload[0]);
  assert.deepEqual(Array.from(loadedJournal), Array.from(journalBytes));

  processor.configure(null);
});
