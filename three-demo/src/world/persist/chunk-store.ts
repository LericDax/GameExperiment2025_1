import type { ChunkKey, ChunkStore, SaveOp } from './chunk-store.d.ts';
import type { RegionCompatibility } from './world-index';
import { createWorkerRequestQueue, type WorkerRequestQueue } from './worker-queue.ts';

export interface CreateChunkStoreOptions {
  worldId: string;
  compatibility: RegionCompatibility;
  regionSize?: number;
  maxOpenRegions?: number;
  indexedDbName?: string;
}

interface WorkerCommitOp {
  type: 'snapshot' | 'journal';
  key: ChunkKey;
  payload: ArrayBuffer;
  tick?: number;
}

type WorkerMethod = 'init' | 'loadSnapshot' | 'loadJournal' | 'commit' | 'remove';

interface OpfsInitParams {
  worldId: string;
  compatibility: RegionCompatibility;
  regionSize?: number;
  maxOpenRegions?: number;
}

export async function createChunkStore(options: CreateChunkStoreOptions): Promise<ChunkStore> {
  if (isOpfsAvailable()) {
    const store = new OpfsChunkStore(options);
    await store.initialize();
    return store;
  }

  return new IndexedDbChunkStore(options);
}

class OpfsChunkStore implements ChunkStore {
  private readonly worker: Worker;

  private readonly queue: Promise<WorkerRequestQueue>;

  private readonly initParams: OpfsInitParams;

  constructor(options: CreateChunkStoreOptions) {
    this.worker = new Worker(new URL('./opfs-store.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.queue = createWorkerRequestQueue(this.worker);

    this.initParams = {
      worldId: options.worldId,
      compatibility: options.compatibility,
      regionSize: options.regionSize,
      maxOpenRegions: options.maxOpenRegions,
    };
  }

  async initialize(): Promise<void> {
    await this.call('init', this.initParams);
  }

  async loadSnapshot(key: ChunkKey): Promise<Uint8Array | null> {
    const result = await this.call<ArrayBuffer | null>('loadSnapshot', { key });
    if (!result) {
      return null;
    }
    return new Uint8Array(result).slice();
  }

  async loadJournal(key: ChunkKey): Promise<Uint8Array[]> {
    const result = await this.call<ArrayBuffer[]>('loadJournal', { key });
    return result.map((buffer) => new Uint8Array(buffer).slice());
  }

  async commit(ops: SaveOp[]): Promise<void> {
    if (ops.length === 0) {
      return;
    }

    const workerOps: WorkerCommitOp[] = ops.map((op) => {
      const payload = toArrayBuffer(op.payload);
      if (op.type === 'snapshot') {
        return {
          type: 'snapshot',
          key: op.key,
          payload,
        } satisfies WorkerCommitOp;
      }

      return {
        type: 'journal',
        key: op.key,
        payload,
        tick: op.tick,
      } satisfies WorkerCommitOp;
    });

    const transfer = workerOps.map((op) => op.payload);
    await this.call('commit', { ops: workerOps }, transfer);
  }

  async remove(key: ChunkKey): Promise<void> {
    await this.call('remove', { key });
  }

  private call<T = unknown>(method: WorkerMethod, params: unknown, transfer: Transferable[] = []): Promise<T> {
    return this.queue.then((queue) => queue.enqueue<T>(method, params, transfer));
  }
}

class IndexedDbChunkStore implements ChunkStore {
  private readonly name: string;
  private readonly worldId: string;
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(options: CreateChunkStoreOptions) {
    this.worldId = options.worldId;
    this.name = options.indexedDbName ?? 'geca-chunks';
    this.dbPromise = this.open();
  }

  async loadSnapshot(key: ChunkKey): Promise<Uint8Array | null> {
    const db = await this.dbPromise;
    const store = db.transaction('chunks', 'readonly').objectStore('chunks');
    const record = (await requestAsPromise<IndexedDbChunkRecord | undefined>(
      store.get(this.serializeKey(key)),
    )) as IndexedDbChunkRecord | undefined;
    if (!record || !record.snapshot) {
      return null;
    }
    return new Uint8Array(record.snapshot).slice();
  }

  async loadJournal(key: ChunkKey): Promise<Uint8Array[]> {
    const db = await this.dbPromise;
    const store = db.transaction('chunks', 'readonly').objectStore('chunks');
    const record = (await requestAsPromise<IndexedDbChunkRecord | undefined>(
      store.get(this.serializeKey(key)),
    )) as IndexedDbChunkRecord | undefined;
    if (!record || !record.journal) {
      return [];
    }
    return record.journal.map((buffer) => new Uint8Array(buffer).slice());
  }

  async commit(ops: SaveOp[]): Promise<void> {
    if (ops.length === 0) {
      return;
    }

    const db = await this.dbPromise;
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const pending = new Map<string, IndexedDbChunkRecord>();

    for (const op of ops) {
      const key = this.serializeKey(op.key);
      let record = pending.get(key);
      if (!record) {
        const existing = (await requestAsPromise<IndexedDbChunkRecord | undefined>(
          store.get(key),
        )) as IndexedDbChunkRecord | undefined;
        record = existing ? { ...existing } : {};
        pending.set(key, record);
      }

      if (op.type === 'snapshot') {
        record.snapshot = toArrayBuffer(op.payload);
      } else {
        const payload = toArrayBuffer(op.payload);
        const journal = record.journal ? [...record.journal] : [];
        journal.push(payload);
        record.journal = journal;
      }
    }

    for (const [key, record] of pending.entries()) {
      await requestAsPromise(store.put(record, key));
    }

    await transactionComplete(tx);
  }

  async remove(key: ChunkKey): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').delete(this.serializeKey(key));
    await transactionComplete(tx);
  }

  private serializeKey(key: ChunkKey): string {
    return `${this.worldId}:${key.cx}:${key.cy}:${key.cz}`;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks');
        }
      };
    });
  }
}

interface IndexedDbChunkRecord {
  snapshot?: ArrayBuffer;
  journal?: ArrayBuffer[];
}

function isOpfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

function toArrayBuffer(payload: ArrayBufferView | ArrayBufferLike): ArrayBuffer {
  if (payload instanceof ArrayBuffer) {
    return payload.slice(0);
  }

  if (typeof SharedArrayBuffer !== 'undefined' && payload instanceof SharedArrayBuffer) {
    const view = new Uint8Array(payload);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
  }

  if (ArrayBuffer.isView(payload)) {
    const view = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    return view.slice().buffer;
  }

  const view = new Uint8Array(payload as ArrayBufferLike);
  return view.slice().buffer;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
