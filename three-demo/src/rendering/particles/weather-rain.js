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
    spawnRate: Math.min(360 * density, 640),
    maxParticles: Math.ceil(Math.min(540 * density, 760)),
    lifetime: { min: 1.1, max: 1.65 },
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
    positionJitter: { x: spawnRadius, y: 1.1, z: spawnRadius },
    velocity: { x: 0, y: -11 - density * 3.6, z: 0 },
    velocityJitter: { x: 0.8, y: 2.4, z: 0.8 },
    size: { min: 0.16, max: 0.26 },
    sizeJitter: 0.04,
    lengthMultiplier: { min: 5.6, max: 8.2 },
    gravity: { x: 0, y: -19.6, z: 0 },
    drag: 0.16,
    fadeIn: 0.05,
    fadeOut: 0.26,
    opacity: 0.82,
    blending: THREE.NormalBlending,
    depthWrite: false,
    renderOrder: 5,
  });
  emitter.debugLabel = 'WeatherRainEmitter';
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 };
  emitter.weatherUpdateInterval = 0.16;
  emitter.weatherMinAnchorDistance = Math.max(spawnRadius * 0.2, 1.6);
  return emitter;
}
