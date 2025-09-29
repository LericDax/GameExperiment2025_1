import { createAuroraRibbonEmitter } from '../../rendering/particles/aurora-effects.js';
import { createWeatherRainEmitter } from '../../rendering/particles/weather-rain.js';
import { createWeatherSnowEmitter } from '../../rendering/particles/weather-snow.js';
import { createWeatherAudioController } from '../../audio/weather-audio.js';
import { createWeatherDebugOverlay } from '../../ui/weather-debug-overlay.js';

const DEFAULT_WEATHER_PRESETS = {
  clear_skies: {
    id: 'clear_skies',
    label: 'Clear Skies',
    description: 'Bright conditions with excellent visibility.',
    intensity: 0,
    category: 'clear',
    moisture: 0,
    temperature: 0.65,
    effects: {},
  },
  misty_rain: {
    id: 'misty_rain',
    label: 'Misty Rain',
    description: 'A gentle drizzle that lightly dampens surfaces.',
    intensity: 0.35,
    category: 'rain',
    moisture: 0.45,
    temperature: 0.5,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 0.45,
        radius: 10,
        anchorHeight: 12,
      },
    },
  },
  charged_storm: {
    id: 'charged_storm',
    label: 'Charged Storm',
    description: 'Heavy rainfall and turbulent winds rolling through the sector.',
    intensity: 0.85,
    category: 'storm',
    moisture: 0.9,
    temperature: 0.4,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 1.2,
        radius: 14,
        anchorHeight: 15,
        updateInterval: 0.18,
      },
    },
  },
};

const CATEGORY_DEFAULT_EFFECTS = {
  rain: {
    precipitation: { type: 'rain' },
  },
  storm: {
    precipitation: { type: 'rain', intensity: 1 },
  },
  snow: {
    precipitation: { type: 'snow' },
  },
  aurora: {
    aurora: { intensity: 1.1, span: 8 },
  },
};

const DEFAULT_TICK_INTERVAL = 1.5;
const DEFAULT_PRECIPITATION_UPDATE_INTERVAL = 0.22;
const DEFAULT_AURORA_UPDATE_INTERVAL = 0.55;
const MIN_WEATHER_DURATION_SECONDS = 30;
const DEFAULT_BIOME_WEATHER_DURATION = { min: 180, max: 420 };

export const DEFAULT_BIOME_WEATHER_ROTATION = Object.freeze([
  {
    id: 'clear_skies',
    weight: 1,
    duration: { ...DEFAULT_BIOME_WEATHER_DURATION },
  },
]);

function cloneWeatherDuration(duration, fallback = DEFAULT_BIOME_WEATHER_DURATION) {
  const fallbackMin = Number.isFinite(fallback?.min)
    ? fallback.min
    : DEFAULT_BIOME_WEATHER_DURATION.min;
  const fallbackMax = Number.isFinite(fallback?.max)
    ? fallback.max
    : DEFAULT_BIOME_WEATHER_DURATION.max;
  const rawMin = Number.isFinite(duration?.min) ? duration.min : fallbackMin;
  const rawMax = Number.isFinite(duration?.max) ? duration.max : fallbackMax;
  const min = Math.max(MIN_WEATHER_DURATION_SECONDS, rawMin);
  const max = Math.max(min, rawMax);
  return { min, max };
}

function cloneWeatherCandidate(candidate, fallbackDuration = DEFAULT_BIOME_WEATHER_DURATION) {
  if (!candidate?.id) {
    return null;
  }
  const weightValue = Number(candidate.weight);
  const weight = Number.isFinite(weightValue) ? Math.max(0, weightValue) : 1;
  if (weight <= 0) {
    return null;
  }
  return {
    id: String(candidate.id),
    weight,
    duration: cloneWeatherDuration(candidate.duration, fallbackDuration),
  };
}

