import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const originalConsoleLog = console.log;
const originalConsoleDebug = console.debug;
const suppressiblePrefixes = ['[voxel-object-placement]'];
const shouldSuppressLog = (value) =>
  typeof value === 'string' && suppressiblePrefixes.some((prefix) => value.startsWith(prefix));

console.log = (...args) => {
  if (shouldSuppressLog(args[0])) {
    return;
  }
  originalConsoleLog(...args);
};

console.debug = (...args) => {
  if (shouldSuppressLog(args[0])) {
    return;
  }
  originalConsoleDebug(...args);
};

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

const immediatePersistenceQueueFactory = () => ({
  enqueueLoad: () => Promise.resolve(null),
  enqueueSave: () => Promise.resolve(null),
  dispose: () => {},
});

__setChunkPersistenceQueueFactoryForTest(immediatePersistenceQueueFactory);

test.after(() => {
  __resetChunkPersistenceQueueFactoryForTest();
});

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

test('createChunkBuildTask completes after multiple incremental steps', () => {
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  try {
    const task = generationModule.createChunkBuildTask({
      chunkX: 0,
      chunkZ: 0,
      blockMaterials,
    });

    const firstResult = task.step(1);
    assert.ok(!firstResult.done, 'a single column budget should not finish the chunk');
    assert.ok(
      (firstResult.processed ?? 0) > 0,
      'initial incremental step should process work',
    );

    let iterations = 1;
    let totalProcessed = firstResult.processed ?? 0;
    let done = firstResult.done;

    while (!done) {
      const { done: stepDone, processed } = task.step(128);
      iterations += 1;
      totalProcessed += processed ?? 0;
      if (!stepDone) {
        assert.ok(
          (processed ?? 0) > 0,
          'subsequent steps should continue to process work',
        );
      }
      done = stepDone;
    }

    assert.ok(iterations > 1, 'expected chunk build to require multiple steps');
    assert.ok(totalProcessed > 0, 'chunk build should process measurable work');

    const chunk = task.finalize();
    assert.equal(chunk.chunkX, 0);
    assert.equal(chunk.chunkZ, 0);
    assert.ok(chunk.group?.isGroup, 'finalized chunk should include a group container');

    assert.throws(() => task.finalize(), /Chunk already finalized/);
  } finally {
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('preload queue preserves partial tasks until forced to drain', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const createdManagers = [];
  const createdMaterials = [];

  const createManager = () => {
    const scene = new THREE.Scene();
    const materials = createBlockMaterials();
    const manager = createChunkManager({
      scene,
      blockMaterials: materials.registry,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });
    createdManagers.push(manager);
    createdMaterials.push(materials);
    return { scene, manager, materials };
  };

  const { scene, manager } = createManager();

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 0,
    maxPreload: 0,
    force: true,
  });
  await manager.flush();

  assert.ok(
    scene.getObjectByName('chunk_0_0'),
    'expected origin chunk to load during forced bootstrap',
  );

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
  });

  assert.ok(
    !scene.getObjectByName('chunk_1_0'),
    'neighbor chunk should remain pending when no preload budget is available',
  );

  manager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
    force: true,
  });
  await manager.flush();

  assert.ok(
    scene.getObjectByName('chunk_1_0'),
    'forcing an update should drain pending preload tasks in the same frame',
  );

  const { scene: infiniteScene, manager: infiniteManager } = createManager();

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 0,
    maxPreload: 0,
    force: true,
  });
  await infiniteManager.flush();

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: 0,
  });

  const neighborChunkNames = [
    'chunk_1_0',
    'chunk_-1_0',
    'chunk_0_1',
    'chunk_0_-1',
  ];

  neighborChunkNames.forEach((name) => {
    assert.ok(
      !infiniteScene.getObjectByName(name),
      'neighbor chunk should stay pending before infinite budget drains it',
    );
  });

  infiniteManager.update(origin, {
    viewDistance: 0,
    retainDistance: 1,
    maxPreload: Number.POSITIVE_INFINITY,
  });
  await infiniteManager.flush();

  neighborChunkNames.forEach((name) => {
    assert.ok(
      infiniteScene.getObjectByName(name),
      'infinite preload budget should finish every pending chunk build task immediately',
    );
  });

  while (createdManagers.length > 0) {
    const instance = createdManagers.pop();
    const materials = createdMaterials.pop();
    try {
      await instance.dispose();
    } finally {
      materials?.createdMaterials?.forEach((material) => material.dispose?.());
    }
  }
});

