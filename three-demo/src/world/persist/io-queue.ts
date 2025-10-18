export type ChunkIoJobType =
  | 'loadSnapshot'
  | 'loadJournal'
  | 'saveSnapshot'
  | 'saveJournal';

export interface ChunkKey {
  cx: number;
  cy: number;
  cz: number;
}

export interface ChunkIoJobBase {
  key: ChunkKey;
}

export interface ChunkIoLoadSnapshotJob extends ChunkIoJobBase {
  type: 'loadSnapshot';
}

export interface ChunkIoLoadJournalJob extends ChunkIoJobBase {
  type: 'loadJournal';
}

export interface ChunkIoSaveSnapshotJob extends ChunkIoJobBase {
  type: 'saveSnapshot';
  payloadRef: number;
}

export interface ChunkIoSaveJournalJob extends ChunkIoJobBase {
  type: 'saveJournal';
  payloadRef: number;
  tick: number;
}

export type ChunkIoJob =
  | ChunkIoLoadSnapshotJob
  | ChunkIoLoadJournalJob
  | ChunkIoSaveSnapshotJob
  | ChunkIoSaveJournalJob;

export interface ChunkIoQueue {
  readonly capacity: number;
  readonly shared: boolean;
  readonly buffer: SharedArrayBuffer | null;
  enqueue(job: ChunkIoJob): boolean;
  dequeue(): ChunkIoJob | null;
  clear(): void;
  size(): number;
  isEmpty(): boolean;
  isFull(): boolean;
}

export interface CreateChunkIoQueueOptions {
  capacity?: number;
  buffer?: SharedArrayBuffer;
  forceFallback?: boolean;
}

const DEFAULT_CAPACITY = 64;
const HEADER_FIELDS = 5;
const HEAD_INDEX = 0;
const TAIL_INDEX = 1;
const CAPACITY_INDEX = 2;
const STRIDE_INDEX = 3;
const COUNT_INDEX = 4;
const ENTRY_FIELDS = 6;
const EMPTY_VALUE = -1;

const JOB_TYPE_TO_CODE: Record<ChunkIoJobType, number> = {
  loadSnapshot: 1,
  loadJournal: 2,
  saveSnapshot: 3,
  saveJournal: 4,
};

const CODE_TO_JOB_TYPE = new Map<number, ChunkIoJobType>([
  [1, 'loadSnapshot'],
  [2, 'loadJournal'],
  [3, 'saveSnapshot'],
  [4, 'saveJournal'],
]);

export function createChunkIoQueue(options: CreateChunkIoQueueOptions = {}): ChunkIoQueue {
  const supportsSharedArrayBuffer = typeof SharedArrayBuffer === 'function';
  const { capacity: requestedCapacity, buffer, forceFallback } = options;

  if (forceFallback) {
    if (buffer) {
      throw new Error('SharedArrayBuffer buffer is not supported in fallback mode.');
    }
    const capacity = ensureCapacity(requestedCapacity);
    return new FallbackChunkIoQueue(capacity);
  }

  if (buffer) {
    if (!supportsSharedArrayBuffer) {
      throw new Error('SharedArrayBuffer is not available in this environment.');
    }
    if (!(buffer instanceof SharedArrayBuffer)) {
      throw new TypeError('buffer must be a SharedArrayBuffer instance.');
    }
    return new SharedChunkIoQueue(buffer);
  }

  if (!supportsSharedArrayBuffer) {
    const capacity = ensureCapacity(requestedCapacity);
    return new FallbackChunkIoQueue(capacity);
  }

  const capacity = ensureCapacity(requestedCapacity);
  const byteLength = getRequiredByteLength(capacity);
  const sharedBuffer = new SharedArrayBuffer(byteLength);
  const queue = new SharedChunkIoQueue(sharedBuffer);
  queue.clear();
  return queue;
}

function ensureCapacity(capacity: number | undefined): number {
  if (capacity === undefined) {
    return DEFAULT_CAPACITY;
  }

  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError('capacity must be an integer greater than or equal to 1.');
  }

  return capacity;
}

function getRequiredByteLength(capacity: number): number {
  return (HEADER_FIELDS + capacity * ENTRY_FIELDS) * Int32Array.BYTES_PER_ELEMENT;
}

class SharedChunkIoQueue implements ChunkIoQueue {
  readonly shared = true;

  readonly capacity: number;

  readonly buffer: SharedArrayBuffer;

  private readonly header: Int32Array;

  private readonly data: Int32Array;

  constructor(buffer: SharedArrayBuffer) {
    const totalSlots = buffer.byteLength / Int32Array.BYTES_PER_ELEMENT;
    if (!Number.isInteger(totalSlots) || totalSlots < HEADER_FIELDS) {
      throw new Error('Shared buffer is too small for the IO queue.');
    }

    const dataSlots = totalSlots - HEADER_FIELDS;
    if (dataSlots % ENTRY_FIELDS !== 0) {
      throw new Error('Shared buffer has an incompatible layout.');
    }

    this.capacity = dataSlots / ENTRY_FIELDS;
    this.buffer = buffer;
    this.header = new Int32Array(buffer, 0, HEADER_FIELDS);
    this.data = new Int32Array(buffer, HEADER_FIELDS * Int32Array.BYTES_PER_ELEMENT);

    const storedCapacity = Atomics.load(this.header, CAPACITY_INDEX);
    if (storedCapacity !== 0 && storedCapacity !== this.capacity) {
      throw new Error('Shared buffer capacity mismatch.');
    }

    const storedStride = Atomics.load(this.header, STRIDE_INDEX);
    if (storedStride !== 0 && storedStride !== ENTRY_FIELDS) {
      throw new Error('Shared buffer stride mismatch.');
    }

    Atomics.store(this.header, CAPACITY_INDEX, this.capacity);
    Atomics.store(this.header, STRIDE_INDEX, ENTRY_FIELDS);
  }

