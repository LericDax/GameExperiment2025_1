import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { createWeatherManager } = await import('../weather/weather-manager.js');
const { createParticleSystem } = await import('../../rendering/particle-system.js');
const {
  clampRaindropOverlayWindSpeed,
  clampRaindropOverlayStreakDensity,
  clampRaindropOverlaySparkleGain,
} = await import('../../rendering/effects/raindrop-overlay.js');

const RAIN_OVERLAY_TEST_MIN = 0.24;
const RAIN_OVERLAY_TEST_MAX = 1.35;
const RAIN_OVERLAY_TEST_SCALE = 0.95;

const RAIN_FALLBACK_LABEL = 'WeatherRainEmitter/BillboardFallback';
const RAIN_BRIGHT_LABEL = 'WeatherRainEmitter/BrightStreakPass';

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

  const scene = {
    userData: {},
    added: [],
    removed: [],
    add(object) {
      this.added.push(object);
    },
    remove(object) {
      this.removed.push(object);
    },
  };

  const manager = createWeatherManager({
    scene,
    particleSystem,
  });

  return { manager, particleSystem, scene };
}

function approxEqual(actual, expected, epsilon = 1e-3) {
  return Math.abs(actual - expected) <= epsilon;
}

function expectedOverlayIntensity(precipIntensity) {
  const scaled = precipIntensity * RAIN_OVERLAY_TEST_SCALE;
  const raised = Math.max(scaled, RAIN_OVERLAY_TEST_MIN);
  return Math.min(raised, RAIN_OVERLAY_TEST_MAX);
}

function expectedOverlayUniforms(precipIntensity, overrides = {}) {
  const normalised = Math.min(Math.max(precipIntensity, 0), 2.6) / 2.6;
  const windBase =
    overrides.windSpeed !== undefined ? overrides.windSpeed : normalised * 1.8;
  const streakBase =
    overrides.streakDensity !== undefined
      ? overrides.streakDensity
      : 0.9 + normalised * (2.4 - 0.9);
  const sparkleBase =
    overrides.sparkleGain !== undefined
      ? overrides.sparkleGain
      : 0.55 + normalised * (1.65 - 0.55);
  return {
    windSpeed: clampRaindropOverlayWindSpeed(windBase),
    streakDensity: clampRaindropOverlayStreakDensity(streakBase),
    sparkleGain: clampRaindropOverlaySparkleGain(sparkleBase),
  };
}

test('setWeather emits precipitation for rainy presets', () => {
  const emitLabels = [];
  const { manager, particleSystem, scene } = createManager({
    emitImplementation: (emitter) => {
      emitLabels.push(emitter.debugLabel ?? 'unknown');
      return { stop() {} };
    },
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 1 });

  assert.equal(
    emitLabels.length,
    2,
    'expected rain weather to spawn both primary precipitation and splash emitters',
  );
  assert.ok(
    emitLabels.includes(RAIN_FALLBACK_LABEL),
    'expected fallback rain emitter to spawn',
  );
  assert.ok(
    emitLabels.includes('WeatherRainSplashEmitter'),
    'expected rain splash emitter to spawn',
  );
  assert.equal(
    particleSystem.emitted.length,
    2,
    'expected precipitation emitters to be tracked',
  );
  const weatherState = scene.userData.weather ?? {};
  assert.equal(
    weatherState.precipitationLayers?.primary?.label,
    RAIN_FALLBACK_LABEL,
    'expected primary precipitation layer label to match fallback emitter',
  );
  assert.equal(
    weatherState.precipitationLayers?.primary?.shader,
    'billboard',
    'expected primary precipitation layer to report billboard shader',
  );
  assert.equal(
    weatherState.precipitationLayers?.splash?.label,
    'WeatherRainSplashEmitter',
    'expected splash precipitation layer label to match splash emitter',
  );
});

