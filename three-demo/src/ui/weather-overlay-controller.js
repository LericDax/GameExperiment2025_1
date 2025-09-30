const OVERLAY_ID = 'weather-overlay'
const RAINDROP_CLASS = 'raindrop'
const RAINDROP_STREAK_CLASS = `${RAINDROP_CLASS}--streak`
const RAINDROP_DROPLET_CLASS = `${RAINDROP_CLASS}--droplet`
const RAINDROP_DROPLETTE_CLASS = `${RAINDROP_CLASS}--droplette`
const INTENSITY_VAR = '--rain-intensity'
const WIND_SWAY_VAR = '--rain-wind'
const DENSITY_VAR = '--rain-density'
const VELOCITY_VAR = '--rain-velocity'
const SNOWFLAKE_CLASS = 'snowflake'
const SNOWPUFF_CLASS = 'snowpuff'
const SNOWFLAKE_DENSITY_VAR = '--snowflake-density'
const SNOWPUFF_DENSITY_VAR = '--snowpuff-density'
const MODE_ATTR = 'data-weather-mode'
const MODE_RAIN = 'rain'
const MODE_SNOW = 'snow'

function parseDensityPreference(root) {
  const source = root?.dataset?.weatherDropletCount ?? document.body?.dataset?.weatherDropletCount
  if (!source) {
    return null
  }
  const value = Number.parseInt(source, 10)
  if (!Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.round(value))
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value))
}

function createBaseRaindrop({
  modifierClass,
  leftRange = [0, 100],
  delayRange = [-5, 0],
  scaleRange = [0.6, 1.3],
}) {
  const drop = document.createElement('span')
  drop.className = `${RAINDROP_CLASS} ${modifierClass}`
  drop.setAttribute('aria-hidden', 'true')

  const baseLeft = randomRange(leftRange[0], leftRange[1])
  const baseDelay = randomRange(delayRange[0], delayRange[1])
  const baseScale = randomRange(scaleRange[0], scaleRange[1])

  drop.dataset.baseLeft = `${baseLeft}`
  drop.dataset.baseDelay = `${baseDelay}`
  drop.dataset.baseScale = `${baseScale}`
  drop.dataset.phase = `${Math.random()}`

  drop.style.setProperty('--raindrop-left', `${baseLeft}%`)
  drop.style.setProperty('--raindrop-delay', `${baseDelay}s`)
  drop.style.setProperty('--raindrop-scale', `${baseScale}`)
  drop.style.setProperty('--raindrop-duration', '1.2s')

  return drop
}

function createStreakElement() {
  const drop = createBaseRaindrop({
    modifierClass: RAINDROP_STREAK_CLASS,
    scaleRange: [0.55, 1.1],
  })
  drop.dataset.baseDuration = `${randomRange(0.9, 1.6)}`
  drop.dataset.baseSway = `${randomRange(-14, 14)}`
  drop.dataset.baseStartOffset = `${randomRange(0, 26)}`
  drop.style.setProperty('--raindrop-start', `${-120 - Number(drop.dataset.baseStartOffset)}vh`)
  drop.style.setProperty('--raindrop-end', '118vh')
  drop.style.setProperty('--raindrop-sway', `${randomRange(-6, 6)}px`)
  return drop
}

function createDropletElement() {
  const drop = createBaseRaindrop({
    modifierClass: RAINDROP_DROPLET_CLASS,
    leftRange: [8, 92],
    delayRange: [-8, 0],
    scaleRange: [0.7, 1.35],
  })
  drop.dataset.baseDuration = `${randomRange(2.4, 4.2)}`
  drop.dataset.baseSway = `${randomRange(18, 42)}`
  drop.dataset.baseStart = `${randomRange(-32, -8)}`
  drop.dataset.baseEnd = `${randomRange(42, 105)}`
  drop.dataset.orbit = `${randomRange(6, 18)}`
  drop.style.setProperty('--raindrop-start', `${drop.dataset.baseStart}vh`)
  drop.style.setProperty('--raindrop-end', `${drop.dataset.baseEnd}vh`)
  drop.style.setProperty('--raindrop-sway', `${randomRange(-12, 12)}px`)
  return drop
}

