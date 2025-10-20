const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope &&
  typeof self.document === 'undefined'

if (isWorkerScope) {
  self.addEventListener('message', (event) => {
    const data = event?.data ?? null
    self.postMessage({
      type: 'mesh:unsupported',
      original: data,
    })
  })
}

export const createMeshWorker = () => {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment.')
  }
  return new Worker(new URL('./mesh.worker.ts', import.meta.url), {
    type: 'module',
  })
}
