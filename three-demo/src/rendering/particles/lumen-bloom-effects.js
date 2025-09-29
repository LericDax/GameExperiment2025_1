import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function createLumenBloomMotesEmitter({
  position,
  radius = 4.5,
  intensity = 1,
  riseHeight = 2.8,
} = {}) {
  const glow = clamp(intensity, 0.35, 3.4)
  const spawnRadius = Math.max(1.2, radius)
  const driftHeight = Math.max(1.4, riseHeight)

  const emitter = createGpuBillboardEmitter({
    spawnRate: 22 * glow,
    maxParticles: Math.ceil(110 * glow),
    lifetime: { min: 3.2, max: 5.4 },
    baseColor: '#f0f8ff',
    colorRamp: [
      { time: 0, color: '#1bffff' },
      { time: 0.32, color: '#5dffe7' },
      { time: 0.68, color: '#fefbff' },
      { time: 1, color: '#ffd6ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.32 * glow },
      { time: 0.55, size: 0.62 * glow },
      { time: 1, size: 0.12 * glow },
    ],
    position,
    positionJitter: {
      x: spawnRadius * 0.6,
      y: driftHeight * 0.45,
      z: spawnRadius * 0.6,
    },
    velocity: { x: 0, y: 0.46 + glow * 0.18, z: 0 },
    velocityJitter: { x: 0.18, y: 0.2, z: 0.18 },
    size: { min: 0.28 * glow, max: 0.74 * glow },
    gravity: { x: 0, y: 0.38, z: 0 },
    drag: 0.72,
    fadeIn: 0.18,
    fadeOut: 0.36,
    opacity: 0.82,
    renderOrder: 7,
  })

  emitter.debugLabel = 'LumenBloomMotesEmitter'
  return emitter
}
