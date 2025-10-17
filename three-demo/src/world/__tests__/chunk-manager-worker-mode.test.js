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

  postMessage(message) {
    this.messages.push(message);
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

test('chunk manager posts worker start payloads before steps', async () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const scene = new THREE.Scene();
  const worker = new FakeChunkBuildWorker();
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