  enqueue(job: ChunkIoJob): boolean {
    const normalized = normalizeJob(job);
    const count = Atomics.load(this.header, COUNT_INDEX);
    if (count >= this.capacity) {
      return false;
    }

    const tail = Atomics.load(this.header, TAIL_INDEX);
    const nextTail = (tail + 1) % this.capacity;

    this.writeJob(tail, normalized);
    Atomics.store(this.header, TAIL_INDEX, nextTail);
    Atomics.store(this.header, COUNT_INDEX, count + 1);
    return true;
  }

  dequeue(): ChunkIoJob | null {
    const count = Atomics.load(this.header, COUNT_INDEX);
    if (count === 0) {
      return null;
    }

    const head = Atomics.load(this.header, HEAD_INDEX);
    const job = this.readJob(head);
    const nextHead = (head + 1) % this.capacity;
    Atomics.store(this.header, HEAD_INDEX, nextHead);
    Atomics.store(this.header, COUNT_INDEX, count - 1);
    return job;
  }

  clear(): void {
    Atomics.store(this.header, HEAD_INDEX, 0);
    Atomics.store(this.header, TAIL_INDEX, 0);
    Atomics.store(this.header, COUNT_INDEX, 0);
  }

  size(): number {
    return Atomics.load(this.header, COUNT_INDEX);
  }

  isEmpty(): boolean {
    return Atomics.load(this.header, COUNT_INDEX) === 0;
  }

  isFull(): boolean {
    return Atomics.load(this.header, COUNT_INDEX) >= this.capacity;
  }

  private writeJob(slot: number, job: ChunkIoJob): void {
    const base = slot * ENTRY_FIELDS;
    const typeCode = JOB_TYPE_TO_CODE[job.type];
    Atomics.store(this.data, base, typeCode);
    Atomics.store(this.data, base + 1, job.key.cx);
    Atomics.store(this.data, base + 2, job.key.cy);
    Atomics.store(this.data, base + 3, job.key.cz);

    if (job.type === 'saveSnapshot' || job.type === 'saveJournal') {
      Atomics.store(this.data, base + 4, job.payloadRef);
      const tick = job.type === 'saveJournal' ? job.tick : EMPTY_VALUE;
      Atomics.store(this.data, base + 5, tick);
    } else {
      Atomics.store(this.data, base + 4, EMPTY_VALUE);
      Atomics.store(this.data, base + 5, EMPTY_VALUE);
    }
  }

  private readJob(slot: number): ChunkIoJob {
    const base = slot * ENTRY_FIELDS;
    const typeCode = Atomics.load(this.data, base);
    const type = CODE_TO_JOB_TYPE.get(typeCode);
    if (!type) {
      throw new Error(`Encountered unknown job type code: ${typeCode}`);
    }

    const key = {
      cx: Atomics.load(this.data, base + 1),
      cy: Atomics.load(this.data, base + 2),
      cz: Atomics.load(this.data, base + 3),
    } satisfies ChunkKey;

    if (type === 'saveSnapshot' || type === 'saveJournal') {
      const payloadRef = Atomics.load(this.data, base + 4);
      const tick = Atomics.load(this.data, base + 5);
      if (type === 'saveJournal') {
        return {
          type,
          key,
          payloadRef,
          tick,
        } satisfies ChunkIoSaveJournalJob;
      }

      return {
        type,
        key,
        payloadRef,
      } satisfies ChunkIoSaveSnapshotJob;
    }

    return {
      type,
      key,
    } satisfies ChunkIoLoadSnapshotJob | ChunkIoLoadJournalJob;
  }
}

class FallbackChunkIoQueue implements ChunkIoQueue {
  readonly shared = false;

  readonly buffer = null;

  readonly capacity: number;

  private readonly items: ChunkIoJob[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  enqueue(job: ChunkIoJob): boolean {
    if (this.isFull()) {
      return false;
    }
    const normalized = normalizeJob(job);
    this.items.push(normalized);
    return true;
  }

  dequeue(): ChunkIoJob | null {
    if (this.isEmpty()) {
      return null;
    }
    const job = this.items.shift();
    if (!job) {
      return null;
    }
    return normalizeJob(job);
  }

  clear(): void {
    this.items.length = 0;
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  isFull(): boolean {
    return this.items.length >= this.capacity;
  }
}

function normalizeJob(job: ChunkIoJob): ChunkIoJob {
  const key = normalizeKey(job.key);
  switch (job.type) {
    case 'loadSnapshot':
      return { type: 'loadSnapshot', key } satisfies ChunkIoLoadSnapshotJob;
    case 'loadJournal':
      return { type: 'loadJournal', key } satisfies ChunkIoLoadJournalJob;
    case 'saveSnapshot': {
      const payloadRef = normalizeNumber(job.payloadRef, 'payloadRef');
      return { type: 'saveSnapshot', key, payloadRef } satisfies ChunkIoSaveSnapshotJob;
    }
    case 'saveJournal': {
      const payloadRef = normalizeNumber(job.payloadRef, 'payloadRef');
      const tick = normalizeNumber(job.tick, 'tick');
      return { type: 'saveJournal', key, payloadRef, tick } satisfies ChunkIoSaveJournalJob;
    }
    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
}

function normalizeKey(key: ChunkKey): ChunkKey {
  return {
    cx: normalizeNumber(key.cx, 'key.cx'),
    cy: normalizeNumber(key.cy, 'key.cy'),
    cz: normalizeNumber(key.cz, 'key.cz'),
  } satisfies ChunkKey;
}

function normalizeNumber(value: number | undefined, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return Math.trunc(value);
}
