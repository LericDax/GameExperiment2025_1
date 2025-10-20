import {
  createChunkStoreQueue,
  DEFAULT_CHUNK_STORE_TIMEOUT_MS,
} from '../../world/persist/chunk-store-queue.js'

export type ChunkPersistenceQueue = ReturnType<typeof createChunkStoreQueue>

export type ChunkPersistenceJob = Record<string, unknown> & {
  timeoutMs?: number | null
}

export type ChunkPersistenceLoadResult = unknown

export interface ChunkPersistenceImplementation {
  load(job: ChunkPersistenceJob): Promise<ChunkPersistenceLoadResult>
  save(job: ChunkPersistenceJob): Promise<unknown>
}

export interface PersistenceServiceOptions {
  implementation?: ChunkPersistenceImplementation | null | undefined
  defaultTimeoutMs?: number | null | undefined
}

export interface ChunkPersistenceService {
  getQueue(): ChunkPersistenceQueue | null
  setImplementation(
    implementation: ChunkPersistenceImplementation | null | undefined,
  ): void
  dispose(): void
}

function createInlineImplementation(): ChunkPersistenceImplementation {
  return {
    async load() {
      return null
    },
    async save() {
      return undefined
    },
  }
}

function createQueueForImplementation(
  implementation: ChunkPersistenceImplementation | null | undefined,
  defaultTimeoutMs: number,
): ChunkPersistenceQueue | null {
  if (!implementation) {
    return null
  }
  return createChunkStoreQueue({
    load: (job) => implementation.load(job),
    save: (job) => implementation.save(job),
    defaultTimeoutMs,
  })
}

export function createPersistenceService(
  options: PersistenceServiceOptions = {},
): ChunkPersistenceService {
  const resolveDefaultTimeout = (): number => {
    const candidate = Number(options?.defaultTimeoutMs)
    if (candidate === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY
    }
    if (!Number.isFinite(candidate) || candidate <= 0) {
      return DEFAULT_CHUNK_STORE_TIMEOUT_MS
    }
    return Math.floor(candidate)
  }

  const defaultTimeout = resolveDefaultTimeout()

  const resolveImplementation = (
    implementation: ChunkPersistenceImplementation | null | undefined,
  ): ChunkPersistenceImplementation => implementation ?? createInlineImplementation()

  let queue = createQueueForImplementation(
    resolveImplementation(options?.implementation),
    defaultTimeout,
  )

  const getQueue: ChunkPersistenceService['getQueue'] = () => queue

  const setImplementation: ChunkPersistenceService['setImplementation'] = (
    implementation,
  ) => {
    if (queue) {
      queue.dispose?.()
      queue = null
    }
    queue = createQueueForImplementation(
      resolveImplementation(implementation),
      defaultTimeout,
    )
  }

  const dispose: ChunkPersistenceService['dispose'] = () => {
    queue?.dispose?.()
    queue = null
  }

  return {
    getQueue,
    setImplementation,
    dispose,
  }
}
