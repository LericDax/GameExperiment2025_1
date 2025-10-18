import {
  createChunkIoQueue,
  type ChunkIoJob,
  type ChunkIoQueue,
  type ChunkKey,
} from './io-queue.ts';

export interface QueueConfiguration {
  shared: boolean;
  capacity: number;
  buffer: SharedArrayBuffer | null;
}

export interface WorkerCommitSnapshotOp {
  type: 'snapshot';
  key: ChunkKey;
  payload: ArrayBuffer;
}

export interface WorkerCommitJournalOp {
  type: 'journal';
  key: ChunkKey;
  payload: ArrayBuffer;
  tick: number;
}

export type WorkerCommitOp = WorkerCommitSnapshotOp | WorkerCommitJournalOp;

export interface ChunkIoJobResultBase {
  type: 'chunkIoJobResult';
  job: ChunkIoJob;
  ok: boolean;
}

export interface ChunkIoJobResultSuccess extends ChunkIoJobResultBase {
  ok: true;
  result:
    | { kind: 'loadSnapshot'; payload: ArrayBuffer | null }
    | { kind: 'loadJournal'; payload: ArrayBuffer[] }
    | { kind: 'saveSnapshot' }
    | { kind: 'saveJournal' };
}

export interface ChunkIoJobResultError extends ChunkIoJobResultBase {
  ok: false;
  error: { message: string; stack?: string };
}

export type ChunkIoJobResultMessage = ChunkIoJobResultSuccess | ChunkIoJobResultError;

export interface QueueScheduler {
  schedule(callback: () => void, immediate: boolean): unknown;
  clear(handle: unknown): void;
}

export interface ChunkIoQueueProcessorOptions {
  postMessage: (message: ChunkIoJobResultMessage, transfer?: Transferable[]) => void;
  loadSnapshot: (key: ChunkKey) => Promise<Uint8Array | null>;
  loadJournal: (key: ChunkKey) => Promise<Uint8Array[]>;
  commit: (ops: WorkerCommitOp[]) => Promise<void>;
  scheduler?: QueueScheduler;
}

const DEFAULT_QUEUE_INTERVAL_MS = 16;

