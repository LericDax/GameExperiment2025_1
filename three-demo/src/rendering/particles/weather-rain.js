import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createWeatherRainEmitter({
  intensity = 0.6,
  radius = 12,
  heightOffset = 14,
} = {}) {
  const density = clamp(intensity, 0.2, 2.4);
  const spawnRadius = Math.max(6, radius);
  const emitter = createGpuBillboardEmitter({
    spawnRate: 200 * density,
    maxParticles: Math.ceil(240 * density),
    lifetime: { min: 0.85, max: 1.25 },
    baseColor: '#a9cfff',
    colorRamp: [
      { time: 0, color: '#9bc0ff' },
      { time: 0.45, color: '#6e9bff' },
      { time: 1, color: '#c9e6ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.18 },
      { time: 0.45, size: 0.12 },
      { time: 1, size: 0.02 },
    ],
    position: { x: 0, y: heightOffset, z: 0 },
    positionJitter: { x: spawnRadius, y: 0.6, z: spawnRadius },
    velocity: { x: 0, y: -11 - density * 3.5, z: 0 },
    velocityJitter: { x: 0.75, y: 2.4, z: 0.75 },
    size: { min: 0.04, max: 0.08 },
    gravity: { x: 0, y: -19.6, z: 0 },
    drag: 0.22,
    fadeIn: 0.05,
    fadeOut: 0.15,
    opacity: 0.52,
    depthWrite: false,
    renderOrder: 5,
  });
  emitter.debugLabel = 'WeatherRainEmitter';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.2;
  emitter.weatherMinAnchorDistance = spawnRadius * 0.28;
  return emitter;
}
