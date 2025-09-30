import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createAuroraRibbonEmitter({
  position,
  span = 6,
  intensity = 1,
  orientation = 0,
} = {}) {
  const ribbonSpan = Math.max(1.2, span);
  const energy = clamp(intensity, 0.45, 3.6);
  const drift = 0.24 + energy * 0.14;
  const dirX = Math.cos(orientation);
  const dirZ = Math.sin(orientation);

  const emitter = createGpuBillboardEmitter({
    spawnRate: 42 * energy,
    maxParticles: Math.ceil(220 * energy),
    lifetime: { min: 3.4, max: 7.6 },
    baseColor: '#f8ffff',
    colorRamp: [
      { time: 0, color: '#82ffdf' },
      { time: 0.23, color: '#5cecff' },
      { time: 0.52, color: '#ffe8ff' },
      { time: 0.78, color: '#ffd2ff' },
      { time: 1, color: '#7dd6ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 1.35 * energy },
      { time: 0.45, size: 2.45 * energy },
      { time: 0.82, size: 2.1 * energy },
      { time: 1, size: 0.95 * energy },
    ],
    position,
    positionJitter: { x: ribbonSpan * 0.92, y: 0.85, z: ribbonSpan * 0.92 },
    velocity: {
      x: dirX * drift,
      y: 0.46 + energy * 0.14,
      z: dirZ * drift,
    },
    velocityJitter: { x: 0.36, y: 0.32, z: 0.36 },
    size: { min: 1.15 * energy, max: 2.6 * energy },
    gravity: { x: 0, y: 0.08, z: 0 },
    drag: 0.52,
    fadeIn: 0.28,
    fadeOut: 0.58,
    opacity: 0.82,
    renderOrder: 6,
  });

  emitter.debugLabel = 'AuroraRibbonEmitter';
  return emitter;
}
