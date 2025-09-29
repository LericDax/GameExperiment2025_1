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
    spawnRate: Math.min(320 * density, 560),
    maxParticles: Math.ceil(Math.min(420 * density, 600)),
    lifetime: { min: 0.95, max: 1.4 },
    baseColor: '#94e2f7',
    colorRamp: [
      { time: 0, color: '#7cccea' },
      { time: 0.4, color: '#5fb6d6' },
      { time: 1, color: '#b9f0ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 1.15 },
      { time: 0.25, size: 1 },
      { time: 0.8, size: 0.92 },
      { time: 1, size: 0.78 },
    ],
    position: { x: 0, y: heightOffset, z: 0 },
    positionJitter: { x: spawnRadius, y: 0.6, z: spawnRadius },
    velocity: { x: 0, y: -13 - density * 4.2, z: 0 },
    velocityJitter: { x: 0.85, y: 2.8, z: 0.85 },
    size: { min: 0.09, max: 0.16 },
    lengthMultiplier: { min: 5.2, max: 7.4 },
    gravity: { x: 0, y: -19.6, z: 0 },
    drag: 0.12,
    fadeIn: 0.06,
    fadeOut: 0.22,
    opacity: 0.68,
    depthWrite: false,
    renderOrder: 5,
  });
  emitter.debugLabel = 'WeatherRainEmitter';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.2;
  emitter.weatherMinAnchorDistance = spawnRadius * 0.28;
  return emitter;
}
