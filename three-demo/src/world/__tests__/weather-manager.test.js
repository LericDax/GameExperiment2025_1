import test from 'node:test';
import assert from 'node:assert/strict';

const { createWeatherManager } = await import('../weather/weather-manager.js');

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
  const { manager, scene } = createManager({
    emitImplementation: () => null,
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 2 });

  const weatherState = scene.userData.weather;

  assert.ok(weatherState, 'expected weather diagnostics state to exist');
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.deepEqual(weatherState.lastPrecipitationFailure, {
    elapsedTime: 2,
    type: 'rain',
  });
});
