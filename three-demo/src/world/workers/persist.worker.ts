const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope &&
  typeof self.document === 'undefined'

if (isWorkerScope) {
  self.addEventListener('message', (event) => {
    const data = event?.data ?? null
    self.postMessage({
      type: 'persist:unsupported',
      original: data,
    })
  })
}

export const createPersistWorker = () => {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment.')
  }
  return new Worker(new URL('./persist.worker.ts', import.meta.url), {
    type: 'module',
  })
}
