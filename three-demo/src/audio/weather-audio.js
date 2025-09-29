const hasImportGlob = typeof import.meta.glob === 'function'

const cueImports = hasImportGlob
  ? import.meta.glob(
      '../sounds/sound_effects/weather/**/{start,stop}.{mp3,MP3,wav,WAV,ogg,OGG}',
      {
        eager: true,
        import: 'default',
        query: '?url',
      },
    )
  : {}

const SUPPORTED_CUE_TYPES = new Set(['start', 'stop'])

function normalizeCueType(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const [maybeCue] = withoutExtension.split(/[-_.\s]/)
  const cue = maybeCue?.toLowerCase?.()
  return SUPPORTED_CUE_TYPES.has(cue) ? cue : null
}

function extractWeatherId(pathSegments) {
  const weatherIndex = pathSegments.lastIndexOf('weather')
  if (weatherIndex === -1 || weatherIndex + 1 >= pathSegments.length) {
    return null
  }
  return pathSegments[weatherIndex + 1]
}

const weatherCueMap = new Map()

Object.entries(cueImports)
  .sort(([a], [b]) => a.localeCompare(b))
  .forEach(([path, url]) => {
    const segments = path.split('/').filter(Boolean)
    const weatherId = extractWeatherId(segments)
    if (!weatherId) {
      return
    }
    const fileName = segments[segments.length - 1]
    const cueType = normalizeCueType(fileName)
    if (!cueType) {
      return
    }
    const cues = weatherCueMap.get(weatherId) ?? {}
    cues[cueType] = url
    weatherCueMap.set(weatherId, cues)
  })

export function getWeatherCueUrl(weatherId, cueType) {
  if (!weatherId || !cueType) {
    return null
  }
  const cues = weatherCueMap.get(weatherId)
  if (!cues) {
    return null
  }
  const normalizedCue = cueType.toLowerCase()
  return cues[normalizedCue] ?? null
}

export function getWeatherAudioCues(weatherId) {
  const cues = weatherCueMap.get(weatherId)
  if (!cues) {
    return null
  }
  return { ...cues }
}

export function listWeatherAudioCues() {
  return Array.from(weatherCueMap.entries()).map(([weatherId, cues]) => ({
    weatherId,
    cues: { ...cues },
  }))
}

export function hasWeatherAudio() {
  return weatherCueMap.size > 0
}

export function createWeatherAudioController({ defaultVolume = 0.7 } = {}) {
  if (typeof Audio !== 'function') {
    return {
      playCue: () => null,
      handleTransition: () => {},
      dispose: () => {},
      getCueUrl: getWeatherCueUrl,
    }
  }

  const activeElements = new Set()

  const clampVolume = (value) => {
    if (!Number.isFinite(value)) {
      return defaultVolume
    }
    return Math.min(1, Math.max(0, value))
  }

  const cleanup = (entry) => {
    if (!entry) {
      return
    }
    const { audio, listeners } = entry
    if (!audio) {
      return
    }
    if (listeners) {
      audio.removeEventListener('ended', listeners.ended)
      audio.removeEventListener('error', listeners.error)
    }
    try {
      audio.pause()
    } catch (error) {
      // Ignore pause errors (can happen if the audio element is already stopped).
    }
    audio.src = ''
    activeElements.delete(entry)
  }

  const playCue = ({ weatherId, cueType, volume } = {}) => {
    const url = getWeatherCueUrl(weatherId, cueType)
    if (!url) {
      return null
    }
    const audio = new Audio()
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
    audio.volume = clampVolume(volume)

    const entry = { audio, listeners: null }
    const listeners = {
      ended: () => cleanup(entry),
      error: (event) => {
        console.warn('Failed to play weather audio cue:', event?.error ?? event)
        cleanup(entry)
      },
    }
    entry.listeners = listeners

    audio.addEventListener('ended', listeners.ended)
    audio.addEventListener('error', listeners.error)

    audio.src = url

    const playPromise = audio.play()
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        console.warn('Failed to play weather audio cue:', error)
        cleanup(entry)
      })
    }

    activeElements.add(entry)

    return {
      stop: () => cleanup(entry),
      audio,
    }
  }

  const handleTransition = ({ previousWeatherId, nextWeatherId } = {}) => {
    if (previousWeatherId && previousWeatherId !== nextWeatherId) {
      playCue({ weatherId: previousWeatherId, cueType: 'stop' })
    }
    if (nextWeatherId) {
      playCue({ weatherId: nextWeatherId, cueType: 'start' })
    }
  }

  const dispose = () => {
    for (const entry of Array.from(activeElements)) {
      cleanup(entry)
    }
    activeElements.clear()
  }

  return {
    playCue,
    handleTransition,
    dispose,
    getCueUrl: getWeatherCueUrl,
  }
}