test('rain splash attachment stops when weather clears', () => {
  const stoppedLabels = [];
  const { manager, scene } = createManager({
    emitImplementation: (emitter) => ({
      stop() {
        stoppedLabels.push(emitter.debugLabel ?? 'unknown');
      },
      getActiveParticleCount() {
        return emitter.debugLabel === RAIN_FALLBACK_LABEL ? 24 : 12;
      },
    }),
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.05, elapsedTime: 1 });
  let weatherState = scene.userData.weather ?? {};
  assert.equal(
    weatherState.precipitationLayers?.primary?.label,
    RAIN_FALLBACK_LABEL,
    'expected precipitation layer label to match fallback emitter before clearing',
  );
  assert.equal(
    weatherState.precipitationLayers?.splash?.label,
    'WeatherRainSplashEmitter',
    'expected splash layer label to be recorded before clearing',
  );
  manager.setWeather('clear_skies');
  manager.update({ delta: 0.05, elapsedTime: 1.1 });
  weatherState = scene.userData.weather ?? {};
  assert.equal(
    weatherState.precipitationLayers?.primary ?? null,
    null,
    'expected precipitation layer metadata to clear when weather stops',
  );
  assert.equal(
    weatherState.precipitationLayers?.splash ?? null,
    null,
    'expected splash layer metadata to clear when weather stops',
  );

  assert.ok(
    stoppedLabels.includes(RAIN_FALLBACK_LABEL),
    'expected primary rain emitter to be stopped when weather clears',
  );
  assert.ok(
    stoppedLabels.includes('WeatherRainSplashEmitter'),
    'expected rain splash emitter to be stopped when weather clears',
  );
  assert.equal(
    stoppedLabels.filter((label) => label === RAIN_FALLBACK_LABEL).length,
    1,
    'expected primary emitter to be stopped exactly once',
  );
  assert.equal(
    stoppedLabels.filter((label) => label === 'WeatherRainSplashEmitter').length,
    1,
    'expected splash emitter to be stopped exactly once',
  );
});

