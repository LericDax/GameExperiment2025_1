import { createAuroraRibbonEmitter } from '../../rendering/particles/aurora-effects.js';
import { createWeatherRainEmitter } from '../../rendering/particles/weather-rain.js';
import { createWeatherRainSplashEmitter } from '../../rendering/particles/weather-rain-splashes.js';
import { createWeatherSnowEmitter } from '../../rendering/particles/weather-snow.js';
import {
  clampRaindropOverlayIntensity,
  clampRaindropOverlayWindSpeed,
  clampRaindropOverlayStreakDensity,
  clampRaindropOverlaySparkleGain,
  createRaindropOverlay,
  DEFAULT_RAIN_OVERLAY_WIND_SPEED,
  DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
  DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
} from '../../rendering/effects/raindrop-overlay.js';
import { createWeatherAudioController } from '../../audio/weather-audio.js';
import { createWeatherDebugOverlay } from '../../ui/weather-debug-overlay.js';
import { createWeatherOverlayController } from '../../ui/weather-overlay-controller.js';

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
  soft_snowfall: {
    id: 'soft_snowfall',
    label: 'Soft Snowfall',
    description: 'Gentle crystalline flakes drift through calm polar air.',
    intensity: 0.55,
    category: 'snow',
    moisture: 0.7,
    temperature: 0.18,
    effects: {
      precipitation: {
        type: 'snow',
        intensity: 0.7,
        radius: 12,
        anchorHeight: 15,
        updateInterval: 0.32,
        raindropOverlay: {
          intensity: 1.05,
          windSpeed: 0.12,
          streakDensity: 0.54,
          sparkleGain: 0.72,
          rippleScale: 0.78,
          dropSpeed: 0.34,
          viscosity: 0.88,
          flakeDensity: 2.7,
          puffDensity: 1.85,
        },
      },
    },
  },
  polar_aurora: {
    id: 'polar_aurora',
    label: 'Polar Aurora',
    description: 'Iridescent aurora curtains sweep overhead while the air stays still.',
    intensity: 0.75,
    category: 'aurora',
    moisture: 0.35,
    temperature: 0.1,
    effects: {
      aurora: {
        intensity: 1.85,
        span: 18,
        count: 5,
        layers: 2,
        layerSpacing: 22,
        layerHeightStep: 3.2,
        layerSpanScale: 0.42,
        layerLateralScale: 0.55,
        layerIntensityFalloff: 0.8,
        anchorHeight: 34,
        forwardOffset: 58,
        lateralOffset: 14,
        orientationJitter: Math.PI / 16,
        alignWithHeading: true,
      },
    },
  },
  aurora_snowfall: {
    id: 'aurora_snowfall',
    label: 'Aurora Snowfall',
    description: 'Soft snow puffs fall as aurora ribbons shimmer in the distance.',
    intensity: 0.65,
    category: 'snow',
    moisture: 0.74,
    temperature: 0.16,
    effects: {
      precipitation: {
        type: 'snow',
        intensity: 0.65,
        radius: 13,
        anchorHeight: 16,
        updateInterval: 0.3,
        raindropOverlay: {
          intensity: 1.12,
          windSpeed: 0.18,
          streakDensity: 0.58,
          sparkleGain: 0.78,
          rippleScale: 0.82,
          dropSpeed: 0.38,
          viscosity: 0.82,
          flakeDensity: 2.5,
          puffDensity: 1.7,
        },
      },
      aurora: {
        intensity: 1.45,
        span: 16,
        count: 4,
        layers: 2,
        layerSpacing: 20,
        layerHeightStep: 2.6,
        layerSpanScale: 0.38,
        layerLateralScale: 0.48,
        layerIntensityFalloff: 0.78,
        anchorHeight: 30,
        forwardOffset: 54,
        lateralOffset: 12,
        orientationJitter: Math.PI / 14,
        alignWithHeading: true,
      },
    },
  },
  tropical_squalls: {
    id: 'tropical_squalls',
    label: 'Tropical Squalls',
    description:
      'Equatorial updrafts condense into sudden downpours and cross-cutting gust fronts.',
    intensity: 0.9,
    category: 'storm',
    moisture: 0.96,
    temperature: 0.78,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 1.45,
        radius: 16,
        anchorHeight: 18,
        updateInterval: 0.16,
        minAnchorDistance: 4,
        raindropOverlay: {
          intensity: 2.1,
          windSpeed: 1.35,
          streakDensity: 1.68,
          sparkleGain: 1.18,
          rippleScale: 0.74,
          dropSpeed: 1.08,
          viscosity: 0.58,
        },
      },
    },
  },
  polar_blizzard: {
    id: 'polar_blizzard',
    label: 'Polar Blizzard',
    description:
      'Cataclysmic katabatic gusts whip needle-sharp ice crystals into a blinding whiteout.',
    intensity: 0.98,
    category: 'snow',
    moisture: 0.95,
    temperature: 0.02,
    effects: {
      precipitation: {
        type: 'snow',
        intensity: 3.4,
        radius: 16,
        anchorHeight: 20,
        updateInterval: 0.16,
        raindropOverlay: {
          intensity: 3.75,
          windSpeed: 2.05,
          streakDensity: 2.25,
          sparkleGain: 1.62,
          rippleScale: 0.94,
          dropSpeed: 0.86,
          viscosity: 0.62,
          flakeDensity: 6.2,
          puffDensity: 4.4,
          shear: 1.6,
          downdraft: 2.1,
        },
      },
    },
  },
  upwelling_fog: {
    id: 'upwelling_fog',
    label: 'Upwelling Fog',
    description:
      'Cold currents exhume ribbons of sea mist that roll inland before sunrise.',
    intensity: 0.48,
    category: 'fog',
    moisture: 0.82,
    temperature: 0.44,
    effects: {
      precipitation: {
        type: 'rain',
        intensity: 0.32,
        radius: 11,
        anchorHeight: 11,
        updateInterval: 0.46,
        minAnchorDistance: 6,
        raindropOverlay: {
          intensity: 0.72,
          windSpeed: 0.28,
          streakDensity: 0.44,
          sparkleGain: 0.24,
          rippleScale: 0.66,
          dropSpeed: 0.26,
          viscosity: 1.24,
          puffDensity: 2.1,
        },
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
    aurora: {
      intensity: 1.35,
      span: 14,
      count: 4,
      layers: 2,
      layerSpacing: 18,
      layerHeightStep: 2.4,
      layerSpanScale: 0.36,
      layerLateralScale: 0.45,
      layerIntensityFalloff: 0.82,
      anchorHeight: 30,
      forwardOffset: 50,
      lateralOffset: 12,
    },
  },
  fog: {
    precipitation: { type: 'rain', intensity: 0.3 },
  },
};

const DEFAULT_TICK_INTERVAL = 1.5;
const DEFAULT_PRECIPITATION_UPDATE_INTERVAL = 0.22;
const DEFAULT_AURORA_UPDATE_INTERVAL = 0.55;
const PRECIPITATION_HANDLE_VALIDATION_DELAY = 0.85;
const PRECIPITATION_HANDLE_RECHECK_INTERVAL = 0.55;
const PRECIPITATION_SPAWN_MAX_RETRIES = 2;
const MIN_WEATHER_DURATION_SECONDS = 30;
const DEFAULT_BIOME_WEATHER_DURATION = { min: 180, max: 420 };
const ROTATION_HARNESS_TAG = 'weather-rotation-harness';
const RAIN_OVERLAY_INTENSITY_MIN = 0.3;
const RAIN_OVERLAY_INTENSITY_MAX = 3.5;
const RAIN_OVERLAY_INTENSITY_SCALE = 1.8;
const RAIN_OVERLAY_INTENSITY_CURVE = 0.82;
const RAIN_OVERLAY_RESPONSE_CURVE = 0.9;
const RAIN_OVERLAY_WIND_MAX = 2.35;
const RAIN_OVERLAY_STREAK_MIN = 0.85;
const RAIN_OVERLAY_STREAK_MAX = 2.75;
const RAIN_OVERLAY_SPARKLE_MIN = 0.5;
const RAIN_OVERLAY_SPARKLE_MAX = 1.8;

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

function normalisePrecipitationShaderValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'bright' : 'billboard';
  }
  if (typeof value === 'string') {
    const normalised = value.toLowerCase();
    if (normalised === 'bright' || normalised === 'brightstreak' || normalised === 'bright_streak') {
      return 'bright';
    }
    if (normalised === 'billboard' || normalised === 'fallback') {
      return 'billboard';
    }
  }
  return undefined;
}

function normaliseRainUniformSnapshot(uniforms) {
  if (!uniforms) {
    return null;
  }
  const snapshot = {};
  const assign = (targetKey, sourceKey = targetKey) => {
    if (uniforms[sourceKey] !== undefined) {
      snapshot[targetKey] = uniforms[sourceKey];
    }
  };
  assign('windTilt');
  assign('streakNoise');
  assign('highlightWidth');
  assign('rippleScale');
  if (uniforms.dropSpeed !== undefined) {
    snapshot.dropSpeed = uniforms.dropSpeed;
  } else if (uniforms.dropDensity !== undefined) {
    snapshot.dropSpeed = uniforms.dropDensity;
    snapshot.dropDensity = uniforms.dropDensity;
  }
  if (uniforms.viscosity !== undefined) {
    snapshot.viscosity = uniforms.viscosity;
  } else if (uniforms.timerBias !== undefined) {
    snapshot.viscosity = uniforms.timerBias;
    snapshot.timerBias = uniforms.timerBias;
  }
  return snapshot;
}

