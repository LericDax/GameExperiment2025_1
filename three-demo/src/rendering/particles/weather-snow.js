import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js';

export function createWeatherSnowEmitter({
  intensity = 0.5,
  radius = 11,
  heightOffset = 12,
} = {}) {
  const clampedIntensity = Number.isFinite(intensity) ? Math.max(0.15, intensity) : 0.15;
  const spawnRadius = Math.max(6, radius);
  const spawnRate = 160 * clampedIntensity;
  const maxParticles = Math.ceil(240 * clampedIntensity);
  const fallSpeed = -3.1 - clampedIntensity * 1.1;
  const emitter = createGpuBillboardEmitter({
    spawnRate,
    maxParticles,
    lifetime: { min: 2.2, max: 3.9 },
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
    positionJitter: { x: spawnRadius * 1.1, y: 1.1, z: spawnRadius * 1.1 },
    velocity: { x: 0, y: fallSpeed, z: 0 },
    velocityJitter: { x: 0.95, y: 1.4, z: 0.95 },
    size: { min: 0.22, max: 0.56 },
    gravity: { x: 0, y: -4.2, z: 0 },
    drag: 1.18,
    fadeIn: 0.12,
    fadeOut: 0.32,
    opacity: 0.82,
    depthWrite: false,
    renderOrder: 5,
  });
  emitter.debugLabel = 'WeatherSnowEmitter';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.22;
  emitter.weatherMinAnchorDistance = spawnRadius * 0.18;
  emitter.weatherSpawnRate = spawnRate;
  emitter.weatherMaxParticles = maxParticles;
  emitter.weatherFallSpeed = fallSpeed;
  emitter.weatherIntensity = clampedIntensity;
  return emitter;
}