export function resolveBiomeWeatherRotation(biome) {
  const weather = biome?.weather ?? null;
  const source = Array.isArray(weather?.candidates) ? weather.candidates : [];
  const fallbackDuration = weather?.defaultDuration ?? DEFAULT_BIOME_WEATHER_DURATION;
  const resolved = source
    .map((candidate) => cloneWeatherCandidate(candidate, fallbackDuration))
    .filter(Boolean);
  if (resolved.length > 0) {
    return resolved;
  }
  return DEFAULT_BIOME_WEATHER_ROTATION.map((candidate) =>
    cloneWeatherCandidate(candidate, DEFAULT_BIOME_WEATHER_DURATION),
  ).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveWeatherEffects(weather) {
  if (!weather) {
    return { precipitation: null, aurora: null };
  }
  const categoryDefaults = CATEGORY_DEFAULT_EFFECTS[weather.category] ?? {};
  const effects = weather.effects ?? {};
  return {
    precipitation: {
      ...(categoryDefaults.precipitation ?? {}),
      ...(effects.precipitation ?? {}),
    },
    aurora: {
      ...(categoryDefaults.aurora ?? {}),
      ...(effects.aurora ?? {}),
    },
  };
}

function normalisePrecipitationEffect(weather, effect) {
  if (!effect || !effect.type) {
    return null;
  }
  const type = String(effect.type);
  const baseIntensity = Number.isFinite(effect.intensity)
    ? effect.intensity
    : Number.isFinite(weather?.intensity)
    ? weather.intensity
    : 0.5;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 12;
  const anchorHeight = Number.isFinite(effect.anchorHeight)
    ? effect.anchorHeight
    : Number.isFinite(effect.heightOffset)
    ? effect.heightOffset
    : 14;
  const updateInterval = Number.isFinite(effect.updateInterval)
    ? effect.updateInterval
    : null;
  const minAnchorDistance = Number.isFinite(effect.minAnchorDistance)
    ? effect.minAnchorDistance
    : null;
  return {
    type,
    intensity: clamp(baseIntensity, 0.15, 2.6),
    radius: Math.max(4, radius),
    anchorHeight,
    updateInterval: updateInterval ?? null,
    minAnchorDistance: minAnchorDistance ?? null,
  };
}

function normaliseAuroraEffect(weather, effect) {
  if (!effect || (effect.intensity === undefined && effect.span === undefined && !effect.type)) {
    return null;
  }
  const baseIntensity = Number.isFinite(effect.intensity)
    ? effect.intensity
    : Number.isFinite(weather?.intensity)
    ? weather.intensity
    : 0.6;
  const span = Number.isFinite(effect.span) ? effect.span : 8;
  const count = Number.isFinite(effect.count) ? Math.max(1, Math.round(effect.count)) : 1;
  const anchorHeight = Number.isFinite(effect.anchorHeight) ? effect.anchorHeight : 20;
  const forwardOffset = Number.isFinite(effect.forwardOffset) ? effect.forwardOffset : 14;
  const lateralOffset = Number.isFinite(effect.lateralOffset) ? effect.lateralOffset : 5;
  const orientation = Number.isFinite(effect.orientation) ? effect.orientation : null;
  const orientationJitter = Number.isFinite(effect.orientationJitter)
    ? effect.orientationJitter
    : Math.PI / 10;
  const updateInterval = Number.isFinite(effect.updateInterval)
    ? effect.updateInterval
    : DEFAULT_AURORA_UPDATE_INTERVAL;
  return {
    intensity: clamp(baseIntensity, 0.2, 3.4),
    span: Math.max(4, span),
    count,
    anchorHeight,
    forwardOffset,
    lateralOffset,
    orientation,
    orientationJitter,
    updateInterval,
    alignWithHeading: effect.alignWithHeading !== false,
  };
}

export function createWeatherManager({
  scene,
  particleSystem,
  registerDiagnosticOverlay,
} = {}) {
  const audioController = createWeatherAudioController();
  const weatherPresets = new Map(
    Object.entries(DEFAULT_WEATHER_PRESETS).map(([key, value]) => [key, { ...value }]),
  );

  let activeWeather = weatherPresets.get('clear_skies') ?? null;
  let tickAccumulator = 0;
  let lastElapsedTime = 0;
  const tickListeners = new Set();
  const scheduledTransitions = [];
  let diagnosticOverlayDisposer = null;
  const activeParticleEffects = [];
  let needsEffectRefresh = true;

  let overlayUi = null;

  const ensureWeatherState = () => {
    if (!scene) {
      return null;
    }
    scene.userData = scene.userData || {};
    if (!scene.userData.weather) {
      scene.userData.weather = {};
    }
    const state = scene.userData.weather;
    if (!Number.isFinite(state.failedPrecipitationSpawns)) {
      state.failedPrecipitationSpawns = 0;
    }
    if (state.lastPrecipitationFailure === undefined) {
      state.lastPrecipitationFailure = null;
    }
    if (state.lastOverlayUpdate === undefined) {
      state.lastOverlayUpdate = null;
    }
    if (state.lastDebugSample === undefined) {
      state.lastDebugSample = null;
    }
    if (state.overridesSuppressed === undefined) {
      state.overridesSuppressed = false;
    }
    if (state.activeEmitterCount === undefined) {
      state.activeEmitterCount = 0;
    }
    if (state.totalActiveParticles === undefined) {
      state.totalActiveParticles = null;
    }
    if (state.lastAnchorUpdate === undefined) {
      state.lastAnchorUpdate = null;
    }
    if (state.lastPrecipitationSpawn === undefined) {
      state.lastPrecipitationSpawn = null;
    }
    return state;
  };

  const syncEmitterState = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    state.activeEmitterCount = activeParticleEffects.length;
    if (state.activeEmitterCount === 0) {
      state.totalActiveParticles = 0;
    }
  };

  const recordAnchorUpdate = (elapsedTime) => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    if (Number.isFinite(elapsedTime)) {
      state.lastAnchorUpdate = elapsedTime;
    }
  };

  const recordPrecipitationSpawn = ({ type, elapsedTime }) => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    state.lastPrecipitationSpawn = {
      type,
      elapsedTime: Number.isFinite(elapsedTime) ? elapsedTime : null,
    };
  };

  const applyWeatherEffects = (weather) => {
    if (!weather || !scene) {
      return;
    }
    const weatherState = ensureWeatherState();
    const resolvedEffects = resolveWeatherEffects(weather);
    weatherState.id = weather.id;
    weatherState.label = weather.label;
    weatherState.intensity = weather.intensity;
    weatherState.category = weather.category;
    weatherState.precipitation = resolvedEffects.precipitation?.type ?? null;
    weatherState.aurora = Boolean(
      resolvedEffects.aurora && Object.keys(resolvedEffects.aurora).length > 0,
    );
  };

  const disposeWeatherEffects = () => {
    for (const attachment of activeParticleEffects) {
      try {
        attachment.handle?.stop?.();
      } catch (error) {
        console.warn('Failed to dispose weather particle handle:', error);
      }
    }
    activeParticleEffects.length = 0;
    syncEmitterState();
  };

  const spawnPrecipitationEffect = (config, context) => {
    if (!particleSystem || typeof particleSystem.emit !== 'function') {
      return;
    }
    const emitter =
      config.type === 'snow'
        ? createWeatherSnowEmitter({
            intensity: config.intensity,
            radius: config.radius,
            heightOffset: config.anchorHeight,
          })
        : createWeatherRainEmitter({
            intensity: config.intensity,
            radius: config.radius,
            heightOffset: config.anchorHeight,
          });
    const handle = particleSystem.emit(emitter);
    if (!handle) {
      const weatherState = ensureWeatherState();
      if (weatherState) {
        const previousFailures = Number.isFinite(weatherState.failedPrecipitationSpawns)
          ? weatherState.failedPrecipitationSpawns
          : 0;
        weatherState.failedPrecipitationSpawns = previousFailures + 1;
        weatherState.lastPrecipitationFailure = {
          elapsedTime: context?.elapsedTime ?? null,
          type: config.type,
        };
      }
      console.warn('Weather precipitation emitter failed to spawn; no handle was returned.', {
        type: config.type,
      });
      return;
    }
    let updateInterval = config.updateInterval;
    if (!Number.isFinite(updateInterval) && Number.isFinite(emitter.weatherUpdateInterval)) {
      updateInterval = emitter.weatherUpdateInterval;
    }
    let minAnchorDistance = config.minAnchorDistance;
    if (
      !Number.isFinite(minAnchorDistance) &&
      Number.isFinite(emitter.weatherMinAnchorDistance)
    ) {
      minAnchorDistance = emitter.weatherMinAnchorDistance;
    }
    const attachment = {
      type: 'precipitation',
      handle,
      emitter,
      anchorOffsetY: config.anchorHeight,
      updateInterval: Number.isFinite(updateInterval)
        ? Math.max(0.05, updateInterval)
        : DEFAULT_PRECIPITATION_UPDATE_INTERVAL,
      minDistanceSq: Number.isFinite(minAnchorDistance)
        ? Math.max(0, minAnchorDistance) ** 2
        : (emitter.weatherMinAnchorDistance ?? 0) ** 2,
      lastUpdateTime: -Infinity,
      lastAnchor: {
        x: Number.POSITIVE_INFINITY,
        y: Number.POSITIVE_INFINITY,
        z: Number.POSITIVE_INFINITY,
      },
    };
    const playerPosition = context.playerControls?.getPosition?.();
    const elapsedTime = context.elapsedTime ?? 0;
    if (playerPosition) {
      emitter.setBasePosition?.({
        x: playerPosition.x,
        y: playerPosition.y + config.anchorHeight,
        z: playerPosition.z,
      });
      attachment.lastAnchor = {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
      };
      attachment.lastUpdateTime = elapsedTime;
      recordAnchorUpdate(elapsedTime);
    }
    activeParticleEffects.push(attachment);
    recordPrecipitationSpawn({ type: config.type, elapsedTime });
    syncEmitterState();
  };

  const spawnAuroraEffects = (config, context) => {
    if (!particleSystem || typeof particleSystem.emit !== 'function') {
      return;
    }
    const playerControls = context.playerControls;
    const yawPitch = playerControls?.getYawPitch?.();
    const headingYaw = yawPitch?.yaw ?? 0;
    const count = config.count;
    const centerIndex = (count - 1) / 2;
    for (let i = 0; i < count; i += 1) {
      const offsetIndex = i - centerIndex;
      const orientationOffset = offsetIndex * 0.35;
      const jitter = (Math.random() - 0.5) * config.orientationJitter;
      const baseOrientation = config.alignWithHeading
        ? headingYaw
        : config.orientation ?? headingYaw;
      const ribbonOrientation = baseOrientation + orientationOffset + jitter;
      const emitter = createAuroraRibbonEmitter({
        position: { x: 0, y: config.anchorHeight, z: 0 },
        span: config.span,
        intensity: config.intensity,
        orientation: ribbonOrientation,
      });
      emitter.debugLabel = emitter.debugLabel ?? 'WeatherAuroraRibbon';
      const handle = particleSystem.emit(emitter);
      if (!handle) {
        continue;
      }
      const attachment = {
        type: 'aurora',
        handle,
        emitter,
        anchorOffsetY: config.anchorHeight,
        updateInterval: Math.max(0.25, config.updateInterval),
        forwardOffset: config.forwardOffset,
        lateralOffset: offsetIndex * config.lateralOffset,
        alignWithHeading: config.alignWithHeading,
        orientationOffset: orientationOffset + jitter,
        baseHeadingAtSpawn: headingYaw,
        staticOrientation: ribbonOrientation,
        lastUpdateTime: -Infinity,
      };
      activeParticleEffects.push(attachment);
    }
    if (count > 0) {
      syncEmitterState();
    }
  };

  const refreshWeatherEffects = (context) => {
    needsEffectRefresh = false;
    disposeWeatherEffects();
    if (!activeWeather) {
      return;
    }
    const resolved = resolveWeatherEffects(activeWeather);
    const precipitation = normalisePrecipitationEffect(activeWeather, resolved.precipitation);
    if (precipitation) {
      spawnPrecipitationEffect(precipitation, context);
    }
    const aurora = normaliseAuroraEffect(activeWeather, resolved.aurora);
    if (aurora) {
      spawnAuroraEffects(aurora, context);
    }
  };

  const updateAnchoredEffects = (context) => {
    if (activeParticleEffects.length === 0) {
      return;
    }
    const { playerControls, elapsedTime = lastElapsedTime } = context;
    const playerPosition = playerControls?.getPosition?.();
    if (!playerPosition) {
      return;
    }
    const yawPitch = playerControls.getYawPitch?.();
    for (const attachment of activeParticleEffects) {
      if (typeof attachment.emitter?.setBasePosition !== 'function') {
        continue;
      }
      const interval = Number.isFinite(attachment.updateInterval)
        ? attachment.updateInterval
        : 0;
      if (interval > 0 && elapsedTime - (attachment.lastUpdateTime ?? -Infinity) < interval) {
        continue;
      }
      if (attachment.type === 'precipitation') {
        const dx = playerPosition.x - attachment.lastAnchor.x;
        const dy = playerPosition.y - attachment.lastAnchor.y;
        const dz = playerPosition.z - attachment.lastAnchor.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < (attachment.minDistanceSq ?? 0)) {
          continue;
        }
        attachment.emitter.setBasePosition({
          x: playerPosition.x,
          y: playerPosition.y + attachment.anchorOffsetY,
          z: playerPosition.z,
        });
        attachment.lastAnchor = {
          x: playerPosition.x,
          y: playerPosition.y,
          z: playerPosition.z,
        };
        attachment.lastUpdateTime = elapsedTime;
        recordAnchorUpdate(elapsedTime);
      } else if (attachment.type === 'aurora') {
        let heading = attachment.staticOrientation ?? 0;
        if (attachment.alignWithHeading) {
          const baseYaw = yawPitch?.yaw ?? attachment.baseHeadingAtSpawn ?? 0;
          heading = baseYaw + (attachment.orientationOffset ?? 0);
        }
        const forwardOffset = Number.isFinite(attachment.forwardOffset)
          ? attachment.forwardOffset
          : 12;
        let anchorX = playerPosition.x + Math.cos(heading) * forwardOffset;
        let anchorZ = playerPosition.z + Math.sin(heading) * forwardOffset;
        if (Number.isFinite(attachment.lateralOffset) && attachment.lateralOffset !== 0) {
          const lateralYaw = heading + Math.PI / 2;
          anchorX += Math.cos(lateralYaw) * attachment.lateralOffset;
          anchorZ += Math.sin(lateralYaw) * attachment.lateralOffset;
        }
        attachment.emitter.setBasePosition({
          x: anchorX,
          y: playerPosition.y + attachment.anchorOffsetY,
          z: anchorZ,
        });
        attachment.lastUpdateTime = elapsedTime;
        recordAnchorUpdate(elapsedTime);
      }
    }
  };

  const evaluateScheduledTransitions = ({ elapsedTime }) => {
    if (!Number.isFinite(elapsedTime)) {
      return;
    }
    const due = [];
    for (let i = scheduledTransitions.length - 1; i >= 0; i -= 1) {
      const entry = scheduledTransitions[i];
      if (elapsedTime >= entry.triggerTime) {
        due.push(entry);
        scheduledTransitions.splice(i, 1);
      }
    }
    for (const entry of due.sort((a, b) => a.triggerTime - b.triggerTime)) {
      setWeather(entry.weatherId, entry.options);
    }
  };

  const runTick = (context) => {
    if (tickListeners.size === 0) {
      return;
    }
    const listeners = Array.from(tickListeners);
    listeners.forEach((listener) => {
      try {
        listener({
          weather: getCurrentWeather(),
          scene,
          particleSystem,
          ...context,
        });
      } catch (error) {
        console.error('Weather tick listener failed:', error);
      }
    });
  };

  const registerOverlay = () => {
    if (typeof registerDiagnosticOverlay !== 'function' || diagnosticOverlayDisposer) {
      return;
    }
    if (!overlayUi) {
      overlayUi = createWeatherDebugOverlay();
    }
    diagnosticOverlayDisposer = registerDiagnosticOverlay(({ elapsedTime }) => {
      const weatherState = ensureWeatherState();
      if (!weatherState) {
        return;
      }
      weatherState.lastOverlayUpdate = Number.isFinite(elapsedTime)
        ? elapsedTime
        : weatherState.lastOverlayUpdate;
      weatherState.activeEmitterCount = activeParticleEffects.length;

      let stats = null;
      if (particleSystem && typeof particleSystem.getDebugInfo === 'function') {
        const debugInfo = particleSystem.getDebugInfo();
        if (debugInfo) {
          const emitters = Array.isArray(debugInfo.emitters) ? debugInfo.emitters : [];
          const weatherEmitters = emitters.filter((emitter) => {
            if (!emitter || typeof emitter.label !== 'string') {
              return false;
            }
            return emitter.label.toLowerCase().includes('weather');
          });
          const summaries = weatherEmitters.slice(0, 4).map((emitter) => ({
            label: emitter.label ?? 'WeatherEmitter',
            particles: Number.isFinite(emitter.activeParticles)
              ? emitter.activeParticles
              : 0,
            status: emitter.pendingRemoval ? ' (pending removal)' : '',
          }));
          const weatherParticles = weatherEmitters.reduce((sum, emitter) => {
            const value = Number.isFinite(emitter?.activeParticles)
              ? emitter.activeParticles
              : 0;
            return sum + value;
          }, 0);
          const totalEmitters = Number.isFinite(debugInfo.emitterCount)
            ? debugInfo.emitterCount
            : emitters.length;
          stats = {
            totalEmitters,
            weatherCount: weatherEmitters.length,
            weatherParticles,
            emitters: summaries,
            extraCount: Math.max(0, weatherEmitters.length - summaries.length),
          };
          weatherState.lastDebugSample = Number.isFinite(elapsedTime)
            ? elapsedTime
            : weatherState.lastDebugSample;
          weatherState.totalActiveParticles = Number.isFinite(weatherParticles)
            ? weatherParticles
            : weatherState.totalActiveParticles;
        }
      }

      overlayUi?.update({ weatherState, stats });
    });
  };

  const setWeather = (weatherId, options = {}) => {
    const preset = weatherPresets.get(weatherId);
    if (!preset) {
      console.warn(`Weather preset "${weatherId}" is not registered.`);
      return activeWeather;
    }
    const nextWeather = {
      ...preset,
      ...options.metadata,
      id: weatherId,
    };
    if (activeWeather && activeWeather.id === nextWeather.id) {
      return activeWeather;
    }
    const previousWeatherId = activeWeather?.id ?? null;
    disposeWeatherEffects();
    activeWeather = nextWeather;
    needsEffectRefresh = true;
    applyWeatherEffects(activeWeather);
    audioController.handleTransition({
      previousWeatherId,
      nextWeatherId: activeWeather?.id ?? null,
    });
    return activeWeather;
  };

  const scheduleWeatherChange = ({ weatherId, delay = 0, triggerTime, options = {} }) => {
    if (!weatherId) {
      throw new Error('scheduleWeatherChange requires a weatherId');
    }
    const baseTime = Number.isFinite(triggerTime)
      ? triggerTime
      : (Number.isFinite(lastElapsedTime) ? lastElapsedTime : 0) + Math.max(0, delay);
    scheduledTransitions.push({
      weatherId,
      triggerTime: baseTime,
      options,
    });
  };

  const registerTickListener = (listener) => {
    if (typeof listener !== 'function') {
      throw new Error('registerTickListener expects a function');
    }
    tickListeners.add(listener);
    return () => {
      tickListeners.delete(listener);
    };
  };

  const registerWeatherPreset = (weather) => {
    if (!weather?.id) {
      throw new Error('registerWeatherPreset expects an object with an id');
    }
    weatherPresets.set(weather.id, { ...weather });
  };

  const listWeatherPresets = () =>
    Array.from(weatherPresets.values()).map((preset) => ({ ...preset }));

  const getCurrentWeather = () => (activeWeather ? { ...activeWeather } : null);

  const update = (context = {}) => {
    const { delta = 0, elapsedTime = lastElapsedTime } = context;
    lastElapsedTime = Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime;
    evaluateScheduledTransitions({ elapsedTime: lastElapsedTime });
    if (needsEffectRefresh) {
      refreshWeatherEffects({ ...context, elapsedTime: lastElapsedTime });
    }
    updateAnchoredEffects({ ...context, elapsedTime: lastElapsedTime });
    tickAccumulator += Number.isFinite(delta) ? delta : 0;
    while (tickAccumulator >= DEFAULT_TICK_INTERVAL) {
      tickAccumulator -= DEFAULT_TICK_INTERVAL;
      runTick({
        delta: DEFAULT_TICK_INTERVAL,
        elapsedTime: lastElapsedTime,
        playerControls: context.playerControls,
      });
    }
  };

  const dispose = () => {
    disposeWeatherEffects();
    tickListeners.clear();
    scheduledTransitions.length = 0;
    needsEffectRefresh = false;
    audioController.dispose();
    if (diagnosticOverlayDisposer) {
      try {
        diagnosticOverlayDisposer();
      } catch (error) {
        console.error('Failed to dispose weather diagnostic overlay:', error);
      }
      diagnosticOverlayDisposer = null;
    }
    if (overlayUi) {
      try {
        overlayUi.dispose();
      } catch (error) {
        console.error('Failed to dispose weather overlay UI:', error);
      }
      overlayUi = null;
    }
  };

  applyWeatherEffects(activeWeather);
  registerOverlay();

  return {
    update,
    setWeather,
    scheduleWeatherChange,
    registerTickListener,
    registerWeatherPreset,
    listWeatherPresets,
    getCurrentWeather,
    dispose,
  };
}