function normaliseManualPrecipitationOverridesSnapshot(overrides) {
  if (!overrides) {
    return null;
  }
  const snapshot = {};
  const assign = (key, value) => {
    if (value !== undefined) {
      snapshot[key] = value;
    }
  };
  assign('intensity', overrides.intensity);
  assign('radius', overrides.radius);
  assign('windTilt', overrides.windTilt);
  assign('streakNoise', overrides.streakNoise);
  assign('highlightWidth', overrides.highlightWidth);
  assign('rippleScale', overrides.rippleScale);
  const dropSpeedValue =
    overrides.dropSpeed !== undefined
      ? overrides.dropSpeed
      : overrides.dropDensity !== undefined
      ? overrides.dropDensity
      : undefined;
  assign('dropSpeed', dropSpeedValue);
  const viscosityValue =
    overrides.viscosity !== undefined
      ? overrides.viscosity
      : overrides.timerBias !== undefined
      ? overrides.timerBias
      : undefined;
  assign('viscosity', viscosityValue);
  if (overrides.dropDensity !== undefined) {
    snapshot.dropDensity = overrides.dropDensity;
  }
  if (overrides.timerBias !== undefined) {
    snapshot.timerBias = overrides.timerBias;
  }
  const shaderValue = (() => {
    if (overrides.shader !== undefined) {
      return normalisePrecipitationShaderValue(overrides.shader);
    }
    if (overrides.useBrightStreakShader !== undefined) {
      return normalisePrecipitationShaderValue(overrides.useBrightStreakShader);
    }
    return undefined;
  })();
  if (shaderValue !== undefined) {
    snapshot.shader = shaderValue;
  }
  return snapshot;
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
  const overlayEffect = effect.raindropOverlay ?? null;
  let raindropOverlay = null;
  if (overlayEffect) {
    const overlayConfig = {};
    if (Number.isFinite(overlayEffect.intensity)) {
      overlayConfig.intensity = clampRaindropOverlayIntensity(overlayEffect.intensity);
    }
    if (Number.isFinite(overlayEffect.windSpeed)) {
      overlayConfig.windSpeed = clampRaindropOverlayWindSpeed(overlayEffect.windSpeed);
    }
    if (Number.isFinite(overlayEffect.streakDensity)) {
      overlayConfig.streakDensity = clampRaindropOverlayStreakDensity(
        overlayEffect.streakDensity,
      );
    }
    if (Number.isFinite(overlayEffect.sparkleGain)) {
      overlayConfig.sparkleGain = clampRaindropOverlaySparkleGain(overlayEffect.sparkleGain);
    }
    if (Number.isFinite(overlayEffect.rippleScale)) {
      overlayConfig.rippleScale = overlayEffect.rippleScale;
    }
    if (Number.isFinite(overlayEffect.dropSpeed)) {
      overlayConfig.dropSpeed = overlayEffect.dropSpeed;
    }
    if (Number.isFinite(overlayEffect.viscosity)) {
      overlayConfig.viscosity = overlayEffect.viscosity;
    }
    if (Number.isFinite(overlayEffect.flakeDensity)) {
      overlayConfig.flakeDensity = Math.max(0, overlayEffect.flakeDensity);
    }
    if (Number.isFinite(overlayEffect.puffDensity)) {
      overlayConfig.puffDensity = Math.max(0, overlayEffect.puffDensity);
    }
    if (Object.keys(overlayConfig).length > 0) {
      raindropOverlay = overlayConfig;
    }
  }
  let shaderPreference = normalisePrecipitationShaderValue(effect.shader);
  if (shaderPreference === undefined) {
    shaderPreference = normalisePrecipitationShaderValue(effect.brightStreakShader);
  }
  if (shaderPreference === undefined) {
    shaderPreference = normalisePrecipitationShaderValue(effect.useBrightStreakShader);
  }
  const resolvedShader = shaderPreference ?? null;
  const resolvedShaderFlag =
    resolvedShader === 'bright'
      ? true
      : resolvedShader === 'billboard'
      ? false
      : effect.useBrightStreakShader === true
      ? true
      : effect.useBrightStreakShader === false
      ? false
      : undefined;
  const maxIntensity = type === 'snow' ? 4 : 2.6;
  return {
    type,
    intensity: clamp(baseIntensity, 0.15, maxIntensity),
    radius: Math.max(4, radius),
    anchorHeight,
    updateInterval: updateInterval ?? null,
    minAnchorDistance: minAnchorDistance ?? null,
    raindropOverlay,
    shader: resolvedShader,
    useBrightStreakShader: resolvedShaderFlag,
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
  const layers = Number.isFinite(effect.layers) ? Math.max(1, Math.round(effect.layers)) : 1;
  const layerSpacing = Number.isFinite(effect.layerSpacing) ? Math.max(0, effect.layerSpacing) : 12;
  const layerHeightStep = Number.isFinite(effect.layerHeightStep)
    ? effect.layerHeightStep
    : 1.6;
  const layerSpanScale = Number.isFinite(effect.layerSpanScale)
    ? Math.max(0, effect.layerSpanScale)
    : 0.3;
  const layerLateralScale = Number.isFinite(effect.layerLateralScale)
    ? Math.max(0, effect.layerLateralScale)
    : 0.35;
  const layerIntensityFalloff = Number.isFinite(effect.layerIntensityFalloff)
    ? clamp(effect.layerIntensityFalloff, 0.2, 1)
    : 0.85;
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
    layers,
    layerSpacing,
    layerHeightStep,
    layerSpanScale,
    layerLateralScale,
    layerIntensityFalloff,
    orientation,
    orientationJitter,
    updateInterval,
    alignWithHeading: effect.alignWithHeading !== false,
  };
}

function resolveRainOverlayResponse(precipitation) {
  const defaults = {
    active: false,
    intensity: 0,
    windSpeed: DEFAULT_RAIN_OVERLAY_WIND_SPEED,
    streakDensity: DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
    sparkleGain: DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
  };
  if (!precipitation) {
    return defaults;
  }
  const base = Number.isFinite(precipitation.intensity)
    ? Math.max(0, precipitation.intensity)
    : 0;
  const range = Math.max(0, RAIN_OVERLAY_INTENSITY_MAX - RAIN_OVERLAY_INTENSITY_MIN);
  const normalisedBase =
    RAIN_OVERLAY_INTENSITY_SCALE > 0
      ? clamp(base, 0, RAIN_OVERLAY_INTENSITY_SCALE) / RAIN_OVERLAY_INTENSITY_SCALE
      : 0;
  const curvedBase = Math.pow(normalisedBase, RAIN_OVERLAY_INTENSITY_CURVE);
  const scaledIntensity =
    RAIN_OVERLAY_INTENSITY_MIN + curvedBase * range;
  const intensity = clampRaindropOverlayIntensity(
    clamp(scaledIntensity, RAIN_OVERLAY_INTENSITY_MIN, RAIN_OVERLAY_INTENSITY_MAX),
  );
  const responseCurve =
    range > 0
      ? Math.pow(
          clamp(
            (intensity - RAIN_OVERLAY_INTENSITY_MIN) / range,
            0,
            1,
          ),
          RAIN_OVERLAY_RESPONSE_CURVE,
        )
      : 0;
  const overlayConfig = precipitation.raindropOverlay ?? {};
  const windSource =
    overlayConfig.windSpeed !== undefined
      ? overlayConfig.windSpeed
      : responseCurve * RAIN_OVERLAY_WIND_MAX;
  const streakSource =
    overlayConfig.streakDensity !== undefined
      ? overlayConfig.streakDensity
      : RAIN_OVERLAY_STREAK_MIN +
        responseCurve * (RAIN_OVERLAY_STREAK_MAX - RAIN_OVERLAY_STREAK_MIN);
  const sparkleSource =
    overlayConfig.sparkleGain !== undefined
      ? overlayConfig.sparkleGain
      : RAIN_OVERLAY_SPARKLE_MIN +
        responseCurve * (RAIN_OVERLAY_SPARKLE_MAX - RAIN_OVERLAY_SPARKLE_MIN);
  const rippleScaleSource =
    overlayConfig.rippleScale !== undefined && Number.isFinite(overlayConfig.rippleScale)
      ? overlayConfig.rippleScale
      : null;
  const dropSpeedSource =
    overlayConfig.dropSpeed !== undefined && Number.isFinite(overlayConfig.dropSpeed)
      ? overlayConfig.dropSpeed
      : null;
  const viscositySource =
    overlayConfig.viscosity !== undefined && Number.isFinite(overlayConfig.viscosity)
      ? overlayConfig.viscosity
      : null;
  return {
    active: intensity > 0,
    intensity,
    windSpeed: clampRaindropOverlayWindSpeed(windSource),
    streakDensity: clampRaindropOverlayStreakDensity(streakSource),
    sparkleGain: clampRaindropOverlaySparkleGain(sparkleSource),
    rippleScale: rippleScaleSource,
    dropSpeed: dropSpeedSource,
    viscosity: viscositySource,
  };
}

function resolveSnowOverlayResponse(precipitation) {
  const defaults = {
    active: false,
    mode: 'snow',
    intensity: 0,
    windSpeed: 0,
    streakDensity: clampRaindropOverlayStreakDensity(0.5),
    sparkleGain: clampRaindropOverlaySparkleGain(0.65),
    rippleScale: null,
    dropSpeed: null,
    viscosity: null,
    flakeDensity: 0,
    puffDensity: 0,
  };
  if (!precipitation) {
    return defaults;
  }
  const overlayConfig = precipitation.raindropOverlay ?? {};
  const rawIntensity = Number.isFinite(precipitation.intensity)
    ? Math.max(0, precipitation.intensity)
    : 0;
  const baseIntensitySource = rawIntensity > 0
    ? RAIN_OVERLAY_INTENSITY_MIN + Math.pow(rawIntensity, 0.78) * RAIN_OVERLAY_INTENSITY_SCALE
    : 0;
  const intensitySource = Number.isFinite(overlayConfig.intensity)
    ? overlayConfig.intensity
    : baseIntensitySource;
  const intensity = clampRaindropOverlayIntensity(intensitySource);
  const windSource =
    overlayConfig.windSpeed !== undefined
      ? overlayConfig.windSpeed
      : (rawIntensity > 0 ? Math.pow(rawIntensity, 0.72) * 0.95 : 0);
  const streakSource =
    overlayConfig.streakDensity !== undefined
      ? overlayConfig.streakDensity
      : 0.6 + Math.pow(rawIntensity, 0.8) * 0.95;
  const sparkleSource =
    overlayConfig.sparkleGain !== undefined
      ? overlayConfig.sparkleGain
      : 0.78 + Math.pow(rawIntensity, 0.7) * 0.32;
  const rippleScaleSource =
    overlayConfig.rippleScale !== undefined && Number.isFinite(overlayConfig.rippleScale)
      ? overlayConfig.rippleScale
      : 0.86 + Math.min(rawIntensity, 3.5) * 0.04;
  const dropSpeedSource =
    overlayConfig.dropSpeed !== undefined && Number.isFinite(overlayConfig.dropSpeed)
      ? overlayConfig.dropSpeed
      : 0.36 + rawIntensity * 0.18;
  const viscositySource =
    overlayConfig.viscosity !== undefined && Number.isFinite(overlayConfig.viscosity)
      ? overlayConfig.viscosity
      : Math.max(0.42, 0.9 - rawIntensity * 0.08);
  const flakeSource =
    overlayConfig.flakeDensity !== undefined && Number.isFinite(overlayConfig.flakeDensity)
      ? overlayConfig.flakeDensity
      : Math.max(0, 2 + rawIntensity * 2.4);
  const puffSource =
    overlayConfig.puffDensity !== undefined && Number.isFinite(overlayConfig.puffDensity)
      ? overlayConfig.puffDensity
      : Math.max(0, 1.2 + rawIntensity * 1.85);
  return {
    active: intensity > 0,
    mode: 'snow',
    intensity,
    windSpeed: clampRaindropOverlayWindSpeed(windSource),
    streakDensity: clampRaindropOverlayStreakDensity(streakSource),
    sparkleGain: clampRaindropOverlaySparkleGain(sparkleSource),
    rippleScale: rippleScaleSource,
    dropSpeed: dropSpeedSource,
    viscosity: viscositySource,
    flakeDensity: flakeSource,
    puffDensity: puffSource,
  };
}

