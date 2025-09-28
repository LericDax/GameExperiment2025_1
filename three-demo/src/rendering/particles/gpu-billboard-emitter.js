import { gpuParticleVertexShader } from '../shaders/gpu-particle-vertex.glsl.js'
import { gpuParticleFragmentShader } from '../shaders/gpu-particle-fragment.glsl.js'

const MAX_COLOR_STOPS = 8
const MAX_SIZE_STOPS = 8

const quadGeometryCache = new WeakMap()

function resolveVector3(THREE, value, fallback) {
  if (!value) {
    return fallback.clone()
  }
  if (value.isVector3) {
    return value.clone()
  }
  const vec = new THREE.Vector3()
  if (Array.isArray(value)) {
    vec.fromArray(value)
  } else {
    vec.set(
      'x' in value ? value.x : fallback.x,
      'y' in value ? value.y : fallback.y,
      'z' in value ? value.z : fallback.z,
    )
  }
  return vec
}

function resolveColor(THREE, value, fallback) {
  const color = new THREE.Color()
  if (value === undefined || value === null) {
    color.copy(fallback)
  } else if (value.isColor) {
    color.copy(value)
  } else {
    color.set(value)
  }
  return color
}

function resolveRange(value, defaultValue) {
  if (value === undefined || value === null) {
    return { min: defaultValue, max: defaultValue }
  }
  if (typeof value === 'number') {
    return { min: value, max: value }
  }
  const min = 'min' in value ? Number(value.min) : defaultValue
  const max = 'max' in value ? Number(value.max) : defaultValue
  return {
    min: Number.isFinite(min) ? min : defaultValue,
    max: Number.isFinite(max) ? max : defaultValue,
  }
}

function getQuadGeometry(THREE) {
  let geometry = quadGeometryCache.get(THREE)
  if (!geometry) {
    geometry = new THREE.BufferGeometry()
    const positions = new Float32Array([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ])
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ])
    const indices = [0, 1, 2, 0, 2, 3]
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    quadGeometryCache.set(THREE, geometry)
  }
  return geometry
}

function normaliseStops(stops, maxStops, defaultStops, clampValue = (v) => v) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return defaultStops
  }
  const normalised = stops
    .map((stop) => ({
      time: clampValue(stop.time ?? 0),
      value: stop,
    }))
    .sort((a, b) => a.time - b.time)
  if (normalised.length === 0) {
    return defaultStops
  }
  return normalised.slice(0, maxStops)
}

function applyColorRampToUniforms(THREE, uniforms, stops) {
  const defaultStops = [
    { time: 0, value: { color: new THREE.Color(0xffffff) } },
    { time: 1, value: { color: new THREE.Color(0xffffff) } },
  ]
  const normalised = normaliseStops(
    stops,
    MAX_COLOR_STOPS,
    defaultStops,
    (value) => THREE.MathUtils.clamp(value, 0, 1),
  )
  const uniformArray = uniforms.uColorStops.value
  const count = Math.min(normalised.length, MAX_COLOR_STOPS)
  for (let i = 0; i < count; i += 1) {
    const stop = normalised[i]
    const color = resolveColor(THREE, stop.value.color ?? 0xffffff, new THREE.Color(0xffffff))
    uniformArray[i].set(color.r, color.g, color.b, THREE.MathUtils.clamp(stop.time, 0, 1))
  }
  if (count > 0) {
    const last = uniformArray[count - 1]
    for (let i = count; i < MAX_COLOR_STOPS; i += 1) {
      uniformArray[i].copy(last)
    }
  }
  uniforms.uColorStopCount.value = count
}

function applySizeCurveToUniforms(THREE, uniforms, stops) {
  const defaultStops = [
    { time: 0, value: { size: 0 } },
    { time: 0.1, value: { size: 1 } },
    { time: 1, value: { size: 0 } },
  ]
  const normalised = normaliseStops(
    stops,
    MAX_SIZE_STOPS,
    defaultStops,
    (value) => THREE.MathUtils.clamp(value, 0, 1),
  )
  const uniformArray = uniforms.uSizeStops.value
  const count = Math.min(normalised.length, MAX_SIZE_STOPS)
  for (let i = 0; i < count; i += 1) {
    const stop = normalised[i]
    const sizeValue = Number.isFinite(stop.value.size)
      ? stop.value.size
      : Number.isFinite(stop.value.value)
        ? stop.value.value
        : 1
    uniformArray[i].set(THREE.MathUtils.clamp(stop.time, 0, 1), sizeValue)
  }
  if (count > 0) {
    const last = uniformArray[count - 1]
    for (let i = count; i < MAX_SIZE_STOPS; i += 1) {
      uniformArray[i].copy(last)
    }
  }
  uniforms.uSizeStopCount.value = count
}