test('raindrop overlay intensity follows precipitation tuning', () => {
  const { manager, scene } = createManager({
    emitImplementation: (emitter) => ({
      ...emitter,
      stop() {},
      getActiveParticleCount() {
        return 24;
      },
    }),
  });

  const assertOverlaySnapshot = ({
    overlay,
    expectedIntensity,
    expectedUniforms,
    expectedMetadata = {},
    label,
  }) => {
    assert.ok(overlay.enabled, `expected overlay to enable for ${label}`);
    assert.ok(overlay.visible, `expected overlay mesh to exist for ${label}`);
    assert.ok(
      approxEqual(overlay.baseIntensity, expectedIntensity, 1e-4),
      `expected ${label} overlay intensity (${overlay.baseIntensity}) to match tuning (${expectedIntensity})`,
    );
    assert.ok(
      approxEqual(overlay.baseWindSpeed, expectedUniforms.windSpeed, 1e-4),
      `expected ${label} overlay wind speed to match derived value`,
    );
    assert.ok(
      approxEqual(overlay.baseStreakDensity, expectedUniforms.streakDensity, 1e-4),
      `expected ${label} overlay streak density to match derived value`,
    );
    assert.ok(
      approxEqual(overlay.baseSparkleGain, expectedUniforms.sparkleGain, 1e-4),
      `expected ${label} overlay sparkle gain to match derived value`,
    );
    const metadata = scene.userData.weather?.raindropOverlay ?? {};
    assert.ok(
      approxEqual(metadata.intensity ?? 0, overlay.intensity, 1e-4),
      'expected overlay metadata to publish intensity',
    );
    assert.ok(
      approxEqual(metadata.windSpeed ?? 0, expectedUniforms.windSpeed, 1e-4),
      'expected overlay metadata to publish wind speed',
    );
    assert.ok(
      approxEqual(metadata.streakDensity ?? 0, expectedUniforms.streakDensity, 1e-4),
      'expected overlay metadata to publish streak density',
    );
    assert.ok(
      approxEqual(metadata.sparkleGain ?? 0, expectedUniforms.sparkleGain, 1e-4),
      'expected overlay metadata to publish sparkle gain',
    );
    const expectValue = (key, expectedValue) => {
      const overlayValue = overlay[key];
      const metadataValue = metadata[key];
      if (expectedValue === undefined || expectedValue === null) {
        assert.strictEqual(
          overlayValue ?? null,
          null,
          `expected overlay ${key} to default to null`,
        );
        assert.strictEqual(
          metadataValue ?? null,
          null,
          `expected overlay metadata ${key} to default to null`,
        );
        return;
      }
      assert.ok(
        approxEqual(overlayValue ?? 0, expectedValue, 1e-4),
        `expected overlay ${key} to match provided value`,
      );
      assert.ok(
        approxEqual(metadataValue ?? 0, expectedValue, 1e-4),
        `expected overlay metadata ${key} to match provided value`,
      );
    };
    expectValue('rippleScale', expectedMetadata.rippleScale);
    expectValue('dropSpeed', expectedMetadata.dropSpeed);
    expectValue('viscosity', expectedMetadata.viscosity);
    expectValue('baseRippleScale', expectedMetadata.baseRippleScale ?? expectedMetadata.rippleScale ?? null);
    expectValue('baseDropSpeed', expectedMetadata.baseDropSpeed ?? expectedMetadata.dropSpeed ?? null);
    expectValue('baseViscosity', expectedMetadata.baseViscosity ?? expectedMetadata.viscosity ?? null);
    expectValue('manualRippleScale', expectedMetadata.manualRippleScale ?? null);
    expectValue('manualDropSpeed', expectedMetadata.manualDropSpeed ?? null);
    expectValue('manualViscosity', expectedMetadata.manualViscosity ?? null);
  };

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.016, elapsedTime: 1 });

  let overlay = manager.getRaindropOverlayState();
  let weather = manager.getCurrentWeather();
  let precipitationIntensity = weather?.effects?.precipitation?.intensity ?? 0;
  let expected = expectedOverlayIntensity(precipitationIntensity);
  let expectedUniforms = expectedOverlayUniforms(precipitationIntensity);
  assertOverlaySnapshot({
    overlay,
    expectedIntensity: expected,
    expectedUniforms,
    label: 'misty rain',
  });

  manager.registerWeatherPreset({
    id: 'qa_downpour',
    label: 'QA Downpour',
    category: 'storm',
    intensity: 1.8,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 2.2,
      },
    },
  });

  manager.setWeather('qa_downpour');
  manager.update({ delta: 0.016, elapsedTime: 2 });

  overlay = manager.getRaindropOverlayState();
  weather = manager.getCurrentWeather();
  precipitationIntensity = weather?.effects?.precipitation?.intensity ?? 0;
  expected = expectedOverlayIntensity(precipitationIntensity);
  expectedUniforms = expectedOverlayUniforms(precipitationIntensity);
  assert.ok(
    overlay.baseIntensity > expectedOverlayIntensity(0.45),
    'expected heavier precipitation to drive a stronger overlay response',
  );
  assertOverlaySnapshot({
    overlay,
    expectedIntensity: expected,
    expectedUniforms,
    label: 'heavy rain',
  });

  manager.registerWeatherPreset({
    id: 'qa_extreme_downpour',
    label: 'QA Extreme Downpour',
    category: 'storm',
    intensity: 2.4,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 4.4,
      },
    },
  });

  manager.setWeather('qa_extreme_downpour');
  manager.update({ delta: 0.016, elapsedTime: 3 });

  overlay = manager.getRaindropOverlayState();
  weather = manager.getCurrentWeather();
  precipitationIntensity = weather?.effects?.precipitation?.intensity ?? 0;
  expected = expectedOverlayIntensity(precipitationIntensity);
  expectedUniforms = expectedOverlayUniforms(precipitationIntensity);
  assertOverlaySnapshot({
    overlay,
    expectedIntensity: expected,
    expectedUniforms,
    label: 'extreme rain',
  });

  manager.registerWeatherPreset({
    id: 'qa_overlay_override',
    label: 'QA Overlay Override',
    category: 'storm',
    intensity: 1.1,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 0.8,
        raindropOverlay: {
          windSpeed: 3.25,
          streakDensity: 0.2,
          sparkleGain: 2.5,
          rippleScale: 0.82,
          dropSpeed: 1.35,
          viscosity: 0.44,
        },
      },
    },
  });

  manager.setWeather('qa_overlay_override');
  manager.update({ delta: 0.016, elapsedTime: 4 });

  overlay = manager.getRaindropOverlayState();
  weather = manager.getCurrentWeather();
  precipitationIntensity = weather?.effects?.precipitation?.intensity ?? 0;
  expected = expectedOverlayIntensity(precipitationIntensity);
  expectedUniforms = expectedOverlayUniforms(precipitationIntensity, {
    windSpeed: 3.25,
    streakDensity: 0.2,
    sparkleGain: 2.5,
  });
  assertOverlaySnapshot({
    overlay,
    expectedIntensity: expected,
    expectedUniforms,
    expectedMetadata: {
      rippleScale: 0.82,
      dropSpeed: 1.35,
      viscosity: 0.44,
    },
    label: 'override rain',
  });
  const metadata = scene.userData.weather?.raindropOverlay ?? {};
  assert.ok(
    approxEqual(metadata.baseWindSpeed ?? 0, overlay.baseWindSpeed, 1e-4),
    'expected metadata to store base wind speed overrides',
  );
  assert.ok(
    approxEqual(metadata.baseStreakDensity ?? 0, overlay.baseStreakDensity, 1e-4),
    'expected metadata to store base streak density overrides',
  );
  assert.ok(
    approxEqual(metadata.baseRippleScale ?? 0, 0.82, 1e-4),
    'expected metadata to store base ripple scale overrides',
  );
  assert.ok(
    approxEqual(metadata.baseDropSpeed ?? 0, 1.35, 1e-4),
    'expected metadata to store base drop speed overrides',
  );
  assert.ok(
    approxEqual(metadata.baseViscosity ?? 0, 0.44, 1e-4),
    'expected metadata to store base viscosity overrides',
  );
});