test('flush resolves pending chunk jobs asynchronously', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 1,
    maxDisposalsPerUpdate: 0,
  });

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 1,
      maxPreload: 0,
    });

    const pendingFlush = manager.flush();
    assert.ok(
      pendingFlush && typeof pendingFlush.then === 'function',
      'flush should return a promise while draining pending work',
    );

    await pendingFlush;

    assert.ok(
      scene.getObjectByName('chunk_1_0'),
      'expected flush to resolve and finalize the pending neighbor chunk',
    );
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('forced flush drains pending chunks without repeated idle delays', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 1,
    maxDisposalsPerUpdate: 0,
  });

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    const backlogRadius = 1;
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: backlogRadius,
      maxPreload: 0,
    });

    const neighborChunkNames = [
      'chunk_1_0',
      'chunk_-1_0',
      'chunk_0_1',
      'chunk_0_-1',
    ];

    neighborChunkNames.forEach((name) => {
      assert.ok(
        !scene.getObjectByName(name),
        'neighbor chunk should be pending before forced flush runs',
      );
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalConsoleLog = console.log;
    let idleCallbacks = 0;
    globalThis.setTimeout = (callback, delay = 0, ...args) => {
      idleCallbacks += 1;
      return originalSetTimeout(() => callback(...args), 0);
    };

    try {
      console.log = (...args) => {
        if (
          typeof args[0] === 'string' &&
          args[0].startsWith('[voxel-object-placement]')
        ) {
          return;
        }
        originalConsoleLog(...args);
      };
      await manager.flush();
    } finally {
      console.log = originalConsoleLog;
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.ok(
      idleCallbacks <= 4,
      `forced flush should avoid repeated idle callbacks (observed ${idleCallbacks})`,
    );

    neighborChunkNames.forEach((name) => {
      assert.ok(
        scene.getObjectByName(name),
        'forced flush should finalize each pending neighbor chunk',
      );
    });
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('urgent preload entries finish within a few scheduler ticks', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 8,
    maxDisposalsPerUpdate: 0,
  });

  try {
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: 0,
      maxPreload: 0,
      force: true,
    });
    await manager.flush();

    const backlogRadius = 3;
    manager.update(origin, {
      viewDistance: 0,
      retainDistance: backlogRadius,
      maxPreload: 0,
    });

    const targetChunkName = 'chunk_2_0';
    assert.ok(
      !scene.getObjectByName(targetChunkName),
      'target chunk should remain pending before it becomes urgent',
    );

    const { chunkSize } = generationModule.getWorldOptions();
    const urgentPosition = new THREE.Vector3(chunkSize * 2, 0, 0);

    manager.update(urgentPosition, {
      viewDistance: 0,
      retainDistance: backlogRadius,
      maxPreload: 0,
    });

    assert.ok(
      !scene.getObjectByName(targetChunkName),
      'marking the chunk urgent should not immediately finalize it without budget',
    );

    let ticks = 0;
    let backlogLoadedBeforeUrgent = false;
    const maxTicks = 12;
    while (!scene.getObjectByName(targetChunkName) && ticks < maxTicks) {
      ticks += 1;
      manager.update(urgentPosition, {
        viewDistance: 0,
        retainDistance: backlogRadius,
        maxPreload: 8,
      });
      // Allow the asynchronous job pump to run between scheduler ticks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!scene.getObjectByName(targetChunkName) && scene.getObjectByName('chunk_3_0')) {
        backlogLoadedBeforeUrgent = true;
        break;
      }
    }

    if (!scene.getObjectByName(targetChunkName)) {
      await manager.flush();
    }

    assert.ok(
      scene.getObjectByName(targetChunkName),
      'expected urgent chunk to finish after a short burst of scheduler updates',
    );
    assert.ok(
      ticks <= maxTicks,
      `expected urgent chunk to complete within ${maxTicks} ticks, processed in ${ticks}`,
    );

    assert.ok(
      !backlogLoadedBeforeUrgent,
      'backlog chunks should not finish before the urgent target chunk',
    );
  } finally {
    await manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('worker payload finalization completes during flush', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();

  const identityMatrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  const createSerializedChunkPayload = (chunkX, chunkZ) => {
    const coordinateKey = `${chunkX}|${chunkZ}|0`;
    return {
      chunkX,
      chunkZ,
      typeMetadata: [
        {
          type: 'test:block',
          capacity: 1,
          entryKeys: [coordinateKey],
          entryPayloads: [
            {
              key: `${coordinateKey}:entry`,
              coordinateKey,
              type: 'test:block',
              matrix: identityMatrix.slice(),
              position: [chunkX * 16, 0, chunkZ * 16],
              scale: [1, 1, 1],
              visualScale: [1, 1, 1],
              visualOffset: [0, 0, 0],
              paletteColor: [0.65, 0.85, 1],
              tintColor: [0.65, 0.85, 1],
              isSolid: true,
            },
          ],
        },
      ],
      occupancy: {
        solidCoordinates: [coordinateKey],
      },
      fluids: {
        blockKeys: [`water:${coordinateKey}`],
        waterColumns: {
          keys: [coordinateKey],
          bottomY: [0],
          surfaceY: [1],
        },
        columnsByType: [
          {
            type: 'water',
            keys: [coordinateKey],
            positions: {
              x: [chunkX * 16 + 0.5],
              z: [chunkZ * 16 + 0.5],
            },
            minY: [0],
            maxY: [1],
            depth: [1],
            colors: [0.2, 0.4, 0.8],
            flowDirection: [0, 0],
            flowStrength: [0],
            foamAmount: [0],
            shoreline: [0],
            exposed: [1],
          },
        ],
        surfaces: [
          {
            type: 'water',
            columnKeys: [coordinateKey],
          },
        ],
      },
    };
  };

  class MockChunkBuildWorker {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
      const bucket = this.listeners.get(type);
      if (!bucket) {
        return;
      }
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.listeners.delete(type);
      }
    }

    postMessage(message) {
      const { type, key } = message ?? {};
      if (!key) {
        return;
      }
      if (type === 'cancel') {
        return;
      }
      if (type === 'step') {
        const [chunkX = 0, chunkZ = 0] = key
          .split('|')
          .map((value) => Number.parseInt(value, 10) || 0);
        const processedBudget = Number.isFinite(message?.budget)
          ? Math.max(1, Math.floor(message.budget))
          : 1;
        const event = {
          data: {
            key,
            processed: processedBudget,
            done: true,
            metadata: { mocked: true },
            payload: createSerializedChunkPayload(chunkX, chunkZ),
          },
        };
        queueMicrotask(() => this.#dispatch('message', event));
      }
    }

    terminate() {
      this.listeners.clear();
    }

    #dispatch(type, event) {
      const bucket = this.listeners.get(type);
      if (!bucket) {
        return;
      }
      bucket.forEach((handler) => {
        handler(event);
      });
    }
  }

  __setChunkBuildWorkerFactoryForTest(() => new MockChunkBuildWorker());

  try {
    const manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
    });

    try {
      manager.update(origin, {
        viewDistance: 0,
        retainDistance: 0,
        maxPreload: 0,
        force: true,
      });
      await manager.flush();

      manager.update(origin, {
        viewDistance: 0,
        retainDistance: 1,
        maxPreload: 0,
      });

      const pendingEntry = manager.__getPendingEntryForTest('1|0');
      assert.ok(pendingEntry, 'expected neighbor chunk preload entry to exist');

      const pendingFlush = manager.flush();
      assert.ok(
        pendingFlush && typeof pendingFlush.then === 'function',
        'flush should return a promise while awaiting worker completion',
      );

      await pendingFlush;

      const finalizedChunk = manager.__getLoadedChunkForTest('1|0');
      assert.ok(finalizedChunk?.group?.isGroup, 'finalized chunk should expose a group');
      assert.equal(finalizedChunk.group.name, 'chunk_1_0');

      assert.ok(
        finalizedChunk.typeData instanceof Map,
        'type data should be stored as a Map after finalization',
      );

      const typeRecord = finalizedChunk.typeData?.get('test:block');
      assert.ok(typeRecord, 'expected finalizeChunkMeshes to rebuild type data');
      assert.equal(typeRecord.entries.length, 1, 'type payload should deserialize one entry');

      assert.ok(Array.isArray(finalizedChunk.fluidSurfaces));
      assert.ok(
        finalizedChunk.fluidSurfaces.length > 0 &&
          finalizedChunk.fluidSurfaces.every((surface) => surface?.isMesh),
        'fluid surfaces should be reconstructed from worker payload',
      );

      assert.equal(
        pendingEntry.workerPayload,
        null,
        'worker payload reference should be cleared after finalization',
      );
    } finally {
      await manager.dispose();
    }
  } finally {
    __resetChunkBuildWorkerFactoryForTest();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('infinite view distance reuses the last finite scheduling radius', () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 2,
    retainDistance: 3,
    maxPreloadPerUpdate: 8,
    maxDisposalsPerUpdate: 0,
  });

  try {
    manager.update(origin, {
      viewDistance: 2,
      retainDistance: 3,
      maxPreload: Number.POSITIVE_INFINITY,
      force: true,
    });

    manager.update(origin, {
      viewDistance: Number.POSITIVE_INFINITY,
      retainDistance: Number.POSITIVE_INFINITY,
      maxPreload: Number.POSITIVE_INFINITY,
      force: true,
    });

    assert.ok(
      scene.getObjectByName('chunk_2_0'),
      'fallback view distance should continue scheduling adjacent chunks when infinite',
    );

    assert.ok(
      scene.getObjectByName('chunk_3_0'),
      'fallback retention distance should schedule outer chunks when infinite',
    );
  } finally {
    manager.dispose();
    createdMaterials.forEach((material) => material.dispose?.());
  }
});

