type BudgetPoolName = 'cpu' | 'gpu'

export const CPU_POOL: BudgetPoolName = 'cpu'
export const GPU_POOL: BudgetPoolName = 'gpu'

type BudgetEventType = 'pool-update' | 'budget-exceeded'

export interface BudgetEntrySnapshot {
  key: string
  bytes: number
  metadata: Record<string, unknown> | null
  updatedAt: number
}

export interface BudgetPoolSnapshot {
  name: BudgetPoolName
  total: number
  cap: number
  exceeded: boolean
  entries: BudgetEntrySnapshot[]
}

export interface BudgetRegistrySnapshot {
  pools: Record<BudgetPoolName, BudgetPoolSnapshot>
  generatedAt: number
}

export interface BudgetEvent {
  type: BudgetEventType
  detail: {
    pool: BudgetPoolSnapshot
    entry: BudgetEntrySnapshot | null
  }
}

type BudgetEventListener = (event: BudgetEvent) => void

interface BudgetEntryState extends BudgetEntrySnapshot {}

interface BudgetPoolState {
  name: BudgetPoolName
  cap: number
  total: number
  entries: Map<string, BudgetEntryState>
}

type BudgetPoolConfig = {
  name: BudgetPoolName
  cap: number
}

const DEFAULT_POOLS: BudgetPoolConfig[] = [
  { name: CPU_POOL, cap: 512 * 1024 * 1024 },
  { name: GPU_POOL, cap: 256 * 1024 * 1024 },
]

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function normalizeBytes(value: unknown): number {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0
  }
  return Math.floor(numeric)
}

function cloneEntry(entry: BudgetEntryState | null): BudgetEntrySnapshot | null {
  if (!entry) {
    return null
  }
  return {
    key: entry.key,
    bytes: entry.bytes,
    metadata: entry.metadata ? { ...entry.metadata } : null,
    updatedAt: entry.updatedAt,
  }
}

function createPoolSnapshot(state: BudgetPoolState): BudgetPoolSnapshot {
  const entries: BudgetEntrySnapshot[] = []
  state.entries.forEach((entry) => {
    entries.push(cloneEntry(entry)!)
  })
  entries.sort((a, b) => a.key.localeCompare(b.key))
  return {
    name: state.name,
    total: state.total,
    cap: state.cap,
    exceeded: state.total > state.cap,
    entries,
  }
}

class BudgetRegistry {
  private pools: Map<BudgetPoolName, BudgetPoolState>
  private listeners: Map<BudgetEventType, Set<BudgetEventListener>>

  constructor() {
    this.pools = new Map()
    this.listeners = new Map()
    DEFAULT_POOLS.forEach((config) => {
      this.pools.set(config.name, {
        name: config.name,
        cap: config.cap,
        total: 0,
        entries: new Map(),
      })
    })
  }

  private getOrCreatePool(name: BudgetPoolName): BudgetPoolState {
    let pool = this.pools.get(name)
    if (!pool) {
      pool = {
        name,
        cap: Number.POSITIVE_INFINITY,
        total: 0,
        entries: new Map(),
      }
      this.pools.set(name, pool)
    }
    return pool
  }

  private dispatch(type: BudgetEventType, pool: BudgetPoolState, entry: BudgetEntryState | null) {
    const listeners = this.listeners.get(type)
    if (!listeners || listeners.size === 0) {
      return
    }
    const snapshot = createPoolSnapshot(pool)
    const event: BudgetEvent = {
      type,
      detail: {
        pool: snapshot,
        entry: cloneEntry(entry),
      },
    }
    listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        console.warn('[budget-registry] event listener error', error)
      }
    })
  }

  addEventListener(type: BudgetEventType, listener: BudgetEventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    const listeners = this.listeners.get(type)!
    listeners.add(listener)
    return () => {
      this.removeEventListener(type, listener)
    }
  }

  removeEventListener(type: BudgetEventType, listener: BudgetEventListener) {
    const listeners = this.listeners.get(type)
    if (!listeners) {
      return
    }
    listeners.delete(listener)
    if (listeners.size === 0) {
      this.listeners.delete(type)
    }
  }

  setCap(poolName: BudgetPoolName, cap: unknown) {
    const pool = this.getOrCreatePool(poolName)
    const normalized = normalizeBytes(cap)
    pool.cap = normalized === 0 ? 0 : normalized
    this.dispatch('pool-update', pool, null)
  }

  request(
    poolName: BudgetPoolName,
    key: unknown,
    bytes: unknown,
    metadata: Record<string, unknown> | null = null,
  ): BudgetEntrySnapshot {
    const normalizedKey = String(key ?? '')
    if (!normalizedKey) {
      throw new Error('[budget-registry] Entries require a stable key')
    }
    const pool = this.getOrCreatePool(poolName)
    const normalizedBytes = normalizeBytes(bytes)
    const existing = pool.entries.get(normalizedKey) ?? null
    const previousBytes = existing?.bytes ?? 0
    const delta = normalizedBytes - previousBytes
    if (delta !== 0) {
      if (normalizedBytes === Number.POSITIVE_INFINITY) {
        pool.total = Number.POSITIVE_INFINITY
      } else if (pool.total !== Number.POSITIVE_INFINITY) {
        pool.total = Math.max(0, pool.total + delta)
      }
    }

    const entry: BudgetEntryState = {
      key: normalizedKey,
      bytes: normalizedBytes,
      metadata: metadata ? { ...metadata } : null,
      updatedAt: now(),
    }
    pool.entries.set(normalizedKey, entry)
    this.dispatch('pool-update', pool, entry)
    if (pool.total > pool.cap) {
      this.dispatch('budget-exceeded', pool, entry)
    }
    return cloneEntry(entry)!
  }

  release(poolName: BudgetPoolName, key: unknown): boolean {
    const pool = this.getOrCreatePool(poolName)
    if (!pool.entries.has(String(key ?? ''))) {
      return false
    }
    const normalizedKey = String(key ?? '')
    if (!normalizedKey) {
      return false
    }
    const entry = pool.entries.get(normalizedKey)
    if (!entry) {
      return false
    }
    pool.entries.delete(normalizedKey)
    if (pool.total !== Number.POSITIVE_INFINITY) {
      pool.total = Math.max(0, pool.total - entry.bytes)
    }
    this.dispatch('pool-update', pool, null)
    return true
  }

  getSnapshot(): BudgetRegistrySnapshot {
    const pools: Record<BudgetPoolName, BudgetPoolSnapshot> = {
      cpu: createPoolSnapshot(this.getOrCreatePool(CPU_POOL)),
      gpu: createPoolSnapshot(this.getOrCreatePool(GPU_POOL)),
    }
    return {
      pools,
      generatedAt: now(),
    }
  }
}

export const budgetRegistry = new BudgetRegistry()

export type BudgetRegistryType = BudgetRegistry