test('raindrop overlay manual uniform overrides clamp and persist', () => {
  const { manager, scene } = createManager({
    emitImplementation: (emitter) => ({
      ...emitter,
      stop() {},
      getActiveParticleCount() {
        return 28;
      },
    }),
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.016, elapsedTime: 0.5 });

  const weather = manager.getCurrentWeather();
  const precipitationIntensity = weather?.effects?.precipitation?.intensity ?? 0;
  const baseUniforms = expectedOverlayUniforms(precipitationIntensity);

  manager.setRaindropOverlayManualWindSpeed(9);
  manager.setRaindropOverlayManualStreakDensity(-1);
  manager.setRaindropOverlayManualSparkleGain(5);

  let overlay = manager.getRaindropOverlayState();
  assert.ok(
    approxEqual(overlay.windSpeed, clampRaindropOverlayWindSpeed(9), 1e-4),
    'expected manual wind override to clamp to allowable range',
  );
  assert.ok(
    approxEqual(
      overlay.streakDensity,
      clampRaindropOverlayStreakDensity(-1),
      1e-4,
    ),
    'expected manual density override to clamp to allowable range',
  );
  assert.ok(
    approxEqual(overlay.sparkleGain, clampRaindropOverlaySparkleGain(5), 1e-4),
    'expected manual sparkle override to clamp to allowable range',
  );
  const metadata = scene.userData.weather?.raindropOverlay ?? {};
  assert.ok(
    approxEqual(metadata.manualWindSpeed ?? 0, clampRaindropOverlayWindSpeed(9), 1e-4),
    'expected metadata to record clamped manual wind override',
  );
  assert.ok(
    approxEqual(
      metadata.manualStreakDensity ?? 0,
      clampRaindropOverlayStreakDensity(-1),
      1e-4,
    ),
    'expected metadata to record clamped manual density override',
  );
  assert.ok(
    approxEqual(
      metadata.manualSparkleGain ?? 0,
      clampRaindropOverlaySparkleGain(5),
      1e-4,
    ),
    'expected metadata to record clamped manual sparkle override',
  );
  assert.strictEqual(
    metadata.manualRippleScale,
    null,
    'expected metadata ripple scale manual override to remain unset',
  );
  assert.strictEqual(
    metadata.manualDropSpeed,
    null,
    'expected metadata drop speed manual override to remain unset',
  );
  assert.strictEqual(
    metadata.manualViscosity,
    null,
    'expected metadata viscosity manual override to remain unset',
  );

  manager.setRaindropOverlayManualWindSpeed(null);
  manager.setRaindropOverlayManualStreakDensity(null);
  manager.setRaindropOverlayManualSparkleGain(null);

  overlay = manager.getRaindropOverlayState();
  assert.ok(
    approxEqual(overlay.windSpeed, baseUniforms.windSpeed, 1e-4),
    'expected clearing manual wind override to restore base response',
  );
  assert.ok(
    approxEqual(overlay.streakDensity, baseUniforms.streakDensity, 1e-4),
    'expected clearing manual density override to restore base response',
  );
  assert.ok(
    approxEqual(overlay.sparkleGain, baseUniforms.sparkleGain, 1e-4),
    'expected clearing manual sparkle override to restore base response',
  );
  const clearedMetadata = scene.userData.weather?.raindropOverlay ?? {};
  assert.equal(clearedMetadata.manualWindSpeed, null);
  assert.equal(clearedMetadata.manualStreakDensity, null);
  assert.equal(clearedMetadata.manualSparkleGain, null);
  assert.equal(clearedMetadata.manualRippleScale, null);
  assert.equal(clearedMetadata.manualDropSpeed, null);
  assert.equal(clearedMetadata.manualViscosity, null);
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

test('manual precipitation overrides adjust rain uniforms', () => {
  let capturedEmitter = null;
  const { manager, scene } = createManager({
    emitImplementation: (emitter) => {
      if (emitter.debugLabel === RAIN_BRIGHT_LABEL) {
        capturedEmitter = emitter;
      }
      return {
        stop() {},
        getActiveParticleCount() {
          return emitter.debugLabel === RAIN_BRIGHT_LABEL ? 42 : 18;
        },
      };
    },
  });

  const state = scene.userData.weather;
  assert.ok(state?.manualOverrides?.precipitation, 'expected precipitation manual overrides to exist');

  state.manualOverrides.precipitation.shader = 'bright';
  state.manualOverrides.precipitation.windTilt = 0.31;
  state.manualOverrides.precipitation.streakNoise = 0.72;
  state.manualOverrides.precipitation.highlightWidth = 0.12;
  state.manualOverrides.precipitation.intensity = 0.95;
  state.manualOverrides.precipitation.rippleScale = 1.58;
  state.manualOverrides.precipitation.dropSpeed = 1.14;
  state.manualOverrides.precipitation.viscosity = 0.42;

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.05, elapsedTime: 0.5 });

  assert.ok(capturedEmitter, 'expected precipitation emitter to spawn with manual overrides');
  assert.equal(
    capturedEmitter.debugLabel,
    RAIN_BRIGHT_LABEL,
    'expected manual overrides to upgrade emitter to bright streak shader',
  );
  const precipitationLayers = scene.userData.weather?.precipitationLayers ?? {};
  assert.equal(
    precipitationLayers.primary?.shader,
    'bright',
    'expected precipitation layer metadata to reflect bright shader override',
  );
  assert.equal(
    precipitationLayers.primary?.label,
    RAIN_BRIGHT_LABEL,
    'expected precipitation layer label to match bright shader emitter',
  );
  let uniforms = capturedEmitter.getWeatherRainShaderUniforms?.();
  assert.ok(uniforms, 'expected rain emitter to expose shader uniforms');
  assert.ok(approxEqual(uniforms.windTilt, 0.31, 1e-4));
  assert.ok(approxEqual(uniforms.streakNoise, 0.72, 1e-4));
  assert.ok(approxEqual(uniforms.highlightWidth, 0.12, 1e-4));
  assert.ok(approxEqual(uniforms.rippleScale ?? 0, 1.58, 1e-4));
  const dropSpeedUniform = uniforms.dropSpeed ?? uniforms.dropDensity;
  const viscosityUniform = uniforms.viscosity ?? uniforms.timerBias;
  assert.ok(approxEqual(dropSpeedUniform ?? 0, 1.14, 1e-4));
  assert.ok(approxEqual(viscosityUniform ?? 0, 0.42, 1e-4));

  const summaries = scene.userData.weather?.precipitationEmitters ?? [];
  if (summaries.length > 0) {
    const primarySummary = summaries.find((summary) =>
      summary.label?.includes('WeatherRainEmitter'),
    );
    assert.ok(primarySummary, 'expected precipitation summary for rain emitter');
    assert.equal(primarySummary.label, RAIN_BRIGHT_LABEL);
    assert.equal(primarySummary.manualOverrides.dropSpeed, 1.14);
    assert.equal(primarySummary.manualOverrides.viscosity, 0.42);
    assert.equal(primarySummary.manualOverrides.rippleScale, 1.58);
    assert.ok(approxEqual(primarySummary.shaderUniforms.dropSpeed ?? 0, 1.14, 1e-4));
    assert.ok(approxEqual(primarySummary.shaderUniforms.viscosity ?? 0, 0.42, 1e-4));
    assert.ok(approxEqual(primarySummary.shaderUniforms.rippleScale ?? 0, 1.58, 1e-4));
  }

  state.manualOverrides.precipitation.windTilt = 0.42;
  state.manualOverrides.precipitation.streakNoise = 0.86;
  state.manualOverrides.precipitation.highlightWidth = 0.18;
  state.manualOverrides.precipitation.rippleScale = 1.21;
  state.manualOverrides.precipitation.dropSpeed = 1.08;
  state.manualOverrides.precipitation.viscosity = 0.5;

  manager.update({ delta: 0.05, elapsedTime: 0.55 });

  uniforms = capturedEmitter.getWeatherRainShaderUniforms?.();
  assert.ok(approxEqual(uniforms.windTilt, 0.42, 1e-4));
  assert.ok(approxEqual(uniforms.streakNoise, 0.86, 1e-4));
  assert.ok(approxEqual(uniforms.highlightWidth, 0.18, 1e-4));
  assert.ok(approxEqual(uniforms.rippleScale ?? 0, 1.21, 1e-4));
  const updatedDropSpeed = uniforms.dropSpeed ?? uniforms.dropDensity;
  const updatedViscosity = uniforms.viscosity ?? uniforms.timerBias;
  assert.ok(approxEqual(updatedDropSpeed ?? 0, 1.08, 1e-4));
  assert.ok(approxEqual(updatedViscosity ?? 0, 0.5, 1e-4));
});

