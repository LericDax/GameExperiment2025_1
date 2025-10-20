import { createProcgenWorker } from '../../world/workers/procgen.worker.ts'
import type {
  BrokerProcgenEvent,
  ProcgenRequest,
  WorkerBrokerMessageEvent,
} from '../broker.types'

function ensureKey(value: unknown): string {
  const key = String(value ?? '')
  if (!key) {
    throw new Error('[procgen-worker-adapter] Requests require a stable key')
  }
  return key
}

function toTransferables(value: unknown): Transferable[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is Transferable => Boolean(entry))
}

function dispatchToListener(
  listener: EventListenerOrEventListenerObject,
  event: Event,
) {
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

function createNormalizedMessageEvent(
  data: BrokerProcgenEvent,
  original: MessageEvent,
): WorkerBrokerMessageEvent {
  if (typeof MessageEvent === 'function') {
    return new MessageEvent('message', {
      data,
      origin: original?.origin ?? '',
      lastEventId: original?.lastEventId ?? '',
    }) as WorkerBrokerMessageEvent
  }
  return {
    type: 'message',
    data,
    origin: original?.origin ?? '',
  } as WorkerBrokerMessageEvent
}

function normalizeWorkerResponse(data: unknown): BrokerProcgenEvent {
  const record = (data && typeof data === 'object' ? data : null) as
    | Record<string, unknown>
    | null
  const key =
    record && record.key !== undefined && record.key !== null
      ? String(record.key)
      : null
  const processedCandidate = Number(record?.processed)
  const processed = Number.isFinite(processedCandidate) ? processedCandidate : 0
  const done = record?.done === true
  const error = record?.error ?? null
  const kind = error ? 'error' : done ? 'complete' : 'progress'
  const payload = record?.payload ?? null
  const metadata = record?.metadata ?? null

  return {
    source: 'procgen',
    kind,
    key,
    processed,
    done,
    payload,
    metadata,
    error,
    raw: record,
  }
}

export interface ProcgenWorkerAdapter {
  request(message: ProcgenRequest): void
  addEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  removeEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  terminate(): void
  getWorker(): Worker
}

export function createProcgenWorkerAdapter(): ProcgenWorkerAdapter {
  const worker = createProcgenWorker()

  const messageListeners = new Set<EventListenerOrEventListenerObject>()
  const errorListeners = new Set<EventListenerOrEventListenerObject>()
  let terminated = false

  const handleWorkerMessage = (event: MessageEvent) => {
    const normalized = normalizeWorkerResponse(event?.data)
    const synthetic = createNormalizedMessageEvent(normalized, event)
    messageListeners.forEach((listener) => {
      dispatchToListener(listener, synthetic)
    })
  }

  const handleWorkerError = (event: ErrorEvent) => {
    errorListeners.forEach((listener) => {
      dispatchToListener(listener, event)
    })
  }

  worker.addEventListener('message', handleWorkerMessage)
  worker.addEventListener('error', handleWorkerError)

  const request: ProcgenWorkerAdapter['request'] = (message) => {
    if (terminated) {
      throw new Error('[procgen-worker-adapter] Worker has been terminated')
    }
    switch (message.type) {
      case 'procgen:start': {
        const key = ensureKey(message.key)
        const startPayload: Record<string, unknown> = {
          type: 'start',
          key,
          payload: message.payload ?? {},
        }
        if (message.persistence !== undefined) {
          startPayload.persistence = message.persistence
        }
        const transferables = toTransferables(message.transferables)
        if (transferables.length > 0) {
          worker.postMessage(startPayload, transferables)
        } else {
          worker.postMessage(startPayload)
        }
        return
      }
      case 'procgen:step': {
        const key = ensureKey(message.key)
        const budget = Number(message.budget)
        const stepPayload: Record<string, unknown> = { type: 'step', key }
        if (Number.isFinite(budget)) {
          stepPayload.budget = budget
        }
        worker.postMessage(stepPayload)
        return
      }
      case 'procgen:cancel': {
        const key = ensureKey(message.key)
        worker.postMessage({ type: 'cancel', key })
        return
      }
      default: {
        const exhaustive: never = message
        throw new Error(
          `[procgen-worker-adapter] Unsupported request ${JSON.stringify(
            exhaustive,
          )}`,
        )
      }
    }
  }

  const addEventListener: ProcgenWorkerAdapter['addEventListener'] = (
    type,
    listener,
  ) => {
    if (type === 'message') {
      messageListeners.add(listener)
      return
    }
    if (type === 'error') {
      errorListeners.add(listener)
    }
  }

  const removeEventListener: ProcgenWorkerAdapter['removeEventListener'] = (
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

  const terminate: ProcgenWorkerAdapter['terminate'] = () => {
    if (terminated) {
      return
    }
    terminated = true
    worker.removeEventListener('message', handleWorkerMessage)
    worker.removeEventListener('error', handleWorkerError)
    messageListeners.clear()
    errorListeners.clear()
    worker.terminate?.()
  }

  const getWorker: ProcgenWorkerAdapter['getWorker'] = () => worker

  return {
    request,
    addEventListener,
    removeEventListener,
    terminate,
    getWorker,
  }
}