function createDropletteElement() {
  const drop = createBaseRaindrop({
    modifierClass: RAINDROP_DROPLETTE_CLASS,
    leftRange: [4, 96],
    delayRange: [-10, 0],
    scaleRange: [0.4, 0.85],
  })
  drop.dataset.baseDuration = `${randomRange(1.8, 3.4)}`
  drop.dataset.baseSway = `${randomRange(22, 58)}`
  drop.dataset.baseStart = `${randomRange(-56, -18)}`
  drop.dataset.baseEnd = `${randomRange(30, 88)}`
  drop.dataset.orbit = `${randomRange(4, 14)}`
  drop.style.setProperty('--raindrop-start', `${drop.dataset.baseStart}vh`)
  drop.style.setProperty('--raindrop-end', `${drop.dataset.baseEnd}vh`)
  drop.style.setProperty('--raindrop-sway', `${randomRange(-16, 16)}px`)
  return drop
}

function createBaseSnowParticle({
  className,
  prefix,
  leftRange,
  delayRange,
  scaleRange,
  durationRange,
  startRange,
  endRange,
  swayRange,
  driftRange,
  spinRange,
  bobRange,
}) {
  const particle = document.createElement('span')
  particle.className = className
  particle.setAttribute('aria-hidden', 'true')

  const baseLeft = randomRange(leftRange[0], leftRange[1])
  const baseDelay = randomRange(delayRange[0], delayRange[1])
  const baseScale = randomRange(scaleRange[0], scaleRange[1])
  const baseDuration = randomRange(durationRange[0], durationRange[1])
  const baseStart = randomRange(startRange[0], startRange[1])
  const baseEnd = randomRange(endRange[0], endRange[1])
  const baseSway = randomRange(swayRange[0], swayRange[1])
  const baseDrift = randomRange(driftRange[0], driftRange[1])
  const baseSpin = randomRange(spinRange[0], spinRange[1])
  const baseBob = randomRange(bobRange[0], bobRange[1])
  const rotationDir = Math.random() > 0.5 ? 1 : -1
  const phase = Math.random()

  particle.dataset.baseLeft = `${baseLeft}`
  particle.dataset.baseDelay = `${baseDelay}`
  particle.dataset.baseScale = `${baseScale}`
  particle.dataset.baseDuration = `${baseDuration}`
  particle.dataset.baseStart = `${baseStart}`
  particle.dataset.baseEnd = `${baseEnd}`
  particle.dataset.baseSway = `${baseSway}`
  particle.dataset.baseDrift = `${baseDrift}`
  particle.dataset.baseSpin = `${baseSpin}`
  particle.dataset.baseBob = `${baseBob}`
  particle.dataset.rotationDir = `${rotationDir}`
  particle.dataset.phase = `${phase}`

  particle.style.setProperty(`--${prefix}-left`, `${baseLeft}%`)
  particle.style.setProperty(`--${prefix}-delay`, `${baseDelay}s`)
  particle.style.setProperty(`--${prefix}-scale`, `${baseScale}`)
  particle.style.setProperty(`--${prefix}-fall-duration`, `${baseDuration}s`)
  particle.style.setProperty(`--${prefix}-spin-duration`, `${baseSpin}s`)
  particle.style.setProperty(`--${prefix}-start`, `${baseStart}vh`)
  particle.style.setProperty(`--${prefix}-end`, `${baseEnd}vh`)
  particle.style.setProperty(`--${prefix}-sway`, `${baseSway}px`)
  particle.style.setProperty(`--${prefix}-drift`, `${baseDrift}px`)
  particle.style.setProperty(`--${prefix}-bob`, `${baseBob}vh`)
  particle.style.setProperty(`--${prefix}-rotation-dir`, `${rotationDir}`)

  return particle
}

