import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js'

function createBurstWrapper(baseEmitter, { duration = 0.35, label } = {}) {
  let stopTime = 0
  let started = false
  const burstLabel = label ?? baseEmitter?.debugLabel ?? 'BurstEmitter'
  return {
    debugLabel: burstLabel,
    initialize(context) {
      baseEmitter.initialize?.(context)
      const now = context.getElapsedTime?.() ?? 0
      stopTime = now + Math.max(0.05, duration)
      started = true
    },
    update(context) {
      if (!started) {
        return false
      }
      const now = context.getElapsedTime?.() ?? 0
      if (now >= stopTime) {
        const { delta: _ignored, ...rest } = context
        baseEmitter.update?.({ ...rest, delta: 0 })
        const activeCount = baseEmitter.getActiveParticleCount?.() ?? 0
        return activeCount > 0
      }
      return baseEmitter.update?.(context) ?? false
    },
    dispose() {
      baseEmitter.dispose?.()
    },
  }
}

export function createWaterSplashBurst({ position, intensity = 1, duration } = {}) {
  const power = Math.min(Math.max(intensity, 0.35), 3.2)
  const baseEmitter = createGpuBillboardEmitter({
    spawnRate: 180 * power,
    maxParticles: Math.ceil(48 * power),
    lifetime: { min: 0.45, max: 0.9 },
    baseColor: '#ffffff',
    colorRamp: [
      { time: 0, color: '#87cfff' },
      { time: 0.35, color: '#d8f0ff' },
      { time: 1, color: '#ffffff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.45 * power },
      { time: 0.4, size: 0.92 * power },
      { time: 1, size: 0 },
    ],
    position,
    positionJitter: { x: 0.45 * power, y: 0.2, z: 0.45 * power },
    velocity: { x: 0, y: 4.6 * power, z: 0 },
    velocityJitter: { x: 2.1 * power, y: 1.25 * power, z: 2.1 * power },
    size: { min: 0.4 * power, max: 0.95 * power },
    gravity: { x: 0, y: -9.81, z: 0 },
    drag: 1.6,
    fadeIn: 0.05,
    fadeOut: 0.4,
    opacity: 0.85,
    depthWrite: false,
  })
  baseEmitter.debugLabel = 'WaterSplashParticles'
  return createBurstWrapper(baseEmitter, {
    duration: duration ?? 0.42,
    label: 'WaterSplashBurst',
  })
}

export function createWaterBubbleBurst({ position, intensity = 1, duration } = {}) {
  const strength = Math.min(Math.max(intensity, 0.3), 2.2)
  const baseEmitter = createGpuBillboardEmitter({
    spawnRate: 80 * strength,
    maxParticles: Math.ceil(36 * strength),
    lifetime: { min: 0.8, max: 1.6 },
    baseColor: '#8ecbff',
    colorRamp: [
      { time: 0, color: '#6eb9ff' },
      { time: 0.6, color: '#c3ecff' },
      { time: 1, color: '#ffffff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.18 * strength },
      { time: 0.7, size: 0.36 * strength },
      { time: 1, size: 0.04 },
    ],
    position,
    positionJitter: { x: 0.32 * strength, y: 0.24, z: 0.32 * strength },
    velocity: { x: 0, y: 1.4 + 0.6 * strength, z: 0 },
    velocityJitter: { x: 0.5, y: 0.38, z: 0.5 },
    size: { min: 0.16 * strength, max: 0.3 * strength },
    gravity: { x: 0, y: 1.8, z: 0 },
    drag: 1.05,
    fadeIn: 0.1,
    fadeOut: 0.25,
    opacity: 0.9,
    depthWrite: false,
  })
  baseEmitter.debugLabel = 'WaterBubbleParticles'
  return createBurstWrapper(baseEmitter, {
    duration: duration ?? 0.55,
    label: 'WaterBubbleBurst',
  })
}

export function createWaterSurfaceMistEmitter({ position, intensity = 1 } = {}) {
  const mistStrength = Math.min(Math.max(intensity, 0.25), 2.5)
  const emitter = createGpuBillboardEmitter({
    spawnRate: 28 * mistStrength,
    maxParticles: Math.ceil(90 * mistStrength),
    lifetime: { min: 1.6, max: 2.6 },
    baseColor: '#a7d7ff',
    colorRamp: [
      { time: 0, color: '#72b9ff' },
      { time: 0.5, color: '#d9f1ff' },
      { time: 1, color: '#ffffff' },
    ],
    sizeOverLifetime: [
      { time: 0, size: 0.6 * mistStrength },
      { time: 0.55, size: 1.35 * mistStrength },
      { time: 1, size: 1.8 * mistStrength },
    ],
    position,
    positionJitter: { x: 1.6 * mistStrength, y: 0.2, z: 1.6 * mistStrength },
    velocity: { x: 0, y: 0.38 + 0.18 * mistStrength, z: 0 },
    velocityJitter: { x: 0.24, y: 0.32, z: 0.24 },
    size: { min: 0.82 * mistStrength, max: 1.8 * mistStrength },
    gravity: { x: 0, y: 0.58, z: 0 },
    drag: 0.85,
    fadeIn: 0.2,
    fadeOut: 0.35,
    opacity: 0.48,
    depthWrite: false,
  })
  emitter.debugLabel = 'WaterSurfaceMist'
  return emitter
}