test('core preload budget is consumed before scout entries', async () => {
  const origin = new THREE.Vector3(0, 0, 0);
  const scene = new THREE.Scene();
  const { registry: blockMaterials, createdMaterials } = createBlockMaterials();
  const buildMockPayload = (chunkX, chunkZ) => {
    const coordinateKey = `${chunkX}|${chunkZ}|0`;
    return {
      chunkX,
      chunkZ,
      typeMetadata: [
        {
          type: 'test:block',
          capacity: 1,
          entryKeys: [coordinateKey],
          entryPayloads: [
            {
              key: `${coordinateKey}:entry`,
              coordinateKey,
              type: 'test:block',
              matrix: [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
              ],
              position: [chunkX * 16, 0, chunkZ * 16],
              scale: [1, 1, 1],
              visualScale: [1, 1, 1],
              visualOffset: [0, 0, 0],
              paletteColor: [0.65, 0.85, 1],
              tintColor: [0.65, 0.85, 1],
              isSolid: true,
            },
          ],
        },
      ],
      occupancy: {
        solidCoordinates: [coordinateKey],
      },
      fluids: {
        blockKeys: [`water:${coordinateKey}`],
        waterColumns: {
          keys: [coordinateKey],
          bottomY: [0],
          surfaceY: [1],
        },
      },
      entities: [],
    };
  };
  class MockChunkBuildWorker {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
      const bucket = this.listeners.get(type);
      if (!bucket) {
        return;
      }
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.listeners.delete(type);
      }
    }

    postMessage(message) {
      const { type, key } = message ?? {};
      if (!key) {
        return;
      }
      if (type === 'cancel') {
        return;
      }
      if (type === 'step') {
        const [chunkX = 0, chunkZ = 0] = key
          .split('|')
          .map((value) => Number.parseInt(value, 10) || 0);
        const processedBudget = Number.isFinite(message?.budget)
          ? Math.max(1, Math.floor(message.budget))
          : 1;
        const event = {
          data: {
            key,
            processed: processedBudget,
            done: true,
            metadata: { mocked: true },
            payload: buildMockPayload(chunkX, chunkZ),
          },
        };
        queueMicrotask(() => this.#dispatch('message', event));
      }
    }

    terminate() {
      this.listeners.clear();
    }

    #dispatch(type, event) {
      const bucket = this.listeners.get(type);
      if (!bucket) {
        return;
      }
      bucket.forEach((handler) => {
        handler(event);
      });
    }
  }

  __setChunkBuildWorkerFactoryForTest(() => new MockChunkBuildWorker());

  try {
    const manager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 0,
      retainDistance: 0,
      maxPreloadPerUpdate: 1,
      maxDisposalsPerUpdate: 0,
      maxActivationsPerUpdate: 8,
      disposalMargin: 2,
    });

    try {
      manager.update(origin, {
        viewDistance: 0,
        retainDistance: 0,
        maxPreload: 0,
        force: true,
      });
      await manager.flush();

      manager.update(origin, {
        viewDistance: 2,
        retainDistance: 2,
        maxPreload: 1,
      });

      for (let i = 0; i < 10 && manager.__isChunkJobPumpActiveForTest(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const loadedCoreChunk = manager.__getLoadedChunkForTest('2|0');
      assert.ok(
        loadedCoreChunk?.group?.isGroup || scene.getObjectByName('chunk_2_0'),
        'core-detail chunk should load even when scout entries are queued',
      );

      const pendingScout = manager.__getPendingEntryForTest('4|0');
      assert.ok(pendingScout, 'scout entry should remain pending when base budget is spent');
      assert.equal(pendingScout.detailLevel, 'scout');
      assert.equal(pendingScout.pendingBudget ?? 0, 0);
    } finally {
      await manager.dispose();
      createdMaterials.forEach((material) => material.dispose?.());
    }
  } finally {
    __resetChunkBuildWorkerFactoryForTest();
  }
});