function createSnowflakeElement() {
  return createBaseSnowParticle({
    className: SNOWFLAKE_CLASS,
    prefix: 'snowflake',
    leftRange: [-6, 106],
    delayRange: [-12, 0],
    scaleRange: [0.55, 1.4],
    durationRange: [9, 16],
    startRange: [-48, -14],
    endRange: [58, 116],
    swayRange: [18, 42],
    driftRange: [12, 28],
    spinRange: [14, 28],
    bobRange: [6, 18],
  })
}

function createSnowpuffElement() {
  return createBaseSnowParticle({
    className: SNOWPUFF_CLASS,
    prefix: 'snowpuff',
    leftRange: [-8, 108],
    delayRange: [-14, 0],
    scaleRange: [0.85, 1.95],
    durationRange: [12, 20],
    startRange: [-54, -18],
    endRange: [62, 118],
    swayRange: [22, 46],
    driftRange: [18, 36],
    spinRange: [18, 32],
    bobRange: [8, 22],
  })
}

function updateStreakElement(element, { intensity, density }) {
  const baseDuration = Number.parseFloat(element.dataset.baseDuration) || 1.2
  const baseSway = Number.parseFloat(element.dataset.baseSway) || 0
  const startOffset = Number.parseFloat(element.dataset.baseStartOffset) || 0

  const intensityStrength = Math.max(0, Math.min(Number.isFinite(intensity) ? intensity : 0, 4))
  const densityStrength = Math.max(0, Math.min(Number.isFinite(density) ? density : 0, 4))

  const speedFactor = 0.65 + intensityStrength * 0.25 + densityStrength * 0.08
  const duration = baseDuration / Math.max(0.3, speedFactor)
  const sway = baseSway * (0.5 + intensityStrength * 0.18)
  const start = -120 - startOffset - densityStrength * 9.5
  const end = 112 + intensityStrength * 12

  element.style.setProperty('--raindrop-duration', `${duration.toFixed(3)}s`)
  element.style.setProperty('--raindrop-sway', `${sway.toFixed(2)}px`)
  element.style.setProperty('--raindrop-start', `${start.toFixed(2)}vh`)
  element.style.setProperty('--raindrop-end', `${end.toFixed(2)}vh`)
}

function updateDropletElement(element, { intensity, density }) {
  const baseDuration = Number.parseFloat(element.dataset.baseDuration) || 3.2
  const baseSway = Number.parseFloat(element.dataset.baseSway) || 24
  const baseStart = Number.parseFloat(element.dataset.baseStart) || -18
  const baseEnd = Number.parseFloat(element.dataset.baseEnd) || 72
  const orbit = Number.parseFloat(element.dataset.orbit) || 12
  const baseLeft = Number.parseFloat(element.dataset.baseLeft) || 50
  const phase = Number.parseFloat(element.dataset.phase) || 0

  const intensityStrength = Math.max(0, Math.min(Number.isFinite(intensity) ? intensity : 0, 4))
  const densityStrength = Math.max(0, Math.min(Number.isFinite(density) ? density : 0, 4))

  const glideFactor = 0.6 + intensityStrength * 0.28
  const duration = baseDuration / Math.max(0.35, glideFactor)
  const sway = baseSway * (0.35 + Math.min(intensityStrength + densityStrength, 4) * 0.18)
  const start = baseStart - densityStrength * 4.5
  const end = baseEnd + intensityStrength * 7.5
  const wander = orbit * (0.3 + Math.min(intensityStrength + densityStrength, 4) * 0.2)
  const leftOffset = Math.sin((intensityStrength + densityStrength + phase) * Math.PI) * wander
  const left = clampPercent(baseLeft + leftOffset)

  element.style.setProperty('--raindrop-duration', `${duration.toFixed(3)}s`)
  element.style.setProperty('--raindrop-sway', `${sway.toFixed(2)}px`)
  element.style.setProperty('--raindrop-start', `${start.toFixed(2)}vh`)
  element.style.setProperty('--raindrop-end', `${end.toFixed(2)}vh`)
  element.style.setProperty('--raindrop-left', `${left.toFixed(2)}%`)
}

