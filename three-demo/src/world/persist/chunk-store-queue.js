export const DEFAULT_CHUNK_STORE_TIMEOUT_MS = 2000;

function normalizeTimeout(value, fallback) {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  if (fallback === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const fallbackNumeric = Number(fallback);
  if (!Number.isFinite(fallbackNumeric) || fallbackNumeric <= 0) {
    return 0;
  }
  return Math.floor(fallbackNumeric);
}

function runWithTimeout(factory, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve().then(factory);
  }
  let timer = null;
  return new Promise((resolve, reject) => {
    let settled = false;
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('Chunk store queue operation timed out.'));
    }, timeoutMs);
    Promise.resolve()
      .then(factory)
      .then((result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        reject(error);
      });
  });
}

export function createChunkStoreQueue({
  load = async () => null,
  save = async () => {},
  defaultTimeoutMs = DEFAULT_CHUNK_STORE_TIMEOUT_MS,
} = {}) {
  let disposed = false;
  const jobs = [];
  let running = false;

  const processQueue = () => {
    if (running) {
      return;
    }
    running = true;
    const pump = async () => {
      while (jobs.length > 0 && !disposed) {
        const { factory, timeoutMs, resolve, reject } = jobs.shift();
        try {
          const result = await runWithTimeout(factory, timeoutMs);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
      running = false;
    };
    pump().catch((error) => {
      running = false;
      console.warn('[chunk-store-queue] Failed to process queue', error);
    });
  };

  const enqueue = (factory, timeoutMs) => {
    if (disposed) {
      return Promise.resolve(null);
    }
    const effectiveTimeout = normalizeTimeout(timeoutMs, defaultTimeoutMs);
    return new Promise((resolve, reject) => {
      jobs.push({ factory, timeoutMs: effectiveTimeout, resolve, reject });
      processQueue();
    });
  };

  return {
    enqueueLoad(job = {}) {
      return enqueue(() => load(job), job.timeoutMs);
    },
    enqueueSave(job = {}) {
      return enqueue(() => save(job), job.timeoutMs);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      while (jobs.length > 0) {
        const job = jobs.shift();
        try {
          job?.resolve?.(null);
        } catch (error) {
          console.warn('[chunk-store-queue] Failed to settle disposed job', error);
        }
      }
      running = false;
    },
  };
}
