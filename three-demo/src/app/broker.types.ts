export type ProcgenStartRequest = {
  type: 'procgen:start'
  key: string
  payload?: Record<string, unknown>
  persistence?: unknown
  transferables?: Transferable[]
}

export type ProcgenStepRequest = {
  type: 'procgen:step'
  key: string
  budget?: number
}

export type ProcgenCancelRequest = {
  type: 'procgen:cancel'
  key: string
}

export type ProcgenRequest =
  | ProcgenStartRequest
  | ProcgenStepRequest
  | ProcgenCancelRequest

export type MeshBuildRequest = {
  type: 'mesh:build'
  key: string
  payload?: Record<string, unknown>
  transferables?: Transferable[]
}

export type MeshCancelRequest = {
  type: 'mesh:cancel'
  key: string
}

export type MeshRequest = MeshBuildRequest | MeshCancelRequest

export type PersistLoadRequest = {
  type: 'persist:load'
  key: string
  payload?: Record<string, unknown>
  transferables?: Transferable[]
}

export type PersistSaveRequest = {
  type: 'persist:save'
  key: string
  payload?: Record<string, unknown>
  transferables?: Transferable[]
}

export type PersistCancelRequest = {
  type: 'persist:cancel'
  key: string
}

export type PersistRequest =
  | PersistLoadRequest
  | PersistSaveRequest
  | PersistCancelRequest

export type BrokerSource = 'procgen' | 'mesh' | 'persist'

export type BrokerEventKind = 'progress' | 'complete' | 'error'

export interface BrokerProcgenEvent {
  source: 'procgen'
  kind: BrokerEventKind
  key: string | null
  processed: number
  done: boolean
  payload: unknown
  metadata: unknown
  error: unknown
  raw: unknown
}

export type WorkerBrokerEventData = BrokerProcgenEvent

export type WorkerBrokerMessageEvent = MessageEvent<WorkerBrokerEventData>

export interface WorkerBroker {
  requestProcgen(request: ProcgenRequest): void
  requestMesh(request: MeshRequest): void
  requestPersist(request: PersistRequest): void
  addEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  removeEventListener(
    type: 'message' | 'error',
    listener: EventListenerOrEventListenerObject,
  ): void
  terminate(): void
  getProcgenWorker(): Worker | null
}
