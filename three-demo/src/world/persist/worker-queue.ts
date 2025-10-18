import {
  CHUNK_STORE_HANDSHAKE_REQUEST,
  CHUNK_STORE_HANDSHAKE_RESPONSE,
  type ChunkStoreHandshakeRequest,
  type ChunkStoreHandshakeResponse,
} from './chunk-store-worker-protocol.ts';

type WorkerMethod = string;

interface WorkerQueueRequest {
  id: number;
  method: WorkerMethod;
  params: unknown;
}

type WorkerQueueResponse =
  | { id: number; result: unknown }
  | { id: number; error: { message: string; stack?: string } };

type IncomingMessage = WorkerQueueResponse | ChunkStoreHandshakeResponse;

export interface WorkerRequestQueue {
  readonly supportsSharedArrayBuffer: boolean;
  enqueue<T = unknown>(
    method: WorkerMethod,
    params: unknown,
    transfer?: Transferable[],
  ): Promise<T>;
  dispose(): void;
}

export async function createWorkerRequestQueue(worker: Worker): Promise<WorkerRequestQueue> {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();

  let nextId = 0;
  let disposed = false;
  let fatalError: unknown = null;
  let supportsSharedArrayBuffer = false;

  let handshakeSettled = false;
  let handshakeResolve: (value: boolean) => void;
  let handshakeReject: (reason: unknown) => void;
  const handshakePromise = new Promise<boolean>((resolve, reject) => {
    handshakeResolve = resolve;
    handshakeReject = reject;
  });

  const resolveHandshake = (value: boolean) => {
    if (handshakeSettled) {
      return;
    }
    handshakeSettled = true;
    handshakeResolve(value);
  };

  const rejectHandshake = (reason: unknown) => {
    if (handshakeSettled) {
      return;
    }
    handshakeSettled = true;
    handshakeReject(reason);
  };

  const rejectAllPending = (reason: unknown) => {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(reason);
    }
    pending.clear();
  };

  const messageHandler = (event: MessageEvent<IncomingMessage>) => {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    if ('type' in data) {
      if (data.type === CHUNK_STORE_HANDSHAKE_RESPONSE) {
        supportsSharedArrayBuffer = Boolean(data.supportsSharedArrayBuffer);
        resolveHandshake(supportsSharedArrayBuffer);
      }
      return;
    }

    if (typeof data.id !== 'number') {
      return;
    }

    const request = pending.get(data.id);
    if (!request) {
      return;
    }

    pending.delete(data.id);

    if ('error' in data) {
      const errorInfo = data.error;
      const error = new Error(errorInfo?.message ?? 'Worker error');
      if (errorInfo?.stack) {
        error.stack = errorInfo.stack;
      }
      request.reject(error);
      return;
    }

    request.resolve(data.result);
  };

  const errorHandler = (event: ErrorEvent | MessageEvent<unknown>) => {
    if (fatalError) {
      return;
    }

    const reason = event instanceof ErrorEvent ? event.error ?? event.message : event.data;
    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Worker error'));

    fatalError = error;
    rejectHandshake(error);
    rejectAllPending(error);
    cleanup();
  };

  worker.addEventListener('message', messageHandler as EventListener);
  worker.addEventListener('error', errorHandler);
  worker.addEventListener('messageerror', errorHandler);

  const supportsSabOnMain = typeof SharedArrayBuffer === 'function';

  try {
    worker.postMessage({
      type: CHUNK_STORE_HANDSHAKE_REQUEST,
      supportsSharedArrayBuffer: supportsSabOnMain,
    } satisfies ChunkStoreHandshakeRequest);
  } catch (error) {
    rejectHandshake(error);
  }

  try {
    const workerSupportsSharedArrayBuffer = await handshakePromise;
    supportsSharedArrayBuffer = supportsSabOnMain && workerSupportsSharedArrayBuffer;
  } catch (error) {
    cleanup();
    throw error;
  }

  function cleanup() {
    if (disposed) {
      return;
    }
    worker.removeEventListener('message', messageHandler as EventListener);
    worker.removeEventListener('error', errorHandler);
    worker.removeEventListener('messageerror', errorHandler);
    disposed = true;
  }

  return {
    get supportsSharedArrayBuffer() {
      return supportsSharedArrayBuffer;
    },
    enqueue<T = unknown>(
      method: WorkerMethod,
      params: unknown,
      transfer: Transferable[] = [],
    ): Promise<T> {
      if (disposed) {
        return Promise.reject(new Error('Worker queue has been disposed.'));
      }

      if (fatalError) {
        return Promise.reject(fatalError);
      }

      const id = ++nextId;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve, reject });

        try {
          worker.postMessage({ id, method, params } satisfies WorkerQueueRequest, transfer);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    dispose(): void {
      cleanup();
      rejectAllPending(new Error('Worker queue disposed.'));
    },
  } satisfies WorkerRequestQueue;
}
