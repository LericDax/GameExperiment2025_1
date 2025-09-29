import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createWeatherSnowEmitter({
  intensity = 0.5,
  radius = 11,
  heightOffset = 12,
} = {}) {
  const density = clamp(intensity, 0.2, 1.8);
  const spawnRadius = Math.max(6, radius);
  const emitter = createGpuBillboardEmitter({
    spawnRate: 120 * density,
    maxParticles: Math.ceil(200 * density),
    lifetime: { min: 2.4, max: 3.6 },
    baseColor: '#f5fbff',
    colorRamp: [
      { time: 0, color: '#e3f3ff' },
      { time: 0.5, color: '#ffffff' },
      { time: 1, color: '#d6edff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.35 },
      { time: 0.45, size: 0.48 },
      { time: 1, size: 0.3 },
    ],
    position: { x: 0, y: heightOffset, z: 0 },
    positionJitter: { x: spawnRadius * 1.1, y: 0.8, z: spawnRadius * 1.1 },
    velocity: { x: 0, y: -2.6 - density * 0.6, z: 0 },
    velocityJitter: { x: 0.65, y: 0.95, z: 0.65 },
    size: { min: 0.22, max: 0.56 },
    gravity: { x: 0, y: -3.8, z: 0 },
    drag: 1.25,
    fadeIn: 0.15,
    fadeOut: 0.35,
    opacity: 0.78,
    depthWrite: false,
    renderOrder: 5,
  });
  emitter.debugLabel = 'WeatherSnowEmitter';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.3;
  emitter.weatherMinAnchorDistance = spawnRadius * 0.2;
  return emitter;
}
