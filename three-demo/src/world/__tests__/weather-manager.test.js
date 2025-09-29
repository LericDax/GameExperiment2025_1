import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { createWeatherManager } = await import('../weather/weather-manager.js');
const { createParticleSystem } = await import('../../rendering/particle-system.js');

function createManager({ emitImplementation }) {
  const emit = emitImplementation ?? (() => ({ stop() {} }));
  const particleSystem = {
    emitted: [],
    emit(emitter) {
      const result = emit(emitter);
      if (result) {
        this.emitted.push({ emitter, handle: result });
      }
      return result;
    },
  };

  const scene = { userData: {} };

  const manager = createWeatherManager({
    scene,
    particleSystem,
  });

  return { manager, particleSystem, scene };
}

test('setWeather emits precipitation for rainy presets', () => {
  let emitCount = 0;
  const handles = [];
  const { manager, particleSystem } = createManager({
    emitImplementation: (emitter) => {
      emitCount += 1;
      handles.push(emitter);
      return { stop() {} };
    },
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 1 });

  assert.equal(emitCount, 1, 'expected precipitation emitter to be spawned once');
  assert.equal(particleSystem.emitted.length, 1, 'expected particle handle to be stored');
  assert.ok(handles[0], 'expected precipitation emitter details to be captured');
});

test('failed precipitation spawns are recorded for diagnostics', () => {
  const { manager, scene, particleSystem } = createManager({
    emitImplementation: () => null,
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 2 });

  const weatherState = scene.userData.weather;

  assert.ok(weatherState, 'expected weather diagnostics state to exist');
  assert.equal(
    particleSystem.emitted.length,
    0,
    'expected no handles when particle system emit returned null',
  );
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.deepEqual(weatherState.lastPrecipitationFailure, {
    elapsedTime: 2,
    type: 'rain',
    reason: 'no_handle',
  });
});

test('zero-particle precipitation handles trigger retries and diagnostics', () => {
  let stopCalls = 0;
  let emitCount = 0;
  const handles = [
    {
      stop() {
        stopCalls += 1;
      },
      getActiveParticleCount() {
        return 0;
      },
    },
    {
      stop() {},
      getActiveParticleCount() {
        return 24;
      },
    },
  ];

  const { manager, scene, particleSystem } = createManager({
    emitImplementation: () => {
      const handle = handles[emitCount] ?? null;
      emitCount += 1;
      return handle;
    },
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 0.1 });
  manager.update({ delta: 1, elapsedTime: 1.1 });
  manager.update({ delta: 0.7, elapsedTime: 1.8 });
  manager.update({ delta: 0.4, elapsedTime: 2.2 });

  const weatherState = scene.userData.weather;

  assert.equal(emitCount, 2, 'expected precipitation spawn to retry once');
  assert.equal(stopCalls, 1, 'expected inactive precipitation handle to be stopped');
  assert.equal(particleSystem.emitted.length, 2, 'expected two precipitation handles to be tracked');
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.equal(weatherState.precipitationRecoveryAttempts, 1);
  assert.deepEqual(weatherState.lastPrecipitationFailure, {
    elapsedTime: 1.8,
    type: 'rain',
    reason: 'zero_particles',
  });
});

test('rain preset spawns active particles with the real particle system', () => {
  const scene = new THREE.Scene();
  const particleSystem = createParticleSystem({ THREE, scene });
  const manager = createWeatherManager({ scene, particleSystem });

  try {
    manager.setWeather('misty_rain');

    let elapsedTime = 0;
    let weatherParticles = 0;

    const frameDelta = 1 / 60;
    for (let frame = 0; frame < 300; frame += 1) {
      elapsedTime += frameDelta;
      manager.update({ delta: frameDelta, elapsedTime });
      particleSystem.update(frameDelta);
      const debugInfo = particleSystem.getDebugInfo();
      const emitters = Array.isArray(debugInfo?.emitters) ? debugInfo.emitters : [];
      const weatherEmitter = emitters.find((emitter) =>
        typeof emitter.label === 'string' && emitter.label.toLowerCase().includes('weather'),
      );
      if (weatherEmitter?.activeParticles > 0) {
        weatherParticles = weatherEmitter.activeParticles;
        break;
      }
    }

    assert.ok(
      weatherParticles > 0,
      'expected real weather emitter to accumulate active particles after ticking the system',
    );
  } finally {
    particleSystem.dispose();
  }
});
