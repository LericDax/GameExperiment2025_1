import test from 'node:test';
import assert from 'node:assert/strict';

import { runPerfFlight } from '../perf-flight-harness.js';

const BYTES_PER_MIB = 1024 * 1024;

test('runPerfFlight summary includes renderer memory, heap, and chunk counters', async () => {
  const originalPerformance = globalThis.performance;
  const originalDocument = globalThis.document;

  let nowValue = 0;
  const fakePerformance = {
    now: () => nowValue,
    memory: { usedJSHeapSize: 10 * BYTES_PER_MIB },
  };

  const fakeBody = {
    appendChild: (element) => {
      element.parentNode = fakeBody;
    },
    removeChild: (element) => {
      if (element.parentNode === fakeBody) {
        element.parentNode = null;
      }
    },
  };

  const fakeDocument = {
    createElement: () => ({ style: {}, textContent: '', parentNode: null }),
    body: fakeBody,
  };

  const moveState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  };
  const playerControls = {
    moveState,
    isFlightEnabled: () => false,
    setFlightEnabled: () => {},
    getPosition: () => ({ x: 1, y: 2, z: 3 }),
    setPosition: () => Promise.resolve(),
  };

  const renderStats = {
    calls: 7,
    triangles: 42,
  };
  const memoryStats = {
    geometries: 3,
    textures: 5,
    programs: 2,
    triangles: 420,
  };
  const renderer = {
    info: {
      render: renderStats,
      memory: memoryStats,
    },
  };

  const debugSnapshots = [
    { chunkCount: 6, totalBlocks: 1200, loadedChunkCount: 8 },
    { chunkCount: 7, totalBlocks: 1400, loadedChunkCount: 9 },
  ];
  const streamingStats = [
    { loadedChunkCount: 12 },
    { loadedChunkCount: 13 },
  ];
  let debugCallCount = 0;
  let statsCallCount = 0;
  const chunkManager = {
    solidBlocks: new Set([1, 2, 3]),
    softBlocks: new Set([1]),
    waterColumns: new Set([1, 2]),
    debugSnapshot: () => {
      const snapshot = debugSnapshots[Math.min(debugCallCount, debugSnapshots.length - 1)];
      debugCallCount += 1;
      return snapshot;
    },
    getStreamingStats: () => {
      const stats = streamingStats[Math.min(statsCallCount, streamingStats.length - 1)];
      statsCallCount += 1;
      return stats;
    },
  };

  let overlayHandler = null;
  const registerDiagnosticOverlay = (handler) => {
    overlayHandler = handler;
    return () => {
      if (overlayHandler === handler) {
        overlayHandler = null;
      }
    };
  };

  globalThis.performance = fakePerformance;
  globalThis.document = fakeDocument;

  try {
    const flightPromise = runPerfFlight({
      playerControls,
      registerDiagnosticOverlay,
      renderer,
      chunkManager,
      durationMs: 10,
      sampleIntervalMs: 0,
    });

    await Promise.resolve();
    assert.ok(overlayHandler, 'overlay handler should be registered');

    nowValue = 4;
    overlayHandler({ delta: 0.016 });

    renderStats.calls = 9;
    renderStats.triangles = 64;
    memoryStats.geometries = 4;
    memoryStats.textures = 6;
    memoryStats.programs = 3;
    memoryStats.triangles = 430;
    fakePerformance.memory.usedJSHeapSize = 11 * BYTES_PER_MIB;

    nowValue = 12;
    overlayHandler({ delta: 0.02 });

    const summary = await flightPromise;

    assert.equal(summary.series.length, 2, 'two samples should be recorded');
    const [first, second] = summary.series;

    assert.equal(first.memoryGeometries, 3);
    assert.equal(second.memoryGeometries, 4);
    assert.equal(first.memoryTextures, 5);
    assert.equal(second.memoryTextures, 6);
    assert.equal(first.memoryPrograms, 2);
    assert.equal(second.memoryPrograms, 3);
    assert.equal(first.memoryTriangles, 420);
    assert.equal(second.memoryTriangles, 430);
    assert.equal(first.loadedChunkCount, 12);
    assert.equal(second.loadedChunkCount, 13);
    assert.equal(first.jsHeapUsed, 10 * BYTES_PER_MIB);
    assert.equal(second.jsHeapUsed, 11 * BYTES_PER_MIB);

    assert.equal(summary.metrics.memoryGeometries.min, 3);
    assert.equal(summary.metrics.memoryGeometries.max, 4);
    assert.equal(summary.metrics.memoryTextures.min, 5);
    assert.equal(summary.metrics.memoryTextures.max, 6);
    assert.equal(summary.metrics.memoryPrograms.min, 2);
    assert.equal(summary.metrics.memoryPrograms.max, 3);
    assert.equal(summary.metrics.memoryTriangles.min, 420);
    assert.equal(summary.metrics.memoryTriangles.max, 430);
    assert.equal(summary.metrics.loadedChunkCount.min, 12);
    assert.equal(summary.metrics.loadedChunkCount.max, 13);
    assert.equal(summary.metrics.jsHeapUsed.min, 10 * BYTES_PER_MIB);
    assert.equal(summary.metrics.jsHeapUsed.max, 11 * BYTES_PER_MIB);
  } finally {
    globalThis.performance = originalPerformance;
    globalThis.document = originalDocument;
  }
});