function updateDropletteElement(element, { intensity, density }) {
  const baseDuration = Number.parseFloat(element.dataset.baseDuration) || 2.4
  const baseSway = Number.parseFloat(element.dataset.baseSway) || 30
  const baseStart = Number.parseFloat(element.dataset.baseStart) || -40
  const baseEnd = Number.parseFloat(element.dataset.baseEnd) || 54
  const orbit = Number.parseFloat(element.dataset.orbit) || 8
  const baseLeft = Number.parseFloat(element.dataset.baseLeft) || 50
  const phase = Number.parseFloat(element.dataset.phase) || 0

  const intensityStrength = Math.max(0, Math.min(Number.isFinite(intensity) ? intensity : 0, 4.5))
  const densityStrength = Math.max(0, Math.min(Number.isFinite(density) ? density : 0, 4.5))
  const combined = Math.min(intensityStrength + densityStrength, 5)

  const flutterFactor = 0.58 + intensityStrength * 0.22 + densityStrength * 0.12
  const duration = baseDuration / Math.max(0.3, flutterFactor)
  const sway = baseSway * (0.28 + combined * 0.22)
  const start = baseStart - densityStrength * 6.5
  const end = baseEnd + intensityStrength * 5.5
  const wander = orbit * (0.45 + combined * 0.15)
  const phaseOffset = (combined + phase) * Math.PI * 1.6
  const leftOffset = Math.sin(phaseOffset) * wander
  const left = clampPercent(baseLeft + leftOffset)

  element.style.setProperty('--raindrop-duration', `${duration.toFixed(3)}s`)
  element.style.setProperty('--raindrop-sway', `${sway.toFixed(2)}px`)
  element.style.setProperty('--raindrop-start', `${start.toFixed(2)}vh`)
  element.style.setProperty('--raindrop-end', `${end.toFixed(2)}vh`)
  element.style.setProperty('--raindrop-left', `${left.toFixed(2)}%`)
}

function updateSnowflakeElement(element, { intensity, density, flakeDensity }) {
  const baseDuration = Number.parseFloat(element.dataset.baseDuration) || 12
  const baseSway = Number.parseFloat(element.dataset.baseSway) || 24
  const baseDrift = Number.parseFloat(element.dataset.baseDrift) || 18
  const baseSpin = Number.parseFloat(element.dataset.baseSpin) || 18
  const baseBob = Number.parseFloat(element.dataset.baseBob) || 12
  const rotationDir = Number.parseFloat(element.dataset.rotationDir) || 1
  const baseScale = Number.parseFloat(element.dataset.baseScale) || 1

  const intensityStrength = Math.max(0, Math.min(Number.isFinite(intensity) ? intensity : 0, 4))
  const flakeStrength = Math.max(0, Math.min(Number.isFinite(density) ? density : 0, 8))
  const fieldStrength = Math.max(0, Math.min(Number.isFinite(flakeDensity) ? flakeDensity : 0, 8))
  const combined = Math.min(intensityStrength + flakeStrength, 8)

  const fallFactor = Math.max(0.52, 1.08 - intensityStrength * 0.08 - flakeStrength * 0.05)
  const duration = Math.max(6, baseDuration * fallFactor)
  const sway = baseSway * (0.55 + combined * 0.12 + fieldStrength * 0.05)
  const drift = baseDrift * (0.4 + intensityStrength * 0.18 + flakeStrength * 0.12)
  const bob = baseBob * (0.35 + combined * 0.14)
  const spinDuration = Math.max(7.5, baseSpin * (1.25 + flakeStrength * 0.05))
  const opacity = Math.min(0.28 + combined * 0.08 + fieldStrength * 0.04, 0.85)
  const scale = baseScale * (0.95 + fieldStrength * 0.03)

  element.style.setProperty('--snowflake-fall-duration', `${duration.toFixed(3)}s`)
  element.style.setProperty('--snowflake-spin-duration', `${spinDuration.toFixed(3)}s`)
  element.style.setProperty('--snowflake-sway', `${sway.toFixed(2)}px`)
  element.style.setProperty('--snowflake-drift', `${drift.toFixed(2)}px`)
  element.style.setProperty('--snowflake-bob', `${bob.toFixed(2)}vh`)
  element.style.setProperty('--snowflake-opacity', `${opacity.toFixed(3)}`)
  element.style.setProperty('--snowflake-scale', `${scale.toFixed(3)}`)
  element.style.setProperty('--snowflake-rotation-dir', `${rotationDir >= 0 ? 1 : -1}`)
}

