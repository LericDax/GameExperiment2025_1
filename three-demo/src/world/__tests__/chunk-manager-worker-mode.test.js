import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const biomeDefinition = JSON.parse(
  await readFile(new URL('../biomes/temperate.json', import.meta.url), 'utf8'),
);
globalThis.__BIOME_MODULE_MAP__ = {
  './temperate.json': biomeDefinition,
};

const voxelObjectDefinition = JSON.parse(
  await readFile(
    new URL('../voxel-objects/small-plants/temperate_shrub.json', import.meta.url),
    'utf8',
  ),
);
globalThis.__VOXEL_OBJECT_MODULE_MAP__ = {
  './small-plants/temperate_shrub.json': voxelObjectDefinition,
};

const generationModule = await import('../generation.js');
generationModule.initializeWorldGeneration({ THREE });

const fluidRegistryModule = await import('../fluids/fluid-registry.js');
fluidRegistryModule.initializeFluidRegistry({ THREE });

const {
  createChunkManager,
  __setChunkBuildWorkerFactoryForTest,
  __resetChunkBuildWorkerFactoryForTest,
  __setChunkPersistenceQueueFactoryForTest,
  __resetChunkPersistenceQueueFactoryForTest,
} = await import('../chunk-manager.js');

function createBlockMaterials() {
  const createdMaterials = new Set();
  const registry = new Proxy(
    {},
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }
        if (typeof property !== 'string') {
          return target[property];
        }
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        target[property] = material;
        createdMaterials.add(material);
        return material;
      },
    },
  );
  return { registry, createdMaterials };
}

async function waitForCondition(predicate, { timeout = 2000, interval = 5 } = {}) {
  const start = Date.now();
  while (true) {
    if (predicate()) {
      return;
    }
    if (Date.now() - start >= timeout) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

class FakeChunkBuildWorker {
  constructor(options = {}) {
    this.messages = [];
    this.transferLists = [];
    this.listeners = new Map();
    this.startedKeys = new Set();
    this.options = options;
    this.terminated = false;
  }

  addEventListener(type, listener) {
    if (!type || typeof listener !== 'function') {
      return;
    }
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.listeners.delete(type);
    }
  }

  emit(type, data) {
    const listeners = this.listeners.get(type);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const event = { data };
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        // Surface listener errors to align with Worker semantics during tests.
        console.error('[test] fake worker listener error', error);
      }
    });
  }

  postMessage(message, transferList = []) {
    this.messages.push(message);
    if (!Array.isArray(transferList)) {
      this.transferLists.push([]);
    } else {
      this.transferLists.push(transferList);
    }
    const { options } = this;
    const { type, key } = message ?? {};

    if (type === 'start') {
      if (options.failStart) {
        throw options.failStart instanceof Error
          ? options.failStart
          : new Error(String(options.failStart));
      }
      this.startedKeys.add(key);
      options.onStart?.(message);
      return;
    }

    if (type === 'step') {
      const requireStart = options.requireStart !== false;
      if (requireStart && key && !this.startedKeys.has(key)) {
        throw new Error(`step-before-start:${key}`);
      }
      options.onStep?.(message);
      return;
    }

    if (type === 'cancel') {
      options.onCancel?.(message);
    }
  }

  terminate() {
    this.terminated = true;
  }
}

class FakeChunkPersistenceQueue {
  constructor() {
    this.loadJobs = [];
    this.saveJobs = [];
  }

  enqueueLoad(job = {}) {
    return new Promise((resolve, reject) => {
      this.loadJobs.push({ job, resolve, reject });
    });
  }

  enqueueSave(job = {}) {
    this.saveJobs.push(job);
    return Promise.resolve();
  }

  resolveNextLoad(value = null) {
    const record = this.loadJobs.shift();
    if (!record) {
      throw new Error('No pending load job to resolve.');
    }
    record.resolve(value);
  }

  rejectNextLoad(error) {
    const record = this.loadJobs.shift();
    if (!record) {
      throw new Error('No pending load job to reject.');
    }
    record.reject(error);
  }

  dispose() {
    this.loadJobs.length = 0;
    this.saveJobs.length = 0;
  }
}