export function createWeatherManager({
  scene,
  particleSystem,
  registerDiagnosticOverlay,
  useDomRaindropOverlay: useDomRaindropOverlayFlag,
  overlayControllerFactory = createWeatherOverlayController,
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
  const rotationHarnessState = {
    active: false,
    rotation: [],
    currentIndex: -1,
    pendingIndex: null,
    loop: true,
    cancelScheduled: null,
    nextChangeTime: null,
    nextWeatherId: null,
    biomeId: null,
    label: null,
    startedAt: null,
    lastIndex: -1,
    cycleCount: 0,
  };
  let diagnosticOverlayDisposer = null;
  const activeParticleEffects = [];
  const pendingPrecipitationRetries = [];
  let needsEffectRefresh = true;

  let overlayUi = null;
  let raindropOverlay = null;
  let raindropOverlayController = null;
  let raindropOverlayVisible = false;
  const raindropOverlayState = {
    baseActive: false,
    baseIntensity: 0,
    baseMode: 'rain',
    baseWindSpeed: DEFAULT_RAIN_OVERLAY_WIND_SPEED,
    baseStreakDensity: DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
    baseSparkleGain: DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
    baseRippleScale: null,
    baseDropSpeed: null,
    baseViscosity: null,
    baseFlakeDensity: 0,
    basePuffDensity: 0,
    manualEnabled: null,
    manualIntensity: null,
    manualWindSpeed: null,
    manualStreakDensity: null,
    manualSparkleGain: null,
    manualRippleScale: null,
    manualDropSpeed: null,
    manualViscosity: null,
  };

  let preferDomRaindropOverlay;
  if (useDomRaindropOverlayFlag === undefined) {
    preferDomRaindropOverlay = typeof document !== 'undefined';
  } else {
    preferDomRaindropOverlay = Boolean(useDomRaindropOverlayFlag);
  }

  const ensureRaindropOverlayController = () => {
    if (!preferDomRaindropOverlay) {
      return null;
    }
    if (typeof document === 'undefined') {
      preferDomRaindropOverlay = false;
      return null;
    }
    if (raindropOverlayController) {
      return raindropOverlayController;
    }
    try {
      raindropOverlayController = overlayControllerFactory();
    } catch (error) {
      console.warn('Failed to initialise weather overlay controller, falling back to shader:', error);
      preferDomRaindropOverlay = false;
      raindropOverlayController = null;
      return null;
    }
    return raindropOverlayController;
  };

  const resolveOverlayTargets = () => {
    const pickValue = (manualValue, baseValue, clampFn, fallback) => {
      if (manualValue === null || manualValue === undefined) {
        const source = Number.isFinite(baseValue) ? baseValue : fallback;
        return clampFn(source);
      }
      return clampFn(manualValue);
    };

    const intensitySource =
      raindropOverlayState.manualIntensity ?? raindropOverlayState.baseIntensity;
    const mode =
      typeof raindropOverlayState.baseMode === 'string'
        ? raindropOverlayState.baseMode
        : 'rain';
    const flakeDensity = Number.isFinite(raindropOverlayState.baseFlakeDensity)
      ? Math.max(0, raindropOverlayState.baseFlakeDensity)
      : 0;
    const puffDensity = Number.isFinite(raindropOverlayState.basePuffDensity)
      ? Math.max(0, raindropOverlayState.basePuffDensity)
      : 0;
    return {
      mode,
      intensity: clampRaindropOverlayIntensity(intensitySource),
      windSpeed: pickValue(
        raindropOverlayState.manualWindSpeed,
        raindropOverlayState.baseWindSpeed,
        clampRaindropOverlayWindSpeed,
        DEFAULT_RAIN_OVERLAY_WIND_SPEED,
      ),
      streakDensity: pickValue(
        raindropOverlayState.manualStreakDensity,
        raindropOverlayState.baseStreakDensity,
        clampRaindropOverlayStreakDensity,
        DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
      ),
      sparkleGain: pickValue(
        raindropOverlayState.manualSparkleGain,
        raindropOverlayState.baseSparkleGain,
        clampRaindropOverlaySparkleGain,
        DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
      ),
      rippleScale:
        raindropOverlayState.manualRippleScale ?? raindropOverlayState.baseRippleScale ?? null,
      dropSpeed:
        raindropOverlayState.manualDropSpeed ?? raindropOverlayState.baseDropSpeed ?? null,
      viscosity:
        raindropOverlayState.manualViscosity ?? raindropOverlayState.baseViscosity ?? null,
      flakeDensity,
      puffDensity,
    };
  };

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
    if (!Number.isFinite(state.precipitationRecoveryAttempts)) {
      state.precipitationRecoveryAttempts = 0;
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
    if (!Array.isArray(state.precipitationEmitters)) {
      state.precipitationEmitters = [];
    }
    if (!Number.isFinite(state.precipitationActiveCount)) {
      state.precipitationActiveCount = 0;
    }
    if (!Number.isFinite(state.precipitationActiveParticles)) {
      state.precipitationActiveParticles = 0;
    }
    if (!state.raindropOverlay) {
      state.raindropOverlay = {
        baseActive: false,
        baseIntensity: 0,
        baseMode: 'rain',
        baseWindSpeed: DEFAULT_RAIN_OVERLAY_WIND_SPEED,
        baseStreakDensity: DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
        baseSparkleGain: DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
        baseRippleScale: null,
        baseDropSpeed: null,
        baseViscosity: null,
        baseFlakeDensity: 0,
        basePuffDensity: 0,
        manualEnabled: null,
        manualIntensity: null,
        manualWindSpeed: null,
        manualStreakDensity: null,
        manualSparkleGain: null,
        manualRippleScale: null,
        manualDropSpeed: null,
        manualViscosity: null,
        enabled: false,
        intensity: 0,
        mode: 'rain',
        windSpeed: DEFAULT_RAIN_OVERLAY_WIND_SPEED,
        streakDensity: DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
        sparkleGain: DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
        rippleScale: null,
        dropSpeed: null,
        viscosity: null,
        visible: false,
        flakeDensity: 0,
        puffDensity: 0,
      };
    }
    if (!Array.isArray(state.pendingPrecipitationRetries)) {
      state.pendingPrecipitationRetries = [];
    }
    if (!state.precipitationLayers) {
      state.precipitationLayers = { primary: null, splash: null };
    }
    if (!state.manualOverrides) {
      state.manualOverrides = {};
    }
    if (!state.manualOverrides.precipitation) {
      state.manualOverrides.precipitation = {};
    }
    const precipitationOverrides = state.manualOverrides.precipitation;
    if (!('intensity' in precipitationOverrides)) {
      precipitationOverrides.intensity = null;
    }
    if (!('windTilt' in precipitationOverrides)) {
      precipitationOverrides.windTilt = null;
    }
    if (!('streakNoise' in precipitationOverrides)) {
      precipitationOverrides.streakNoise = null;
    }
    if (!('highlightWidth' in precipitationOverrides)) {
      precipitationOverrides.highlightWidth = null;
    }
    if (!('rippleScale' in precipitationOverrides)) {
      precipitationOverrides.rippleScale = null;
    }
    if (!('radius' in precipitationOverrides)) {
      precipitationOverrides.radius = null;
    }
    if (!('dropSpeed' in precipitationOverrides)) {
      precipitationOverrides.dropSpeed =
        precipitationOverrides.dropDensity !== undefined
          ? precipitationOverrides.dropDensity
          : null;
    }
    if (!('viscosity' in precipitationOverrides)) {
      precipitationOverrides.viscosity =
        precipitationOverrides.timerBias !== undefined
          ? precipitationOverrides.timerBias
          : null;
    }
    if (!('shader' in precipitationOverrides)) {
      precipitationOverrides.shader = null;
    }
    if (!state.rotationHarness) {
      state.rotationHarness = {
        active: false,
        biomeId: null,
        label: null,
        index: null,
        size: 0,
        nextWeatherId: null,
        nextChangeTime: null,
        remaining: null,
        cycleCount: 0,
      };
    }
    return state;
  };

  const updateRaindropOverlayMetadata = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const overlay = state.raindropOverlay || (state.raindropOverlay = {});
    const targetIntensity = clampRaindropOverlayIntensity(
      raindropOverlayState.manualIntensity ?? raindropOverlayState.baseIntensity,
    );
    const manualEnabled = raindropOverlayState.manualEnabled;
    const baseActive = raindropOverlayState.baseActive;
    overlay.baseActive = baseActive;
    overlay.baseIntensity = raindropOverlayState.baseIntensity;
    overlay.baseMode = raindropOverlayState.baseMode;
    overlay.baseWindSpeed = raindropOverlayState.baseWindSpeed;
    overlay.baseStreakDensity = raindropOverlayState.baseStreakDensity;
    overlay.baseSparkleGain = raindropOverlayState.baseSparkleGain;
    overlay.baseRippleScale = raindropOverlayState.baseRippleScale;
    overlay.baseDropSpeed = raindropOverlayState.baseDropSpeed;
    overlay.baseViscosity = raindropOverlayState.baseViscosity;
    overlay.baseFlakeDensity = raindropOverlayState.baseFlakeDensity;
    overlay.basePuffDensity = raindropOverlayState.basePuffDensity;
    overlay.manualEnabled = manualEnabled;
    overlay.manualIntensity = raindropOverlayState.manualIntensity;
    overlay.manualWindSpeed = raindropOverlayState.manualWindSpeed;
    overlay.manualStreakDensity = raindropOverlayState.manualStreakDensity;
    overlay.manualSparkleGain = raindropOverlayState.manualSparkleGain;
    overlay.manualRippleScale = raindropOverlayState.manualRippleScale;
    overlay.manualDropSpeed = raindropOverlayState.manualDropSpeed;
    overlay.manualViscosity = raindropOverlayState.manualViscosity;
    const targets = resolveOverlayTargets();
    overlay.enabled = Boolean((manualEnabled ?? baseActive) && targets.intensity > 0);
    overlay.mode = targets.mode;
    overlay.intensity = raindropOverlay?.getIntensity?.() ?? targets.intensity;
    overlay.windSpeed = raindropOverlay?.getWindSpeed?.() ?? targets.windSpeed;
    overlay.streakDensity =
      raindropOverlay?.getStreakDensity?.() ?? targets.streakDensity;
    overlay.sparkleGain =
      raindropOverlay?.getSparkleGain?.() ?? targets.sparkleGain;
    overlay.rippleScale = targets.rippleScale;
    overlay.dropSpeed = targets.dropSpeed;
    overlay.viscosity = targets.viscosity;
    overlay.flakeDensity = targets.flakeDensity;
    overlay.puffDensity = targets.puffDensity;
    overlay.visible = Boolean(raindropOverlayVisible);
  };

  const getManualPrecipitationOverrides = () => {
    const state = ensureWeatherState();
    if (!state) {
      return null;
    }
    const overrides = state.manualOverrides?.precipitation ?? null;
    if (!overrides) {
      return null;
    }
    const normalise = (value) => {
      if (Number.isFinite(value)) {
        return Number(value);
      }
      if (value === null) {
        return null;
      }
      return undefined;
    };
    const pickValue = (primaryKey, fallbackKey) => {
      if (primaryKey && overrides[primaryKey] !== undefined) {
        return normalise(overrides[primaryKey]);
      }
      if (fallbackKey && overrides[fallbackKey] !== undefined) {
        return normalise(overrides[fallbackKey]);
      }
      return undefined;
    };
    const shaderOverride = (() => {
      if (overrides.shader !== undefined) {
        return normalisePrecipitationShaderValue(overrides.shader);
      }
      if (overrides.useBrightStreakShader !== undefined) {
        return normalisePrecipitationShaderValue(overrides.useBrightStreakShader);
      }
      return undefined;
    })();
    return {
      intensity: pickValue('intensity'),
      radius: pickValue('radius'),
      windTilt: pickValue('windTilt'),
      streakNoise: pickValue('streakNoise'),
      highlightWidth: pickValue('highlightWidth'),
      rippleScale: pickValue('rippleScale'),
      dropSpeed: pickValue('dropSpeed', 'dropDensity'),
      viscosity: pickValue('viscosity', 'timerBias'),
      shader: shaderOverride,
    };
  };

  const ensureShaderRaindropOverlayEffect = (targets) => {
    if (raindropOverlay || !scene) {
      if (raindropOverlay && targets) {
        raindropOverlay.setIntensity(targets.intensity);
        raindropOverlay.setWindSpeed(targets.windSpeed);
        raindropOverlay.setStreakDensity(targets.streakDensity);
        raindropOverlay.setSparkleGain(targets.sparkleGain);
      }
      return raindropOverlay;
    }
    const overlay = createRaindropOverlay({
      intensity: targets?.intensity,
      windSpeed: targets?.windSpeed,
      streakDensity: targets?.streakDensity,
      sparkleGain: targets?.sparkleGain,
    });
    if (!overlay?.mesh) {
      return null;
    }
    overlay.mesh.visible = true;
    scene.add(overlay.mesh);
    raindropOverlay = overlay;
    raindropOverlayVisible = true;
    updateRaindropOverlayMetadata();
    return raindropOverlay;
  };

  const hideRaindropOverlayController = () => {
    if (!raindropOverlayController) {
      return;
    }
    try {
      raindropOverlayController.setIntensity?.(0);
      raindropOverlayController.setDropletDensity?.(0);
      raindropOverlayController.setSnowflakeDensity?.(0);
      raindropOverlayController.setSnowpuffDensity?.(0);
      raindropOverlayController.setVelocity?.(null);
    } catch (error) {
      console.warn('Failed to reset weather overlay controller state:', error);
    }
    if (raindropOverlayController.element) {
      raindropOverlayController.element.setAttribute('aria-hidden', 'true');
      raindropOverlayController.element.hidden = true;
      raindropOverlayController.element.style.display = 'none';
    }
  };

  const disposeRaindropOverlayEffect = () => {
    if (raindropOverlayController) {
      hideRaindropOverlayController();
      try {
        raindropOverlayController.dispose();
      } catch (error) {
        console.warn('Failed to dispose weather overlay controller:', error);
      }
      raindropOverlayController = null;
    }
    if (!raindropOverlay) {
      raindropOverlayVisible = false;
      updateRaindropOverlayMetadata();
      return;
    }
    try {
      raindropOverlay.dispose();
    } catch (error) {
      console.warn('Failed to dispose raindrop overlay effect:', error);
    }
    raindropOverlay = null;
    raindropOverlayVisible = false;
    updateRaindropOverlayMetadata();
  };

  const syncRaindropOverlay = () => {
    const manualEnabled = raindropOverlayState.manualEnabled;
    const baseActive = raindropOverlayState.baseActive;
    const shouldShow = manualEnabled !== null ? manualEnabled : baseActive;
    const targets = resolveOverlayTargets();
    if (!shouldShow || targets.intensity <= 0) {
      if (raindropOverlayController) {
        hideRaindropOverlayController();
      }
      if (raindropOverlay) {
        disposeRaindropOverlayEffect();
      }
      raindropOverlayVisible = false;
      updateRaindropOverlayMetadata();
      return;
    }
    const controller = ensureRaindropOverlayController();
    if (controller) {
      controller.setMode?.(targets.mode ?? 'rain');
      controller.setIntensity?.(targets.intensity);
      controller.setWindSway?.(targets.windSpeed);
      if ((targets.mode ?? 'rain') === 'snow') {
        controller.setDropletDensity?.(0);
        controller.setSnowflakeDensity?.(targets.flakeDensity ?? 0);
        controller.setSnowpuffDensity?.(targets.puffDensity ?? 0);
      } else {
        controller.setDropletDensity?.(targets.streakDensity);
        controller.setSnowflakeDensity?.(0);
        controller.setSnowpuffDensity?.(0);
      }
      controller.setVelocity?.(targets.dropSpeed ?? null);
      if (controller.element) {
        controller.element.setAttribute('aria-hidden', 'false');
        controller.element.hidden = false;
        controller.element.style.display = '';
      }
      raindropOverlayVisible = true;
      updateRaindropOverlayMetadata();
      return;
    }
    const overlay = ensureShaderRaindropOverlayEffect(targets);
    if (overlay) {
      overlay.setIntensity(targets.intensity);
      overlay.setWindSpeed(targets.windSpeed);
      overlay.setStreakDensity(targets.streakDensity);
      overlay.setSparkleGain(targets.sparkleGain);
      if (overlay.mesh) {
        overlay.mesh.visible = true;
      }
      raindropOverlayVisible = true;
    }
    updateRaindropOverlayMetadata();
  };

  const setRaindropOverlayBaseState = ({
    active,
    intensity,
    mode,
    windSpeed,
    streakDensity,
    sparkleGain,
    rippleScale,
    dropSpeed,
    viscosity,
    flakeDensity,
    puffDensity,
  }) => {
    const nextActive = Boolean(active);
    const nextIntensity = Number.isFinite(intensity)
      ? clampRaindropOverlayIntensity(intensity)
      : 0;
    const nextMode = typeof mode === 'string' && mode ? mode : 'rain';
    const nextWindSpeed = Number.isFinite(windSpeed)
      ? clampRaindropOverlayWindSpeed(windSpeed)
      : DEFAULT_RAIN_OVERLAY_WIND_SPEED;
    const nextStreakDensity = Number.isFinite(streakDensity)
      ? clampRaindropOverlayStreakDensity(streakDensity)
      : DEFAULT_RAIN_OVERLAY_STREAK_DENSITY;
    const nextSparkleGain = Number.isFinite(sparkleGain)
      ? clampRaindropOverlaySparkleGain(sparkleGain)
      : DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN;
    const resolveOptionalNumber = (value, currentValue) => {
      if (value === undefined) {
        return currentValue;
      }
      if (value === null) {
        return null;
      }
      return Number.isFinite(value) ? Number(value) : currentValue ?? null;
    };
    const nextRippleScale = resolveOptionalNumber(rippleScale, raindropOverlayState.baseRippleScale);
    const nextDropSpeed = resolveOptionalNumber(dropSpeed, raindropOverlayState.baseDropSpeed);
    const nextViscosity = resolveOptionalNumber(viscosity, raindropOverlayState.baseViscosity);
    const resolveDensity = (value) => {
      if (!Number.isFinite(value)) {
        return 0;
      }
      return Math.max(0, Number(value));
    };
    const nextFlakeDensity = resolveDensity(flakeDensity);
    const nextPuffDensity = resolveDensity(puffDensity);
    if (
      raindropOverlayState.baseActive === nextActive &&
      raindropOverlayState.baseIntensity === nextIntensity &&
      raindropOverlayState.baseMode === nextMode &&
      raindropOverlayState.baseWindSpeed === nextWindSpeed &&
      raindropOverlayState.baseStreakDensity === nextStreakDensity &&
      raindropOverlayState.baseSparkleGain === nextSparkleGain &&
      raindropOverlayState.baseRippleScale === nextRippleScale &&
      raindropOverlayState.baseDropSpeed === nextDropSpeed &&
      raindropOverlayState.baseViscosity === nextViscosity &&
      raindropOverlayState.baseFlakeDensity === nextFlakeDensity &&
      raindropOverlayState.basePuffDensity === nextPuffDensity &&
      raindropOverlayVisible === nextActive
    ) {
      return;
    }
    raindropOverlayState.baseActive = nextActive;
    raindropOverlayState.baseIntensity = nextIntensity;
    raindropOverlayState.baseMode = nextMode;
    raindropOverlayState.baseWindSpeed = nextWindSpeed;
    raindropOverlayState.baseStreakDensity = nextStreakDensity;
    raindropOverlayState.baseSparkleGain = nextSparkleGain;
    raindropOverlayState.baseRippleScale = nextRippleScale;
    raindropOverlayState.baseDropSpeed = nextDropSpeed;
    raindropOverlayState.baseViscosity = nextViscosity;
    raindropOverlayState.baseFlakeDensity = nextFlakeDensity;
    raindropOverlayState.basePuffDensity = nextPuffDensity;
    syncRaindropOverlay();
  };

  const setRaindropOverlayManualEnabled = (value) => {
    const next = value === null || value === undefined ? null : Boolean(value);
    if (raindropOverlayState.manualEnabled === next) {
      return;
    }
    raindropOverlayState.manualEnabled = next;
    syncRaindropOverlay();
  };

  const setRaindropOverlayManualIntensity = (value) => {
    let next = null;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      next = clampRaindropOverlayIntensity(numeric);
    }
    if (raindropOverlayState.manualIntensity === next) {
      return;
    }
    raindropOverlayState.manualIntensity = next;
    syncRaindropOverlay();
  };

  const setRaindropOverlayManualWindSpeed = (value) => {
    let next = null;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      next = clampRaindropOverlayWindSpeed(numeric);
    }
    if (raindropOverlayState.manualWindSpeed === next) {
      return;
    }
    raindropOverlayState.manualWindSpeed = next;
    syncRaindropOverlay();
  };

  const setRaindropOverlayManualStreakDensity = (value) => {
    let next = null;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      next = clampRaindropOverlayStreakDensity(numeric);
    }
    if (raindropOverlayState.manualStreakDensity === next) {
      return;
    }
    raindropOverlayState.manualStreakDensity = next;
    syncRaindropOverlay();
  };

  const setRaindropOverlayManualSparkleGain = (value) => {
    let next = null;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      next = clampRaindropOverlaySparkleGain(numeric);
    }
    if (raindropOverlayState.manualSparkleGain === next) {
      return;
    }
    raindropOverlayState.manualSparkleGain = next;
    syncRaindropOverlay();
  };

  const getRaindropOverlayState = () => {
    const manualEnabled = raindropOverlayState.manualEnabled;
    const baseActive = raindropOverlayState.baseActive;
    const targets = resolveOverlayTargets();
    const intensity = raindropOverlay?.getIntensity?.() ?? targets.intensity;
    const windSpeed = raindropOverlay?.getWindSpeed?.() ?? targets.windSpeed;
    const streakDensity = raindropOverlay?.getStreakDensity?.() ?? targets.streakDensity;
    const sparkleGain = raindropOverlay?.getSparkleGain?.() ?? targets.sparkleGain;
    return {
      enabled: Boolean((manualEnabled ?? baseActive) && intensity > 0),
      visible: Boolean(raindropOverlayVisible),
      intensity,
      windSpeed,
      streakDensity,
      sparkleGain,
      rippleScale: targets.rippleScale,
      dropSpeed: targets.dropSpeed,
      viscosity: targets.viscosity,
      baseActive,
      baseIntensity: raindropOverlayState.baseIntensity,
      baseWindSpeed: raindropOverlayState.baseWindSpeed,
      baseStreakDensity: raindropOverlayState.baseStreakDensity,
      baseSparkleGain: raindropOverlayState.baseSparkleGain,
      baseRippleScale: raindropOverlayState.baseRippleScale,
      baseDropSpeed: raindropOverlayState.baseDropSpeed,
      baseViscosity: raindropOverlayState.baseViscosity,
      manualEnabled,
      manualIntensity: raindropOverlayState.manualIntensity,
      manualWindSpeed: raindropOverlayState.manualWindSpeed,
      manualStreakDensity: raindropOverlayState.manualStreakDensity,
      manualSparkleGain: raindropOverlayState.manualSparkleGain,
      manualRippleScale: raindropOverlayState.manualRippleScale,
      manualDropSpeed: raindropOverlayState.manualDropSpeed,
      manualViscosity: raindropOverlayState.manualViscosity,
    };
  };

  const syncPrecipitationLayerState = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const layers = state.precipitationLayers || (state.precipitationLayers = {
      primary: null,
      splash: null,
    });
    const primaryAttachment = activeParticleEffects.find(
      (attachment) => attachment.type === 'precipitation',
    );
    if (primaryAttachment) {
      const { emitter, appliedIntensity, spawnConfig, anchorOffsetY } = primaryAttachment;
      layers.primary = {
        label: emitter?.debugLabel ?? 'WeatherPrecipitationEmitter',
        shader: emitter?.usesBrightStreakShader ? 'bright' : 'billboard',
        intensity: Number.isFinite(appliedIntensity)
          ? appliedIntensity
          : Number.isFinite(spawnConfig?.intensity)
          ? spawnConfig.intensity
          : null,
        radius: Number.isFinite(spawnConfig?.radius) ? spawnConfig.radius : null,
        heightOffset: Number.isFinite(anchorOffsetY) ? anchorOffsetY : null,
      };
    } else {
      layers.primary = null;
    }
    const splashAttachment = activeParticleEffects.find(
      (attachment) => attachment.type === 'precipitation_splash',
    );
    if (splashAttachment) {
      const { emitter, spawnConfig, anchorOffsetY } = splashAttachment;
      layers.splash = {
        label: emitter?.debugLabel ?? 'WeatherRainSplashEmitter',
        intensity: Number.isFinite(spawnConfig?.intensity) ? spawnConfig.intensity : null,
        radius: Number.isFinite(spawnConfig?.radius) ? spawnConfig.radius : null,
        heightOffset: Number.isFinite(anchorOffsetY) ? anchorOffsetY : null,
      };
    } else {
      layers.splash = null;
    }
  };

  const syncEmitterState = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    state.activeEmitterCount = activeParticleEffects.length;
    let auroraCount = 0;
    let minForwardOffset = null;
    let maxForwardOffset = null;
    let minAnchorHeight = null;
    let maxAnchorHeight = null;
    for (const attachment of activeParticleEffects) {
      if (attachment.type !== 'aurora') {
        continue;
      }
      auroraCount += 1;
      if (Number.isFinite(attachment.forwardOffset)) {
        minForwardOffset =
          minForwardOffset === null
            ? attachment.forwardOffset
            : Math.min(minForwardOffset, attachment.forwardOffset);
        maxForwardOffset =
          maxForwardOffset === null
            ? attachment.forwardOffset
            : Math.max(maxForwardOffset, attachment.forwardOffset);
      }
      if (Number.isFinite(attachment.anchorOffsetY)) {
        minAnchorHeight =
          minAnchorHeight === null
            ? attachment.anchorOffsetY
            : Math.min(minAnchorHeight, attachment.anchorOffsetY);
        maxAnchorHeight =
          maxAnchorHeight === null
            ? attachment.anchorOffsetY
            : Math.max(maxAnchorHeight, attachment.anchorOffsetY);
      }
    }
    state.auroraActiveCount = auroraCount;
    state.auroraForwardOffsetRange =
      auroraCount > 0 && minForwardOffset !== null && maxForwardOffset !== null
        ? { min: minForwardOffset, max: maxForwardOffset }
        : null;
    state.auroraAnchorHeightRange =
      auroraCount > 0 && minAnchorHeight !== null && maxAnchorHeight !== null
        ? { min: minAnchorHeight, max: maxAnchorHeight }
        : null;
    if (state.activeEmitterCount === 0) {
      state.totalActiveParticles = 0;
    }
    syncPrecipitationLayerState();
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

  const recordPrecipitationFailure = ({ type, elapsedTime, reason }) => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const previousFailures = Number.isFinite(state.failedPrecipitationSpawns)
      ? state.failedPrecipitationSpawns
      : 0;
    state.failedPrecipitationSpawns = previousFailures + 1;
    state.lastPrecipitationFailure = {
      type,
      elapsedTime: Number.isFinite(elapsedTime) ? elapsedTime : null,
      reason: reason ?? null,
    };
  };

  const syncPendingPrecipitationRetries = (now = lastElapsedTime) => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const resolvedNow = Number.isFinite(now)
      ? now
      : Number.isFinite(lastElapsedTime)
      ? lastElapsedTime
      : null;
    const maxAttempts = PRECIPITATION_SPAWN_MAX_RETRIES + 1;
    state.pendingPrecipitationRetries = pendingPrecipitationRetries.map((entry) => {
      const attemptIndex = Number.isFinite(entry.attempt) ? entry.attempt : 0;
      const retryAt = Number.isFinite(entry.readyTime) ? entry.readyTime : null;
      const nextRetryIn =
        Number.isFinite(retryAt) && Number.isFinite(resolvedNow)
          ? Math.max(0, retryAt - resolvedNow)
          : null;
      return {
        type: entry.config?.type ?? 'precipitation',
        attempt: attemptIndex + 1,
        attemptIndex,
        maxAttempts,
        reason: entry.reason ?? null,
        scheduledAt: Number.isFinite(entry.scheduledAt) ? entry.scheduledAt : null,
        retryAt,
        nextRetryIn,
      };
    });
  };

  const clearPendingPrecipitationRetries = (now = lastElapsedTime) => {
    pendingPrecipitationRetries.length = 0;
    syncPendingPrecipitationRetries(now);
  };

  const queuePrecipitationRetry = ({
    config,
    attempt,
    readyTime,
    reason,
    elapsedTime,
  }) => {
    const entry = {
      config: { ...(config ?? {}) },
      attempt: Number.isFinite(attempt) ? attempt : 0,
      readyTime: Number.isFinite(readyTime)
        ? readyTime
        : (Number.isFinite(elapsedTime) ? elapsedTime : 0) + PRECIPITATION_HANDLE_RECHECK_INTERVAL,
      reason: reason ?? null,
      scheduledAt: Number.isFinite(elapsedTime) ? elapsedTime : null,
    };
    pendingPrecipitationRetries.push(entry);
    const state = ensureWeatherState();
    if (state) {
      const previousRecoveries = Number.isFinite(state.precipitationRecoveryAttempts)
        ? state.precipitationRecoveryAttempts
        : 0;
      state.precipitationRecoveryAttempts = previousRecoveries + 1;
    }
    syncPendingPrecipitationRetries(elapsedTime);
  };

  const processPendingPrecipitationRetries = (context) => {
    if (pendingPrecipitationRetries.length === 0) {
      syncPendingPrecipitationRetries(context?.elapsedTime);
      return;
    }
    const { elapsedTime = lastElapsedTime } = context ?? {};
    const now = Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime;
    if (!Number.isFinite(now)) {
      syncPendingPrecipitationRetries(now);
      return;
    }
    const readyEntries = [];
    for (let i = pendingPrecipitationRetries.length - 1; i >= 0; i -= 1) {
      const entry = pendingPrecipitationRetries[i];
      const readyTime = Number.isFinite(entry.readyTime) ? entry.readyTime : Number.POSITIVE_INFINITY;
      if (now >= readyTime) {
        pendingPrecipitationRetries.splice(i, 1);
        readyEntries.unshift(entry);
      }
    }
    syncPendingPrecipitationRetries(now);
    if (readyEntries.length === 0) {
      return;
    }
    readyEntries.forEach((entry) => {
      spawnPrecipitationEffect(entry.config, context, entry.attempt);
    });
  };

  const clearScheduledTransitionsByTag = (tag) => {
    for (let i = scheduledTransitions.length - 1; i >= 0; i -= 1) {
      if (scheduledTransitions[i]?.tag === tag) {
        scheduledTransitions.splice(i, 1);
      }
    }
  };

  const computeHarnessDurationSeconds = (entry) => {
    if (!entry) {
      return DEFAULT_BIOME_WEATHER_DURATION.min;
    }
    const duration = entry.duration ?? {};
    const rawMin = Number.isFinite(duration.min)
      ? duration.min
      : DEFAULT_BIOME_WEATHER_DURATION.min;
    const rawMax = Number.isFinite(duration.max) ? duration.max : rawMin;
    const min = Math.max(MIN_WEATHER_DURATION_SECONDS, rawMin);
    const max = Math.max(min, rawMax);
    if (max <= min) {
      return min;
    }
    return min + Math.random() * (max - min);
  };

  const syncRotationHarnessState = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const harness = state.rotationHarness || {};
    const now = Number.isFinite(lastElapsedTime) ? lastElapsedTime : null;
    harness.active = rotationHarnessState.active;
    harness.biomeId = rotationHarnessState.biomeId;
    harness.label = rotationHarnessState.label;
    harness.index = rotationHarnessState.currentIndex;
    harness.size = rotationHarnessState.rotation.length;
    harness.nextWeatherId = rotationHarnessState.nextWeatherId;
    harness.nextChangeTime = rotationHarnessState.nextChangeTime;
    harness.remaining =
      Number.isFinite(rotationHarnessState.nextChangeTime) && Number.isFinite(now)
        ? Math.max(0, rotationHarnessState.nextChangeTime - now)
        : null;
    harness.cycleCount = rotationHarnessState.cycleCount;
    harness.startedAt = rotationHarnessState.startedAt;
    harness.pendingIndex = rotationHarnessState.pendingIndex;
    state.rotationHarness = harness;
  };

  const stopRotationHarness = () => {
    if (rotationHarnessState.cancelScheduled) {
      try {
        rotationHarnessState.cancelScheduled();
      } catch (error) {
        console.warn('Failed to cancel weather rotation harness schedule:', error);
      }
      rotationHarnessState.cancelScheduled = null;
    }
    clearScheduledTransitionsByTag(ROTATION_HARNESS_TAG);
    const wasActive = rotationHarnessState.active;
    rotationHarnessState.active = false;
    rotationHarnessState.rotation = [];
    rotationHarnessState.currentIndex = -1;
    rotationHarnessState.pendingIndex = null;
    rotationHarnessState.loop = true;
    rotationHarnessState.nextChangeTime = null;
    rotationHarnessState.nextWeatherId = null;
    rotationHarnessState.biomeId = null;
    rotationHarnessState.label = null;
    rotationHarnessState.startedAt = null;
    rotationHarnessState.lastIndex = -1;
    rotationHarnessState.cycleCount = 0;
    syncRotationHarnessState();
    return wasActive;
  };

  const scheduleHarnessNext = ({ index, now }) => {
    if (!rotationHarnessState.active || rotationHarnessState.rotation.length === 0) {
      rotationHarnessState.nextChangeTime = null;
      rotationHarnessState.nextWeatherId = null;
      rotationHarnessState.pendingIndex = null;
      if (rotationHarnessState.cancelScheduled) {
        try {
          rotationHarnessState.cancelScheduled();
        } catch (error) {
          console.warn('Failed to cancel stale weather harness schedule:', error);
        }
        rotationHarnessState.cancelScheduled = null;
      }
      syncRotationHarnessState();
      return;
    }
    const rotation = rotationHarnessState.rotation;
    const currentEntry = rotation[index];
    if (!currentEntry) {
      stopRotationHarness();
      return;
    }
    const nextIndexRaw = index + 1;
    const hasNext = nextIndexRaw < rotation.length;
    if (!hasNext && !rotationHarnessState.loop) {
      rotationHarnessState.nextChangeTime = null;
      rotationHarnessState.nextWeatherId = null;
      rotationHarnessState.pendingIndex = null;
      if (rotationHarnessState.cancelScheduled) {
        try {
          rotationHarnessState.cancelScheduled();
        } catch (error) {
          console.warn('Failed to cancel terminal weather harness schedule:', error);
        }
        rotationHarnessState.cancelScheduled = null;
      }
      syncRotationHarnessState();
      return;
    }
    const resolvedIndex = hasNext ? nextIndexRaw : 0;
    const nextEntry = rotation[resolvedIndex];
    if (!nextEntry) {
      stopRotationHarness();
      return;
    }
    const baseTime = Number.isFinite(now) ? now : 0;
    const durationSeconds = computeHarnessDurationSeconds(currentEntry);
    const triggerTime = baseTime + durationSeconds;
    rotationHarnessState.nextChangeTime = triggerTime;
    rotationHarnessState.nextWeatherId = nextEntry.id;
    rotationHarnessState.pendingIndex = resolvedIndex;
    if (rotationHarnessState.cancelScheduled) {
      try {
        rotationHarnessState.cancelScheduled();
      } catch (error) {
        console.warn('Failed to cancel previous weather harness schedule:', error);
      }
      rotationHarnessState.cancelScheduled = null;
    }
    rotationHarnessState.cancelScheduled = scheduleWeatherChange({
      weatherId: nextEntry.id,
      triggerTime,
      options: {
        metadata: {
          source: ROTATION_HARNESS_TAG,
          rotationIndex: resolvedIndex,
          biomeId: rotationHarnessState.biomeId ?? null,
          harnessLabel: rotationHarnessState.label ?? null,
        },
      },
      tag: ROTATION_HARNESS_TAG,
    });
    syncRotationHarnessState();
  };

  const handleRotationHarnessWeatherApplied = (weather) => {
    if (!rotationHarnessState.active || !weather?.id) {
      return;
    }
    const rotation = rotationHarnessState.rotation;
    if (rotation.length === 0) {
      stopRotationHarness();
      return;
    }
    const index = rotation.findIndex((entry) => entry.id === weather.id);
    if (index === -1) {
      stopRotationHarness();
      return;
    }
    const now = Number.isFinite(lastElapsedTime) ? lastElapsedTime : 0;
    if (rotationHarnessState.lastIndex !== -1 && index === 0 && rotationHarnessState.lastIndex !== 0) {
      rotationHarnessState.cycleCount += 1;
    }
    rotationHarnessState.currentIndex = index;
    rotationHarnessState.lastIndex = index;
    rotationHarnessState.pendingIndex = null;
    rotationHarnessState.startedAt = rotationHarnessState.startedAt ?? now;
    scheduleHarnessNext({ index, now });
  };

  const startRotationHarness = ({
    rotation = [],
    biomeId = null,
    label = null,
    loop = true,
  } = {}) => {
    const source = Array.isArray(rotation) ? rotation : [];
    const resolved = source
      .map((entry) => {
        if (!entry?.id) {
          return null;
        }
        if (!weatherPresets.has(entry.id)) {
          return null;
        }
        const duration = cloneWeatherDuration(entry.duration, DEFAULT_BIOME_WEATHER_DURATION);
        return { id: String(entry.id), duration };
      })
      .filter(Boolean);
    if (resolved.length === 0) {
      console.warn('Weather rotation harness was asked to start with no valid presets.');
      stopRotationHarness();
      return getRotationHarnessStatus();
    }
    stopRotationHarness();
    rotationHarnessState.active = true;
    rotationHarnessState.rotation = resolved;
    rotationHarnessState.loop = loop !== false;
    rotationHarnessState.biomeId = biomeId ?? null;
    rotationHarnessState.label = label ?? null;
    rotationHarnessState.startedAt = Number.isFinite(lastElapsedTime) ? lastElapsedTime : 0;
    rotationHarnessState.currentIndex = -1;
    rotationHarnessState.lastIndex = -1;
    rotationHarnessState.cycleCount = 0;
    rotationHarnessState.nextChangeTime = null;
    rotationHarnessState.nextWeatherId = null;
    rotationHarnessState.pendingIndex = 0;
    const firstEntry = resolved[0];
    if (firstEntry) {
      if (activeWeather?.id === firstEntry.id) {
        handleRotationHarnessWeatherApplied({ id: firstEntry.id });
      } else {
        setWeather(firstEntry.id, {
          metadata: {
            harnessInitiator: true,
            harnessLabel: rotationHarnessState.label ?? null,
            biomeId: rotationHarnessState.biomeId ?? null,
          },
        });
      }
    }
    syncRotationHarnessState();
    return getRotationHarnessStatus();
  };

  const getRotationHarnessStatus = () => ({
    active: rotationHarnessState.active,
    rotation: rotationHarnessState.rotation.map((entry) => ({
      id: entry.id,
      duration: { ...entry.duration },
    })),
    index: rotationHarnessState.currentIndex,
    nextWeatherId: rotationHarnessState.nextWeatherId,
    nextChangeTime: rotationHarnessState.nextChangeTime,
    loop: rotationHarnessState.loop,
    biomeId: rotationHarnessState.biomeId,
    label: rotationHarnessState.label,
    cycleCount: rotationHarnessState.cycleCount,
    pendingIndex: rotationHarnessState.pendingIndex,
  });

  const updateRotationHarnessTick = ({ elapsedTime }) => {
    if (rotationHarnessState.active && rotationHarnessState.rotation.length === 0) {
      stopRotationHarness();
      syncRotationHarnessState();
      return;
    }
    if (
      rotationHarnessState.active &&
      rotationHarnessState.currentIndex >= 0 &&
      rotationHarnessState.pendingIndex !== null &&
      !rotationHarnessState.cancelScheduled &&
      rotationHarnessState.nextWeatherId
    ) {
      scheduleHarnessNext({
        index: rotationHarnessState.currentIndex,
        now: Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime,
      });
    }
    syncRotationHarnessState();
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
    const resolvedAurora = normaliseAuroraEffect(weather, resolvedEffects.aurora);
    weatherState.aurora = Boolean(resolvedAurora);
    weatherState.auroraRibbonConfig = resolvedAurora
      ? {
          count: resolvedAurora.count,
          layers: resolvedAurora.layers ?? 1,
          intensity: resolvedAurora.intensity,
          span: resolvedAurora.span,
          forwardOffset: resolvedAurora.forwardOffset,
          lateralOffset: resolvedAurora.lateralOffset,
        }
      : null;
    weatherState.auroraActiveCount = resolvedAurora ? weatherState.auroraActiveCount ?? 0 : 0;

  };

  const stopAttachmentHandle = (attachment) => {
    if (!attachment) {
      return;
    }
    try {
      attachment.handle?.stop?.();
    } catch (error) {
      console.warn('Failed to dispose weather particle handle:', error);
    }
  };

  const removeAttachment = (attachment) => {
    const index = activeParticleEffects.indexOf(attachment);
    if (index >= 0) {
      activeParticleEffects.splice(index, 1);
    }
    syncEmitterState();
  };

  const stopLinkedPrecipitationAttachments = (source) => {
    if (!source?.precipitationGroup) {
      return;
    }
    for (let i = activeParticleEffects.length - 1; i >= 0; i -= 1) {
      const attachment = activeParticleEffects[i];
      if (attachment === source) {
        continue;
      }
      if (attachment.precipitationGroup !== source.precipitationGroup) {
        continue;
      }
      stopAttachmentHandle(attachment);
      activeParticleEffects.splice(i, 1);
    }
    syncEmitterState();
  };

  const disposeWeatherEffects = () => {
    for (const attachment of activeParticleEffects) {
      stopAttachmentHandle(attachment);
    }
    activeParticleEffects.length = 0;
    disposeRaindropOverlayEffect();
    syncEmitterState();
    clearPendingPrecipitationRetries();
  };

  const spawnPrecipitationEffect = (config, context, attempt = 0) => {
    if (!particleSystem || typeof particleSystem.emit !== 'function') {
      return;
    }
    const manualOverrides = getManualPrecipitationOverrides();
    const intensityOverride = manualOverrides?.intensity;
    const radiusOverride = manualOverrides?.radius;
    const appliedIntensity = Number.isFinite(intensityOverride)
      ? intensityOverride
      : config.intensity;
    const appliedRadius = Number.isFinite(radiusOverride)
      ? Math.max(4, radiusOverride)
      : config.radius;
    const shaderOverride = manualOverrides?.shader;
    const hasAdvancedManualOverrides = [
      manualOverrides?.windTilt,
      manualOverrides?.streakNoise,
      manualOverrides?.highlightWidth,
      manualOverrides?.rippleScale,
      manualOverrides?.dropSpeed,
      manualOverrides?.viscosity,
    ].some((value) => value !== undefined && value !== null);
    const configShaderPreference = normalisePrecipitationShaderValue(config.shader);
    let useBrightStreakShader;
    if (configShaderPreference === 'bright') {
      useBrightStreakShader = true;
    } else if (configShaderPreference === 'billboard') {
      useBrightStreakShader = false;
    } else if (config.useBrightStreakShader === true) {
      useBrightStreakShader = true;
    } else if (config.useBrightStreakShader === false) {
      useBrightStreakShader = false;
    }
    if (shaderOverride === 'bright') {
      useBrightStreakShader = true;
    } else if (shaderOverride === 'billboard') {
      useBrightStreakShader = false;
    }
    if (useBrightStreakShader === undefined && hasAdvancedManualOverrides) {
      useBrightStreakShader = true;
    }
    const rainOptions = {
      intensity: appliedIntensity,
      radius: appliedRadius,
      heightOffset: config.anchorHeight,
    };
    if (useBrightStreakShader !== undefined) {
      rainOptions.useBrightStreakShader = useBrightStreakShader;
      rainOptions.shader = useBrightStreakShader ? 'bright' : 'billboard';
    }
    if (manualOverrides) {
      if (manualOverrides.windTilt !== undefined) {
        rainOptions.windTilt = manualOverrides.windTilt;
      }
      if (manualOverrides.streakNoise !== undefined) {
        rainOptions.streakNoise = manualOverrides.streakNoise;
      }
      if (manualOverrides.highlightWidth !== undefined) {
        rainOptions.highlightWidth = manualOverrides.highlightWidth;
      }
      if (manualOverrides.rippleScale !== undefined) {
        rainOptions.rippleScale = manualOverrides.rippleScale;
      }
      if (manualOverrides.dropSpeed !== undefined) {
        rainOptions.dropSpeed = manualOverrides.dropSpeed;
        rainOptions.dropDensity = manualOverrides.dropSpeed;
      }
      if (manualOverrides.viscosity !== undefined) {
        rainOptions.viscosity = manualOverrides.viscosity;
        rainOptions.timerBias = manualOverrides.viscosity;
      }
    }
    const emitter =
      config.type === 'snow'
        ? createWeatherSnowEmitter({
            intensity: appliedIntensity,
            radius: appliedRadius,
            heightOffset: config.anchorHeight,
          })
        : createWeatherRainEmitter(rainOptions);
    const spawnConfig = {
      ...config,
      intensity: appliedIntensity,
      radius: appliedRadius,
      shader:
        useBrightStreakShader === undefined
          ? config.shader ?? null
          : useBrightStreakShader
          ? 'bright'
          : 'billboard',
      useBrightStreakShader:
        useBrightStreakShader === undefined
          ? config.useBrightStreakShader
          : useBrightStreakShader,
    };
    const handle = particleSystem.emit(emitter);
    if (!handle) {
      const now = Number.isFinite(context?.elapsedTime)
        ? context.elapsedTime
        : Number.isFinite(lastElapsedTime)
        ? lastElapsedTime
        : null;
      recordPrecipitationFailure({
        type: config.type,
        elapsedTime: now,
        reason: 'no_handle',
      });
      const maxAttempts = PRECIPITATION_SPAWN_MAX_RETRIES + 1;
      if (attempt < PRECIPITATION_SPAWN_MAX_RETRIES) {
        const nextAttempt = attempt + 1;
        const retryReadyTime = Number.isFinite(now)
          ? now + PRECIPITATION_HANDLE_RECHECK_INTERVAL
          : null;
        queuePrecipitationRetry({
          config: spawnConfig,
          attempt: nextAttempt,
          readyTime: retryReadyTime,
          reason: 'no_handle',
          elapsedTime: now,
        });
        console.warn(
          'Weather precipitation emitter failed to spawn; retry scheduled.',
          {
            type: config.type,
            attempt: nextAttempt,
            maxAttempts,
            retryAt: retryReadyTime,
          },
        );
      } else {
        console.error('Weather precipitation emitter failed after maximum retries.', {
          type: config.type,
          attempts: maxAttempts,
        });
      }
      return;
    }
    const resolvedAnchorHeight = Number.isFinite(config.anchorHeight)
      ? config.anchorHeight
      : 0;
    const groupId = config.type === 'rain' ? Symbol('weather-precipitation-group') : null;
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
    const resolvedUpdateInterval = Number.isFinite(updateInterval)
      ? Math.max(0.05, updateInterval)
      : DEFAULT_PRECIPITATION_UPDATE_INTERVAL;
    const resolvedMinAnchorDistance = Number.isFinite(minAnchorDistance)
      ? Math.max(0, minAnchorDistance)
      : emitter.weatherMinAnchorDistance ?? 0;
    const attachments = [];
    const precipitationAttachment = {
      type: 'precipitation',
      handle,
      emitter,
      anchorOffsetY: resolvedAnchorHeight,
      updateInterval: resolvedUpdateInterval,
      minDistanceSq: resolvedMinAnchorDistance ** 2,
      lastUpdateTime: -Infinity,
      lastAnchor: {
        x: Number.POSITIVE_INFINITY,
        y: Number.POSITIVE_INFINITY,
        z: Number.POSITIVE_INFINITY,
      },
      precipitationGroup: groupId,
      spawnConfig,
    };
    attachments.push(precipitationAttachment);

    if (config.type === 'rain') {
      const splashEmitter = createWeatherRainSplashEmitter({
        intensity: appliedIntensity,
        radius: appliedRadius,
        anchorHeight: resolvedAnchorHeight,
      });
      const splashHandle = particleSystem.emit(splashEmitter);
      if (splashHandle) {
        let splashInterval = config.updateInterval;
        if (
          !Number.isFinite(splashInterval) &&
          Number.isFinite(splashEmitter.weatherUpdateInterval)
        ) {
          splashInterval = splashEmitter.weatherUpdateInterval;
        }
        let splashDistance = config.minAnchorDistance;
        if (
          !Number.isFinite(splashDistance) &&
          Number.isFinite(splashEmitter.weatherMinAnchorDistance)
        ) {
          splashDistance = splashEmitter.weatherMinAnchorDistance;
        }
        const splashAttachment = {
          type: 'precipitation_splash',
          handle: splashHandle,
          emitter: splashEmitter,
          anchorOffsetY: resolvedAnchorHeight,
          updateInterval: Number.isFinite(splashInterval)
            ? Math.max(0.05, splashInterval)
            : resolvedUpdateInterval,
          minDistanceSq: (Number.isFinite(splashDistance)
            ? Math.max(0, splashDistance)
            : splashEmitter.weatherMinAnchorDistance ?? resolvedMinAnchorDistance) ** 2,
          lastUpdateTime: -Infinity,
          lastAnchor: {
            x: Number.POSITIVE_INFINITY,
            y: Number.POSITIVE_INFINITY,
            z: Number.POSITIVE_INFINITY,
          },
          precipitationGroup: groupId,
          spawnConfig: { ...spawnConfig },
          spawnAttempt: attempt,
          spawnElapsedTime: context.elapsedTime ?? 0,
        };
        attachments.push(splashAttachment);
      } else {
        console.warn('Weather rain splash emitter failed to spawn.', {
          type: config.type,
        });
      }
    }

    const playerPosition = context.playerControls?.getPosition?.();
    const elapsedTime = context.elapsedTime ?? 0;
    if (playerPosition) {
      for (const attachment of attachments) {
        attachment.emitter?.setBasePosition?.({
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
      }
      recordAnchorUpdate(elapsedTime);
    }

    for (const attachment of attachments) {
      attachment.spawnConfig = attachment.spawnConfig ?? { ...config, intensity: appliedIntensity };
      attachment.spawnAttempt = attachment.spawnAttempt ?? attempt;
      attachment.spawnElapsedTime = attachment.spawnElapsedTime ?? elapsedTime;
      if (attachment.type === 'precipitation') {
        attachment.validationReadyTime = Number.isFinite(elapsedTime)
          ? elapsedTime + PRECIPITATION_HANDLE_VALIDATION_DELAY
          : Number.POSITIVE_INFINITY;
        attachment.validationStatus = 'pending';
        attachment.validationRetryAfter = null;
        attachment.validationPendingSince = null;
        attachment.appliedIntensity = appliedIntensity;
        attachment.manualOverrides = normaliseManualPrecipitationOverridesSnapshot(
          manualOverrides,
        );
        if (typeof emitter.getWeatherRainShaderBaseUniforms === 'function') {
          attachment.baseRainUniforms = normaliseRainUniformSnapshot(
            emitter.getWeatherRainShaderBaseUniforms(),
          );
        }
        if (typeof emitter.getWeatherRainShaderUniforms === 'function') {
          const uniforms = normaliseRainUniformSnapshot(
            emitter.getWeatherRainShaderUniforms(),
          );
          if (!attachment.baseRainUniforms) {
            attachment.baseRainUniforms = uniforms ? { ...uniforms } : null;
          }
          attachment.lastAppliedRainOverrides = uniforms;
        }
      }
      activeParticleEffects.push(attachment);
    }

    recordPrecipitationSpawn({ type: config.type, elapsedTime });
    syncEmitterState();
  };

  const syncPrecipitationUniformOverrides = () => {
    const state = ensureWeatherState();
    if (!state) {
      return;
    }
    const overrides = state.manualOverrides?.precipitation ?? null;
    if (!overrides) {
      return;
    }
    activeParticleEffects.forEach((attachment) => {
      if (attachment.type !== 'precipitation') {
        return;
      }
      const setter = attachment.emitter?.setWeatherRainShaderUniforms;
      if (typeof setter !== 'function') {
        return;
      }
      const last = attachment.lastAppliedRainOverrides || {};
      const updates = {};
      const snapshotUpdates = {};
      let changed = false;
      const applyOverride = (overrideValue, snapshotKey, uniformKey, extraUniformKeys = []) => {
        const target = Number.isFinite(overrideValue)
          ? overrideValue
          : overrideValue === null
          ? null
          : undefined;
        if (target === undefined || last[snapshotKey] === target) {
          return;
        }
        updates[uniformKey] = target;
        extraUniformKeys.forEach((key) => {
          updates[key] = target;
        });
        snapshotUpdates[snapshotKey] = target;
        changed = true;
      };
      if (overrides.windTilt !== undefined) {
        applyOverride(overrides.windTilt, 'windTilt', 'windTilt');
      }
      if (overrides.streakNoise !== undefined) {
        applyOverride(overrides.streakNoise, 'streakNoise', 'streakNoise');
      }
      if (overrides.highlightWidth !== undefined) {
        applyOverride(overrides.highlightWidth, 'highlightWidth', 'highlightWidth');
      }
      if (overrides.rippleScale !== undefined) {
        applyOverride(overrides.rippleScale, 'rippleScale', 'rippleScale');
      }
      const dropSpeedOverride =
        overrides.dropSpeed !== undefined
          ? overrides.dropSpeed
          : overrides.dropDensity !== undefined
          ? overrides.dropDensity
          : undefined;
      if (dropSpeedOverride !== undefined) {
        applyOverride(dropSpeedOverride, 'dropSpeed', 'dropSpeed', ['dropDensity']);
      }
      const viscosityOverride =
        overrides.viscosity !== undefined
          ? overrides.viscosity
          : overrides.timerBias !== undefined
          ? overrides.timerBias
          : undefined;
      if (viscosityOverride !== undefined) {
        applyOverride(viscosityOverride, 'viscosity', 'viscosity', ['timerBias']);
      }
      attachment.manualOverrides = normaliseManualPrecipitationOverridesSnapshot(overrides);
      if (!changed) {
        return;
      }
      setter.call(attachment.emitter, updates);
      attachment.lastAppliedRainOverrides = {
        ...last,
        ...snapshotUpdates,
      };
    });
  };

  const spawnAuroraEffects = (config, context) => {
    if (!particleSystem || typeof particleSystem.emit !== 'function') {
      return;
    }
    const playerControls = context.playerControls;
    const yawPitch = playerControls?.getYawPitch?.();
    const headingYaw = yawPitch?.yaw ?? 0;
    const count = Math.max(1, Math.round(config.count ?? 0));
    const layers = Math.max(1, Math.round(config.layers ?? 1));
    const centerIndex = (count - 1) / 2;
    let spawned = 0;
    for (let layerIndex = 0; layerIndex < layers; layerIndex += 1) {
      const layerScale = layerIndex === 0
        ? 1
        : Math.pow(config.layerIntensityFalloff ?? 1, layerIndex);
      const layerIntensity = Math.max(0.2, config.intensity * layerScale);
      const spanMultiplier = 1 + layerIndex * (config.layerSpanScale ?? 0);
      const layerSpan = Math.max(4, config.span * spanMultiplier);
      const lateralStep = config.lateralOffset * (1 + layerIndex * (config.layerLateralScale ?? 0));
      const forwardOffset = config.forwardOffset + layerIndex * (config.layerSpacing ?? 0);
      const anchorHeight = config.anchorHeight + layerIndex * (config.layerHeightStep ?? 0);
      const orientationSpacing = 0.26 + layerIndex * 0.08;
      for (let i = 0; i < count; i += 1) {
        const offsetIndex = i - centerIndex;
        const orientationOffset = offsetIndex * orientationSpacing;
        const jitter = (Math.random() - 0.5) * config.orientationJitter;
        const baseOrientation = config.alignWithHeading
          ? headingYaw
          : config.orientation ?? headingYaw;
        const ribbonOrientation = baseOrientation + orientationOffset + jitter;
        const emitter = createAuroraRibbonEmitter({
          position: { x: 0, y: anchorHeight, z: 0 },
          span: layerSpan,
          intensity: layerIntensity,
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
          anchorOffsetY: anchorHeight,
          updateInterval: Math.max(0.25, config.updateInterval),
          forwardOffset,
          lateralOffset: offsetIndex * lateralStep,
          alignWithHeading: config.alignWithHeading,
          orientationOffset: orientationOffset + jitter,
          baseHeadingAtSpawn: headingYaw,
          staticOrientation: ribbonOrientation,
          lastUpdateTime: -Infinity,
        };
        activeParticleEffects.push(attachment);
        spawned += 1;
      }
    }
    if (spawned > 0) {
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
    let overlayBaseState = {
      active: false,
      intensity: 0,
      mode: 'rain',
      windSpeed: DEFAULT_RAIN_OVERLAY_WIND_SPEED,
      streakDensity: DEFAULT_RAIN_OVERLAY_STREAK_DENSITY,
      sparkleGain: DEFAULT_RAIN_OVERLAY_SPARKLE_GAIN,
      rippleScale: null,
      dropSpeed: null,
      viscosity: null,
      flakeDensity: 0,
      puffDensity: 0,
    };
    if (precipitation) {
      spawnPrecipitationEffect(precipitation, context);
      if (precipitation.type === 'rain') {
        const overlayResponse = resolveRainOverlayResponse(precipitation);
        overlayBaseState = {
          active: overlayResponse.active,
          intensity: overlayResponse.intensity,
          mode: overlayResponse.mode ?? 'rain',
          windSpeed: overlayResponse.windSpeed,
          streakDensity: overlayResponse.streakDensity,
          sparkleGain: overlayResponse.sparkleGain,
          rippleScale: overlayResponse.rippleScale ?? null,
          dropSpeed: overlayResponse.dropSpeed ?? null,
          viscosity: overlayResponse.viscosity ?? null,
          flakeDensity: overlayResponse.flakeDensity ?? 0,
          puffDensity: overlayResponse.puffDensity ?? 0,
        };
      } else if (precipitation.type === 'snow') {
        const overlayResponse = resolveSnowOverlayResponse(precipitation);
        overlayBaseState = {
          active: overlayResponse.active,
          intensity: overlayResponse.intensity,
          mode: overlayResponse.mode ?? 'snow',
          windSpeed: overlayResponse.windSpeed,
          streakDensity: overlayResponse.streakDensity,
          sparkleGain: overlayResponse.sparkleGain,
          rippleScale: overlayResponse.rippleScale ?? null,
          dropSpeed: overlayResponse.dropSpeed ?? null,
          viscosity: overlayResponse.viscosity ?? null,
          flakeDensity: overlayResponse.flakeDensity ?? 0,
          puffDensity: overlayResponse.puffDensity ?? 0,
        };
      }
    }
    setRaindropOverlayBaseState(overlayBaseState);
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
      if (attachment.type === 'precipitation' || attachment.type === 'precipitation_splash') {
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

      const now = Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime;
      syncPendingPrecipitationRetries(now);
      const precipitationSummaries = activeParticleEffects
        .filter((attachment) => attachment.type === 'precipitation')
        .map((attachment, index) => {
          const handle = attachment.handle;
          const getCount = handle?.getActiveParticleCount;
          const particleCount =
            typeof getCount === 'function' ? Number(getCount.call(handle)) : null;
          const attempts = Number.isFinite(attachment.spawnAttempt)
            ? attachment.spawnAttempt + 1
            : 1;
          const status = attachment.validationStatus ?? 'pending';
          const retryDelay =
            status === 'pending' && Number.isFinite(attachment.validationRetryAfter) &&
            Number.isFinite(now)
              ? Math.max(0, attachment.validationRetryAfter - now)
              : null;
          return {
            index,
            label: attachment.emitter?.debugLabel ?? 'WeatherPrecipitationEmitter',
            type: attachment.spawnConfig?.type ?? 'precipitation',
            particles: Number.isFinite(particleCount) ? particleCount : null,
            attempts,
            maxAttempts: PRECIPITATION_SPAWN_MAX_RETRIES + 1,
            status,
            nextRetryIn: Number.isFinite(retryDelay) ? retryDelay : null,
            spawnedAt: Number.isFinite(attachment.spawnElapsedTime)
              ? attachment.spawnElapsedTime
              : null,
            appliedIntensity: Number.isFinite(attachment.appliedIntensity)
              ? attachment.appliedIntensity
              : null,
            manualOverrides: attachment.manualOverrides
              ? { ...attachment.manualOverrides }
              : null,
            shaderUniforms:
              typeof attachment.emitter?.getWeatherRainShaderUniforms === 'function'
                ? normaliseRainUniformSnapshot(
                    attachment.emitter.getWeatherRainShaderUniforms(),
                  )
                : null,
            shaderBase:
              typeof attachment.emitter?.getWeatherRainShaderBaseUniforms === 'function'
                ? normaliseRainUniformSnapshot(
                    attachment.emitter.getWeatherRainShaderBaseUniforms(),
                  )
                : attachment.baseRainUniforms ?? null,
            lastAppliedRainOverrides: attachment.lastAppliedRainOverrides
              ? { ...attachment.lastAppliedRainOverrides }
              : null,
          };
        });
      weatherState.precipitationEmitters = precipitationSummaries;
      weatherState.precipitationActiveCount = precipitationSummaries.length;
      weatherState.precipitationActiveParticles = precipitationSummaries.reduce(
        (total, summary) => (Number.isFinite(summary.particles) ? total + summary.particles : total),
        0,
      );

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
            precipitation: {
              emitters: precipitationSummaries,
              totalParticles: weatherState.precipitationActiveParticles,
            },
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

  const validatePrecipitationHandles = (context) => {
    if (activeParticleEffects.length === 0) {
      return;
    }
    const { elapsedTime = lastElapsedTime } = context;
    const now = Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime;
    if (!Number.isFinite(now)) {
      return;
    }
    const attachments = activeParticleEffects.slice();
    for (const attachment of attachments) {
      if (attachment.type !== 'precipitation') {
        continue;
      }
      if (attachment.validationStatus === 'passed' || attachment.validationStatus === 'failed') {
        continue;
      }
      const readyTime = Number.isFinite(attachment.validationReadyTime)
        ? attachment.validationReadyTime
        : Number.POSITIVE_INFINITY;
      if (now < readyTime) {
        continue;
      }
      const getCount = attachment.handle?.getActiveParticleCount;
      if (typeof getCount !== 'function') {
        attachment.validationStatus = 'passed';
        continue;
      }
      const count = Number(getCount.call(attachment.handle));
      if (Number.isFinite(count) && count > 0) {
        attachment.validationStatus = 'passed';
        continue;
      }
      if (!Number.isFinite(attachment.validationPendingSince)) {
        attachment.validationPendingSince = now;
        attachment.validationRetryAfter = now + PRECIPITATION_HANDLE_RECHECK_INTERVAL;
        continue;
      }
      if (Number.isFinite(attachment.validationRetryAfter) && now < attachment.validationRetryAfter) {
        continue;
      }
      const retryCount = Number(getCount.call(attachment.handle));
      if (Number.isFinite(retryCount) && retryCount > 0) {
        attachment.validationStatus = 'passed';
        continue;
      }

      attachment.validationStatus = 'failed';
      const failureElapsed = now;
      const failureType = attachment.spawnConfig?.type ?? 'precipitation';
      recordPrecipitationFailure({
        type: failureType,
        elapsedTime: failureElapsed,
        reason: 'zero_particles',
      });
      stopAttachmentHandle(attachment);
      stopLinkedPrecipitationAttachments(attachment);
      removeAttachment(attachment);

      const state = ensureWeatherState();
      const maxAttempts = PRECIPITATION_SPAWN_MAX_RETRIES + 1;
      const attemptIndex = Number.isFinite(attachment.spawnAttempt)
        ? attachment.spawnAttempt
        : 0;

      if (attemptIndex < PRECIPITATION_SPAWN_MAX_RETRIES) {
        if (state) {
          const previousRecoveries = Number.isFinite(state.precipitationRecoveryAttempts)
            ? state.precipitationRecoveryAttempts
            : 0;
          state.precipitationRecoveryAttempts = previousRecoveries + 1;
        }
        const nextAttempt = attemptIndex + 1;
        console.warn(
          'Weather precipitation emitter produced no particles; retrying spawn.',
          {
            type: failureType,
            attempt: attemptIndex + 1,
            maxAttempts,
          },
        );
        const retryConfig = { ...attachment.spawnConfig };
        spawnPrecipitationEffect(retryConfig, context, nextAttempt);
      } else {
        console.error('Weather precipitation emitter failed after maximum retries.', {
          type: failureType,
          attempts: maxAttempts,
        });
      }
    }
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
      handleRotationHarnessWeatherApplied(nextWeather);
      return activeWeather;
    }
    const previousWeatherId = activeWeather?.id ?? null;
    disposeWeatherEffects();
    activeWeather = nextWeather;
    needsEffectRefresh = true;
    applyWeatherEffects(activeWeather);
    handleRotationHarnessWeatherApplied(activeWeather);
    audioController.handleTransition({
      previousWeatherId,
      nextWeatherId: activeWeather?.id ?? null,
    });
    return activeWeather;
  };

  const scheduleWeatherChange = ({
    weatherId,
    delay = 0,
    triggerTime,
    options = {},
    tag = null,
  }) => {
    if (!weatherId) {
      throw new Error('scheduleWeatherChange requires a weatherId');
    }
    const baseTime = Number.isFinite(triggerTime)
      ? triggerTime
      : (Number.isFinite(lastElapsedTime) ? lastElapsedTime : 0) + Math.max(0, delay);
    const entry = {
      weatherId,
      triggerTime: baseTime,
      options,
      tag,
    };
    scheduledTransitions.push(entry);
    return () => {
      const index = scheduledTransitions.indexOf(entry);
      if (index >= 0) {
        scheduledTransitions.splice(index, 1);
      }
    };
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
    processPendingPrecipitationRetries({ ...context, elapsedTime: lastElapsedTime });
    updateAnchoredEffects({ ...context, elapsedTime: lastElapsedTime });
    syncPrecipitationUniformOverrides();
    validatePrecipitationHandles({ ...context, elapsedTime: lastElapsedTime });
    if (raindropOverlay) {
      raindropOverlay.update({ delta, elapsedTime: lastElapsedTime });
    }
    if (raindropOverlayController) {
      raindropOverlayController.update?.({ delta });
    }
    updateRotationHarnessTick({ elapsedTime: lastElapsedTime });
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
    stopRotationHarness();
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
  updateRaindropOverlayMetadata();
  registerOverlay();

  return {
    update,
    setWeather,
    scheduleWeatherChange,
    registerTickListener,
    registerWeatherPreset,
    listWeatherPresets,
    getCurrentWeather,
    startRotationHarness,
    stopRotationHarness,
    getRotationHarnessStatus,
    getRaindropOverlayState,
    setRaindropOverlayManualEnabled,
    setRaindropOverlayManualIntensity,
    setRaindropOverlayManualWindSpeed,
    setRaindropOverlayManualStreakDensity,
    setRaindropOverlayManualSparkleGain,
    dispose,
  };
}
