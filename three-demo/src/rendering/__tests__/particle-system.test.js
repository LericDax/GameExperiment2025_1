import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { createParticleSystem } = await import('../particle-system.js');

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
