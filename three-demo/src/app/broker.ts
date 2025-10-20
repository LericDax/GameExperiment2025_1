import { budgetRegistry, CPU_POOL } from './budgets/index.ts'
import {
  type MeshRequest,
  type PersistRequest,
  type ProcgenRequest,
  type WorkerBroker,
  type WorkerBrokerMessageEvent,
} from './broker.types'
import { createProcgenWorkerAdapter } from './services/procgen-worker-adapter.ts'

const WORKER_BUDGET_KEYS = {
  procgen: 'worker:procgen',
  mesh: 'worker:mesh',
  persist: 'worker:persist',
} as const

type Listener = EventListenerOrEventListenerObject

function dispatchToListener(listener: Listener, event: Event) {
  if (typeof listener === 'function') {
    listener(event)
    return
  }
  if (listener && typeof listener === 'object' && 'handleEvent' in listener) {
    const handler = listener.handleEvent
    if (typeof handler === 'function') {
      handler.call(listener, event)
    }
  }
}

function toTransferables(value: unknown): Transferable[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is Transferable => Boolean(entry))
}

function ensureKey(value: unknown): string {
  const key = String(value ?? '')
  if (!key) {
    throw new Error('[worker-broker] Requests require a stable key')
  }
  return key
}

function recordWorkerBudget(key: string, state: string) {
  budgetRegistry.request(CPU_POOL, key, 0, {
    type: 'worker',
    state,
    timestamp: Date.now(),
  })
}

export function createWorkerBroker(): WorkerBroker {
  const procgenAdapter = createProcgenWorkerAdapter()

  recordWorkerBudget(WORKER_BUDGET_KEYS.procgen, 'active')
  recordWorkerBudget(WORKER_BUDGET_KEYS.mesh, 'standby')
  recordWorkerBudget(WORKER_BUDGET_KEYS.persist, 'standby')

  const messageListeners = new Set<Listener>()
  const errorListeners = new Set<Listener>()

  const handleProcgenMessage = (event: WorkerBrokerMessageEvent) => {
    messageListeners.forEach((listener) => {
      dispatchToListener(listener, event)
    })
  }

  const handleProcgenError = (event: ErrorEvent) => {
    errorListeners.forEach((listener) => {
      dispatchToListener(listener, event)
    })
  }

  procgenAdapter.addEventListener('message', handleProcgenMessage)
  procgenAdapter.addEventListener('error', handleProcgenError)

  const requestProcgen: WorkerBroker['requestProcgen'] = (request) => {
    procgenAdapter.request(request)
  }

  const requestMesh: WorkerBroker['requestMesh'] = (request) => {
    const worker = procgenAdapter.getWorker()
    if (!worker) {
      return
    }
    const key = ensureKey(request.key)
    const payload = {
      type: 'mesh',
      key,
      payload: request.payload ?? {},
    }
    const transferables = toTransferables(request.transferables)
    try {
      if (transferables.length > 0) {
        worker.postMessage(payload, transferables)
      } else {
        worker.postMessage(payload)
      }
    } catch (error) {
      console.warn('[worker-broker] Failed to forward mesh request', error)
    }
  }

  const requestPersist: WorkerBroker['requestPersist'] = (request) => {
    const worker = procgenAdapter.getWorker()
    if (!worker) {
      return
    }
    const key = ensureKey(request.key)
    const payload = {
      type: 'persist',
      key,
      payload: request.payload ?? {},
      mode: request.type === 'persist:save' ? 'save' : 'load',
    }
    const transferables = toTransferables(request.transferables)
    try {
      if (transferables.length > 0) {
        worker.postMessage(payload, transferables)
      } else {
        worker.postMessage(payload)
      }
    } catch (error) {
      console.warn('[worker-broker] Failed to forward persist request', error)
    }
  }

  const addEventListener: WorkerBroker['addEventListener'] = (type, listener) => {
    if (type === 'message') {
      messageListeners.add(listener)
      return
    }
    if (type === 'error') {
      errorListeners.add(listener)
    }
  }

  const removeEventListener: WorkerBroker['removeEventListener'] = (
    type,
    listener,
  ) => {
    if (type === 'message') {
      messageListeners.delete(listener)
      return
    }
    if (type === 'error') {
      errorListeners.delete(listener)
    }
  }

  const terminate: WorkerBroker['terminate'] = () => {
    procgenAdapter.removeEventListener('message', handleProcgenMessage)
    procgenAdapter.removeEventListener('error', handleProcgenError)
    procgenAdapter.terminate()
    messageListeners.clear()
    errorListeners.clear()
    budgetRegistry.release(CPU_POOL, WORKER_BUDGET_KEYS.procgen)
    budgetRegistry.release(CPU_POOL, WORKER_BUDGET_KEYS.mesh)
    budgetRegistry.release(CPU_POOL, WORKER_BUDGET_KEYS.persist)
  }

  const getProcgenWorker: WorkerBroker['getProcgenWorker'] = () =>
    procgenAdapter.getWorker() ?? null

  return {
    requestProcgen,
    requestMesh,
    requestPersist,
    addEventListener,
    removeEventListener,
    terminate,
    getProcgenWorker,
  }
}