function createMaterial(THREE, options) {
  const {
    gravity,
    drag,
    fadeIn,
    fadeOut,
    colorRamp,
    sizeOverLifetime,
    blending,
    depthWrite,
    depthTest,
  } = options

  const uniforms = {
    uTime: { value: 0 },
    uGravity: { value: gravity.clone() },
    uDrag: { value: Math.max(0, drag) },
    uFadeInOut: { value: new THREE.Vector2(Math.max(0, fadeIn), Math.max(0, fadeOut)) },
    uColorStops: {
      value: Array.from({ length: MAX_COLOR_STOPS }, () => new THREE.Vector4(1, 1, 1, 1)),
    },
    uColorStopCount: { value: 0 },
    uSizeStops: {
      value: Array.from({ length: MAX_SIZE_STOPS }, () => new THREE.Vector2(0, 1)),
    },
    uSizeStopCount: { value: 0 },
  }

  applyColorRampToUniforms(THREE, uniforms, colorRamp)
  applySizeCurveToUniforms(THREE, uniforms, sizeOverLifetime)

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: depthWrite ?? false,
    depthTest: depthTest ?? true,
    blending: blending ?? THREE.AdditiveBlending,
    vertexShader: gpuParticleVertexShader,
    fragmentShader: gpuParticleFragmentShader,
  })

  material.uniformsNeedUpdate = true

  return material
}

function jitterVector(base, jitter, target) {
  target.copy(base)
  if (jitter) {
    target.x += (Math.random() * 2 - 1) * jitter.x
    target.y += (Math.random() * 2 - 1) * jitter.y
    target.z += (Math.random() * 2 - 1) * jitter.z
  }
  return target
}

/**
 * Creates a GPU-backed billboard particle emitter.
 *
 * @param {Object} [options]
 * @param {number} [options.spawnRate=24] Particles emitted per second.
 * @param {number} [options.maxParticles=256] Maximum alive particles before recycling.
 * @param {number|{min:number,max:number}} [options.lifetime=1.5] Particle lifetime in seconds.
 * @param {import('three').ColorRepresentation} [options.baseColor=0xffffff] Base tint multiplied with the color ramp.
 * @param {Array<{time:number,color:import('three').ColorRepresentation}>} [options.colorRamp]
 *   Normalised color ramp stops in the `[0,1]` range.
 * @param {Array<{time:number,size:number}>} [options.sizeOverLifetime]
 *   Curve describing how particle scale evolves over its lifetime.
 * @param {import('three').Vector3|Array|Object} [options.position] Base spawn position.
 * @param {import('three').Vector3|Array|Object} [options.positionJitter]
 *   Per-axis random offset applied to the spawn position.
 * @param {import('three').Vector3|Array|Object} [options.velocity] Base particle velocity.
 * @param {import('three').Vector3|Array|Object} [options.velocityJitter]
 *   Per-axis random offset applied to the initial velocity.
 * @param {number|{min:number,max:number}} [options.size=0.6] Base billboard size in world units.
 * @param {number} [options.sizeJitter=0.2] Scalar noise applied to the size.
 * @param {import('three').Vector3|Array|Object} [options.gravity]
 *   Acceleration applied to particles in world space.
 * @param {number} [options.drag=1.5] Linear drag coefficient used in the shader integration.
 * @param {number} [options.fadeIn=0.1] Normalised time window for fade-in (0..1).
 * @param {number} [options.fadeOut=0.25] Normalised time window for fade-out (0..1).
 * @param {number} [options.opacity=1] Overall alpha multiplier per particle.
 * @param {import('three').Blending} [options.blending=THREE.AdditiveBlending] Material blending mode.
 * @param {boolean} [options.depthWrite=false] Whether the particles should write to the depth buffer.
 * @param {boolean} [options.depthTest=true] Whether the particles participate in depth testing.
 * @param {number} [options.renderOrder] Optional render order override for the instanced mesh.
 */
