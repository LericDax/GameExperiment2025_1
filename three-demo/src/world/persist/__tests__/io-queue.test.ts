import assert from 'node:assert/strict';
import test from 'node:test';

import { createChunkIoQueue } from '../io-queue.ts';

test('shared queue enqueues and dequeues jobs in FIFO order', (t) => {
  if (typeof SharedArrayBuffer !== 'function') {
    t.skip('SharedArrayBuffer unavailable in this runtime');
    return;
  }

  const queue = createChunkIoQueue({ capacity: 4 });
  assert.equal(queue.shared, true);
  assert(queue.buffer instanceof SharedArrayBuffer);
  assert.equal(queue.size(), 0);
  assert.equal(queue.capacity, 4);

  const jobs = [
    { type: 'loadSnapshot', key: { cx: 1, cy: 2, cz: 3 } } as const,
    { type: 'saveSnapshot', key: { cx: 4, cy: 5, cz: 6 }, payloadRef: 42 } as const,
    { type: 'saveJournal', key: { cx: 7, cy: 8, cz: 9 }, payloadRef: 7, tick: 99 } as const,
  ];

  for (const job of jobs) {
    assert.equal(queue.enqueue(job), true);
  }

  assert.equal(queue.size(), jobs.length);
  assert.equal(queue.isFull(), false);
  assert.equal(queue.isEmpty(), false);

  for (const job of jobs) {
    const dequeued = queue.dequeue();
    assert.deepEqual(dequeued, job);
  }

  assert.equal(queue.size(), 0);
  assert.equal(queue.isEmpty(), true);
  assert.equal(queue.dequeue(), null);
});

test('shared queue maintains consistency across multiple views', (t) => {
  if (typeof SharedArrayBuffer !== 'function') {
    t.skip('SharedArrayBuffer unavailable in this runtime');
    return;
  }

  const queueA = createChunkIoQueue({ capacity: 3 });
  const buffer = queueA.buffer;
  assert(buffer instanceof SharedArrayBuffer);
  const queueB = createChunkIoQueue({ buffer });

  assert.equal(queueA.enqueue({ type: 'loadJournal', key: { cx: 1, cy: 1, cz: 1 } }), true);
  assert.equal(queueA.enqueue({ type: 'saveSnapshot', key: { cx: 2, cy: 2, cz: 2 }, payloadRef: 5 }), true);
  assert.equal(queueA.size(), 2);
  assert.equal(queueB.size(), 2);

  assert.deepEqual(queueB.dequeue(), { type: 'loadJournal', key: { cx: 1, cy: 1, cz: 1 } });
  assert.equal(queueB.size(), 1);
  assert.equal(queueA.size(), 1);

  assert.equal(queueB.enqueue({ type: 'saveJournal', key: { cx: 3, cy: 3, cz: 3 }, payloadRef: 8, tick: 10 }), true);
  assert.equal(queueA.size(), 2);
  assert.equal(queueB.isFull(), false);

  assert.equal(queueA.enqueue({ type: 'loadSnapshot', key: { cx: 4, cy: 4, cz: 4 } }), true);
  assert.equal(queueA.isFull(), true);
  assert.equal(queueB.isFull(), true);

  assert.deepEqual(queueA.dequeue(), {
    type: 'saveSnapshot',
    key: { cx: 2, cy: 2, cz: 2 },
    payloadRef: 5,
  });
  assert.equal(queueA.isFull(), false);
  assert.equal(queueB.isFull(), false);
});

test('shared queue gracefully handles wrap-around behavior', (t) => {
  if (typeof SharedArrayBuffer !== 'function') {
    t.skip('SharedArrayBuffer unavailable in this runtime');
    return;
  }

  const queue = createChunkIoQueue({ capacity: 2 });
  assert.equal(queue.enqueue({ type: 'loadSnapshot', key: { cx: 0, cy: 0, cz: 0 } }), true);
  assert.equal(queue.enqueue({ type: 'saveSnapshot', key: { cx: 1, cy: 1, cz: 1 }, payloadRef: 11 }), true);
  assert.equal(queue.isFull(), true);

  assert.deepEqual(queue.dequeue(), { type: 'loadSnapshot', key: { cx: 0, cy: 0, cz: 0 } });
  assert.equal(queue.isFull(), false);

  assert.equal(queue.enqueue({ type: 'saveJournal', key: { cx: 2, cy: 2, cz: 2 }, payloadRef: 12, tick: 21 }), true);
  assert.equal(queue.size(), 2);

  assert.deepEqual(queue.dequeue(), {
    type: 'saveSnapshot',
    key: { cx: 1, cy: 1, cz: 1 },
    payloadRef: 11,
  });
  assert.deepEqual(queue.dequeue(), {
    type: 'saveJournal',
    key: { cx: 2, cy: 2, cz: 2 },
    payloadRef: 12,
    tick: 21,
  });
  assert.equal(queue.isEmpty(), true);
});

test('fallback queue provides structured-clone semantics', () => {
  const queue = createChunkIoQueue({ capacity: 3, forceFallback: true });
  assert.equal(queue.shared, false);
  assert.equal(queue.buffer, null);

  const job = {
    type: 'saveJournal' as const,
    key: { cx: 3, cy: 4, cz: 5 },
    payloadRef: 99,
    tick: 123,
  };

  assert.equal(queue.enqueue(job), true);
  const dequeued = queue.dequeue();
  assert.notEqual(dequeued, job, 'fallback queue should clone the job object');
  assert.deepEqual(dequeued, job);
});

test('fallback queue enforces capacity limits and clearing', () => {
  const queue = createChunkIoQueue({ capacity: 1, forceFallback: true });
  assert.equal(queue.enqueue({ type: 'loadSnapshot', key: { cx: 1, cy: 0, cz: 0 } }), true);
  assert.equal(queue.enqueue({ type: 'loadSnapshot', key: { cx: 2, cy: 0, cz: 0 } }), false);
  assert.equal(queue.isFull(), true);
  queue.clear();
  assert.equal(queue.isEmpty(), true);
  assert.equal(queue.enqueue({ type: 'loadSnapshot', key: { cx: 2, cy: 0, cz: 0 } }), true);
});

test('invalid jobs raise descriptive errors', () => {
  const queue = createChunkIoQueue({ capacity: 2, forceFallback: true });
  assert.throws(() => {
    queue.enqueue({
      type: 'saveSnapshot',
      key: { cx: 0, cy: 0, cz: 0 },
      payloadRef: Number.NaN,
    });
  }, /payloadRef must be a finite number/);

  assert.throws(() => {
    queue.enqueue({
      type: 'saveJournal',
      key: { cx: 0, cy: 0, cz: 0 },
      payloadRef: 1,
      tick: Number.POSITIVE_INFINITY,
    });
  }, /tick must be a finite number/);
});