test('precipitation spawn retries recover after missing handles', () => {
  let primaryEmitCount = 0;
  let splashEmitCount = 0;
  const primaryHandles = [null, null, { stop() {}, getActiveParticleCount() { return 12; } }];

  const { manager, scene, particleSystem } = createManager({
    emitImplementation: (emitter) => {
      if (emitter.debugLabel === 'WeatherRainSplashEmitter') {
        splashEmitCount += 1;
        return {
          stop() {},
          getActiveParticleCount() {
            return 10;
          },
        };
      }
      const handle =
        primaryEmitCount < primaryHandles.length
          ? primaryHandles[primaryEmitCount]
          : primaryHandles.at(-1);
      primaryEmitCount += 1;
      return handle;
    },
  });

  manager.setWeather('misty_rain');

  manager.update({ delta: 0.1, elapsedTime: 0.1 });

  let weatherState = scene.userData.weather;
  assert.equal(primaryEmitCount, 1, 'expected initial precipitation emit call');
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.equal(weatherState.precipitationRecoveryAttempts, 1);
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);
  assert.equal(weatherState.pendingPrecipitationRetries[0].attempt, 2);
  assert.equal(
    weatherState.precipitationLayers?.primary ?? null,
    null,
    'expected precipitation layer to remain empty after failed spawn',
  );

  manager.update({ delta: 0.4, elapsedTime: 0.5 });
  weatherState = scene.userData.weather;
  assert.equal(primaryEmitCount, 1, 'expected retry to wait until the interval has elapsed');
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);

  manager.update({ delta: 0.3, elapsedTime: 0.8 });
  weatherState = scene.userData.weather;
  assert.equal(primaryEmitCount, 2, 'expected queued retry to fire after the interval');
  assert.equal(weatherState.failedPrecipitationSpawns, 2);
  assert.equal(weatherState.precipitationRecoveryAttempts, 2);
  assert.equal(weatherState.pendingPrecipitationRetries.length, 1);
  assert.equal(weatherState.pendingPrecipitationRetries[0].attempt, 3);

  manager.update({ delta: 0.7, elapsedTime: 1.5 });
  weatherState = scene.userData.weather;
  assert.equal(primaryEmitCount, 3, 'expected final retry to execute');
  assert.equal(splashEmitCount, 1, 'expected splash emitter to spawn once after recovery');
  assert.equal(particleSystem.emitted.length, 2, 'expected successful handles to be recorded');
  assert.equal(weatherState.pendingPrecipitationRetries.length, 0);
  assert.equal(weatherState.failedPrecipitationSpawns, 2);
  assert.equal(weatherState.precipitationRecoveryAttempts, 2);
  assert.equal(
    weatherState.precipitationLayers?.primary?.label,
    RAIN_FALLBACK_LABEL,
    'expected precipitation layer to record fallback emitter after recovery',
  );
  assert.equal(
    weatherState.precipitationLayers?.splash?.label,
    'WeatherRainSplashEmitter',
    'expected splash layer to record splash emitter after recovery',
  );
});