export function createGpuBillboardEmitter(options = {}) {
  const {
    spawnRate = 24,
    maxParticles = 256,
    lifetime = 1.5,
    baseColor = 0xffffff,
    colorRamp = null,
    sizeOverLifetime = null,
    position = null,
    positionJitter = null,
    velocity = null,
    velocityJitter = null,
    size = 0.6,
    sizeJitter = 0.2,
    gravity = null,
    drag = 1.5,
    fadeIn = 0.1,
    fadeOut = 0.25,
    opacity = 1,
    blending = undefined,
    depthWrite = undefined,
    depthTest = undefined,
    renderOrder = undefined,
  } = options

  const clampedOpacity = Math.max(0, Math.min(1, opacity))

  let pool = null
  let material = null
  let basePosition
  let positionNoise
  let baseVelocity
  let velocityNoise
  let baseTint
  let minSize
  let maxSize
  let lifetimeRange
  let gravityVector
  let spawnAccumulator = 0
  /** @type {{index:number, spawnTime:number, lifetime:number}[]} */
  const liveParticles = []
  let tempPosition = null
  let tempVelocity = null

  function ensureTempVectors(THREE) {
    if (!tempPosition) {
      tempPosition = new THREE.Vector3()
    }
    if (!tempVelocity) {
      tempVelocity = new THREE.Vector3()
    }
  }

  function spawnParticle(now) {
    if (!pool) {
      return
    }
    if (maxParticles <= 0 || pool.getActiveCount() >= maxParticles) {
      return
    }
    const instanceIndex = pool.allocateInstance()
    if (instanceIndex < 0) {
      return
    }
    const sizeValue = Math.max(0.001, minSize + Math.random() * (maxSize - minSize))

    const positionVec = jitterVector(basePosition, positionNoise, tempPosition)
    const velocityVec = jitterVector(baseVelocity, velocityNoise, tempVelocity)

    pool.setAttributeValues('aOrigin', instanceIndex, [positionVec.x, positionVec.y, positionVec.z])
    pool.setAttributeValues('aVelocity', instanceIndex, [velocityVec.x, velocityVec.y, velocityVec.z])
    pool.setAttributeValues('aColor', instanceIndex, [baseTint.r, baseTint.g, baseTint.b, clampedOpacity])
    pool.setAttributeValues('aSize', instanceIndex, [sizeValue, 0])

    const lifetimeValue = Math.max(
      0.01,
      lifetimeRange.min + Math.random() * (lifetimeRange.max - lifetimeRange.min),
    )
    pool.setAttributeValues('aLifetime', instanceIndex, [now, lifetimeValue])

    liveParticles.push({ index: instanceIndex, spawnTime: now, lifetime: lifetimeValue })
  }

  function recycleExpired(now) {
    for (let i = liveParticles.length - 1; i >= 0; i -= 1) {
      const particle = liveParticles[i]
      if (now - particle.spawnTime >= particle.lifetime) {
        pool?.releaseInstance(particle.index)
        liveParticles.splice(i, 1)
      }
    }
  }

  return {
    initialize({ THREE, createInstancedPool, getElapsedTime }) {
      ensureTempVectors(THREE)
      basePosition = resolveVector3(THREE, position, new THREE.Vector3())
      positionNoise = positionJitter
        ? resolveVector3(THREE, positionJitter, new THREE.Vector3())
        : new THREE.Vector3()
      baseVelocity = resolveVector3(THREE, velocity ?? { x: 0, y: 4, z: 0 }, new THREE.Vector3(0, 4, 0))
      velocityNoise = velocityJitter
        ? resolveVector3(THREE, velocityJitter, new THREE.Vector3())
        : new THREE.Vector3(0, 0, 0)
      baseTint = resolveColor(THREE, baseColor, new THREE.Color(0xffffff))
      const resolvedSize = resolveRange(size, 0.6)
      const baseMin = Math.max(0.001, resolvedSize.min)
      const baseMax = Math.max(baseMin, resolvedSize.max)
      const jitterAmount = Math.abs(sizeJitter)
      minSize = Math.max(0.001, baseMin - jitterAmount)
      maxSize = Math.max(minSize, baseMax + jitterAmount)
      lifetimeRange = resolveRange(lifetime, 1.5)
      lifetimeRange.min = Math.max(0.01, lifetimeRange.min)
      lifetimeRange.max = Math.max(lifetimeRange.min, lifetimeRange.max)
      gravityVector = resolveVector3(THREE, gravity ?? { x: 0, y: -9.81, z: 0 }, new THREE.Vector3(0, -9.81, 0))

      material = createMaterial(THREE, {
        gravity: gravityVector,
        drag,
        fadeIn,
        fadeOut,
        colorRamp,
        sizeOverLifetime,
        blending,
        depthWrite,
        depthTest,
      })

      const baseGeometry = getQuadGeometry(THREE)

      const resolvedCapacity = Number.isFinite(maxParticles)
        ? Math.max(1, Math.ceil(maxParticles))
        : 256

      pool = createInstancedPool({
        baseGeometry,
        material,
        capacity: resolvedCapacity,
        frustumCulled: false,
        attributes: [
          { name: 'aOrigin', itemSize: 3 },
          { name: 'aVelocity', itemSize: 3 },
          { name: 'aColor', itemSize: 4 },
          { name: 'aSize', itemSize: 2 },
          { name: 'aLifetime', itemSize: 2 },
        ],
      })

      if (renderOrder !== undefined && pool.mesh) {
        pool.mesh.renderOrder = renderOrder
      }

      spawnAccumulator = 0
      liveParticles.length = 0

      const now = getElapsedTime?.() ?? 0
      material.uniforms.uTime.value = now
    },

    update({ delta, getElapsedTime }) {
      if (!pool || !material) {
        return false
      }
      const now = getElapsedTime?.() ?? 0
      material.uniforms.uTime.value = now

      recycleExpired(now)

      if (maxParticles <= 0) {
        spawnAccumulator = 0
        return liveParticles.length > 0
      }

      spawnAccumulator += Math.max(0, delta) * Math.max(0, spawnRate)
      let toSpawn = Math.floor(spawnAccumulator)
      spawnAccumulator -= toSpawn
      while (toSpawn > 0 && pool.getActiveCount() < maxParticles) {
        spawnParticle(now)
        toSpawn -= 1
      }

      return liveParticles.length > 0 || spawnRate > 0
    },

    getActiveParticleCount() {
      return pool ? pool.getActiveCount() : 0
    },

    dispose() {
      liveParticles.length = 0
      pool = null
      material = null
    },
  }
}
