import { createChunkBuildWorker } from '../../world/workers/chunk-build.worker.js'

export type ChunkWorkerChannel = 'chunk/gen' | 'chunk/mesh' | 'chunk/save'

export interface ChunkWorkerGenStartMessage {
  channel: 'chunk/gen'
  action: 'start'
  key: string
  payload?: Record<string, unknown>
  persistence?: unknown
  transferables?: Transferable[]
}

export interface ChunkWorkerGenStepMessage {
  channel: 'chunk/gen'
  action: 'step'
  key: string
  budget?: number
  payload?: { budget?: number }
}

export interface ChunkWorkerGenCancelMessage {
  channel: 'chunk/gen'
  action: 'cancel'
  key: string
}

export type ChunkWorkerUnsupportedMessage =
  | {
      channel: 'chunk/mesh'
      action: string
      payload?: unknown
    }
  | {
      channel: 'chunk/save'
      action: string
      payload?: unknown
    }

export type ChunkWorkerBrokerMessage =
  | ChunkWorkerGenStartMessage
  | ChunkWorkerGenStepMessage
  | ChunkWorkerGenCancelMessage
  | ChunkWorkerUnsupportedMessage

export interface ChunkWorkerGenEventData {
  channel: 'chunk/gen'
  kind: 'progress' | 'complete' | 'error'
  key: string | null
  processed: number
  done: boolean
  payload: unknown
  metadata: unknown
  error: unknown
  raw: unknown
}

export type ChunkWorkerBrokerEvent = MessageEvent<ChunkWorkerGenEventData>

export interface ChunkWorkerAdapter {
  postMessage(message: ChunkWorkerBrokerMessage): void
  addEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  removeEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  terminate(): void
  getLegacyWorker(): Worker
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
  data: ChunkWorkerGenEventData,
  original: MessageEvent,
): ChunkWorkerBrokerEvent {
  if (typeof MessageEvent === 'function') {
    return new MessageEvent('message', {
      data,
      origin: original?.origin ?? '',
      lastEventId: original?.lastEventId ?? '',
    }) as ChunkWorkerBrokerEvent
  }
  return {
    type: 'message',
    data,
    origin: original?.origin ?? '',
  } as ChunkWorkerBrokerEvent
}

function normalizeWorkerResponse(data: unknown): ChunkWorkerGenEventData {
  const record = (data && typeof data === 'object' ? data : null) as
    | Record<string, unknown>
    | null
  const key =
    record && record.key !== undefined && record.key !== null
      ? String(record.key)
      : null
  const processedCandidate = Number(record?.processed)
  const processed = Number.isFinite(processedCandidate)
    ? processedCandidate
    : 0
  const done = record?.done === true
  const error = record?.error ?? null
  const kind = error ? 'error' : done ? 'complete' : 'progress'
  const payload = record?.payload ?? null
  const metadata = record?.metadata ?? null
  return {
    channel: 'chunk/gen',
    kind,
    key,
    processed,
    done,
    payload,
    metadata,
    error,
    raw: data ?? null,
  }
}

function ensureKey(input: string | null | undefined): string {
  if (input == null || input === '') {
    throw new Error('[chunk-worker-adapter] Broker messages require a key')
  }
  return String(input)
}

function toTransferables(candidate: Transferable[] | undefined): Transferable[] {
  if (!Array.isArray(candidate)) {
    return []
  }
  return candidate.filter((entry): entry is Transferable => Boolean(entry))
}

export function createChunkWorkerAdapter(): ChunkWorkerAdapter {
  const worker = createChunkBuildWorker()
  const messageListeners = new Set<EventListenerOrEventListenerObject>()
  const errorListeners = new Set<EventListenerOrEventListenerObject>()
  let terminated = false

  const handleWorkerMessage = (event: MessageEvent) => {
    if (terminated) {
      return
    }
    const normalized = normalizeWorkerResponse(event?.data)
    const normalizedEvent = createNormalizedMessageEvent(normalized, event)
    messageListeners.forEach((listener) => {
      dispatchToListener(listener, normalizedEvent)
    })
  }

  const handleWorkerError = (event: ErrorEvent) => {
    errorListeners.forEach((listener) => {
      dispatchToListener(listener, event)
    })
  }

  worker.addEventListener('message', handleWorkerMessage)
  worker.addEventListener('error', handleWorkerError)

  const postMessage: ChunkWorkerAdapter['postMessage'] = (message) => {
    if (terminated) {
      throw new Error('[chunk-worker-adapter] Worker has been terminated')
    }
    switch (message.channel) {
      case 'chunk/gen': {
        switch (message.action) {
          case 'start': {
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
          case 'step': {
            const key = ensureKey(message.key)
            const budgetSource =
              message.budget ?? message.payload?.budget ?? undefined
            const budget = Number(budgetSource)
            const stepPayload: Record<string, unknown> = { type: 'step', key }
            if (Number.isFinite(budget)) {
              stepPayload.budget = budget
            }
            worker.postMessage(stepPayload)
            return
          }
          case 'cancel': {
            const key = ensureKey(message.key)
            worker.postMessage({ type: 'cancel', key })
            return
          }
          default: {
            const exhaustive: never = message.action
            throw new Error(
              `[chunk-worker-adapter] Unsupported generation action "${exhaustive}"`,
            )
          }
        }
      }
      case 'chunk/mesh':
      case 'chunk/save': {
        throw new Error(
          `[chunk-worker-adapter] Channel "${message.channel}" not implemented`,
        )
      }
      default: {
        const exhaustive: never = message
        throw new Error(
          `[chunk-worker-adapter] Unsupported broker message ${JSON.stringify(
            exhaustive,
          )}`,
        )
      }
    }
  }

  const addEventListener: ChunkWorkerAdapter['addEventListener'] = (
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

  const removeEventListener: ChunkWorkerAdapter['removeEventListener'] = (
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

  const terminate: ChunkWorkerAdapter['terminate'] = () => {
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

  const getLegacyWorker: ChunkWorkerAdapter['getLegacyWorker'] = () => worker

  return {
    postMessage,
    addEventListener,
    removeEventListener,
    terminate,
    getLegacyWorker,
  }
}
