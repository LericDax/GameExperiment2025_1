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
  const energy = clamp(intensity, 0.35, 3.2);
  const drift = 0.18 + energy * 0.12;
  const dirX = Math.cos(orientation);
  const dirZ = Math.sin(orientation);

  const emitter = createGpuBillboardEmitter({
    spawnRate: 26 * energy,
    maxParticles: Math.ceil(140 * energy),
    lifetime: { min: 2.2, max: 4.6 },
    baseColor: '#ffe4ff',
    colorRamp: [
      { time: 0, color: '#6ffcff' },
      { time: 0.35, color: '#ff96f6' },
      { time: 0.7, color: '#ffe4ff' },
      { time: 1, color: '#7fd4ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 1.05 * energy },
      { time: 0.55, size: 1.8 * energy },
      { time: 1, size: 0.45 * energy },
    ],
    position,
    positionJitter: { x: ribbonSpan * 0.62, y: 0.55, z: ribbonSpan * 0.62 },
    velocity: {
      x: dirX * drift,
      y: 0.38 + energy * 0.12,
      z: dirZ * drift,
    },
    velocityJitter: { x: 0.28, y: 0.24, z: 0.28 },
    size: { min: 0.9 * energy, max: 1.9 * energy },
    gravity: { x: 0, y: 0.12, z: 0 },
    drag: 0.64,
    fadeIn: 0.2,
    fadeOut: 0.42,
    opacity: 0.6,
    renderOrder: 6,
  });

  emitter.debugLabel = 'AuroraRibbonEmitter';
  return emitter;
}