function updateSnowpuffElement(element, { intensity, density, flakeDensity, puffDensity }) {
  const baseDuration = Number.parseFloat(element.dataset.baseDuration) || 15
  const baseSway = Number.parseFloat(element.dataset.baseSway) || 28
  const baseDrift = Number.parseFloat(element.dataset.baseDrift) || 24
  const baseSpin = Number.parseFloat(element.dataset.baseSpin) || 22
  const baseBob = Number.parseFloat(element.dataset.baseBob) || 14
  const baseScale = Number.parseFloat(element.dataset.baseScale) || 1.1

  const intensityStrength = Math.max(0, Math.min(Number.isFinite(intensity) ? intensity : 0, 4))
  const puffStrength = Math.max(0, Math.min(Number.isFinite(density) ? density : 0, 8))
  const flakeStrength = Math.max(0, Math.min(Number.isFinite(flakeDensity) ? flakeDensity : 0, 8))
  const puffField = Math.max(0, Math.min(Number.isFinite(puffDensity) ? puffDensity : 0, 8))
  const combined = Math.min(intensityStrength + puffStrength + flakeStrength * 0.35, 10)

  const fallFactor = Math.max(0.58, 1.05 - intensityStrength * 0.05 - puffStrength * 0.06)
  const duration = Math.max(8.5, baseDuration * fallFactor)
  const sway = baseSway * (0.45 + combined * 0.1)
  const drift = baseDrift * (0.38 + intensityStrength * 0.16 + puffStrength * 0.12)
  const bob = baseBob * (0.4 + combined * 0.12)
  const spinDuration = Math.max(9, baseSpin * (1.18 + puffStrength * 0.04))
  const scale = baseScale * (1 + puffField * 0.06 + intensityStrength * 0.03)
  const opacity = Math.min(0.35 + puffStrength * 0.1 + flakeStrength * 0.05, 0.88)

  element.style.setProperty('--snowpuff-fall-duration', `${duration.toFixed(3)}s`)
  element.style.setProperty('--snowpuff-spin-duration', `${spinDuration.toFixed(3)}s`)
  element.style.setProperty('--snowpuff-sway', `${sway.toFixed(2)}px`)
  element.style.setProperty('--snowpuff-drift', `${drift.toFixed(2)}px`)
  element.style.setProperty('--snowpuff-bob', `${bob.toFixed(2)}vh`)
  element.style.setProperty('--snowpuff-scale', `${scale.toFixed(3)}`)
  element.style.setProperty('--snowpuff-opacity', `${opacity.toFixed(3)}`)
}

function sanitiseCssValue(value) {
  if (value === null || value === undefined) {
    return null
  }
  if (value === 'auto') {
    return 'auto'
  }
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    return null
  }
  return numeric
}

