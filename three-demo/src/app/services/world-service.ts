import type { Camera } from 'three'

import { createChunkManager } from '../../world/chunk-manager.js'
import { budgetRegistry, GPU_POOL } from '../budgets'
import type { ChunkPersistenceService } from './persistence-service.ts'

export interface ChunkPosition {
  x: number
  y?: number
  z: number
}

export interface ChunkStreamingLoadOptions {
  directionalHint?: unknown
  maxPreload?: number
  viewDistance?: number
  upgradeHysteresis?: unknown
  force?: boolean
}

export interface ChunkStreamingActivationOptions {
  camera?: Camera
  directionalHint?: unknown
  viewDistance?: number
  retainDistance?: number
  maxPreload?: number
  maxDisposals?: number
  maxActivations?: number
  upgradeHysteresis?: unknown
  force?: boolean
}

export interface ChunkStreamingBudgets {
  preload?: number
  activation?: number
  disposal?: number
}

export interface ChunkStreamingTelemetry {
  stats: unknown
  viewDistance: number | null
  retentionDistance: number | null
  raycastTargets: unknown[]
}

type BudgetChunkEvent = {
  key: string
  chunkX: number | null
  chunkZ: number | null
  detailLevel: string
  memory: {
    geometryBytes: number
    attributeCount: number
    meshCount: number
  } | null
}

type BudgetScoutPreviewEvent = {
  key: string
  chunkX: number | null
  chunkZ: number | null
  stats: {
    totalBytes: number
    vertexBytes: number
    colorBytes: number
    indexBytes: number
    vertexCount: number
    indexCount: number
  } | null
}

type BudgetCallbacks = {
  onChunkMeshed?: (payload: BudgetChunkEvent) => void
  onChunkDisposed?: (payload: BudgetChunkEvent) => void
  onScoutPreviewTracked?: (payload: BudgetScoutPreviewEvent) => void
  onScoutPreviewCleared?: (payload: BudgetScoutPreviewEvent) => void
}

export interface ChunkStreamingService {
  load(center: ChunkPosition, radius: number, options?: ChunkStreamingLoadOptions): void
  activate(center: ChunkPosition, options?: ChunkStreamingActivationOptions): void
  setStreamingBudgets(budgets: ChunkStreamingBudgets): void
  getStreamingTelemetry(): ChunkStreamingTelemetry
  dispose(): void
  /**
   * Temporary escape hatch while systems migrate to the service contract.
   * Returns the underlying legacy chunk manager instance.
   */
  getLegacyManager(): ReturnType<typeof createChunkManager> | null
}

export type WorldServiceOptions = Parameters<typeof createChunkManager>[0]

export interface WorldServiceDependencies {
  persistenceService?: ChunkPersistenceService | null
}

