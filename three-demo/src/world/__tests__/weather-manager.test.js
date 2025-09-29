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
  assert.equal(weatherState.precipitationRecoveryAttempts, 1);
  assert.deepEqual(weatherState.lastPrecipitationFailure, {
    elapsedTime: 2,
    type: 'rain',
    reason: 'no_handle',
  });
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);
  const pendingRetry = weatherState.pendingPrecipitationRetries[0];
  assert.equal(pendingRetry.type, 'rain');
  assert.equal(pendingRetry.attempt, 2);
  assert.equal(pendingRetry.maxAttempts, 3);
  assert.equal(pendingRetry.reason, 'no_handle');
});

test('precipitation spawn retries recover after missing handles', () => {
  let emitCount = 0;
  const handles = [null, null, { stop() {}, getActiveParticleCount() { return 12; } }];

  const { manager, scene, particleSystem } = createManager({
    emitImplementation: () => {
      const handle = emitCount < handles.length ? handles[emitCount] : handles.at(-1);
      emitCount += 1;
      return handle;
    },
  });

  manager.setWeather('misty_rain');

  manager.update({ delta: 0.1, elapsedTime: 0.1 });

  let weatherState = scene.userData.weather;
  assert.equal(emitCount, 1, 'expected initial precipitation emit call');
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.equal(weatherState.precipitationRecoveryAttempts, 1);
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);
  assert.equal(weatherState.pendingPrecipitationRetries[0].attempt, 2);

  manager.update({ delta: 0.4, elapsedTime: 0.5 });
  weatherState = scene.userData.weather;
  assert.equal(emitCount, 1, 'expected retry to wait until the interval has elapsed');
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);

  manager.update({ delta: 0.3, elapsedTime: 0.8 });
  weatherState = scene.userData.weather;
  assert.equal(emitCount, 2, 'expected queued retry to fire after the interval');
  assert.equal(weatherState.failedPrecipitationSpawns, 2);
  assert.equal(weatherState.precipitationRecoveryAttempts, 2);
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);
  assert.equal(weatherState.pendingPrecipitationRetries[0].attempt, 3);

  manager.update({ delta: 0.7, elapsedTime: 1.5 });
  weatherState = scene.userData.weather;
  assert.equal(emitCount, 3, 'expected final retry to execute');
  assert.equal(particleSystem.emitted.length, 1, 'expected successful handle to be recorded');
  assert.equal(weatherState.pendingPrecipitationRetries.length, 0);
  assert.equal(weatherState.failedPrecipitationSpawns, 2);
  assert.equal(weatherState.precipitationRecoveryAttempts, 2);
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
    let peakWeatherParticles = 0;

    const frameDelta = 1 / 60;
    const minimumParticles = 18;
    for (let frame = 0; frame < 300; frame += 1) {
      elapsedTime += frameDelta;
      manager.update({ delta: frameDelta, elapsedTime });
      particleSystem.update(frameDelta);
      const debugInfo = particleSystem.getDebugInfo();
      const emitters = Array.isArray(debugInfo?.emitters) ? debugInfo.emitters : [];
      const weatherEmitter = emitters.find((emitter) =>
        typeof emitter.label === 'string' && emitter.label.toLowerCase().includes('weather'),
      );
      if (weatherEmitter) {
        const activeParticles = Number(weatherEmitter.activeParticles) || 0;
        if (activeParticles > peakWeatherParticles) {
          peakWeatherParticles = activeParticles;
        }
        if (peakWeatherParticles >= minimumParticles) {
          break;
        }
      }
    }

    assert.ok(
      peakWeatherParticles >= minimumParticles,
      `expected real weather emitter to accumulate at least ${minimumParticles} active particles after ticking the system (received ${peakWeatherParticles})`,
    );
  } finally {
    particleSystem.dispose();
  }
});
