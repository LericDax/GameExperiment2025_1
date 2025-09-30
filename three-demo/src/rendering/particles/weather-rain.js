import * as THREE from 'three'
import { createGpuBillboardEmitter } from './gpu-billboard-emitter.js'
import { weatherRainAdvancedFragmentShader } from '../shaders/weather-rain-advanced.glsl.js'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function createWeatherRainEmitter({
  intensity = 0.6,
  radius = 12,
  heightOffset = 14,
  windTilt = null,
  streakNoise = null,
  highlightWidth = null,
  rippleScale = null,
  dropDensity = null,
  timerBias = null,
} = {}) {
  const density = clamp(intensity, 0.2, 2.4)
  const normalized = clamp((density - 0.2) / (2.4 - 0.2), 0, 1)
  const spawnRadius = Math.max(6, radius)
  const baseWindTilt = THREE.MathUtils.lerp(0.045, 0.28, normalized)
  const baseStreakNoise = THREE.MathUtils.lerp(0.38, 0.9, normalized)
  const baseHighlightWidth = THREE.MathUtils.lerp(0.22, 0.095, normalized)
  const baseRippleScale = THREE.MathUtils.lerp(1.6, 0.95, normalized)
  const baseDropDensity = THREE.MathUtils.lerp(0.6, 1.35, normalized)
  const baseTimerBias = THREE.MathUtils.lerp(0.22, 0.46, normalized)

  const uniformState = {
    windTilt: Number.isFinite(windTilt) ? windTilt : baseWindTilt,
    streakNoise: Number.isFinite(streakNoise) ? streakNoise : baseStreakNoise,
    highlightWidth: Number.isFinite(highlightWidth)
      ? Math.max(0.02, highlightWidth)
      : baseHighlightWidth,
    rippleScale: Number.isFinite(rippleScale)
      ? Math.max(0.25, rippleScale)
      : baseRippleScale,
    dropDensity: Number.isFinite(dropDensity)
      ? Math.max(0.1, dropDensity)
      : baseDropDensity,
    timerBias: Number.isFinite(timerBias) ? timerBias : baseTimerBias,
  }

  const baseUniforms = {
    windTilt: baseWindTilt,
    streakNoise: baseStreakNoise,
    highlightWidth: baseHighlightWidth,
    rippleScale: baseRippleScale,
    dropDensity: baseDropDensity,
    timerBias: baseTimerBias,
  }

  let materialRef = null

  const applyUniforms = () => {
    if (!materialRef) {
      return
    }
    if (materialRef.uniforms.uWindTilt) {
      materialRef.uniforms.uWindTilt.value = uniformState.windTilt
    }
    if (materialRef.uniforms.uStreakNoise) {
      materialRef.uniforms.uStreakNoise.value = uniformState.streakNoise
    }
    if (materialRef.uniforms.uHighlightWidth) {
      materialRef.uniforms.uHighlightWidth.value = uniformState.highlightWidth
    }
    if (materialRef.uniforms.uRippleScale) {
      materialRef.uniforms.uRippleScale.value = uniformState.rippleScale
    }
    if (materialRef.uniforms.uDropDensity) {
      materialRef.uniforms.uDropDensity.value = uniformState.dropDensity
    }
    if (materialRef.uniforms.uTimerBias) {
      materialRef.uniforms.uTimerBias.value = uniformState.timerBias
    }
    materialRef.uniformsNeedUpdate = true
    materialRef.needsUpdate = true
  }

  const setUniformOverrides = (overrides = {}) => {
    if (overrides.windTilt !== undefined) {
      if (overrides.windTilt === null) {
        uniformState.windTilt = baseUniforms.windTilt
      } else if (Number.isFinite(overrides.windTilt)) {
        uniformState.windTilt = overrides.windTilt
      }
    }
    if (overrides.streakNoise !== undefined) {
      if (overrides.streakNoise === null) {
        uniformState.streakNoise = baseUniforms.streakNoise
      } else if (Number.isFinite(overrides.streakNoise)) {
        uniformState.streakNoise = overrides.streakNoise
      }
    }
    if (overrides.highlightWidth !== undefined) {
      if (overrides.highlightWidth === null) {
        uniformState.highlightWidth = baseUniforms.highlightWidth
      } else if (Number.isFinite(overrides.highlightWidth)) {
        uniformState.highlightWidth = Math.max(0.02, overrides.highlightWidth)
      }
    }
    if (overrides.rippleScale !== undefined) {
      if (overrides.rippleScale === null) {
        uniformState.rippleScale = baseUniforms.rippleScale
      } else if (Number.isFinite(overrides.rippleScale)) {
        uniformState.rippleScale = Math.max(0.25, overrides.rippleScale)
      }
    }
    if (overrides.dropDensity !== undefined) {
      if (overrides.dropDensity === null) {
        uniformState.dropDensity = baseUniforms.dropDensity
      } else if (Number.isFinite(overrides.dropDensity)) {
        uniformState.dropDensity = Math.max(0.1, overrides.dropDensity)
      }
    }
    if (overrides.timerBias !== undefined) {
      if (overrides.timerBias === null) {
        uniformState.timerBias = baseUniforms.timerBias
      } else if (Number.isFinite(overrides.timerBias)) {
        uniformState.timerBias = overrides.timerBias
      }
    }
    applyUniforms()
  }

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
    size: { min: 0.35, max: 0.45 },
    sizeJitter: 0.08,
    lengthMultiplier: { min: 9, max: 14 },
    gravity: { x: 0, y: -21.6, z: 0 },
    drag: 0.12,
    fadeIn: 0.06,
    fadeOut: 0.34,
    opacity: 0.94,
    blending: THREE.NormalBlending,
    depthWrite: false,
    renderOrder: 4,
    materialFactory: ({ defaultFactory }) => {
      const material = defaultFactory()
      material.fragmentShader = weatherRainAdvancedFragmentShader
      material.uniforms.uWindTilt = { value: uniformState.windTilt }
      material.uniforms.uStreakNoise = { value: uniformState.streakNoise }
      material.uniforms.uHighlightWidth = { value: uniformState.highlightWidth }
      material.uniforms.uRippleScale = { value: uniformState.rippleScale }
      material.uniforms.uDropDensity = { value: uniformState.dropDensity }
      material.uniforms.uTimerBias = { value: uniformState.timerBias }
      materialRef = material
      applyUniforms()
      return material
    },
  })
  emitter.debugLabel = 'WeatherRainEmitter/BrightStreakPass'
  emitter.weatherAnchorOffset = { x: 0, y: heightOffset, z: 0 }
  emitter.weatherUpdateInterval = 0.12
  emitter.weatherMinAnchorDistance = Math.max(spawnRadius * 0.2, 1.6)
  emitter.weatherWind = {
    base: { ...baseUniforms },
    current: () => ({ ...uniformState }),
  }
  emitter.getWeatherRainShaderUniforms = () => ({ ...uniformState })
  emitter.getWeatherRainShaderBaseUniforms = () => ({ ...baseUniforms })
  emitter.setWeatherRainShaderUniforms = (overrides) => {
    setUniformOverrides(overrides)
  }

  return emitter
}
