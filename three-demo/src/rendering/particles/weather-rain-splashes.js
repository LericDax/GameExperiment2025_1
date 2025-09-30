import * as THREE from 'three'
import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function createWeatherRainSplashEmitter({
  intensity = 0.6,
  radius = 12,
  anchorHeight = 14,
} = {}) {
  const density = clamp(intensity, 0.2, 2.6)
  const spawnRadius = Math.max(4, radius)
  const heightOffset = Number.isFinite(anchorHeight) ? anchorHeight : 14
  const normalized = clamp((density - 0.2) / (2.6 - 0.2), 0, 1)
  const upwardVelocity = THREE.MathUtils.lerp(2.1, 5.2, normalized)
  const splashSizeMin = THREE.MathUtils.lerp(0.22, 0.32, normalized)
  const splashSizeMax = THREE.MathUtils.lerp(0.38, 0.68, normalized)
  const emitter = createGpuBillboardEmitter({
    spawnRate: Math.min(260 * density, 420),
    maxParticles: Math.ceil(Math.min(420 * density, 620)),
    lifetime: { min: 0.18, max: 0.36 },
    baseColor: '#6ec7ff',
    colorRamp: [
      { time: 0, color: '#2c8dd8' },
      { time: 0.32, color: '#7bd4ff' },
      { time: 1, color: '#e8f9ff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: splashSizeMax },
      { time: 0.3, size: splashSizeMax * 1.08 },
      { time: 1, size: splashSizeMin * 0.2 },
    ],
    position: { x: 0, y: -heightOffset + 0.35, z: 0 },
    positionJitter: { x: spawnRadius, y: 0.45, z: spawnRadius },
    velocity: { x: 0, y: upwardVelocity, z: 0 },
    velocityJitter: { x: 0.95, y: 0.6, z: 0.95 },
    size: { min: splashSizeMin, max: splashSizeMax },
    sizeJitter: 0.16,
    lengthMultiplier: { min: 0.55, max: 0.85 },
    gravity: { x: 0, y: -12.8, z: 0 },
    drag: 1.25,
    fadeIn: 0.04,
    fadeOut: 0.24,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    renderOrder: 6,
  })
  emitter.debugLabel = 'WeatherRainSplashEmitter'
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 }
  emitter.weatherUpdateInterval = 0.12
  emitter.weatherMinAnchorDistance = Math.max(spawnRadius * 0.18, 1.2)
  return emitter
}
