const DEFAULT_WEATHER_PRESETS = {
  clear_skies: {
    id: 'clear_skies',
    label: 'Clear Skies',
    description: 'Bright conditions with excellent visibility.',
    intensity: 0,
    category: 'clear',
    moisture: 0,
    temperature: 0.65,
  },
  misty_rain: {
    id: 'misty_rain',
    label: 'Misty Rain',
    description: 'A gentle drizzle that lightly dampens surfaces.',
    intensity: 0.35,
    category: 'rain',
    moisture: 0.45,
    temperature: 0.5,
  },
  charged_storm: {
    id: 'charged_storm',
    label: 'Charged Storm',
    description: 'Heavy rainfall and turbulent winds rolling through the sector.',
    intensity: 0.85,
    category: 'storm',
    moisture: 0.9,
    temperature: 0.4,
  },
}

const DEFAULT_TICK_INTERVAL = 1.5

export function createWeatherManager({
  scene,
  particleSystem,
  registerDiagnosticOverlay,
} = {}) {
  const weatherPresets = new Map(
    Object.entries(DEFAULT_WEATHER_PRESETS).map(([key, value]) => [key, { ...value }]),
  )

  let activeWeather = weatherPresets.get('clear_skies') ?? null
  let tickAccumulator = 0
  let lastElapsedTime = 0
  const tickListeners = new Set()
  const scheduledTransitions = []
  let diagnosticOverlayDisposer = null

  const particleEffectHandles = new Set()

  const applyWeatherEffects = (weather) => {
    if (!weather || !scene) {
      return
    }
    scene.userData = scene.userData || {}
    scene.userData.weather = {
      id: weather.id,
      label: weather.label,
      intensity: weather.intensity,
      category: weather.category,
    }
  }

  const disposeWeatherEffects = () => {
    for (const handle of particleEffectHandles) {
      try {
        handle?.stop?.()
      } catch (error) {
        console.warn('Failed to dispose weather particle handle:', error)
      }
    }
    particleEffectHandles.clear()
  }

  const evaluateScheduledTransitions = ({ elapsedTime }) => {
    if (!Number.isFinite(elapsedTime)) {
      return
    }
    const due = []
    for (let i = scheduledTransitions.length - 1; i >= 0; i -= 1) {
      const entry = scheduledTransitions[i]
      if (elapsedTime >= entry.triggerTime) {
        due.push(entry)
        scheduledTransitions.splice(i, 1)
      }
    }
    for (const entry of due.sort((a, b) => a.triggerTime - b.triggerTime)) {
      setWeather(entry.weatherId, entry.options)
    }
  }

  const runTick = (context) => {
    if (tickListeners.size === 0) {
      return
    }
    const listeners = Array.from(tickListeners)
    listeners.forEach((listener) => {
      try {
        listener({
          weather: getCurrentWeather(),
          scene,
          particleSystem,
          ...context,
        })
      } catch (error) {
        console.error('Weather tick listener failed:', error)
      }
    })
  }

  const registerOverlay = () => {
    if (typeof registerDiagnosticOverlay !== 'function' || diagnosticOverlayDisposer) {
      return
    }
    diagnosticOverlayDisposer = registerDiagnosticOverlay(({ elapsedTime }) => {
      if (!scene?.userData?.weather) {
        return
      }
      scene.userData.weather.lastOverlayUpdate = elapsedTime
    })
  }

  const setWeather = (weatherId, options = {}) => {
    const preset = weatherPresets.get(weatherId)
    if (!preset) {
      console.warn(`Weather preset "${weatherId}" is not registered.`)
      return activeWeather
    }
    const nextWeather = {
      ...preset,
      ...options.metadata,
      id: weatherId,
    }
    if (activeWeather && activeWeather.id === nextWeather.id) {
      return activeWeather
    }
    disposeWeatherEffects()
    activeWeather = nextWeather
    applyWeatherEffects(activeWeather)
    if (particleSystem && typeof particleSystem.emitWeatherEffect === 'function') {
      const handle = particleSystem.emitWeatherEffect(activeWeather)
      if (handle) {
        particleEffectHandles.add(handle)
      }
    }
    return activeWeather
  }

  const scheduleWeatherChange = ({ weatherId, delay = 0, triggerTime, options = {} }) => {
    if (!weatherId) {
      throw new Error('scheduleWeatherChange requires a weatherId')
    }
    const baseTime = Number.isFinite(triggerTime)
      ? triggerTime
      : (Number.isFinite(lastElapsedTime) ? lastElapsedTime : 0) + Math.max(0, delay)
    scheduledTransitions.push({
      weatherId,
      triggerTime: baseTime,
      options,
    })
  }

  const registerTickListener = (listener) => {
    if (typeof listener !== 'function') {
      throw new Error('registerTickListener expects a function')
    }
    tickListeners.add(listener)
    return () => {
      tickListeners.delete(listener)
    }
  }

  const registerWeatherPreset = (weather) => {
    if (!weather?.id) {
      throw new Error('registerWeatherPreset expects an object with an id')
    }
    weatherPresets.set(weather.id, { ...weather })
  }

  const getCurrentWeather = () => (activeWeather ? { ...activeWeather } : null)

  const update = (context = {}) => {
    const { delta = 0, elapsedTime = lastElapsedTime } = context
    lastElapsedTime = Number.isFinite(elapsedTime) ? elapsedTime : lastElapsedTime
    evaluateScheduledTransitions({ elapsedTime: lastElapsedTime })
    tickAccumulator += Number.isFinite(delta) ? delta : 0
    while (tickAccumulator >= DEFAULT_TICK_INTERVAL) {
      tickAccumulator -= DEFAULT_TICK_INTERVAL
      runTick({
        delta: DEFAULT_TICK_INTERVAL,
        elapsedTime: lastElapsedTime,
        playerControls: context.playerControls,
      })
    }
  }

  const dispose = () => {
    disposeWeatherEffects()
    tickListeners.clear()
    scheduledTransitions.length = 0
    if (diagnosticOverlayDisposer) {
      try {
        diagnosticOverlayDisposer()
      } catch (error) {
        console.error('Failed to dispose weather diagnostic overlay:', error)
      }
      diagnosticOverlayDisposer = null
    }
  }

  applyWeatherEffects(activeWeather)
  registerOverlay()

  return {
    update,
    setWeather,
    scheduleWeatherChange,
    registerTickListener,
    registerWeatherPreset,
    getCurrentWeather,
    dispose,
  }
}
