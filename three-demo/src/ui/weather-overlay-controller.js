const OVERLAY_ID = 'weather-overlay'
const RAINDROP_CLASS = 'raindrop'
const RAINDROP_STREAK_CLASS = `${RAINDROP_CLASS}--streak`
const RAINDROP_DROPLET_CLASS = `${RAINDROP_CLASS}--droplet`
const RAINDROP_DROPLETTE_CLASS = `${RAINDROP_CLASS}--droplette`
const INTENSITY_VAR = '--rain-intensity'
const WIND_SWAY_VAR = '--rain-wind'
const DENSITY_VAR = '--rain-density'
const VELOCITY_VAR = '--rain-velocity'

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
    elementTypes.forEach((type) => {
      if (!type) {
        return
      }
      const { elements } = type
      const intensityValue = Math.max(0, Number.isFinite(currentIntensity) ? currentIntensity : 0)
      const densityValue = Math.max(0, Number.isFinite(currentDensity) ? currentDensity : 0)
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
      elements: [],
    }

    elementTypes.set(nextKey, normalised)
    syncPools()
    return normalised
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

  if (createdOverlay) {
    host.appendChild(overlayElement)
  } else {
    const existingRaindrops = overlayElement.querySelectorAll(`.${RAINDROP_CLASS}`)
    existingRaindrops.forEach((element) => {
      overlayElement.removeChild(element)
    })
    if (!overlayElement.isConnected) {
      host.appendChild(overlayElement)
    }
  }

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
    setVelocity,
    update,
    dispose,
    registerElementType,
  }
}