export function createWorldService(
  options: WorldServiceOptions,
  dependencies: WorldServiceDependencies = {},
): ChunkStreamingService {
  const chunkBudgetKeys = new Set<string>()
  const previewBudgetKeys = new Set<string>()

  const makeChunkEntryKey = (key: string) => `chunk:${key}`
  const makePreviewEntryKey = (key: string) => `scout-preview:${key}`

  const mergeBudgetCallbacks = (
    base: unknown,
    extra: BudgetCallbacks,
  ): BudgetCallbacks => {
    const normalizedBase =
      base && typeof base === 'object' ? (base as BudgetCallbacks) : {}
    const merged: BudgetCallbacks = { ...normalizedBase }
    ;(Object.keys(extra) as (keyof BudgetCallbacks)[]).forEach((key) => {
      const baseFn = normalizedBase[key]
      const extraFn = extra[key]
      if (typeof baseFn === 'function' && typeof extraFn === 'function') {
        merged[key] = (payload: BudgetChunkEvent | BudgetScoutPreviewEvent) => {
          try {
            baseFn(payload as never)
          } catch (error) {
            console.warn('[world-service] upstream budget callback error', error)
          }
          extraFn(payload as never)
        }
      } else if (typeof extraFn === 'function') {
        merged[key] = extraFn
      }
    })
    return merged
  }

  const instrumentationCallbacks: BudgetCallbacks = {
    onChunkMeshed: ({ key, chunkX, chunkZ, detailLevel, memory }) => {
      if (!key || !memory) {
        return
      }
      const entryKey = makeChunkEntryKey(key)
      chunkBudgetKeys.add(entryKey)
      budgetRegistry.request(GPU_POOL, entryKey, memory.geometryBytes, {
        type: 'chunk',
        chunkKey: key,
        chunkX,
        chunkZ,
        detailLevel,
        geometryBytes: memory.geometryBytes,
        meshCount: memory.meshCount,
        attributeCount: memory.attributeCount,
        timestamp: Date.now(),
      })
    },
    onChunkDisposed: ({ key }) => {
      if (!key) {
        return
      }
      const entryKey = makeChunkEntryKey(key)
      chunkBudgetKeys.delete(entryKey)
      budgetRegistry.release(GPU_POOL, entryKey)
    },
    onScoutPreviewTracked: ({ key, chunkX, chunkZ, stats }) => {
      if (!key || !stats) {
        return
      }
      const entryKey = makePreviewEntryKey(key)
      previewBudgetKeys.add(entryKey)
      budgetRegistry.request(GPU_POOL, entryKey, stats.totalBytes, {
        type: 'scout-preview',
        chunkKey: key,
        chunkX,
        chunkZ,
        vertexBytes: stats.vertexBytes,
        colorBytes: stats.colorBytes,
        indexBytes: stats.indexBytes,
        vertexCount: stats.vertexCount,
        indexCount: stats.indexCount,
        timestamp: Date.now(),
      })
    },
    onScoutPreviewCleared: ({ key }) => {
      if (!key) {
        return
      }
      const entryKey = makePreviewEntryKey(key)
      previewBudgetKeys.delete(entryKey)
      budgetRegistry.release(GPU_POOL, entryKey)
    },
  }

  const {
    budgetCallbacks: providedBudgetCallbacks,
    chunkPersistenceQueue: providedChunkPersistenceQueue,
    ...restOptions
  } = (options ?? {}) as Record<string, unknown> & {
    budgetCallbacks?: unknown
    chunkPersistenceQueue?: WorldServiceOptions['chunkPersistenceQueue']
  }

  const persistenceQueue =
    providedChunkPersistenceQueue ??
    dependencies?.persistenceService?.getQueue() ??
    undefined

  const chunkManager = createChunkManager({
    ...(restOptions as WorldServiceOptions),
    chunkPersistenceQueue: persistenceQueue,
    budgetCallbacks: mergeBudgetCallbacks(
      providedBudgetCallbacks,
      instrumentationCallbacks,
    ),
  })

  const load: ChunkStreamingService['load'] = (
    center,
    radius,
    optionsOverride = {},
  ) => {
    if (!chunkManager || typeof chunkManager.preloadAround !== 'function') {
      return
    }
    const normalizedRadius = Number.isFinite(radius) ? radius : 0
    chunkManager.preloadAround(center, normalizedRadius, optionsOverride)
  }

  const activate: ChunkStreamingService['activate'] = (
    center,
    optionsOverride = {},
  ) => {
    if (!chunkManager || typeof chunkManager.update !== 'function') {
      return
    }
    chunkManager.update(center, optionsOverride)
  }

  const setStreamingBudgets: ChunkStreamingService['setStreamingBudgets'] = (
    budgets,
  ) => {
    if (!chunkManager || typeof chunkManager.setStreamingBudgets !== 'function') {
      return
    }
    chunkManager.setStreamingBudgets(budgets)
  }

  const getStreamingTelemetry: ChunkStreamingService['getStreamingTelemetry'] = () => {
    const stats =
      typeof chunkManager?.getStreamingStats === 'function'
        ? chunkManager.getStreamingStats()
        : null
    const viewDistance =
      typeof chunkManager?.getViewDistance === 'function'
        ? chunkManager.getViewDistance()
        : null
    const retentionDistance =
      typeof chunkManager?.getRetentionDistance === 'function'
        ? chunkManager.getRetentionDistance()
        : null
    const raycastTargets =
      typeof chunkManager?.getRaycastTargets === 'function'
        ? chunkManager.getRaycastTargets()
        : []
    return {
      stats,
      viewDistance,
      retentionDistance,
      raycastTargets,
    }
  }

  const dispose: ChunkStreamingService['dispose'] = () => {
    if (chunkManager && typeof chunkManager.dispose === 'function') {
      chunkManager.dispose()
    }
    dependencies?.persistenceService?.dispose()
    chunkBudgetKeys.forEach((entryKey) => {
      budgetRegistry.release(GPU_POOL, entryKey)
    })
    chunkBudgetKeys.clear()
    previewBudgetKeys.forEach((entryKey) => {
      budgetRegistry.release(GPU_POOL, entryKey)
    })
    previewBudgetKeys.clear()
  }

  const getLegacyManager: ChunkStreamingService['getLegacyManager'] = () =>
    chunkManager ?? null

  return {
    load,
    activate,
    setStreamingBudgets,
    getStreamingTelemetry,
    dispose,
    getLegacyManager,
  }
}