test('setStreamingBudgets adjusts streaming defaults', async () => {
  const scene = new THREE.Scene();
  const materials = createBlockMaterials();
  const manager = createChunkManager({
    scene,
    blockMaterials: materials.registry,
    viewDistance: 0,
    retainDistance: 0,
    maxPreloadPerUpdate: 3,
    maxDisposalsPerUpdate: 4,
    maxActivationsPerUpdate: 5,
  });

  try {
    const initial = manager.__getStreamingBudgetsForTest();
    assert.equal(initial.preload, 3);
    assert.equal(initial.defaultPreloadBurst, 3);
    assert.equal(initial.activation, 5);
    assert.equal(initial.defaultActivationBudget, 5);
    assert.equal(initial.disposal, 4);
    assert.equal(initial.defaultDisposalBudget, 4);

    manager.setStreamingBudgets({ preload: 6, activation: 7, disposal: 2 });
    const raised = manager.__getStreamingBudgetsForTest();
    assert.equal(raised.preload, 6);
    assert.equal(raised.defaultPreloadBurst, 6);
    assert.equal(raised.activation, 7);
    assert.equal(raised.defaultActivationBudget, 7);
    assert.equal(raised.disposal, 2);
    assert.equal(raised.defaultDisposalBudget, 2);

    manager.setStreamingBudgets({ preload: 1, activation: 0, disposal: 0 });
    const lowered = manager.__getStreamingBudgetsForTest();
    assert.equal(lowered.preload, 1);
    assert.equal(lowered.defaultPreloadBurst, 1);
    assert.equal(lowered.activation, 0);
    assert.equal(lowered.defaultActivationBudget, 0);
    assert.equal(lowered.disposal, 0);
    assert.equal(lowered.defaultDisposalBudget, 0);

    manager.setStreamingBudgets({
      preload: -5,
      activation: -3,
      disposal: 'invalid',
    });
    const clamped = manager.__getStreamingBudgetsForTest();
    assert.equal(clamped.preload, 0);
    assert.equal(clamped.defaultPreloadBurst, 2);
    assert.equal(clamped.activation, 0);
    assert.equal(clamped.defaultActivationBudget, 0);
    assert.equal(clamped.disposal, 0);
    assert.equal(clamped.defaultDisposalBudget, 0);

    manager.setStreamingBudgets({ preload: Number.POSITIVE_INFINITY });
    const unlimited = manager.__getStreamingBudgetsForTest();
    assert.equal(unlimited.preload, Number.POSITIVE_INFINITY);
    assert.equal(unlimited.defaultPreloadBurst, 2);
  } finally {
    await manager.dispose();
    materials.createdMaterials.forEach((material) => material.dispose?.());
  }
});
