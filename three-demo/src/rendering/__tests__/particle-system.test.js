import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { createParticleSystem } = await import('../particle-system.js');
const { createGpuBillboardEmitter } = await import(
  '../particles/gpu-billboard-emitter.js'
);

test('emit returns null when emitter initialization throws', () => {
  const scene = new THREE.Scene();
  const particleSystem = createParticleSystem({ THREE, scene });

  const failingEmitter = {
    initialize() {
      throw new Error('boom');
    },
  };

  const originalError = console.error;
  console.error = () => {};
  let handle;

  try {
    handle = particleSystem.emit(failingEmitter);
  } finally {
    console.error = originalError;
  }

  assert.equal(handle, null, 'expected emit to return null for a failed emitter');

  particleSystem.dispose();
});

test('GPU billboard emitter stops spawning after handle.stop()', () => {
  const scene = new THREE.Scene();
  const particleSystem = createParticleSystem({ THREE, scene });

  const emitter = createGpuBillboardEmitter({
    spawnRate: 30,
    maxParticles: 128,
    lifetime: { min: 0.1, max: 0.1 },
  });

  const handle = particleSystem.emit(emitter);
  assert.ok(handle, 'expected emitter handle to be returned');

  for (let i = 0; i < 10; i += 1) {
    particleSystem.update(0.1);
  }

  let debugInfo = particleSystem.getDebugInfo();
  assert.ok(
    debugInfo.totalActiveParticles > 0,
    'expected particles to spawn before stopping the emitter',
  );

  handle.stop();

  let finalInfo = null;
  for (let i = 0; i < 120; i += 1) {
    particleSystem.update(1 / 30);
    debugInfo = particleSystem.getDebugInfo();
    if (debugInfo.emitterCount === 0) {
      finalInfo = debugInfo;
      break;
    }
  }

  assert.ok(finalInfo, 'expected the emitter to dispose after being stopped');
  assert.equal(
    finalInfo.totalActiveParticles,
    0,
    'expected all particles to expire after stopping the emitter',
  );

  particleSystem.dispose();
});