export function createWeatherOverlayController({ root = document.body } = {}) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new Error('createWeatherOverlayController requires a valid root element')
  }

  const host = root
  let overlayElement = document.getElementById(OVERLAY_ID)
  const createdOverlay = !overlayElement

  if (!overlayElement) {
    overlayElement = document.createElement('div')
    overlayElement.id = OVERLAY_ID
    overlayElement.setAttribute('aria-hidden', 'true')
    overlayElement.className = 'weather-overlay'
    overlayElement.style.position = 'fixed'
    overlayElement.style.top = '0'
    overlayElement.style.left = '0'
    overlayElement.style.width = '100%'
    overlayElement.style.height = '100%'
    overlayElement.style.pointerEvents = 'none'
    overlayElement.style.overflow = 'hidden'
    overlayElement.style.zIndex = '80'
    overlayElement.hidden = true
    overlayElement.style.display = 'none'
  }

  const desiredCount = parseDensityPreference(host) ?? 24
  const elementTypes = new Map()
  let currentIntensity = 0
  let currentDensity = 0
  let currentFlakeDensity = 0
  let currentPuffDensity = 0
  let currentMode = MODE_RAIN

  const removeElementsForType = (type) => {
    if (!type?.elements?.length) {
      return
    }
    type.elements.forEach((element) => {
      if (element.parentElement === overlayElement) {
        overlayElement.removeChild(element)
      }
    })
    type.elements.length = 0
  }

  const syncPools = () => {
    if (!overlayElement) {
      return
    }
    const intensityValue = Math.max(0, Number.isFinite(currentIntensity) ? currentIntensity : 0)
    const rainDensityValue = Math.max(0, Number.isFinite(currentDensity) ? currentDensity : 0)
    const flakeDensityValue = Math.max(
      0,
      Number.isFinite(currentFlakeDensity) ? currentFlakeDensity : 0,
    )
    const puffDensityValue = Math.max(
      0,
      Number.isFinite(currentPuffDensity) ? currentPuffDensity : 0,
    )

    elementTypes.forEach((type) => {
      if (!type) {
        return
      }
      const { elements } = type
      let densityValue = rainDensityValue
      switch (type.densityKey) {
        case 'flake':
          densityValue = flakeDensityValue
          break
        case 'puff':
          densityValue = puffDensityValue
          break
        default:
          densityValue = rainDensityValue
          break
      }
      const composite =
        type.bias +
        densityValue * type.densityScale +
        intensityValue * type.intensityScale
      const activeStrength = Math.max(0, composite)
      const shouldActivate = densityValue > 0 || activeStrength > type.minActivation

      let multiplier = 0
      if (shouldActivate) {
        multiplier = Math.max(activeStrength, type.minMultiplier)
        if (Number.isFinite(type.maxMultiplier)) {
          multiplier = Math.min(multiplier, type.maxMultiplier)
        }
      }

      let targetCount = shouldActivate ? Math.round(type.baseCount * multiplier) : 0

      if (shouldActivate && targetCount < type.minCount) {
        targetCount = type.minCount
      }

      while (elements.length > targetCount) {
        const element = elements.pop()
        if (element && element.parentElement === overlayElement) {
          overlayElement.removeChild(element)
        }
      }

      while (shouldActivate && elements.length < targetCount) {
        const element = type.createElement({
          intensity: intensityValue,
          density: densityValue,
          overlay: overlayElement,
          mode: currentMode,
          flakeDensity: flakeDensityValue,
          puffDensity: puffDensityValue,
        })
        elements.push(element)
        overlayElement.appendChild(element)
      }

      if (!elements.length) {
        return
      }

      elements.forEach((element) => {
        type.updateElement(element, {
          intensity: intensityValue,
          density: densityValue,
          overlay: overlayElement,
          mode: currentMode,
          flakeDensity: flakeDensityValue,
          puffDensity: puffDensityValue,
        })
      })
    })
  }

  const registerElementType = (
    {
      key,
      createElement,
      updateElement,
      baseCount: baseCountInput,
      densityScale = 1,
      intensityScale = 0,
      bias = 0,
      minActivation = 0,
      minMultiplier = 0,
      minCount = 0,
      maxMultiplier = Infinity,
      densityKey = 'rain',
    },
    { replace = false } = {},
  ) => {
    if (!key || typeof key !== 'string') {
      throw new Error('registerElementType requires a string key')
    }
    if (typeof createElement !== 'function') {
      throw new Error(`element type "${key}" requires a createElement function`)
    }
    if (typeof updateElement !== 'function') {
      throw new Error(`element type "${key}" requires an updateElement function`)
    }

    const nextKey = key.trim()
    const existing = elementTypes.get(nextKey)
    if (existing && !replace) {
      throw new Error(`element type "${nextKey}" already registered`)
    }

    if (existing) {
      removeElementsForType(existing)
    }

    const normalised = {
      key: nextKey,
      createElement,
      updateElement,
      baseCount: Number.isFinite(baseCountInput)
        ? Math.max(0, Math.round(baseCountInput))
        : desiredCount,
      densityScale: Number.isFinite(densityScale) ? densityScale : 1,
      intensityScale: Number.isFinite(intensityScale) ? intensityScale : 0,
      bias: Number.isFinite(bias) ? bias : 0,
      minActivation: Number.isFinite(minActivation) ? minActivation : 0,
      minMultiplier: Number.isFinite(minMultiplier) ? Math.max(0, minMultiplier) : 0,
      minCount: Number.isFinite(minCount) ? Math.max(0, Math.round(minCount)) : 0,
      maxMultiplier: Number.isFinite(maxMultiplier) ? Math.max(0, maxMultiplier) : Infinity,
      densityKey: typeof densityKey === 'string' ? densityKey : 'rain',
      elements: [],
    }

    elementTypes.set(nextKey, normalised)
    syncPools()
    return normalised
  }

  const removeAllTypes = () => {
    elementTypes.forEach((type) => {
      removeElementsForType(type)
    })
    elementTypes.clear()
  }

  const setMode = (value = MODE_RAIN) => {
    const nextMode = value === MODE_SNOW ? MODE_SNOW : MODE_RAIN
    if (overlayElement) {
      overlayElement.setAttribute(MODE_ATTR, nextMode)
    }
    if (currentMode === nextMode && elementTypes.size > 0) {
      return
    }
    currentMode = nextMode
    removeAllTypes()

    if (nextMode === MODE_SNOW) {
      currentDensity = 0
      currentFlakeDensity = 0
      currentPuffDensity = 0
      if (overlayElement) {
        overlayElement.style.setProperty(DENSITY_VAR, '0')
        overlayElement.style.setProperty(SNOWFLAKE_DENSITY_VAR, '0')
        overlayElement.style.setProperty(SNOWPUFF_DENSITY_VAR, '0')
      }
      registerElementType({
        key: 'snowflake',
        createElement: createSnowflakeElement,
        updateElement: updateSnowflakeElement,
        baseCount: Math.max(32, Math.round(desiredCount * 3.2)),
        densityScale: 0.6,
        intensityScale: 0.2,
        minActivation: 0.02,
        minMultiplier: 0.45,
        maxMultiplier: 3.6,
        minCount: Math.max(18, Math.round(desiredCount * 1.8)),
        densityKey: 'flake',
      })

      registerElementType({
        key: 'snowpuff',
        createElement: createSnowpuffElement,
        updateElement: updateSnowpuffElement,
        baseCount: Math.max(18, Math.round(desiredCount * 1.8)),
        densityScale: 0.65,
        intensityScale: 0.16,
        minActivation: 0.02,
        minMultiplier: 0.4,
        maxMultiplier: 3.2,
        minCount: Math.max(12, Math.round(desiredCount * 1.1)),
        densityKey: 'puff',
      })
    } else {
      currentFlakeDensity = 0
      currentPuffDensity = 0
      if (overlayElement) {
        overlayElement.style.setProperty(SNOWFLAKE_DENSITY_VAR, '0')
        overlayElement.style.setProperty(SNOWPUFF_DENSITY_VAR, '0')
      }
      registerElementType({
        key: 'streak',
        createElement: createStreakElement,
        updateElement: updateStreakElement,
        baseCount: desiredCount,
        densityScale: 0.8,
        intensityScale: 0.25,
        minActivation: 0.04,
        minMultiplier: 0.3,
        maxMultiplier: 3.5,
        minCount: 6,
      })

      registerElementType({
        key: 'droplet',
        createElement: createDropletElement,
        updateElement: updateDropletElement,
        baseCount: Math.max(4, Math.round(desiredCount * 0.45)),
        densityScale: 0.5,
        intensityScale: 0.55,
        minActivation: 0.06,
        minMultiplier: 0.25,
        maxMultiplier: 2.4,
        minCount: 4,
      })

      registerElementType({
        key: 'droplette',
        createElement: createDropletteElement,
        updateElement: updateDropletteElement,
        baseCount: Math.max(6, Math.round(desiredCount * 0.75)),
        densityScale: 0.75,
        intensityScale: 0.35,
        minActivation: 0.05,
        minMultiplier: 0.3,
        maxMultiplier: 2.8,
        minCount: 6,
      })
    }

    syncPools()
  }

  if (createdOverlay) {
    host.appendChild(overlayElement)
  } else {
    const existingParticles = overlayElement.querySelectorAll(
      `.${RAINDROP_CLASS}, .${SNOWFLAKE_CLASS}, .${SNOWPUFF_CLASS}`,
    )
    existingParticles.forEach((element) => {
      overlayElement.removeChild(element)
    })
    if (!overlayElement.isConnected) {
      host.appendChild(overlayElement)
    }
  }

  setMode(currentMode)

  const setIntensity = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(INTENSITY_VAR)
      currentIntensity = 0
      syncPools()
      return
    }
    if (resolved === 'auto') {
      overlayElement.style.setProperty(INTENSITY_VAR, 'auto')
      currentIntensity = 0
      syncPools()
      return
    }
    overlayElement.style.setProperty(INTENSITY_VAR, `${resolved}`)
    currentIntensity = Number.parseFloat(resolved) || 0
    syncPools()
  }

  const setWindSway = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(WIND_SWAY_VAR)
      return
    }
    overlayElement.style.setProperty(WIND_SWAY_VAR, `${resolved}`)
  }

  const setDropletDensity = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(DENSITY_VAR)
      currentDensity = 0
      syncPools()
      return
    }
    if (resolved === 'auto') {
      overlayElement.style.setProperty(DENSITY_VAR, 'auto')
      currentDensity = 0
      syncPools()
      return
    }
    overlayElement.style.setProperty(DENSITY_VAR, `${resolved}`)
    currentDensity = Number.parseFloat(resolved) || 0
    syncPools()
  }

  const setSnowflakeDensity = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(SNOWFLAKE_DENSITY_VAR)
      currentFlakeDensity = 0
      syncPools()
      return
    }
    if (resolved === 'auto') {
      overlayElement.style.setProperty(SNOWFLAKE_DENSITY_VAR, 'auto')
      currentFlakeDensity = 0
      syncPools()
      return
    }
    overlayElement.style.setProperty(SNOWFLAKE_DENSITY_VAR, `${resolved}`)
    currentFlakeDensity = Number.parseFloat(resolved) || 0
    syncPools()
  }

  const setSnowpuffDensity = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(SNOWPUFF_DENSITY_VAR)
      currentPuffDensity = 0
      syncPools()
      return
    }
    if (resolved === 'auto') {
      overlayElement.style.setProperty(SNOWPUFF_DENSITY_VAR, 'auto')
      currentPuffDensity = 0
      syncPools()
      return
    }
    overlayElement.style.setProperty(SNOWPUFF_DENSITY_VAR, `${resolved}`)
    currentPuffDensity = Number.parseFloat(resolved) || 0
    syncPools()
  }

  const setVelocity = (value) => {
    if (!overlayElement) {
      return
    }
    const resolved = sanitiseCssValue(value)
    if (resolved === null) {
      overlayElement.style.removeProperty(VELOCITY_VAR)
      return
    }
    overlayElement.style.setProperty(VELOCITY_VAR, `${resolved}`)
  }

  const update = ({ delta } = {}) => {
    void delta
  }

  const dispose = () => {
    if (!overlayElement) {
      return
    }
    setIntensity(null)
    setWindSway(null)
    setDropletDensity(null)
    setSnowflakeDensity(null)
    setSnowpuffDensity(null)
    setVelocity(null)
    elementTypes.forEach((type) => {
      removeElementsForType(type)
    })
    elementTypes.clear()
    if (createdOverlay && overlayElement.parentElement) {
      overlayElement.parentElement.removeChild(overlayElement)
    }
    overlayElement = null
  }

  return {
    element: overlayElement,
    setIntensity,
    setWindSway,
    setDropletDensity,
    setSnowflakeDensity,
    setSnowpuffDensity,
    setVelocity,
    update,
    dispose,
    registerElementType,
    setMode,
  }
}