function createDefaultScheduler(): QueueScheduler {
  return {
    schedule(callback, immediate) {
      return setTimeout(callback, immediate ? 0 : DEFAULT_QUEUE_INTERVAL_MS);
    },
    clear(handle) {
      if (typeof handle === 'number') {
        clearTimeout(handle);
        return;
      }
      if (handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    },
  } satisfies QueueScheduler;
}

export class ChunkIoQueueProcessor {
  private readonly options: ChunkIoQueueProcessorOptions;

  private readonly scheduler: QueueScheduler;

  private queue: ChunkIoQueue | null = null;

  private timer: unknown = null;

  private readonly payloadArena = new Map<number, ArrayBuffer>();

  private drainPromise: Promise<void> | null = null;

  private draining = false;

  constructor(options: ChunkIoQueueProcessorOptions) {
    this.options = options;
    this.scheduler = options.scheduler ?? createDefaultScheduler();
  }

  configure(config: QueueConfiguration | null | undefined): void {
    this.clearTimer();
    this.queue = null;
    this.payloadArena.clear();

    if (!config || !config.shared) {
      return;
    }

    const { buffer } = config;
    if (!(buffer instanceof SharedArrayBuffer)) {
      throw new Error('Queue buffer must be a SharedArrayBuffer when shared.');
    }

    this.queue = createChunkIoQueue({ buffer });
    this.schedule(true);
  }

  registerPayload(ref: number, buffer: ArrayBuffer | SharedArrayBuffer): void {
    if (!Number.isFinite(ref)) {
      throw new Error('Invalid payload reference for IO queue.');
    }

    const normalized = this.normalizePayloadBuffer(buffer);
    this.payloadArena.set(Math.trunc(ref), normalized);
    this.schedule(true);
  }

  releasePayload(ref: number): void {
    if (!Number.isFinite(ref)) {
      return;
    }
    this.payloadArena.delete(Math.trunc(ref));
  }

  clearPayloads(): void {
    this.payloadArena.clear();
  }

  async flush(): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.drainQueueJobs();
  }

  private schedule(immediate: boolean): void {
    if (!this.queue) {
      return;
    }

    if (this.timer !== null) {
      return;
    }

    this.timer = this.scheduler.schedule(() => {
      this.timer = null;
      void this.drainQueueJobs();
    }, immediate);
  }

  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }
    this.scheduler.clear(this.timer);
    this.timer = null;
  }

  private async drainQueueJobs(): Promise<void> {
    if (this.drainPromise) {
      return this.drainPromise;
    }

    if (!this.queue) {
      return Promise.resolve();
    }

    const run = async () => {
      const queue = this.queue;
      if (!queue) {
        return;
      }

      let job: ChunkIoJob | null;
      while ((job = queue.dequeue())) {
        try {
          await this.processJob(job);
        } catch (error) {
          this.postJobError(job, error);
        }
      }
    };

    this.draining = true;
    this.drainPromise = run()
      .catch((error) => {
        console.error('[opfs-queue] Failed to drain queue', error);
      })
      .finally(() => {
        this.draining = false;
        this.drainPromise = null;
        if (this.queue) {
          this.schedule(false);
        }
      });

    return this.drainPromise;
  }

  private async processJob(job: ChunkIoJob): Promise<void> {
    switch (job.type) {
      case 'loadSnapshot': {
        const payload = await this.options.loadSnapshot(job.key);
        if (payload) {
          const buffer = this.cloneBuffer(payload);
          this.postJobResult(job, { kind: 'loadSnapshot', payload: buffer }, [buffer]);
        } else {
          this.postJobResult(job, { kind: 'loadSnapshot', payload: null });
        }
        return;
      }
      case 'loadJournal': {
        const payloads = await this.options.loadJournal(job.key);
        const buffers = payloads.map((entry) => this.cloneBuffer(entry));
        this.postJobResult(job, { kind: 'loadJournal', payload: buffers }, buffers);
        return;
      }
      case 'saveSnapshot': {
        const payload = this.takePayload(job.payloadRef);
        await this.options.commit([
          {
            type: 'snapshot',
            key: job.key,
            payload,
          },
        ]);
        this.postJobResult(job, { kind: 'saveSnapshot' });
        return;
      }
      case 'saveJournal': {
        const payload = this.takePayload(job.payloadRef);
        await this.options.commit([
          {
            type: 'journal',
            key: job.key,
            payload,
            tick: job.tick,
          },
        ]);
        this.postJobResult(job, { kind: 'saveJournal' });
        return;
      }
      default: {
        throw new Error(`Unknown IO queue job type ${(job as ChunkIoJob).type}`);
      }
    }
  }

  private postJobResult(
    job: ChunkIoJob,
    result: ChunkIoJobResultSuccess['result'],
    transfer?: Transferable[],
  ): void {
    const message: ChunkIoJobResultSuccess = {
      type: 'chunkIoJobResult',
      job: this.cloneJob(job),
      ok: true,
      result,
    };

    this.postMessage(message, transfer);
  }

  private postJobError(job: ChunkIoJob, reason: unknown): void {
    const error =
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : { message: String(reason ?? 'Unknown error') };
    const message: ChunkIoJobResultError = {
      type: 'chunkIoJobResult',
      job: this.cloneJob(job),
      ok: false,
      error,
    };
    this.postMessage(message);
  }

  private postMessage(message: ChunkIoJobResultMessage, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      try {
        this.options.postMessage(message, transfer);
        return;
      } catch (error) {
        console.warn('[opfs-queue] Falling back to structured clone for job result', error);
      }
    }
    this.options.postMessage(message);
  }

  private takePayload(ref: number): ArrayBuffer {
    if (!Number.isFinite(ref)) {
      throw new Error('Invalid payload reference for IO queue.');
    }
    const key = Math.trunc(ref);
    const buffer = this.payloadArena.get(key);
    if (!buffer) {
      throw new Error(`Missing payload for IO queue reference ${key}`);
    }
    this.payloadArena.delete(key);
    return buffer;
  }

  private normalizePayloadBuffer(buffer: ArrayBuffer | SharedArrayBuffer): ArrayBuffer {
    if (buffer instanceof ArrayBuffer) {
      return buffer;
    }

    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      const copy = new Uint8Array(buffer.byteLength);
      copy.set(new Uint8Array(buffer));
      return copy.buffer;
    }

    throw new TypeError('Unsupported payload buffer type.');
  }

  private cloneBuffer(view: Uint8Array): ArrayBuffer {
    if (view.byteLength === 0) {
      return new ArrayBuffer(0);
    }

    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }

  private cloneJob(job: ChunkIoJob): ChunkIoJob {
    switch (job.type) {
      case 'loadSnapshot':
        return { type: 'loadSnapshot', key: { ...job.key } } satisfies ChunkIoJob;
      case 'loadJournal':
        return { type: 'loadJournal', key: { ...job.key } } satisfies ChunkIoJob;
      case 'saveSnapshot':
        return {
          type: 'saveSnapshot',
          key: { ...job.key },
          payloadRef: job.payloadRef,
        } satisfies ChunkIoJob;
      case 'saveJournal':
        return {
          type: 'saveJournal',
          key: { ...job.key },
          payloadRef: job.payloadRef,
          tick: job.tick,
        } satisfies ChunkIoJob;
      default:
        return job;
    }
  }
}