test('chunk manager posts worker start payloads before steps', async () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const scene = new THREE.Scene();
  const worker = new FakeChunkBuildWorker();
  const persistenceQueue = new FakeChunkPersistenceQueue();
  __setChunkBuildWorkerFactoryForTest(() => worker);
  __setChunkPersistenceQueueFactoryForTest(() => persistenceQueue);

  let manager;
  try {
    manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });

    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 1,
    });

    await waitForCondition(() => persistenceQueue.loadJobs.length > 0);

    assert.equal(
      worker.messages.some((entry) => entry?.type === 'start'),
      false,
      'worker should not receive start message before persistence resolves',
    );

    persistenceQueue.resolveNextLoad();

    await waitForCondition(
      () =>
        worker.messages.some((entry) => entry?.type === 'start') &&
        worker.messages.some((entry) => entry?.type === 'step'),
    );

    assert.ok(worker.messages.length >= 2, 'expected worker to receive start and step messages');
    assert.equal(worker.messages[0]?.type, 'start', 'first worker message should start the job');
    const startMessage = worker.messages.find((entry) => entry?.type === 'start');
    const stepMessage = worker.messages.find((entry) => entry?.type === 'step');

    assert.ok(startMessage, 'expected a start message to be posted');
    assert.ok(stepMessage, 'expected a step message to be posted');
    assert.ok(
      worker.messages.indexOf(stepMessage) > worker.messages.indexOf(startMessage),
      'step message should be sent after start message',
    );

    assert.ok(
      startMessage.persistence && typeof startMessage.persistence === 'object',
      'start message should include persistence metadata',
    );
    assert.equal(startMessage.persistence.state, 'ready');
    assert.equal(startMessage.persistence.result, null);
    assert.ok(
      Array.isArray(startMessage.persistence.transferables),
      'persistence payload should provide a transferables array',
    );
    assert.equal(
      startMessage.persistence.transferables.length,
      0,
      'empty persistence results should not enqueue transfer buffers',
    );

    assert.equal(startMessage.key, '0|0');
    assert.deepEqual(
      Object.keys(startMessage.payload).sort(),
      ['blockMaterials', 'chunkX', 'chunkZ', 'detailLevel', 'worldOptions'],
    );
    assert.equal(startMessage.payload.chunkX, 0);
    assert.equal(startMessage.payload.chunkZ, 0);
    assert.equal(startMessage.payload.detailLevel, 'core');
    assert.equal(Object.getPrototypeOf(startMessage.payload.worldOptions), Object.prototype);
    assert.ok(
      Object.keys(startMessage.payload.worldOptions).length > 0,
      'world options payload should include serialized properties',
    );
    assert.equal(
      typeof startMessage.payload.worldOptions.seedHash,
      'number',
      'serialized world options should expose a numeric seed hash',
    );
    assert.equal(
      typeof startMessage.payload.worldOptions.chunkSize,
      'number',
      'serialized world options should expose the chunk size',
    );
    assert.ok(
      Object.values(startMessage.payload.worldOptions).every(
        (value) => typeof value !== 'function',
      ),
      'world options payload should omit non-serializable functions',
    );

    const serializedMaterials = startMessage.payload.blockMaterials;
    assert.equal(Object.getPrototypeOf(serializedMaterials), Object.prototype);
    assert.deepEqual(serializedMaterials.__defaults, {
      transparent: false,
      opacity: 1,
      depthWrite: true,
      userData: {},
    });
    assert.ok(
      Object.values(serializedMaterials).every((entry) =>
        entry && typeof entry === 'object' && Object.values(entry).every((value) => typeof value !== 'function'),
      ),
      'block material payload should omit non-serializable functions',
    );

    assert.equal(typeof stepMessage.budget, 'number');
    assert.ok(stepMessage.budget > 0, 'step budget should be positive');

    const task = generationModule.createChunkBuildTask({
      chunkX: startMessage.payload.chunkX,
      chunkZ: startMessage.payload.chunkZ,
      blockMaterials,
      requireWorkerPayload: true,
      detailLevel: startMessage.payload.detailLevel,
    });
    let taskDone = false;
    while (!taskDone) {
      const result = task.step(Number.POSITIVE_INFINITY);
      taskDone = result?.done === true;
    }
    const workerPayload = task.exportPayloadSnapshot();
    task.releaseCachedPayload?.();

    worker.emit('message', {
      key: startMessage.key,
      processed: stepMessage.budget,
      done: true,
      payload: workerPayload,
    });

    await waitForCondition(() =>
      Boolean(manager?.__getLoadedChunkForTest?.(startMessage.key)),
    );

    assert.ok(
      !worker.messages.some((entry) => entry?.type === 'cancel'),
      'worker job should complete without receiving a cancel message',
    );

    const loadedChunk = manager.__getLoadedChunkForTest(startMessage.key);
    assert.ok(loadedChunk, 'expected worker-built chunk to load successfully');
    assert.equal(loadedChunk.detailLevel, 'core');
    await manager.flush();
  } finally {
    await manager?.dispose?.();
    persistenceQueue.dispose();
    __resetChunkPersistenceQueueFactoryForTest();
    __resetChunkBuildWorkerFactoryForTest();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('chunk manager forwards persistence payload buffers to worker start message', async () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const scene = new THREE.Scene();
  const worker = new FakeChunkBuildWorker();
  const persistenceQueue = new FakeChunkPersistenceQueue();
  __setChunkBuildWorkerFactoryForTest(() => worker);
  __setChunkPersistenceQueueFactoryForTest(() => persistenceQueue);

  let manager;
  try {
    manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });

    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 1,
    });

    await waitForCondition(() => persistenceQueue.loadJobs.length > 0);

    const snapshotBuffer = new Uint32Array([1, 2, 3, 4]).buffer;
    const persistenceResult = {
      payload: {
        detailLevel: 'core',
        occupancy: { solidCoordinates: ['0|0|0'] },
        buffers: [snapshotBuffer],
      },
      metadata: { restored: true },
    };
    persistenceQueue.resolveNextLoad(persistenceResult);

    await waitForCondition(() =>
      worker.messages.some((entry) => entry?.type === 'start'),
    );

    const startIndex = worker.messages.findIndex(
      (entry) => entry?.type === 'start',
    );
    assert.ok(startIndex >= 0, 'expected worker start message');
    const startMessage = worker.messages[startIndex];
    assert.ok(startMessage.persistence, 'start message should include persistence payload');
    assert.equal(startMessage.persistence.state, 'ready');
    assert.strictEqual(
      startMessage.persistence.result,
      persistenceResult,
      'persistence result should be passed by reference to the worker message',
    );
    assert.strictEqual(
      startMessage.persistence.result.payload,
      persistenceResult.payload,
      'worker should receive persistence payload object',
    );
    assert.ok(
      Array.isArray(startMessage.persistence.transferables),
      'persistence metadata should include transferables',
    );
    assert.equal(
      startMessage.persistence.transferables.length,
      1,
      'expected a single buffer transferable for the snapshot payload',
    );

    const transferList = worker.transferLists[startIndex] ?? [];
    assert.equal(
      transferList.length,
      1,
      'worker should receive snapshot buffer in the transfer list',
    );
    assert.strictEqual(
      transferList[0],
      startMessage.persistence.transferables[0],
      'transfer list should match persistence transferables',
    );
    assert.equal(
      transferList[0].byteLength,
      snapshotBuffer.byteLength,
      'transferred buffer byte length should match the source snapshot buffer',
    );

    const stepMessage = worker.messages.find((entry) => entry?.type === 'step');
    assert.ok(stepMessage, 'expected worker to receive a step message after start');

    worker.emit('message', {
      key: startMessage.key,
      processed: Number.isFinite(stepMessage?.budget)
        ? Math.max(1, Math.floor(stepMessage.budget))
        : 1,
      done: true,
      payload: persistenceResult.payload,
      metadata: persistenceResult.metadata,
    });

    await waitForCondition(() =>
      Boolean(manager?.__getLoadedChunkForTest?.(startMessage.key)),
    );
    await manager.flush();
  } finally {
    await manager?.dispose?.();
    persistenceQueue.dispose();
    __resetChunkPersistenceQueueFactoryForTest();
    __resetChunkBuildWorkerFactoryForTest();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('chunk manager falls back to local execution when worker start fails', async () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const scene = new THREE.Scene();
  const worker = new FakeChunkBuildWorker({
    failStart: new Error('synthetic start failure'),
  });
  __setChunkBuildWorkerFactoryForTest(() => worker);

  let manager;
  try {
    manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });

    const origin = new THREE.Vector3(0, 0, 0);
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 1,
    });

    await manager.flush();

    await waitForCondition(() => Boolean(scene.getObjectByName('chunk_0_0')));

    const chunkGroup = scene.getObjectByName('chunk_0_0');
    assert.ok(
      chunkGroup?.isGroup,
      'expected chunk manager to produce a chunk via local execution fallback',
    );

    const stepMessages = worker.messages.filter((entry) => entry?.type === 'step');
    assert.equal(
      stepMessages.length,
      0,
      'worker should not receive step messages when start fails',
    );
  } finally {
    await manager?.dispose?.();
    __resetChunkBuildWorkerFactoryForTest();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});
