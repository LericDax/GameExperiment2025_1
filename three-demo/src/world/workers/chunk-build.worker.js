import { buildChunkPayload } from '../chunk-build-core.js';

const builders = new Map();

const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope &&
  typeof self.document === 'undefined';

const postFromWorker = (message, transferables = undefined) => {
  if (typeof self === 'undefined' || typeof self.postMessage !== 'function') {
    return;
  }
  if (Array.isArray(transferables) && transferables.length > 0) {
    self.postMessage(message, transferables);
  } else {
    self.postMessage(message);
  }
};

const toTransferableSet = (value, transferables = new Set(), seen = new Set()) => {
  if (value == null) {
    return transferables;
  }

  if (typeof value !== 'object') {
    return transferables;
  }

  if (seen.has(value)) {
    return transferables;
  }

  seen.add(value);

  const registerBuffer = (buffer) => {
    if (!buffer) {
      return;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return;
    }
    transferables.add(buffer);
  };

  if (value instanceof ArrayBuffer) {
    registerBuffer(value);
    return transferables;
  }

  if (ArrayBuffer.isView(value)) {
    registerBuffer(value.buffer);
    return transferables;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  if (value instanceof Map) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  if (value instanceof Set) {
    value.forEach((entry) => toTransferableSet(entry, transferables, seen));
    return transferables;
  }

  Object.values(value).forEach((entry) =>
    toTransferableSet(entry, transferables, seen),
  );
  return transferables;
};

const normalizeBudget = (value) => {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

const serializeError = (error) => {
  if (!error) {
    return null;
  }
  const message = error?.message ?? String(error);
  const name = error?.name ?? 'Error';
  const stack = error?.stack ?? null;
  return { name, message, stack };
};

const createBuilder = (options = {}) => {
  const totalWorkUnits = 1;
  let processedUnits = 0;
  let done = false;
  let payload = null;
  let errorInfo = null;

  const runBuild = () => {
    try {
      payload = buildChunkPayload(options);
    } catch (error) {
      errorInfo = serializeError(error);
      payload = null;
    }
  };

  return {
    step(budget) {
      const normalizedBudget = normalizeBudget(budget);
      if (done) {
        return { processed: 0, done: true };
      }
      if (normalizedBudget <= 0) {
        return { processed: 0, done: false };
      }
      const remaining = Math.max(0, totalWorkUnits - processedUnits);
      if (remaining === 0) {
        done = true;
        return { processed: 0, done: true };
      }
      const processed = Math.min(remaining, normalizedBudget);
      processedUnits += processed;
      if (processedUnits >= totalWorkUnits) {
        runBuild();
        done = true;
      }
      return { processed, done };
    },
    takePayload() {
      const result = payload;
      payload = null;
      return result;
    },
    takeError() {
      const error = errorInfo;
      errorInfo = null;
      return error;
    },
    cancel() {
      done = true;
      payload = null;
      errorInfo = null;
    },
    isDone() {
      return done;
    },
  };
};

const handleStartMessage = ({ key, payload }) => {
  if (!key) {
    return;
  }
  const existing = builders.get(key);
  if (existing) {
    existing.cancel();
  }
  const builder = createBuilder(payload ?? {});
  builders.set(key, builder);
};

const handleStepMessage = (message) => {
  const { key } = message;
  if (!key) {
    return;
  }
  const builder = builders.get(key);
  if (!builder) {
    const response = { key, processed: 0, done: true };
    postFromWorker(response);
    return;
  }
  const payload = message.payload;
  const budgetCandidate =
    message.budget ??
    payload?.budget ??
    payload?.count ??
    payload?.limit ??
    payload ??
    0;
  const budget = budgetCandidate;
  const { processed = 0, done = false } = builder.step(budget);
  const response = { key, processed, done };
  let transferables = undefined;
  if (done) {
    const resultPayload = builder.takePayload();
    const errorInfo = builder.takeError();
    if (resultPayload !== null && resultPayload !== undefined) {
      response.payload = resultPayload;
      const transferableSet = toTransferableSet(resultPayload);
      if (transferableSet.size > 0) {
        transferables = Array.from(transferableSet);
      }
    }
    if (errorInfo) {
      response.error = errorInfo;
    }
    builders.delete(key);
  }
  postFromWorker(response, transferables);
};

const handleCancelMessage = ({ key }) => {
  if (!key) {
    return;
  }
  const builder = builders.get(key);
  if (!builder) {
    return;
  }
  builder.cancel();
  builders.delete(key);
};

const handleMessageEvent = (event) => {
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return;
  }
  const { type } = data;
  switch (type) {
    case 'start':
      handleStartMessage(data);
      break;
    case 'step':
      handleStepMessage(data);
      break;
    case 'cancel':
      handleCancelMessage(data);
      break;
    default:
      break;
  }
};

if (isWorkerScope) {
  self.addEventListener('message', handleMessageEvent);
}

export const createChunkBuildWorker = () => {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment.');
  }
  return new Worker(new URL('./chunk-build.worker.js', import.meta.url), {
    type: 'module',
  });
};

