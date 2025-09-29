import * as THREE from 'three';
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
    spawnRate: Math.min(560 * density, 960),
    maxParticles: Math.ceil(Math.min(900 * density, 1180)),
    lifetime: { min: 1.35, max: 2.25 },
    baseColor: '#204c7a',
    colorRamp: [
      { time: 0, color: '#081629' },
      { time: 0.18, color: '#0f2f57' },
      { time: 0.45, color: '#1e6bc0' },
      { time: 0.78, color: '#6faef5' },
      { time: 1, color: '#d6ecff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 1.5 },
      { time: 0.22, size: 1.32 },
      { time: 0.68, size: 1.08 },
      { time: 1, size: 0.92 },
    ],
    position: { x: 0, y: heightOffset, z: 0 },
    positionJitter: { x: spawnRadius, y: 1.4, z: spawnRadius },
    velocity: { x: 0, y: -12.4 - density * 4.6, z: 0 },
    velocityJitter: { x: 0.9, y: 2.9, z: 0.9 },
    size: { min: 0.22, max: 0.36 },
    sizeJitter: 0.06,
    lengthMultiplier: { min: 9, max: 14 },
    gravity: { x: 0, y: -21.6, z: 0 },
    drag: 0.12,
    fadeIn: 0.06,
    fadeOut: 0.34,
    opacity: 0.94,
    blending: THREE.NormalBlending,
    depthWrite: false,
    renderOrder: 4,
  });
  emitter.debugLabel = 'WeatherRainEmitter/HighContrast';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.12;
  emitter.weatherMinAnchorDistance = Math.max(spawnRadius * 0.2, 1.6);
  return emitter;
}
