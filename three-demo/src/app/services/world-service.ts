import type { Camera } from 'three'

import { createChunkManager } from '../../world/chunk-manager.js'

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

export function createWorldService(
  options: WorldServiceOptions,
): ChunkStreamingService {
  const chunkManager = createChunkManager(options)

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