test('zero-particle precipitation handles trigger retries and diagnostics', () => {
  let primaryStopCalls = 0;
  let splashStopCalls = 0;
  let primaryEmitCount = 0;
  let splashEmitCount = 0;
  const primaryHandles = [
    {
      stop() {
        primaryStopCalls += 1;
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
    emitImplementation: (emitter) => {
      if (emitter.debugLabel === 'WeatherRainSplashEmitter') {
        splashEmitCount += 1;
        return {
          stop() {
            splashStopCalls += 1;
          },
          getActiveParticleCount() {
            return 6;
          },
        };
      }
      const handle = primaryHandles[primaryEmitCount] ?? primaryHandles.at(-1);
      primaryEmitCount += 1;
      return handle;
    },
  });

  manager.setWeather('misty_rain');
  manager.update({ delta: 0.1, elapsedTime: 0.1 });
  manager.update({ delta: 1, elapsedTime: 1.1 });
  manager.update({ delta: 0.7, elapsedTime: 1.8 });
  manager.update({ delta: 0.4, elapsedTime: 2.2 });

  const weatherState = scene.userData.weather;

  assert.equal(primaryEmitCount, 2, 'expected precipitation spawn to retry once');
  assert.equal(
    splashEmitCount,
    2,
    'expected splash emitter to spawn alongside each precipitation attempt',
  );
  assert.equal(primaryStopCalls, 1, 'expected inactive precipitation handle to be stopped');
  assert.equal(splashStopCalls, 1, 'expected splash handle to stop when the primary emitter fails');
  assert.equal(particleSystem.emitted.length, 4, 'expected both primary and splash handles to be tracked');
  assert.equal(weatherState.failedPrecipitationSpawns, 1);
  assert.equal(weatherState.precipitationRecoveryAttempts, 1);
  assert.deepEqual(weatherState.lastPrecipitationFailure, {
    elapsedTime: 1.8,
    type: 'rain',
    reason: 'zero_particles',
  });
  assert.equal(
    weatherState.precipitationLayers?.primary?.label,
    RAIN_FALLBACK_LABEL,
    'expected precipitation layer to record fallback emitter after retry succeeds',
  );
  assert.equal(
    weatherState.precipitationLayers?.splash?.label,
    'WeatherRainSplashEmitter',
    'expected splash layer to record splash emitter after retry succeeds',
  );
});

test('rain preset spawns active particles with the real particle system', () => {
  const scene = new THREE.Scene();
  const particleSystem = createParticleSystem({ THREE, scene });
  const manager = createWeatherManager({ scene, particleSystem });

  try {
    manager.setWeather('misty_rain');

    let elapsedTime = 0;
    let peakWeatherParticles = 0;
    let observedFallbackLabel = false;

    const frameDelta = 1 / 60;
    const minimumParticles = 30;
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
        if (weatherEmitter.label.includes('BillboardFallback')) {
          observedFallbackLabel = true;
        }
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
    assert.ok(
      observedFallbackLabel,
      'expected live weather emitter debug label to advertise the fallback billboard pass',
    );
  } finally {
    particleSystem.dispose();
  }
});
