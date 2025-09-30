const OVERLAY_ID = 'weather-overlay'
const RAINDROP_CLASS = 'raindrop'
const INTENSITY_VAR = '--weather-intensity'
const WIND_SWAY_VAR = '--weather-wind-sway'
const DENSITY_VAR = '--weather-droplet-density'

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

function createRaindrop() {
  const drop = document.createElement('span')
  drop.className = RAINDROP_CLASS
  drop.setAttribute('aria-hidden', 'true')
  drop.style.setProperty('--raindrop-left', `${Math.random() * 100}%`)
  drop.style.setProperty('--raindrop-delay', `${Math.random() * -5}s`)
  drop.style.setProperty('--raindrop-duration', `${0.9 + Math.random() * 1.6}s`)
  drop.style.setProperty('--raindrop-scale', `${0.6 + Math.random() * 0.8}`)
  return drop
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
    overlayElement.style.zIndex = '70'
  }

  const desiredCount = parseDensityPreference(host) ?? 24
  const raindrops = []

  if (createdOverlay) {
    for (let index = 0; index < desiredCount; index += 1) {
      const drop = createRaindrop()
      raindrops.push(drop)
      overlayElement.appendChild(drop)
    }
    host.appendChild(overlayElement)
  } else {
    const existingRaindrops = overlayElement.querySelectorAll(`.${RAINDROP_CLASS}`)
    if (existingRaindrops.length === 0) {
      for (let index = 0; index < desiredCount; index += 1) {
        const drop = createRaindrop()
        raindrops.push(drop)
        overlayElement.appendChild(drop)
      }
    }
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
      return
    }
    overlayElement.style.setProperty(INTENSITY_VAR, `${resolved}`)
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
      return
    }
    overlayElement.style.setProperty(DENSITY_VAR, `${resolved}`)
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
    raindrops.forEach((drop) => {
      if (drop.parentElement === overlayElement) {
        overlayElement.removeChild(drop)
      }
    })
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
    update,
    dispose,
  }
}
